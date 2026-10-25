// ---------------------------------------------------------------------------
// Pattern: copies of a part (and everything on it) spread over the part it
// hangs off, or the whole creature, in one go: spikes down a snake, plates on
// a back. While it's open the copies are only a preview; Apply makes each a
// real part, to pose, reshape or delete like any other. Where they go comes
// from the same placing as scatter markings (src/scatter.ts), or along a path
// dragged over the creature.

import * as THREE from 'three';
import { type BoneRT, type PartState } from '../creature';
import { defaultMarking, SCATTER_WHERE, type Marking, type ScatterWhere } from '../markings';
import { scatterCopies, type ScatterBlocker } from '../scatter';
import { bvhFor } from '../distance';
import { restFrame } from '../bend';
import { copyLimb, pasteLimb, partIds, type BoneDef, type LimbClip, type PartCopy, type V3 } from '../rigs';
import { $ } from './dom';
import { canvas, scene } from './stage';
import { creature, selected, state } from './state';
import { raycaster, setRay } from './controls';
import { rigEdit } from './rigEdit';
import { closeTopPopovers } from './popovers';
import { hint } from './hints';
import { invalidate } from './loop';

/** most parts one pattern makes */
const MAX_COPIES = 60;

/** where: as a scatter would, or along a path dragged over the creature */
type PatternWhere = ScatterWhere | 'path';

interface PatternOpts {
  on: 'parent' | 'all';
  where: PatternWhere;
  amount: number;
  scale: number;
  vary: number;
  spacing: number;
  upright: number;
  spin: number;
  lean: number;
  sink: number;
  /** pairs on both sides (on a part down the middle, copies off to the side come as a mirrored pair) */
  mirror: boolean;
  /** along a path: each turned to face along it (plates down a back), or turned as Turn says */
  follow: boolean;
  /** along a path: smaller towards its ends, 0..1 */
  ends: number;
  /** along a path: how much a wobbly drag is evened out, 0..1 */
  smooth: number;
  seed: number;
}

/** A spot on the creature dragged over, for a path: the part, where on it (its own frame) and which way the surface faces there; and where that is in the rest pose. */
interface PathPoint {
  bone: BoneRT;
  local: THREE.Vector3;
  normal: THREE.Vector3;
  rest: THREE.Vector3;
}

/** Where one copy goes: on a part, its place in that part's frame, and whether it comes as a mirrored pair. */
interface Spot {
  bone: BoneRT;
  matrix: THREE.Matrix4;
  pair: boolean;
}

/** The pattern being set up: the part copied, its options, where the copies would go, and their preview. */
let open: { source: string; opts: PatternOpts; spots: Spot[]; preview: THREE.Object3D[]; path: PathPoint[]; drawing: boolean } | null = null;
export const patterning = () => !!open;

const ghost = new THREE.MeshStandardMaterial({ color: 0xff8a5c, transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false });
/** the path as it's used (evened out) */
let shownPath: PathPoint[] = [];
/** the path, as it was dragged */
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff6b4a, depthTest: false, transparent: true }));
pathLine.renderOrder = 999;
pathLine.raycast = () => {};

/** Start patterning the picked part. */
export function startPattern() {
  const b = creature.bones.get(selected);
  if (!b?.parent) return hint('The first part holds everything else: pick a part that hangs off another', 2400, true);
  closeTopPopovers();
  const mirror = b.def.sideSign !== 0;
  open = {
    source: b.def.id,
    opts: { on: 'parent', where: 'all', amount: 0.3, scale: 1, vary: 0.2, spacing: 0.6, upright: 0, spin: 0.15, lean: 0.1, sink: 0, mirror, follow: true, ends: 0.4, smooth: 0.5, seed: Math.floor(Math.random() * 1e6) },
    spots: [],
    preview: [],
    path: [],
    drawing: false,
  };
  $('#pattern-pop').hidden = false;
  renderPattern();
  layOut();
  hint('Copies of it, spread out: try the options, then Apply. They become ordinary parts', 3200);
}

