// ---------------------------------------------------------------------------
// The gizmo that moves, turns and resizes: whole creatures, the picked
// part (see gizmoMode.ts), and a marking's placement (see src/markingPanel.ts).

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { markGizmoHeld } from '../markingPanel';
import { camera, canvas, scene } from './stage';
import { commit, creature, fitShadows } from './state';
import { controls, floorGap, lifted, setGapBefore, setKeepFloor } from './controls';
import { placing } from './arrange';
import { invalidate } from './loop';
import { captureRide } from './riders';
import { partGizmoChange, partGizmoDown, partGizmoUp } from './gizmoMode';

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

export function initGizmo() {
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
    // a part's arrows (see gizmoMode.ts)
    if (partGizmoChange()) return;
    if (placing) {
      creature.capturePlacement();
      // (one riding on another rides where it's put)
      captureRide(creature);
      fitShadows();
    }
  });
  gizmo.addEventListener('mouseDown', () => {
    if (partGizmoDown()) return;
    if (placing) setGapBefore(floorGap());
  });
  gizmo.addEventListener('mouseUp', () => {
    // (a marking's gizmo is seen to in src/markingPanel.ts)
    if (markGizmoHeld()) return;
    if (partGizmoUp()) return;
    if (placing && gizmo.mode === 'translate' && lifted()) setKeepFloor(false, true);
    commit();
  });
}
