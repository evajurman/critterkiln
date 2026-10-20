// ---------------------------------------------------------------------------
// Moving the camera: tweening it, framing a creature or the whole scene,
// looking from the front, side or top, and setting creatures on the floor.

import * as THREE from 'three';
import { type BoneRT } from '../creature';
import { moveJoint, type V3 } from '../rigs';
import { $ } from './dom';
import { camera, ORTHO_KEY, sceneOrtho, setOrtho, setSceneOrtho } from './stage';
import { buildCreature, commit, creature, creatures, mode, selected, state } from './state';
import { controls, setKeepFloor, settleOnFloor } from './controls';
import { bench, board, focusOnBoard } from './workbench';
import { selectPart } from './partPanel';
import { rigLocked } from './rigEdit';
import { hint } from './hints';

// camera tweening

export let tween: { p0: THREE.Vector3; p1: THREE.Vector3; t0v: THREE.Vector3; t1v: THREE.Vector3; start: number; dur: number } | null = null;
export function setTween(v: typeof tween) {
  tween = v;
}

export function flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 650) {
  tween = { p0: camera.position.clone(), p1: pos, t0v: controls.target.clone(), t1v: target, start: performance.now(), dur };
}

/** Tight bounds of the posed creature: body parts plus any stuff it's wearing. */
export function creatureBox(precise = false): THREE.Box3 {
  creature.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  // parts count even while hidden: a settled seamless skin hides the parts it
  // replaced, which used to leave an empty box (and camera views did nothing)
  for (const m of creature.meshes()) box.expandByObject(m, precise);
  for (const m of creature.attachmentMeshes()) if (m.visible) box.expandByObject(m, precise);
  return box;
}

const THREE_QUARTER = new THREE.Vector3(0.62, 0.32, 0.72).normalize();

/** Frame every creature in the scene, keeping the current viewing angle. */
/** Fly to frame every creature, from the current angle or (`fresh`) the usual three-quarter one. */
export function frameAll(fresh = false) {
  const box = new THREE.Box3();
  for (const c of creatures) {
    c.root.updateMatrixWorld(true);
    for (const m of c.meshes()) box.expandByObject(m);
  }
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const dir = fresh ? THREE_QUARTER.clone().normalize() : camera.position.clone().sub(controls.target).normalize();
  const dist = (radius * 0.95) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  flyTo(center.clone().addScaledVector(dir, Math.max(dist, 2)), center);
}

/** A scene that kept no view of its own (saved before views were): seen afresh, not from the last scene's angle. */
export function freshView() {
  if (sceneOrtho) {
    setSceneOrtho(false);
    try {
      localStorage.setItem(ORTHO_KEY, '0');
    } catch {
      /* ignore */
    }
    if (mode !== 'stuff') setOrtho(false);
  }
  frameAll(true);
}

/** Fly to frame the creature, keeping the current angle unless a view direction is given. */
export function frameCreature(view: boolean | THREE.Vector3 = false) {
  const box = creatureBox();
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const dir =
    view instanceof THREE.Vector3
      ? view.clone().normalize()
      : view
        ? THREE_QUARTER.clone()
        : camera.position.clone().sub(controls.target).normalize();
  const dist = (radius * 0.95) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  flyTo(center.clone().addScaledVector(dir, Math.max(dist, 2)), center);
}

// The creature faces +Z; "left"/"right" are as seen by someone facing it.
// Top is nudged off the pole so the orbit camera keeps a sensible "up".
const VIEWS: Record<string, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0.002),
  quarter: THREE_QUARTER,
};