export function stopPattern() {
  if (!open) return;
  clearPreview();
  open = null;
  pathLine.removeFromParent();
  document.body.classList.remove('picking-spot');
  $('#pattern-pop').hidden = true;
  invalidate();
}

function clearPreview() {
  for (const o of open?.preview ?? []) {
    o.removeFromParent();
    (o as THREE.InstancedMesh).dispose?.();
  }
  if (open) open.preview = [];
}

/** The part copied and everything on it, as one limb, with its frame (base, up its length) in the skeleton. */
function sourceLimb(): { b: BoneRT; clip: LimbClip; frame: THREE.Matrix4; extent: number } | null {
  const b = open && creature.bones.get(open.source);
  // (a pair is copied from its left side)
  const def = b && (b.def.sideSign === -1 ? creature.bones.get(b.def.baseId + 'L') ?? b : b);
  const clip = def && copyLimb(state.rig, def.def.id);
  if (!def || !clip) return null;
  const geo = def.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
  if (geo && !geo.boundingBox) geo.computeBoundingBox();
  const extent = geo?.boundingBox ? geo.boundingBox.getSize(new THREE.Vector3()).length() : def.length;
  return { b: def, clip, frame: restFrame(def.def).world, extent };
}

/** The part copied and everything hanging off it (a pair: both sides). */
function sourceTree(src: BoneRT): Set<BoneRT> {
  const below = new Set<BoneRT>();
  for (const o of creature.list) for (let p: BoneRT | null = o; p; p = p.parent) if (p === src || (src.def.sideSign && p.def.baseId === src.def.baseId)) below.add(o);
  return below;
}

/** Which parts copies go on: the one it hangs off, or every part (but it and what's on it); a pair by its left side. */
function targets(src: BoneRT): BoneRT[] {
  const below = sourceTree(src);
  const parent = src.parent!.def.sideSign === -1 ? (creature.bones.get(src.parent!.def.baseId + 'L') ?? src.parent!) : src.parent!;
  const list = open!.opts.on === 'parent' ? [parent] : creature.list;
  return list.filter((o) => !below.has(o) && o.def.sideSign !== -1 && o.mesh);
}

/** Which side a spot (in a part's frame) is on, at rest: + left, - right, 0 the middle. */
function sideOf(bone: BoneRT, local: THREE.Vector3): number {
  const x = local.clone().applyMatrix4(bone.restGroup).x;
  return Math.abs(x) > 0.03 ? Math.sign(x) : 0;
}

/** Spread as a scatter would. */
function scatterSpots(src: NonNullable<ReturnType<typeof sourceLimb>>): Spot[] {
  const o = open!.opts;
  const m: Marking = {
    ...defaultMarking('scatter'),
    where: o.where as ScatterWhere,
    // (parts are bigger than most scattered things: far fewer of them)
    amount: o.amount * 0.45,
    scale: o.scale,
    vary: o.vary,
    spacing: o.spacing,
    upright: o.upright,
    spin: o.spin,
    lean: o.lean,
    sink: o.sink,
    seed: o.seed,
  };
  const blockers: (ScatterBlocker & { bone: BoneRT })[] = creature.list.flatMap((b) => {
    const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
    if (!geo) return [];
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    return [{ bone: b, geo, bvh: bvhFor(geo), fromRest: b.restGroup.clone().invert(), sphere: geo.boundingSphere!.clone().applyMatrix4(b.restGroup) }];
  });
  const spots: Spot[] = [];
  const pairSrc = src.b.def.sideSign !== 0;
  for (const t of targets(src.b)) {
    const geo = t.mesh!.userData.baseGeo as THREE.BufferGeometry;
    const up = new THREE.Vector3(0, 1, 0).transformDirection(t.restGroup.clone().invert());
    for (const copy of scatterCopies(m, { geo, toRest: t.restGroup, up }, blockers.filter((x) => x.bone !== t), src.extent, t.def.id)) {
      const side = t.def.sideSign === 1 ? 1 : sideOf(t, new THREE.Vector3().setFromMatrixPosition(copy.matrix));
      // a pair goes on the left (its right side follows); on a part down the middle, Mirror makes pairs of those off to the side
      const pair = side !== 0 && (pairSrc || o.mirror || t.def.sideSign === 1);
      if (pair && side < 0) continue;
      spots.push({ bone: t, matrix: copy.matrix, pair });
    }
  }
  return spots;
}

