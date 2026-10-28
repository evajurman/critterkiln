// ---------------------------------------------------------------------------
// My stuff: things made of parts, kept to put on any creature. A thing is a
// part kept apart from the body and everything hanging off it. Putting one on
// pastes a copy where it's dropped; each copy remembers where it came from, so
// a change to one can be put on every copy (Update everywhere), or the copy
// made its own (Unlink).

import * as THREE from 'three';
import { Creature, curveSpaceAsDrawn, partShapes, type BoneRT, type CreatureState, type PartState } from '../creature';
import { collection, setCollection, uid, type Thing } from '../stuff';
import { copyLimb, deleteLimb, expandRig, pasteLimb, subtreeDefs, type BoneDef, type ExpandedBone, type V3 } from '../rigs';
import { restFrame } from '../bend';
import { type StuffAnim } from '../animate';
import { mirrorMove } from '../animate';
import { $, fa, faClassic } from './dom';
import { camera, canvas, view } from './stage';
import { composer } from './post';
import { buildCreature, commit, creature, creatures, makeCreature, mode, selected, state, world } from './state';
import { raycaster, setRay } from './controls';
import { withCleanScene } from './snapshot';
import { invalidate } from './loop';
import { rigLocked } from './rigEdit';
import { selectPart } from './partPanel';
import { hint } from './hints';
import { pivotAtRest, thingCreature } from './stuffToParts';
import { moveLimb, scalePart } from './gizmoMode';
import { movedMarking } from '../markings';
import { queueCreationSave } from './creations';
import { carryFrom } from './carry';
import { growThingHere } from './rigEdit';
import { renderUI } from './panels';
import { editInStuff } from './focus';
import { saveBundle } from './files';
import { closeTopPopovers } from './popovers';
import { openContextMenu } from '../contextMenu';

/** A thing in My stuff: its parts, laid out as it sits on a surface (origin where it touches, Z out of the surface, Y up). */
export interface Kit {
  kit: 1;
  id: string;
  name: string;
  thumb?: string;
  /** the top one first; ids are the kit's own */
  bones: BoneDef[];
  /** by bone id */
  parts: Record<string, PartState>;
  /** the top part's move on whatever it's on (orbit, spin...), laid out the same way */
  move?: StuffAnim;
}

const ONE = new THREE.Vector3(1, 1, 1);
const FLIP_Z = new THREE.Matrix4().makeScale(1, 1, -1);
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
/** a thing grown standing out of the body (see growThingHere): it sits with its bone along the surface's normal */
const STANDING = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const r3 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e5) / 1e5) as V3;

const isKit = (x: Thing | Kit): x is Kit => (x as Kit).kit === 1 && Array.isArray((x as Kit).bones);

/** Everything in My stuff (things from before stuff was parts are made parts the first time they're read). */
export function kits(): Kit[] {
  const raw = collection() as (Thing | Kit)[];
  if (raw.every(isKit)) return raw as Kit[];
  const out = raw.map((x) => (isKit(x) ? x : kitFromThing(x)));
  setCollection(out as unknown as Thing[]);
  return out;
}

/** Add these to My stuff (old-style things made kits), leaving any already there. */
export function keepKits(items: (Thing | Kit)[]) {
  const list = kits();
  const have = new Set(list.map((k) => k.id));
  for (const x of items) {
    if (have.has(x.id)) continue;
    list.push(isKit(x) ? structuredClone(x) : kitFromThing(x));
    have.add(x.id);
  }
  writeKits(list);
}

function writeKits(list: Kit[]) {
  setCollection(list as unknown as Thing[]);
  queueCreationSave();
}

/** An old-style thing (drawn pieces) as a kit: each piece a part, where it was. */
export function kitFromThing(t: Thing): Kit {
  const c = thingCreature(t);
  return { kit: 1, id: t.id, name: t.name.trim() || 'Thing', ...(t.thumb ? { thumb: t.thumb } : {}), bones: c.rig.bones, parts: c.parts };
}

