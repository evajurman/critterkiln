import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { blendWithOf, Creature, type Attachment, type BlendWith, type BoneRT } from './creature';
import { unlock } from './achievements';
import { safeFileName } from './stuff';
import { STYLES, setSketchPixelRatio } from './materials';
import { followMarkTools, markGizmoMode, markToolKey } from './markingPanel';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
  ANIM_KINDS,
  animOffset,
  animP,
  canReverse,
  defaultAnim,
  leanAt,
  leanOf,
  leanQuat,
  mirrorAnim,
  reachAt,
  reachRim,
  rimLean,
  orbitOut,
  STUFF_KINDS,
  stuffMove,
  stuffP,
  type PartAnim,
  type StuffAnim,
  type StuffKind,
} from './animate';
import { arrangeMenu, customTabs, tabNamesMenu } from './layout';
import { captureShortcut, is, keyLabel, type ShortcutId } from './shortcuts';
import { openContextMenu, SEP, type MenuEntry, type MenuItem } from './contextMenu';
import { getCreation } from './library';
import { type V3 } from './rigs';
import { $, faClassic, iconLabel } from './editor/dom';
import {
  applyLighting,
  camera,
  canvas,
  hemi,
  key,
  LIGHT_KEY,
  lightTurn,
  overlay,
  pixelRatio,
  quality,
  renderer,
  rim,
  scene,
  sceneOrtho,
  setLightTurn,
  setOrtho,
  shadowMat,
  syncView,
  view,
  viewport,
} from './editor/stage';
import {
  applyFloor,
  backdrop,
  BACKDROPS,
  type FloorMode,
  floorPrefs,
  initFloor,
  neutralTone,
  refreshFloorColors,
  saveFloor,
  setBackdrop,
  sizeMirror,
  tintForBackdrop,
} from './editor/floor';
import { aoTexel, bokeh, composer, gtao, initPost, setAO } from './editor/post';
import {
  activate,
  booted,
  commit,
  creature,
  creatures,
  freshWorld,
  idle,
  initState,
  loadedWorld,
  makeCreature,
  mode,
  opened,
  redo,
  save,
  selected,
  setBooted,
  setIdle,
  setSelected,
  state,
  undo,
  world,
} from './editor/state';
import {
  controls,
  creatureLabel,
  drag,
  handlesVisible,
  initControls,
  pickOtherCreature,
  pickPart,
  pointer,
  raycaster,
  setRay,
  viewChanged,
  viewMoved,
} from './editor/controls';
import { flyTo, focusOnBone, frameAll, frameCreature, initFraming, partToFloor, setTween, tween } from './editor/framing';
import {
  drawState,
  enterDraw,
  exitDraw,
  finishDraw,
  initDrawing,
  localToOverlay,
  partPlane,
  renderOverlay,
  screenToLocal,
  setDrawSide,
  setDrawTool,
  setSpacePan,
  toggleSymmetry,
} from './editor/drawing';
import {
  board,
  clip,
  copyPicked,
  copyPiece,
  deletePiece,
  flashPiece,
  focusOnBoard,
  focusOnPlane,
  initWorkbench,
  pasteClip,
  pickPiece,
  piece,
  pieceMode,
  piecePivot,
  renderStuffPanel,
  selectedPiece,
  setPieceMirror,
  setPieceMode,
  setSelectedPiece,
  twinOf,
} from './editor/workbench';
import { deselectAttachment, gizmo, initAttach, selectAttachment, selectedAttachment } from './editor/attach';
import { initArrange, type PlaceMode, placing, setPlaceMode, startPlacing, stopPlacing } from './editor/arrange';
import { initCreatureBar, renderCreatureBar } from './editor/creatureBar';
import { initAttachPanel, removeAttachment, syncAttachBar } from './editor/attachPanel';
import { initCarry, pickAttachment, pickStuff } from './editor/carry';
import { initFiles, openFile, putView, sceneFileName } from './editor/files';
import { type CreationData, initCreations } from './editor/creations';
import { initTrophyPanel } from './editor/trophyPanel';
import { initLibraryPanel } from './editor/libraryPanel';
import { initInstall } from './editor/install';
import { glowFollowSeg, glowSlider, initWidgets, renderSceneColors, sceneColorRow } from './editor/widgets';
import { flashPart, flashStart, initPartPanel, selectPart } from './editor/partPanel';
import { initEyesPanel } from './editor/eyesPanel';
import { renderUI, setMode } from './editor/panels';
import { initMarkingsUi } from './editor/markingsUi';
import { initRigEdit, pickingParent, removePart, rigLock, rigLocked, setMirror, setPickingParent } from './editor/rigEdit';
import { hint, hintOnce, initHints } from './editor/hints';
import {
  closeShortcutSheet,
  initSettings,
  renderSettings,
  saveSettings,
  settings,
  shortcutsChanged,
  syncSliderNumbers,
  toggleShortcutSheet,
} from './editor/settings';
import { initTopbar } from './editor/topbar';
import { initSheet } from './editor/sheet';

// Render on demand: the loop only draws when something asked for it (any
// input, a commit, camera motion, a merge or skin update...). A couple of
// extra frames cover work that lands in a later rAF callback.
let renderFrames = 3;
export function invalidate(frames = 3) {
  renderFrames = Math.max(renderFrames, frames);
}
initFloor();
initPost();
initState();
initControls();
initDrawing();
initWorkbench();
initAttach();
initArrange();
initCreatureBar();
initAttachPanel();
initCarry();
initFiles();
initCreations();
initTrophyPanel();
initLibraryPanel();
initInstall();
initWidgets();
initPartPanel();
initEyesPanel();
initMarkingsUi();
initRigEdit();
initHints();
initSettings();
initTopbar();
initSheet();

function renderBackdrops() {
  const el = $('#backdrops');
  el.innerHTML = '';
  for (const c of BACKDROPS) {
    const btn = document.createElement('button');
    btn.style.background = c;
    btn.title = c;
    btn.classList.toggle('active', c === backdrop);
    btn.onclick = () => {
      setBackdrop(c);
      if (c !== BACKDROPS[0]) unlock('backdrop');
      renderBackdrops();
    };
    el.append(btn);
  }
  $<HTMLInputElement>('#backdrop-color').value = backdrop;
  renderSceneColors();
}
sceneColorRow($('#backdrop-scene-colors'), () => backdrop, (c) => {
  setBackdrop(c);
  unlock('backdrop');
  renderBackdrops();
});
/** The Backdrop section's controls, showing what's set (src/layout.ts puts them wherever the tab has them). */
export function renderBackdropUI() {
  renderBackdrops();
  renderFloorUI();
  $<HTMLInputElement>('#light-turn').value = String(lightTurn);
}
$<HTMLInputElement>('#light-turn').oninput = (e) => {
  setLightTurn(parseFloat((e.target as HTMLInputElement).value));
  applyLighting();
  try {
    localStorage.setItem(LIGHT_KEY, JSON.stringify({ turn: lightTurn }));
  } catch {
    /* ignore */
  }
};
$<HTMLInputElement>('#backdrop-color').oninput = (e) => {
  setBackdrop((e.target as HTMLInputElement).value);
  unlock('backdrop');
  renderBackdrops();
};

const FLOOR_SWATCHES = ['#d6c7b3', '#b9a58a', '#8d6e63', '#ece6da', '#a9c2a4', '#a3b3cf', '#4a4350', '#2b2f3a'];

function renderFloorUI() {
  document.querySelectorAll<HTMLButtonElement>('#floor-mode button').forEach((b) => b.classList.toggle('active', b.dataset.floor === floorPrefs.mode));
  $('#floor-mirror-opts').hidden = floorPrefs.mode !== 'mirror';
  $('#floor-material-opts').hidden = floorPrefs.mode !== 'material';
  $<HTMLInputElement>('#floor-reflect').value = String(floorPrefs.reflect);
  $<HTMLInputElement>('#floor-color').value = floorPrefs.color;
  const styles = $('#floor-styles');
  styles.innerHTML = '';
  for (const s of STYLES) {
    if (s.id === 'glass') continue;
    const b = document.createElement('button');
    b.innerHTML = `<span class="ball ${s.id}"></span>`;
    b.append(s.name);
    b.classList.toggle('active', s.id === floorPrefs.style);
    b.title = s.desc;
    b.onclick = () => updateFloor(() => (floorPrefs.style = s.id));
    styles.append(b);
  }
  const sw = $('#floor-swatches');
  sw.innerHTML = '';
  for (const c of FLOOR_SWATCHES) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.classList.toggle('active', c === floorPrefs.color);
    b.onclick = () => updateFloor(() => (floorPrefs.color = c));
    sw.append(b);
  }
  $<HTMLInputElement>('#floor-glow').value = String(floorPrefs.glow);
  floorGlowFollow();
  renderSceneColors();
}
const floorGlowFollow = glowFollowSeg(
  '#floor-glow-follow',
  () => floorPrefs,
  (f) =>
    updateFloor(() => {
      if (f) floorPrefs.glowFollow = f;
      else delete floorPrefs.glowFollow;
    }),
);
sceneColorRow($('#floor-scene-colors'), () => floorPrefs.color, (c) => updateFloor(() => (floorPrefs.color = c)));
glowSlider(
  '#floor-glow',
  (v) => {
    floorPrefs.glow = v;
    applyFloor();
    floorGlowFollow();
  },
  () => saveFloor(),
);