/**
 * The path as dragged, evened out (by `k`, 0..1): its spots averaged with
 * their neighbours (the ends stay put) in the rest pose, then each put back on
 * the nearest bit of the creature's surface, so it never cuts through it.
 */
function smoothPath(raw: PathPoint[], k: number, below: Set<BoneRT>): PathPoint[] {
  const passes = Math.round(k * 24);
  if (raw.length < 3 || !passes) return raw;
  let pts = raw.map((p) => p.rest.clone());
  for (let n = 0; n < passes; n++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : pts[i - 1].clone().add(pts[i + 1]).multiplyScalar(0.25).addScaledVector(p, 0.5)));
  const parts = creature.list.flatMap((b) => {
    const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
    return geo && !below.has(b) ? [{ b, geo, bvh: bvhFor(geo), fromRest: b.restGroup.clone().invert() }] : [];
  });
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const q = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  return pts.map((rest, i) => {
    let best: PathPoint | null = null;
    let near = Infinity;
    for (const p of parts) {
      q.copy(rest).applyMatrix4(p.fromRest);
      const h = p.bvh.closestPointToPoint(q, hit);
      if (!h || h.distance >= near) continue;
      near = h.distance;
      const pos = p.geo.getAttribute('position') as THREE.BufferAttribute;
      const idx = (k: number) => (p.geo.index ? p.geo.index.getX(h.faceIndex * 3 + k) : h.faceIndex * 3 + k);
      a.fromBufferAttribute(pos, idx(0));
      b.fromBufferAttribute(pos, idx(1));
      c.fromBufferAttribute(pos, idx(2));
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      // facing out, as the surface did where it was dragged over (a mirrored side's triangles can face in)
      const was = raw[Math.round((i / (pts.length - 1)) * (raw.length - 1))];
      if (normal.clone().transformDirection(p.b.restGroup).dot(was.normal.clone().transformDirection(was.bone.restGroup)) < 0) normal.negate();
      best = { bone: p.b, local: h.point.clone(), normal, rest: h.point.clone().applyMatrix4(p.b.restGroup) };
    }
    return best ?? raw[Math.round((i / (pts.length - 1)) * (raw.length - 1))];
  });
}

