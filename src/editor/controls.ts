// ---------------------------------------------------------------------------
// Controls in the view: picking, posing and shaping parts with the mouse or a
// finger, the eyes' drag, and the orbit controls. Our pointer handlers are
// registered first so they can veto orbiting.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bendOf, carryOnBend, Creature, partShapes, setPartShapes, type BoneRT, type CreatureState, type Planted } from '../creature';
import { type Vec2 } from '../inflate';
import { markToolsOut } from '../markingPanel';
import { gizmos, setLayoutIdle } from '../layout';
import { ridesSurface } from '../shortcuts';
import { expandRig, moveJoint, rollLimb, scaleBone, unlinkPair, type BoneDef, type RigState, type V3 } from '../rigs';
import { $ } from './dom';
import { camera, canvas, scene, view } from './stage';
import {
  activate,
  buildCreature,
  commit,
  creature,
  creatures,
  eyePair,
  idle,
  mode,
  opened,
  save,
  selected,
  setEyePair,
  setIdle,
  setSelected,
  state,
  world,
} from './state';
import { creatureBox } from './framing';
import { drawState, enterDraw, spacePan } from './drawing';
import { pickPiece, renderStuffPanel, selectedPiece, setSelectedPiece } from './workbench';
import { deselectAttachment, gizmo, selectedAttachment } from './attach';
import { placing, stopPlacing } from './arrange';
import { pickAttachment, pickStuff } from './carry';
import { queueCreationSave } from './creations';
import { flashPart, selectPart } from './partPanel';
import { setEyesFolded } from './eyesPanel';
import { renderUI } from './panels';
import { applyPartCopies, commitBoneEdit, parentAt, pickingParent, rigLocked } from './rigEdit';
import { hint, hintOnce } from './hints';
import { focusAt, pickingFocus } from './dof';
import { invalidate } from './loop';
import { animOn, pickAnimStuff } from './animateTab';

export const raycaster = new THREE.Raycaster();
export const pointer = { downX: 0, downY: 0, moved: false, touch: false };
/** A phone or tablet: hints talk about fingers, not mice and keys. */
export const touchScreen = () => matchMedia('(pointer: coarse)').matches;
// the last tap on the 3D view, to spot a double tap
let lastTap = { t: 0, x: 0, y: 0 };
let lastDoubleTap = 0;
type DragKind = 'body' | 'start' | 'end' | 'bend' | 'roll';
export let drag: {
  id: string;
  kind: DragKind;
  plane: THREE.Plane;
  /** the body's base grip: where the creature was, and the feet it keeps planted as the body moves */
  body?: { from: THREE.Vector3; feet: Planted[] };
  startHit: THREE.Vector3;
  /** rig mode: skeleton at the start of the drag, so each move re-applies from scratch */
  rigBase?: string;
  /**
   * reshaping: turns a world-space move into skeleton space. The bone's base
   * rides its parent, so this undoes everything above it (the parent's pose,
   * a bendy parent's curve, the creature's turn and size) but not the bone's
   * own bend.
   */
  toDef?: THREE.Matrix3;
  /** where the pointer last was (scrolling pushes a dragged tip nearer or further from there) */
  last?: THREE.Vector2;
  /** the parts that move with this drag, so not snapped to (Ctrl), and where the pointer is (Shift or Ctrl pressed mid-drag re-applies) */
  moving: Set<BoneRT>;
  at?: THREE.Vector2;
  /** the base or tip it's snapped to now */
  snapped?: string;
  /**
   * Dragging a tip: pulled past the part's (or limb's) reach it stretches, and
   * one pushed nearer its base than it started shrinks it. The skeleton before
   * the drag, the limb's straight reach and how far the tip was from its base
   * then (in the scene), how much it's stretched now, and each part's
   * lengthening (for its drawing)
   */
  stretch?: { base: string; reach?: number; from?: number; k: number; kY: Map<string, number> };
  /** a bend grip on one of the bone's bend points: which one */
  node?: number;
  /** a waiting (dotted) bend grip: the gap it sits in, and where (in the bone's frame); it becomes a bend point once it moves */
  gap?: { at: number; pos: THREE.Vector3 };
  /** roll ring: where the press was, which way on screen the ring moves as the part rolls, and how many pixels per radian */
  roll?: {
    start: THREE.Vector2;
    dir: THREE.Vector2;
    pxPerRad: number;
    /** the part (and its twin) before the drag: rest turn and pose, to keep a posed limb where it is */
    rest: Map<string, THREE.Quaternion>;
    pose: CreatureState['pose'];
    /** eyes before the drag: splitting a pair gives its right side its own */
    eyes: CreatureState['eyes'];
    /** pairs hanging off it were split so they could turn with it */
    split?: boolean;
  };
  moved: boolean;
} | null = null;

/**
 * A pose is kept relative to a part's rest axes, which a roll turns: turn it
 * back the other way so a bent limb stays where it was and only spins about
 * its length. `rest` and `pose` are from before the roll.
 */
function keepPoseThroughRoll(rest: Map<string, THREE.Quaternion>, pose: CreatureState['pose']) {
  for (const [lid, before] of rest) {
    const q = pose[lid];
    const l = creature.bones.get(lid);
    if (!q || !l) continue;
    const d = before.clone().invert().multiply(l.restQuat);
    const kept = d.clone().invert().multiply(new THREE.Quaternion(...q)).multiply(d);
    state.pose[lid] = kept.toArray() as [number, number, number, number];
  }
  creature.applyPose();
}

/**
 * Roll a part to `to(its roll now)`, as seen on its own side, turning whatever
 * hangs off it along with it. With Mirror off, a pair stops being one so only
 * this side rolls, and pairs on a middle part are split so they turn with it.
 * Says whether anything was split.
 */
