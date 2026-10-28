/**
 * Looping part animations (proof of concept).
 *
 * Each part can carry one pre-baked motion that swings its tip around (or, for
 * Breathe, puffs it up and down). Everything runs on one shared loop, and every
 * motion repeats a whole number of times per loop, so the scene always comes
 * back to exactly where it started: a seamless, gif-able loop.
 *
 * Motions are layered on top of the pose (never written into it), in the
 * part's own posed frame: X across the drawing, Y along the bone, Z out of it.
 * Where the tip leans is an angle vector w = (wx, wz) across the bone: the tip
 * tips over by |w| towards w. A motion is a centre (x, z) plus a shape scaled
 * by `size` and turned by `dir`, all in that same space, so the handles in the
 * view can be dragged straight onto it (see `leanOf`).
 *
 * TODO(anim): unit tests for animOffset (loop closure at p=0/1, twin mirroring) and leanOf (inverse of animOffset).
 */
import * as THREE from 'three';
import type { V3 } from './rigs';

export type AnimKind = 'circle' | 'half' | 'swing' | 'eight' | 'breathe';

export interface PartAnim {
  kind: AnimKind;
  /** how far the tip travels, degrees (Breathe: how much it puffs, percent) */
  size: number;
  /** which way round the bone the motion faces, degrees */
  dir: number;
  /** where the motion is centred: tip leaning across the drawing / out of it, degrees */
  x: number;
  z: number;
  /** times round per loop (a whole number, so it loops) */
  speed: number;
  /**
   * a part with a bendable part above it (a foot under a shin): its tip follows
   * the path for real and the part above bends to reach it, like a knee. Off: it
   * just swings from its base. Unset: on, wherever it can.
   */
  reach?: boolean;
  /** timing offset, as a fraction of one time round (0..1) */
  phase: number;
  /** go round the shape the other way (a Half circle: walking backwards) */
  reverse?: boolean;
  /** a pair: the other side runs half a time round behind (for walking) */
  opposite?: boolean;
  /** the other side of a pair, worked out from this one: its frame is a mirror image, so Z flips */
  flip?: boolean;
}

export const ANIM_KINDS: { kind: AnimKind; name: string; icon: string; title: string }[] = [
  { kind: 'circle', name: 'Circle', icon: 'circle', title: 'The tip goes round in a full circle: wings, waving, stirring' },
  { kind: 'half', name: 'Half circle', icon: 'person-walking', title: 'Up and over in an arc, then straight back along the ground: a step' },
  { kind: 'swing', name: 'Swing', icon: 'arrows-left-right', title: 'Back and forth in a line: a wagging tail, a nod' },
  { kind: 'eight', name: 'Figure 8', icon: 'infinity', title: 'A sideways figure eight: flapping, swimming' },
  { kind: 'breathe', name: 'Breathe', icon: 'lungs', title: 'Puffs up and back down' },
];

export function defaultAnim(kind: AnimKind): PartAnim {
  return { kind, size: kind === 'breathe' ? 15 : 25, dir: 0, x: 0, z: 0, speed: 1, phase: 0 };
}

/** The same motion on the other side of a mirrored pair (half a time round behind, if opposite). */
export function mirrorAnim(a: PartAnim): PartAnim {
  return { ...a, flip: !a.flip || undefined, phase: (a.phase + (a.opposite ? 0.5 : 0)) % 1 };
}

const D = Math.PI / 180;
const TAU = Math.PI * 2;

/** Where along its shape a motion is at `p` (0..1 of one time round): u along `dir`, v across it, each -1..1. */
function shapeAt(kind: AnimKind, p: number): [number, number] {
  switch (kind) {
    case 'circle':
      return [Math.cos(TAU * p), Math.sin(TAU * p)];
    case 'half':
      // the first half lifts up and over; the second slides straight back
      return p < 0.5 ? [-Math.cos(TAU * p), Math.sin(TAU * p)] : [1 - 4 * (p - 0.5), 0];
    case 'swing':
      return [Math.sin(TAU * p), 0];
    case 'eight':
      return [Math.sin(TAU * p), Math.sin(2 * TAU * p) / 2];
    default:
      return [0, 0];
  }
}

/** Whether a motion has a way round to reverse (Swing just goes back and forth; Breathe stays put). */
export function canReverse(kind: AnimKind): boolean {
  return kind !== 'swing' && kind !== 'breathe';
}

/**
 * Where along its shape a part's motion is at `p`, the other way round if reversed.
 * A reversed Half circle still lifts in the first half of the time round, so it
 * stays in step with the other legs: it just runs each half backwards.
 */