const frameOf = (d: BoneDef) => restFrame({ ...d, baseId: d.id, sideSign: 0 } as ExpandedBone).world;

/** Where a thing sits, in skeleton coordinates: from its top part's rest frame and where it sits in that. */
function sitsAt(top: BoneRT, p: PartState): THREE.Matrix4 {
  return top.restWorld.clone().multiply(p.sits ? new THREE.Matrix4().fromArray(p.sits) : STANDING);
}

function moveDefs(defs: BoneDef[], m: THREE.Matrix4): BoneDef[] {
  return defs.map((d) => ({
    ...structuredClone(d),
    start: r3(new THREE.Vector3(...d.start).applyMatrix4(m)),
    end: r3(new THREE.Vector3(...d.end).applyMatrix4(m)),
    side: r3(new THREE.Vector3(...d.side).transformDirection(m)),
  }));
}

/** A move laid out by `m` (from one frame to another): its centre a point, its line a direction (Bob's a vector). */
function moveMove(a: StuffAnim, m: THREE.Matrix4): StuffAnim {
  const axis = new THREE.Vector3(...a.axis);
  const out = a.kind === 'bob' ? axis.applyMatrix4(new THREE.Matrix4().extractRotation(m)) : axis.transformDirection(m);
  // mirrored, a turn goes the other way round (its line is turned, not moved, by a mirror)
  if (a.kind !== 'bob' && m.determinant() < 0) out.negate();
  return { ...structuredClone(a), center: r3(new THREE.Vector3(...a.center).applyMatrix4(m)), axis: r3(a.kind === 'bob' ? out : out.normalize()) };
}

/** The scene id holding a part's look (a right twin shares its left twin's). */
const partKey = (s: CreatureState, id: string) => (s.parts[id] ? id : id.replace(/R$/, 'L'));

/**
 * The top of the thing a part belongs to: going up while parts are kept apart
 * from the body (null if this part isn't kept apart). The left one of a pair.
 */
export function thingTop(c: Creature, id: string): BoneRT | null {
  let b = c.bones.get(id);
  const apart = (o: BoneRT) => !!c.state.parts[o.src]?.apart;
  if (!b || !apart(b)) return null;
  while (b.parent && apart(b.parent)) b = b.parent;
  return b.def.sideSign === -1 ? (c.twinOf(b) ?? b) : b;
}

/** A thing on a creature as a kit (its own id, or `id`). */
export function kitFromThingOn(c: Creature, top: BoneRT, id = uid()): Kit | null {
  const s = c.state;
  const clip = copyLimb(s.rig, top.def.id);
  if (!clip) return null;
  const toKit = sitsAt(top, s.parts[top.src]).invert();
  const bones = moveDefs(clip.bones, toKit).map((d) => {
    delete d.mirror;
    return d;
  });
  delete bones[0].parent;
  const parts: Record<string, PartState> = {};
  for (const d of clip.bones) {
    const p = s.parts[d.mirror ? d.id + 'L' : d.id];
    if (!p) continue;
    const q = structuredClone(p);
    delete q.link;
    // its markings laid out as it sits, like its bones
    if (q.markings) q.markings = q.markings.map((mk) => movedMarking(mk, toKit));
    parts[d.id] = q;
  }
  const move = s.moves?.[top.def.id];
  return {
    kit: 1,
    id,
    name: top.def.name.replace(/ \((L|R)\)$/, '') || 'Thing',
    bones,
    parts,
    ...(move && top.parent ? { move: moveMove(move, toKit.clone().multiply(pivotAtRest(top.parent))) } : {}),
  };
}

/**
 * Put a kit on creature state `s` (its live creature `c`), sitting at `at` (skeleton
 * coordinates), hanging off `on`; as a mirrored pair with `pair`. Returns its top part's scene id.
 */
