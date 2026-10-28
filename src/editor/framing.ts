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
import { selectPart } from './partPanel';
import { rigLocked } from './rigEdit';
import { hint } from './hints';
import { invalidate } from './loop';

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
  return box;
}

const THREE_QUARTER = new THREE.Vector3(0.62, 0.32, 0.72).normalize();

/**
 * The view's half-angle that's tighter: up and down in a wide view, across in an
 * upright one (a phone), so what's framed fits both ways.
 */
function fitHalfAngle(): number {
  const v = THREE.MathUtils.degToRad(camera.fov / 2);
  return Math.min(v, Math.atan(Math.tan(v) * camera.aspect));
}

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
  const dist = (radius * 0.95) / Math.tan(fitHalfAngle());
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
    setOrtho(false);
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
  const dist = (radius * 0.95) / Math.tan(fitHalfAngle());
  flyTo(center.clone().addScaledVector(dir, Math.max(dist, 2)), center);
}

// The creature faces +Z; "left"/"right" are as seen by someone facing it.
// Top is nudged off the pole so the orbit camera keeps a sensible "up".
const VIEWS: Record<string, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0.002),
  bottom: new THREE.Vector3(0, -1, 0.002),
  quarter: THREE_QUARTER,
};

// ---------------------------------------------------------------------------
// The view cube (after Fusion's ViewCube, with Blender's ring round its foot):
// a little cube turned the way the scene is, so you can see which side you're
// looking from. Click a side, an edge or a corner to look from there; drag it
// to turn the view round the spot it orbits; looking straight at a side,
// arrows step to the next side over. Home is the three-quarter view.

/**
 * The cube's sides: which way each faces, and which ways its spots' columns
 * (left to right) and rows (top to bottom) go, all in the scene's axes. The
 * page draws them with the same turns (style.css).
 */
const FACES: { id: string; label: string; n: V3; across: V3; down: V3 }[] = [
  { id: 'front', label: 'Front', n: [0, 0, 1], across: [1, 0, 0], down: [0, -1, 0] },
  { id: 'back', label: 'Back', n: [0, 0, -1], across: [-1, 0, 0], down: [0, -1, 0] },
  { id: 'right', label: 'Right', n: [1, 0, 0], across: [0, 0, -1], down: [0, -1, 0] },
  { id: 'left', label: 'Left', n: [-1, 0, 0], across: [0, 0, 1], down: [0, -1, 0] },
  { id: 'top', label: 'Top', n: [0, 1, 0], across: [1, 0, 0], down: [0, 0, 1] },
  { id: 'bottom', label: 'Under', n: [0, -1, 0], across: [1, 0, 0], down: [0, 0, -1] },
];
/** "the front, left and above": where a direction looks from, in words */
function fromWhere(d: THREE.Vector3): string {
  const parts = [d.z > 0 ? 'the front' : d.z < 0 ? 'the back' : '', d.x > 0 ? 'the right' : d.x < 0 ? 'the left' : '', d.y > 0 ? 'above' : d.y < 0 ? 'below' : ''].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}
/** Each side of the cube: 3 by 3 spots to click, the middle one its side, the others its edges and corners; and the ring on the floor under it. */
function buildViewCube() {
  const cube = $('#cube');
  for (const f of FACES) {
    const face = document.createElement('div');
    face.className = 'face';
    face.dataset.face = f.id;
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        const dir = new THREE.Vector3(...f.n).addScaledVector(new THREE.Vector3(...f.across), col).addScaledVector(new THREE.Vector3(...f.down), row);
        const spot = document.createElement('button');
        spot.className = 'spot' + (row || col ? (row && col ? ' corner' : ' edge') : ' middle');
        spot.setAttribute('aria-label', `View from ${fromWhere(dir)}`);
        if (!row && !col) spot.textContent = f.label;
        spot.onclick = () => lookFrom(dir.clone().normalize());
        face.append(spot);
      }
    }
    cube.append(face);
  }
  // round the cube's foot, the front marked: which way the creature faces, even from above
  const ring = document.createElement('div');
  ring.className = 'cube-ring';
  ring.setAttribute('aria-hidden', 'true');
  cube.append(ring);
}