function motionShape(a: PartAnim, p: number): [number, number] {
  if (a.kind === 'breathe') return [0, 0];
  if (!a.reverse || !canReverse(a.kind)) return shapeAt(a.kind, p);
  return shapeAt(a.kind, a.kind === 'half' ? (p <= 0.5 ? 0.5 - p : 1.5 - p) : 1 - p);
}

/** The lean at `p` of one time round, in degrees (as stored: before any flip). */
export function leanAt(a: PartAnim, p: number): [number, number] {
  if (a.kind === 'breathe') return [a.x, a.z];
  const [u, v] = motionShape(a, p);
  const c = Math.cos(a.dir * D), s = Math.sin(a.dir * D);
  return [(u * c - v * s) * a.size + a.x, (u * s + v * c) * a.size + a.z];
}

/** The edge handle's lean: the end of the motion's `dir` axis. */
export function rimLean(a: PartAnim): [number, number] {
  return [a.x + Math.cos(a.dir * D) * a.size, a.z + Math.sin(a.dir * D) * a.size];
}

/** A lean (degrees, as stored) as a turn of the part. */
export function leanQuat(lean: [number, number], flip?: boolean): THREE.Quaternion {
  const wx = lean[0] * D, wz = lean[1] * D * (flip ? -1 : 1);
  const ang = Math.hypot(wx, wz);
  const q = new THREE.Quaternion();
  if (ang > 1e-6) q.setFromAxisAngle(new THREE.Vector3(wz, 0, -wx).divideScalar(ang), ang);
  return q;
}

/** The lean (degrees, as stored) that points the part along `d`, a direction in its posed frame. */
export function leanOf(d: THREE.Vector3, flip?: boolean): [number, number] {
  const across = Math.hypot(d.x, d.z);
  const ang = Math.atan2(across, d.y) / D;
  if (across < 1e-9) return [0, 0];
  return [(d.x / across) * ang, ((d.z / across) * ang) * (flip ? -1 : 1)];
}

/** Where in one time round a part is at loop time `t`. */
export function animP(a: PartAnim, t: number): number {
  return (((t * Math.max(1, Math.round(a.speed)) + a.phase) % 1) + 1) % 1;
}

/** Where in its motion a part is at loop time `t` (0..1): the turn to add to its pose, and how puffed up it is. */
export function animOffset(a: PartAnim, t: number): { q: THREE.Quaternion; s: number } {
  const p = animP(a, t);
  const s = a.kind === 'breathe' ? 1 + (a.size / 100) * Math.sin(TAU * p) : 1;
  return { q: leanQuat(leanAt(a, p), a.flip), s };
}

/**
 * Reaching (see PartAnim.reach): where the tip goes, as a move from where it
 * rests, in the creature's own space (Y up, facing +Z). Sizes are the same
 * numbers as leaning, turned into distances along the limb (`reachLen`, the
 * length of the parts that bend). `dir` turns the motion from straight ahead;
 * it always lifts straight up.
 */
export function reachAt(a: PartAnim, p: number, reachLen: number): THREE.Vector3 {
  const [u, v] = motionShape(a, p);
  const k = reachLen * D;
  const { along, lift } = reachAxes(a);
  const out = new THREE.Vector3(a.x * k, 0, a.z * k).addScaledVector(along, u * a.size * k).addScaledVector(lift, v * a.size * k);
  // a right twin: everything mirrored across the creature
  if (a.flip) out.x = -out.x;
  return out;
}

/** The reaching motion's axes, before any mirroring: which way it goes (level), and which way it lifts. */
export function reachAxes(a: PartAnim): { along: THREE.Vector3; lift: THREE.Vector3 } {
  const along = new THREE.Vector3(Math.sin(a.dir * D), 0, Math.cos(a.dir * D));
  return { along, lift: new THREE.Vector3(0, 1, 0) };
}

/** Where the edge handle is when reaching: the end of the motion's `along` axis (as a move from the rest tip). */
export function reachRim(a: PartAnim, reachLen: number): THREE.Vector3 {
  const k = reachLen * D;
  const out = new THREE.Vector3(a.x * k, 0, a.z * k).addScaledVector(reachAxes(a).along, a.size * k);
  if (a.flip) out.x = -out.x;
  return out;
}

// ---------------------------------------------------------------------------
// Stuff motions: a looping move for a piece of stuff on a part, on the same
// loop as the parts (whole times round, so it closes).

export type StuffKind = 'orbit' | 'spin' | 'bob' | 'swing' | 'pulse';