function placeKit(c: Creature, kit: Kit, at: THREE.Matrix4, on: BoneRT, pair: boolean): string | null {
  const s = c.state;
  // made on the -X side, a pair is defined by its +X twin: the mirror image (its frame turned so it stays a turn)
  const onMinus = pair && (on.def.sideSign !== 0 ? on.def.sideSign === -1 : new THREE.Vector3().setFromMatrixPosition(at).x < 0);
  // (where its points go: mirrored, maybe; the parts' own frames stay turns, see restFrame)
  const place = onMinus ? MIRROR_X.clone().multiply(at) : at.clone();
  const mirrored = place.determinant() < 0;
  const host = onMinus && on.def.sideSign === -1 ? (c.twinOf(on) ?? on) : on;
  const bones = moveDefs(kit.bones, place).map((d) => (pair ? { ...d, mirror: true } : d));
  const parent = pair && on.def.sideSign !== 0 ? on.def.baseId : on.def.id;
  const copies = pasteLimb(s.rig, { bones }, on.def.id, [0, 0, 0], parent);
  if (!copies.length) return null;
  // each copy's own group, so two copies touching don't blend into each other
  const groups = new Map<string, string>();
  const top = copies[0].to;
  for (const cp of copies) {
    const from = kit.parts[cp.from.replace(/[LR]$/, '')] ?? kit.parts[cp.from];
    if (!from || s.parts[cp.to]) continue;
    const p = structuredClone(from);
    if (typeof p.apart === 'string') {
      if (!groups.has(p.apart)) groups.set(p.apart, `${top}-${groups.size + 1}`);
      p.apart = groups.get(p.apart);
    }
    // its markings go with it
    if (p.markings) p.markings = p.markings.map((mk) => movedMarking(mk, place));
    // a mirror image curves (and wraps) the mirror image's way (see curveSpaceOf)
    if (mirrored && (p.curve || p.wrap)) {
      const sp = curveSpaceAsDrawn(p, partShapes(p));
      p.thingSpace = { m: sp.m.multiply(FLIP_Z).toArray(), reach: sp.reach, wrapReach: sp.wrapReach };
    }
    s.parts[cp.to] = p;
  }
  // where it sits, as its top part sees it
  const topDef = expandRig(s.rig).bones.find((b) => b.id === top);
  if (topDef && s.parts[top]) s.parts[top].sits = restFrame(topDef).world.invert().multiply(place).toArray();
  if (kit.move) {
    const moves = (s.moves ??= {});
    const local = moveMove(kit.move, pivotAtRest(host).invert().multiply(place));
    if (!pair) moves[top] = local;
    else {
      const base = top.replace(/L$/, '');
      moves[base + 'L'] = local;
      // hanging off a pair, each side's frame is the other's mirror image already; off a middle part, mirror it
      moves[base + 'R'] = on.def.sideSign !== 0 ? structuredClone(local) : mirrorMove(local);
    }
  }
  return top;
}

/** Where a thing would sit at the spot under `at` (or the front of the picked part as the camera sees it): the part and the frame. */
function spotFor(at?: { x: number; y: number }): { on: BoneRT; frame: THREE.Matrix4 } | null {
  let hit = null;
  if (at) {
    setRay(at.x, at.y);
    hit = creature.surfaceAt(raycaster);
  }
  const picked = creature.bones.get(selected);
  if (!hit && picked) hit = creature.surfaceFacing(picked, camera.position);
  if (!hit) return null;
  const on = hit.bone;
  // in skeleton coordinates: the spot, facing out of the surface, upright (on top of something: facing the creature's front)
  const toSkel = pivotAtRest(on).multiply(on.pivot.matrixWorld.clone().invert());
  const point = hit.point.clone().applyMatrix4(toSkel);
  const out = hit.normal.clone().transformDirection(toSkel).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let y = up.clone().addScaledVector(out, -up.dot(out));
  if (y.lengthSq() < 0.05) y = new THREE.Vector3(0, 0, -1).addScaledVector(out, out.z);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, out);
  return { on, frame: new THREE.Matrix4().makeBasis(x, y, out).setPosition(point) };
}