function updateFloor(fn: () => void) {
  fn();
  saveFloor();
  applyFloor();
  renderFloorUI();
}

document.querySelectorAll<HTMLButtonElement>('#floor-mode button').forEach((b) => {
  b.onclick = () => updateFloor(() => (floorPrefs.mode = b.dataset.floor as FloorMode));
});
$<HTMLInputElement>('#floor-reflect').oninput = (e) => {
  floorPrefs.reflect = parseFloat((e.target as HTMLInputElement).value);
  saveFloor();
  applyFloor();
};
$<HTMLInputElement>('#floor-color').oninput = (e) => {
  floorPrefs.color = (e.target as HTMLInputElement).value;
  saveFloor();
  applyFloor();
};
$<HTMLInputElement>('#floor-color').onchange = () => renderFloorUI();
$<HTMLInputElement>('#ao').onchange = (e) => setAO((e.target as HTMLInputElement).checked);
// depth of field: focus follows the orbit target, nudged by `offset`

const DOF_KEY = 'creature-creator/dof';
export const dof: { enabled: boolean; offset: number; blur: number } = (() => {
  try {
    return { enabled: false, offset: 0, blur: 0.35, ...JSON.parse(localStorage.getItem(DOF_KEY) ?? '{}') };
  } catch {
    return { enabled: false, offset: 0, blur: 0.35 };
  }
})();
export let pickingFocus = false;
let focusMarkerUntil = 0;

// a ring floating on the focus plane, shown briefly while focus changes
const focusMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.2, 0.215, 64),
  new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8, depthTest: false }),
);
focusMarker.renderOrder = 1001;
focusMarker.visible = false;
scene.add(focusMarker);

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