function rollPart(id: string, to: (now: number) => number): boolean {
  // the rig, not the scene: mid-drag the scene already shows an earlier split
  const ex = expandRig(state.rig).bones.find((x) => x.id === id);
  if (!ex) return false;
  const copies = !rigLocked() && ex.sideSign !== 0 ? unlinkPair(state.rig, id) : [];
  const def = state.rig.bones.find((d) => d.id === (copies.length ? id : ex.baseId));
  if (!def) return false;
  // a right twin shares its left twin's roll, turned the other way
  const flip = !copies.length && ex.sideSign === -1 ? -1 : 1;
  const was = def.roll ?? 0;
  let r = to(was * flip) * flip;
  r = Math.round(Math.atan2(Math.sin(r), Math.cos(r)) * 1000) / 1000;
  copies.push(...rollLimb(state.rig, id, r - was, rigLocked()));
  def.roll = r;
  applyPartCopies(copies, true);
  return copies.length > 0;
}

/** Double-clicking a roll grip: straighten the part's roll (and its twin's, with Mirror on). */
function resetRoll(id: string) {
  const b = creature.bones.get(id);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!b || !def) return;
  if (!def.roll) {
    hint('Already straight', 1200);
    return;
  }
  const rest = new Map(creature.linked(id).map((l) => [l.def.id, l.restQuat.clone()] as const));
  const pose = structuredClone(state.pose);
  const split = rollPart(id, () => 0);
  creature.relayout(state.rig);
  keepPoseThroughRoll(rest, pose);
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  settleOnFloor();
  creature.boing(id);
  commit();
  selectPart(id);
  hint(split ? 'Roll straightened: now separate from its other side (Mirror keeps them paired)' : 'Roll straightened', 1600);
}

/**
 * Double-clicking a green bend diamond: undo just that bend (and its twin's).
 * A bend point goes, the part curving through the rest (the last one leaves
 * it straight); an arc's middle straightens it. A waiting (dotted) one has nothing to undo.
 */
function resetBend(id: string, node: number | undefined, used: boolean) {
  const b = creature.bones.get(id);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!b || !def) return;
  if (!used) {
    hint(def.bendNodes?.length || (def.bendy && def.bend) ? 'Not bent there yet: drag it to bend' : 'Already straight', 1400);
    return;
  }
  const one = node !== undefined && !!def.bendNodes && def.bendNodes.length > 1;
  if (one) {
    def.bendNodes!.splice(node!, 1);
    def.bendRound?.splice(node!, 1);
  } else {
    // the last bend: back to one waiting grip in the middle
    delete def.bendNodes;
    delete def.bendRound;
    def.bendy = false;
    def.bend = 0;
  }
  creature.relayout(state.rig);
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  settleOnFloor();
  creature.boing(id);
  commit();
  selectPart(id);
  hint(one ? 'That bend undone' : 'Bend straightened', 1400);
}

/** A point in a bone's frame as a bend point: kept for the left twin (like bendDir), as fractions of the length. */
function bendNodeAt(b: { length: number; def: { sideSign: number } }, v: THREE.Vector3): V3 {
  const r = (x: number) => Math.round((x / b.length) * 1000) / 1000;
  return [r(v.x), r(v.y), r(b.def.sideSign === -1 ? -v.z : v.z)];
}

/**
 * Scrolling on a solid bend grip: how round the curve is there, in tenths
 * from a corner (0) through round (1, an arc) to swollen (2). An arc's middle
 * first becomes a bend point there (the same arc). Kept on a pause.
 */
let roundCommit = 0;
function roundBend(id: string, node: number | undefined, step: number) {
  const b = creature.bones.get(id);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!b || !def) return;
  if (node === undefined || !def.bendNodes?.length) {
    const mid = b.bendHandles.find((h) => h.userData.used)?.position;
    if (!mid) return;
    def.bendNodes = [bendNodeAt(b, mid)];
    delete def.bend;
    delete def.bendDir;
    delete def.bendRound;
    def.bendy = true;
    node = 0;
  }
  const round = def.bendRound ?? def.bendNodes.map(() => 1);
  round[node] = Math.min(2, Math.max(0, Math.round(((round[node] ?? 1) + step * 0.1) * 10) / 10));
  if (round.every((v) => v === 1)) delete def.bendRound;
  else def.bendRound = round;
  creature.relayout(state.rig);
  creature.sync();
  const v = round[node];
  hint(v === 1 ? 'Round, like an arc' : v === 0 ? 'A sharp corner' : `${v < 1 ? 'Sharper' : 'Rounder'}: ${Math.round(v * 100)}%`, 1200);
  clearTimeout(roundCommit);
  roundCommit = window.setTimeout(() => {
    if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
    settleOnFloor();
    commit();
  }, 400);
}

/**
 * Scrolling on a joint: the purple square (a part's own base) widens or
 * narrows its Base width; the orange circle its Tip width, and the Base width
 * of every part growing from that tip with it, so the joint stays even.
 * A part with a drawing grows or shrinks whole instead. Kept on a pause.
 */
