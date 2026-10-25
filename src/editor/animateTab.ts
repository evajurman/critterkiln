// ---------------------------------------------------------------------------
// The Animate tab (proof of concept): looping motions on parts, see src/animate.ts.

import * as THREE from 'three';
import { Creature, type Attachment, type BoneRT } from '../creature';
import {
  ANIM_KINDS,
  animOffset,
  animP,
  canReverse,
  defaultAnim,
  leanAt,
  leanOf,
  leanQuat,
  mirrorAnim,
  reachAt,
  reachRim,
  rimLean,
  orbitOut,
  STUFF_KINDS,
  stuffMove,
  stuffP,
  type PartAnim,
  type StuffAnim,
  type StuffKind,
} from '../animate';
import { type V3 } from '../rigs';
import { $, faClassic, iconLabel } from './dom';
import { renderer, rim, scene, view, viewport } from './stage';
import { commit, creature, creatures, idle, mode, selected, state, world } from './state';
import { raycaster } from './controls';
import { renderCreatureBar } from './creatureBar';
import { selectPart } from './partPanel';
import { rigLocked } from './rigEdit';
import { hint } from './hints';
import { invalidate } from './loop';
import { animRendering } from './animGif';

// The picked part's motion is drawn in the view: a dotted loop where its tip
// will go, arrows for which way, a dot riding it now, and two handles. The
// middle one moves the whole motion; the edge one sets how big and which way.
//
// TODO(anim): tests; a keyboard shortcut for the tab; animate-based custom tabs
// (only the built-in Animate tab plays); GIF export is Render GIF, below;
// eyes/stuff don't puff with Breathe; a playing loop re-fuses joins every frame;
// dragging a handle on a curved part is only approximate (it aims the bone's
// straight line); the handles have no hover cursor.

// (plain var/function: commit() and renderUI() can ask before this part of the file has run)
export var ANIM_TAB = 'animate' as const;
export let animPlaying = true;
export function setAnimPlaying(v: typeof animPlaying) {
  animPlaying = v;
}
/** where in the loop we are, 0..1 */
export let animT = 0;
export function setAnimT(v: typeof animT) {
  animT = v;
}
let animLast = 0;
export let animKey = '';
export function setAnimKey(v: typeof animKey) {
  animKey = v;
}
export const animSecs = () => world.animSecs ?? 1.5;
export function animOn() {
  return mode === ANIM_TAB;
}
export const animMoving = () => animOn() && animPlaying && creatures.some((c) => c.state.anims && Object.keys(c.state.anims).length);

export function tickAnim(now: number) {
  const dt = animLast ? Math.min(100, now - animLast) : 0;
  animLast = now;
  if (!animOn()) {
    if (animKey) {
      animKey = '';
      for (const c of creatures) {
        c.setAnim(null);
        c.setStuffAnim(null);
        c.applyPose();
      }
      animViz.visible = false;
      invalidate();
    }
    return;
  }
  // a GIF being rendered poses each frame itself
  if (animRendering) return;
  if (animPlaying) animT = (animT + dt / 1000 / animSecs()) % 1;
  showAnimAt(animT);
  drawAnimPath();
  const time = $<HTMLInputElement>('#anim-time');
  if (document.activeElement !== time) time.value = String(animT);
}

/** Every creature as it is at loop time `t` (only redone when something changed). */
export function showAnimAt(t: number) {
  const key = t + JSON.stringify(creatures.map((c) => [c.state.anims ?? null, (c.state.attachments ?? []).map((x) => x.anim ?? null)]));
  if (key === animKey) return;
  animKey = key;
  for (const c of creatures) {
    c.tickScatter(t * animSecs(), animSecs());
    const moving = (c.state.attachments ?? []).filter((x) => x.anim);
    c.setStuffAnim(moving.length ? new Map(moving.map((x) => [x.id, stuffMove(x.anim!, stuffP(x.anim!, t), c.stuffFrame(x.id)?.center)])) : null);
    const list = Object.entries(c.state.anims ?? {}).filter(([id]) => c.bones.has(id));
    const reach = list.filter(([id, a]) => reaching(c, id, a));
    const swing = list.filter((e) => !reach.includes(e));
    // back to the plain pose first (reaching bends parts outside the motions), and
    // measure where each reaching tip rests: in the creature's own space, so a
    // planted foot stays put however the body above it moves
    c.setAnim(null);
    c.applyPose();
    if (reach.length) {
      c.root.updateMatrixWorld(true);
      restTips.set(c, new Map(reach.map(([id]) => [id, c.root.worldToLocal(c.bones.get(id)!.tip.getWorldPosition(new THREE.Vector3()))])));
    }
    c.setAnim(swing.length ? new Map(swing.map(([id, a]) => [id, animOffset(a, t)])) : null);
    if (reach.length) {
      c.root.updateMatrixWorld(true);
      for (const [id, a] of reach) {
        const rest = restTips.get(c)!.get(id)!;
        c.dragTip(id, c.root.localToWorld(rest.clone().add(reachAt(a, animP(a, t), reachLen(c, id)))), true);
      }
    }
  }
  invalidate(1);
}