function updateFocus(now: number) {
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
// the Backdrop section is always out (no popup to open first), so it starts showing what is set
renderBackdropUI();

// Blending: each slider at 0 is the same as that kind of blending being off.
// The last non-zero amount is kept, so files and undo stay compatible.
$<HTMLInputElement>('#merge-radius').oninput = (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  state.merge = v > 0;
  if (v > 0) state.mergeRadius = v;
  creature.markMergeDirty();
  renderMerge();
};
$<HTMLInputElement>('#color-blend').oninput = (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  state.mergeColors = v > 0;
  if (v > 0) state.colorBlend = v;
  creature.markMergeDirty();
  renderMerge();
};
for (const id of ['#merge-radius', '#color-blend']) $<HTMLInputElement>(id).onchange = () => commit();

export function renderMerge() {
  const on = state.merge ?? true;
  $<HTMLInputElement>('#merge-radius').value = String(on ? (state.mergeRadius ?? 0.1) : 0);
  $<HTMLInputElement>('#color-blend').value = String(state.mergeColors ? (state.colorBlend ?? 0.12) : 0);
  // colors only blend where parts blend
  $('#color-blend-row').classList.toggle('off', !on);
  // None is per creature, only when Settings leaves it to each creature; the
  // rest also shape the quick joins, so they're there even with seamless joins off
  const perCreature = settings.seamless === 'creature';
  const shown = perCreature && state.seamless === false ? 'none' : blendWithOf(state);
  $('#seamless-note').textContent = settings.seamless === 'off' ? '(off in Settings)' : '';
  $('#seamless-label').title = settings.seamless === 'off'
    ? 'Off in Settings, so this just picks which parts the quick joins blend'
    : 'Smooths blended parts into one skin while you’re not changing anything';
  document.querySelectorAll<HTMLButtonElement>('#blend-with button').forEach((b) => {
    b.hidden = b.dataset.with === 'none' && !perCreature;
    b.classList.toggle('active', b.dataset.with === shown);
    // greyed out only when nothing blends
    b.disabled = !on;
  });
  $('#seamless-row').style.opacity = on ? '1' : '.45';
}

document.querySelectorAll<HTMLButtonElement>('#blend-with button').forEach((b) => {
  b.onclick = () => setBlendWith(b.dataset.with as BlendWith | 'none');
});
function setBlendWith(to: BlendWith | 'none') {
  if (to === 'none') {
    if (state.seamless === false) return;
    state.seamless = false;
  } else {
    if (to === blendWithOf(state) && state.seamless !== false) return;
    if (state.seamless === false) state.seamless = true;
    state.blendWith = to;
    delete state.blendConnected;
    creature.markMergeDirty();
  }
  creature.invalidateSkin();
  commit();
  renderMerge();
}
initFraming();

/** Render one clean frame without handles or guides, then restore. */
export function withCleanScene<T>(fn: () => T): T {
  const skel = handlesVisible();
  const helper = gizmo.getHelper();
  const gizmoShown = helper.visible;
  // the Animate tab's drawn motion path and its handles
  const pathShown = animViz.visible;
  creature.setSkeletonVisible(false);
  creature.flash(null, 0);
  helper.visible = false;
  animViz.visible = false;
  try {
    return fn();
  } finally {
    creature.setSkeletonVisible(skel);
    helper.visible = gizmoShown;
    animViz.visible = pathShown;
  }
}

/** The frame just rendered, as pixels. */
function grabFrame(): ImageData {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * A photo with no backdrop. The scene is rendered over black and over grey:
 * whatever changed between the two is see-through by that much, so soft edges,
 * fuzz and floor shadows keep their partial transparency. The sums are done in
 * linear light (blending happens there, not in the picture's sRGB), and the
 * grey is mid-range, where tone mapping is close to a straight line.
 */
function transparentShot(): string {
  const background = scene.background;
  // shadows are normally tinted toward the backdrop; with no backdrop, keep them neutral
  const shadowColor = shadowMat.color.clone();
  const groundColor = hemi.groundColor.clone();
  tintForBackdrop(new THREE.Color('#ffffff'));
  const render = (c: THREE.Color) => {
    scene.background = c;
    refreshFloorColors();
    composer.render();
    return grabFrame();
  };
  const GREY = 0.5;
  const greyOut = neutralTone([GREY, GREY, GREY])[0];
  const toLinear = Array.from({ length: 256 }, (_, v) => {
    const s = v / 255;
    return s < 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  try {
    const black = render(new THREE.Color(0, 0, 0));
    const grey = render(new THREE.Color(GREY, GREY, GREY));
    const b = black.data;
    const g = grey.data;
    const c = new THREE.Color();
    for (let i = 0; i < b.length; i += 4) {
      const lb = [toLinear[b[i]], toLinear[b[i + 1]], toLinear[b[i + 2]]];
      const lg = [toLinear[g[i]], toLinear[g[i + 1]], toLinear[g[i + 2]]];
      const seen = Math.max(lg[0] - lb[0], lg[1] - lb[1], lg[2] - lb[2]) / greyOut;
      const a = Math.min(1, Math.max(0, 1 - seen));
      // over black, color = alpha * own color: undo that
      if (a > 0) c.setRGB(lb[0] / a, lb[1] / a, lb[2] / a).convertLinearToSRGB();
      b[i] = Math.min(255, Math.round(c.r * 255));
      b[i + 1] = Math.min(255, Math.round(c.g * 255));
      b[i + 2] = Math.min(255, Math.round(c.b * 255));
      b[i + 3] = Math.round(a * 255);
    }
    const out = document.createElement('canvas');
    out.width = black.width;
    out.height = black.height;
    out.getContext('2d')!.putImageData(black, 0, 0);
    return out.toDataURL('image/png');
  } finally {
    scene.background = background;
    shadowMat.color.copy(shadowColor);
    hemi.groundColor.copy(groundColor);
    refreshFloorColors();
    invalidate();
  }
}

$('#shot').onclick = () => {
  const clear = $<HTMLInputElement>('#shot-clear').checked;
  const url = withCleanScene(() => {
    if (clear) return transparentShot();
    composer.render();
    return canvas.toDataURL('image/png');
  });
  // named after who's in the scene
  const name = sceneFileName();
  download(url, `${safeFileName(name, 'creature')}.png`);
  unlock('photo');
  if (clear) unlock('clear-photo');
};

$('#export').onclick = () => {
  unlock('glb');
  const inks: THREE.Object3D[] = [];
  const roots = creatures.map((c) => c.root);
  for (const root of roots) {
    root.traverse((o) => {
      // ink hulls and felt fuzz are render-only effects; they don't belong in the model file
      const ink = o instanceof THREE.Mesh && (o.material as THREE.Material).userData?.ink;
      if ((ink || o.userData.fx) && o.visible) inks.push(o);
    });
  }
  withCleanScene(() => {
    inks.forEach((o) => (o.visible = false));
    new GLTFExporter().parse(
      // every creature in the scene, each at its placement
      roots,
      (result) => {
        inks.forEach((o) => (o.visible = true));
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        download(url, 'creature.glb');
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      (err) => {
        inks.forEach((o) => (o.visible = true));
        console.error(err);
        hint('Export failed, sorry!', 2500, true);
      },
      { binary: true, onlyVisible: true },
    );
  });
};

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

// the shortcut sheet waiting for a new key takes the press before anything else sees it
window.addEventListener('keydown', (e) => captureShortcut(e, $('#keys-list'), shortcutsChanged), true);
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented && !$('#keys-pop').hidden) return;
  const tag = (e.target as HTMLElement).tagName;
  // typing in a text or number box
  if (tag === 'TEXTAREA' || (tag === 'INPUT' && ['text', 'number', 'search'].includes((e.target as HTMLInputElement).type))) return;
  // the paint brush's own keys come first while it's picked up (Brush size, Mirror)
  if (markToolKey(e)) {
    e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  if (is(e, 'undo')) {
    e.preventDefault();
    undo();
  } else if (is(e, 'redo')) {
    e.preventDefault();
    redo();
  } else if (k === 'escape' && !$('#keys-pop').hidden) {
    closeShortcutSheet();
  } else if (is(e, 'help')) {
    toggleShortcutSheet();
  } else if (k === 'escape' && pickingParent) {
    setPickingParent(false);
  } else if (k === 'escape' && drawState) {
    exitDraw();
  } else if (k === 'enter' && drawState) {
    e.preventDefault();
    finishDraw();
  } else if (drawState && (is(e, 'draw') || is(e, 'erase') || is(e, 'move') || is(e, 'scale') || is(e, 'rotate'))) {
    setDrawTool(is(e, 'draw') ? 'draw' : is(e, 'erase') ? 'erase' : is(e, 'move') ? 'move' : is(e, 'scale') ? 'scale' : 'rotate');
  } else if (is(e, 'mirror') && drawState) {
    toggleSymmetry();
  } else if (is(e, 'side') && drawState) {
    setDrawSide(!drawState.side);
  } else if (e.code === 'Space' && (drawState || !(e.target as HTMLElement).closest('button, select, textarea, input, label'))) {
    // (a focused button still clicks with Space)
    e.preventDefault();
    setSpacePan(true);
  } else if (is(e, 'frame') && drawState) {
    // back to a straight-on view of the drawing
    if (drawState.target.kind === 'bone') {
      const b = creature.bones.get(drawState.target.boneId);
      if (b) focusOnBone(b, drawState.side);
    } else if (drawState.frame !== board) focusOnPlane(drawState.frame);
    else focusOnBoard();
  } else if (is(e, 'draw') && mode === 'stuff') enterDraw({ kind: 'piece' });
  else if (is(e, 'draw') && !idle) enterDraw();
  else if (is(e, 'stuff')) setMode('stuff');
  else if (is(e, 'animate')) setMode('animate');
  else if (is(e, 'mirror') && mode === 'stuff') {
    if (piece()) setPieceMirror(!piece()!.twin);
  } else if (is(e, 'mirror')) setMirror(!rigLock);
  else if (is(e, 'delete') && !drawState) {
    // picked stuff goes first: its part is picked too, and mustn't go with it
    if (selectedAttachment) {
      e.preventDefault();
      removeAttachment();
    } else if (mode === 'stuff' && piece()) {
      e.preventDefault();
      deletePiece(piece()!.id);
    } else if (mode !== 'stuff' && !idle && !placing) {
      e.preventDefault();
      removePart();
    }
  } else if (is(e, 'copy') && !document.getSelection()?.toString()) {
    if (copyPicked()) e.preventDefault();
  } else if (is(e, 'paste')) {
    if (pasteClip()) e.preventDefault();
  } else if (is(e, 'move') || is(e, 'rotate') || is(e, 'scale')) {
    const m = is(e, 'move') ? 'translate' : is(e, 'rotate') ? 'rotate' : 'scale';
    if (mode === 'stuff' && piecePivot) setPieceMode(m);
    else if (selectedAttachment) {
      gizmo.setMode(m);
      syncAttachBar();
    } else if (placing) setPlaceMode(m);
    else markGizmoMode(m);
  } else if (is(e, 'shape')) setMode('shape');
  else if (is(e, 'look')) setMode('look');
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && k >= '5' && k <= '9' && customTabs()[+k - 5]) setMode(customTabs()[+k - 5].id);
  else if (is(e, 'frame')) {
    if (mode === 'stuff') focusOnBoard();
    else frameCreature();
  } else if (is(e, 'frameAll')) frameAll();
});

// the right-click menu: on a part, a piece or worn stuff in the view, what you
// can do to it (picking it first); on the tools, arranging them, and on a
// slider its number and its default. A right-drag still pans the view.

/** A button's own action as a menu item: greyed when the button is, left out when it's hidden. */
function buttonItem(id: string, icon: string, label?: string): MenuItem | null {
  const b = document.querySelector<HTMLButtonElement>(id);
  if (!b || b.hidden || b.closest('[hidden]')) return null;
  return { label: label ?? (b.textContent ?? '').trim(), icon, disabled: b.disabled, title: b.title, run: () => b.click() };
}
const keyOf = (id: ShortcutId) => keyLabel(id) || undefined;
const ctxSlab = (n: string) => `fa-slab-duo fa-regular fa-${n}`;
const ctxDuo = (n: string) => `fa-duotone fa-regular fa-${n}`;

/** Move, Rotate and Scale, each doing `set` with its gizmo mode; `on` ticks the one in use. */
function gizmoItems(set: (m: 'translate' | 'rotate' | 'scale') => void, on: string | null, what = ''): MenuItem[] {
  return ([['translate', 'Move', 'move', 'arrows-up-down-left-right'], ['rotate', 'Rotate', 'rotate', 'arrows-rotate'], ['scale', 'Scale', 'scale', 'expand']] as const).map(
    ([m, label, key, icon]) => ({ label: label + what, icon: ctxDuo(icon), checked: on === m || undefined, key: keyOf(key), run: () => set(m) }),
  );
}

function viewMenu(x: number, y: number) {
  if (mode === 'stuff') {
    const id = pickPiece(x, y);
    if (id) {
      setSelectedPiece(id);
      flashPart();
      renderStuffPanel();
    }
    const p = id ? piece() : undefined;
    if (!p) {
      return openContextMenu(x, y, 'Workbench', [
        { label: 'Draw a piece', icon: ctxSlab('pencil'), key: keyOf('draw'), run: () => enterDraw({ kind: 'piece' }) },
        clip?.kind === 'piece' && { label: 'Paste', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
        SEP,
        { label: 'Frame the workbench', icon: ctxDuo('crosshairs'), key: keyOf('frame'), run: focusOnBoard },
      ]);
    }
    return openContextMenu(x, y, 'Piece', [
      { label: 'Copy', icon: ctxDuo('copy'), key: keyOf('copy'), run: () => copyPicked() },
      clip?.kind === 'piece' && { label: 'Paste', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
      { label: 'Duplicate', icon: ctxDuo('clone'), run: () => copyPiece(p.id) },
      { label: 'Delete', icon: ctxSlab('trash'), key: keyOf('delete'), danger: true, run: () => deletePiece(p.id) },
      SEP,
      { label: 'Redraw', icon: ctxSlab('pencil'), run: () => enterDraw({ kind: 'piece', redraw: p.id }) },
      { label: 'Mirror', icon: ctxSlab('arrow-right-arrow-left'), key: keyOf('mirror'), checked: !!twinOf(p), run: () => setPieceMirror(!twinOf(p)) },
      SEP,
      ...gizmoItems(setPieceMode, pieceMode),
      SEP,
      { label: 'Frame the workbench', icon: ctxDuo('crosshairs'), key: keyOf('frame'), run: focusOnBoard },
    ]);
  }

  // the same picking as a click: another creature, worn stuff, then a part
  const other = pickOtherCreature(x, y);
  if (other) {
    setIdle(false);
    activate(other.index);
    if (other.boneId && creature.bones.has(other.boneId)) setSelected(other.boneId);
    creature.select(selected);
    save();
    renderUI();
  }
  const att = other ? null : pickAttachment(x, y);
  if (att) {
    pickStuff(att);
    return openContextMenu(x, y, 'Worn stuff', [
      ...gizmoItems((m) => {
        gizmo.setMode(m);
        syncAttachBar();
      }, gizmo.mode),
      SEP,
      { label: 'Take it off', icon: ctxSlab('trash'), key: keyOf('delete'), danger: true, run: removeAttachment },
    ]);
  }
  const id = other?.boneId ?? pickPart(x, y);
  if (id && creature.bones.has(id)) {
    deselectAttachment();
    if (placing) stopPlacing();
    selectPart(id, false);
  }
  const place = (m: PlaceMode) => {
    if (!placing) startPlacing();
    setPlaceMode(m);
  };
  const frame: MenuEntry[] = [
    { label: 'Frame this creature', icon: ctxDuo('crosshairs'), key: keyOf('frame'), run: () => frameCreature() },
    creatures.length > 1 && { label: 'Frame everyone', icon: ctxDuo('users'), key: keyOf('frameAll'), run: frameAll },
  ];
  if (!id) {
    return openContextMenu(x, y, creatureLabel(world.active), [
      clip?.kind === 'part' && !idle && { label: 'Paste', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
      { label: 'Arrange creature', icon: ctxDuo('arrows-up-down-left-right'), sub: gizmoItems(place, placing ? gizmo.mode : null) },
      buttonItem('#drop-floor', ctxSlab('arrow-down-to-line'), 'Creature to floor'),
      SEP,
      ...frame,
    ]);
  }
  const b = creature.bones.get(id)!;
  const name = b.def.name?.trim() || 'Part';
  const root = !b.parent;
  return openContextMenu(x, y, name, [
    { label: 'Copy', icon: ctxDuo('copy'), key: keyOf('copy'), disabled: root, title: root ? 'The first part holds everything else' : undefined, run: () => copyPicked() },
    clip?.kind === 'part' && { label: 'Paste onto this part', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
    { label: 'Delete', icon: ctxSlab('trash'), key: keyOf('delete'), danger: true, disabled: root, title: root ? 'The first part holds everything else' : undefined, run: removePart },
    SEP,
    { label: 'Draw shape', icon: ctxSlab('pencil'), key: keyOf('draw'), run: () => enterDraw({ kind: 'bone', boneId: id }) },
    buttonItem('#reset-shape', ctxDuo('rotate-left')),
    {
      label: 'Grow',
      icon: ctxDuo('seedling'),
      sub: [
        buttonItem('#rig-bone', ctxDuo('bone')),
        buttonItem('#rig-extend', ctxDuo('arrow-up-right')),
        buttonItem('#rig-split', ctxSlab('scissors')),
        buttonItem('#rig-detach', ctxDuo('link-slash')),
        buttonItem('#rig-mirror', ctxSlab('arrow-right-arrow-left')),
      ].filter((i): i is MenuItem => !!i),
    },
    { label: 'Mirror both sides', icon: ctxSlab('arrow-right-arrow-left'), key: keyOf('mirror'), checked: rigLock, run: () => setMirror(!rigLock) },
    SEP,
    { label: 'Arrange creature', icon: ctxDuo('arrows-up-down-left-right'), sub: gizmoItems(place, placing ? gizmo.mode : null) },
    buttonItem('#reset-pose', ctxDuo('person')),
    !root && { label: 'Part to floor', icon: ctxSlab('arrow-down-to-line'), title: 'Move it straight down until its lowest point touches the floor', run: () => partToFloor(id) },
    buttonItem('#drop-floor', ctxSlab('arrow-down-to-line'), 'Creature to floor'),
    SEP,
    ...frame,
  ]);
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // a right-drag panned the view; and nothing to offer while drawing or picking a parent
  if (pointer.moved || drawState || pickingParent || pickingFocus || gizmo.dragging) return;
  viewMenu(e.clientX, e.clientY);
});

/** On a slider: its default back, and the number boxes; on a tool: arranging it. */
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement;
  if (t === canvas || t.closest('.ctx-menu-wrap')) return;
  if (t.closest('.modes button[data-mode]')) {
    e.preventDefault();
    return openContextMenu(e.clientX, e.clientY, 'Tabs', tabNamesMenu());
  }
  // text boxes keep the browser's own menu (cut, copy, paste)
  if (t.closest('textarea, input:not([type=range]):not([type=checkbox]):not([type=radio])')) return;
  const range = (t as HTMLInputElement).type === 'range' ? (t as HTMLInputElement) : t.closest('.slider, .bar-slider')?.querySelector<HTMLInputElement>('input[type=range]');
  const arrange = arrangeMenu(t);
  if (!range && !arrange) return;
  e.preventDefault();
  const def = range?.dataset.default;
  const label = range?.closest('.slider')?.querySelector(':scope > span')?.textContent?.trim();
  const title = label ?? t.closest<HTMLElement>('.ck-sec')?.querySelector('.ck-title')?.textContent?.trim() ?? 'Tools';
  openContextMenu(e.clientX, e.clientY, title, [
    range && def !== undefined && {
      label: 'Reset to default',
      icon: ctxDuo('rotate-left'),
      disabled: range.disabled || parseFloat(range.value) === parseFloat(def),
      run: () => {
        range.value = def;
        range.dispatchEvent(new Event('input', { bubbles: true }));
        range.dispatchEvent(new Event('change', { bubbles: true }));
        if (settings.numbers) syncSliderNumbers();
      },
    },
    range && {
      label: 'Show numbers',
      checked: settings.numbers,
      run: () => {
        settings.numbers = !settings.numbers;
        saveSettings();
        renderSettings();
      },
    },
    SEP,
    arrange,
  ]);
});

// resize + loop

export function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(pixelRatio());
  composer.setPixelRatio(pixelRatio());
  setSketchPixelRatio(pixelRatio());
  composer.setSize(w, h);
  aoTexel.set(1 / gtao.pdRenderTarget.width, 1 / gtao.pdRenderTarget.height);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  syncView();
  const dpr = Math.min(devicePixelRatio, 2);
  overlay.width = w * dpr;
  overlay.height = h * dpr;
  sizeMirror();
  renderOverlay();
  invalidate();
}
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

function loop(now: number) {
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
  const f = 1 - (now - flashStart) / 700;
  // one extra frame after the flash ends clears the glow
  if (f > -0.1) invalidate(1);
  if (mode === 'stuff') flashPiece(drawState ? 0 : Math.max(0, f));
  else creature.flash(drawState ? null : selected, Math.max(0, f));
  if (creature.tickBoing(now)) invalidate(1);
  tickAnim(now);
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
  // the marking gizmo stays on its part as it's posed
  followMarkTools();
  // sliders moved by code (undo, switching parts...) keep their numbers in step
  if (settings.numbers) syncSliderNumbers();
  if (shadowsChanged()) renderer.shadowMap.needsUpdate = true;
  composer.render();
  watchSpeed(now);
}

// Animate tab (proof of concept): looping motions on parts, see src/animate.ts
//
// The picked part's motion is drawn in the view: a dotted loop where its tip
// will go, arrows for which way, a dot riding it now, and two handles. The
// middle one moves the whole motion; the edge one sets how big and which way.
//
// TODO(anim): tests; a keyboard shortcut for the tab; animate-based custom tabs
// (only the built-in Animate tab plays); GIF export is Render GIF, below;
// eyes/stuff don't puff with Breathe; a playing loop re-fuses joins every frame;
// dragging a handle on a curved part is only approximate (it aims the bone's
// straight line); the handles have no hover cursor.

// (plain var/function: commit() and renderUI() can ask before this part of the file has run)
export var ANIM_TAB = 'animate' as const;
let animPlaying = true;
/** where in the loop we are, 0..1 */
let animT = 0;
let animLast = 0;
let animKey = '';
export const animSecs = () => world.animSecs ?? 1.5;
export function animOn() {
  return mode === ANIM_TAB;
}
const animMoving = () => animOn() && animPlaying && creatures.some((c) => c.state.anims && Object.keys(c.state.anims).length);

function tickAnim(now: number) {
  const dt = animLast ? Math.min(100, now - animLast) : 0;
  animLast = now;
  if (!animOn()) {
    if (animKey) {
      animKey = '';
      for (const c of creatures) {
        c.setAnim(null);
        c.setStuffAnim(null);
        c.applyPose();
      }
      animViz.visible = false;
      invalidate();
    }
    return;
  }
  // a GIF being rendered poses each frame itself
  if (animRendering) return;
  if (animPlaying) animT = (animT + dt / 1000 / animSecs()) % 1;
  showAnimAt(animT);
  drawAnimPath();
  const time = $<HTMLInputElement>('#anim-time');
  if (document.activeElement !== time) time.value = String(animT);
}

/** Every creature as it is at loop time `t` (only redone when something changed). */
function showAnimAt(t: number) {
  const key = t + JSON.stringify(creatures.map((c) => [c.state.anims ?? null, (c.state.attachments ?? []).map((x) => x.anim ?? null)]));
  if (key === animKey) return;
  animKey = key;
  for (const c of creatures) {
    const moving = (c.state.attachments ?? []).filter((x) => x.anim);
    c.setStuffAnim(moving.length ? new Map(moving.map((x) => [x.id, stuffMove(x.anim!, stuffP(x.anim!, t), c.stuffFrame(x.id)?.center)])) : null);
    const list = Object.entries(c.state.anims ?? {}).filter(([id]) => c.bones.has(id));
    const reach = list.filter(([id, a]) => reaching(c, id, a));
    const swing = list.filter((e) => !reach.includes(e));
    // back to the plain pose first (reaching bends parts outside the motions), and
    // measure where each reaching tip rests: in the creature's own space, so a
    // planted foot stays put however the body above it moves
    c.setAnim(null);
    c.applyPose();
    if (reach.length) {
      c.root.updateMatrixWorld(true);
      restTips.set(c, new Map(reach.map(([id]) => [id, c.root.worldToLocal(c.bones.get(id)!.tip.getWorldPosition(new THREE.Vector3()))])));
    }
    c.setAnim(swing.length ? new Map(swing.map(([id, a]) => [id, animOffset(a, t)])) : null);
    if (reach.length) {
      c.root.updateMatrixWorld(true);
      for (const [id, a] of reach) {
        const rest = restTips.get(c)!.get(id)!;
        c.dragTip(id, c.root.localToWorld(rest.clone().add(reachAt(a, animP(a, t), reachLen(c, id)))), true);
      }
    }
  }
  invalidate(1);
}

/** The parts that bend when `id` reaches: it and the ones above it, as Pull limbs picks them. None if nothing above it can bend. */
function reachChain(c: Creature, id: string): BoneRT[] {
  const b = c.bones.get(id);
  if (!b) return [];
  const chain = [b];
  const branches = (p: BoneRT) => c.list.filter((o) => o.parent === p).length > 1;
  for (let p = b.parent; p && !p.def.anchor && !branches(p); p = p.parent) chain.push(p);
  return chain.length > 1 ? chain : [];
}
const reaching = (c: Creature, id: string, a: PartAnim) => a.kind !== 'breathe' && a.reach !== false && reachChain(c, id).length > 0;
/** how far a reaching part can reach: the parts that bend, end to end */
const reachLen = (c: Creature, id: string) => reachChain(c, id).reduce((n, b) => n + b.length, 0);
/** where each reaching tip rests, in its creature's own space (measured with no motion on) */
const restTips = new WeakMap<Creature, Map<string, THREE.Vector3>>();

function selAnim(): PartAnim | undefined {
  return state.anims?.[selected];
}

/** the piece of stuff being animated (picked in the view or from the panel), instead of the part */
let animStuff = '';
function selStuff(): Attachment | undefined {
  return animStuff ? state.attachments?.find((x) => x.id === animStuff) : undefined;
}
/** The stuff on the picked part (a mirrored item shows on its twin part too). */
function stuffHere(): Attachment[] {
  return (state.attachments ?? []).filter((x) => {
    if (x.bone === selected) return true;
    const b = creature.bones.get(x.bone);
    return x.mirror && !!b && creature.mirrorBoneOf(b)?.def.id === selected;
  });
}
export function pickAnimStuff(id: string) {
  const a = state.attachments?.find((x) => x.id === id);
  if (!a) return;
  if (creature.bones.has(a.bone) && (selected !== a.bone || idle)) selectPart(a.bone, false);
  animStuff = id;
  renderAnim();
}

/** A fresh motion for a piece of stuff: its handles start somewhere that makes sense for the kind. */
function freshStuffAnim(kind: StuffKind, x: Attachment, keep?: StuffAnim): StuffAnim {
  const f = creature.stuffFrame(x.id)!;
  const up = creature.upIn(x.bone);
  const v = (w: THREE.Vector3) => w.toArray().map((n) => Math.round(n * 1000) / 1000) as V3;
  const base = { kind, size: kind === 'swing' ? 20 : kind === 'pulse' ? 15 : 25, speed: keep?.speed ?? 1, phase: keep?.phase ?? 0, reverse: keep?.reverse };
  switch (kind) {
    case 'orbit': {
      // round the nearest other stuff on the same part (stars round a ring), about the way it faces; or round the part
      const others = (state.attachments ?? []).filter((o) => o.id !== x.id && o.bone === x.bone).map((o) => creature.stuffFrame(o.id)).filter((o) => !!o);
      const near = others.sort((p, q) => p.center.distanceTo(f.center) - q.center.distanceTo(f.center))[0];
      return near ? { ...base, center: v(near.center), axis: v(near.normal) } : { ...base, center: v(new THREE.Vector3(0, f.center.y, 0)), axis: [0, 1, 0] };
    }
    case 'spin':
      return { ...base, center: v(f.center), axis: v(f.normal) };
    case 'swing':
      return { ...base, center: v(f.origin), axis: v(f.side) };
    case 'bob':
      return { ...base, center: v(f.center), axis: v(up.multiplyScalar(f.size * 0.25)) };
    case 'pulse':
      return { ...base, center: v(f.center), axis: v(up) };
  }
}

/** The motion being edited (the stuff's, or the part's), and a way to change it. */
function curMotion(): { speed: number; phase: number; size: number } | undefined {
  return selStuff()?.anim ?? selAnim();
}
function patchMotion(p: Partial<StuffAnim & PartAnim>) {
  const x = selStuff();
  if (x) {
    if (x.anim) x.anim = { ...x.anim, ...p } as StuffAnim;
    return;
  }
  const a = selAnim();
  if (a) setAnim({ ...a, ...p } as PartAnim);
}

/** Change the picked part's motion (and its twin's, with Mirror on), or take it away. */
function setAnim(a: PartAnim | null) {
  const anims = (state.anims ??= {});
  const b = creature.bones.get(selected);
  const twin = b && rigLocked() ? creature.twinOf(b) : null;
  const was = anims[selected]?.kind;
  if (a) anims[selected] = a;
  else delete anims[selected];
  if (twin && twin !== b) {
    // the twin is worked out from this side, so its timing stays half a loop off when walking
    if (a) anims[twin.def.id] = mirrorAnim(a);
    else delete anims[twin.def.id];
  }
  if (!Object.keys(anims).length) delete state.anims;
  // the parts list shows which parts move
  if (a?.kind !== was) renderCreatureBar();
}

export function renderAnim() {
  const b = idle ? undefined : creature.bones.get(selected);
  // the stuff on this part, to animate instead of the part
  const here = b ? stuffHere() : [];
  if (animStuff && !here.some((x) => x.id === animStuff)) animStuff = '';
  const chips = $('#anim-stuff');
  chips.hidden = !here.length;
  chips.replaceChildren(
    ...[null, ...here].map((x) => {
      const btn = document.createElement('button');
      btn.className = 'anim-chip';
      btn.classList.toggle('active', (x?.id ?? '') === animStuff);
      btn.innerHTML = x ? `<i class="fa-slab-duo fa-regular fa-paperclip" aria-hidden="true"></i> ${(x.thing.name || 'Stuff').replace(/[&<>"]/g, '')}${x.anim ? ' •' : ''}` : 'This part';
      btn.title = x ? 'Animate this piece of stuff' : 'Animate the part itself';
      btn.onclick = () => {
        animStuff = x?.id ?? '';
        renderAnim();
      };
      return btn;
    }),
  );
  const stuff = selStuff();
  if (stuff) return renderStuffAnim(stuff);
  const a = selAnim();
  // Swing only goes back and forth, and Breathe stays put: neither has a way round
  $('#anim-reverse-row').hidden = !a || !canReverse(a.kind);
  $<HTMLInputElement>('#anim-reverse').checked = !!a?.reverse;
  $('#anim-kinds').replaceChildren(
    ...[{ kind: null, name: 'Still', icon: 'pause', title: 'No motion on this part' }, ...ANIM_KINDS].map((k) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<i class="fa-duotone fa-regular fa-${k.icon}" aria-hidden="true"></i>${k.name}`;
      btn.title = k.title;
      btn.classList.toggle('active', (a?.kind ?? null) === k.kind);
      btn.disabled = !b;
      btn.onclick = () => {
        // switching motion keeps its size, place and timing
        // a fresh motion on a part that bends a knee: a stride the leg can reach
        const fresh = k.kind ? { ...defaultAnim(k.kind), ...(k.kind !== 'breathe' && reachChain(creature, selected).length ? { size: 14 } : {}) } : null;
        // a motion with no way round drops Reverse, so it can't come back unseen later
        setAnim(k.kind ? (a ? { ...a, kind: k.kind, size: k.kind === 'breathe' || a.kind === 'breathe' ? fresh!.size : a.size, reverse: canReverse(k.kind) ? a.reverse : undefined } : fresh) : null);
        renderAnim();
        commit();
      };
      return btn;
    }),
  );
  $('#anim-opts').hidden = !a || !b;
  if (a) {
    $('#anim-size-row').hidden = a.kind !== 'breathe';
    $<HTMLInputElement>('#anim-size').max = '40';
    $<HTMLInputElement>('#anim-size').value = String(a.size);
    $<HTMLInputElement>('#anim-phase').value = String(a.phase);
    $<HTMLInputElement>('#anim-opposite').checked = !!a.opposite;
    for (const s of $('#anim-speed').querySelectorAll<HTMLButtonElement>('button')) s.classList.toggle('active', Number(s.dataset.speed) === a.speed);
    $<HTMLInputElement>('#anim-reach').checked = a.reach !== false;
  }
  const canReach = !!b && reachChain(creature, selected).length > 0;
  $('#anim-reach-row').hidden = !canReach || !a || a.kind === 'breathe';
  // an unlinked pair has no twin: its sides are timed with Timing instead
  const twin = b ? creature.twinOf(b) : null;
  const paired = !!twin && twin !== b;
  $('#anim-opposite-row').hidden = !paired || !rigLocked();
  renderLoopBar();
}

function renderLoopBar() {
  iconLabel($('#anim-play'), faClassic(animPlaying ? 'pause' : 'play'), animPlaying ? 'Pause' : 'Play');
  $<HTMLInputElement>('#anim-secs').value = String(animSecs());
  $<HTMLButtonElement>('#anim-clear').disabled = !creatures.some((c) => (c.state.anims && Object.keys(c.state.anims).length) || c.state.attachments?.some((x) => x.anim));
}

/** The panel for a piece of stuff's motion. */
function renderStuffAnim(x: Attachment) {
  const a = x.anim;
  $('#anim-kinds').replaceChildren(
    ...[{ kind: null, name: 'Still', icon: 'pause', title: 'No motion on this piece of stuff' }, ...STUFF_KINDS].map((k) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<i class="fa-duotone fa-regular fa-${k.icon}" aria-hidden="true"></i>${k.name}`;
      btn.title = k.title;
      btn.classList.toggle('active', (a?.kind ?? null) === k.kind);
      btn.onclick = () => {
        x.anim = k.kind ? freshStuffAnim(k.kind, x, a) : undefined;
        renderAnim();
        commit();
      };
      return btn;
    }),
  );
  $('#anim-opts').hidden = !a;
  $('#anim-reach-row').hidden = $('#anim-opposite-row').hidden = true;
  if (a) {
    const sized = a.kind === 'swing' || a.kind === 'pulse';
    $('#anim-size-row').hidden = !sized;
    $<HTMLInputElement>('#anim-size').max = a.kind === 'swing' ? '90' : '60';
    $<HTMLInputElement>('#anim-size').value = String(a.size);
    $<HTMLInputElement>('#anim-phase').value = String(a.phase);
    $('#anim-reverse-row').hidden = a.kind !== 'orbit' && a.kind !== 'spin';
    $<HTMLInputElement>('#anim-reverse').checked = !!a.reverse;
    for (const s of $('#anim-speed').querySelectorAll<HTMLButtonElement>('button')) s.classList.toggle('active', Number(s.dataset.speed) === a.speed);
  }
  renderLoopBar();
}

for (const [id, field] of [['#anim-size', 'size'], ['#anim-phase', 'phase']] as const) {
  const input = $<HTMLInputElement>(id);
  input.oninput = () => patchMotion({ [field]: parseFloat(input.value) });
  input.onchange = () => commit();
}
$<HTMLInputElement>('#anim-reach').onchange = (e) => {
  const a = selAnim();
  if (a) setAnim({ ...a, reach: (e.target as HTMLInputElement).checked ? undefined : false });
  renderAnim();
  commit();
};
$<HTMLInputElement>('#anim-opposite').onchange = (e) => {
  const a = selAnim();
  if (a) setAnim({ ...a, opposite: (e.target as HTMLInputElement).checked || undefined });
  commit();
};
for (const btn of $('#anim-speed').querySelectorAll<HTMLButtonElement>('button')) {
  btn.onclick = () => {
    if (!curMotion()) return;
    patchMotion({ speed: Number(btn.dataset.speed) });
    renderAnim();
    commit();
  };
}
$<HTMLInputElement>('#anim-reverse').onchange = (e) => {
  patchMotion({ reverse: (e.target as HTMLInputElement).checked || undefined });
  commit();
};
$('#anim-clear').onclick = () => {
  // every motion in the scene: parts and stuff, every creature (Undo brings them back)
  for (const c of creatures) {
    delete c.state.anims;
    for (const x of c.state.attachments ?? []) delete x.anim;
  }
  commit();
  renderAnim();
  hint('All animations removed (Undo brings them back)', 2400);
};
$('#anim-play').onclick = () => {
  animPlaying = !animPlaying;
  renderAnim();
};
$<HTMLInputElement>('#anim-time').oninput = (e) => {
  animPlaying = false;
  animT = parseFloat((e.target as HTMLInputElement).value);
  renderAnim();
};
$<HTMLInputElement>('#anim-secs').oninput = (e) => {
  world.animSecs = parseFloat((e.target as HTMLInputElement).value);
};
$<HTMLInputElement>('#anim-secs').onchange = () => commit();

// ---- the motion, drawn in the view ----

const animViz = new THREE.Group();
animViz.visible = false;
animViz.renderOrder = 999;
const vizMat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
const PATH_COLOR = 0xb44dff;
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: PATH_COLOR, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 1, depthTest: false }));
/** a dark line under the dashes: the path reads on a light backdrop as well as a dark one */
const pathUnder = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1b1030, transparent: true, opacity: 0.55, depthTest: false }));
const spokeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe0609a, transparent: true, opacity: 0.8, depthTest: false }));
const ball = new THREE.SphereGeometry(1, 16, 12);
const rider = new THREE.Mesh(ball, vizMat(PATH_COLOR));
const centerHandle = new THREE.Mesh(ball, vizMat(0x3b82f6));
const rimHandle = new THREE.Mesh(ball, vizMat(0xe0609a));
const arrowGeo = new THREE.ConeGeometry(0.5, 1.4, 12);
const arrows = [0, 1, 2, 3].map(() => new THREE.Mesh(arrowGeo, vizMat(PATH_COLOR)));
pathUnder.renderOrder = 998;
pathUnder.frustumCulled = false;
animViz.add(pathUnder);
for (const o of [pathLine, spokeLine, rider, centerHandle, rimHandle, ...arrows]) {
  o.renderOrder = 999;
  o.frustumCulled = false;
  animViz.add(o);
}
scene.add(animViz);