let widenCommit = 0;
function widenJoint(id: string, at: 'start' | 'end', step: number) {
  const b = creature.bones.get(id);
  if (!b) return;
  const defOf = (x: { def: { baseId: string } }) => state.rig.bones.find((d) => d.id === x.def.baseId);
  const drawn = (x: { src: string }) => !!state.parts[x.src]?.outline;
  const k = step > 0 ? 1.08 : 1 / 1.08;
  const grow = (w: number) => Math.min(1.2, Math.max(0.02, Math.round(w * k * 1000) / 1000));
  // a drawing sets its own widths: either end grows or shrinks the whole part instead, drawing, length and curve alike
  if (drawn(b)) return scaleDrawnPart(id, k);
  const ends: { def: BoneDef; end: 'base' | 'tip' }[] = [];
  const add = (x: (typeof creature.list)[number], end: 'base' | 'tip') => {
    const d = defOf(x);
    if (d && !drawn(x) && !ends.some((o) => o.def === d && o.end === end)) ends.push({ def: d, end });
  };
  if (at === 'start') add(b, 'base');
  else {
    add(b, 'tip');
    for (const c of creature.list) if (c.parent === b && !c.attach) add(c, 'base');
  }
  if (!ends.length) return;
  for (const { def, end } of ends) {
    if (end === 'base') {
      // the tip keeps the width it had (it followed the base while unset)
      def.widthEnd ??= def.width;
      def.width = grow(def.width);
    } else def.widthEnd = grow(def.widthEnd ?? def.width);
  }
  creature.relayout(state.rig);
  creature.sync();
  hint(step > 0 ? 'Wider' : 'Thinner', 900);
  clearTimeout(widenCommit);
  widenCommit = window.setTimeout(() => {
    settleOnFloor();
    commitBoneEdit();
  }, 400);
}

/** Grow a drawn part (and its twin) by `k` all over, rebuilt at its new size. */
function scaleDrawnPart(id: string, k: number) {
  const b = creature.bones.get(id);
  const part = b && state.parts[b.src];
  if (!b || !part) return;
  creature.capturePose();
  const before = structuredClone(state.rig);
  // (bend points are fractions of the length, so the curve grows with it as it is)
  const kY = scaleBone(state.rig, id, k, k);
  carryEyes(before, new Set([b.def.baseId]), k);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  setPartShapes(part, partShapes(part).map((sh) => ({ ...sh, outline: sh.outline.map(([x, y]) => [r4(x * k), r4(y * kY)] as Vec2) })));
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  hint(k > 1 ? 'Bigger' : 'Smaller', 900);
  clearTimeout(widenCommit);
  widenCommit = window.setTimeout(() => {
    settleOnFloor();
    commitBoneEdit();
  }, 400);
}

/** Double-clicking a joint's tip: unbend that joint (and its twin, with Mirror on). */
function resetJoint(id: string) {
  const b = creature.bones.get(id);
  if (!b) return;
  const twin = rigLocked() ? creature.twinOf(b) : null;
  const ids = [id, ...(twin ? [twin.def.id] : [])].filter((i) => state.pose[i]);
  if (!ids.length) {
    hint('Already straight', 1200);
    return;
  }
  for (const i of ids) delete state.pose[i];
  creature.applyPose();
  settleOnFloor();
  creature.boing(id);
  commit();
  hint('Joint straightened', 1400);
}

/** Where a point in a bone's own space lands on screen, in client pixels. */
function toScreen(obj: THREE.Object3D, local: THREE.Vector3): THREE.Vector2 {
  const r = canvas.getBoundingClientRect();
  const v = local.clone().applyMatrix4(obj.matrixWorld).project(view);
  return new THREE.Vector2(r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height);
}

/** Height of the creature's lowest point above the floor. */
export function floorGap(): number {
  const box = creatureBox(true);
  return box.isEmpty() ? 0 : box.min.y;
}
/** where the lowest point was when a move began: raising it means the creature should float */
export let gapBefore = 0;
export function setGapBefore(v: typeof gapBefore) {
  gapBefore = v;
}
export const lifted = () => floorGap() > Math.max(0, gapBefore) + 0.02;

/** Turn "Keep feet on the floor" on or off for this creature. */
export function setKeepFloor(on: boolean, announce = false) {
  if ((state.keepFloor !== false) === on) return;
  state.keepFloor = on;
  $<HTMLInputElement>('#keep-floor').checked = on;
  if (announce) hint(on ? 'Feet back on the floor' : 'Floating: "Keep feet on the floor" is off', 2200);
}

/** After a bend or resize, a creature that keeps its feet on the floor settles back onto it. */
export function settleOnFloor() {
  if (state.keepFloor === false) return;
  const box = creatureBox(true);
  if (box.isEmpty() || Math.abs(box.min.y) < 1e-4) return;
  const down = creature.root.worldToLocal(new THREE.Vector3(0, -box.min.y, 0)).sub(creature.root.worldToLocal(new THREE.Vector3()));
  creature.group.position.add(down);
  creature.capturePose();
}

// a grip dragged with Shift keeps to one of the creature's axes (the line
// shows which), with Ctrl (⌘) it snaps onto the base or tip of another part
const AXIS_COLORS = [0xe5484d, 0x30a46c, 0x3b82f6];
const axisGuide = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)]),
  new THREE.LineBasicMaterial({ depthTest: false, transparent: true }),
);
const snapGuide = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true }));

/** Where a dragged grip goes, Shift (one axis) and Ctrl (snapping) taken into account. */
function assistDrag(hit: THREE.Vector3, e: MouseEvent): THREE.Vector3 {
  const d = drag!;
  axisGuide.visible = snapGuide.visible = false;
  const snap = e.ctrlKey || e.metaKey ? nodeNear(e.clientX, e.clientY, d.moving) : null;
  if (snap) {
    snapGuide.position.copy(snap.at);
    snapGuide.visible = true;
    const key = `${snap.bone.def.id} ${snap.end}`;
    if (key !== d.snapped) hint(`Snapped to the ${snap.bone.def.name} ${snap.end}`, 1200);
    d.snapped = key;
    return snap.at.clone();
  }
  d.snapped = undefined;
  if (!e.shiftKey) return hit;
  // in the creature's own X, Y and Z (it may be turned): whichever the move is mostly along
  const from = creature.root.worldToLocal(d.startHit.clone());
  const to = creature.root.worldToLocal(hit.clone());
  const m = to.clone().sub(from).toArray().map(Math.abs);
  const ax = m[0] >= m[1] && m[0] >= m[2] ? 0 : m[1] >= m[2] ? 1 : 2;
  from.setComponent(ax, to.getComponent(ax));
  const dir = new THREE.Vector3().setComponent(ax, 1).transformDirection(creature.root.matrixWorld);
  axisGuide.position.copy(d.startHit);
  axisGuide.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  (axisGuide.material as THREE.LineBasicMaterial).color.setHex(AXIS_COLORS[ax]);
  axisGuide.visible = true;
  return creature.root.localToWorld(from);
}