/** The parts that bend when `id` reaches: it and the ones above it, as Pull limbs picks them. None if nothing above it can bend. */
function reachChain(c: Creature, id: string): BoneRT[] {
  const b = c.bones.get(id);
  if (!b) return [];
  const chain = [b];
  const branches = (p: BoneRT) => c.list.filter((o) => o.parent === p).length > 1;
  for (let p = b.parent; p && !p.def.anchor && !branches(p); p = p.parent) chain.push(p);
  return chain.length > 1 ? chain : [];
}
const reaching = (c: Creature, id: string, a: PartAnim) => a.kind !== 'breathe' && a.reach !== false && reachChain(c, id).length > 0;
/** how far a reaching part can reach: the parts that bend, end to end */
const reachLen = (c: Creature, id: string) => reachChain(c, id).reduce((n, b) => n + b.length, 0);
/** where each reaching tip rests, in its creature's own space (measured with no motion on) */
const restTips = new WeakMap<Creature, Map<string, THREE.Vector3>>();

function selAnim(): PartAnim | undefined {
  return state.anims?.[selected];
}

/** the piece of stuff being animated (picked in the view or from the panel), instead of the part */
let animStuff = '';
function selStuff(): Attachment | undefined {
  return animStuff ? state.attachments?.find((x) => x.id === animStuff) : undefined;
}
/** The stuff on the picked part (a mirrored item shows on its twin part too). */
function stuffHere(): Attachment[] {
  return (state.attachments ?? []).filter((x) => {
    if (x.bone === selected) return true;
    const b = creature.bones.get(x.bone);
    return x.mirror && !!b && creature.mirrorBoneOf(b)?.def.id === selected;
  });
}
export function pickAnimStuff(id: string) {
  const a = state.attachments?.find((x) => x.id === id);
  if (!a) return;
  if (creature.bones.has(a.bone) && (selected !== a.bone || idle)) selectPart(a.bone, false);
  animStuff = id;
  renderAnim();
}

/** A fresh motion for a piece of stuff: its handles start somewhere that makes sense for the kind. */
function freshStuffAnim(kind: StuffKind, x: Attachment, keep?: StuffAnim): StuffAnim {
  const f = creature.stuffFrame(x.id)!;
  const up = creature.upIn(x.bone);
  const v = (w: THREE.Vector3) => w.toArray().map((n) => Math.round(n * 1000) / 1000) as V3;
  const base = { kind, size: kind === 'swing' ? 20 : kind === 'pulse' ? 15 : 25, speed: keep?.speed ?? 1, phase: keep?.phase ?? 0, reverse: keep?.reverse };
  switch (kind) {
    case 'orbit': {
      // round the nearest other stuff on the same part (stars round a ring), about the way it faces; or round the part
      const others = (state.attachments ?? []).filter((o) => o.id !== x.id && o.bone === x.bone).map((o) => creature.stuffFrame(o.id)).filter((o) => !!o);
      const near = others.sort((p, q) => p.center.distanceTo(f.center) - q.center.distanceTo(f.center))[0];
      return near ? { ...base, center: v(near.center), axis: v(near.normal) } : { ...base, center: v(new THREE.Vector3(0, f.center.y, 0)), axis: [0, 1, 0] };
    }
    case 'spin':
      return { ...base, center: v(f.center), axis: v(f.normal) };
    case 'swing':
      return { ...base, center: v(f.origin), axis: v(f.side) };
    case 'bob':
      return { ...base, center: v(f.center), axis: v(up.multiplyScalar(f.size * 0.25)) };
    case 'pulse':
      return { ...base, center: v(f.center), axis: v(up) };
  }
}