/** The picked part, posed but without its own motion: where its base is, which way its frame faces, and where its tip sits in it. */
function partFrame() {
  const b = creature.bones.get(selected)!;
  creature.root.updateMatrixWorld(true);
  const q = b.pivot.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(b.restQuat);
  const p = state.pose[selected];
  if (p) q.multiply(new THREE.Quaternion(...p));
  const scale = b.pivot.getWorldScale(new THREE.Vector3()).x;
  const tip = b.tip.position.clone().multiplyScalar(scale);
  return { base: b.pivot.getWorldPosition(new THREE.Vector3()), q, tip };
}

/** Where the tip is, leaning by `lean` (degrees, as stored). */
function tipAt(f: ReturnType<typeof partFrame>, lean: [number, number], flip?: boolean) {
  return f.tip.clone().applyQuaternion(leanQuat(lean, flip)).applyQuaternion(f.q).add(f.base);
}

function drawAnimPath() {
  const x = animOn() && !idle ? selStuff() : undefined;
  if (x) return drawStuffPath(x);
  rimHandle.visible = centerHandle.visible = spokeLine.visible = true;
  const a = selAnim();
  const show = animOn() && !idle && !!a && a.kind !== 'breathe' && creature.bones.has(selected);
  if (animViz.visible !== show) invalidate(1);
  animViz.visible = show;
  if (!show) return;
  let at: (p: number) => THREE.Vector3, centerAt: THREE.Vector3, rimAt: THREE.Vector3, anchor: THREE.Vector3;
  if (reaching(creature, selected, a)) {
    const rest = restTips.get(creature)?.get(selected);
    if (!rest) return;
    const L = reachLen(creature, selected);
    const W = (v: THREE.Vector3) => creature.root.localToWorld(rest.clone().add(v));
    at = (p) => W(reachAt(a, p, L));
    centerAt = W(reachRim({ ...a, size: 0 }, L));
    rimAt = W(reachRim(a, L));
    anchor = W(new THREE.Vector3());
  } else {
    const f = partFrame();
    at = (p) => tipAt(f, leanAt(a, p), a.flip);
    centerAt = tipAt(f, [a.x, a.z], a.flip);
    rimAt = tipAt(f, rimLean(a), a.flip);
    anchor = f.base;
  }
  const pts = Array.from({ length: 97 }, (_, i) => at(i / 96));
  setPath(pts);
  // handles keep a steady size on screen
  const r = view.position.distanceTo(anchor) * 0.011;
  rider.position.copy(at(animP(a, animT)));
  rider.scale.setScalar(r * 0.8);
  centerHandle.position.copy(centerAt);
  centerHandle.scale.setScalar(r * 1.3);
  rimHandle.position.copy(rimAt);
  rimHandle.scale.setScalar(r * 1.3);
  spokeLine.geometry.dispose();
  spokeLine.geometry = new THREE.BufferGeometry().setFromPoints([centerHandle.position, rimHandle.position]);
  // arrows along the way it goes (spaced evenly, away from the handles)
  arrows.forEach((m, i) => {
    const p = 0.125 + i * 0.25;
    const here = at(p), ahead = at(p + 0.01).sub(here);
    m.visible = ahead.lengthSq() > 1e-12;
    m.position.copy(here);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ahead.normalize());
    m.scale.setScalar(r * 1.1);
  });
  invalidate(1);
}