/** The base or tip (of any creature's parts but the moving ones) nearest the pointer on screen, if one's close. */
function nodeNear(x: number, y: number, moving: Set<BoneRT>) {
  const r = canvas.getBoundingClientRect();
  let best: ReturnType<Creature['nodes']>[number] | null = null;
  let bestD = 18;
  for (const c of creatures) {
    c.root.updateMatrixWorld(true);
    for (const n of c.nodes(c === creature ? moving : undefined)) {
      const v = n.at.clone().project(view);
      if (v.z > 1) continue;
      const dd = Math.hypot(r.left + ((v.x + 1) / 2) * r.width - x, r.top + ((1 - v.y) / 2) * r.height - y);
      if (dd < bestD) {
        bestD = dd;
        best = n;
      }
    }
  }
  return best;
}

/**
 * Sliding a base over the surface (see ridesSurface): the spot on the surface
 * of the part under the pointer (a little inside it), so a base dropped on a
 * head is on the head, not in front of or behind it. Null over empty space. The limb being slid
 * (and its other side) is looked through. Uses the ray from setRay.
 */
function surfaceUnder(id: string): THREE.Vector3 | null {
  const b = creature.bones.get(id);
  if (!b) return null;
  const roots = [b, ...(b.def.sideSign ? [creature.bones.get(b.def.baseId + (b.def.sideSign === 1 ? 'R' : 'L'))] : [])];
  const moving = (x: BoneRT) => {
    for (let p: BoneRT | null = x; p; p = p.parent) if (roots.includes(p)) return true;
    return false;
  };
  const hit = raycaster.intersectObjects(creature.meshes().filter((m) => !moving(creature.bones.get(m.userData.boneId as string)!)), false)[0];
  if (!hit?.face) return null;
  const inward = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).negate();
  return hit.point.clone().addScaledVector(inward, 0.03);
}

/**
 * Pose by an orange tip, stretching the part to follow. With Pull limbs the
 * whole limb bends and stretches (up to the body, or a part it branches from).
 */
function dragTipTo(id: string, hit: THREE.Vector3) {
  const ik = $<HTMLInputElement>('#ik').checked;
  let chain = creature.dragTip(id, hit, ik);
  const st = drag?.stretch;
  if (st) {
    // out of reach: every part of the limb lengthens alike, just enough (and back to its own size within reach)
    // (in between, it bends to reach as usual)
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const base = at(chain[chain.length - 1].pivot);
    st.reach ??= chain.reduce((sum, b) => sum + at(b.tip).distanceTo(at(b.pivot)), 0);
    st.from ??= Math.min(base.distanceTo(drag!.startHit), st.reach);
    const d = base.distanceTo(hit);
    const k = d > st.reach ? d / Math.max(st.reach, 1e-4) : d < st.from ? Math.max(0.1, d / Math.max(st.from, 1e-4)) : 1;
    if (Math.abs(k - st.k) > 1e-3) {
      // (relayout re-seats the stored pose: keep the one just reached)
      creature.capturePose();
      state.rig = JSON.parse(st.base) as RigState;
      st.kY.clear();
      // (a curve through bend points grows with the part, the same shape: they're fractions of its length)
      for (const b of chain) st.kY.set(b.src, scaleBone(state.rig, b.def.id, k, 1));
      creature.relayout(state.rig);
      // the meshes re-bent to their new lengths, as they'll be rebuilt on letting go
      for (const b of chain) creature.previewBend(b.def.id);
      st.k = k;
      chain = creature.dragTip(id, hit, ik);
    }
  }
  if (rigLocked()) creature.mirrorPose(chain);
}

/** Not every phone browser turns a double tap into a dblclick, so spot it on the way up (and act on it). */
function doubleTapped(e: PointerEvent): boolean {
  if (e.pointerType === 'mouse') return false;
  const now = performance.now();
  if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap.t = 0;
    lastDoubleTap = now;
    onDoubleClick(e.clientX, e.clientY);
    return true;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  return false;
}

function onDoubleClick(x: number, y: number) {
  // double-click a roll grip to straighten the part
  if (handlesVisible()) {
    const h = pickHandle(x, y);
    if (h?.userData.kind === 'roll') {
      resetRoll(h.userData.handle as string);
      return;
    }
    if (h?.userData.kind === 'bend') {
      resetBend(h.userData.handle as string, h.userData.node as number | undefined, !!h.userData.used);
      return;
    }
    if (h?.userData.kind === 'end') {
      resetJoint(h.userData.handle as string);
      return;
    }
    // the other grips (sizes, sliding the base) have nothing to go back to:
    // a double-click on one just shouldn't start drawing the part underneath
    if (h) return;
  }
  if (mode === 'stuff') {
    const id = drawState ? null : pickPiece(x, y);
    if (id) {
      setSelectedPiece(id);
      renderStuffPanel();
      enterDraw({ kind: 'piece', redraw: id });
    }
    return;
  }
  const other = pickOtherCreature(x, y);
  if (other) activate(other.index);
  // the first click already went to the eye settings
  else if (pickEye(x, y) !== null) return;
  const id = pickPart(x, y);
  if (!id) return;
  selectPart(id);
  enterDraw();
}