/** How big a kit is across (its bones' ends and widths). */
function kitSize(kit: Kit): number {
  const box = new THREE.Box3();
  for (const d of kit.bones) {
    for (const p of [d.start, d.end]) box.expandByPoint(new THREE.Vector3(...p));
  }
  return box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length() + Math.max(...kit.bones.map((d) => d.width));
}

/** A kit at `k` times its size (its parts' drawings with it). */
function scaledKit(kit: Kit, k: number): Kit {
  const m = new THREE.Matrix4().makeScale(k, k, k);
  const out = structuredClone(kit);
  out.bones = moveDefs(kit.bones, m).map((d) => ({ ...d, width: d.width * k, ...(d.widthEnd !== undefined ? { widthEnd: d.widthEnd * k } : {}) }));
  // (moveDefs turns `side` by a scaled matrix: still the same way)
  for (const p of Object.values(out.parts)) scalePart(p, k);
  if (out.move) out.move = moveMove(out.move, m);
  return out;
}

/** The picked thing (its top part and everything on it) bigger or smaller, about where it sits. */
let sizeCommit = 0;
export function scaleThing(top: BoneRT, k: number) {
  const def = state.rig.bones.find((d) => d.id === top.def.baseId);
  if (!def) return;
  const o = new THREE.Vector3(...def.start);
  moveLimb(top, new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z)), k);
  buildCreature();
  hint(k > 1 ? 'Bigger' : 'Smaller', 900);
  clearTimeout(sizeCommit);
  sizeCommit = window.setTimeout(() => commit(), 400);
}

/** Put a kit on the active creature where it's dropped (or on the picked part), linked to My stuff. */
export function putOn(kit: Kit, at?: { x: number; y: number }) {
  const spot = spotFor(at);
  if (!spot) {
    hint('Pick a part to put it on, or drag it onto the spot', 2400, true);
    return;
  }
  // much bigger than the part it goes on (a hat on a finger): sized to it
  const size = kitSize(kit);
  const room = spot.on.def.width * 2.5;
  const fit = size > room * 1.6 ? room / size : 1;
  if (fit < 1) kit = scaledKit(kit, fit);
  // on one of a pair with Mirror on: on both
  const pair = rigLocked() && !!creature.twinOf(spot.on);
  const top = placeKit(creature, kit, spot.frame, spot.on, pair);
  if (!top) return;
  state.parts[top].link = kit.id;
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  commit();
  selectPart(top);
  $('#attach-pop').hidden = true;
  hint(fit < 1 ? 'Sized to fit the part: the Scale handles (on the view cube) change it' : 'It’s parts now: draw, shape and color them like any other', 3200);
}

/** A picture of a thing on the creature, just it. */
function thingThumb(top: BoneRT): string {
  const ids = new Set<string>();
  const add = (b: BoneRT) => {
    ids.add(b.def.id);
    const twin = creature.twinOf(b);
    if (twin) ids.add(twin.def.id);
    for (const o of creature.list) if (o.parent === b) add(o);
  };
  add(top);
  const box = new THREE.Box3();
  for (const id of ids) {
    const m = creature.bones.get(id)?.mesh;
    if (m) box.expandByObject(m);
  }
  if (box.isEmpty()) return '';
  const shown = creatures.map((c) => c.root.visible);
  for (const c of creatures) if (c !== creature) c.root.visible = false;
  try {
    return creature.withOnly(ids, () => snapThumb(box));
  } finally {
    creatures.forEach((c, i) => (c.root.visible = shown[i]));
  }
}