/**
 * A piece of stuff's motion, in its part's frame: the path a point on it
 * traces, the blue handle (centre) and the pink one (the line it turns
 * about, or for Bob where it floats to).
 */
function stuffViz(x: Attachment) {
  const a = x.anim!;
  const f = creature.stuffFrame(x.id);
  const b = creature.bones.get(x.bone);
  if (!f || !b) return null;
  const c = new THREE.Vector3(...a.center), axis = new THREE.Vector3(...a.axis);
  const unit = axis.lengthSq() > 1e-12 ? axis.clone().normalize() : new THREE.Vector3(0, 1, 0);
  // spinning and pulsing turn round the item's own middle: trace a point off to its side instead
  const off = new THREE.Vector3().crossVectors(unit, Math.abs(unit.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const traced = a.kind === 'spin' ? c.clone().addScaledVector(off, Math.max(f.size * 0.4, 0.02)) : f.center.clone();
  const reach = Math.max(f.size * 0.6, traced.distanceTo(c), 0.05);
  const rim = a.kind === 'bob' ? f.center.clone().add(axis) : c.clone().addScaledVector(unit, reach);
  return { f, b, c, rim, at: (p: number) => traced.clone().applyMatrix4(stuffMove(a, p, f.center)) };
}

function drawStuffPath(x: Attachment) {
  const a = x.anim;
  const v = a && stuffViz(x);
  if (animViz.visible !== !!v) invalidate(1);
  animViz.visible = !!v;
  if (!a || !v) return;
  const W = (p: THREE.Vector3) => v.b.pivot.localToWorld(p.clone());
  const at = (p: number) => W(v.at(p));
  const pts = Array.from({ length: 97 }, (_, i) => at(i / 96));
  setPath(pts);
  const r = view.position.distanceTo(pts[0]) * 0.011;
  rider.position.copy(at(stuffP(a, animT)));
  rider.scale.setScalar(r * 0.8);
  // Bob has no centre to move; Pulse no line
  centerHandle.visible = a.kind !== 'bob';
  rimHandle.visible = a.kind !== 'pulse';
  centerHandle.position.copy(W(a.kind === 'bob' ? v.f.center : v.c));
  centerHandle.scale.setScalar(r * 1.3);
  rimHandle.position.copy(W(v.rim));
  rimHandle.scale.setScalar(r * 1.3);
  spokeLine.geometry.dispose();
  spokeLine.geometry = new THREE.BufferGeometry().setFromPoints([centerHandle.position, rimHandle.position]);
  spokeLine.visible = a.kind !== 'pulse';
  arrows.forEach((m, i) => {
    const p = 0.125 + i * 0.25;
    const here = at(p), ahead = at(p + 0.01).sub(here);
    m.visible = ahead.lengthSq() > 1e-12;
    m.position.copy(here);
    if (m.visible) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ahead.normalize());
    m.scale.setScalar(r * 1.1);
  });
  invalidate(1);
}

/** Dragging a piece of stuff's handles: across the view, through where the handle is. */
function dragStuff(x: Attachment, ray: THREE.Ray) {
  const a = x.anim;
  const v = a && stuffViz(x);
  if (!a || !v || !animDrag) return;
  if (animDrag.which === 'radius') return dragOrbitSize(x, a, v, ray);
  const handle = (animDrag.which === 'center' ? centerHandle : rimHandle).position;
  const facing = view.getWorldDirection(new THREE.Vector3());
  const den = facing.dot(ray.direction);
  if (Math.abs(den) < 1e-6) return;
  const hit = ray.origin.clone().addScaledVector(ray.direction, facing.dot(handle.clone().sub(ray.origin)) / den);
  const q = v.b.pivot.worldToLocal(hit);
  const r3 = (w: THREE.Vector3) => w.toArray().map((n) => Math.round(n * 1000) / 1000) as V3;
  if (animDrag.which === 'center') x.anim = { ...a, center: r3(q) };
  else if (a.kind === 'bob') x.anim = { ...a, axis: r3(q.sub(v.f.center)) };
  else {
    const d = q.sub(v.c);
    if (d.lengthSq() > 1e-10) x.anim = { ...a, axis: r3(d.normalize()) };
  }
}

function setPath(pts: THREE.Vector3[]) {
  for (const l of [pathLine, pathUnder]) {
    l.geometry.dispose();
    l.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
  pathLine.computeLineDistances();
}

/** Dragging an Orbit's loop: how far the pointer is from the line it goes round sets how wide it is. */
function dragOrbitSize(x: Attachment, a: StuffAnim, v: NonNullable<ReturnType<typeof stuffViz>>, ray: THREE.Ray) {
  const pivot = v.b.pivot;
  const o = pivot.worldToLocal(ray.origin.clone());
  const d = pivot.worldToLocal(ray.origin.clone().add(ray.direction)).sub(o).normalize();
  const axis = new THREE.Vector3(...a.axis).normalize();
  // on the loop's own plane; seen edge on, across the view instead
  let den = axis.dot(d), normal = axis;
  if (Math.abs(den) < 0.15) {
    normal = pivot.worldToLocal(pivot.getWorldPosition(new THREE.Vector3()).add(view.getWorldDirection(new THREE.Vector3()))).sub(pivot.worldToLocal(pivot.getWorldPosition(new THREE.Vector3()))).normalize();
    den = normal.dot(d);
    if (Math.abs(den) < 1e-6) return;
  }
  const q = o.clone().addScaledVector(d, normal.dot(v.c.clone().sub(o)) / den);
  const placed = orbitOut(a, v.f.center).length();
  if (placed < 1e-4) return;
  const wide = orbitOut(a, q).length() / placed;
  x.anim = { ...a, radius: Math.round(Math.min(8, Math.max(0.05, wide)) * 100) / 100 };
}

/** A handle being dragged */
let animDrag: { which: 'center' | 'rim' | 'radius'; id: number } | null = null;

export function rayAt(e: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), view);
  return raycaster.ray;
}