/** The motion being edited (the stuff's, or the part's), and a way to change it. */
function curMotion(): { speed: number; phase: number; size: number } | undefined {
  return selStuff()?.anim ?? selAnim();
}
function patchMotion(p: Partial<StuffAnim & PartAnim>) {
  const x = selStuff();
  if (x) {
    if (x.anim) x.anim = { ...x.anim, ...p } as StuffAnim;
    return;
  }
  const a = selAnim();
  if (a) setAnim({ ...a, ...p } as PartAnim);
}

/** Change the picked part's motion (and its twin's, with Mirror on), or take it away. */
function setAnim(a: PartAnim | null) {
  const anims = (state.anims ??= {});
  const b = creature.bones.get(selected);
  const twin = b && rigLocked() ? creature.twinOf(b) : null;
  const was = anims[selected]?.kind;
  if (a) anims[selected] = a;
  else delete anims[selected];
  if (twin && twin !== b) {
    // the twin is worked out from this side, so its timing stays half a loop off when walking
    if (a) anims[twin.def.id] = mirrorAnim(a);
    else delete anims[twin.def.id];
  }
  if (!Object.keys(anims).length) delete state.anims;
  // the parts list shows which parts move
  if (a?.kind !== was) renderCreatureBar();
}

export function renderAnim() {
  const b = idle ? undefined : creature.bones.get(selected);
  // the stuff on this part, to animate instead of the part
  const here = b ? stuffHere() : [];
  if (animStuff && !here.some((x) => x.id === animStuff)) animStuff = '';
  const chips = $('#anim-stuff');
  chips.hidden = !here.length;
  chips.replaceChildren(
    ...[null, ...here].map((x) => {
      const btn = document.createElement('button');
      btn.className = 'anim-chip';
      btn.classList.toggle('active', (x?.id ?? '') === animStuff);
      btn.innerHTML = x ? `<i class="fa-slab-duo fa-regular fa-paperclip" aria-hidden="true"></i> ${(x.thing.name || 'Stuff').replace(/[&<>"]/g, '')}${x.anim ? ' •' : ''}` : 'This part';
      btn.title = x ? 'Animate this piece of stuff' : 'Animate the part itself';
      btn.onclick = () => {
        animStuff = x?.id ?? '';
        renderAnim();
      };
      return btn;
    }),
  );
  const stuff = selStuff();
  if (stuff) return renderStuffAnim(stuff);
  const a = selAnim();
  // Swing only goes back and forth, and Breathe stays put: neither has a way round
  $('#anim-reverse-row').hidden = !a || !canReverse(a.kind);
  $<HTMLInputElement>('#anim-reverse').checked = !!a?.reverse;
  $('#anim-kinds').replaceChildren(
    ...[{ kind: null, name: 'Still', icon: 'pause', title: 'No motion on this part' }, ...ANIM_KINDS].map((k) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<i class="fa-duotone fa-regular fa-${k.icon}" aria-hidden="true"></i>${k.name}`;
      btn.title = k.title;
      btn.classList.toggle('active', (a?.kind ?? null) === k.kind);
      btn.disabled = !b;
      btn.onclick = () => {
        // switching motion keeps its size, place and timing
        // a fresh motion on a part that bends a knee: a stride the leg can reach
        const fresh = k.kind ? { ...defaultAnim(k.kind), ...(k.kind !== 'breathe' && reachChain(creature, selected).length ? { size: 14 } : {}) } : null;
        // a motion with no way round drops Reverse, so it can't come back unseen later
        setAnim(k.kind ? (a ? { ...a, kind: k.kind, size: k.kind === 'breathe' || a.kind === 'breathe' ? fresh!.size : a.size, reverse: canReverse(k.kind) ? a.reverse : undefined } : fresh) : null);
        renderAnim();
        commit();
      };
      return btn;
    }),
  );
  $('#anim-opts').hidden = !a || !b;
  if (a) {
    $('#anim-size-row').hidden = a.kind !== 'breathe';
    $<HTMLInputElement>('#anim-size').max = '40';
    $<HTMLInputElement>('#anim-size').value = String(a.size);
    $<HTMLInputElement>('#anim-phase').value = String(a.phase);
    $<HTMLInputElement>('#anim-opposite').checked = !!a.opposite;
    for (const s of $('#anim-speed').querySelectorAll<HTMLButtonElement>('button')) s.classList.toggle('active', Number(s.dataset.speed) === a.speed);
    $<HTMLInputElement>('#anim-reach').checked = a.reach !== false;
  }
  const canReach = !!b && reachChain(creature, selected).length > 0;
  $('#anim-reach-row').hidden = !canReach || !a || a.kind === 'breathe';
  // an unlinked pair has no twin: its sides are timed with Timing instead
  const twin = b ? creature.twinOf(b) : null;
  const paired = !!twin && twin !== b;
  $('#anim-opposite-row').hidden = !paired || !rigLocked();
  renderLoopBar();
}

function renderLoopBar() {
  iconLabel($('#anim-play'), faClassic(animPlaying ? 'pause' : 'play'), animPlaying ? 'Pause' : 'Play');
  $<HTMLInputElement>('#anim-secs').value = String(animSecs());
  $<HTMLButtonElement>('#anim-clear').disabled = !creatures.some((c) => (c.state.anims && Object.keys(c.state.anims).length) || c.state.attachments?.some((x) => x.anim));
}

/** The panel for a piece of stuff's motion. */
function renderStuffAnim(x: Attachment) {
  const a = x.anim;
  $('#anim-kinds').replaceChildren(
    ...[{ kind: null, name: 'Still', icon: 'pause', title: 'No motion on this piece of stuff' }, ...STUFF_KINDS].map((k) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<i class="fa-duotone fa-regular fa-${k.icon}" aria-hidden="true"></i>${k.name}`;
      btn.title = k.title;
      btn.classList.toggle('active', (a?.kind ?? null) === k.kind);
      btn.onclick = () => {
        x.anim = k.kind ? freshStuffAnim(k.kind, x, a) : undefined;
        renderAnim();
        commit();
      };
      return btn;
    }),
  );
  $('#anim-opts').hidden = !a;
  $('#anim-reach-row').hidden = $('#anim-opposite-row').hidden = true;
  if (a) {
    const sized = a.kind === 'swing' || a.kind === 'pulse';
    $('#anim-size-row').hidden = !sized;
    $<HTMLInputElement>('#anim-size').max = a.kind === 'swing' ? '90' : '60';
    $<HTMLInputElement>('#anim-size').value = String(a.size);
    $<HTMLInputElement>('#anim-phase').value = String(a.phase);
    $('#anim-reverse-row').hidden = a.kind !== 'orbit' && a.kind !== 'spin';
    $<HTMLInputElement>('#anim-reverse').checked = !!a.reverse;
    for (const s of $('#anim-speed').querySelectorAll<HTMLButtonElement>('button')) s.classList.toggle('active', Number(s.dataset.speed) === a.speed);
  }
  renderLoopBar();
}

