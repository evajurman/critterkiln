// ---------------------------------------------------------------------------
// Copy and paste: a part and everything on it, pasted where the pointer is on
// the creature (or beside where it came from).

import * as THREE from 'three';
import { type BoneRT, type PartState } from '../creature';
import { copyLimb, flipLimbClip, partIds, pasteLimb, type LimbClip, type V3 } from '../rigs';
import { movedMarking } from '../markings';
import { creature, idle, selected, setIdle, state } from './state';
import { drawState } from './drawing';
import { hover, raycaster, setRay, updateSkeletonVisibility } from './controls';
import { placing } from './arrange';
import { rigEdit } from './rigEdit';
import { flashPart } from './partPanel';
import { hint } from './hints';
import { chooseCopy, linkOf, thingTop } from './kits';
import { canvas } from './stage';

type Clip = { limb: LimbClip; parts: Record<string, PartState>; pastes: number };
export let clip: Clip | null = null;

/**
 * Copy the picked part (and everything on it). A thing kept apart from the
 * body asks first: a linked duplicate, or a copy of its own. False when
 * nothing copyable is picked.
 */
export function copyPicked(): boolean {
  if (drawState || idle || placing || !creature.bones.get(selected)) return false;
  const limb = copyLimb(state.rig, selected);
  if (!limb) {
    hint("The first part holds everything else, so it can't be copied", 2000, true);
    return true;
  }
  const top = thingTop(creature, selected);
  const picked = creature.bones.get(selected)!;
  if (top && (top === picked || creature.twinOf(top) === picked)) {
    const at = hover.over ? hover : (() => {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })();
    chooseCopy(at.x, at.y, (linked) => keep(limb, linked ? linkOf(top) : null));
    return true;
  }
  keep(limb, undefined);
  return true;
}

/** Keep what was copied: with `link` its top joins those linked duplicates, with null it's a copy of its own (undefined: as it is). */
function keep(limb: LimbClip, link: string | null | undefined) {
  const parts: Record<string, PartState> = {};
  for (const d of limb.bones) for (const id of partIds(d)) if (state.parts[id]) parts[id] = structuredClone(state.parts[id]);
  for (const id of partIds(limb.bones[0])) {
    const p = parts[id];
    if (!p || link === undefined) continue;
    if (link) p.link = link;
    else delete p.link;
  }
  clip = { limb, parts, pastes: 0 };
  hint(link ? 'Copied: a linked duplicate (Ctrl+V to put it down)' : limb.bones.length > 1 ? 'Copied the part and everything on it' : 'Copied the part', 1600);
}

/** Paste what was copied: it goes where `at` (the pointer, by default) is on the creature. */
export function pasteClip(at: { x: number; y: number } | null = hover.over ? hover : null): boolean {
  if (!clip || drawState || placing) return false;
  const c = clip;
  const n = ++c.pastes;
  const spot = (at && surfaceUnderPointer(at.x, at.y)) || fallbackSpot(c.limb, n);
  if (!spot) return false;
  const top = c.limb.bones[0];
  const { on } = spot;
  let point = spot.point;
  let limb = c.limb;
  let flipped = false;
  const side = (v: number) => (Math.abs(v) > 0.02 ? Math.sign(v) : 0);
  if (top.mirror) {
    // a pair is defined by its left twin (on +X): the right one lands on the spot then
    if (point[0] < 0) point = [-point[0], point[1], point[2]];
  } else if (side(point[0]) * side(top.start[0]) < 0) {
    // a single part pasted on the creature's other side comes as its mirror image (pointing out, not in)
    limb = flipLimbClip(limb);
    flipped = true;
  }
  const from = limb.bones[0].start;
  const offset: V3 = [point[0] - from[0], point[1] - from[1], point[2] - from[2]];
  // a pair hangs off a pair as a whole; anything else off the part it's on
  const parent = top.mirror && on.def.sideSign !== 0 ? on.def.baseId : on.def.id;
  rigEdit((rig) => {
    const copies = pasteLimb(rig, limb, selected, offset, parent);
    // their markings go with them (moved, and mirrored if they were)
    const moved = new THREE.Matrix4().makeTranslation(...offset).multiply(new THREE.Matrix4().makeScale(flipped ? -1 : 1, 1, 1));
    for (const p of copies) {
      if (!c.parts[p.from]) continue;
      const part = structuredClone(c.parts[p.from]);
      if (part.markings) part.markings = part.markings.map((mk) => movedMarking(mk, moved));
      state.parts[p.to] = part;
    }
    return copies;
  }, true);
  setIdle(false);
  updateSkeletonVisibility();
  flashPart();
  hint('Pasted', 1000);
  return true;
}

