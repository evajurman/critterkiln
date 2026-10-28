// ---------------------------------------------------------------------------
// Arranging creatures in the scene: the gizmo moves, turns and resizes a whole
// creature anywhere in 3D (picked with the handles button on the view cube).

import * as THREE from 'three';
import { stopMarkTools } from '../markingPanel';
import { commit, creature, fitShadows } from './state';
import { setKeepFloor, settleOnFloor, updateSkeletonVisibility } from './controls';
import { creatureBox } from './framing';
import { gizmo } from './gizmo';
import { placingChanged } from './gizmoMode';

export let placing = false;
export type PlaceMode = 'translate' | 'rotate' | 'scale';

export function setPlaceMode(m: PlaceMode) {
  gizmo.setMode(m);
  // move along the scene's axes; turn and size about the creature's own
  gizmo.setSpace(m === 'translate' ? 'world' : 'local');
}

/** Rest the creature on the floor (its lowest point at floor level). */
export function placeOnFloor() {
  const box = creatureBox(true);
  if (box.isEmpty()) return;
  creature.root.position.y -= box.min.y;
  creature.capturePlacement();
  setKeepFloor(true);
  fitShadows();
  commit();
}

/** Upright on the floor at its normal size, still facing the same way. */
export function resetPlacement() {
  const yaw = new THREE.Euler().setFromQuaternion(creature.root.quaternion, 'YXZ').y;
  creature.root.rotation.set(0, yaw, 0);
  creature.root.scale.setScalar(1);
  creature.root.position.y = 0;
  creature.capturePlacement();
  setKeepFloor(true);
  settleOnFloor();
  fitShadows();
  commit();
}

/** The handles on the whole creature (Move, Rotate or Scale with nothing picked, or the first part: see gizmoMode.ts). */
export function startPlacing() {
  stopMarkTools();
  placing = true;
  gizmo.showX = gizmo.showY = gizmo.showZ = true;
  gizmo.attach(creature.root);
  setPlaceMode('translate');
  placingChanged(true);
  updateSkeletonVisibility();
}

export function stopPlacing() {
  if (!placing) return;
  placing = false;
  gizmo.detach();
  gizmo.setSpace('local');
  placingChanged(false);
  updateSkeletonVisibility();
}