// ---- the motion, drawn in the view ----

export const animViz = new THREE.Group();
animViz.visible = false;
animViz.renderOrder = 999;
const vizMat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
const PATH_COLOR = 0xb44dff;
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: PATH_COLOR, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 1, depthTest: false }));
/** a dark line under the dashes: the path reads on a light backdrop as well as a dark one */
const pathUnder = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1b1030, transparent: true, opacity: 0.55, depthTest: false }));
const spokeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe0609a, transparent: true, opacity: 0.8, depthTest: false }));
const ball = new THREE.SphereGeometry(1, 16, 12);
const rider = new THREE.Mesh(ball, vizMat(PATH_COLOR));
const centerHandle = new THREE.Mesh(ball, vizMat(0x3b82f6));
const rimHandle = new THREE.Mesh(ball, vizMat(0xe0609a));
const arrowGeo = new THREE.ConeGeometry(0.5, 1.4, 12);
const arrows = [0, 1, 2, 3].map(() => new THREE.Mesh(arrowGeo, vizMat(PATH_COLOR)));
pathUnder.renderOrder = 998;
pathUnder.frustumCulled = false;
animViz.add(pathUnder);

/** The picked part, posed but without its own motion: where its base is, which way its frame faces, and where its tip sits in it. */
function partFrame() {
  const b = creature.bones.get(selected)!;
  creature.root.updateMatrixWorld(true);
  const q = b.pivot.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(b.restQuat);
  const p = state.pose[selected];
  if (p) q.multiply(new THREE.Quaternion(...p));
  const scale = b.pivot.getWorldScale(new THREE.Vector3()).x;
  const tip = b.tip.position.clone().multiplyScalar(scale);
  return { base: b.pivot.getWorldPosition(new THREE.Vector3()), q, tip };
}