/** A part's own frame (Z mirrored on a right twin, as surfaceAt gives it) to skeleton coordinates, and back. */
function frameToSkeleton(b: BoneRT, v: THREE.Vector3): THREE.Vector3 {
  return v.applyMatrix4(b.restWorld);
}
function skeletonToFrame(b: BoneRT, v: THREE.Vector3): THREE.Vector3 {
  return v.applyMatrix4(b.restWorld.clone().invert());
}

const round3 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1000) / 1000) as V3;

/**
 * The spot on the creature under the pointer (a little inside the surface), in
 * skeleton coordinates (where it is on the unposed creature), and the part it's on.
 */
function surfaceUnderPointer(x: number, y: number): { on: BoneRT; point: V3 } | null {
  setRay(x, y);
  const hit = creature.surfaceAt(raycaster);
  if (!hit) return null;
  return { on: hit.bone, point: round3(frameToSkeleton(hit.bone, hit.local.clone().addScaledVector(hit.localNormal, -0.03))) };
}

/**
 * Where a copied limb goes with nothing under the pointer: on the surface of
 * the part it came off (if it's here), otherwise the picked part, at its
 * middle, on the side the limb was on; each paste after slides along the part
 * so they don't stack (and keeps clear of the original).
 */
function fallbackSpot(limb: LimbClip, n: number): { on: BoneRT; point: V3 } | null {
  const top = limb.bones[0];
  const twin = (id: string | undefined) => (id ? (creature.bones.get(id) ?? creature.bones.get(id + 'L')) : undefined);
  const orig = twin(top.parent);
  const on = orig ?? creature.bones.get(selected) ?? creature.list[0];
  if (!on) return null;
  const start = new THREE.Vector3(...on.def.start);
  const axis = new THREE.Vector3(...on.def.end).sub(start);
  const len = axis.length() || 1;
  axis.divideScalar(len);
  const was = new THREE.Vector3(...top.start);
  const wasAlong = was.clone().sub(start).dot(axis) / len;
  // the original's still here: keep clear of where it sits
  const here = !!orig && limb.bones.some((d) => state.rig.bones.some((b) => b.id === d.id));
  const spots = [0.5, 0.3, 0.7, 0.15, 0.85].filter((f) => !here || Math.abs(f - wasAlong) > 0.12);
  const along = spots[(n - 1) % spots.length];
  const mid = start.clone().addScaledVector(axis, along * len);
  // which way out of the part: toward where the limb was, on the part it came off; otherwise the
  // part's own side of the creature (a part down the middle: the limb's side, or the front)
  const sideOf = (v: number) => (Math.abs(v) > 0.02 ? Math.sign(v) : 0);
  const out = orig
    ? was.clone().sub(mid)
    : new THREE.Vector3(sideOf(mid.x) || (top.mirror ? 1 : sideOf(top.start[0])), 0, 0);
  if (out.lengthSq() < 1e-8) out.set(...(state.rig.eyeDir ?? [0, 0, 1]));
  // square to the part (a part lying along that way: its front, or up)
  for (const v of [out.clone(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]) {
    out.copy(v).addScaledVector(axis, -v.dot(axis));
    if (out.lengthSq() > 1e-6) break;
  }
  out.normalize();
  // aim at the part from outside, on that side, to find its surface
  on.pivot.updateMatrixWorld(true);
  const flip = (v: THREE.Vector3) => (on.def.sideSign === -1 ? v.setZ(-v.z) : v);
  const far = on.pivot.localToWorld(flip(skeletonToFrame(on, mid.clone().addScaledVector(out, 10))));
  const near = on.pivot.localToWorld(flip(skeletonToFrame(on, mid.clone())));
  raycaster.set(far, near.clone().sub(far).normalize());
  const hit = on.mesh ? raycaster.intersectObject(on.mesh, false)[0] : undefined;
  if (!hit?.face) return { on, point: round3(mid.addScaledVector(out, on.def.width * 0.42)) };
  const inward = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).negate();
  const local = flip(on.pivot.worldToLocal(hit.point.clone().addScaledVector(inward, 0.03)));
  return { on, point: round3(frameToSkeleton(on, local)) };
}

