// ---------------------------------------------------------------------------
// Depth of field: focus follows the orbit target, nudged by `offset`.

import * as THREE from 'three';
import { unlock } from '../achievements';
import { $ } from './dom';
import { camera, scene } from './stage';
import { bokeh } from './post';
import { creatures, mode } from './state';
import { controls, raycaster, setRay } from './controls';
import { board } from './workbench';
import { hint } from './hints';

const DOF_KEY = 'creature-creator/dof';
export const dof: { enabled: boolean; offset: number; blur: number } = (() => {
  try {
    return { enabled: false, offset: 0, blur: 0.35, ...JSON.parse(localStorage.getItem(DOF_KEY) ?? '{}') };
  } catch {
    return { enabled: false, offset: 0, blur: 0.35 };
  }
})();
export let pickingFocus = false;
export let focusMarkerUntil = 0;

// a ring floating on the focus plane, shown briefly while focus changes
const focusMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.2, 0.215, 64),
  new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8, depthTest: false }),
);
focusMarker.renderOrder = 1001;
focusMarker.visible = false;

export function saveDof() {
  try {
    localStorage.setItem(DOF_KEY, JSON.stringify(dof));
  } catch {
    /* ignore */
  }
}

function focusDistance() {
  return Math.max(0.2, camera.position.distanceTo(controls.target) + dof.offset);
}

export function applyDof() {
  // the workbench is always sharp; the photo blur comes back with the scene
  bokeh.enabled = dof.enabled && mode !== 'stuff';
  // blur 0..1 maps onto the lens aperture; maxblur caps the spread
  const u = bokeh.uniforms as Record<string, THREE.IUniform>;
  u.aperture.value = 0.0004 + Math.pow(dof.blur, 2) * 0.03;
  u.maxblur.value = 0.004 + dof.blur * 0.026;
  $<HTMLInputElement>('#dof').checked = dof.enabled;
  $<HTMLInputElement>('#dof-focus').value = String(dof.offset);
  $<HTMLInputElement>('#dof-blur').value = String(dof.blur);
  $('#dof-controls').style.opacity = dof.enabled ? '1' : '.4';
  $('#dof-pick').classList.toggle('on', pickingFocus);
}

function showFocusMarker() {
  focusMarkerUntil = performance.now() + 1200;
}

export function updateFocus(now: number) {
  const d = focusDistance();
  (bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = d;
  const show = bokeh.enabled && now < focusMarkerUntil;
  focusMarker.visible = show;
  if (show) {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    focusMarker.position.copy(camera.position).addScaledVector(dir, d);
    focusMarker.quaternion.copy(camera.quaternion);
    // keep the ring a constant size on screen
    focusMarker.scale.setScalar(d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9);
    (focusMarker.material as THREE.MeshBasicMaterial).opacity = Math.min(0.8, (focusMarkerUntil - now) / 400);
  }
}

/** Click-to-focus: put the focus plane on whatever is under the pointer. */
export function focusAt(x: number, y: number) {
  setRay(x, y);
  const targets = mode === 'stuff' ? [board] : creatures.map((c) => c.root);
  const hit = raycaster.intersectObjects(targets, true).find((h) => h.object instanceof THREE.Mesh && h.object.visible);
  const point = hit?.point ?? raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  if (!point) return;
  const depth = point.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()));
  dof.offset = THREE.MathUtils.clamp(depth - camera.position.distanceTo(controls.target), -3, 3);
  dof.enabled = true;
  unlock('dof');
  pickingFocus = false;
  saveDof();
  applyDof();
  showFocusMarker();
  $('#viewport').style.cursor = '';
  hint('Focus set', 1200);
}

export function initDof() {
  scene.add(focusMarker);
  $<HTMLInputElement>('#dof').onchange = (e) => {
    dof.enabled = (e.target as HTMLInputElement).checked;
    if (dof.enabled) unlock('dof');
    saveDof();
    applyDof();
    if (dof.enabled) showFocusMarker();
  };
  $<HTMLInputElement>('#dof-focus').oninput = (e) => {
    dof.offset = parseFloat((e.target as HTMLInputElement).value);
    saveDof();
    showFocusMarker();
  };
  $<HTMLInputElement>('#dof-blur').oninput = (e) => {
    dof.blur = parseFloat((e.target as HTMLInputElement).value);
    saveDof();
    applyDof();
  };
  $('#dof-reset').onclick = () => {
    dof.offset = 0;
    saveDof();
    applyDof();
    showFocusMarker();
  };
  $('#dof-pick').onclick = () => {
    pickingFocus = !pickingFocus;
    applyDof();
    $('#viewport').style.cursor = pickingFocus ? 'crosshair' : '';
    if (pickingFocus) hint('Click on the spot that should be sharp', 0);
    else hint('');
  };
  applyDof();
}
