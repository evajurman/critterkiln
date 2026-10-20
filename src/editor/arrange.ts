import * as THREE from 'three';
import { stopMarkTools } from '../markingPanel';
import { $ } from './dom';
import { commit, creature, fitShadows, mode, world } from './state';
import { creatureLabel, setKeepFloor, settleOnFloor, updateSkeletonVisibility } from './controls';
import { creatureBox } from './framing';
import { deselectAttachment, gizmo, selectedAttachment } from './attach';

// arranging creatures in the scene: the same gizmo moves, turns and resizes
// a whole creature anywhere in 3D

export let placing = false;
export type PlaceMode = 'translate' | 'rotate' | 'scale';

export function setPlaceMode(m: PlaceMode) {
  gizmo.setMode(m);
  // move along the scene's axes; turn and size about the creature's own
  gizmo.setSpace(m === 'translate' ? 'world' : 'local');
  document.querySelectorAll<HTMLButtonElement>('#place-bar [data-place]').forEach((b) => b.classList.toggle('on', b.dataset.place === m));
}

/** Arrange: rest the creature on the floor (its lowest point, stuff included, at floor level). */
function placeOnFloor() {
  const box = creatureBox(true);
  if (box.isEmpty()) return;
  creature.root.position.y -= box.min.y;
  creature.capturePlacement();
  setKeepFloor(true);
  fitShadows();
  commit();
}

export function startPlacing() {
  if (mode === 'stuff') return;
  if (selectedAttachment) deselectAttachment();
  stopMarkTools();
  placing = true;
  gizmo.showX = gizmo.showY = gizmo.showZ = true;
  gizmo.attach(creature.root);
  setPlaceMode('translate');
  $('#place-bar').hidden = false;
  $('#place-name').textContent = creatureLabel(world.active);
  $('#cr-place').classList.add('on');
  updateSkeletonVisibility();
}

export function stopPlacing() {
  if (!placing) return;
  placing = false;
  gizmo.detach();
  gizmo.setSpace('local');
  $('#place-bar').hidden = true;
  $('#cr-place').classList.remove('on');
  updateSkeletonVisibility();
}

export function initArrange() {
  document.querySelectorAll<HTMLButtonElement>('#place-bar [data-place]').forEach((b) => {
    b.onclick = () => setPlaceMode(b.dataset.place as PlaceMode);
  });
  $('#place-floor').onclick = () => placeOnFloor();
  $('#place-reset').onclick = () => {
    // upright, normal size, still facing the same way
    const yaw = new THREE.Euler().setFromQuaternion(creature.root.quaternion, 'YXZ').y;
    creature.root.rotation.set(0, yaw, 0);
    creature.root.scale.setScalar(1);
    creature.root.position.y = 0;
    creature.capturePlacement();
    setKeepFloor(true);
    settleOnFloor();
    fitShadows();
    commit();
  };
  $('#place-done').onclick = () => {
    stopPlacing();
    commit(); // records the move if anything changed (no-op otherwise)
  };
}
