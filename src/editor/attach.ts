// ---------------------------------------------------------------------------
// Attaching stuff to body parts: the gizmo that moves, turns and resizes worn
// stuff, and which worn thing is picked.

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { type Attachment } from '../creature';
import { markGizmoHeld, stopMarkTools } from '../markingPanel';
import { type V3 } from '../rigs';
import { $ } from './dom';
import { camera, canvas, scene } from './stage';
import { commit, creature, fitShadows, state } from './state';
import { controls, floorGap, gapBefore, lifted, setGapBefore, setKeepFloor, updateSkeletonVisibility } from './controls';
import { bakePiece, mirrorTwinLive, piecePivot } from './workbench';
import { placing, stopPlacing } from './arrange';
import { syncAttachBar } from './attachPanel';
import { renderCreatureStuff } from './carry';
import { invalidate } from './loop';

/**
 * TransformControls whose centre scale cube follows the mouse sideways: left shrinks, right
 * grows (every 150px halves or doubles). Stock, it measures from the centre, and the cube sits
 * so close to it that there was hardly any room to shrink. The axis handles are the stock ones,
 * kept from going through zero.
 */
class SideScaleControls extends TransformControls {
  private scaleFromX = 0;
  private readonly scaleFrom = new THREE.Vector3();

  pointerDown(pointer: PointerEvent | null) {
    super.pointerDown(pointer);
    if (!this.dragging || !this.object || !pointer) return;
    this.scaleFromX = pointer.x;
    this.scaleFrom.copy(this.object.scale);
  }

  pointerMove(pointer: PointerEvent | null) {
    const axis = this.axis;
    const obj = this.object;
    if (this.mode !== 'scale' || !this.dragging || !obj || !pointer || pointer.button !== -1) {
      super.pointerMove(pointer);
      return;
    }
    if (axis !== 'XYZ') {
      // stock, an axis dragged through the centre goes to 0 and then negative, and jitter there
      // flips the thing inside out every frame: stop each axis at 5% of where it started
      super.pointerMove(pointer);
      const s = obj.scale;
      const f = this.scaleFrom;
      if (s.x >= f.x * 0.05 && s.y >= f.y * 0.05 && s.z >= f.z * 0.05) return;
      s.set(Math.max(s.x, f.x * 0.05), Math.max(s.y, f.y * 0.05), Math.max(s.z, f.z * 0.05));
      obj.updateMatrixWorld();
      this.dispatchEvent({ type: 'change' });
      this.dispatchEvent({ type: 'objectChange' });
      return;
    }
    // pointer.x runs -1..1 across the canvas
    const px = ((pointer.x - this.scaleFromX) * (this.domElement as HTMLElement).clientWidth) / 2;
    obj.scale.copy(this.scaleFrom).multiplyScalar(2 ** (px / 150));
    obj.updateMatrixWorld();
    this.dispatchEvent({ type: 'change' });
    this.dispatchEvent({ type: 'objectChange' });
  }
}

export let gizmo: SideScaleControls;

export let selectedAttachment = '';

export function currentAttachment(): Attachment | undefined {
  return state.attachments?.find((a) => a.id === selectedAttachment);
}

export function selectAttachment(id: string) {
  const obj = creature.attachmentObject(id);
  if (!obj) return deselectAttachment();
  stopPlacing();
  stopMarkTools();
  selectedAttachment = id;
  gizmo.showX = gizmo.showY = gizmo.showZ = true;
  gizmo.attach(obj);
  $('#attach-bar').hidden = false;
  syncAttachBar();
  updateSkeletonVisibility();
  renderCreatureStuff();
}

export function deselectAttachment() {
  selectedAttachment = '';
  if (!placing) gizmo.detach();
  $('#attach-bar').hidden = true;
  $('#attach-mat-pop').hidden = true;
  // (also called while a world is being swapped, between creatures)
  if (creature) updateSkeletonVisibility();
  renderCreatureStuff();
}

export function initAttach() {
  gizmo = new SideScaleControls(camera, canvas);
  gizmo.setSpace('local');
  gizmo.setSize(0.8);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !(e as unknown as { value: boolean }).value;
  });
  gizmo.addEventListener('objectChange', () => {
    invalidate();
    if (markGizmoHeld()) return;
    if (piecePivot && gizmo.object === piecePivot) {
      mirrorTwinLive();
      return;
    }
    if (placing) {
      creature.capturePlacement();
      fitShadows();
      return;
    }
    const a = currentAttachment();
    const obj = gizmo.object;
    if (!a || !obj) return;
    a.position = obj.position.toArray() as V3;
    a.quaternion = obj.quaternion.toArray() as [number, number, number, number];
    a.scale = obj.scale.toArray() as V3;
    creature.updateTwin(a.id);
  });
  gizmo.addEventListener('mouseDown', () => {
    if (placing) setGapBefore(floorGap());
  });
  gizmo.addEventListener('mouseUp', () => {
    if (piecePivot && gizmo.object === piecePivot) {
      bakePiece();
      return;
    }
    // (a marking's gizmo is seen to in src/markingPanel.ts)
    if (markGizmoHeld()) return;
    // a rescaled felt attachment regrows its fuzz at the new size
    if (selectedAttachment) creature.syncAttachments();
    if (placing && gizmo.mode === 'translate' && lifted()) setKeepFloor(false, true);
    commit();
  });
}