/** Evenly along the path dragged over the creature. */
function pathSpots(src: NonNullable<ReturnType<typeof sourceLimb>>): Spot[] {
  const o = open!.opts;
  const below = sourceTree(src.b);
  const path = smoothPath(open!.path, o.smooth, below);
  shownPath = path;
  if (path.length < 2) return [];
  const len: number[] = [0];
  for (let i = 1; i < path.length; i++) len.push(len[i - 1] + path[i].rest.distanceTo(path[i - 1].rest));
  const total = len[len.length - 1];
  if (total < 1e-4) return [];
  const n = Math.max(2, Math.round(2 + o.amount * 38));
  let seed = o.seed >>> 0;
  const rand = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2654435761) + 0x6d2b79f5) >>> 0) / 4294967296);
  const pairSrc = src.b.def.sideSign !== 0;
  const spots: Spot[] = [];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const at = u * total;
    let j = 1;
    while (j < len.length - 1 && len[j] < at) j++;
    const a = path[j - 1], b = path[j];
    const f = (at - len[j - 1]) / Math.max(1e-9, len[j] - len[j - 1]);
    // on one part: between the two spots; across a join, on whichever is nearer
    let bone = f < 0.5 ? a.bone : b.bone;
    let local = a.bone === b.bone ? a.local.clone().lerp(b.local, f) : (f < 0.5 ? a : b).local.clone();
    let normal = a.bone === b.bone ? a.normal.clone().lerp(b.normal, f).normalize() : (f < 0.5 ? a : b).normal.clone();
    // which way the path goes there, in that part's frame
    const along = b.rest.clone().sub(a.rest).transformDirection(bone.restGroup.clone().invert());
    if (below.has(bone)) continue;
    // a right twin's spot is its left twin's, mirrored (the pair is made from the left)
    let side = bone.def.sideSign === -1 ? -1 : bone.def.sideSign === 1 ? 1 : sideOf(bone, local);
    const pair = side !== 0 && (pairSrc || o.mirror || bone.def.sideSign !== 0);
    if (pair && side < 0) {
      if (bone.def.sideSign === -1) {
        const twin = creature.bones.get(bone.def.baseId + 'L');
        if (!twin) continue;
        bone = twin;
        local = local.clone().setZ(-local.z);
        normal = normal.clone().setZ(-normal.z);
        along.setZ(-along.z);
      } else {
        // a middle part: the same spot across the creature's middle
        const flip = bone.restGroup.clone().invert().multiply(new THREE.Matrix4().makeScale(-1, 1, 1)).multiply(bone.restGroup);
        local.applyMatrix4(flip);
        normal.transformDirection(flip);
        along.transformDirection(flip);
      }
      side = 1;
    }
    const upAt = new THREE.Vector3(0, 1, 0).transformDirection(bone.restGroup.clone().invert());
    const out = normal.clone().lerp(upAt, o.upright).normalize();
    // facing along the path, or turned as Turn says
    const across = along.clone().addScaledVector(out, -along.dot(out));
    if (across.lengthSq() < 1e-8) across.set(1, 0, 0).addScaledVector(out, -out.x);
    across.normalize();
    if (!o.follow) across.applyAxisAngle(out, (rand() - 0.5) * Math.PI * 2 * o.spin);
    else rand();
    const lean = o.lean * 0.7 * rand();
    const tip = rand() * Math.PI * 2;
    if (lean > 0) {
      const axis = across.clone().applyAxisAngle(out, tip);
      out.applyAxisAngle(axis, lean);
      across.applyAxisAngle(axis, lean);
    }
    const size = o.scale * (1 + (rand() * 2 - 1) * o.vary * 0.7) * (1 - o.ends * (1 - Math.sin(Math.PI * u)));
    const pos = local.clone().addScaledVector(normal, -o.sink * src.extent * size * 0.4);
    const m = new THREE.Matrix4().makeBasis(across, out, new THREE.Vector3().crossVectors(across, out)).setPosition(pos).multiply(new THREE.Matrix4().makeScale(size, size, size));
    spots.push({ bone, matrix: m, pair });
  }
  return spots;
}

/** Where the copies go, as the options say now, and their preview. */
function layOut() {
  if (!open) return;
  clearPreview();
  const src = sourceLimb();
  if (!src) return;
  const spots = open.opts.where === 'path' ? pathSpots(src) : scatterSpots(src);
  // the path as it's used: evened out
  if (open.opts.where === 'path' && shownPath.length > 1 && !open.drawing) {
    creature.root.updateMatrixWorld(true);
    showPathLine(shownPath.map((p) => p.local.clone().applyMatrix4(p.bone.pivot.matrixWorld)));
  }
  // too many: every so many, so they still spread right over
  const keep = spots.length > MAX_COPIES ? spots.filter((_, i) => Math.floor((i * MAX_COPIES) / spots.length) !== Math.floor(((i - 1) * MAX_COPIES) / spots.length)) : spots;
  open.spots = keep;
  showPreview(src, keep);
  const path = open.opts.where === 'path';
  $('#pattern-count').textContent =
    path && open.path.length < 2
      ? 'Drag along the creature where they go'
      : keep.length
        ? `${keep.length} ${keep.length === 1 ? 'copy' : 'copies'}${keep.some((s) => s.pair) ? ' (pairs count once)' : ''}`
        : 'Nowhere to put them: try more, or another Where';
  invalidate();
}