viewport.addEventListener(
  'pointerdown',
  (e) => {
    if (!animViz.visible || e.button !== 0) return;
    rayAt(e);
    // an Orbit's loop can be grabbed too, to make it wider or narrower
    const orbiting = selStuff()?.anim?.kind === 'orbit';
    raycaster.params.Line.threshold = rider.scale.x * 1.2;
    const hit = raycaster.intersectObjects([centerHandle, rimHandle, ...(orbiting ? [rider, ...arrows, pathLine] : [])].filter((h) => h.visible))[0];
    if (!hit) return;
    // the handle, not the camera or the part under it
    e.stopPropagation();
    e.preventDefault();
    viewport.setPointerCapture(e.pointerId);
    animDrag = { which: hit.object === centerHandle ? 'center' : hit.object === rimHandle ? 'rim' : 'radius', id: e.pointerId };
  },
  { capture: true },
);
viewport.addEventListener(
  'pointermove',
  (e) => {
    if (!animDrag || e.pointerId !== animDrag.id) return;
    const x = selStuff();
    if (x) {
      e.stopPropagation();
      return dragStuff(x, rayAt(e));
    }
    const a = selAnim();
    if (!a) return;
    e.stopPropagation();
    const ray = rayAt(e);
    if (reaching(creature, selected, a)) return dragReach(a, ray);
    const f = partFrame();
    // the tip stays on a ball round the base: aim at where the pointer meets it (or the nearest point to it)
    const R = f.tip.length();
    const handle = (animDrag.which === 'center' ? centerHandle : rimHandle).position;
    const toBase = f.base.clone().sub(ray.origin);
    const along = toBase.dot(ray.direction);
    const closest = ray.origin.clone().addScaledVector(ray.direction, along);
    const miss = closest.distanceTo(f.base);
    let point: THREE.Vector3;
    if (miss >= R) point = closest.sub(f.base).setLength(R).add(f.base);
    else {
      const h = Math.sqrt(R * R - miss * miss);
      const near = ray.origin.clone().addScaledVector(ray.direction, along - h);
      const far = ray.origin.clone().addScaledVector(ray.direction, along + h);
      point = near.distanceTo(handle) <= far.distanceTo(handle) ? near : far;
    }
    // into the part's own frame, measured from where its tip points at rest
    const d = point.sub(f.base).applyQuaternion(f.q.clone().invert()).normalize();
    d.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(f.tip.clone().normalize(), new THREE.Vector3(0, 1, 0)));
    const lean = leanOf(d, a.flip);
    if (animDrag.which === 'center') setAnim({ ...a, x: Math.round(lean[0]), z: Math.round(lean[1]) });
    else {
      const dx = lean[0] - a.x, dz = lean[1] - a.z;
      setAnim({ ...a, size: Math.round(Math.min(90, Math.hypot(dx, dz))), dir: Math.round(Math.atan2(dz, dx) / (Math.PI / 180)) });
    }
  },
  { capture: true },
);
/** Dragging a reaching part's handles: the motion lives in the creature's space, not on a ball. */
function dragReach(a: PartAnim, ray: THREE.Ray) {
  const rest = restTips.get(creature)?.get(selected);
  if (!rest || !animDrag) return;
  const D = Math.PI / 180, k = reachLen(creature, selected) * D;
  const o = creature.root.worldToLocal(ray.origin.clone());
  const d = creature.root.worldToLocal(ray.origin.clone().add(ray.direction)).sub(o).normalize();
  const center = rest.clone().add(reachRim({ ...a, size: 0 }, k / D));
  // the pointer on a plane through `at` facing `normal` (null if it runs along it)
  const onPlane = (at: THREE.Vector3, normal: THREE.Vector3) => {
    const den = normal.dot(d);
    return Math.abs(den) < 1e-4 ? null : o.clone().addScaledVector(d, normal.dot(at.clone().sub(o)) / den);
  };
  const unmirror = (v: THREE.Vector3) => (a.flip ? v.setX(-v.x) : v);
  // centre and edge slide over the level the motion sits at
  const q = onPlane(center, new THREE.Vector3(0, 1, 0));
  if (!q) return;
  if (animDrag.which === 'center') {
    const off = unmirror(q.sub(rest));
    setAnim({ ...a, x: Math.round(off.x / k), z: Math.round(off.z / k) });
  } else {
    const v = unmirror(q.sub(center));
    setAnim({ ...a, size: Math.round(Math.min(90, Math.hypot(v.x, v.z) / k)), dir: Math.round(Math.atan2(v.x, v.z) / D) });
  }
}