export interface StuffAnim {
  kind: StuffKind;
  /** Swing: degrees each way; Pulse: percent bigger */
  size: number;
  /** times round per loop (a whole number, so it loops) */
  speed: number;
  /** timing offset, as a fraction of one time round (0..1) */
  phase: number;
  /** Orbit and Spin: go round the other way */
  reverse?: boolean;
  /** Orbit: how wide, against how far it's placed from the centre (1, unset: as placed). Only while it moves: its placement stays put */
  radius?: number;
  /** in the part's frame: what it goes round, spins round, swings from or grows from (the blue handle) */
  center: V3;
  /**
   * in the part's frame (the pink handle): the line it turns about (Orbit,
   * Spin, Swing: only its direction counts), or for Bob how far and which way
   * it floats
   */
  axis: V3;
}

export const STUFF_KINDS: { kind: StuffKind; name: string; icon: string; title: string }[] = [
  { kind: 'orbit', name: 'Orbit', icon: 'planet-ringed', title: 'Goes round a point: stars round a ring. Starts round the nearest other stuff on the part, or the part itself' },
  { kind: 'spin', name: 'Spin', icon: 'arrows-spin', title: 'Turns in place, round the way it faces: a halo, a propeller' },
  { kind: 'bob', name: 'Bob', icon: 'arrows-up-down', title: 'Floats up and down' },
  { kind: 'swing', name: 'Swing', icon: 'arrows-left-right', title: 'Rocks back and forth from where it’s attached: an earring, a tassel' },
  { kind: 'pulse', name: 'Pulse', icon: 'heart-pulse', title: 'Grows and shrinks' },
];

/**
 * The move (in the part's frame) a piece of stuff makes at `p` of one time
 * round, after its own placement. `from`: the item's middle (an Orbit wider
 * or narrower than placed pushes it out from the line it goes round).
 */
export function stuffMove(a: StuffAnim, p: number, from?: THREE.Vector3): THREE.Matrix4 {
  const c = new THREE.Vector3(...a.center);
  const around = (m: THREE.Matrix4) => new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  const axis = new THREE.Vector3(...a.axis);
  const unit = axis.lengthSq() > 1e-12 ? axis.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const wave = Math.sin(TAU * p);
  switch (a.kind) {
    case 'orbit':
    case 'spin': {
      const turn = around(new THREE.Matrix4().makeRotationAxis(unit, TAU * p * (a.reverse ? -1 : 1)));
      const k = a.kind === 'orbit' ? (a.radius ?? 1) : 1;
      if (k === 1 || !from) return turn;
      // out from the line it goes round, before it turns
      const out = orbitOut(a, from).multiplyScalar(k - 1);
      return turn.multiply(new THREE.Matrix4().makeTranslation(out.x, out.y, out.z));
    }
    case 'swing':
      return around(new THREE.Matrix4().makeRotationAxis(unit, a.size * D * wave));
    case 'bob':
      return new THREE.Matrix4().makeTranslation(axis.x * wave, axis.y * wave, axis.z * wave);
    case 'pulse': {
      const k = 1 + (a.size / 100) * wave;
      return around(new THREE.Matrix4().makeScale(k, k, k));
    }
  }
}

/** How far a piece of stuff (its middle at `from`) is out from the line an Orbit goes round: across the line, not along it. */
export function orbitOut(a: StuffAnim, from: THREE.Vector3): THREE.Vector3 {
  const axis = new THREE.Vector3(...a.axis);
  const unit = axis.lengthSq() > 1e-12 ? axis.normalize() : new THREE.Vector3(0, 1, 0);
  const d = from.clone().sub(new THREE.Vector3(...a.center));
  return d.addScaledVector(unit, -d.dot(unit));
}

/**
 * The same move on the other side of a pair hanging off a middle part: mirrored
 * across the creature's middle (x = 0 in that part's frame). Turning goes the
 * other way round, so its line keeps X and flips the rest (an axis turns that way under a mirror).
 */
export function mirrorMove(a: StuffAnim): StuffAnim {
  const [cx, cy, cz] = a.center;
  const [ax, ay, az] = a.axis;
  return { ...a, center: [-cx, cy, cz], axis: a.kind === 'bob' ? [-ax, ay, az] : [ax, -ay, -az] };
}

/** Where in one time round a piece of stuff is at loop time `t`. */
export function stuffP(a: StuffAnim, t: number): number {
  return (((t * Math.max(1, Math.round(a.speed)) + a.phase) % 1) + 1) % 1;
}