/** The nearest of the six straight-on directions to `v`. */
function nearestSide(v: THREE.Vector3): THREE.Vector3 {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = a.indexOf(Math.max(...a));
  return new THREE.Vector3().setComponent(i, Math.sign(v.getComponent(i)));
}
/** Looking straight at a side: on to the side above, below, left or right of it (as the cube shows them). */
function stepView(way: string) {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const d = way === 'up' ? up : way === 'down' ? up.negate() : way === 'right' ? right : right.negate();
  lookFrom(nearestSide(d));
}

const lastTurn = new THREE.Quaternion(NaN, 0, 0, 0);
/** Turn the cube with the camera, and shade its sides by how squarely they face you (each frame; only when the camera has turned). */
export function syncViewCube() {
  if (lastTurn.equals(camera.quaternion)) return;
  lastTurn.copy(camera.quaternion);
  const e = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion.clone().invert()).elements.slice();
  // three's y is up, the page's is down: flip the terms that mix y with x or z
  for (const i of [1, 4, 6, 9]) e[i] = -e[i];
  $('#cube').style.transform = `matrix3d(${e.map((v) => v.toFixed(5)).join(',')})`;
  const toEye = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  for (const face of document.querySelectorAll<HTMLElement>('#cube .face')) {
    const f = FACES.find((o) => o.id === face.dataset.face)!;
    face.style.setProperty('--lit', (0.8 + 0.2 * Math.max(0, toEye.dot(new THREE.Vector3(...f.n)))).toFixed(3));
  }
  // straight at a side: the arrows to the sides round it
  $('#view-cube').classList.toggle('face-on', Math.max(Math.abs(toEye.x), Math.abs(toEye.y), Math.abs(toEye.z)) > 0.995);
}

function initViewCube() {
  buildViewCube();
  const wrap = $('#view-cube');
  wrap.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => (b.onclick = () => stepView(b.dataset.step!)));
  // (the pointer is only held once it's really dragging: held from the start, a click would land on the cube, not the spot)
  let drag: { x: number; y: number; moved: boolean } | null = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag || !(e.buttons & 1)) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('turning');
      setTween(null);
      controls.autoRotate = false;
      $('#spin').classList.remove('on');
      controls.dispatchEvent({ type: 'start' });
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    // round the spot it orbits: sideways turns it, up and down tips it (never quite over the top)
    const offset = camera.position.clone().sub(controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta -= dx * 0.012;
    s.phi = THREE.MathUtils.clamp(s.phi - dy * 0.012, 0.02, Math.PI - 0.02);
    camera.position.copy(controls.target).add(offset.setFromSpherical(s));
    camera.lookAt(controls.target);
    // (the cube turns all the way round, underneath too)
    controls.maxPolarAngle = Math.PI;
    controls.update();
    invalidate();
  });
  const end = () => {
    if (drag?.moved) {
      controls.dispatchEvent({ type: 'end' });
      wrap.classList.remove('turning');
      // (a drag isn't a click on whatever it ends over: only the click straight after it is dropped)
      const stop = (e: Event) => e.stopPropagation();
      wrap.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => wrap.removeEventListener('click', stop, { capture: true }));
    }
    drag = null;
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', () => {
    wrap.classList.remove('turning');
    drag = null;
  });
}

function viewFrom(name: string) {
  if (name === 'all' || name === 'selection') {
    if (name === 'all') frameAll();
    else frameCreature();
    return;
  }
  if (VIEWS[name]) lookFrom(VIEWS[name]);
}

/** Fly round to look from `dir` (from the middle of the creature). */
function lookFrom(dir: THREE.Vector3) {
  // straight down (or up): nudged off the pole so the orbit keeps a sensible "up"
  if (!dir.x && !dir.z) dir = dir.clone().setZ(0.002);
  // (dragging the view stops just under level: looking from below is only the view cube's)
  controls.maxPolarAngle = Math.PI;
  controls.autoRotate = false;
  $('#spin').classList.remove('on');
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
  initViewCube();
  document.querySelectorAll<HTMLButtonElement>('#view-proj [data-proj]').forEach((b) => {
    b.onclick = () => {
      const on = b.dataset.proj === 'ortho';
      {
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