export let controls: OrbitControls<THREE.PerspectiveCamera>;
/** the view's been moved by hand since the page opened (the open creation's saved view is only put back before that) */
export let viewMoved = false;
/** The view is kept with the open creation (see SceneLook): save it there once it's settled. */
export function viewChanged() {
  if (opened.keep && mode !== 'stuff') queueCreationSave();
}

export function setRay(clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(
    new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1),
    view,
  );
}

/** If the pointer is over a creature other than the active one, which one (and which part). */
export function pickOtherCreature(x: number, y: number): { index: number; boneId?: string } | null {
  if (creatures.length < 2) return null;
  setRay(x, y);
  const targets = creatures.flatMap((c) => [...c.meshes(), ...c.attachmentMeshes()]);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return null;
  let o: THREE.Object3D | null = hit.object;
  while (o && !creatures.some((c) => c.root === o)) o = o.parent;
  const index = creatures.findIndex((c) => c.root === o);
  if (index < 0 || index === world.active) return null;
  return { index, boneId: hit.object.userData.boneId as string | undefined };
}

export function creatureLabel(i: number): string {
  return world.creatures[i]?.name?.trim() || `Creature ${i + 1}`;
}

export function pickPart(x: number, y: number): string | null {
  setRay(x, y);
  const hit = raycaster.intersectObjects(creature.meshes(), false)[0];
  return hit ? (hit.object.userData.boneId as string) : null;
}

/** The eye under the pointer, if it's in front of every part there: its pair, and which of the two it is. */
function pickEyeHit(x: number, y: number): { pair: number; sgn: number } | null {
  setRay(x, y);
  const part = raycaster.intersectObjects(creature.meshes(), false)[0];
  const eye = creature.pickEye(raycaster.ray);
  return eye && (!part || eye.distance <= part.distance) ? eye : null;
}

/** The eye pair under the pointer, if an eye is in front of every part there. */
function pickEye(x: number, y: number): number | null {
  return pickEyeHit(x, y)?.pair ?? null;
}

/** an eye being dragged over the surface: its pair, and which of the two (-1 = the mirrored one) */
let eyeDrag: { pair: number; sgn: number } | null = null;

export const round4 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4) / 1e4) as V3;

/**
 * Eyes placed by hand on parts that were just stretched or grown (`ids`, by
 * definition, from the skeleton `before`), kept on the same spots of them.
 * Ones placed from Spacing and Height find their spots afresh anyway.
 */
function carryEyes(before: RigState, ids: Set<string>, kWidth: number) {
  const was = new Map(expandRig(before).bones.map((b) => [b.id, b]));
  const now = new Map(expandRig(state.rig).bones.map((b) => [b.id, b]));
  const len = (d: { start: V3; end: V3 }) => Math.max(new THREE.Vector3(...d.end).sub(new THREE.Vector3(...d.start)).length(), 1e-3);
  for (const pair of state.eyes.pairs) {
    if (!pair.at) continue;
    // (kept in the left twin's frame)
    const id = creature.eyeBones(pair).find((x) => x.def.sideSign !== -1)?.def.id;
    const a = id && was.get(id), z = id && now.get(id);
    if (!a || !z || !ids.has(a.baseId)) continue;
    const { p, n } = carryOnBend(bendOf(a, len(a)), bendOf(z, len(z)), kWidth, new THREE.Vector3(...pair.at), new THREE.Vector3(...(pair.n ?? [0, 0, 1])));
    pair.at = round4(p);
    if (pair.n) pair.n = round4(n!);
  }
}

/**
 * Put an eye where the pointer is on the creature (on whichever part is
 * there): the pair becomes hand-placed, its other eye mirrored across the
 * part's own middle. Says whether it landed on the creature.
 */
export function moveEyesTo(index: number, sgn: number, x: number, y: number): boolean {
  const pair = state.eyes.pairs[index];
  if (!pair) return false;
  setRay(x, y);
  const hit = creature.surfaceAt(raycaster);
  if (!hit) return false;
  const at = hit.local, n = hit.localNormal;
  // undo the pair's Facing, then (for the mirrored eye) the mirroring, as the eyes are laid out
  const spin = pair.turn ?? state.eyes.turn ?? 0;
  const Y = new THREE.Vector3(0, 1, 0);
  at.applyAxisAngle(Y, -spin);
  n.applyAxisAngle(Y, -spin);
  if (sgn === -1) {
    const { across, mid } = creature.eyeMirror(hit.bone, true);
    at.addScaledVector(across, -2 * at.clone().sub(mid).dot(across));
    n.addScaledVector(across, -2 * n.dot(across));
  }
  pair.at = round4(at);
  pair.n = round4(n.normalize());
  pair.bone = hit.bone.src;
  state.eyes.enabled = true;
  creature.sync();
  return true;
}

/** Picks the part these eyes are on, with its eye settings open at this pair. */
export function showEyes(pair: number) {
  deselectAttachment();
  setEyePair(pair);
  setEyesFolded(false);
  const on = creature.eyeBones(state.eyes.pairs[pair])[0];
  if (on) selectPart(on.def.id);
  else renderUI();
}