/** Render a clean frame and crop a small square round `box` as the camera sees it. */
export function snapThumb(box: THREE.Box3, size = 160): string {
  if (box.isEmpty()) return '';
  camera.updateMatrixWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const v = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(view);
    const px = ((v.x + 1) / 2) * canvas.width;
    const py = ((1 - v.y) / 2) * canvas.height;
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  const side = Math.min(Math.max(x1 - x0, y1 - y0) * 1.15, canvas.width, canvas.height);
  const sx = THREE.MathUtils.clamp((x0 + x1) / 2 - side / 2, 0, canvas.width - side);
  const sy = THREE.MathUtils.clamp((y0 + y1) / 2 - side / 2, 0, canvas.height - side);
  const url = withCleanScene(() => {
    composer.render();
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')!.drawImage(canvas, sx, sy, side, side, 0, 0, size, size);
    return out.toDataURL('image/jpeg', 0.82);
  });
  invalidate();
  return url;
}


/** A kit as a key to compare by: its shape and looks, numbers rounded past what a round trip through placing it moves them. */
function kitKey(k: Kit): string {
  return JSON.stringify({ bones: k.bones, parts: k.parts, move: k.move }, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
}

/** What each set of linked duplicates looked like last time (by link id). */
const linkedLooks = new Map<string, string>();
let syncing = false;

/**
 * Linked duplicates stay the same: after a change, a copy that's now unlike
 * the rest (the one just changed: the picked one, if several) is put on every
 * other copy, where each one is, and in My stuff if it's kept there. Called
 * as every change is kept (see commit), so it's one step to undo.
 */
export function syncLinked() {
  if (syncing) return;
  // every thing that's been drawn is kept in My stuff: one that's new to it gets its own entry
  world.creatures.forEach((s, i) => {
    const c = creatures[i];
    if (!c) return;
    for (const b of c.list) {
      if (b.def.sideSign === -1 || thingTop(c, b.def.id) !== b) continue;
      const p = s.parts[b.src];
      if (!p.link && drawnBelow(c, b)) p.link = uid();
    }
  });
  const groups = new Map<string, { i: number; top: string }[]>();
  world.creatures.forEach((s, i) => {
    for (const [k, p] of Object.entries(s.parts)) if (p.link && creatures[i]?.bones.has(k)) (groups.get(p.link) ?? groups.set(p.link, []).get(p.link)!).push({ i, top: k });
  });
  for (const [id, copies] of groups) {
    if (kits().some((k) => k.id === id)) continue;
    const c = copies.find((x) => world.creatures[x.i] === state) ?? copies[0];
    const b = creatures[c.i].bones.get(c.top)!;
    const kit = kitFromThingOn(creatures[c.i], b, id);
    if (!kit) continue;
    if (world.creatures[c.i] === state) kit.thumb = thingThumb(b);
    writeKits([...kits(), kit]);
  }
  for (const [id, copies] of groups) {
    const keyed = copies.map((c) => {
      const b = creatures[c.i].bones.get(c.top)!;
      const kit = kitFromThingOn(creatures[c.i], b, id);
      return { ...c, kit, key: kit ? kitKey(kit) : '' };
    });
    const was = linkedLooks.get(id);
    const changed = keyed.filter((c) => c.key !== was);
    if (was === undefined || !changed.length) {
      linkedLooks.set(id, keyed[0].key);
      continue;
    }
    const picked = (c: (typeof keyed)[number]) => world.creatures[c.i] === state && thingTop(creature, selected)?.def.id === c.top;
    const from = changed.find(picked) ?? changed[0];
    linkedLooks.set(id, from.key);
    if (!from.kit) continue;
    const others = keyed.filter((c) => c.key !== from.key);
    // (the one in My stuff too: a new picture when it was changed here, on the creature being edited)
    const kept = kits().find((k) => k.id === id);
    if (kept && kitKey(kept) !== from.key) {
      const here = world.creatures[from.i] === state ? creature.bones.get(from.top) : undefined;
      const thumb = here ? thingThumb(here) || kept.thumb : kept.thumb;
      writeKits(kits().map((k) => (k.id === id ? { ...from.kit!, name: k.name, thumb } : k)));
    }
    if (!others.length) continue;
    syncing = true;
    try {
      replaceCopies(from.kit, others);
    } finally {
      syncing = false;
    }
  }
}

/** Swap these copies for `kit`, each where it sits, and rebuild the creatures they're on. */
function replaceCopies(kit: Kit, copies: { i: number; top: string }[]) {
  const touched = new Set<number>();
  for (const { i, top } of copies) {
    const c = creatures[i];
    const s = world.creatures[i];
    const b = c.bones.get(top);
    const on = b?.parent;
    if (!b || !on) continue;
    const at = sitsAt(b, s.parts[top]);
    const pair = !!b.def.mirror || b.def.sideSign !== 0;
    // the old copy goes (and its looks and moves), the kit as it is now goes where it was
    for (const d of deleteLimb(s.rig, top)) for (const k of [d.id, d.id + 'L', d.id + 'R']) {
      delete s.parts[k];
      delete s.moves?.[k];
    }
    const made = placeKit(c, kit, at, on, pair);
    if (made) s.parts[made].link = kit.id;
    touched.add(i);
  }
  for (const i of touched) {
    if (world.creatures[i] === state) buildCreature();
    else {
      creatures[i].dispose();
      creatures[i] = makeCreature(world.creatures[i]);
    }
  }
}

/**
 * Copying a thing (a part kept apart from the body, at the top): a linked
 * duplicate, or a copy of its own. Asks at (x, y), then `go(linked)`.
 */
export function chooseCopy(x: number, y: number, go: (linked: boolean) => void) {
  openContextMenu(x, y, 'Copy it as', [
    { label: 'Linked duplicate', icon: 'fa-duotone fa-regular fa-link', note: 'Change one and every linked copy changes too: its shape, colors and markings (each stays where it is)', run: () => go(true) },
    { label: 'Unique copy', icon: 'fa-duotone fa-regular fa-clone', note: 'A copy of its own, to change on its own', run: () => go(false) },
  ]);
}

/** A kit put on the table's top (`table`, the table creature's one part): standing up on it, facing the front; linked to the kit. */
export function putOnTable(c: Creature, kit: Kit, table: BoneRT): string | null {
  // its Z (out of the surface) up, its Y (up, as it sat) away from the front
  const at = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  const top = placeKit(c, kit, at, table, false);
  if (top) c.state.parts[top].link = kit.id;
  return top;
}

/** The My stuff entry for a thing on the creature being edited (kept there now if it wasn't). */
export function kitOf(top: BoneRT): Kit | null {
  commit();
  const id = state.parts[top.src]?.link;
  return (id && kits().find((k) => k.id === id)) || null;
}

/** Every linked duplicate sharing `id`, in each creature: the scene ids of their top parts. */
export function linkedCopies(id: string): { i: number; top: string }[] {
  return world.creatures.flatMap((s, i) => Object.entries(s.parts).filter(([k, p]) => p.link === id && creatures[i]?.bones.has(k)).map(([k]) => ({ i, top: k })));
}


/** This duplicate goes its own way: changes to it stay on it (and the others no longer follow it). */
export function unlink(top: BoneRT) {
  delete state.parts[top.src].link;
  commit();
  renderUI();
  hint('Its own now: changes stay on this one', 1800);
}

/** Whether a thing has anything drawn yet (its top part, or anything on it). */
function drawnBelow(c: Creature, top: BoneRT): boolean {
  const stack = [top];
  while (stack.length) {
    const b = stack.pop()!;
    if (c.state.parts[b.src]?.outline) return true;
    stack.push(...c.list.filter((o) => o.parent === b));
  }
  return false;
}

/** A thing's link, made if it hasn't one (its duplicates share it). */
export function linkOf(top: BoneRT): string {
  const p = state.parts[top.src];
  if (!p.link) p.link = uid();
  return p.link;
}

/** My stuff, open. */
export function showMyStuff() {
  closeTopPopovers();
  $('#attach-pop').hidden = false;
  renderMyStuff();
}

export function initMyStuff() {
  $('#attach-pop-close').onclick = () => ($('#attach-pop').hidden = true);
  $('#rig-attach').onclick = () => showMyStuff();
}

/** My stuff: things to put on the picked part (click, or drag one onto the creature), or (the Stuff tab) to put on the bench; or something new. */
export function renderMyStuff() {
  const bench = mode === 'stuff';
  const top = $('#attach-actions');
  top.replaceChildren();
  const action = (icon: string, label: string, title: string, run: () => void) => {
    const b = document.createElement('button');
    b.className = 'stuff-new';
    b.innerHTML = `${faClassic(icon)}<span>${label}</span>`;
    b.title = title;
    b.onclick = () => {
      $('#attach-pop').hidden = true;
      run();
    };
    top.append(b);
  };
  action('pencil', 'Draw new', bench ? 'Something new, on its own on the blueprint' : 'A new part on the picked one, kept apart from the body, drawn like any part', () => (bench ? editInStuff(null) : growThingHere()));
  if (!bench) action('briefcase', 'Make in Stuff', 'Make something on its own, on the blueprint in the Stuff tab: a hat, a sword… It goes in My stuff', () => editInStuff(null));
  $('#attach-hint').textContent = bench ? 'Pick one to change it here: every creature wearing it follows.' : 'Click one to put it on the picked part, or drag it onto a spot.';
  const el = $('#attach-options');
  el.replaceChildren();
  const list = kits();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'muted small stuff-empty';
    p.textContent = 'Nothing here yet: anything you make that’s kept apart from the body shows up here by itself.';
    el.append(p);
    return;
  }
  for (const k of list) {
    const card = document.createElement('div');
    card.className = 'stuff-card carry';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = bench ? `${k.name}: change it here` : `${k.name}: put it on (or drag it onto a spot)`;
    const thumb = document.createElement('div');
    thumb.className = 'stuff-thumb';
    thumb.innerHTML = k.thumb ? `<img src="${k.thumb}" alt="" draggable="false" />` : fa('box');
    const name = document.createElement('div');
    name.className = 'stuff-name';
    name.textContent = k.name;
    thumb.append(kitActions(k));
    card.append(thumb, name);
    const go = () => {
      $('#attach-pop').hidden = true;
      if (bench) editInStuff(k);
      else putOn(k);
    };
    card.onclick = go;
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    };
    carryFrom(card, () => k, () => (k.thumb ? `<img src="${k.thumb}" alt="" />` : fa('box')));
    el.append(card);
  }
}