/**
 * The preview: the part's shape, see-through, on every spot (and the other
 * side of a pair). Mirrored ones go in a mesh of their own, turned inside out
 * as a whole: copies can't each be (they'd show their insides, dark).
 */
function showPreview(src: NonNullable<ReturnType<typeof sourceLimb>>, spots: Spot[]) {
  const shape = src.b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
  if (!shape || !open) return;
  const rel = src.frame.clone().invert().multiply(src.b.restGroup);
  const groups = new Map<string, { bone: BoneRT; flip: boolean; mats: THREE.Matrix4[] }>();
  const put = (bone: BoneRT, m: THREE.Matrix4) => {
    const flip = m.determinant() < 0;
    const key = bone.def.id + (flip ? '-' : '+');
    (groups.get(key) ?? groups.set(key, { bone, flip, mats: [] }).get(key)!).mats.push(m);
  };
  for (const s of spots) {
    const mat = s.matrix.clone().multiply(rel);
    put(s.bone, mat);
    const twin = s.pair ? (s.bone.def.sideSign === 1 ? creature.twinOf(s.bone) : s.bone) : null;
    if (!twin) continue;
    // the right side: a left twin's frame mirrored across its Z; a middle part's across the creature's middle
    put(twin, twin === s.bone ? s.bone.restGroup.clone().invert().multiply(new THREE.Matrix4().makeScale(-1, 1, 1)).multiply(s.bone.restGroup).multiply(mat) : new THREE.Matrix4().makeScale(1, 1, -1).multiply(mat));
  }
  const unflip = new THREE.Matrix4().makeScale(1, 1, -1);
  for (const { bone, flip, mats } of groups.values()) {
    const mesh = new THREE.InstancedMesh(shape, ghost, mats.length);
    // (the mesh itself mirrored, its copies the right way out: three.js turns the faces round for a mirrored mesh)
    if (flip) mesh.scale.set(1, 1, -1);
    mats.forEach((mt, i) => mesh.setMatrixAt(i, flip ? unflip.clone().multiply(mt) : mt));
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    bone.pivot.add(mesh);
    open.preview.push(mesh);
  }
}

// ---- dragging the path over the creature ----

function startPath() {
  if (!open) return;
  open.drawing = true;
  document.body.classList.add('picking-spot');
  hint('Drag along the creature where they go: down the back, round a tail… (drag off it to turn the view)', 0);
}

/** The spot on the creature (not the part being copied) under the pointer. */
function pathPointAt(x: number, y: number): PathPoint | null {
  const src = open && creature.bones.get(open.source);
  if (!src) return null;
  const below = sourceTree(src);
  setRay(x, y);
  const meshes = creature.list.filter((b) => !below.has(b) && b.mesh).map((b) => b.mesh!);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  const bone = hit?.face && creature.bones.get(hit.object.userData.boneId as string);
  if (!hit?.face || !bone) return null;
  bone.pivot.updateMatrixWorld(true);
  const toLocal = bone.pivot.matrixWorld.clone().invert();
  const local = hit.point.clone().applyMatrix4(toLocal);
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(toLocal);
  return { bone, local, normal, rest: local.clone().applyMatrix4(bone.restGroup) };
}

function showPathLine(world: THREE.Vector3[]) {
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(world);
  if (!pathLine.parent) scene.add(pathLine);
  invalidate();
}