/** Where the tip is, leaning by `lean` (degrees, as stored). */
function tipAt(f: ReturnType<typeof partFrame>, lean: [number, number], flip?: boolean) {
  return f.tip.clone().applyQuaternion(leanQuat(lean, flip)).applyQuaternion(f.q).add(f.base);
}

function drawAnimPath() {
  const x = animOn() && !idle ? selStuff() : undefined;
  if (x) return drawStuffPath(x);
  rimHandle.visible = centerHandle.visible = spokeLine.visible = true;
  const a = selAnim();
  const show = animOn() && !idle && !!a && a.kind !== 'breathe' && creature.bones.has(selected);
  if (animViz.visible !== show) invalidate(1);
  animViz.visible = show;
  if (!show) return;
  let at: (p: number) => THREE.Vector3, centerAt: THREE.Vector3, rimAt: THREE.Vector3, anchor: THREE.Vector3;
  if (reaching(creature, selected, a)) {
    const rest = restTips.get(creature)?.get(selected);
    if (!rest) return;
    const L = reachLen(creature, selected);
    const W = (v: THREE.Vector3) => creature.root.localToWorld(rest.clone().add(v));
    at = (p) => W(reachAt(a, p, L));
    centerAt = W(reachRim({ ...a, size: 0 }, L));
    rimAt = W(reachRim(a, L));
    anchor = W(new THREE.Vector3());
  } else {
    const f = partFrame();
    at = (p) => tipAt(f, leanAt(a, p), a.flip);
    centerAt = tipAt(f, [a.x, a.z], a.flip);
    rimAt = tipAt(f, rimLean(a), a.flip);
    anchor = f.base;
  }
  const pts = Array.from({ length: 97 }, (_, i) => at(i / 96));
  setPath(pts);
  // handles keep a steady size on screen
  const r = view.position.distanceTo(anchor) * 0.011;
  rider.position.copy(at(animP(a, animT)));
  rider.scale.setScalar(r * 0.8);
  centerHandle.position.copy(centerAt);
  centerHandle.scale.setScalar(r * 1.3);
  rimHandle.position.copy(rimAt);
  rimHandle.scale.setScalar(r * 1.3);
  spokeLine.geometry.dispose();
  spokeLine.geometry = new THREE.BufferGeometry().setFromPoints([centerHandle.position, rimHandle.position]);
  // arrows along the way it goes (spaced evenly, away from the handles)
  arrows.forEach((m, i) => {
    const p = 0.125 + i * 0.25;
    const here = at(p), ahead = at(p + 0.01).sub(here);
    m.visible = ahead.lengthSq() > 1e-12;
    m.position.copy(here);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ahead.normalize());
    m.scale.setScalar(r * 1.1);
  });
  invalidate(1);
}

/**
 * A piece of stuff's motion, in its part's frame: the path a point on it
 * traces, the blue handle (centre) and the pink one (the line it turns
 * about, or for Bob where it floats to).
 */