/** Handles are tiny, so pick the nearest one in screen space. */
function pickHandle(x: number, y: number): THREE.Object3D | null {
  const r = canvas.getBoundingClientRect();
  let best: THREE.Object3D | null = null;
  // fingers are less exact than a mouse
  let bestD = pointer.touch ? 28 : 16;
  const v = new THREE.Vector3();
  const near = (h: THREE.Object3D, at: THREE.Vector3) => {
    h.localToWorld(v.copy(at)).project(view);
    if (v.z > 1) return Infinity;
    return Math.hypot(r.left + ((v.x + 1) / 2) * r.width - x, r.top + ((1 - v.y) / 2) * r.height - y);
  };
  // the roll ring is big and easy to catch anywhere round its hoop, and seen
  // edge-on it's a line straight through the grips near it (the purple base
  // square): any grip in reach wins over it, so the ring is only tried after
  let ring: { h: THREE.Object3D; d: number; at: THREE.Vector3 } | null = null;
  for (const h of creature.handles()) {
    if (!h.visible) continue;
    if (h.userData.ring !== undefined) {
      // the roll ring is grabbed anywhere round its hoop: remember where (in the bone's frame)
      const rr = h.userData.ring as number;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const at = new THREE.Vector3(rr * Math.cos(a), 0, rr * Math.sin(a));
        const d = near(h, at);
        if (d < bestD && (!ring || d < ring.d)) ring = { h, d, at };
      }
      continue;
    }
    const d = near(h, new THREE.Vector3());
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  if (!best && ring) {
    ring.h.userData.grab = ring.at.add(ring.h.position);
    return ring.h;
  }
  return best;
}

export function handlesVisible() {
  // Arrange has its own handles at the creature's feet, picked stuff its own arrows, and a marking being placed its own
  return !idle && !drawState && !placing && !selectedAttachment && !markToolsOut() && mode !== 'stuff' && gizmos() !== 'none';
}

/** Back to nothing picked: clicking empty space in Shape. */
function deselectAll() {
  setIdle(true);
  stopPlacing();
  deselectAttachment();
  creature.flash(null, 0);
  updateSkeletonVisibility();
  renderUI();
}

/** The sidebar's part editor and the on-screen Arrange/Mirror pills only make sense with something picked. */
export function syncIdle() {
  $('.panel').classList.toggle('idle', idle && mode !== 'stuff');
  setLayoutIdle(idle);
  // the handles follow the same idle state, so they can't outlive the selection
  updateSkeletonVisibility();
}

export function updateSkeletonVisibility() {
  // the tab's Gizmos: every part's handles, or just the picked part's
  Creature.handleScope = gizmos() === 'part' ? 'part' : 'all';
  creature.setSkeletonVisible(handlesVisible());
  // the key to the handles shows with them
  $('#shape-legend').classList.toggle('off', !handlesVisible());
}