/** A card's own buttons, over its picture: change it in Stuff, copy, download, take it out. */
function kitActions(k: Kit): HTMLElement {
  const box = document.createElement('div');
  box.className = 'stuff-tools';
  const act = (icon: string, title: string, run: () => void, danger = false) => {
    const b = document.createElement('button');
    b.className = 'stuff-tool' + (danger ? ' danger' : '');
    b.innerHTML = fa(icon);
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = (e) => {
      // (the card itself puts it on)
      e.stopPropagation();
      run();
    };
    // (and pressing here doesn't start carrying it)
    b.onpointerdown = (e) => e.stopPropagation();
    box.append(b);
  };
  if (mode !== 'stuff') {
    act('pencil', 'Change it in Stuff, on its own (every copy follows)', () => {
      $('#attach-pop').hidden = true;
      editInStuff(k);
    });
  }
  act('copy', 'Make a copy of its own', () => {
    writeKits([...kits(), { ...structuredClone(k), id: uid(), name: `${k.name} copy` }]);
    renderMyStuff();
  });
  act('arrow-down-to-line', 'Download it (a file that opens straight into My stuff)', () => saveBundle({ creatures: [], stuff: [k], rigs: [] }, k.name || 'thing'));
  act('trash', 'Take it out of My stuff (what’s already worn stays)', () => {
    writeKits(kits().filter((x) => x.id !== k.id));
    renderMyStuff();
  }, true);
  return box;
}