const endAnimDrag = (e: PointerEvent) => {
  if (!animDrag || e.pointerId !== animDrag.id) return;
  e.stopPropagation();
  animDrag = null;
  commit();
};
viewport.addEventListener('pointerup', endAnimDrag, { capture: true });
viewport.addEventListener('pointercancel', endAnimDrag, { capture: true });

// ---- rendering one loop out as a GIF ----
//
// Not a live recording: each frame is posed, then waits for its joins to finish
// fusing (and, with Seamless, for the seamless skin to be built) before it's
// drawn, so nothing is caught half-blended. Exactly 25 frames a second (GIF
// times frames in hundredths), a whole number of frames per loop.
// TODO(anim): Seamless can take ~30 s a frame on a big creature (a coarser skin just for renders?); transparent background; a size option; WebM/MP4 out too; frames are
// held in memory, so very long loops at a big size could run out.

const GIF_FPS = 25;
/** the longest side of the GIF, in pixels */
const GIF_MAX = 640;
/** how far a pixel's color (summed over red, green and blue) can move before the GIF changes it */
const GIF_STICKY = 9;
let animRendering: { cancel: boolean } | null = null;
let gifSeamless = false;

const frameWait = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** Fuse every join the pose moved, all the way (and build seamless skins, if asked). */
async function finishJoins(seamless: boolean) {
  for (const c of creatures) {
    c.setDragging(false);
    for (let n = 0; n < 2000 && (c.updateMerge() || c.mergePending); n++) if (!c.mergePending) break;
  }
  if (!seamless) return;
  for (const c of creatures) {
    if (c.skinState === 'none') await c.settle();
    while (c.skinState === 'building') await frameWait();
    // dress the new skin in the current look
    c.updateMerge();
  }
}

