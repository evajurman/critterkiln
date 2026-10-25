// ---------------------------------------------------------------------------
// The render loop: drawing on demand (invalidate), resizing, settling skins
// when idle, and noticing when frames are slow.

import * as THREE from 'three';
import { setSketchPixelRatio } from '../materials';
import { followMarkTools } from '../markingPanel';
import { $ } from './dom';
import { camera, key, overlay, pixelRatio, quality, renderer, scene, syncView, viewport } from './stage';
import { sizeMirror } from './floor';
import { aoTexel, composer, gtao } from './post';
import { creature, creatures, mode, selected } from './state';
import { controls, drag, viewChanged, viewMoved } from './controls';
import { frameCreature, setTween, syncViewCube, tween } from './framing';
import { drawState, renderOverlay } from './drawing';
import { flashPiece, followBoard } from './workbench';
import { followRiders } from './riders';
import { gizmo } from './attach';
import { flashStart, pickedBones } from './partPanel';
import { hint } from './hints';
import { settings, syncSliderNumbers } from './settings';
import { dof, focusMarkerUntil, updateFocus } from './dof';
import { animMoving, animOn, animSecs, tickAnim } from './animateTab';
import { animRendering } from './animGif';

// Render on demand: the loop only draws when something asked for it (any
// input, a commit, camera motion, a merge or skin update...). A couple of
// extra frames cover work that lands in a later rAF callback.
let renderFrames = 3;
export function invalidate(frames = 3) {
  renderFrames = Math.max(renderFrames, frames);
}

/** the view's shape when the creature was last framed for it */
let framedAspect = 0;
/** A very different shape now (more than a quarter wider or narrower): what was in view may be tiny or cut off, so frame the creature again (unless the view's been moved by hand). */
function reframeIfReshaped() {
  if (!framedAspect) framedAspect = camera.aspect;
  if (Math.abs(Math.log(camera.aspect / framedAspect)) <= Math.log(1.25)) return;
  framedAspect = camera.aspect;
  if (!viewMoved && !drawState && mode !== 'stuff') frameCreature();
}
/**
 * A saved view was put back: it was framed for a view `aspect` wide. Older saves don't say; they were
 * nearly all made in a wide window, so in an upright view (a phone) they're taken as wide, else as this one.
 */
export function viewPutBack(aspect?: number) {
  framedAspect = aspect ?? (camera.aspect < 1 ? 1.6 : camera.aspect);
  reframeIfReshaped();
}

export function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(pixelRatio());
  composer.setPixelRatio(pixelRatio());
  setSketchPixelRatio(pixelRatio());
  composer.setSize(w, h);
  aoTexel.set(1 / gtao.pdRenderTarget.width, 1 / gtao.pdRenderTarget.height);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  syncView();
  reframeIfReshaped();
  const dpr = Math.min(devicePixelRatio, 2);
  overlay.width = w * dpr;
  overlay.height = h * dpr;
  sizeMirror();
  renderOverlay();
  invalidate();
}

/**
 * Everything the shadow map depends on: each visible caster (and its geometry
 * edits) plus the key light's placement and frustum. Compared frame to frame.
 */
let shadowState: unknown[] = [];
function shadowsChanged(): boolean {
  scene.updateMatrixWorld();
  const next: unknown[] = [];
  const cam = key.shadow.camera;
  next.push(...key.matrixWorld.elements, ...key.target.matrixWorld.elements, cam.left, cam.right, cam.top, cam.bottom, cam.far);
  scene.traverseVisible((o) => {
    // soft (VSM) shadow maps draw receivers as well as casters
    if (!(o instanceof THREE.Mesh) || !(o.castShadow || o.receiveShadow)) return;
    const pos = o.geometry.getAttribute('position');
    next.push(o, o.geometry, pos?.version ?? 0, o.material, ...o.matrixWorld.elements);
    // (scattered copies move inside one mesh)
    if (o instanceof THREE.InstancedMesh) next.push(o.instanceMatrix.version);
  });
  const changed = next.length !== shadowState.length || next.some((v, i) => v !== shadowState[i]);
  shadowState = next;
  return changed;
}

/**
 * Once nothing has changed for a moment, rebuild merged joins as seamless
 * skins (in small chunks, so the page stays responsive). Not while you're
 * mid-drag, drawing, editing the rig or on the Stuff workbench.
 */