function initPathDrawing() {
  let world: THREE.Vector3[] | null = null;
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!open?.drawing || e.button !== 0) return;
      const p = pathPointAt(e.clientX, e.clientY);
      // (off the creature: the view turns as usual)
      if (!p) return;
      e.stopImmediatePropagation();
      // (keeps the drag when the pointer slips off the view; a pointer that isn't down any more can't be held)
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
      open.path = [p];
      world = [p.local.clone().applyMatrix4(p.bone.pivot.matrixWorld)];
      showPathLine(world);
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!open?.drawing || !world) return;
      e.stopImmediatePropagation();
      const p = pathPointAt(e.clientX, e.clientY);
      if (!p || p.rest.distanceTo(open.path[open.path.length - 1].rest) < 0.01) return;
      open.path.push(p);
      world.push(p.local.clone().applyMatrix4(p.bone.pivot.matrixWorld));
      showPathLine(world);
    },
    { capture: true },
  );
  const end = (e: PointerEvent) => {
    if (!open?.drawing || !world) return;
    e.stopImmediatePropagation();
    world = null;
    open.drawing = false;
    document.body.classList.remove('picking-spot');
    hint('');
    renderPattern();
    layOut();
  };
  canvas.addEventListener('pointerup', end, { capture: true });
  canvas.addEventListener('pointercancel', end, { capture: true });
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const tv = (m: THREE.Matrix4, v: V3, dir = false): V3 => {
  const out = new THREE.Vector3(...v);
  if (dir) out.transformDirection(m);
  else out.applyMatrix4(m);
  return [r3(out.x), r3(out.y), r3(out.z)];
};

/** Make every copy a real part. */
function apply() {
  const src = open && sourceLimb();
  if (!open || !src || !open.spots.length) return;
  const spots = open.spots;
  const srcParts = new Map<string, PartState>();
  for (const d of src.clip.bones) for (const id of partIds(d)) if (state.parts[id]) srcParts.set(id, state.parts[id]);
  const toFrame = src.frame.clone().invert();
  stopPattern();
  rigEdit((rig) => {
    const made: PartCopy[] = [];
    for (const s of spots) {
      // the limb moved (turned and sized) from where it is to the spot
      const m = s.bone.restGroup.clone().multiply(s.matrix).multiply(toFrame);
      const k = new THREE.Vector3().setFromMatrixScale(m).x;
      const clip: LimbClip = {
        bones: src.clip.bones.map((d): BoneDef => {
          const c: BoneDef = { ...structuredClone(d), start: tv(m, d.start), end: tv(m, d.end), side: tv(m, d.side, true), width: r3(d.width * k) };
          if (d.widthEnd !== undefined) c.widthEnd = r3(d.widthEnd * k);
          if (s.pair) c.mirror = true;
          else delete c.mirror;
          return c;
        }),
      };
      // a pair hangs off a pair as a whole, anything else off the part it's on
      const parent = s.pair && s.bone.def.sideSign !== 0 ? s.bone.def.baseId : s.bone.def.id;
      const copies = pasteLimb(rig, clip, s.bone.def.id, [0, 0, 0], parent);
      // each copy's drawing, sized to match
      for (const c of copies) {
        const from = srcParts.get(c.from) ?? srcParts.get(c.from.replace(/[LR]$/, '')) ?? [...srcParts.values()][0];
        if (!from || state.parts[c.to]) continue;
        const p = structuredClone(from);
        const grow = (l: [number, number][]) => l.map(([x, y]) => [r3(x * k), r3(y * k)] as [number, number]);
        if (p.outline) p.outline = grow(p.outline);
        for (const sh of p.more ?? []) sh.outline = grow(sh.outline);
        state.parts[c.to] = p;
      }
      made.push(...copies);
    }
    return made;
  }, true);
  hint(`${spots.length} new ${spots.length === 1 ? 'part' : 'parts'}: each one can be moved, reshaped or deleted on its own (Ctrl+Z takes them all back)`, 3200);
}