function viewFrom(name: string) {
  if (name === 'all' || name === 'selection') {
    if (mode === 'stuff') focusOnBoard();
    else if (name === 'all') frameAll();
    else frameCreature();
    return;
  }
  const dir = VIEWS[name];
  if (!dir) return;
  controls.autoRotate = false;
  $('#spin').classList.remove('on');
  if (mode === 'stuff') {
    const c = board.getWorldPosition(new THREE.Vector3());
    let r = 0.7;
    if (bench) {
      const box = new THREE.Box3().setFromObject(bench);
      if (!box.isEmpty()) {
        box.getCenter(c);
        r = Math.max(0.5, box.getSize(new THREE.Vector3()).length() * 0.7);
      }
    }
    const dist = Math.max(1.4, r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    flyTo(c.clone().addScaledVector(dir.clone().normalize(), dist), c);
    return;
  }
  frameCreature(dir);
}

/** Pose mode: lower (or raise) the whole creature so its lowest point rests on the floor. */
function dropToFloor() {
  const box = creatureBox(true);
  if (box.isEmpty()) return;
  if (Math.abs(box.min.y) < 1e-4) {
    if (state.keepFloor === false) {
      setKeepFloor(true);
      commit();
    }
    hint('Already on the floor', 1500);
    return;
  }
  // the creature may be turned or resized: the drop is straight down in the scene
  const down = creature.root.worldToLocal(new THREE.Vector3(0, -box.min.y, 0)).sub(creature.root.worldToLocal(new THREE.Vector3()));
  creature.group.position.add(down);
  creature.capturePose();
  setKeepFloor(true);
  commit();
  hint('Dropped to the floor', 1500);
}

/**
 * Move the picked part straight down (or up) until its lowest point touches
 * the floor: its base slides, as dragging the purple grip, so it keeps its
 * shape and pose. The first part holds everything: that's the whole creature.
 */
export function partToFloor(id = selected) {
  const b = creature.bones.get(id);
  if (!b) return;
  if (!b.parent) return dropToFloor();
  const low = creature.lowestPoint(b);
  if (!low) return;
  if (Math.abs(low.y) < 1e-3) {
    hint('Already on the floor', 1500);
    return;
  }
  // the move in skeleton coordinates (the creature may be turned or posed, as a slid base)
  b.pivot.updateMatrixWorld(true);
  const unbent = b.pivot.parent!.matrixWorld.clone().multiply(new THREE.Matrix4().compose(b.pivot.position, b.restQuat, new THREE.Vector3(1, 1, 1)));
  const toDef = new THREE.Matrix3().setFromMatrix4(b.restWorld.clone().multiply(unbent.invert()));
  const d = new THREE.Vector3(0, -low.y, 0).applyMatrix3(toDef);
  moveJoint(state.rig, id, 'start', d.toArray() as V3, rigLocked());
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  settleOnFloor();
  creature.boing(id);
  commit();
  selectPart(id, false);
  hint('Down to the floor', 1500);
}

/** Face the part straight on: from the front, or from the side when it's being drawn from the side. */
export function focusOnBone(b: BoneRT, side = false) {
  b.pivot.updateMatrixWorld(true);
  const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
  if (geo && !geo.boundingBox) geo.computeBoundingBox();
  const box = geo?.boundingBox ?? new THREE.Box3(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, b.length, 0.1));
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // the middle of the drawing plane, not of the whole part
  if (side) centre.x = 0;
  else centre.z = 0;
  const center = b.pivot.localToWorld(centre);
  const r = Math.max(side ? size.z : size.x, size.y, b.length) / 2;
  const normal = new THREE.Vector3(side ? 1 : 0, 0, side ? 0 : 1).transformDirection(b.pivot.matrixWorld);
  const toCam = camera.position.clone().sub(controls.target).normalize();
  if (normal.dot(toCam) < 0) normal.negate();
  if (Math.abs(normal.y) > 0.97) normal.add(new THREE.Vector3(0, 0, 0.1)).normalize(); // dodge orbit pole
  const dist = (r * 2.2 + 0.3) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  flyTo(center.clone().addScaledVector(normal, dist), center);
}

export function initFraming() {
  $('#reset-pose').onclick = () => {
    creature.resetPose();
    settleOnFloor();
    commit();
    hint('Pose reset', 1400);
  };
  $('#drop-floor').onclick = () => dropToFloor();
  $<HTMLInputElement>('#keep-floor').onchange = (e) => {
    setKeepFloor((e.target as HTMLInputElement).checked);
    settleOnFloor();
    commit();
  };
  document.querySelectorAll<HTMLButtonElement>('#view-bar [data-view]').forEach((b) => (b.onclick = () => viewFrom(b.dataset.view!)));
  document.querySelectorAll<HTMLButtonElement>('#view-proj [data-proj]').forEach((b) => {
    b.onclick = () => {
      const on = b.dataset.proj === 'ortho';
      // on the workbench it's just for now; in Shape and Look it's remembered
      if (mode !== 'stuff') {
        setSceneOrtho(on);
        try {
          localStorage.setItem(ORTHO_KEY, on ? '1' : '0');
        } catch {
          /* ignore */
        }
      }
      setOrtho(on);
    };
  });
}