function setRenderButton(text: string, busy: boolean) {
  const btn = $('#anim-render');
  iconLabel(btn, faClassic(busy ? 'xmark' : 'file-image'), text);
  btn.classList.toggle('recording', busy);
}

$('#anim-render').onclick = async () => {
  if (animRendering) {
    animRendering.cancel = true;
    return;
  }
  const job = (animRendering = { cancel: false });
  const wasPlaying = animPlaying, wasT = animT;
  animPlaying = false;
  animViz.visible = false;
  renderAnim();
  const frames = Math.max(2, Math.round(animSecs() * GIF_FPS));
  const src = renderer.domElement;
  const k = Math.min(1, GIF_MAX / Math.max(src.width, src.height));
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  const shots: Uint8ClampedArray[] = [];
  try {
    const started = performance.now();
    for (let i = 0; i < frames && !job.cancel; i++) {
      // how long the rest will take, going by the frames so far (Seamless can be minutes)
      const left = i ? ((performance.now() - started) / i) * (frames - i) / 1000 : 0;
      const eta = left > 90 ? `, about ${Math.round(left / 60)} min left` : left > 5 ? `, about ${Math.round(left)} s left` : '';
      setRenderButton(`Frame ${i + 1} of ${frames}${eta} (click to stop)`, true);
      showAnimAt(i / frames);
      await finishJoins(gifSeamless);
      // draw it now and copy it straight off (the canvas clears after it's shown)
      scene.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
      composer.render();
      ctx.drawImage(src, 0, 0, w, h);
      shots.push(ctx.getImageData(0, 0, w, h).data);
      await frameWait();
    }
    if (!job.cancel) {
      setRenderButton('Making the GIF…', true);
      await frameWait();
      // one palette for every frame (sampled across all of them), so colors don't shimmer
      const step = Math.max(1, Math.floor((shots.length * w * h) / 400_000));
      // each frame is sampled on its own, so size it per frame (rounding up each time)
      const sample = new Uint8ClampedArray(shots.length * Math.ceil((w * h) / step) * 4);
      let o = 0;
      for (const s of shots) for (let p = 0; p < w * h; p += step) sample.set(s.subarray(p * 4, p * 4 + 4), (o++) * 4);
      const palette = quantize(sample.subarray(0, o * 4), 256);
      const gif = GIFEncoder();
      // Sticky colors: a pixel keeps last frame's color unless it's really changed
      // since that color was picked. Soft shadows shift a hair as the pose moves,
      // and with only a few dark colors to go round, a whole shadow would
      // otherwise flicker between two of them.
      const anchor = new Uint8ClampedArray(w * h * 4);
      let last: Uint8Array | null = null;
      for (const s of shots) {
        const index = applyPalette(s, palette);
        if (last) {
          for (let p = 0, q = 0; p < w * h; p++, q += 4) {
            const d = Math.abs(s[q] - anchor[q]) + Math.abs(s[q + 1] - anchor[q + 1]) + Math.abs(s[q + 2] - anchor[q + 2]);
            if (d <= GIF_STICKY) index[p] = last[p];
            else anchor.set(s.subarray(q, q + 4), q);
          }
        } else anchor.set(s);
        gif.writeFrame(index, w, h, { palette, delay: 1000 / GIF_FPS });
        last = index;
      }
      gif.finish();
      const url = URL.createObjectURL(new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(world.name || state.name || 'critter').trim()}-loop.gif`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      hint(`GIF saved: ${frames} frames`, 2400);
    }
  } catch (err) {
    console.error(err);
    hint('Couldn’t make the GIF', 3000, true);
  } finally {
    animRendering = null;
    setRenderButton('Render GIF', false);
    animT = wasT;
    animPlaying = wasPlaying;
    animKey = '';
    renderAnim();
    invalidate();
  }
};
for (const b of $('#anim-gif-joins').querySelectorAll<HTMLButtonElement>('button')) {
  b.onclick = () => {
    gifSeamless = b.dataset.joins === 'seamless';
    for (const o of $('#anim-gif-joins').querySelectorAll('button')) o.classList.toggle('active', o === b);
  };
}
setRenderButton('Render GIF', false);

// boot

$<HTMLInputElement>('#ao').checked = gtao.enabled;
world.creatures.forEach((s, i) => (creatures[i] = makeCreature(s)));
setBooted(true);

activate(world.active);
// My creations: the open scene's details are read back; a scene from before
// the library existed joins it
if (opened.id) {
  opened.keep = true;
  const id = opened.id;
  void getCreation<CreationData>(id)
    .then((c) => {
      if (!c || opened.id !== id) return;
      opened.created ||= c.created;
      opened.thumb ??= c.thumb;
      opened.savedJson ||= JSON.stringify(c.data);
      // and seen as it was left (unless the view's already been moved)
      const v = c.data.look?.camera;
      if (v && !viewMoved && mode !== 'stuff') putView(v, false);
    })
    .catch(() => {});
} else if (loadedWorld && JSON.stringify(loadedWorld.creatures) !== JSON.stringify(freshWorld().creatures)) {
  opened.keep = true;
}
commit();
renderUI();
if (mode === 'shape' && idle) hintOnce('Click a part to begin!');
renderSettings();
applyLighting();
applyFloor();
setOrtho(sceneOrtho);
resize();
requestAnimationFrame(loop);

// works offline and installs as an app (the worker is written at build time: vite.config.ts)
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// handy for poking at the scene from the dev-tools console
if (import.meta.env.DEV) Object.assign(window, { __cc: { scene, camera, renderer, composer, controls, flyTo, renderNow: () => { controls.update(); composer.render(); }, screenToLocal, localToOverlay, partPlane, get creature() { return creature; }, get drawState() { return drawState; }, openFile, selectAttachment, gizmo } });