const SETTLE_AFTER_MS = 600;
/** how far along the badge last showed */
let settleShown = 0;
const settleRing = document.querySelector<SVGCircleElement>('#settle-badge .settle-ring .fill')!;
function settleWhenIdle(now: number) {
  // a playing loop changes the shape every frame: skins wait till it's paused
  const busy = !!drawState || !!drag || gizmo.dragging || mode === 'stuff' || animMoving() || !!animRendering;
  let building = false;
  for (const c of creatures) {
    if (c.skinState === 'building') building = true;
    // (a skin kept aside for this very shape comes straight back)
    else if (!busy && c.skinState === 'none' && (now - c.lastChange > SETTLE_AFTER_MS || c.skinKept)) {
      void c.settle();
      // settle() flips the state synchronously before its first await
      building ||= (c.skinState as string) === 'building';
    }
  }
  $('#settle-badge').hidden = !building;
  if (building) {
    // how far along, across every creature still building
    const going = creatures.filter((c) => c.skinState === 'building');
    // (never backwards while it's showing: another creature starting late would pull the average down)
    const done = (settleShown = Math.max(settleShown, going.reduce((n, c) => n + c.skinProgress, 0) / Math.max(1, going.length)));
    settleRing.style.strokeDashoffset = String(1 - done);
    $('#settle-pct').textContent = `${Math.floor(done * 100)}%`;
  } else {
    settleShown = 0;
    settleRing.style.strokeDashoffset = '1';
  }
}

let lastSkins = '';
// A one-time nudge towards Settings > Performance when frames keep coming slowly.
let lastDrawn = 0;
let slowFrames = 0;
let slowHinted = false;
function watchSpeed(now: number) {
  const dt = now - lastDrawn;
  lastDrawn = now;
  // only while drawing frame after frame (a drag, a camera move...)
  if (slowHinted || quality === 'fast' || drawState || dt > 250) return;
  slowFrames = dt > 55 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
  if (slowFrames > 40) {
    slowHinted = true;
    hint('Running slowly? Try Settings › Performance › Fast', 6000);
  }
}

export function loop(now: number) {
  requestAnimationFrame(loop);
  if (tween) {
    const t = Math.min(1, (now - tween.start) / tween.dur);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    controls.target.lerpVectors(tween.t0v, tween.t1v, k);
    if (t >= 1) {
      setTween(null);
      viewChanged();
    }
    invalidate(2);
  }
  // true while damping or auto-rotating
  if (controls.update()) invalidate(2);
  syncView();
  syncViewCube();
  const f = 1 - (now - flashStart) / 700;
  // one extra frame after the flash ends clears the glow
  if (f > -0.1) invalidate(1);
  if (mode === 'stuff') flashPiece(drawState ? 0 : Math.max(0, f));
  else creature.flash(drawState ? null : pickedBones(), Math.max(0, f));
  if (creature.tickBoing(now)) invalidate(1);
  tickAnim(now);
  // scattered copies that move (in Animate they keep to its timeline: see showAnimAt)
  if (!animOn()) for (const c of creatures) if (c.tickScatter(now / 1000, animSecs())) invalidate(1);
  // copies of a creature follow it as it's changed
  for (const c of creatures) if (c.refreshScatterSources()) invalidate();
  // while something's dragged, moving joins blend colors more cheaply (see setDragging)
  const dragging = !!drag || gizmo.dragging;
  // on the fast setting, moving joins aren't fused at all until it's let go
  for (const c of creatures) c.setDragging(dragging, quality === 'fast');
  for (const c of creatures) if (c.updateMerge()) invalidate();
  settleWhenIdle(now);
  // skins finish building asynchronously, between frames
  const skins = creatures.map((c) => c.skinState).join();
  if (skins !== lastSkins) invalidate();
  lastSkins = skins;
  if (drawState && !drawState.active) renderOverlay();
  if (dof.enabled && now < focusMarkerUntil + 100) invalidate(1);
  updateFocus(now);
  if (renderFrames <= 0) return;
  renderFrames--;
  // the marking gizmo stays on its part as it's posed (and the workbench on the stuff it's editing)
  followMarkTools();
  // creatures riding on others go where those parts are now
  followRiders();
  followBoard();
  // sliders moved by code (undo, switching parts...) keep their numbers in step
  if (settings.numbers) syncSliderNumbers();
  if (shadowsChanged()) renderer.shadowMap.needsUpdate = true;
  composer.render();
  watchSpeed(now);
}

export function initLoop() {
  new ResizeObserver(resize).observe(viewport);
  // Anything the user does may change the scene. Pointer moves only count over
  // the viewport (hover highlights, gizmo) or while a button is held.
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'input', 'change', 'click']) {
    window.addEventListener(type, () => invalidate(), { capture: true, passive: true });
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.buttons || viewport.contains(e.target as Node)) invalidate();
    },
    { capture: true, passive: true },
  );
}