function stuffViz(x: Attachment) {
  const a = x.anim!;
  const f = creature.stuffFrame(x.id);
  const b = creature.bones.get(x.bone);
  if (!f || !b) return null;
  const c = new THREE.Vector3(...a.center), axis = new THREE.Vector3(...a.axis);
  const unit = axis.lengthSq() > 1e-12 ? axis.clone().normalize() : new THREE.Vector3(0, 1, 0);
  // spinning and pulsing turn round the item's own middle: trace a point off to its side instead
  const off = new THREE.Vector3().crossVectors(unit, Math.abs(unit.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const traced = a.kind === 'spin' ? c.clone().addScaledVector(off, Math.max(f.size * 0.4, 0.02)) : f.center.clone();
  const reach = Math.max(f.size * 0.6, traced.distanceTo(c), 0.05);
  const rim = a.kind === 'bob' ? f.center.clone().add(axis) : c.clone().addScaledVector(unit, reach);
  return { f, b, c, rim, at: (p: number) => traced.clone().applyMatrix4(stuffMove(a, p, f.center)) };
}

function drawStuffPath(x: Attachment) {
  const a = x.anim;
  const v = a && stuffViz(x);
  if (animViz.visible !== !!v) invalidate(1);
  animViz.visible = !!v;
  if (!a || !v) return;
  const W = (p: THREE.Vector3) => v.b.pivot.localToWorld(p.clone());
  const at = (p: number) => W(v.at(p));
  const pts = Array.from({ length: 97 }, (_, i) => at(i / 96));
  setPath(pts);
  const r = view.position.distanceTo(pts[0]) * 0.011;
  rider.position.copy(at(stuffP(a, animT)));
  rider.scale.setScalar(r * 0.8);
  // Bob has no centre to move; Pulse no line
  centerHandle.visible = a.kind !== 'bob';
  rimHandle.visible = a.kind !== 'pulse';
  centerHandle.position.copy(W(a.kind === 'bob' ? v.f.center : v.c));
  centerHandle.scale.setScalar(r * 1.3);
  rimHandle.position.copy(W(v.rim));
  rimHandle.scale.setScalar(r * 1.3);
  spokeLine.geometry.dispose();
  spokeLine.geometry = new THREE.BufferGeometry().setFromPoints([centerHandle.position, rimHandle.position]);
  spokeLine.visible = a.kind !== 'pulse';
  arrows.forEach((m, i) => {
    const p = 0.125 + i * 0.25;
    const here = at(p), ahead = at(p + 0.01).sub(here);
    m.visible = ahead.lengthSq() > 1e-12;
    m.position.copy(here);
    if (m.visible) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ahead.normalize());
    m.scale.setScalar(r * 1.1);
  });
  invalidate(1);
}

/** Dragging a piece of stuff's handles: across the view, through where the handle is. */
function dragStuff(x: Attachment, ray: THREE.Ray) {
  const a = x.anim;
  const v = a && stuffViz(x);
  if (!a || !v || !animDrag) return;
  if (animDrag.which === 'radius') return dragOrbitSize(x, a, v, ray);
  const handle = (animDrag.which === 'center' ? centerHandle : rimHandle).position;
  const facing = view.getWorldDirection(new THREE.Vector3());
  const den = facing.dot(ray.direction);
  if (Math.abs(den) < 1e-6) return;
  const hit = ray.origin.clone().addScaledVector(ray.direction, facing.dot(handle.clone().sub(ray.origin)) / den);
  const q = v.b.pivot.worldToLocal(hit);
  const r3 = (w: THREE.Vector3) => w.toArray().map((n) => Math.round(n * 1000) / 1000) as V3;
  if (animDrag.which === 'center') x.anim = { ...a, center: r3(q) };
  else if (a.kind === 'bob') x.anim = { ...a, axis: r3(q.sub(v.f.center)) };
  else {
    const d = q.sub(v.c);
    if (d.lengthSq() > 1e-10) x.anim = { ...a, axis: r3(d.normalize()) };
  }
}

function setPath(pts: THREE.Vector3[]) {
  for (const l of [pathLine, pathUnder]) {
    l.geometry.dispose();
    l.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
  pathLine.computeLineDistances();
}

/** Dragging an Orbit's loop: how far the pointer is from the line it goes round sets how wide it is. */
function dragOrbitSize(x: Attachment, a: StuffAnim, v: NonNullable<ReturnType<typeof stuffViz>>, ray: THREE.Ray) {
  const pivot = v.b.pivot;
  const o = pivot.worldToLocal(ray.origin.clone());
  const d = pivot.worldToLocal(ray.origin.clone().add(ray.direction)).sub(o).normalize();
  const axis = new THREE.Vector3(...a.axis).normalize();
  // on the loop's own plane; seen edge on, across the view instead
  let den = axis.dot(d), normal = axis;
  if (Math.abs(den) < 0.15) {
    normal = pivot.worldToLocal(pivot.getWorldPosition(new THREE.Vector3()).add(view.getWorldDirection(new THREE.Vector3()))).sub(pivot.worldToLocal(pivot.getWorldPosition(new THREE.Vector3()))).normalize();
    den = normal.dot(d);
    if (Math.abs(den) < 1e-6) return;
  }
  const q = o.clone().addScaledVector(d, normal.dot(v.c.clone().sub(o)) / den);
  const placed = orbitOut(a, v.f.center).length();
  if (placed < 1e-4) return;
  const wide = orbitOut(a, q).length() / placed;
  x.anim = { ...a, radius: Math.round(Math.min(8, Math.max(0.05, wide)) * 100) / 100 };
}

/** A handle being dragged */
let animDrag: { which: 'center' | 'rim' | 'radius'; id: number } | null = null;

export function rayAt(e: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), view);
  return raycaster.ray;
}
/** Dragging a reaching part's handles: the motion lives in the creature's space, not on a ball. */
function dragReach(a: PartAnim, ray: THREE.Ray) {
  const rest = restTips.get(creature)?.get(selected);
  if (!rest || !animDrag) return;
  const D = Math.PI / 180, k = reachLen(creature, selected) * D;
  const o = creature.root.worldToLocal(ray.origin.clone());
  const d = creature.root.worldToLocal(ray.origin.clone().add(ray.direction)).sub(o).normalize();
  const center = rest.clone().add(reachRim({ ...a, size: 0 }, k / D));
  // the pointer on a plane through `at` facing `normal` (null if it runs along it)
  const onPlane = (at: THREE.Vector3, normal: THREE.Vector3) => {
    const den = normal.dot(d);
    return Math.abs(den) < 1e-4 ? null : o.clone().addScaledVector(d, normal.dot(at.clone().sub(o)) / den);
  };
  const unmirror = (v: THREE.Vector3) => (a.flip ? v.setX(-v.x) : v);
  // centre and edge slide over the level the motion sits at
  const q = onPlane(center, new THREE.Vector3(0, 1, 0));
  if (!q) return;
  if (animDrag.which === 'center') {
    const off = unmirror(q.sub(rest));
    setAnim({ ...a, x: Math.round(off.x / k), z: Math.round(off.z / k) });
  } else {
    const v = unmirror(q.sub(center));
    setAnim({ ...a, size: Math.round(Math.min(90, Math.hypot(v.x, v.z) / k)), dir: Math.round(Math.atan2(v.x, v.z) / D) });
  }
}