export function initControls() {
  canvas.addEventListener('pointerdown', (e) => {
    pointer.downX = e.clientX;
    pointer.downY = e.clientY;
    pointer.moved = false;
    pointer.touch = e.pointerType !== 'mouse';
    // holding Space, the left button only pans
    if (e.button !== 0 || pickingFocus || pickingParent || spacePan) return;
    // pressing on an eye: dragging slides the pair over the surface (a click still opens its settings)
    const onHandle = (handlesVisible() && pickHandle(e.clientX, e.clientY)) || gizmo.dragging || gizmo.axis !== null;
    const eye = !onHandle && mode !== 'stuff' && !drawState && !idle ? pickEyeHit(e.clientX, e.clientY) : null;
    if (eye) {
      eyeDrag = { pair: eye.pair, sgn: eye.sgn };
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (!handlesVisible()) return;
    const h = pickHandle(e.clientX, e.clientY);
    if (!h) return;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    const pos = h.getWorldPosition(new THREE.Vector3());
    const id = h.userData.handle as string;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), pos);
    const b = creature.bones.get(id);
    // the body's base grip poses: the body moves, the legs bend to keep their feet where they are
    const feet = b && !b.parent && h.userData.kind === 'start' ? creature.plantedFeet(b) : [];
    const body = feet.length ? { from: creature.group.position.clone(), feet } : undefined;
    const kind = body ? 'body' : (h.userData.kind as DragKind);
    // bending is posing; sliding, curving and resizing reshape the skeleton itself
    const reshape = kind !== 'end' && kind !== 'body';
    let toDef: THREE.Matrix3 | undefined;
    if (reshape && b) {
      b.pivot.updateMatrixWorld(true);
      // where the bone would be in the scene if it weren't bent itself
      const unbent = b.pivot.parent!.matrixWorld.clone().multiply(new THREE.Matrix4().compose(b.pivot.position, b.restQuat, new THREE.Vector3(1, 1, 1)));
      toDef = new THREE.Matrix3().setFromMatrix4(b.restWorld.clone().multiply(unbent.invert()));
    }
    let roll: NonNullable<typeof drag>['roll'];
    if (b && kind === 'roll') {
      // which way the ring travels on screen as the part rolls a little (about its own length)
      // which way the ring runs where it was grabbed (it circles the line from base to tip, which is the bone's Y)
      const at = (h.userData.grab as THREE.Vector3 | undefined)?.clone() ?? h.position.clone().add(new THREE.Vector3(h.userData.ring, 0, 0));
      const eps = 0.02;
      const moved = toScreen(b.pivot, at.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), eps)).sub(toScreen(b.pivot, at));
      const pxPerRad = moved.length() / eps;
      // seen end-on the ring barely moves: fall back to dragging sideways
      const visible = pxPerRad > 40;
      const dir = visible ? moved.normalize() : new THREE.Vector2(1, 0);
      const rest = new Map(creature.linked(id).map((l) => [l.def.id, l.restQuat.clone()] as const));
      creature.rolling = true;
      roll = { start: new THREE.Vector2(e.clientX, e.clientY), dir, pxPerRad: visible ? pxPerRad : 120, rest, pose: structuredClone(state.pose), eyes: structuredClone(state.eyes) };
    }
    const stretch = kind === 'end' ? { base: JSON.stringify(state.rig), k: 1, kY: new Map<string, number>() } : undefined;
    const ik = $<HTMLInputElement>('#ik').checked;
    const moving = !b
      ? new Set<BoneRT>()
      : body
        ? new Set(creature.list)
        : creature.withBelow(kind === 'end' ? creature.linked(id).flatMap((l) => creature.ikChain(l.def.id, ik)) : creature.linked(id));
    drag = { id, kind, plane, body, stretch, moving, startHit: pos, moved: false, rigBase: reshape ? JSON.stringify(state.rig) : undefined, toDef, roll, node: h.userData.node as number | undefined, gap: h.userData.gap === undefined ? undefined : { at: h.userData.gap as number, pos: h.position.clone() } };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 5) pointer.moved = true;
    if (eyeDrag) {
      if (pointer.moved) moveEyesTo(eyeDrag.pair, eyeDrag.sgn, e.clientX, e.clientY);
      return;
    }
    if (drag) {
      setRay(e.clientX, e.clientY);
      let hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit) return;
      drag.moved = drag.moved || pointer.moved;
      drag.at = new THREE.Vector2(e.clientX, e.clientY);
      if (drag.kind !== 'roll') hit = assistDrag(hit, e);
      if (drag.body) {
        if (!drag.moved) return;
        // the move in the creature's own space (it may be turned or resized)
        const d = creature.root.worldToLocal(hit.clone()).sub(creature.root.worldToLocal(drag.startHit.clone()));
        creature.moveBodyOver(drag.body.feet, drag.body.from, d);
        hintOnce('Moving the body: its feet stay planted', 2200);
      } else if (drag.rigBase && drag.kind === 'bend') {
        // a green diamond: its bend point goes where the pointer is
        if (!drag.moved) return;
        const b = creature.bones.get(drag.id);
        const def = b && state.rig.bones.find((x) => x.id === b.def.baseId);
        if (!b || !def) return;
        const local = b.pivot.worldToLocal(hit.clone());
        const asNode = (v: THREE.Vector3) => bendNodeAt(b, v);
        if (drag.gap && drag.node === undefined) {
          // a waiting grip, used: it becomes a bend point there (an arc first turns into one through its middle)
          const g = drag.gap;
          if (!def.bendNodes?.length) {
            const mid = b.bendHandles.find((h) => h.userData.used)!.position;
            def.bendNodes = g.at === 0 ? [asNode(g.pos), asNode(mid)] : [asNode(mid), asNode(g.pos)];
            delete def.bend;
            delete def.bendDir;
            delete def.bendRound;
          } else {
            def.bendNodes.splice(g.at, 0, asNode(g.pos));
            def.bendRound?.splice(g.at, 0, 1);
          }
          // gap n sits before point n (gap 1 of an arc: after its middle)
          drag.node = g.at;
        } else if (drag.node === undefined) {
          // a straight part's middle, or an arc's: a bend point there (the same arc: one point curves round
          // the circle through the base, it and the tip), free to go anywhere from then on
          const mid = b.bendHandles.find((h) => h.userData.node === undefined && h.userData.gap === undefined)!.position;
          def.bendNodes = [asNode(mid)];
          delete def.bend;
          delete def.bendDir;
          delete def.bendRound;
          drag.node = 0;
        }
        if (!creature.bendDragging) creature.setBendDragging(true);
        // just that one point moves
        def.bendNodes![drag.node] = asNode(local);
        def.bendy = true;
        creature.relayout(state.rig);
        creature.sync();
      } else if (drag.roll) {
        if (!drag.moved) return;
        const b = creature.bones.get(drag.id);
        if (!b) return;
        const rl = drag.roll;
        const turn = new THREE.Vector2(e.clientX, e.clientY).sub(rl.start).dot(rl.dir) / rl.pxPerRad;
        // start over from before the drag each time (a split pair included)
        state.rig = JSON.parse(drag.rigBase!) as RigState;
        state.eyes = structuredClone(rl.eyes);
        rl.split = rollPart(drag.id, (now) => now + turn);
        creature.relayout(state.rig);
        keepPoseThroughRoll(rl.rest, rl.pose);
        invalidate();
      } else if (drag.rigBase && drag.kind === 'start') {
        if (!drag.moved) return;
        // slide the whole limb: the move in skeleton coordinates (the creature may be turned or posed, the bone may ride a curve)
        // (or over the surface of the part under the pointer: with Alt, or always if the shortcut sheet swaps them)
        const d = ((ridesSurface(e.altKey) && surfaceUnder(drag.id)) || hit.clone()).sub(drag.startHit);
        if (drag.toDef) d.applyMatrix3(drag.toDef);
        state.rig = JSON.parse(drag.rigBase) as RigState;
        moveJoint(state.rig, drag.id, 'start', d.toArray() as V3, rigLocked());
        creature.relayout(state.rig);
      } else if (drag.kind === 'end') {
        drag.last = new THREE.Vector2(e.clientX, e.clientY);
        dragTipTo(drag.id, hit);
      }
      return;
    }
    if (handlesVisible() && e.buttons === 0) {
      const h = pickHandle(e.clientX, e.clientY);
      creature.setHandleHover(h);
      $('#viewport').style.cursor = h ? 'var(--cursor-click)' : '';
    }
  });
  for (const g of [axisGuide, snapGuide]) {
    g.renderOrder = 1001;
    g.frustumCulled = false;
    g.visible = false;
    scene.add(g);
  }
  if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelectorAll('.ctrl-key').forEach((k) => (k.textContent = '⌘'));
  // pressing or letting go of Shift or Ctrl mid-drag applies straight away
  for (const type of ['keydown', 'keyup'] as const) {
    addEventListener(type, (e) => {
      if (!drag?.at || !['Shift', 'Control', 'Meta'].includes(e.key)) return;
      const { x, y } = drag.at;
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 1, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }));
    });
  }
  // scrolling on a solid bend grip rounds or sharpens the curve there (instead of zooming)
  $('#viewport').addEventListener(
    'wheel',
    (e) => {
      // scrolling while dragging a tip pushes it away or pulls it nearer
      if (drag?.kind === 'end') {
        e.preventDefault();
        e.stopPropagation();
        const at = drag.plane.coplanarPoint(new THREE.Vector3());
        const toward = view.position.clone().sub(at);
        const step = Math.min(toward.length() * 0.06, 0.25) * (e.deltaY > 0 ? -1 : 1);
        drag.plane.translate(toward.normalize().multiplyScalar(step));
        const last = drag.last ?? new THREE.Vector2(pointer.downX, pointer.downY);
        setRay(last.x, last.y);
        const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
        if (hit) {
          drag.moved = true;
          dragTipTo(drag.id, hit);
        }
        return;
      }
      if (!handlesVisible() || drag) return;
      const h = pickHandle(e.clientX, e.clientY);
      const kind = h?.userData.kind;
      const step = e.deltaY < 0 ? 1 : -1;
      if (kind === 'bend' && h!.userData.used) roundBend(h!.userData.handle as string, h!.userData.node as number | undefined, step);
      else if ((kind === 'start' || kind === 'end')) widenJoint(h!.userData.handle as string, kind, step);
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true, passive: false },
  );
  canvas.addEventListener('pointerup', (e) => {
    if (eyeDrag) {
      const d = eyeDrag;
      eyeDrag = null;
      controls.enabled = true;
      if (pointer.moved) {
        commit();
        showEyes(d.pair);
        return;
      }
      // not moved: a click, which opens the eye settings below
    }
    if (drag) {
      const d = drag;
      drag = null;
      controls.enabled = true;
      axisGuide.visible = snapGuide.visible = false;
      // the waiting bend grips come back, in the gaps either side of a new bend point
      if (creature.bendDragging) creature.setBendDragging(false);
      creature.rolling = false;
      $('#viewport').style.cursor = '';
      if (d.rigBase) {
        if (d.moved) {
          // rebuild meshes at their new lengths and re-seat the pose
          if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
          buildCreature();
          settleOnFloor();
          creature.boing(d.id);
          commit();
          if (d.roll?.split) hint('Now separate sides, so only this one turns (Mirror keeps them paired)', 3200);
        }
        selectPart(d.id);
        if (!d.moved) doubleTapped(e);
        return;
      }
      creature.capturePose();
      if (d.stretch && d.stretch.k !== 1) {
        // a limb stretched to reach: drawn parts lengthen with it, and the meshes are rebuilt at their new lengths
        // (eyes placed by hand on them staying on the same spots)
        const base = JSON.parse(d.stretch.base) as RigState;
        const stretched = new Set(expandRig(base).bones.filter((b) => d.stretch!.kY.has(b.id)).map((b) => b.baseId));
        carryEyes(base, stretched, 1);
        const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
        for (const [src, kY] of d.stretch.kY) {
          const part = state.parts[src];
          const shapes = part ? partShapes(part) : [];
          if (shapes.length) setPartShapes(part, shapes.map((sh) => ({ ...sh, outline: sh.outline.map(([x, y]) => [x, r4(y * kY)] as Vec2) })));
        }
        if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
        buildCreature();
        creature.boing(d.id);
      }
      // a double tap on the grip resets it (see onDoubleClick)
      if (!d.moved && doubleTapped(e)) return;
      // (the body stays where its grip was let go, even off the floor)
      if (d.moved && d.kind !== 'body') settleOnFloor();
      commit();
      return;
    }
    if (pointer.moved || e.button !== 0 || gizmo.dragging || drawState) return;
    if (doubleTapped(e)) return;
    if (pickingFocus) {
      focusAt(e.clientX, e.clientY);
      return;
    }
    if (pickingParent) {
      parentAt(e.clientX, e.clientY);
      return;
    }
    if (mode === 'stuff') {
      const id = pickPiece(e.clientX, e.clientY);
      if (id) {
        setSelectedPiece(id);
        flashPart();
        renderStuffPanel();
      }
      return;
    }
    // clicking a different creature makes it the one being edited
    const other = pickOtherCreature(e.clientX, e.clientY);
    if (other) {
      setIdle(false);
      activate(other.index);
      if (other.boneId && creature.bones.has(other.boneId)) setSelected(other.boneId);
      creature.select(selected);
      flashPart();
      save();
      renderUI();
      hint(`Now editing ${creatureLabel(other.index)}`, 1600);
      return;
    }
    const eye = pickEye(e.clientX, e.clientY);
    if (eye !== null) {
      if (idle) {
        setIdle(false);
        updateSkeletonVisibility();
        renderUI();
      }
      showEyes(eye);
      return;
    }
    const att = pickAttachment(e.clientX, e.clientY);
    if (att) return animOn() ? pickAnimStuff(att) : pickStuff(att);
    const id = pickPart(e.clientX, e.clientY);
    if (id) {
      deselectAttachment();
      selectPart(id);
    } else if (gizmos() !== 'none' && !idle) deselectAll();
  });
  canvas.addEventListener('dblclick', (e) => {
    // a double tap that was already handled on the way up
    if (performance.now() - lastDoubleTap < 600) return;
    onDoubleClick(e.clientX, e.clientY);
  });
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 0.6;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.autoRotateSpeed = 2.5;
  controls.update();
  controls.addEventListener('start', () => (viewMoved = true));
  controls.addEventListener('end', () => viewChanged());
}