/** The pattern's options. */
function renderPattern() {
  if (!open) return;
  const o = open.opts;
  const el = $('#pattern-body');
  el.innerHTML = '';
  const path = o.where === 'path';
  const seg = <T extends string>(label: string, items: [T, string, string][], now: T, set: (v: T) => void) => {
    const t = document.createElement('div');
    t.className = 'sub-title';
    t.textContent = label;
    const s = document.createElement('div');
    s.className = 'seg scatter-seg';
    for (const [id, name, title] of items) {
      const b = document.createElement('button');
      b.className = id === now ? 'active' : '';
      b.textContent = name;
      b.title = title;
      b.onclick = () => {
        set(id);
        renderPattern();
        layOut();
      };
      s.append(b);
    }
    el.append(t, s);
  };
  const slider = (label: string, key: keyof PatternOpts, min: number, max: number, ends: [string, string], def: number) => {
    const row = document.createElement('label');
    row.className = 'slider';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '0.01';
    input.value = String(o[key]);
    input.dataset.default = String(def);
    let pending = false;
    input.oninput = () => {
      (o[key] as number) = parseFloat(input.value);
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        layOut();
      });
    };
    const name = document.createElement('span');
    name.textContent = label;
    const e = document.createElement('span');
    e.className = 'ends';
    e.innerHTML = `<em>${ends[0]}</em><em>${ends[1]}</em>`;
    row.append(name, input, e);
    el.append(row);
  };
  const check = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const row = document.createElement('label');
    row.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = get();
    box.onchange = () => {
      set(box.checked);
      layOut();
    };
    row.title = title;
    row.append(box, ` ${label}`);
    el.append(row);
  };
  // (a path goes wherever it's dragged)
  if (!path) seg('On', [['parent', 'The part it’s on', 'Spread over the part it hangs off'], ['all', 'Whole creature', 'Spread over every part (not itself)']], o.on, (v) => (o.on = v));
  const wheres: [PatternWhere, string, string][] = [
    ...SCATTER_WHERE.filter((w) => w.where !== 'paint').map((w) => [w.where, w.name, w.title] as [PatternWhere, string, string]),
    ['path', 'Along a path', 'Drag a line over the creature: they go evenly along it (down a back, round a tail)'],
  ];
  seg('Where', wheres, o.where, (v) => {
    o.where = v;
    if (v === 'path' && open!.path.length < 2) startPath();
    else if (v !== 'path') pathLine.removeFromParent();
  });
  if (path) {
    const redo = document.createElement('button');
    redo.className = 'ghost pattern-path';
    redo.innerHTML = `<i class="fa-duotone fa-regular fa-route" aria-hidden="true"></i> ${open.path.length < 2 ? 'Drag the path' : 'Drag it again'}`;
    redo.title = 'Drag along the creature where they go';
    redo.onclick = startPath;
    el.append(redo);
    slider('Smoothing', 'smooth', 0, 1, ['as drawn', 'smooth'], 0.5);
  }
  slider(path ? 'How many' : 'Amount', 'amount', 0, 1, ['few', 'lots'], 0.3);
  slider('Size', 'scale', 0.2, 1.5, ['small', 'big'], 1);
  if (path) slider('Ends', 'ends', 0, 1, ['as big', 'smaller'], 0.4);
  slider('Variety', 'vary', 0, 1, ['alike', 'mixed'], 0.2);
  if (!path) slider('Spacing', 'spacing', 0, 1.5, ['close', 'apart'], 0.6);
  slider('Upright', 'upright', 0, 1, ['out', 'up'], 0);
  if (path) check('Follow the path', 'Each one faces along the path (plates down a back); off: turned as Turn says', () => o.follow, (v) => {
    o.follow = v;
    renderPattern();
  });
  if (!path || !o.follow) slider('Turn', 'spin', 0, 1, ['alike', 'any way'], 0.15);
  slider('Lean', 'lean', 0, 1, ['straight', 'tipped'], 0.1);
  slider('Sink in', 'sink', 0, 1, ['on top', 'deep'], 0);
  const src = creature.bones.get(open.source);
  if (src && src.def.sideSign === 0) check('Mirror both sides', 'Copies off to the side come as mirrored pairs, so both sides match', () => o.mirror, (v) => (o.mirror = v));
}

export function initPattern() {
  $('#pattern-close').onclick = stopPattern;
  $('#pattern-cancel').onclick = stopPattern;
  $('#pattern-apply').onclick = apply;
  $('#pattern-shuffle').onclick = () => {
    if (!open) return;
    open.opts.seed = Math.floor(Math.random() * 1e6);
    layOut();
  };
  $('#rig-pattern').onclick = startPattern;
  initPathDrawing();
}