const endAnimDrag = (e: PointerEvent) => {
  if (!animDrag || e.pointerId !== animDrag.id) return;
  e.stopPropagation();
  animDrag = null;
  commit();
};

export function initAnimateTab() {
  for (const [id, field] of [['#anim-size', 'size'], ['#anim-phase', 'phase']] as const) {
    const input = $<HTMLInputElement>(id);
    input.oninput = () => patchMotion({ [field]: parseFloat(input.value) });
    input.onchange = () => commit();
  }
  $<HTMLInputElement>('#anim-reach').onchange = (e) => {
    const a = selAnim();
    if (a) setAnim({ ...a, reach: (e.target as HTMLInputElement).checked ? undefined : false });
    renderAnim();
    commit();
  };
  $<HTMLInputElement>('#anim-opposite').onchange = (e) => {
    const a = selAnim();
    if (a) setAnim({ ...a, opposite: (e.target as HTMLInputElement).checked || undefined });
    commit();
  };
  for (const btn of $('#anim-speed').querySelectorAll<HTMLButtonElement>('button')) {
    btn.onclick = () => {
      if (!curMotion()) return;
      patchMotion({ speed: Number(btn.dataset.speed) });
      renderAnim();
      commit();
    };
  }
  $<HTMLInputElement>('#anim-reverse').onchange = (e) => {
    patchMotion({ reverse: (e.target as HTMLInputElement).checked || undefined });
    commit();
  };
  $('#anim-clear').onclick = () => {
    // every motion in the scene: parts and stuff, every creature (Undo brings them back)
    for (const c of creatures) {
      delete c.state.anims;
      for (const x of c.state.attachments ?? []) delete x.anim;
    }
    commit();
    renderAnim();
    hint('All animations removed (Undo brings them back)', 2400);
  };
  $('#anim-play').onclick = () => {
    animPlaying = !animPlaying;
    renderAnim();
  };
  $<HTMLInputElement>('#anim-time').oninput = (e) => {
    animPlaying = false;
    animT = parseFloat((e.target as HTMLInputElement).value);
    renderAnim();
  };
  $<HTMLInputElement>('#anim-secs').oninput = (e) => {
    world.animSecs = parseFloat((e.target as HTMLInputElement).value);
  };
  $<HTMLInputElement>('#anim-secs').onchange = () => commit();
  for (const o of [pathLine, spokeLine, rider, centerHandle, rimHandle, ...arrows]) {
    o.renderOrder = 999;
    o.frustumCulled = false;
    animViz.add(o);
  }
  scene.add(animViz);
  viewport.addEventListener(
    'pointerdown',
    (e) => {
      if (!animViz.visible || e.button !== 0) return;
      rayAt(e);
      // an Orbit's loop can be grabbed too, to make it wider or narrower
      const orbiting = selStuff()?.anim?.kind === 'orbit';
      raycaster.params.Line.threshold = rider.scale.x * 1.2;
      const hit = raycaster.intersectObjects([centerHandle, rimHandle, ...(orbiting ? [rider, ...arrows, pathLine] : [])].filter((h) => h.visible))[0];
      if (!hit) return;
      // the handle, not the camera or the part under it
      e.stopPropagation();
      e.preventDefault();
      viewport.setPointerCapture(e.pointerId);
      animDrag = { which: hit.object === centerHandle ? 'center' : hit.object === rimHandle ? 'rim' : 'radius', id: e.pointerId };
    },
    { capture: true },
  );
  viewport.addEventListener(
    'pointermove',
    (e) => {
      if (!animDrag || e.pointerId !== animDrag.id) return;
      const x = selStuff();
      if (x) {
        e.stopPropagation();
        return dragStuff(x, rayAt(e));
      }
      const a = selAnim();
      if (!a) return;
      e.stopPropagation();
      const ray = rayAt(e);
      if (reaching(creature, selected, a)) return dragReach(a, ray);
      const f = partFrame();
      // the tip stays on a ball round the base: aim at where the pointer meets it (or the nearest point to it)
      const R = f.tip.length();
      const handle = (animDrag.which === 'center' ? centerHandle : rimHandle).position;
      const toBase = f.base.clone().sub(ray.origin);
      const along = toBase.dot(ray.direction);
      const closest = ray.origin.clone().addScaledVector(ray.direction, along);
      const miss = closest.distanceTo(f.base);
      let point: THREE.Vector3;
      if (miss >= R) point = closest.sub(f.base).setLength(R).add(f.base);
      else {
        const h = Math.sqrt(R * R - miss * miss);
        const near = ray.origin.clone().addScaledVector(ray.direction, along - h);
        const far = ray.origin.clone().addScaledVector(ray.direction, along + h);
        point = near.distanceTo(handle) <= far.distanceTo(handle) ? near : far;
      }
      // into the part's own frame, measured from where its tip points at rest
      const d = point.sub(f.base).applyQuaternion(f.q.clone().invert()).normalize();
      d.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(f.tip.clone().normalize(), new THREE.Vector3(0, 1, 0)));
      const lean = leanOf(d, a.flip);
      if (animDrag.which === 'center') setAnim({ ...a, x: Math.round(lean[0]), z: Math.round(lean[1]) });
      else {
        const dx = lean[0] - a.x, dz = lean[1] - a.z;
        setAnim({ ...a, size: Math.round(Math.min(90, Math.hypot(dx, dz))), dir: Math.round(Math.atan2(dz, dx) / (Math.PI / 180)) });
      }
    },
    { capture: true },
  );
  viewport.addEventListener('pointerup', endAnimDrag, { capture: true });
  viewport.addEventListener('pointercancel', endAnimDrag, { capture: true });
}
