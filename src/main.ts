import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import {
  bendOf,
  blendWithOf,
  carryOnBend,
  Creature,
  defaultState,
  EYE_STYLES,
  partShapes,
  setPartShapes,
  setSeamlessLowPoly,
  setSeamlessMode,
  type Attachment,
  type BlendWith,
  type BoneRT,
  type CreatureState,
  type EyeFinish,
  type EyeStyle,
  type PartKind,
  type PartShape,
  type PartState,
  type Placement,
  type SeamlessMode,
} from './creature';
import { bump, checkScene, collect, reach, renderTrophies, setTrophyHandlers, unlock } from './achievements';
import { bounds, clipLoop, combineLoops, getMeshDetail, pointInPolygon, setMeshDetail, signedArea, smoothLoop, symmetrize, type Vec2 } from './inflate';
import {
  buildThing,
  collection,
  disposeThing,
  downloadText,
  envelope,
  mirrorShape,
  newPiece,
  newThing,
  parseEnvelope,
  putThing,
  removeThing,
  safeFileName,
  setCollection,
  uid,
  type BendMode,
  WRAP_SMOOTH,
  WRAP_STRENGTH,
  type Piece,
  type Thing,
  type Wearer,
} from './stuff';
import {
  FUR_LAYER,
  STYLE_PARAMS,
  STYLES,
  glowWithFlash,
  makeMaterial,
  setFuzzQuality,
  setGlassEnvironment,
  setGlow,
  setGlowMaskOut,
  setSketchPixelRatio,
  styleSettings,
  type GlowFollow,
  type StyleId,
} from './materials';
import { installScrollbars } from './scrollbars';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { ANIM_KINDS, animOffset, animP, canReverse, defaultAnim, leanAt, leanOf, leanQuat, mirrorAnim, reachAt, reachRim, rimLean, orbitOut, STUFF_KINDS, stuffMove, stuffP, type PartAnim, type StuffAnim, type StuffKind } from './animate';
import { customTabs, gizmos, initLayout, setLayoutIdle, setLayoutTab, setSceneColors, type Tab } from './layout';
import { installCursorPress } from './cursorPress';
import { captureShortcut, hasCustomShortcuts, is, keyLabel, labelShortcuts, renderShortcutSheet, resetShortcuts, ridesSurface, stopListening } from './shortcuts';
import { deleteCreation, getCreation, keepStorage, listCreations, markSaved, putCreation, type Creation, type SavedHow } from './library';
import {
  RIGS,
  addLimb,
  canParent,
  deleteLimb,
  deleteSavedRig,
  detachBone,
  duplicateLimb,
  expandRig,
  extendBone,
  getRig,
  mirrorLimb,
  mirrorTarget,
  moveJoint,
  partIds,
  reattachBone,
  moveLimb,
  movedBases,
  reparentAll,
  rigFromTemplate,
  rollLimb,
  saveRig,
  scaleBone,
  savedRigs,
  setParent,
  splitBone,
  unlinkPair,
  type BoneDef,
  type PartCopy,
  type PartSizes,
  type RigState,
  type V3,
} from './rigs';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * Font Awesome icon markup. Slab where it has the icon, classic regular otherwise; both
 * are the two-tone styles, whose fill only shows in the Color theme (style.css).
 */
const fa = (name: string) => `<i class="fa-slab-duo fa-regular fa-${name}" aria-hidden="true"></i>`;
const faClassic = (name: string) => `<i class="fa-duotone fa-regular fa-${name}" aria-hidden="true"></i>`;
/** Sets an element to an icon followed by text (added as a text node, so names need no escaping). */
function iconLabel(el: HTMLElement, icon: string, text = '') {
  el.innerHTML = icon;
  if (text) el.append(` ${text}`);
}

// ---------------------------------------------------------------------------
// renderer / scene

const viewport = $('#viewport');
const canvas = $<HTMLCanvasElement>('#gl');
const overlay = $<HTMLCanvasElement>('#overlay');
const octx = overlay.getContext('2d')!;

// ---------------------------------------------------------------------------
// performance: how much work each frame and each shape takes (Settings)

type Quality = 'high' | 'balanced' | 'fast';
const QUALITY: Record<Quality, { dpr: number; detail: number; fuzz: number; samples: number; shadow: number; ao: boolean; aoSamples: number; glass: number }> = {
  high: { dpr: 2, detail: 1, fuzz: 1, samples: 4, shadow: 2048, ao: true, aoSamples: 16, glass: 1 },
  balanced: { dpr: 1.5, detail: 0.6, fuzz: 0.67, samples: 4, shadow: 2048, ao: true, aoSamples: 8, glass: 0.75 },
  fast: { dpr: 1, detail: 0.35, fuzz: 0.34, samples: 2, shadow: 1024, ao: false, aoSamples: 8, glass: 0.5 },
};
let quality: Quality = (() => {
  try {
    const q = JSON.parse(localStorage.getItem('creature-creator/settings') ?? '{}').quality;
    return q in QUALITY ? (q as Quality) : 'high';
  } catch {
    return 'high';
  }
})();
const pixelRatio = () => Math.min(devicePixelRatio, QUALITY[quality].dpr);
setMeshDetail(QUALITY[quality].detail);
setFuzzQuality(QUALITY[quality].fuzz);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(pixelRatio());
setSketchPixelRatio(pixelRatio());
renderer.transmissionResolutionScale = QUALITY[quality].glass;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
// Shadows don't depend on the camera: the loop redraws the map only when a
// shadow caster or the key light actually changed (see shadowsChanged).
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();

// Render on demand: the loop only draws when something asked for it (any
// input, a commit, camera motion, a merge or skin update...). A couple of
// extra frames cover work that lands in a later rAF callback.
let renderFrames = 3;
function invalidate(frames = 3) {
  renderFrames = Math.max(renderFrames, frames);
}

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
setGlassEnvironment(scene.environment);
scene.environmentIntensity = 0.3;

// Studio lighting: a warm key casting soft shadows, a cool fill, and a rim to
// separate the silhouette from the backdrop. Ambient is kept low so form reads.
const hemi = new THREE.HemisphereLight(0xffffff, 0xbfae98, 0.45);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff0dc, 3.2);
key.position.set(2.2, 4.6, 3.0);
key.castShadow = true;
key.shadow.mapSize.setScalar(QUALITY[quality].shadow);
key.shadow.camera.left = key.shadow.camera.bottom = -3;
key.shadow.camera.right = key.shadow.camera.top = 3;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 14;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.015;
key.shadow.radius = 9;
key.shadow.blurSamples = 16;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdce6ff, 0.55);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xfff4f8, 1.4);
scene.add(rim);

// The whole rig of lights can be turned around the scene (Backdrop > Lighting).
// Where each light sits at a turn of 0; the key's is relative to the creatures.
const KEY_AT = new THREE.Vector3(2.2, 0, 3.0);
const FILL_AT = new THREE.Vector3(-4, 1.8, 2.5);
const RIM_AT = new THREE.Vector3(-1.5, 3, -4.5);
const LIGHT_KEY = 'creature-creator/light';
let lightTurn = (() => {
  try {
    return Number(JSON.parse(localStorage.getItem(LIGHT_KEY) ?? '{}').turn) || 0;
  } catch {
    return 0;
  }
})();
function lightSpin(): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(lightTurn));
}
function applyLighting() {
  const q = lightSpin();
  fill.position.copy(FILL_AT).applyQuaternion(q);
  rim.position.copy(RIM_AT).applyQuaternion(q);
  fitShadows();
}

// Invisible floor that only shows shadows and contact occlusion, so the
// backdrop color is seamless in every direction.
const shadowMat = new THREE.ShadowMaterial({ opacity: 0.55 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), shadowMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.renderOrder = 2; // shadows draw over the mirror veil
scene.add(ground);

// ---------------------------------------------------------------------------
// floor options: none / backdrop (shadow catcher) / mirror / material

type FloorMode = 'none' | 'shadow' | 'mirror' | 'material';
const FLOOR_KEY = 'creature-creator/floor';
const floorPrefs: { mode: FloorMode; style: StyleId; color: string; glow: number; glowFollow?: GlowFollow; reflect: number } = (() => {
  const defaults = { mode: 'shadow' as FloorMode, style: 'clay' as StyleId, color: '#d6c7b3', glow: 0, reflect: 0.55 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(FLOOR_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
})();
let mirror: Reflector | null = null;
// A backdrop-colored veil over the mirror: reflection strength fades the
// reflection toward the backdrop, so the floor stays seamless at the horizon.
const veil = new THREE.Mesh(
  new THREE.CircleGeometry(40, 96),
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
);
veil.rotation.x = -Math.PI / 2;
veil.position.y = -0.0005;
veil.renderOrder = 1;
veil.visible = false;
scene.add(veil);
let floorMesh: THREE.Mesh | null = null;
let floorKey = '';

function saveFloor() {
  try {
    localStorage.setItem(FLOOR_KEY, JSON.stringify(floorPrefs));
  } catch {
    /* ignore */
  }
}

/** Veil and fog both match the (tone-compensated) backdrop exactly. */
function refreshFloorColors() {
  const bg = scene.background as THREE.Color | null;
  if (!bg) return;
  (veil.material as THREE.MeshBasicMaterial).color.copy(bg);
  if (scene.fog) (scene.fog as THREE.Fog).color.copy(bg);
}

function sizeMirror() {
  if (!mirror) return;
  const dpr = pixelRatio();
  mirror.getRenderTarget().setSize(Math.round(viewport.clientWidth * dpr), Math.round(viewport.clientHeight * dpr));
}

/** A real floor surface in one of the creature materials. */
function buildFloorMesh() {
  const settings = styleSettings(floorPrefs.style, state.materialSettings?.[floorPrefs.style]);
  const key = JSON.stringify([floorPrefs.style, floorPrefs.color, settings]);
  if (floorMesh && key === floorKey) {
    setGlow(floorMesh, floorPrefs.color, floorPrefs.glow, { follow: floorPrefs.glowFollow });
    return;
  }
  floorKey = key;
  if (floorMesh) {
    scene.remove(floorMesh);
    (floorMesh.material as THREE.Material).dispose();
    floorMesh.geometry.dispose();
  }
  let geo: THREE.BufferGeometry = new THREE.PlaneGeometry(50, 50, 100, 100);
  geo.rotateX(-Math.PI / 2);
  if (floorPrefs.style === 'lowpoly') {
    // a gently faceted ground with per-facet shade variation
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.02);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let f = 0; f < n; f += 3) {
      const k = 0.9 + ((Math.sin(f * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.12;
      for (let j = 0; j < 3; j++) colors.set([k, k, k], (f + j) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  floorMesh = new THREE.Mesh(geo, makeMaterial(floorPrefs.style, floorPrefs.color, settings));
  floorMesh.position.y = -0.002;
  floorMesh.receiveShadow = true;
  setGlow(floorMesh, floorPrefs.color, floorPrefs.glow, { follow: floorPrefs.glowFollow });
  scene.add(floorMesh);
}

/**
 * Glass only refracts what's drawn before it, which is the opaque objects, so a
 * see-through shadow catcher would vanish behind a glass jar (a creature in a
 * jar would float with no shadow under it). So the catcher is drawn with the
 * opaque objects, keeping its alpha blending. Over a mirror it has to be drawn
 * after the veil instead, as a normal see-through layer.
 */
function setShadowCatcher(withOpaque: boolean) {
  if (shadowMat.transparent === !withOpaque) return;
  shadowMat.transparent = !withOpaque;
  shadowMat.blending = withOpaque ? THREE.CustomBlending : THREE.NormalBlending;
  shadowMat.blendSrc = THREE.SrcAlphaFactor;
  shadowMat.blendDst = THREE.OneMinusSrcAlphaFactor;
  // as three's normal blending: the picture's own alpha stays solid
  shadowMat.blendSrcAlpha = THREE.OneFactor;
  shadowMat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  shadowMat.needsUpdate = true;
}

function applyFloor() {
  const m = floorPrefs.mode;
  ground.visible = m === 'shadow' || m === 'mirror';
  setShadowCatcher(m !== 'mirror');

  if (m === 'mirror' && !mirror) {
    mirror = new Reflector(new THREE.CircleGeometry(40, 96), { clipBias: 0.003, color: 0xffffff, textureWidth: 1024, textureHeight: 1024 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.001;
    scene.add(mirror);
    sizeMirror();
  }
  if (mirror) mirror.visible = m === 'mirror';
  veil.visible = m === 'mirror';
  (veil.material as THREE.MeshBasicMaterial).opacity = 1 - floorPrefs.reflect;
  if (m === 'material') buildFloorMesh();
  if (floorMesh) floorMesh.visible = m === 'material';
  // a real floor fades into the backdrop instead of ending at a hard edge
  scene.fog = m === 'material' ? new THREE.Fog(0xffffff, 5, 20) : null;
  refreshFloorColors();
}

const BG_KEY = 'creature-creator/bg';
const BACKDROPS = ['#f5efe4', '#fbe3e1', '#e3efe0', '#dfe9f5', '#ebe3f5', '#fff4c7', '#3a3340', '#1d2433'];
let backdrop = localStorage.getItem(BG_KEY) ?? BACKDROPS[0];

/** three's Neutral tone mapping (exposure 1), mirrored in JS. */
function neutralTone([r, g, b]: number[]): number[] {
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c = [r - offset, g - offset, b - offset];
  const peak = Math.max(...c);
  const start = 0.76;
  if (peak < start) return c;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  c = c.map((v) => (v * newPeak) / peak);
  const k = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return c.map((v) => v + (newPeak - v) * k);
}

/** Pre-compensate a color so it comes out of tone mapping unchanged. */
function untoned(target: THREE.Color): THREE.Color {
  const want = [target.r, target.g, target.b];
  let c = want.slice();
  for (let i = 0; i < 40; i++) {
    const got = neutralTone(c);
    c = c.map((v, j) => Math.min(8, Math.max(0, v + (want[j] - got[j]))));
  }
  return new THREE.Color(c[0], c[1], c[2]);
}

/** Tints the shadow toward a deeper, slightly cooler version of the backdrop, and the bounce light toward it. */
function tintForBackdrop(c: THREE.Color) {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  shadowMat.color.setHSL((hsl.h + 0.02) % 1, Math.min(1, hsl.s * 0.8 + 0.1), hsl.l * 0.25);
  hemi.groundColor.copy(c).multiplyScalar(0.8);
}

/** The Stuff workbench has its own backdrop while it's open; the scene's comes back after. */
const STUFF_BACKDROP = '#adcfa5';
function paintBackdrop(hex: string) {
  const c = new THREE.Color(hex);
  scene.background = untoned(c);
  tintForBackdrop(c);
  refreshFloorColors();
}

function setBackdrop(hex: string) {
  backdrop = hex;
  paintBackdrop(mode === 'stuff' ? STUFF_BACKDROP : hex);
  try {
    localStorage.setItem(BG_KEY, hex);
  } catch {
    /* ignore */
  }
}
paintBackdrop(backdrop);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
camera.position.set(2.8, 2.0, 4.4);
// Ortho: the controls still move `camera`; orthoCam follows it, as big as
// `camera` sees at the orbit centre, so framing and zooming work the same.
// It draws from behind its spot too (negative near), so nothing close is cut off.
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 100);
/** whichever of the two draws the scene (and is picked and projected through) */
let view: THREE.PerspectiveCamera | THREE.OrthographicCamera = camera;

// Post-processing: MSAA scene render, ground-truth ambient occlusion for the
// creases where parts meet and contact shadows on the floor, then tone mapping.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: QUALITY[quality].samples }));

// Felt fuzz and ambient occlusion: AO darkens whatever pixels it lands on,
// and the fuzz halo sticks out past the body's edge over the floor's contact
// shadow, so it would come out with dark smudges along the silhouette. With AO
// on, the fuzz (shells and stray hairs, flagged `fx`) is hidden for the scene
// and AO passes and drawn afterwards, on top, by furPass.
let furHidden: THREE.Object3D[] = [];
function hideFur() {
  scene.traverseVisible((o) => {
    if (o.userData.fx) furHidden.push(o);
  });
  for (const o of furHidden) o.visible = false;
}
function showFur() {
  for (const o of furHidden) o.visible = true;
  furHidden = [];
}

// Handles and gizmos (drawn with depthTest off, to show through the body)
// would end up under the fuzz too, so with the fur pass on they're held back
// as well and drawn last, over the fuzz.
const OVERLAY_LAYER = 2;
let overlayHidden: THREE.Object3D[] = [];
function hideOverlays() {
  scene.traverseVisible((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (m && (Array.isArray(m) ? m : [m]).some((x) => !x.depthTest)) overlayHidden.push(o);
  });
  for (const o of overlayHidden) o.visible = false;
}

const scenePass = new RenderPass(scene, view);
const scenePassRender = scenePass.render.bind(scenePass);
scenePass.render = (...args: Parameters<RenderPass['render']>) => {
  if (furPass.enabled) {
    hideFur();
    hideOverlays();
  }
  scenePassRender(...args);
};
composer.addPass(scenePass);
const gtao = new GTAOPass(scene, camera, 1, 1);
// Stock GTAO counts anything within `thickness` in camera depth as an
// occluder, cut off sharply. Looking down, the floor behind a leg's edge
// comes within that depth partway up the leg, so the shade switched on there
// and moved as the camera did. Here an occluder fades out by its real distance
// instead: the same from every angle, and soft at the limit.
gtao.gtaoMaterial.fragmentShader = gtao.gtaoMaterial.fragmentShader
  .replaceAll('if (abs(viewDelta.z) < thickness) {', '{ float occW = 1. - smoothstep(0.5 * thickness, thickness, length(viewDelta));')
  .replace(/(cosHorizons\.[xy] \+= max\(0\., \(sampleCosHorizon - cosHorizons\.[xy]\) \* mix\(1\., 2\. \/ float\(j \+ 2\), distanceFallOff\))\);/g, '$1 * occW);');
gtao.gtaoMaterial.needsUpdate = true;
gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1.6, thickness: 0.6, scale: 1.3, samples: QUALITY[quality].aoSamples });
gtao.enabled = QUALITY[quality].ao;
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.blendIntensity = 1.0;
// The AO is worked out from a depth image with no anti-aliasing, then
// multiplied onto the smoothed picture. An outline's edge pixels are part
// floor (or whatever's behind) in the picture but all part in the AO, and a
// part has no AO right at its edge, so they kept the floor's colour with none
// of its shade: a light, stepped line round everything, glaring on a bright
// backdrop. Where a pixel is clearly lighter than a neighbour (an edge), it
// takes half that neighbour's shade, about what a half-and-half pixel needs.
// Smooth AO, away from edges, is left exactly as it was.
const aoTexel = new THREE.Vector2(1, 1);
gtao.blendMaterial.uniforms.texel = { value: aoTexel };
gtao.blendMaterial.fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec4 ao = texture2D(tDiffuse, vUv);
    float darkest = min(
      min(texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).r, texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).r),
      min(texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).r, texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).r));
    float edge = smoothstep(0.06, 0.2, ao.r - darkest);
    ao.rgb = vec3(mix(ao.r, darkest, 0.5 * edge));
    gl_FragColor = vec4(mix(vec3(1.0), ao.rgb, intensity), ao.a);
  }`;
gtao.blendMaterial.needsUpdate = true;
composer.addPass(gtao);

/**
 * Draws the fuzz over the AO'd image. The image's own depth was lost when AO
 * wrote it out, so AO's depth (the scene without fuzz) is copied in first:
 * fuzz behind the body stays hidden.
 */
class FurPass extends Pass {
  private depthCopy = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragDepth = texture2D(tDepth, vUv).x; }',
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      colorWrite: false,
    }),
  );

  constructor() {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const fur = furHidden;
    const overlays = overlayHidden;
    overlayHidden = [];
    showFur();
    for (const o of overlays) o.visible = true;
    if (!fur.length && !overlays.length) return;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    (this.depthCopy.material as THREE.ShaderMaterial).uniforms.tDepth.value = gtao.depthTexture;
    this.depthCopy.render(renderer);
    // only the fuzz: no backdrop (it would paint over everything), lights kept
    const background = scene.background;
    scene.background = null;
    const mask = view.layers.mask;
    if (fur.length) {
      view.layers.set(FUR_LAYER);
      renderer.render(scene, view);
    }
    // then the handles, on top of it all
    if (overlays.length) {
      for (const o of overlays) o.layers.enable(OVERLAY_LAYER);
      view.layers.set(OVERLAY_LAYER);
      renderer.render(scene, view);
      for (const o of overlays) o.layers.disable(OVERLAY_LAYER);
    }
    view.layers.mask = mask;
    scene.background = background;
    renderer.autoClear = autoClear;
  }
}
const furPass = new FurPass();
composer.addPass(furPass);

/**
 * Glowing colors (materials.ts glowMaterial) get a soft halo: the scene is
 * drawn again, small, with each glowing thing putting out just its glow (in
 * its own material, so the halo follows its texture too) and everything else
 * black (so it still hides what's behind it), and that is blurred over the
 * picture. Fuzz, see-through things and handles don't hide the glow.
 * Skipped while nothing in view glows.
 */
class GlowPass extends Pass {
  private mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0, 0);
  private over = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // the picture with the halo added (its alpha, a transparent photo's, as it was)
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform sampler2D tBloom; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb + texture2D(tBloom, vUv).rgb, c.a); }',
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  /** stands in for anything that hides the glow behind it, per side */
  private black = new Map<THREE.Side, THREE.MeshBasicMaterial>();
  /** draws nothing at all */
  private skip = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  constructor() {
    super();
    this.needsSwap = false;
    // mostly the finest blurs: a halo that hugs what glows, not a haze over the whole picture
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1, 0.4, 0.1, 0.02, 0];
  }

  setSize(w: number, h: number) {
    this.mask.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.bloom.setSize(w, h);
  }

  private blackMat(side: THREE.Side) {
    let m = this.black.get(side);
    if (!m) this.black.set(side, (m = new THREE.MeshBasicMaterial({ color: 0x000000, side })));
    return m;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.needsSwap = false;
    const swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    const hidden: THREE.Object3D[] = [];
    let glowing = false;
    scene.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) hidden.push(o);
        return;
      }
      // a mirror draws the whole scene again
      if ((o as THREE.Mesh & { isReflector?: boolean }).isReflector) return void hidden.push(o);
      const m = mesh.material;
      let use: THREE.Material = this.skip;
      if (!Array.isArray(m) && m.visible && !o.userData.fx) {
        if (m.userData.glow) {
          // drawn as it is, putting out only its glow (glowMaskOut)
          glowing = true;
          return;
        }
        if (m.depthTest && m.depthWrite && m.colorWrite && !m.transparent && !(m as THREE.MeshPhysicalMaterial).transmission) use = this.blackMat(m.side);
      }
      swaps.push([mesh, m]);
      mesh.material = use;
    });
    if (glowing) {
      for (const o of hidden) o.visible = false;
      const background = scene.background, fog = scene.fog;
      const shadows = renderer.shadowMap.autoUpdate;
      const clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      scene.background = null;
      scene.fog = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.mask);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      setGlowMaskOut(true);
      renderer.render(scene, view);
      setGlowMaskOut(false);
      renderer.setClearColor(clear, clearAlpha);
      renderer.shadowMap.autoUpdate = shadows;
      scene.background = background;
      scene.fog = fog;
      for (const o of hidden) o.visible = true;
    }
    for (const [mesh, m] of swaps) mesh.material = m;
    if (!glowing) return;
    // blurred into the bloom's own targets (it also adds itself onto the mask, which is just thrown away)
    this.bloom.render(renderer, this.mask, this.mask, 0, false);
    // into the other buffer, not drawn over this one: drawing into the
    // (multisampled) picture again would undo the ambient occlusion laid on it
    const u = (this.over.material as THREE.ShaderMaterial).uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.over.render(renderer);
    this.needsSwap = true;
  }
}
const glowPass = new GlowPass();
composer.addPass(glowPass);
// lights have to share the fuzz's layer to light it
for (const l of [hemi, key, fill, rim]) l.layers.enable(FUR_LAYER);
// optional macro-photo depth of field, focused on whatever the camera orbits
const bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0.004, maxblur: 0.012 });
bokeh.enabled = false;
composer.addPass(bokeh);

const ORTHO_KEY = 'creature-creator/ortho';
/** Shape and Look's choice (Stuff always opens in ortho) */
let sceneOrtho = (() => {
  try {
    return localStorage.getItem(ORTHO_KEY) === '1';
  } catch {
    return false;
  }
})();

/** Keep orthoCam on `camera`'s spot, facing the same way, framing what it frames at the orbit centre. */
function syncView() {
  if (view !== orthoCam) return;
  const h = camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  orthoCam.top = h;
  orthoCam.bottom = -h;
  orthoCam.right = h * camera.aspect;
  orthoCam.left = -h * camera.aspect;
  orthoCam.position.copy(camera.position);
  orthoCam.quaternion.copy(camera.quaternion);
  orthoCam.updateProjectionMatrix();
  orthoCam.updateMatrixWorld();
}

/** Perspective or ortho, for everything that draws, picks or projects through the camera. */
function setOrtho(on: boolean) {
  view = on ? orthoCam : camera;
  syncView();
  scenePass.camera = view;
  gtao.camera = view;
  bokeh.camera = view;
  gizmo.camera = view;
  const persp = on ? 0 : 1;
  for (const m of [gtao.gtaoMaterial, gtao.depthRenderMaterial, bokeh.materialBokeh]) {
    m.defines.PERSPECTIVE_CAMERA = persp;
    m.needsUpdate = true;
  }
  document.querySelectorAll<HTMLButtonElement>('#view-proj button').forEach((b) => b.classList.toggle('active', (b.dataset.proj === 'ortho') === on));
  renderOverlay();
  invalidate();
}
composer.addPass(new OutputPass());
function setAO(on: boolean) {
  gtao.enabled = on;
  // without AO the fuzz is simply drawn with everything else
  furPass.enabled = on;
}
setAO(gtao.enabled);

// ---------------------------------------------------------------------------
// state + history

/**
 * The whole scene: several creatures, one of which is active. `state` and
 * `creature` always point at the active one, so every panel and tool works on
 * whichever creature is selected.
 */
interface World {
  creatures: CreatureState[];
  active: number;
  /** the thing on the Stuff workbench (shared by the whole scene) */
  workbench?: Thing;
  /** scene name, used for .scene files */
  name?: string;
  /** how long one whole animation loop takes, seconds (Animate tab) */
  animSecs?: number;
}

const WORLD_KEY = 'creature-creator/world';
const OLD_KEY = 'creature-creator/v1';
/** which of My creations the open scene is (kept apart from the world, so undo can't change it) */
const CREATION_KEY = 'critterkiln/creation';
const loadedWorld = loadWorld();
let world: World = loadedWorld ?? freshWorld();
/** The open scene's place in My creations. */
const opened = {
  id: localStorage.getItem(CREATION_KEY),
  created: 0,
  thumb: undefined as string | undefined,
  /** a scene only joins the library once something's been done to it (or it came from somewhere) */
  keep: false,
  /** what was last written, so an unchanged scene isn't saved again */
  savedJson: '',
  timer: 0,
  /** how many times the save has waited for a drag or skin to finish */
  waits: 0,
  /** writes queue up so they land in order */
  writing: Promise.resolve(),
};
let state: CreatureState = world.creatures[world.active];
const creatures: Creature[] = [];
let creature: Creature;
/** redraws each color picker's "In the scene" row (see sceneColorRow) */
const sceneColorRows: (() => void)[] = [];
let selected = '';
/** Nothing picked: no creature or part shows as selected (no handles, no part editor) until one is clicked. */
let idle = true;
/** Shape, Look, a tab people made (src/layout.ts), or Stuff */
type Mode = Tab | 'stuff';
let mode: Mode = 'shape';
let eyePair = 0;

function freshWorld(): World {
  return { creatures: [defaultState(rigFromTemplate(RIGS[0]))], active: 0 };
}

function loadWorld(): World | null {
  try {
    const raw = localStorage.getItem(WORLD_KEY);
    if (raw) {
      const w = JSON.parse(raw) as World;
      const list = (w.creatures ?? []).map(migrate).filter((s): s is CreatureState => !!s);
      if (list.length) return { creatures: list, active: Math.min(Math.max(0, w.active ?? 0), list.length - 1), workbench: w.workbench, name: w.name, animSecs: w.animSecs };
    }
    // the single-creature autosave from before scenes existed
    const old = localStorage.getItem(OLD_KEY);
    const s = old ? migrate(JSON.parse(old)) : null;
    if (s) {
      const workbench = s.workbench;
      delete s.workbench;
      return { creatures: [s], active: 0, workbench };
    }
  } catch {
    /* fall through to a fresh scene */
  }
  return null;
}

/** Bring a saved creature (autosave or file) up to the current format. */
function migrate(data: unknown): CreatureState | null {
  try {
    const s = data as CreatureState & { rigId?: string };
    if (!s || typeof s !== 'object' || !s.parts) return null;
    // saves from before rigs were editable: adopt the template, drop the old-format pose
    if (!s.rig) {
      const t = RIGS.find((r) => r.id === s.rigId);
      if (!t) return null;
      s.rig = rigFromTemplate(t);
      s.pose = {};
      delete s.rigId;
    }
    // from the pose-keyframes try: a creature closed mid-Animate gets its own pose back
    const kf = s as { keys?: unknown; animBase?: { pose: CreatureState['pose']; root: V3 } };
    if (kf.animBase) {
      s.pose = kf.animBase.pose;
      s.rootOffset = kf.animBase.root;
    }
    delete kf.animBase;
    delete kf.keys;
    const e = s.eyes as Partial<CreatureState['eyes']> & { size?: number; spacing?: number; height?: number };
    if (!e.pairs) {
      s.eyes = {
        enabled: e.enabled ?? true,
        style: e.style ?? 'googly',
        pairs: [{ size: e.size ?? 0.5, spacing: e.spacing ?? 0.5, height: e.height ?? 0.55 }],
      };
    }
    return s;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(WORLD_KEY, JSON.stringify(world));
  } catch {
    /* storage full or blocked; nothing to do */
  }
  queueCreationSave();
}

const history: string[] = [];
let hIndex = -1;

function commit() {
  invalidate();
  renderSceneColors();
  world.creatures[world.active] = state;
  const snap = JSON.stringify(world);
  if (snap === history[hIndex]) return;
  history.splice(hIndex + 1);
  history.push(snap);
  if (history.length > 120) history.shift();
  hIndex = history.length - 1;
  save();
  updateUndo();
  fitShadows();
  if (mode === 'stuff') autosaveThing();
  checkScene(world.creatures, world.workbench);
}

function restore(snap: string) {
  invalidate();
  const next = JSON.parse(snap) as World;
  // Rebuild only creatures whose skeleton changed (or that are new); the rest
  // just take their restored state.
  for (let i = 0; i < next.creatures.length; i++) {
    const s = next.creatures[i];
    const c = creatures[i];
    // undo puts parents back as they were: nothing to re-check
    parentsChecked.set(s, structuredClone(s.rig));
    if (c && JSON.stringify(c.state.rig) === JSON.stringify(s.rig)) {
      c.state = s;
      c.sync();
      // merge settings may differ without any part or pose changing
      c.markMergeDirty();
    } else {
      c?.dispose();
      creatures[i] = makeCreature(s);
    }
  }
  while (creatures.length > next.creatures.length) creatures.pop()!.dispose();
  world = next;
  activate(world.active);
  syncWorkbench();
  if (mode === 'stuff') autosaveThing();
  if (selectedAttachment) selectAttachment(selectedAttachment);
  save();
  fitShadows();
  renderUI();
}

function undo() {
  if (hIndex <= 0) return;
  if (drawState) exitDraw(); // a shape waiting for Done isn't in the history yet
  restore(history[--hIndex]);
  updateUndo();
  bump('undo');
}

function redo() {
  if (hIndex >= history.length - 1) return;
  if (drawState) exitDraw();
  restore(history[++hIndex]);
  updateUndo();
}

function updateUndo() {
  $<HTMLButtonElement>('#undo').disabled = hIndex <= 0;
  $<HTMLButtonElement>('#redo').disabled = hIndex >= history.length - 1;
}

/** past loading: re-hung parts get a hint */
let booted = false;
/**
 * Each creature's skeleton as Auto parent last checked it: an edit only
 * re-checks the parts whose base it moved. A creature without one (just
 * opened) has every part checked.
 */
const parentsChecked = new WeakMap<CreatureState, RigState>();
function makeCreature(s: CreatureState): Creature {
  // Auto parent: each part hangs off whatever its base sits on, as you see it (posed)
  if (rigPrefs.autoParent) {
    const before = parentsChecked.get(s);
    const only = before && movedBases(before, s.rig);
    if (!only || only.size) {
      // measured on just the skeleton: the creature itself is only built once
      const probe = new Creature(s, true);
      const changed = reparentAll(s.rig, sizesIn(probe), only).map((x) => x.id);
      rehang(probe, s.rig, changed);
      probe.dispose();
      if (booted && changed.length) {
        const b = changed.length === 1 && expandRig(s.rig).bones.find((x) => x.id === changed[0]);
        if (b && b.parent) hint(`${b.name.replace(/ \((L|R)\)$/, '')} now hangs off ${sceneName(s.rig, b.parent)}`, 2200);
        else if (!b) hint(`${changed.length} parts now hang off the parts their bases sit on`, 2200);
      }
    }
  }
  parentsChecked.set(s, structuredClone(s.rig));
  const c = new Creature(s);
  scene.add(c.root);
  c.root.visible = mode !== 'stuff';
  c.setSkeletonVisible(false);
  return c;
}

/** Make creature `i` the one every panel and tool works on. */
function activate(i: number) {
  const next = creatures[i];
  const switching = creature !== next;
  // gizmos belong to the previous creature (first: leaving Arrange would show its handles again)
  if (switching) stopPlacing();
  if (creature && switching) {
    creature.setSkeletonVisible(false);
    creature.flash(null, 0);
  }
  world.active = i;
  state = world.creatures[i];
  creature = next;
  if (switching) deselectAttachment();
  if (!creature.bones.has(selected)) selected = creature.list[0].def.id;
  creature.select(selected);
  updateSkeletonVisibility();
}

/** Rebuild the active creature from `state` (after skeleton changes, new files...). */
function buildCreature() {
  const i = world.active;
  const wasPlacing = placing;
  creatures[i]?.dispose();
  world.creatures[i] = state;
  creatures[i] = makeCreature(state);
  creature = creatures[i];
  if (!creature.bones.has(selected)) selected = creature.list[0].def.id;
  creature.select(selected);
  updateSkeletonVisibility();
  // gizmos pointed at the old creature's objects
  if (selectedAttachment) selectAttachment(selectedAttachment);
  if (wasPlacing) startPlacing();
}

/** Keep the key light's shadow area covering every creature. */
function fitShadows() {
  const box = new THREE.Box3();
  for (const c of creatures) {
    c.root.updateMatrixWorld(true);
    for (const m of c.meshes()) box.expandByObject(m);
  }
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const half = box.isEmpty() ? 3 : Math.max(3, box.getSize(new THREE.Vector3()).length() / 2 + 1);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -half;
  cam.right = cam.top = half;
  cam.far = 14 + half;
  cam.updateProjectionMatrix();
  key.target.position.set(center.x, 0, center.z);
  const off = KEY_AT.clone().applyQuaternion(lightSpin());
  key.position.set(center.x + off.x, 4.6 + half * 0.3, center.z + off.z);
  key.target.updateMatrixWorld();
}

// ---------------------------------------------------------------------------
// controls (our pointer handlers are registered first so they can veto orbiting)

const raycaster = new THREE.Raycaster();
const pointer = { downX: 0, downY: 0, moved: false, touch: false };
/** A phone or tablet: hints talk about fingers, not mice and keys. */
const touchScreen = () => matchMedia('(pointer: coarse)').matches;
// the last tap on the 3D view, to spot a double tap
let lastTap = { t: 0, x: 0, y: 0 };
let lastDoubleTap = 0;
type DragKind = 'root' | 'start' | 'end' | 'bend' | 'roll';
let drag: {
  id: string;
  kind: DragKind;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  startHit: THREE.Vector3;
  /** rig mode: skeleton at the start of the drag, so each move re-applies from scratch */
  rigBase?: string;
  /**
   * reshaping: turns a world-space move into skeleton space. The bone's base
   * rides its parent, so this undoes everything above it (the parent's pose,
   * a bendy parent's curve, the creature's turn and size) but not the bone's
   * own bend.
   */
  toDef?: THREE.Matrix3;
  /** where the pointer last was (scrolling pushes a dragged tip nearer or further from there) */
  last?: THREE.Vector2;
  /**
   * Dragging a tip: pulled past the part's (or limb's) reach it stretches, and
   * one pushed nearer its base than it started shrinks it. The skeleton before
   * the drag, the limb's straight reach and how far the tip was from its base
   * then (in the scene), how much it's stretched now, and each part's
   * lengthening (for its drawing)
   */
  stretch?: { base: string; reach?: number; from?: number; k: number; kY: Map<string, number> };
  /** a bend grip on one of the bone's bend points: which one */
  node?: number;
  /** a waiting (dotted) bend grip: the gap it sits in, and where (in the bone's frame); it becomes a bend point once it moves */
  gap?: { at: number; pos: THREE.Vector3 };
  /** roll ring: where the press was, which way on screen the ring moves as the part rolls, and how many pixels per radian */
  roll?: {
    start: THREE.Vector2;
    dir: THREE.Vector2;
    pxPerRad: number;
    /** the part (and its twin) before the drag: rest turn and pose, to keep a posed limb where it is */
    rest: Map<string, THREE.Quaternion>;
    pose: CreatureState['pose'];
    /** eyes before the drag: splitting a pair gives its right side its own */
    eyes: CreatureState['eyes'];
    /** pairs hanging off it were split so they could turn with it */
    split?: boolean;
  };
  moved: boolean;
} | null = null;

/**
 * A pose is kept relative to a part's rest axes, which a roll turns: turn it
 * back the other way so a bent limb stays where it was and only spins about
 * its length. `rest` and `pose` are from before the roll.
 */
function keepPoseThroughRoll(rest: Map<string, THREE.Quaternion>, pose: CreatureState['pose']) {
  for (const [lid, before] of rest) {
    const q = pose[lid];
    const l = creature.bones.get(lid);
    if (!q || !l) continue;
    const d = before.clone().invert().multiply(l.restQuat);
    const kept = d.clone().invert().multiply(new THREE.Quaternion(...q)).multiply(d);
    state.pose[lid] = kept.toArray() as [number, number, number, number];
  }
  creature.applyPose();
}

/**
 * Roll a part to `to(its roll now)`, as seen on its own side, turning whatever
 * hangs off it along with it. With Mirror off, a pair stops being one so only
 * this side rolls, and pairs on a middle part are split so they turn with it.
 * Says whether anything was split.
 */
function rollPart(id: string, to: (now: number) => number): boolean {
  // the rig, not the scene: mid-drag the scene already shows an earlier split
  const ex = expandRig(state.rig).bones.find((x) => x.id === id);
  if (!ex) return false;
  const copies = !rigLocked() && ex.sideSign !== 0 ? unlinkPair(state.rig, id) : [];
  const def = state.rig.bones.find((d) => d.id === (copies.length ? id : ex.baseId));
  if (!def) return false;
  // a right twin shares its left twin's roll, turned the other way
  const flip = !copies.length && ex.sideSign === -1 ? -1 : 1;
  const was = def.roll ?? 0;
  let r = to(was * flip) * flip;
  r = Math.round(Math.atan2(Math.sin(r), Math.cos(r)) * 1000) / 1000;
  copies.push(...rollLimb(state.rig, id, r - was, rigLocked()));
  def.roll = r;
  applyPartCopies(copies, true);
  return copies.length > 0;
}

/** Double-clicking a roll grip: straighten the part's roll (and its twin's, with Mirror on). */
function resetRoll(id: string) {
  const b = creature.bones.get(id);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!b || !def) return;
  if (!def.roll) {
    hint('Already straight', 1200);
    return;
  }
  const rest = new Map(creature.linked(id).map((l) => [l.def.id, l.restQuat.clone()] as const));
  const pose = structuredClone(state.pose);
  const split = rollPart(id, () => 0);
  creature.relayout(state.rig);
  keepPoseThroughRoll(rest, pose);
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  settleOnFloor();
  creature.boing(id);
  commit();
  selectPart(id);
  hint(split ? 'Roll straightened: now separate from its other side (Mirror keeps them paired)' : 'Roll straightened', 1600);
}

/**
 * Double-clicking a green bend diamond: undo just that bend (and its twin's).
 * A bend point goes, the part curving through the rest (the last one leaves
 * it straight); an arc's middle straightens it. A waiting (dotted) one has nothing to undo.
 */
function resetBend(id: string, node: number | undefined, used: boolean) {
  const b = creature.bones.get(id);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!b || !def) return;
  if (!used) {
    hint(def.bendNodes?.length || (def.bendy && def.bend) ? 'Not bent there yet: drag it to bend' : 'Already straight', 1400);
    return;
  }
  const one = node !== undefined && !!def.bendNodes && def.bendNodes.length > 1;
  if (one) {
    def.bendNodes!.splice(node!, 1);
    def.bendRound?.splice(node!, 1);
  } else {
    // the last bend: back to one waiting grip in the middle
    delete def.bendNodes;
    delete def.bendRound;
    def.bendy = false;
    def.bend = 0;
  }
  creature.relayout(state.rig);
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  settleOnFloor();
  creature.boing(id);
  commit();
  selectPart(id);
  hint(one ? 'That bend undone' : 'Bend straightened', 1400);
}

/** A point in a bone's frame as a bend point: kept for the left twin (like bendDir), as fractions of the length. */
function bendNodeAt(b: { length: number; def: { sideSign: number } }, v: THREE.Vector3): V3 {
  const r = (x: number) => Math.round((x / b.length) * 1000) / 1000;
  return [r(v.x), r(v.y), r(b.def.sideSign === -1 ? -v.z : v.z)];
}

/**
 * Scrolling on a solid bend grip: how round the curve is there, in tenths
 * from a corner (0) through round (1, an arc) to swollen (2). An arc's middle
 * first becomes a bend point there (the same arc). Kept on a pause.
 */
let roundCommit = 0;
function roundBend(id: string, node: number | undefined, step: number) {
  const b = creature.bones.get(id);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!b || !def) return;
  if (node === undefined || !def.bendNodes?.length) {
    const mid = b.bendHandles.find((h) => h.userData.used)?.position;
    if (!mid) return;
    def.bendNodes = [bendNodeAt(b, mid)];
    delete def.bend;
    delete def.bendDir;
    delete def.bendRound;
    def.bendy = true;
    node = 0;
  }
  const round = def.bendRound ?? def.bendNodes.map(() => 1);
  round[node] = Math.min(2, Math.max(0, Math.round(((round[node] ?? 1) + step * 0.1) * 10) / 10));
  if (round.every((v) => v === 1)) delete def.bendRound;
  else def.bendRound = round;
  creature.relayout(state.rig);
  creature.sync();
  const v = round[node];
  hint(v === 1 ? 'Round, like an arc' : v === 0 ? 'A sharp corner' : `${v < 1 ? 'Sharper' : 'Rounder'}: ${Math.round(v * 100)}%`, 1200);
  clearTimeout(roundCommit);
  roundCommit = window.setTimeout(() => {
    if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
    settleOnFloor();
    commit();
  }, 400);
}

/**
 * Scrolling on a joint: the purple square (a part's own base) widens or
 * narrows its Base width; the orange circle its Tip width, and the Base width
 * of every part growing from that tip with it, so the joint stays even.
 * A part with a drawing grows or shrinks whole instead. Kept on a pause.
 */
let widenCommit = 0;
function widenJoint(id: string, at: 'start' | 'end', step: number) {
  const b = creature.bones.get(id);
  if (!b) return;
  const defOf = (x: { def: { baseId: string } }) => state.rig.bones.find((d) => d.id === x.def.baseId);
  const drawn = (x: { src: string }) => !!state.parts[x.src]?.outline;
  const k = step > 0 ? 1.08 : 1 / 1.08;
  const grow = (w: number) => Math.min(1.2, Math.max(0.02, Math.round(w * k * 1000) / 1000));
  // a drawing sets its own widths: either end grows or shrinks the whole part instead, drawing, length and curve alike
  if (drawn(b)) return scaleDrawnPart(id, k);
  const ends: { def: BoneDef; end: 'base' | 'tip' }[] = [];
  const add = (x: (typeof creature.list)[number], end: 'base' | 'tip') => {
    const d = defOf(x);
    if (d && !drawn(x) && !ends.some((o) => o.def === d && o.end === end)) ends.push({ def: d, end });
  };
  if (at === 'start') add(b, 'base');
  else {
    add(b, 'tip');
    for (const c of creature.list) if (c.parent === b && !c.attach) add(c, 'base');
  }
  if (!ends.length) return;
  for (const { def, end } of ends) {
    if (end === 'base') {
      // the tip keeps the width it had (it followed the base while unset)
      def.widthEnd ??= def.width;
      def.width = grow(def.width);
    } else def.widthEnd = grow(def.widthEnd ?? def.width);
  }
  creature.relayout(state.rig);
  creature.sync();
  hint(step > 0 ? 'Wider' : 'Thinner', 900);
  clearTimeout(widenCommit);
  widenCommit = window.setTimeout(() => {
    settleOnFloor();
    commitBoneEdit();
  }, 400);
}

/** Grow a drawn part (and its twin) by `k` all over, rebuilt at its new size. */
function scaleDrawnPart(id: string, k: number) {
  const b = creature.bones.get(id);
  const part = b && state.parts[b.src];
  if (!b || !part) return;
  creature.capturePose();
  const before = structuredClone(state.rig);
  // (bend points are fractions of the length, so the curve grows with it as it is)
  const kY = scaleBone(state.rig, id, k, k);
  carryEyes(before, new Set([b.def.baseId]), k);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  setPartShapes(part, partShapes(part).map((sh) => ({ ...sh, outline: sh.outline.map(([x, y]) => [r4(x * k), r4(y * kY)] as Vec2) })));
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  hint(k > 1 ? 'Bigger' : 'Smaller', 900);
  clearTimeout(widenCommit);
  widenCommit = window.setTimeout(() => {
    settleOnFloor();
    commitBoneEdit();
  }, 400);
}

/** Double-clicking a joint's tip: unbend that joint (and its twin, with Mirror on). */
function resetJoint(id: string) {
  const b = creature.bones.get(id);
  if (!b) return;
  const twin = rigLocked() ? creature.twinOf(b) : null;
  const ids = [id, ...(twin ? [twin.def.id] : [])].filter((i) => state.pose[i]);
  if (!ids.length) {
    hint('Already straight', 1200);
    return;
  }
  for (const i of ids) delete state.pose[i];
  creature.applyPose();
  settleOnFloor();
  creature.boing(id);
  commit();
  hint('Joint straightened', 1400);
}

/** Double-clicking the root grip: the creature back where it was placed, feet on the floor. */
function resetRoot() {
  creature.group.position.set(0, 0, 0);
  creature.capturePose();
  setKeepFloor(true);
  settleOnFloor();
  commit();
  hint('Back in place, feet on the floor', 1600);
}

/** Where a point in a bone's own space lands on screen, in client pixels. */
function toScreen(obj: THREE.Object3D, local: THREE.Vector3): THREE.Vector2 {
  const r = canvas.getBoundingClientRect();
  const v = local.clone().applyMatrix4(obj.matrixWorld).project(view);
  return new THREE.Vector2(r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height);
}

/** Height of the creature's lowest point above the floor. */
function floorGap(): number {
  const box = creatureBox(true);
  return box.isEmpty() ? 0 : box.min.y;
}
/** where the lowest point was when a move began: raising it means the creature should float */
let gapBefore = 0;
const lifted = () => floorGap() > Math.max(0, gapBefore) + 0.02;

/** Turn "Keep feet on the floor" on or off for this creature. */
function setKeepFloor(on: boolean, announce = false) {
  if ((state.keepFloor !== false) === on) return;
  state.keepFloor = on;
  $<HTMLInputElement>('#keep-floor').checked = on;
  if (announce) hint(on ? 'Feet back on the floor' : 'Floating: "Keep feet on the floor" is off', 2200);
}

/** After a bend or resize, a creature that keeps its feet on the floor settles back onto it. */
function settleOnFloor() {
  if (state.keepFloor === false) return;
  const box = creatureBox(true);
  if (box.isEmpty() || Math.abs(box.min.y) < 1e-4) return;
  const down = creature.root.worldToLocal(new THREE.Vector3(0, -box.min.y, 0)).sub(creature.root.worldToLocal(new THREE.Vector3()));
  creature.group.position.add(down);
  creature.capturePose();
}

canvas.addEventListener('pointerdown', (e) => {
  pointer.downX = e.clientX;
  pointer.downY = e.clientY;
  pointer.moved = false;
  pointer.touch = e.pointerType !== 'mouse';
  // holding Space, the left button only pans
  if (e.button !== 0 || pickingFocus || pickingParent || spacePan) return;
  // pressing on an eye: dragging slides the pair over the surface (a click still opens its settings)
  const onHandle = (handlesVisible() && pickHandle(e.clientX, e.clientY)) || gizmo.dragging || gizmo.axis !== null;
  const eye = !onHandle && mode !== 'stuff' && !drawState && !idle ? pickEyeHit(e.clientX, e.clientY) : null;
  if (eye) {
    eyeDrag = { pair: eye.pair, sgn: eye.sgn };
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (!handlesVisible()) return;
  const h = pickHandle(e.clientX, e.clientY);
  if (!h) return;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  const pos = h.getWorldPosition(new THREE.Vector3());
  const id = h.userData.handle as string;
  const normal =
    id === 'root' ? new THREE.Vector3(0, 1, 0) : camera.getWorldDirection(new THREE.Vector3()).negate();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pos);
  // the root offset lives inside the creature's placement, so work in its local space
  const offset = id === 'root' ? creature.group.position.clone().sub(creature.root.worldToLocal(pos.clone())) : new THREE.Vector3();
  const kind: DragKind = id === 'root' ? 'root' : (h.userData.kind as DragKind);
  // bending is posing; sliding, curving and resizing reshape the skeleton itself
  const reshape = kind !== 'root' && kind !== 'end';
  let toDef: THREE.Matrix3 | undefined;
  const b = creature.bones.get(id);
  if (reshape && b) {
    b.pivot.updateMatrixWorld(true);
    // where the bone would be in the scene if it weren't bent itself
    const unbent = b.pivot.parent!.matrixWorld.clone().multiply(new THREE.Matrix4().compose(b.pivot.position, b.restQuat, new THREE.Vector3(1, 1, 1)));
    toDef = new THREE.Matrix3().setFromMatrix4(b.restWorld.clone().multiply(unbent.invert()));
  }
  let roll: NonNullable<typeof drag>['roll'];
  if (b && kind === 'roll') {
    // which way the ring travels on screen as the part rolls a little (about its own length)
    // which way the ring runs where it was grabbed (it circles the line from base to tip, which is the bone's Y)
    const at = (h.userData.grab as THREE.Vector3 | undefined)?.clone() ?? h.position.clone().add(new THREE.Vector3(h.userData.ring, 0, 0));
    const eps = 0.02;
    const moved = toScreen(b.pivot, at.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), eps)).sub(toScreen(b.pivot, at));
    const pxPerRad = moved.length() / eps;
    // seen end-on the ring barely moves: fall back to dragging sideways
    const visible = pxPerRad > 40;
    const dir = visible ? moved.normalize() : new THREE.Vector2(1, 0);
    const rest = new Map(creature.linked(id).map((l) => [l.def.id, l.restQuat.clone()] as const));
    creature.rolling = true;
    roll = { start: new THREE.Vector2(e.clientX, e.clientY), dir, pxPerRad: visible ? pxPerRad : 120, rest, pose: structuredClone(state.pose), eyes: structuredClone(state.eyes) };
  }
  if (kind === 'root') gapBefore = floorGap();
  const stretch = kind === 'end' ? { base: JSON.stringify(state.rig), k: 1, kY: new Map<string, number>() } : undefined;
  drag = { id, kind, plane, offset, stretch, startHit: pos, moved: false, rigBase: reshape ? JSON.stringify(state.rig) : undefined, toDef, roll, node: h.userData.node as number | undefined, gap: h.userData.gap === undefined ? undefined : { at: h.userData.gap as number, pos: h.position.clone() } };
});

canvas.addEventListener('pointermove', (e) => {
  if (Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 5) pointer.moved = true;
  if (eyeDrag) {
    if (pointer.moved) moveEyesTo(eyeDrag.pair, eyeDrag.sgn, e.clientX, e.clientY);
    return;
  }
  if (drag) {
    setRay(e.clientX, e.clientY);
    const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!hit) return;
    drag.moved = drag.moved || pointer.moved;
    if (drag.rigBase && drag.kind === 'bend') {
      // a green diamond: its bend point goes where the pointer is
      if (!drag.moved) return;
      const b = creature.bones.get(drag.id);
      const def = b && state.rig.bones.find((x) => x.id === b.def.baseId);
      if (!b || !def) return;
      const local = b.pivot.worldToLocal(hit.clone());
      const asNode = (v: THREE.Vector3) => bendNodeAt(b, v);
      if (drag.gap && drag.node === undefined) {
        // a waiting grip, used: it becomes a bend point there (an arc first turns into one through its middle)
        const g = drag.gap;
        if (!def.bendNodes?.length) {
          const mid = b.bendHandles.find((h) => h.userData.used)!.position;
          def.bendNodes = g.at === 0 ? [asNode(g.pos), asNode(mid)] : [asNode(mid), asNode(g.pos)];
          delete def.bend;
          delete def.bendDir;
          delete def.bendRound;
        } else {
          def.bendNodes.splice(g.at, 0, asNode(g.pos));
          def.bendRound?.splice(g.at, 0, 1);
        }
        // gap n sits before point n (gap 1 of an arc: after its middle)
        drag.node = g.at;
      } else if (drag.node === undefined) {
        // a straight part's middle, or an arc's: a bend point there (the same arc: one point curves round
        // the circle through the base, it and the tip), free to go anywhere from then on
        const mid = b.bendHandles.find((h) => h.userData.node === undefined && h.userData.gap === undefined)!.position;
        def.bendNodes = [asNode(mid)];
        delete def.bend;
        delete def.bendDir;
        delete def.bendRound;
        drag.node = 0;
      }
      if (!creature.bendDragging) creature.setBendDragging(true);
      // just that one point moves
      def.bendNodes![drag.node] = asNode(local);
      def.bendy = true;
      creature.relayout(state.rig);
      creature.sync();
    } else if (drag.roll) {
      if (!drag.moved) return;
      const b = creature.bones.get(drag.id);
      if (!b) return;
      const rl = drag.roll;
      const turn = new THREE.Vector2(e.clientX, e.clientY).sub(rl.start).dot(rl.dir) / rl.pxPerRad;
      // start over from before the drag each time (a split pair included)
      state.rig = JSON.parse(drag.rigBase!) as RigState;
      state.eyes = structuredClone(rl.eyes);
      rl.split = rollPart(drag.id, (now) => now + turn);
      creature.relayout(state.rig);
      keepPoseThroughRoll(rl.rest, rl.pose);
      invalidate();
    } else if (drag.rigBase && drag.kind === 'start') {
      if (!drag.moved) return;
      // slide the whole limb: the move in skeleton coordinates (the creature may be turned or posed, the bone may ride a curve)
      // (or over the surface of the part under the pointer: with Alt, or always if the shortcut sheet swaps them)
      const d = ((ridesSurface(e.altKey) && surfaceUnder(drag.id)) || hit.clone()).sub(drag.startHit);
      if (drag.toDef) d.applyMatrix3(drag.toDef);
      state.rig = JSON.parse(drag.rigBase) as RigState;
      moveJoint(state.rig, drag.id, 'start', d.toArray() as V3, rigLocked());
      creature.relayout(state.rig);
    } else if (drag.id === 'root') {
      creature.group.position.copy(creature.root.worldToLocal(hit).add(drag.offset));
      creature.group.position.y = Math.max(creature.group.position.y, -1);
    } else if (drag.kind === 'end') {
      drag.last = new THREE.Vector2(e.clientX, e.clientY);
      dragTipTo(drag.id, hit);
    }
    return;
  }
  if (handlesVisible() && e.buttons === 0) {
    const h = pickHandle(e.clientX, e.clientY);
    creature.setHandleHover(h);
    $('#viewport').style.cursor = h ? 'var(--cursor-click)' : '';
  }
});

/**
 * Sliding a base over the surface (see ridesSurface): the spot on the surface
 * of the part under the pointer (a little inside it), so a base dropped on a
 * head is on the head, not in front of or behind it. Null over empty space. The limb being slid
 * (and its other side) is looked through. Uses the ray from setRay.
 */
function surfaceUnder(id: string): THREE.Vector3 | null {
  const b = creature.bones.get(id);
  if (!b) return null;
  const roots = [b, ...(b.def.sideSign ? [creature.bones.get(b.def.baseId + (b.def.sideSign === 1 ? 'R' : 'L'))] : [])];
  const moving = (x: BoneRT) => {
    for (let p: BoneRT | null = x; p; p = p.parent) if (roots.includes(p)) return true;
    return false;
  };
  const hit = raycaster.intersectObjects(creature.meshes().filter((m) => !moving(creature.bones.get(m.userData.boneId as string)!)), false)[0];
  if (!hit?.face) return null;
  const inward = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).negate();
  return hit.point.clone().addScaledVector(inward, 0.03);
}

/**
 * Pose by an orange tip, stretching the part to follow. With Pull limbs the
 * whole limb bends and stretches (up to the body, or a part it branches from).
 */
function dragTipTo(id: string, hit: THREE.Vector3) {
  const ik = $<HTMLInputElement>('#ik').checked;
  let chain = creature.dragTip(id, hit, ik);
  const st = drag?.stretch;
  if (st) {
    // out of reach: every part of the limb lengthens alike, just enough (and back to its own size within reach)
    // (in between, it bends to reach as usual)
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const base = at(chain[chain.length - 1].pivot);
    st.reach ??= chain.reduce((sum, b) => sum + at(b.tip).distanceTo(at(b.pivot)), 0);
    st.from ??= Math.min(base.distanceTo(drag!.startHit), st.reach);
    const d = base.distanceTo(hit);
    const k = d > st.reach ? d / Math.max(st.reach, 1e-4) : d < st.from ? Math.max(0.1, d / Math.max(st.from, 1e-4)) : 1;
    if (Math.abs(k - st.k) > 1e-3) {
      // (relayout re-seats the stored pose: keep the one just reached)
      creature.capturePose();
      state.rig = JSON.parse(st.base) as RigState;
      st.kY.clear();
      // (a curve through bend points grows with the part, the same shape: they're fractions of its length)
      for (const b of chain) st.kY.set(b.src, scaleBone(state.rig, b.def.id, k, 1));
      creature.relayout(state.rig);
      // the meshes re-bent to their new lengths, as they'll be rebuilt on letting go
      for (const b of chain) creature.previewBend(b.def.id);
      st.k = k;
      chain = creature.dragTip(id, hit, ik);
    }
  }
  if (rigLocked()) creature.mirrorPose(chain);
}

// scrolling on a solid bend grip rounds or sharpens the curve there (instead of zooming)
$('#viewport').addEventListener(
  'wheel',
  (e) => {
    // scrolling while dragging a tip pushes it away or pulls it nearer
    if (drag?.kind === 'end') {
      e.preventDefault();
      e.stopPropagation();
      const at = drag.plane.coplanarPoint(new THREE.Vector3());
      const toward = view.position.clone().sub(at);
      const step = Math.min(toward.length() * 0.06, 0.25) * (e.deltaY > 0 ? -1 : 1);
      drag.plane.translate(toward.normalize().multiplyScalar(step));
      const last = drag.last ?? new THREE.Vector2(pointer.downX, pointer.downY);
      setRay(last.x, last.y);
      const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (hit) {
        drag.moved = true;
        dragTipTo(drag.id, hit);
      }
      return;
    }
    if (!handlesVisible() || drag) return;
    const h = pickHandle(e.clientX, e.clientY);
    const kind = h?.userData.kind;
    const step = e.deltaY < 0 ? 1 : -1;
    if (kind === 'bend' && h!.userData.used) roundBend(h!.userData.handle as string, h!.userData.node as number | undefined, step);
    else if ((kind === 'start' || kind === 'end') && h!.userData.handle !== 'root') widenJoint(h!.userData.handle as string, kind, step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  },
  { capture: true, passive: false },
);

/** Not every phone browser turns a double tap into a dblclick, so spot it on the way up (and act on it). */
function doubleTapped(e: PointerEvent): boolean {
  if (e.pointerType === 'mouse') return false;
  const now = performance.now();
  if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap.t = 0;
    lastDoubleTap = now;
    onDoubleClick(e.clientX, e.clientY);
    return true;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  return false;
}

canvas.addEventListener('pointerup', (e) => {
  if (eyeDrag) {
    const d = eyeDrag;
    eyeDrag = null;
    controls.enabled = true;
    if (pointer.moved) {
      commit();
      showEyes(d.pair);
      return;
    }
    // not moved: a click, which opens the eye settings below
  }
  if (drag) {
    const d = drag;
    drag = null;
    controls.enabled = true;
    // the waiting bend grips come back, in the gaps either side of a new bend point
    if (creature.bendDragging) creature.setBendDragging(false);
    creature.rolling = false;
    $('#viewport').style.cursor = '';
    if (d.rigBase) {
      if (d.moved) {
        // rebuild meshes at their new lengths and re-seat the pose
        if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
        buildCreature();
        settleOnFloor();
        creature.boing(d.id);
        commit();
        if (d.roll?.split) hint('Now separate sides, so only this one turns (Mirror keeps them paired)', 3200);
      }
      selectPart(d.id);
      if (!d.moved) doubleTapped(e);
      return;
    }
    creature.capturePose();
    if (d.stretch && d.stretch.k !== 1) {
      // a limb stretched to reach: drawn parts lengthen with it, and the meshes are rebuilt at their new lengths
      // (eyes placed by hand on them staying on the same spots)
      const base = JSON.parse(d.stretch.base) as RigState;
      const stretched = new Set(expandRig(base).bones.filter((b) => d.stretch!.kY.has(b.id)).map((b) => b.baseId));
      carryEyes(base, stretched, 1);
      const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
      for (const [src, kY] of d.stretch.kY) {
        const part = state.parts[src];
        const shapes = part ? partShapes(part) : [];
        if (shapes.length) setPartShapes(part, shapes.map((sh) => ({ ...sh, outline: sh.outline.map(([x, y]) => [x, r4(y * kY)] as Vec2) })));
      }
      if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
      buildCreature();
      creature.boing(d.id);
    }
    // a double tap on the grip resets it (see onDoubleClick)
    if (!d.moved && doubleTapped(e)) return;
    if (d.moved) {
      // lifting the whole creature up means it's meant to float
      if (d.kind === 'root') {
        if (lifted()) setKeepFloor(false, true);
      } else settleOnFloor();
    }
    commit();
    return;
  }
  if (pointer.moved || e.button !== 0 || gizmo.dragging || drawState) return;
  if (doubleTapped(e)) return;
  if (pickingFocus) {
    focusAt(e.clientX, e.clientY);
    return;
  }
  if (pickingParent) {
    parentAt(e.clientX, e.clientY);
    return;
  }
  if (mode === 'stuff') {
    const id = pickPiece(e.clientX, e.clientY);
    if (id) {
      selectedPiece = id;
      flashPart();
      renderStuffPanel();
    }
    return;
  }
  // clicking a different creature makes it the one being edited
  const other = pickOtherCreature(e.clientX, e.clientY);
  if (other) {
    idle = false;
    activate(other.index);
    if (other.boneId && creature.bones.has(other.boneId)) selected = other.boneId;
    creature.select(selected);
    flashPart();
    save();
    renderUI();
    hint(`Now editing ${creatureLabel(other.index)}`, 1600);
    return;
  }
  const eye = pickEye(e.clientX, e.clientY);
  if (eye !== null) {
    if (idle) {
      idle = false;
      updateSkeletonVisibility();
      renderUI();
    }
    showEyes(eye);
    return;
  }
  const att = pickAttachment(e.clientX, e.clientY);
  if (att) return animOn() ? pickAnimStuff(att) : pickStuff(att);
  const id = pickPart(e.clientX, e.clientY);
  if (id) {
    deselectAttachment();
    selectPart(id);
  } else if (gizmos() !== 'none' && !idle) deselectAll();
});

canvas.addEventListener('dblclick', (e) => {
  // a double tap that was already handled on the way up
  if (performance.now() - lastDoubleTap < 600) return;
  onDoubleClick(e.clientX, e.clientY);
});

function onDoubleClick(x: number, y: number) {
  // double-click a roll grip to straighten the part
  if (handlesVisible()) {
    const h = pickHandle(x, y);
    if (h?.userData.kind === 'roll') {
      resetRoll(h.userData.handle as string);
      return;
    }
    if (h?.userData.kind === 'bend') {
      resetBend(h.userData.handle as string, h.userData.node as number | undefined, !!h.userData.used);
      return;
    }
    if (h?.userData.handle === 'root') {
      resetRoot();
      return;
    }
    if (h?.userData.kind === 'end') {
      resetJoint(h.userData.handle as string);
      return;
    }
    // the other grips (sizes, sliding the base) have nothing to go back to:
    // a double-click on one just shouldn't start drawing the part underneath
    if (h) return;
  }
  if (mode === 'stuff') {
    const id = drawState ? null : pickPiece(x, y);
    if (id) {
      selectedPiece = id;
      renderStuffPanel();
      enterDraw({ kind: 'piece', redraw: id });
    }
    return;
  }
  const other = pickOtherCreature(x, y);
  if (other) activate(other.index);
  // the first click already went to the eye settings
  else if (pickEye(x, y) !== null) return;
  const id = pickPart(x, y);
  if (!id) return;
  selectPart(id);
  enterDraw();
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.set(0, 0.9, 0);
controls.minDistance = 0.6;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.53;
controls.autoRotateSpeed = 2.5;
controls.update();
/** the view's been moved by hand since the page opened (the open creation's saved view is only put back before that) */
let viewMoved = false;
controls.addEventListener('start', () => (viewMoved = true));
controls.addEventListener('end', () => viewChanged());
/** The view is kept with the open creation (see SceneLook): save it there once it's settled. */
function viewChanged() {
  if (opened.keep && mode !== 'stuff') queueCreationSave();
}

function setRay(clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(
    new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1),
    view,
  );
}

/** If the pointer is over a creature other than the active one, which one (and which part). */
function pickOtherCreature(x: number, y: number): { index: number; boneId?: string } | null {
  if (creatures.length < 2) return null;
  setRay(x, y);
  const targets = creatures.flatMap((c) => [...c.meshes(), ...c.attachmentMeshes()]);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return null;
  let o: THREE.Object3D | null = hit.object;
  while (o && !creatures.some((c) => c.root === o)) o = o.parent;
  const index = creatures.findIndex((c) => c.root === o);
  if (index < 0 || index === world.active) return null;
  return { index, boneId: hit.object.userData.boneId as string | undefined };
}

function creatureLabel(i: number): string {
  return world.creatures[i]?.name?.trim() || `Creature ${i + 1}`;
}

function pickPart(x: number, y: number): string | null {
  setRay(x, y);
  const hit = raycaster.intersectObjects(creature.meshes(), false)[0];
  return hit ? (hit.object.userData.boneId as string) : null;
}

/** The eye under the pointer, if it's in front of every part there: its pair, and which of the two it is. */
function pickEyeHit(x: number, y: number): { pair: number; sgn: number } | null {
  setRay(x, y);
  const part = raycaster.intersectObjects(creature.meshes(), false)[0];
  const eye = creature.pickEye(raycaster.ray);
  return eye && (!part || eye.distance <= part.distance) ? eye : null;
}

/** The eye pair under the pointer, if an eye is in front of every part there. */
function pickEye(x: number, y: number): number | null {
  return pickEyeHit(x, y)?.pair ?? null;
}

/** an eye being dragged over the surface: its pair, and which of the two (-1 = the mirrored one) */
let eyeDrag: { pair: number; sgn: number } | null = null;

const round4 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4) / 1e4) as V3;

/**
 * Eyes placed by hand on parts that were just stretched or grown (`ids`, by
 * definition, from the skeleton `before`), kept on the same spots of them.
 * Ones placed from Spacing and Height find their spots afresh anyway.
 */
function carryEyes(before: RigState, ids: Set<string>, kWidth: number) {
  const was = new Map(expandRig(before).bones.map((b) => [b.id, b]));
  const now = new Map(expandRig(state.rig).bones.map((b) => [b.id, b]));
  const len = (d: { start: V3; end: V3 }) => Math.max(new THREE.Vector3(...d.end).sub(new THREE.Vector3(...d.start)).length(), 1e-3);
  for (const pair of state.eyes.pairs) {
    if (!pair.at) continue;
    // (kept in the left twin's frame)
    const id = creature.eyeBones(pair).find((x) => x.def.sideSign !== -1)?.def.id;
    const a = id && was.get(id), z = id && now.get(id);
    if (!a || !z || !ids.has(a.baseId)) continue;
    const { p, n } = carryOnBend(bendOf(a, len(a)), bendOf(z, len(z)), kWidth, new THREE.Vector3(...pair.at), new THREE.Vector3(...(pair.n ?? [0, 0, 1])));
    pair.at = round4(p);
    if (pair.n) pair.n = round4(n!);
  }
}

/**
 * Put an eye where the pointer is on the creature (on whichever part is
 * there): the pair becomes hand-placed, its other eye mirrored across the
 * part's own middle. Says whether it landed on the creature.
 */
function moveEyesTo(index: number, sgn: number, x: number, y: number): boolean {
  const pair = state.eyes.pairs[index];
  if (!pair) return false;
  setRay(x, y);
  const hit = creature.surfaceAt(raycaster);
  if (!hit) return false;
  const at = hit.local, n = hit.localNormal;
  // undo the pair's Facing, then (for the mirrored eye) the mirroring, as the eyes are laid out
  const spin = pair.turn ?? state.eyes.turn ?? 0;
  const Y = new THREE.Vector3(0, 1, 0);
  at.applyAxisAngle(Y, -spin);
  n.applyAxisAngle(Y, -spin);
  if (sgn === -1) {
    const { across, mid } = creature.eyeMirror(hit.bone, true);
    at.addScaledVector(across, -2 * at.clone().sub(mid).dot(across));
    n.addScaledVector(across, -2 * n.dot(across));
  }
  pair.at = round4(at);
  pair.n = round4(n.normalize());
  pair.bone = hit.bone.src;
  state.eyes.enabled = true;
  creature.sync();
  return true;
}

/** Picks the part these eyes are on, with its eye settings open at this pair. */
function showEyes(pair: number) {
  deselectAttachment();
  eyePair = pair;
  setEyesFolded(false);
  const on = creature.eyeBones(state.eyes.pairs[pair])[0];
  if (on) selectPart(on.def.id);
  else renderUI();
}

/** Handles are tiny, so pick the nearest one in screen space. */
function pickHandle(x: number, y: number): THREE.Object3D | null {
  const r = canvas.getBoundingClientRect();
  let best: THREE.Object3D | null = null;
  // fingers are less exact than a mouse
  let bestD = pointer.touch ? 28 : 16;
  const v = new THREE.Vector3();
  const near = (h: THREE.Object3D, at: THREE.Vector3) => {
    h.localToWorld(v.copy(at)).project(view);
    if (v.z > 1) return Infinity;
    return Math.hypot(r.left + ((v.x + 1) / 2) * r.width - x, r.top + ((1 - v.y) / 2) * r.height - y);
  };
  // the roll ring is big and easy to catch anywhere round its hoop, and seen
  // edge-on it's a line straight through the grips near it (the purple base
  // square): any grip in reach wins over it, so the ring is only tried after
  let ring: { h: THREE.Object3D; d: number; at: THREE.Vector3 } | null = null;
  for (const h of creature.handles()) {
    if (!h.visible) continue;
    if (h.userData.ring !== undefined) {
      // the roll ring is grabbed anywhere round its hoop: remember where (in the bone's frame)
      const rr = h.userData.ring as number;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const at = new THREE.Vector3(rr * Math.cos(a), 0, rr * Math.sin(a));
        const d = near(h, at);
        if (d < bestD && (!ring || d < ring.d)) ring = { h, d, at };
      }
      continue;
    }
    const d = near(h, new THREE.Vector3());
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  if (!best && ring) {
    ring.h.userData.grab = ring.at.add(ring.h.position);
    return ring.h;
  }
  return best;
}

function handlesVisible() {
  // Arrange has its own handles at the creature's feet, and picked stuff its own arrows
  return !idle && !drawState && !placing && !selectedAttachment && mode !== 'stuff' && gizmos() !== 'none';
}

/** Back to nothing picked: clicking empty space in Shape. */
function deselectAll() {
  idle = true;
  stopPlacing();
  deselectAttachment();
  creature.flash(null, 0);
  updateSkeletonVisibility();
  renderUI();
}

/** The sidebar's part editor and the on-screen Arrange/Mirror pills only make sense with something picked. */
function syncIdle() {
  $('.panel').classList.toggle('idle', idle && mode !== 'stuff');
  setLayoutIdle(idle);
  // the handles follow the same idle state, so they can't outlive the selection
  updateSkeletonVisibility();
}

function updateSkeletonVisibility() {
  // the tab's Gizmos: every part's handles, or just the picked part's
  Creature.handleScope = gizmos() === 'part' ? 'part' : 'all';
  creature.setSkeletonVisible(handlesVisible());
  // the key to the handles shows with them
  $('#shape-legend').classList.toggle('off', !handlesVisible());
}

// ---------------------------------------------------------------------------
// camera tweening

let tween: { p0: THREE.Vector3; p1: THREE.Vector3; t0v: THREE.Vector3; t1v: THREE.Vector3; start: number; dur: number } | null = null;

function flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 650) {
  tween = { p0: camera.position.clone(), p1: pos, t0v: controls.target.clone(), t1v: target, start: performance.now(), dur };
}

/** Tight bounds of the posed creature: body parts plus any stuff it's wearing. */
function creatureBox(precise = false): THREE.Box3 {
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
function frameAll(fresh = false) {
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
function freshView() {
  if (sceneOrtho) {
    sceneOrtho = false;
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
function frameCreature(view: boolean | THREE.Vector3 = false) {
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

/** Face the part straight on: from the front, or from the side when it's being drawn from the side. */
function focusOnBone(b: BoneRT, side = false) {
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

// ---------------------------------------------------------------------------
// drawing

/** What a stroke is for: a body part's outline, or a piece on the stuff workbench (new, or one being redrawn). */
type DrawTarget = { kind: 'bone'; boneId: string } | { kind: 'piece'; redraw?: string };
/** What dragging on the drawing does once there's a shape: add to it, cut from it, or move, resize or turn it. */
type DrawTool = 'draw' | 'erase' | 'move' | 'scale' | 'rotate';
type ShapeKind = 'square' | 'triangle' | 'circle';

interface DrawState {
  target: DrawTarget;
  /** object whose local XY plane is drawn on */
  frame: THREE.Object3D;
  label: string;
  /** symmetry axis (x = 0) drawn between these local points */
  axis: [Vec2, Vec2];
  /** stroke in screen space, after the stabiliser */
  pts: Vec2[];
  /** the same stroke in the drawing plane, for the mirror preview */
  local: Vec2[];
  /** stabiliser position */
  pen: Vec2 | null;
  active: boolean;
  /**
   * The finished shape, waiting for Done: one loop, or a mirrored pair of
   * pieces. In the drawing plane.
   */
  pending: Vec2[][] | null;
  /** cut-outs in the pending shape (from erasing inside it), in the same space */
  holes: Vec2[][];
  tool: DrawTool;
  /** Move / Scale / Rotate: the shape and pointer as the drag began, in the drawing plane */
  grab: { start: Vec2; outers: Vec2[][]; holes: Vec2[][]; centre: Vec2 } | null;
  /** a basic shape waiting to be placed: click to put it down, drag to size it */
  stamp: ShapeKind | null;
  /** the stamp being dragged out: centre and size in the drawing plane, and where the press was on screen */
  stampDrag: { centre: Vec2; r: number; x: number; y: number } | null;
  /** a bone's shapes from before drawing: the shapes preview live on the part, and these go back on cancel */
  original?: PartShape[];
  /** a body part being drawn from the side (its YZ plane) rather than the front */
  side: boolean;
  /** a body part's shapes in the other view (front or side), kept while this one is drawn */
  other: Vec2[][];
  /** a body part: what its two views show of the creature (its own plane, then the one turned a quarter round) */
  views?: [BoneView, BoneView];
  /** symmetry in the turned view (on when that view looks the creature in the face) */
  sideSym: boolean;
}

type ViewKind = 'front' | 'side' | 'top';
interface BoneView {
  kind: ViewKind;
  /** left and right on the drawing are the creature's left and right */
  mirrored: boolean;
}
const VIEW_NAMES: Record<ViewKind, { name: string; icon: string }> = {
  front: { name: 'Front', icon: 'fa-duotone fa-regular fa-user' },
  side: { name: 'Side', icon: 'fa-duotone fa-regular fa-person-walking' },
  top: { name: 'Top', icon: 'fa-duotone fa-regular fa-arrow-down-to-line' },
};

/**
 * What a body part's two drawing planes show of the creature. The part's own
 * plane depends on how its bone lies (a quadruped's body is drawn as its
 * profile), so each view is named by the way it looks at the creature in its
 * rest pose: from the front, the side or the top.
 */
function boneViews(b: BoneRT): [BoneView, BoneView] {
  const rot = new THREE.Matrix3().setFromMatrix4(b.restGroup);
  // how well a view looking along `normal` counts as each kind (a slight lean towards front, then side)
  const scores = (normal: THREE.Vector3): Record<ViewKind, number> => {
    const n = normal.applyMatrix3(rot).normalize();
    return { front: Math.abs(n.z) * 1.15, side: Math.abs(n.x), top: Math.abs(n.y) * 0.85 };
  };
  const best = (s: Record<ViewKind, number>, not?: ViewKind) =>
    (Object.keys(s) as ViewKind[]).filter((k) => k !== not).sort((a, c) => s[c] - s[a])[0];
  const across = (v: THREE.Vector3) => Math.abs(v.applyMatrix3(rot).normalize().x) > 0.7;
  const own = best(scores(new THREE.Vector3(0, 0, 1)));
  // the two views are a quarter turn apart: never call them the same thing
  const turned = best(scores(new THREE.Vector3(1, 0, 0)), own);
  return [
    { kind: own, mirrored: across(new THREE.Vector3(1, 0, 0)) },
    { kind: turned, mirrored: across(new THREE.Vector3(0, 0, 1)) },
  ];
}
let drawState: DrawState | null = null;

const DRAW_PREFS_KEY = 'creature-creator/draw';
// symmetry is remembered separately for body parts and for stuff (letters,
// badges... are rarely symmetric, so stuff starts with it off)
const drawPrefs: { symmetry: boolean; pieceSymmetry: boolean; smoothing: number } = (() => {
  try {
    return { symmetry: true, pieceSymmetry: false, smoothing: 0.5, ...JSON.parse(localStorage.getItem(DRAW_PREFS_KEY) ?? '{}') };
  } catch {
    return { symmetry: true, pieceSymmetry: false, smoothing: 0.5 };
  }
})();
/** Is symmetry on for what's being drawn right now? */
function symOn(): boolean {
  // the turned view keeps its own setting for this drawing
  if (drawState?.side) return drawState.sideSym;
  return drawState?.target.kind === 'piece' ? drawPrefs.pieceSymmetry : drawPrefs.symmetry;
}
function saveDrawPrefs() {
  try {
    localStorage.setItem(DRAW_PREFS_KEY, JSON.stringify(drawPrefs));
  } catch {
    /* ignore */
  }
}

function drawHint() {
  if (!drawState) return;
  const { label, target } = drawState;
  if (drawState.stamp) {
    const what = drawState.tool === 'erase' && drawState.pending ? 'cut out' : 'put down';
    hint(`Click to ${what} a ${drawState.stamp}, or drag to size it`, 0);
    return;
  }
  if (drawState.pending) {
    const done = touchScreen() ? 'Done' : 'Done (Enter)';
    const msg = {
      draw: target.kind === 'bone' ? `Draw more to add to it (apart = an extra shape). Press ${done} to keep it` : `Draw more to add to the shape. Press ${done} to keep it`,
      erase: `Draw over the parts to cut away. Press ${done} to keep it`,
      move: `Drag the shape to move it. Press ${done} to keep it`,
      scale: touchScreen() ? 'Drag away from the middle to make it bigger' : 'Drag away from the middle to make it bigger (Shift keeps its proportions)',
      rotate: 'Drag around the middle to turn the shape',
    }[drawState.tool];
    hint(msg, 0);
    return;
  }
  // how to look around while the drawing layer is in the way
  const face = keyLabel('frame');
  const nav = touchScreen() ? ' · Two fingers move the view' : ` · Right-drag or Space+drag to pan${face ? `, ${face} to face it again` : ''}`;
  if (target.kind === 'piece') {
    hint((symOn() ? 'Draw a piece: across the dashed line = one symmetric shape, to one side = a mirrored pair' : 'Draw a piece as one closed loop. Erase inside it to make holes') + nav, 0);
    return;
  }
  if (drawState.side) {
    const from = VIEW_NAMES[drawState.views?.[1].kind ?? 'side'].name.toLowerCase();
    hint((symOn() ? `Draw one half of the ${label} as seen from the ${from}; it mirrors across the dashed line` : `Draw the ${label} as seen from the ${from}`) + nav, 0);
    return;
  }
  hint((symOn() ? `Draw one half of the ${label}; it mirrors across the dashed line` : `Draw the ${label} as one closed loop`) + nav, 0);

}

function enterDraw(target: DrawTarget = { kind: 'bone', boneId: selected }) {
  if (drawState) exitDraw();
  controls.autoRotate = false;
  $('#spin').classList.remove('on');
  deselectAttachment();
  if (target.kind === 'bone') {
    const b = creature.bones.get(target.boneId);
    if (!b) return;
    const reach = Math.max(b.length, b.def.width) * 2.5 + 0.5;
    // start from the shapes as they are (draw to add, erase to cut), in the view the part was first drawn in
    const shapes = partShapes(state.parts[b.src]);
    const side = !!shapes[0]?.side;
    const views = boneViews(b);
    const inView = shapes.filter((s) => !!s.side === side).map((s) => structuredClone(s.outline));
    drawState = {
      target,
      frame: boneFrame(b, side),
      label: partLabel(b.src).toLowerCase(),
      axis: [[0, b.length / 2 - reach], [0, b.length / 2 + reach]],
      pts: [],
      local: [],
      pen: null,
      active: false,
      pending: inView.length ? inView : null,
      holes: [],
      tool: 'draw',
      grab: null,
      stamp: null,
      stampDrag: null,
      original: structuredClone(shapes),
      side,
      other: shapes.filter((s) => !!s.side !== side).map((s) => structuredClone(s.outline)),
      views,
      // symmetric when it looks the creature in the face, not when it's a profile
      sideSym: views[1].mirrored,
    };
    creature.setDrawFocus(target.boneId, side);
    // other creatures step aside while you draw on this one
    for (const c of creatures) if (c !== creature) c.root.visible = false;
    focusOnBone(b, side);
  } else {
    // a piece lifted off the board is redrawn on its own plane
    const own = target.redraw ? piece() : undefined;
    const lifted = own?.place;
    const frame = lifted ? framePiece(own!) : board;
    drawState = { target, frame, label: 'piece', axis: [[0, -1.3], [0, 1.3]], pts: [], local: [], pen: null, active: false, pending: null, holes: [], tool: 'draw', grab: null, stamp: null, stampDrag: null, side: false, other: [], sideSym: false };
    if (target.redraw && own) {
      // start from the shape as it is: draw to add, erase to cut, or move, size and turn it
      drawState.pending = [structuredClone(own.outline)];
      drawState.holes = structuredClone(own.holes);
    }
    // pieces are drawn flat: show the thing unbent meanwhile
    syncWorkbench();
    if (lifted) focusOnPlane(frame);
    else focusOnBoard();
  }
  overlay.classList.add('active');
  $('#draw-bar').hidden = false;
  syncDrawBar();
  updateSkeletonVisibility();
  drawHint();
  refreshPieceGizmo();
}

/** Drawing from the side: a plane standing in the bone's YZ plane (its X axis is the bone's -Z, its Z the bone's X). */
const sideFrame = new THREE.Object3D();
sideFrame.rotation.y = Math.PI / 2;

/** The object whose XY plane a body part is drawn on, from the front or the side. */
function boneFrame(b: BoneRT, side: boolean): THREE.Object3D {
  if (!side) {
    sideFrame.removeFromParent();
    return b.pivot;
  }
  b.pivot.add(sideFrame);
  sideFrame.updateMatrixWorld(true);
  return sideFrame;
}

/** Switch a body part's drawing between front and side; the shapes drawn in the other view stay put. */
function setDrawSide(side: boolean) {
  const ds = drawState;
  if (!ds || ds.target.kind !== 'bone' || ds.side === side) return;
  const b = creature.bones.get(ds.target.boneId);
  if (!b) return;
  const here = ds.pending ?? [];
  ds.pending = ds.other.length ? ds.other : null;
  ds.other = here;
  ds.holes = [];
  ds.side = side;
  ds.frame = boneFrame(b, side);
  ds.active = false;
  ds.pts = [];
  ds.local = [];
  ds.grab = null;
  ds.stampDrag = null;
  if (!ds.pending) ds.tool = 'draw';
  creature.setDrawFocus(b.def.id, side);
  focusOnBone(b, side);
  previewPending();
  drawHint();
}

/** Leave drawing. Unless the shape is being kept (Done), a bone's previewed outline goes back. */
function exitDraw(keep = false) {
  const ds = drawState;
  drawState = null;
  overlay.classList.remove('active');
  $('#draw-bar').hidden = true;
  if (ds?.target.kind === 'bone' && !keep) {
    const b = creature.bones.get(ds.target.boneId);
    if (b) setPartShapes(state.parts[b.src], ds.original ?? []);
    creature.sync();
  }
  sideFrame.removeFromParent();
  creature.setDrawFocus(null);
  if (ds?.target.kind === 'piece') syncWorkbench();
  for (const c of creatures) c.root.visible = mode !== 'stuff';
  updateSkeletonVisibility();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  hint('');
}

function syncDrawBar() {
  $<HTMLInputElement>('#sym').checked = symOn();
  $<HTMLInputElement>('#smooth').value = String(drawPrefs.smoothing);
  $('#sym-label').classList.toggle('on', symOn());
  const isBone = drawState?.target.kind === 'bone';
  $('#draw-view').hidden = !isBone;
  document.querySelectorAll<HTMLButtonElement>('#draw-view [data-view]').forEach((b) => {
    const turned = b.dataset.view === 'side';
    b.classList.toggle('on', turned === !!drawState?.side);
    // named by what it shows of the creature: a quadruped's own plane is its side
    const v = VIEW_NAMES[drawState?.views?.[turned ? 1 : 0].kind ?? (turned ? 'side' : 'front')];
    const key = turned ? keyLabel('side') : '';
    b.innerHTML = `<i class="${v.icon}" aria-hidden="true"></i> ${v.name}${key ? ` <kbd>${key}</kbd>` : ''}`;
    b.title = `Draw the part as seen from the ${v.name.toLowerCase()}${key ? ` (${key})` : ''}`;
  });
  const has = !!drawState?.pending;
  // a body part can be kept (or cleared) with shapes in the other view only
  const any = has || !!drawState?.other.length;
  $<HTMLButtonElement>('#done-draw').disabled = !any;
  $<HTMLButtonElement>('#reset-draw').disabled = !any;
  const tool = drawState?.tool ?? 'draw';
  document.querySelectorAll<HTMLButtonElement>('#draw-tools [data-tool]').forEach((b) => {
    b.classList.toggle('on', b.dataset.tool === tool);
    // everything but drawing needs something to work on
    b.disabled = b.dataset.tool !== 'draw' && !has;
  });
  document.querySelectorAll<HTMLButtonElement>('#draw-bar [data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === drawState?.stamp));
  const stamping = !!drawState?.stamp;
  overlay.classList.toggle('erasing', tool === 'erase' && !stamping);
  overlay.classList.toggle('moving', !stamping && (tool === 'move' || tool === 'scale' || tool === 'rotate'));
}

function toggleSymmetry() {
  // the turned view's setting lasts for this drawing (it starts from which way the view faces)
  if (drawState?.side) drawState.sideSym = !drawState.sideSym;
  else if (drawState?.target.kind === 'piece') drawPrefs.pieceSymmetry = !drawPrefs.pieceSymmetry;
  else drawPrefs.symmetry = !drawPrefs.symmetry;
  if (!symOn()) unlock('wonky');
  saveDrawPrefs();
  syncDrawBar();
  drawHint();
  renderOverlay();
}

function partPlane(frame: THREE.Object3D): THREE.Plane {
  frame.updateMatrixWorld(true);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, frame.getWorldPosition(new THREE.Vector3()));
}

function screenToLocal(frame: THREE.Object3D, plane: THREE.Plane, x: number, y: number): Vec2 | null {
  setRay(x, y);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  const l = frame.worldToLocal(hit);
  return [Math.round(l.x * 1e4) / 1e4, Math.round(l.y * 1e4) / 1e4];
}

/** Drawing-plane point -> overlay pixel coordinates. */
function localToOverlay(frame: THREE.Object3D, [x, y]: Vec2): Vec2 {
  const v = frame.localToWorld(new THREE.Vector3(x, y, 0)).project(view);
  return [((v.x + 1) / 2) * overlay.clientWidth, ((1 - v.y) / 2) * overlay.clientHeight];
}

function strokeToLocal(frame: THREE.Object3D, pts: Vec2[]): Vec2[] {
  const plane = partPlane(frame);
  const out: Vec2[] = [];
  for (const [x, y] of pts) {
    const p = screenToLocal(frame, plane, x, y);
    if (!p) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.003) out.push(p);
  }
  return out;
}

function tooSmall(loop: Vec2[], minArea: number, minSize: number) {
  const bb = loop.length ? bounds(loop) : null;
  return !bb || loop.length < 6 || Math.abs(signedArea(loop)) < minArea || Math.max(bb.w, bb.h) < minSize;
}

/** A body part stroke: mirrored across the centre line (if on), then smoothed. */
function boneLoops(raw: Vec2[]): Vec2[][] {
  let local = raw;
  if (local.length >= 6) {
    if (symOn()) local = symmetrize(local);
    local = smoothLoop(local, drawPrefs.smoothing);
  }
  return [local];
}

/** A workbench stroke: across the centre line = one symmetric piece, off to one side = a mirrored pair. */
function pieceLoops(raw: Vec2[]): Vec2[][] {
  let loops: Vec2[][] = [raw];
  if (raw.length >= 6 && symOn()) {
    const crosses = raw.some((p) => p[0] > 0.01) && raw.some((p) => p[0] < -0.01);
    // a half-outline that starts and ends on the axis also means "one symmetric shape"
    const tol = Math.max(0.03, bounds(raw).w * 0.15);
    const half = Math.abs(raw[0][0]) < tol && Math.abs(raw[raw.length - 1][0]) < tol;
    loops = crosses || half ? [symmetrize(raw)] : [raw, raw.map(([x, y]) => [-x, y] as Vec2).reverse()];
  }
  return loops.map((l) => (l.length >= 6 ? smoothLoop(l, drawPrefs.smoothing) : l));
}

function finishStroke() {
  if (!drawState) return;
  const ds = drawState;
  const raw = strokeToLocal(ds.frame, ds.pts);
  ds.pts = [];
  ds.local = [];
  ds.active = false;
  // (a part that already has shapes in the other view is added to, not started afresh from a half)
  if (ds.pending || ds.other.length) {
    combineStroke(ds, raw);
    return;
  }
  const isPiece = ds.target.kind === 'piece';
  const loops = isPiece ? pieceLoops(raw) : boneLoops(raw);
  if (loops.some((l) => (isPiece ? tooSmall(l, 0.0002, 0.02) : tooSmall(l, 0.0015, 0.05)))) {
    renderOverlay();
    hint('Too small or too thin: try a bigger loop', 1800, true);
    return;
  }
  // wait for Done: a new stroke replaces this one
  setPending(loops);
}

/** Half the size of a basic shape put down with a click (no drag): fits the part, or a handy size on the workbench. */
function stampSize(ds: DrawState): number {
  if (ds.target.kind !== 'bone') return 0.25;
  const b = creature.bones.get(ds.target.boneId)!;
  return Math.max(b.length * 0.9, b.def.width, 0.12) / 2;
}

/** A basic shape centred on (cx, cy), r = half its size. Dense, so its corners stay crisp. */
function shapeLoop(kind: ShapeKind, cx: number, cy: number, r: number): Vec2[] {
  const size = r * 2;
  if (kind === 'circle') {
    return Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2 - Math.PI / 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2;
    });
  }
  const h = kind === 'triangle' ? (size * Math.sqrt(3)) / 2 : size;
  const corners: Vec2[] =
    kind === 'triangle'
      ? [[cx - r, cy - h / 2], [cx + r, cy - h / 2], [cx, cy + h / 2]]
      : [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  // counter-clockwise, 24 points per side
  const out: Vec2[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    for (let k = 0; k < 24; k++) out.push([a[0] + ((b[0] - a[0]) * k) / 24, a[1] + ((b[1] - a[1]) * k) / 24]);
  });
  return out;
}

/**
 * The stamp as it would land: with symmetry on it's mirrored across the centre
 * line (one placed right by the line snaps onto it instead).
 */
function stampLoops(ds: DrawState): Vec2[][] {
  const sd = ds.stampDrag;
  if (!ds.stamp || !sd) return [];
  let [cx, cy] = sd.centre;
  // right by the centre line: one symmetric shape on it, not a pair
  if (symOn() && Math.abs(cx) < sd.r * 0.3) cx = 0;
  const loop = shapeLoop(ds.stamp, cx, cy, sd.r);
  return symOn() && cx !== 0 ? [loop, mirrorLoop(loop)] : [loop];
}

function placeStamp(ds: DrawState) {
  const loops = stampLoops(ds);
  const cut = ds.tool === 'erase' && !!ds.pending;
  // the shape stays armed for another one; Draw (or the shape again) puts it away
  ds.stampDrag = null;
  applyLoops(ds, loops, cut);
  syncDrawBar();
  drawHint();
  renderOverlay();
}

function setPending(loops: Vec2[][] | null) {
  if (!drawState) return;
  drawState.pending = loops;
  drawState.holes = [];
  drawState.tool = 'draw';
  previewPending();
  drawHint();
}

/**
 * A stroke once there's a shape: add it on (Draw) or cut it away (Erase).
 * With symmetry on, the stroke is mirrored across the centre line too.
 */
function combineStroke(ds: DrawState, raw: Vec2[]) {
  const loop = raw.length >= 6 ? smoothLoop(raw, drawPrefs.smoothing) : raw;
  if (tooSmall(loop, 0.0001, 0.01)) {
    renderOverlay();
    return;
  }
  applyLoops(ds, symOn() ? [loop, mirrorLoop(loop)] : [loop], ds.tool === 'erase');
}

const mirrorLoop = (l: Vec2[]) => l.map(([x, y]) => [-x, y] as Vec2).reverse();

/** Add loops to the shape (or cut them out of it); the first ones simply become the shape. */
function applyLoops(ds: DrawState, loops: Vec2[][], cut: boolean) {
  if (!ds.pending) {
    if (cut) return;
    // overlapping mirror images merge into one
    setPending(loops.length > 1 ? combineLoops([], [], loops, false).outers : loops);
    return;
  }
  const res = combineLoops(ds.pending, ds.holes, loops, cut);
  if (!res.outers.length) {
    setPending(null);
    hint('Erased it all: draw a new shape', 2000);
    return;
  }
  // a body part can be several shapes, but each one is solid
  if (ds.target.kind === 'bone' && res.holes.length) hint("A body part can't have holes: draw it as separate shapes instead", 2400);
  ds.pending = res.outers;
  ds.holes = ds.target.kind === 'bone' ? [] : res.holes;
  previewPending();
  drawHint();
}

/**
 * After moving, scaling or turning: pieces pushed into each other (a mirrored
 * pair slid across the centre line, say) fuse into one instead of overlapping.
 */
function mergeOverlaps(ds: DrawState) {
  const loops = ds.pending;
  if (!loops || loops.length < 2) return;
  const bbs = loops.map(bounds);
  const near = bbs.some((a, i) => bbs.some((b, j) => j > i && a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY));
  if (!near) return;
  const res = combineLoops(loops, ds.holes, [], false);
  // boxes can overlap without the shapes touching: then leave them be
  if (res.outers.length >= loops.length) return;
  ds.pending = res.outers;
  ds.holes = ds.target.kind === 'piece' ? res.holes : [];
  previewPending();
}

function pendingShape(ds: DrawState): { outers: Vec2[][]; holes: Vec2[][] } {
  return { outers: ds.pending ?? [], holes: ds.holes };
}

/** The pending shape as workbench pieces: each outer loop with the holes that fall inside it. */
function pendingPieces(ds: DrawState): { outline: Vec2[]; holes: Vec2[][] }[] {
  const { outers, holes } = pendingShape(ds);
  return outers.map((outline) => ({ outline, holes: holesInside({ outline } as Piece, holes) }));
}

/**
 * Move / Scale / Rotate: reshape the shape from how it was when the drag began.
 * With symmetry on, the two sides stay mirror images: loops either side of
 * the centre line move (and turn) in opposite ways, a loop across it only moves
 * up and down, and scaling is about the centre line.
 */
function transformShape(ds: DrawState, p: Vec2, keepProportions: boolean) {
  const g = ds.grab;
  if (!g) return;
  const [cx, cy] = g.centre;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  // which side of the centre line a loop is on: 1, -1, or 0 if it's across it
  const side = (l: Vec2[]) => {
    if (!symOn()) return 1;
    const bb = bounds(l);
    return bb.minX < -1e-3 && bb.maxX > 1e-3 ? 0 : (bb.minX + bb.maxX) / 2 >= 0 ? 1 : -1;
  };
  const grabSide = symOn() && g.start[0] < 0 ? -1 : 1;
  let fn: (l: Vec2[]) => Vec2[];
  if (ds.tool === 'move') {
    const dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    fn = (l) => {
      const sd = side(l);
      const mx = symOn() ? dx * sd * grabSide : dx;
      return l.map(([x, y]) => [r4(x + mx), r4(y + dy)] as Vec2);
    };
  } else if (ds.tool === 'scale') {
    // the grabbed point follows the pointer; near the middle on one axis, that axis stays put
    const ax = g.start[0] - cx, ay = g.start[1] - cy;
    const bx = p[0] - cx, by = p[1] - cy;
    const bb = bounds(g.outers.flat());
    const ratio = (a: number, b: number, span: number) => (Math.abs(a) > span * 0.12 ? Math.max(0.05, Math.abs(b) / Math.abs(a)) : 1);
    let sx = ratio(ax, bx, bb.w), sy = ratio(ay, by, bb.h);
    if (keepProportions) sx = sy = Math.max(0.05, Math.hypot(bx, by) / Math.max(1e-6, Math.hypot(ax, ay)));
    fn = (l) => l.map(([x, y]) => [r4(cx + (x - cx) * sx), r4(cy + (y - cy) * sy)] as Vec2);
  } else {
    const a = Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(g.start[1] - cy, g.start[0] - cx);
    fn = (l) => {
      const sd = side(l);
      // a pair turns each loop about its own middle, in mirror image
      let ox = cx, oy = cy, ang = a;
      if (symOn() && sd !== 0) {
        const bb = bounds(l);
        ox = (bb.minX + bb.maxX) / 2;
        oy = (bb.minY + bb.maxY) / 2;
        ang = a * sd * grabSide;
      }
      const c = Math.cos(ang), s = Math.sin(ang);
      return l.map(([x, y]) => [r4(ox + (x - ox) * c - (y - oy) * s), r4(oy + (x - ox) * s + (y - oy) * c)] as Vec2);
    };
  }
  ds.pending = g.outers.map(fn);
  ds.holes = g.holes.map(fn);
}

/** A body part's shapes as drawn so far, front and side (the front ones first). */
function drawnShapes(ds: DrawState): PartShape[] {
  const here = (ds.pending ?? []).map((outline) => ({ outline, side: ds.side }));
  const there = ds.other.map((outline) => ({ outline, side: !ds.side }));
  return ds.side ? [...there, ...here] : [...here, ...there];
}

/** Show the pending shape: inflated live on the part being drawn, or on the workbench. */
function previewPending() {
  const ds = drawState;
  if (!ds) return;
  if (ds.target.kind === 'bone') {
    const b = creature.bones.get(ds.target.boneId);
    if (b) {
      setPartShapes(state.parts[b.src], drawnShapes(ds));
      creature.sync();
      // the rebuilt part keeps the see-through drawing look
      creature.setDrawFocus(ds.target.boneId, ds.side);
    }
  } else {
    syncWorkbench();
  }
  syncDrawBar();
  renderOverlay();
}

let previewQueued = false;
function schedulePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    previewPending();
  });
}

/** Done: keep the pending shape. */
function finishDraw() {
  const ds = drawState;
  if (!ds?.pending && !ds?.other.length) return;
  if (!symOn()) unlock('wonky');
  if (ds.target.kind === 'piece' && ds.target.redraw) {
    replacePiece(ds.target.redraw, pendingPieces(ds));
    return;
  }
  if (ds.target.kind === 'piece') {
    addPieces(pendingPieces(ds));
    return;
  }
  const b = creature.bones.get(ds.target.boneId)!;
  setPartShapes(state.parts[b.src], drawnShapes(ds));
  exitDraw(true);
  creature.sync();
  commit();
  renderParts();
  flashPart();
  hintOnce('Inflated! Drag to look around, or pick another part', 2200);
}

function addStrokePoint(p: Vec2) {
  if (!drawState) return;
  drawState.pts.push(p);
  const l = screenToLocal(drawState.frame, partPlane(drawState.frame), p[0], p[1]);
  if (l) drawState.local.push(l);
}

overlay.addEventListener('pointerdown', (e) => {
  if (!drawState || e.button !== 0) return;
  overlay.setPointerCapture(e.pointerId);
  const at = screenToLocal(drawState.frame, partPlane(drawState.frame), e.clientX, e.clientY);
  if (drawState.stamp) {
    if (at) drawState.stampDrag = { centre: at, r: stampSize(drawState), x: e.clientX, y: e.clientY };
    renderOverlay();
    return;
  }
  if ((drawState.tool === 'move' || drawState.tool === 'scale' || drawState.tool === 'rotate') && drawState.pending) {
    if (!at) return;
    const bb = bounds(drawState.pending.flat());
    // with symmetry on, everything stays centred on the centre line
    const centre: Vec2 = [symOn() ? 0 : (bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
    drawState.grab = { start: at, outers: drawState.pending, holes: drawState.holes, centre };
    hint('');
    return;
  }
  drawState.active = true;
  drawState.pts = [];
  drawState.local = [];
  drawState.pen = [e.clientX, e.clientY];
  addStrokePoint([e.clientX, e.clientY]);
  hint('');
});
overlay.addEventListener('pointermove', (e) => {
  const sd = drawState?.stampDrag;
  if (sd) {
    // dragging out from where it was pressed sizes it; a click keeps the handy size
    const p = screenToLocal(drawState!.frame, partPlane(drawState!.frame), e.clientX, e.clientY);
    if (p && Math.hypot(e.clientX - sd.x, e.clientY - sd.y) > 6) sd.r = Math.max(0.01, Math.hypot(p[0] - sd.centre[0], p[1] - sd.centre[1]));
    renderOverlay();
    return;
  }
  if (drawState?.grab) {
    const p = screenToLocal(drawState.frame, partPlane(drawState.frame), e.clientX, e.clientY);
    if (!p) return;
    transformShape(drawState, p, e.shiftKey);
    schedulePreview();
    return;
  }
  if (!drawState?.active || !drawState.pen) return;
  // Stabiliser: the pen trails the pointer, ironing out touchpad wobble.
  const follow = 1 - 0.88 * drawPrefs.smoothing;
  const pen = drawState.pen;
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const ev of events.length ? events : [e]) {
    pen[0] += (ev.clientX - pen[0]) * follow;
    pen[1] += (ev.clientY - pen[1]) * follow;
    const last = drawState.pts[drawState.pts.length - 1];
    if (Math.hypot(pen[0] - last[0], pen[1] - last[1]) >= 2) addStrokePoint([pen[0], pen[1]]);
  }
  renderOverlay();
});
overlay.addEventListener('pointerup', () => {
  if (drawState?.stampDrag) {
    placeStamp(drawState);
  } else if (drawState?.grab) {
    drawState.grab = null;
    mergeOverlaps(drawState);
    drawHint();
  } else if (drawState?.active) finishStroke();
});
overlay.addEventListener('wheel', (e) => {
  canvas.dispatchEvent(new WheelEvent('wheel', e));
  e.preventDefault();
}, { passive: false });
// While drawing, the right (or middle) button still moves the view: the
// press is handed to the camera controls under the drawing layer, which then
// follow the pointer until it's let go.
overlay.addEventListener('pointerdown', (e) => {
  if (!drawState || e.button === 0) return;
  canvas.dispatchEvent(new PointerEvent('pointerdown', e));
});
overlay.addEventListener('contextmenu', (e) => e.preventDefault());

// On a touch screen a second finger means "move the view": whatever the first
// finger had started is dropped and both touches go to the camera controls,
// which follow them (on the document) until they're lifted.
const drawTouches = new Map<number, PointerEvent>();
let touchView = false;
overlay.addEventListener('pointerdown', (e) => {
  if (!drawState || e.pointerType !== 'touch') return;
  drawTouches.set(e.pointerId, e);
  if (!touchView && drawTouches.size < 2) return;
  e.stopImmediatePropagation();
  if (!touchView) {
    touchView = true;
    const ds = drawState;
    ds.active = false;
    ds.pts = [];
    ds.local = [];
    ds.stampDrag = null;
    if (ds.grab) {
      ds.pending = ds.grab.outers;
      ds.holes = ds.grab.holes;
      ds.grab = null;
      schedulePreview();
    }
    renderOverlay();
    for (const t of drawTouches.values()) canvas.dispatchEvent(new PointerEvent('pointerdown', t));
  } else canvas.dispatchEvent(new PointerEvent('pointerdown', e));
}, { capture: true });
overlay.addEventListener('pointermove', (e) => {
  if (drawTouches.has(e.pointerId)) drawTouches.set(e.pointerId, e);
}, { capture: true });
for (const type of ['pointerup', 'pointercancel'] as const) {
  window.addEventListener(type, (e) => {
    drawTouches.delete(e.pointerId);
    if (!drawTouches.size) touchView = false;
  });
}

// Hold Space to pan with the left button (while drawing, the drawing layer steps aside meanwhile).
// Outside drawing, Shift+drag pans as well: OrbitControls does that itself.
let spacePan = false;
function setSpacePan(on: boolean) {
  if (spacePan === on) return;
  spacePan = on;
  overlay.style.pointerEvents = on ? 'none' : '';
  controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  gizmo.enabled = !on;
  viewport.classList.toggle('space-pan', on);
}
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') setSpacePan(false);
});
window.addEventListener('blur', () => setSpacePan(false));

function renderOverlay() {
  const dpr = overlay.width / overlay.clientWidth || 1;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
  if (!drawState) return;
  const frame = drawState.frame;
  octx.lineJoin = octx.lineCap = 'round';

  if (symOn()) {
    const a = localToOverlay(frame, drawState.axis[0]);
    const z = localToOverlay(frame, drawState.axis[1]);
    octx.setLineDash([10, 8]);
    octx.strokeStyle = 'rgba(59,130,246,.75)';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(a[0], a[1]);
    octx.lineTo(z[0], z[1]);
    octx.stroke();
    octx.setLineDash([]);
  }

  // the shape waiting for Done (faded while a replacement is being drawn)
  if (drawState.pending) {
    octx.globalAlpha = drawState.active ? 0.35 : 1;
    octx.fillStyle = 'rgba(255,107,74,.12)';
    octx.strokeStyle = '#ff6b4a';
    octx.lineWidth = 3;
    const { outers, holes } = pendingShape(drawState);
    octx.beginPath();
    for (const loop of [...outers, ...holes]) {
      loop.forEach((p, i) => {
        const [sx, sy] = localToOverlay(frame, p);
        if (i) octx.lineTo(sx, sy);
        else octx.moveTo(sx, sy);
      });
      octx.closePath();
    }
    octx.fill('evenodd');
    octx.stroke();
    octx.globalAlpha = 1;
  }

  // a basic shape being dragged out
  if (drawState.stampDrag) {
    const cutting = drawState.tool === 'erase' && !!drawState.pending;
    octx.fillStyle = cutting ? 'rgba(58,51,64,.12)' : 'rgba(255,107,74,.12)';
    octx.strokeStyle = cutting ? '#3a3340' : '#ff6b4a';
    octx.lineWidth = 3;
    if (cutting) octx.setLineDash([8, 6]);
    for (const loop of stampLoops(drawState)) {
      octx.beginPath();
      loop.forEach((q, i) => {
        const [sx, sy] = localToOverlay(frame, q);
        if (i) octx.lineTo(sx, sy);
        else octx.moveTo(sx, sy);
      });
      octx.closePath();
      octx.fill();
      octx.stroke();
    }
    octx.setLineDash([]);
  }

  if (drawState.pts.length < 2) return;
  const r = overlay.getBoundingClientRect();
  const pts = drawState.pts.map(([x, y]) => [x - r.left, y - r.top]);
  // erasing draws in ink, dashed, so it reads as cutting away
  const erasing = drawState.tool === 'erase' && !!drawState.pending;
  const ink = erasing ? '#3a3340' : '#ff6b4a';
  const inkSoft = erasing ? 'rgba(58,51,64,' : 'rgba(255,107,74,';

  if (symOn() && drawState.local.length > 1) {
    // live preview of the mirrored half
    octx.strokeStyle = inkSoft + '.45)';
    octx.lineWidth = 3;
    octx.beginPath();
    drawState.local.forEach(([x, y], i) => {
      const [sx, sy] = localToOverlay(frame, [-x, y]);
      if (i) octx.lineTo(sx, sy);
      else octx.moveTo(sx, sy);
    });
    octx.stroke();
  } else {
    // closing segment preview
    octx.setLineDash([6, 8]);
    octx.strokeStyle = inkSoft + '.6)';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    octx.lineTo(pts[0][0], pts[0][1]);
    octx.stroke();
    octx.setLineDash([]);
  }
  octx.fillStyle = symOn() ? 'transparent' : inkSoft + '.12)';
  octx.strokeStyle = ink;
  octx.lineWidth = 4;
  if (erasing) octx.setLineDash([8, 6]);
  octx.beginPath();
  pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
  if (!symOn()) octx.fill();
  octx.stroke();
  octx.setLineDash([]);
}

$<HTMLInputElement>('#sym').onchange = () => toggleSymmetry();
$<HTMLInputElement>('#smooth').oninput = (e) => {
  drawPrefs.smoothing = parseFloat((e.target as HTMLInputElement).value);
  saveDrawPrefs();
};
document.querySelectorAll<HTMLButtonElement>('#draw-bar [data-shape]').forEach((b) => {
  b.onclick = () => {
    if (!drawState) return;
    // arm the shape (again to put it away); it's placed by clicking in the drawing
    const kind = b.dataset.shape as ShapeKind;
    drawState.stamp = drawState.stamp === kind ? null : kind;
    // shapes add (or cut, while erasing)
    if (drawState.tool !== 'erase') drawState.tool = 'draw';
    syncDrawBar();
    drawHint();
  };
});
$('#reset-draw').onclick = () => {
  // a body part starts again from nothing, front and side
  if (drawState) drawState.other = [];
  setPending(null);
};
document.querySelectorAll<HTMLButtonElement>('#draw-view [data-view]').forEach((b) => {
  b.onclick = () => setDrawSide(b.dataset.view === 'side');
});
function setDrawTool(tool: DrawTool) {
  if (!drawState || (tool !== 'draw' && !drawState.pending)) return;
  // Draw with a shape armed: back to drawing freehand
  if (tool === 'draw' && drawState.stamp) {
    drawState.stamp = null;
    drawState.tool = 'draw';
    syncDrawBar();
    drawHint();
    return;
  }
  // tapping the active tool again goes back to drawing
  drawState.tool = drawState.tool === tool ? 'draw' : tool;
  // moving, scaling or turning puts any armed shape away
  if (drawState.tool !== 'draw' && drawState.tool !== 'erase') drawState.stamp = null;
  syncDrawBar();
  drawHint();
}
document.querySelectorAll<HTMLButtonElement>('#draw-tools [data-tool]').forEach((b) => {
  b.onclick = () => setDrawTool(b.dataset.tool as DrawTool);
});
$('#done-draw').onclick = () => finishDraw();

// ---------------------------------------------------------------------------
// stuff workbench

// The board sits at chest height; its XY plane is the drawing plane and its
// origin (the crosshair) is where the thing will attach to a body part.
const board = new THREE.Group();
board.position.set(0, 1, 0);
board.visible = false;
scene.add(board);
const boardGrid = new THREE.Group();
{
  // opaque lines (pre-faded colors) so glass pieces show the grid through them;
  // glass only refracts opaque things
  const grid = new THREE.GridHelper(2.4, 24, 0xc4bcc0, 0xe3dacd);
  grid.rotation.x = Math.PI / 2;
  boardGrid.add(grid);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.035, 0.05, 32),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true }),
  );
  ring.renderOrder = 999;
  boardGrid.add(ring);
  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.09, 0, 0), new THREE.Vector3(0.09, 0, 0),
      new THREE.Vector3(0, -0.09, 0), new THREE.Vector3(0, 0.09, 0),
    ]),
    new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true }),
  );
  cross.renderOrder = 999;
  boardGrid.add(cross);
  board.add(boardGrid);
}
let bench: THREE.Group | null = null;
let benchKey = '';
let selectedPiece = '';

function workbench(): Thing {
  world.workbench ??= newThing();
  return world.workbench;
}

function piece(): Piece | undefined {
  return workbench().pieces.find((p) => p.id === selectedPiece);
}

/** Holes from `loops` that actually sit inside piece `p`. */
function holesInside(p: Piece, loops: Vec2[][]): Vec2[][] {
  return loops.filter((l) => {
    const [cx, cy] = l.reduce((a, q) => [a[0] + q[0] / l.length, a[1] + q[1] / l.length], [0, 0]);
    return pointInPolygon(cx, cy, p.outline);
  });
}

/**
 * The workbench as shown: while drawing on it, flat (strokes are drawn flat)
 * and with any shape that's waiting for Done.
 */
function benchThing(): Thing {
  const wb = workbench();
  const ds = drawState;
  if (!ds || ds.target.kind !== 'piece') return wb;
  const shown: Thing = { ...wb, bend: 0 };
  const redraw = ds.target.redraw;
  if (redraw) {
    shown.pieces = wb.pieces.flatMap((p) =>
      p.id !== redraw ? [p] : pendingPieces(ds).map((pp, i) => ({ ...p, outline: pp.outline, holes: pp.holes, id: i ? `preview${i}` : p.id })),
    );
    return shown;
  }
  if (!ds.pending) return shown;
  const target = piece();
  shown.pieces = [...wb.pieces, ...pendingPieces(ds).map((pp, i) => ({ ...newPiece(pp.outline, target), holes: pp.holes, id: `preview${i}` }))];
  return shown;
}

/** On the workbench, a thing that inherits its material shows the creature's. */
function benchWearer(): Wearer {
  return { style: state.style, settingsFor: (s) => creature.settingsFor(s) };
}

function syncWorkbench() {
  const thing = benchThing();
  const key = JSON.stringify([thing.pieces, thing.ownMaterial, thing.inherit, thing.materialSettings, thing.bend, thing.bendMode, state.materialSettings, state.style, getMeshDetail()]);
  if (key === benchKey) {
    refreshPieceGizmo();
    return;
  }
  piecePivot = null;
  benchKey = key;
  if (bench) {
    board.remove(bench);
    disposeThing(bench);
  }
  bench = buildThing(thing, benchWearer());
  board.add(bench);
  refreshPieceGizmo();
}

// ---- moving, turning and resizing a piece after it's drawn ----
// The selected piece is wrapped in a pivot at its middle (inside a holder
// that carries its 3D placement), so it turns and grows about itself.
// 2D keeps it flat on its own plane and bakes the change into its outline;
// 3D lifts and tilts the plane itself, leaving the drawing as it is.

type PieceMode = 'translate' | 'rotate' | 'scale';
let pieceMode: PieceMode = 'translate';
let pieceDim: '2d' | '3d' = '2d';
let piecePivot: THREE.Group | null = null;

function refreshPieceGizmo() {
  const p = piece();
  const on = mode === 'stuff' && !drawState && !!p && !!bench;
  $('#piece-bar').hidden = !on;
  if (!on) {
    if (piecePivot && gizmo.object === piecePivot) gizmo.detach();
    piecePivot = null;
    unwrapPieces();
    return;
  }
  // still wrapped round this piece's current mesh: nothing to do
  if (piecePivot && piecePivot.parent?.parent === bench && piecePivot.userData.pieceId === p.id && gizmo.object === piecePivot) {
    setPieceMode(pieceMode);
    return;
  }
  // a piece picked before (and left unchanged) is still in its pivot: put it back first
  unwrapPieces();
  const mesh = bench!.children.find((m) => m.userData.pieceId === p.id);
  if (!mesh) return;
  const b = bounds(p.outline);
  const c = new THREE.Vector2((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  // holder = the piece's plane in the thing; pivot = its middle on that plane
  const holder = new THREE.Group();
  holder.userData.pieceHolder = true;
  holder.position.copy(mesh.position);
  holder.quaternion.copy(mesh.quaternion);
  const pivot = new THREE.Group();
  pivot.userData.pieceId = p.id;
  pivot.userData.center = c;
  pivot.position.set(c.x, c.y, 0);
  bench!.add(holder);
  holder.add(pivot);
  pivot.add(mesh);
  mesh.position.set(-c.x, -c.y, 0);
  mesh.quaternion.identity();
  piecePivot = pivot;
  // Both sides: the other side follows the gizmo, mirrored, while it's dragged
  const tw = twinOf(p);
  const twinMesh = tw && bench!.children.find((m) => m.userData.pieceId === tw.id);
  if (twinMesh) {
    twinMesh.updateMatrix();
    pivot.userData.twinMesh = twinMesh;
    pivot.userData.twinBase = twinMesh.matrix.clone();
  }
  gizmo.attach(pivot);
  setPieceMode(pieceMode);
  $('#piece-name').textContent = `Piece ${workbench().pieces.indexOf(p) + 1}`;
}

/** Take every piece out of the pivot it was wrapped in for the gizmo, back onto the bench where it sits. */
function unwrapPieces() {
  if (!bench) return;
  for (const holder of bench.children.filter((o) => o.userData.pieceHolder)) {
    holder.traverse((o) => o.updateMatrix());
    const pivot = holder.children[0];
    for (const mesh of [...(pivot?.children ?? [])]) {
      // its spot on the bench: the holder's, carried through the pivot
      mesh.matrix.premultiply(pivot.matrix).premultiply(holder.matrix);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      bench.add(mesh);
    }
    bench.remove(holder);
  }
}

function setPieceMode(m: PieceMode) {
  const p = piece();
  // flat, a turned piece is spun round the centre line: it can only slide up and down, or grow
  const turned2d = p?.kind === 'turned' && pieceDim === '2d';
  if (turned2d && m === 'rotate') m = 'translate';
  pieceMode = m;
  gizmo.setMode(m);
  gizmo.setSpace('local');
  if (pieceDim === '3d' && m !== 'scale') {
    gizmo.showX = gizmo.showY = gizmo.showZ = true;
  } else {
    // everything happens in the piece's own plane (resizing always does)
    gizmo.showX = m === 'scale' || (m === 'translate' && !turned2d);
    gizmo.showY = m !== 'rotate';
    gizmo.showZ = m === 'rotate';
  }
  document.querySelectorAll<HTMLButtonElement>('#piece-bar [data-piece]').forEach((b) => {
    b.classList.toggle('on', b.dataset.piece === m);
    if (b.dataset.piece === 'rotate') b.disabled = turned2d;
  });
  document.querySelectorAll<HTMLButtonElement>('#piece-bar [data-dim]').forEach((b) => b.classList.toggle('on', b.dataset.dim === pieceDim));
  $('#piece-flat').hidden = !p?.place;
  const both = !!p && !!twinOf(p);
  $<HTMLInputElement>('#piece-mirror').checked = both;
  $('#piece-mirror-label').classList.toggle('on', both);
  invalidate();
}

function setPieceDim(d: '2d' | '3d') {
  pieceDim = d;
  setPieceMode(pieceMode);
  if (d === '3d') hintOnce('3D: lift pieces off the board and tilt them any way', 2200);
}

/** Make the gizmo's change permanent. */
function bakePiece() {
  const p = piece();
  const pivot = piecePivot;
  const holder = pivot?.parent;
  if (!p || !pivot || !holder || pivot.userData.pieceId !== p.id) return;
  pivot.updateMatrix();
  holder.updateMatrix();
  const c = pivot.userData.center as THREE.Vector2;
  if (pivot.matrix.equals(new THREE.Matrix4().makeTranslation(c.x, c.y, 0))) return;
  const r = (n: number, k = 1e4) => Math.round(n * k) / k;
  if (pieceDim === '3d' && pieceMode !== 'scale') {
    // 3D: move the piece's plane; its drawing stays as drawn
    const m = holder.matrix.clone().multiply(pivot.matrix).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, 0));
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(pos, q, new THREE.Vector3());
    const flat = pos.lengthSq() < 1e-8 && Math.abs(q.w) > 1 - 1e-9;
    if (flat) delete p.place;
    else p.place = { position: pos.toArray().map((v) => r(v)) as [number, number, number], quaternion: q.toArray().map((v) => r(v, 1e6)) as [number, number, number, number] };
  } else {
    // 2D (and resizing): run the outline and holes through the move, on the piece's own plane
    const v = new THREE.Vector3();
    const move = ([x, y]: Vec2): Vec2 => {
      v.set(x - c.x, y - c.y, 0).applyMatrix4(pivot.matrix);
      return [r(v.x), r(v.y)];
    };
    // a flip (negative size) turns the outline inside out: keep its direction
    const flip = pivot.scale.x * pivot.scale.y < 0;
    const fix = (l: Vec2[]) => (flip ? l.map(move).reverse() : l.map(move));
    p.outline = fix(p.outline);
    p.holes = p.holes.map(fix);
  }
  syncTwin(p);
  // rebuilt from the new shape; the gizmo wraps the new mesh
  piecePivot = null;
  syncWorkbench();
  commit();
  autosaveThing();
}

/** Put a lifted piece back down flat on the board. */
function layPieceFlat() {
  const p = piece();
  if (!p?.place) return;
  delete p.place;
  syncTwin(p);
  piecePivot = null;
  syncWorkbench();
  commit();
  autosaveThing();
  hint('Back flat on the board', 1500);
}

// ---- Both sides: a piece and its mirror image, kept in step ----

/** A piece's other side, if it has one. */
function twinOf(p: Piece): Piece | undefined {
  return p.twin ? workbench().pieces.find((q) => q.id === p.twin) : undefined;
}

/** After `p` changed: its other side becomes its mirror image again (shape, place, color, everything). */
function syncTwin(p: Piece | undefined) {
  if (!p?.twin) return;
  const wb = workbench();
  const i = wb.pieces.findIndex((q) => q.id === p.twin);
  if (i < 0) {
    delete p.twin;
    return;
  }
  const t: Piece = { ...structuredClone(p), id: p.twin, twin: p.id, ...mirrorShape(p) };
  if (!t.place) delete t.place;
  wb.pieces[i] = t;
}

/** Where a piece's middle sits across the board (0 = on the centre line). */
function pieceMiddleX(p: Piece): number {
  const b = bounds(p.outline);
  // a turned piece is spun round its own centre line
  const v = new THREE.Vector3(p.kind === 'turned' ? 0 : (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
  if (p.place) v.applyQuaternion(new THREE.Quaternion(...p.place.quaternion)).add(new THREE.Vector3(...p.place.position));
  return v.x;
}

/** Both sides on: a mirror image of the picked piece on the other side. Off: the two go their own ways. */
function setPieceBothSides(on: boolean) {
  const p = piece();
  if (!p || drawState || on === !!twinOf(p)) return;
  const wb = workbench();
  if (on) {
    if (Math.abs(pieceMiddleX(p)) < Math.max(0.005, bounds(p.outline).w * 0.1)) {
      hint('This piece sits on the centre line: move it to one side first', 2400, true);
      setPieceMode(pieceMode);
      return;
    }
    const t: Piece = { ...structuredClone(p), id: uid() };
    p.twin = t.id;
    wb.pieces.splice(wb.pieces.indexOf(p) + 1, 0, t);
    syncTwin(p);
  } else {
    delete twinOf(p)!.twin;
    delete p.twin;
    hint('Now two separate pieces', 1500);
  }
  syncWorkbench();
  commit();
  renderStuffPanel();
  autosaveThing();
}
$<HTMLInputElement>('#piece-mirror').onchange = (e) => setPieceBothSides((e.target as HTMLInputElement).checked);

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
/** While a piece is dragged: put its other side where the same change, mirrored, takes it. */
function mirrorTwinLive() {
  const pivot = piecePivot;
  const mesh = pivot?.userData.twinMesh as THREE.Object3D | undefined;
  const holder = pivot?.parent;
  if (!pivot || !mesh || !holder) return;
  holder.updateMatrix();
  pivot.updateMatrix();
  const c = pivot.userData.center as THREE.Vector2;
  // the change since the piece was picked, on the bench: holder * pivot * (pivot at rest)^-1 * holder^-1
  const change = holder.matrix.clone().multiply(pivot.matrix).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, 0)).multiply(holder.matrix.clone().invert());
  const m = MIRROR_X.clone().multiply(change).multiply(MIRROR_X).multiply(pivot.userData.twinBase as THREE.Matrix4);
  m.decompose(mesh.position, mesh.quaternion, mesh.scale);
}

/** A tilted piece's own plane in the scene, for cutting holes into it. */
const pieceFrame = new THREE.Group();
board.add(pieceFrame);
function framePiece(p: Piece): THREE.Object3D {
  if (!p.place) return board;
  pieceFrame.position.set(...p.place.position);
  pieceFrame.quaternion.set(...p.place.quaternion);
  pieceFrame.updateMatrixWorld(true);
  return pieceFrame;
}

document.querySelectorAll<HTMLButtonElement>('#piece-bar [data-piece]').forEach((b) => {
  b.onclick = () => setPieceMode(b.dataset.piece as PieceMode);
});
document.querySelectorAll<HTMLButtonElement>('#piece-bar [data-dim]').forEach((b) => {
  b.onclick = () => setPieceDim(b.dataset.dim as '2d' | '3d');
});
$('#piece-flat').onclick = () => layPieceFlat();


// ---- auto-save: the thing on the workbench is kept in My stuff as you go ----

let thingSaveTimer = 0;
function autosaveThing() {
  if (!world.workbench?.pieces.length) return;
  clearTimeout(thingSaveTimer);
  thingSaveTimer = window.setTimeout(saveWorkbenchNow, 450);
}

/** Put the workbench thing in the collection now (with a fresh picture), and update anything wearing it. */
function saveWorkbenchNow() {
  clearTimeout(thingSaveTimer);
  const wb = world.workbench;
  if (!wb?.pieces.length) return;
  // a shape waiting for Done would end up in the picture: wait for it
  if (drawState) {
    autosaveThing();
    return;
  }
  const saved: Thing = { ...structuredClone(wb), name: wb.name.trim() || 'Thing' };
  saved.thumb = mode === 'stuff' ? captureThumb() : collection().find((t) => t.id === wb.id)?.thumb;
  const ok = putThing(saved);
  const badge = $('#thing-saved');
  if (ok) iconLabel(badge, fa('check'), 'Saved');
  else badge.textContent = 'Storage full: download it to keep it';
  badge.classList.toggle('warn', !ok);
  if (!ok) return;
  // creatures already wearing it get the new shape; how its material looks
  // stays each wearer's own choice
  world.creatures.forEach((s, i) => {
    let changed = false;
    for (const a of s.attachments ?? []) {
      if (a.thing.id !== wb.id) continue;
      const { inherit, ownMaterial, materialSettings, scaleMaterial } = a.thing;
      a.thing = { ...stripThumb(saved), inherit, ownMaterial, materialSettings, scaleMaterial };
      changed = true;
    }
    if (changed) creatures[i]?.sync();
  });
  save();
  // My stuff is saved with the creation
  queueCreationSave();
  renderCollection();
}

/** Put a thing on the workbench (saving the one that was there first). */
function openOnBench(t: Thing) {
  saveWorkbenchNow();
  world.workbench = stripThumb(t);
  selectedPiece = '';
  $('#thing-saved').textContent = '';
  syncWorkbench();
  commit();
  renderStuffPanel();
  focusOnBoard();
}

/** Look straight at a drawing plane (a tilted piece's), from the side it faces. */
function focusOnPlane(frame: THREE.Object3D) {
  const c = frame.getWorldPosition(new THREE.Vector3());
  const n = new THREE.Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  // face it from whichever side the camera is already on
  if (n.dot(camera.position.clone().sub(c)) < 0) n.negate();
  flyTo(c.clone().addScaledVector(n, 1.4), c);
}

function focusOnBoard() {
  const c = board.getWorldPosition(new THREE.Vector3());
  let r = 0.7;
  if (bench) {
    const box = new THREE.Box3().setFromObject(bench);
    if (!box.isEmpty()) r = Math.max(0.5, box.getSize(new THREE.Vector3()).length() * 0.7);
  }
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  flyTo(c.clone().add(new THREE.Vector3(0, 0, Math.max(1.4, dist))), c);
}

/** Done on the workbench: add the drawn pieces, with any holes erased in them. */
function addPieces(shapes: { outline: Vec2[]; holes: Vec2[][] }[]) {
  const wb = workbench();
  const made = shapes.map((sh) => ({ ...newPiece(sh.outline, piece()), holes: sh.holes }));
  // drawn with symmetry on, a mirrored pair stays one: Both sides
  if (symOn()) {
    for (const a of made) {
      const b = made.find((q) => q !== a && !q.twin && !a.twin && mirrorPair(a, q));
      if (b) {
        a.twin = b.id;
        b.twin = a.id;
      }
    }
  }
  wb.pieces.push(...made);
  selectedPiece = made[0].id;
  unlock('piece');
  exitDraw(true);
  syncWorkbench();
  commit();
  renderStuffPanel();
  flashPart();
}

/** Whether two pieces are mirror images across the centre line (going by their outlines' extents). */
function mirrorPair(a: Piece, b: Piece): boolean {
  const p = bounds(a.outline), q = bounds(b.outline);
  const eps = 1e-3;
  return Math.abs(p.minX + q.maxX) < eps && Math.abs(p.maxX + q.minX) < eps && Math.abs(p.minY - q.minY) < eps && Math.abs(p.maxY - q.maxY) < eps;
}

/** Done redrawing a piece: it keeps its color, material, kind and place, with the new outline. */
function replacePiece(id: string, shapes: { outline: Vec2[]; holes: Vec2[][] }[]) {
  const wb = workbench();
  const i = wb.pieces.findIndex((p) => p.id === id);
  if (i < 0 || !shapes.length) {
    exitDraw();
    return;
  }
  const old = wb.pieces[i];
  const next: Piece[] = shapes.map((sh, k) => ({ ...structuredClone(old), outline: sh.outline, holes: sh.holes, id: k ? uid() : old.id }));
  // Both sides: the other side follows a redraw, unless it came out as several pieces
  if (next.length > 1 && old.twin) {
    const t = twinOf(old);
    if (t) delete t.twin;
    for (const q of next) delete q.twin;
  }
  wb.pieces.splice(i, 1, ...next);
  syncTwin(next[0]);
  selectedPiece = old.id;
  exitDraw(true);
  syncWorkbench();
  commit();
  renderStuffPanel();
  flashPart();
  if (next.length > 1) hint(`Redrawn as ${next.length} pieces`, 1800);
}

function pickPiece(x: number, y: number): string | null {
  if (!bench) return null;
  setRay(x, y);
  // fuzz and ink sit inside a piece's mesh, and the selected piece sits in a pivot
  for (const hit of raycaster.intersectObjects(bench.children, true)) {
    for (let o: THREE.Object3D | null = hit.object; o && o !== bench; o = o.parent) if (o.userData.pieceId) return o.userData.pieceId as string;
  }
  return null;
}

/** Glow the selected piece (k fades 1 -> 0). */
function flashPiece(k: number) {
  bench?.traverse((m) => {
    if (!m.userData.pieceId || !(m as THREE.Mesh).isMesh) return;
    const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (!mat || !('emissive' in mat)) return;
    glowWithFlash(mat, m.userData.pieceId === selectedPiece && k > 0 ? new THREE.Color(1, 0.42, 0.29).multiplyScalar(0.45 * k) : undefined);
  });
}

/** Render just the thing, framed, into a small square image for the collection. */
function captureThumb(): string {
  if (!bench) return '';
  return snapThumb(new THREE.Box3().setFromObject(bench));
}

/** Render a clean frame and crop a small square round `box` as the camera sees it. */
function snapThumb(box: THREE.Box3, size = 160): string {
  if (box.isEmpty()) return '';
  // pictured from wherever the camera is: crop a square round the thing as it's seen now
  camera.updateMatrixWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const v = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(view);
    const px = ((v.x + 1) / 2) * canvas.width;
    const py = ((1 - v.y) / 2) * canvas.height;
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  const side = Math.min(Math.max(x1 - x0, y1 - y0) * 1.15, canvas.width, canvas.height);
  const sx = THREE.MathUtils.clamp((x0 + x1) / 2 - side / 2, 0, canvas.width - side);
  const sy = THREE.MathUtils.clamp((y0 + y1) / 2 - side / 2, 0, canvas.height - side);
  boardGrid.visible = false;
  const url = withCleanScene(() => {
    composer.render();
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')!.drawImage(canvas, sx, sy, side, side, 0, 0, size, size);
    return out.toDataURL('image/jpeg', 0.82);
  });
  boardGrid.visible = true;
  // put the grid and handles straight back on screen
  invalidate();
  return url;
}

function stripThumb(t: Thing): Thing {
  const { thumb: _thumb, ...rest } = structuredClone(t);
  return rest;
}

function renderStuffPanel() {
  const wb = workbench();
  const nameInput = $<HTMLInputElement>('#thing-name');
  if (document.activeElement !== nameInput) nameInput.value = wb.name;
  if (!wb.pieces.some((p) => p.id === selectedPiece)) selectedPiece = wb.pieces[wb.pieces.length - 1]?.id ?? '';

  const list = $('#pieces');
  list.innerHTML = '';
  // one row per piece: pick it, redraw it, or throw it away
  wb.pieces.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'piece-row';
    row.classList.toggle('active', p.id === selectedPiece);
    const pick = document.createElement('button');
    pick.className = 'piece-pick';
    pick.innerHTML = `<i style="background:${p.color}"></i>`;
    pick.insertAdjacentHTML('beforeend', p.kind === 'flat' ? fa('rectangle-wide') : p.kind === 'turned' ? faClassic('jar') : fa('cloud'));
    pick.append(` Piece ${i + 1}${p.holes.length ? ` (${p.holes.length} hole${p.holes.length > 1 ? 's' : ''})` : ''}`);
    const t = twinOf(p);
    if (t) pick.insertAdjacentHTML('beforeend', ` <span class="piece-twin" title="Both sides: mirror image of Piece ${wb.pieces.indexOf(t) + 1}">${fa('arrow-right-arrow-left')}</span>`);
    pick.onclick = () => {
      selectedPiece = p.id;
      flashPart();
      renderStuffPanel();
    };
    const edit = document.createElement('button');
    edit.className = 'piece-icon';
    edit.innerHTML = fa('pencil');
    edit.title = 'Redraw this piece: add to it, erase bits (erase inside it for a hole), or move, size and turn it. Or double-click it';
    edit.onclick = () => {
      selectedPiece = p.id;
      renderStuffPanel();
      enterDraw({ kind: 'piece', redraw: p.id });
    };
    const copy = document.createElement('button');
    copy.className = 'piece-icon';
    copy.innerHTML = fa('copy');
    copy.title = 'Copy this piece';
    copy.onclick = () => copyPiece(p.id);
    const del = document.createElement('button');
    del.className = 'piece-icon';
    del.innerHTML = fa('xmark');
    del.title = 'Delete this piece';
    del.onclick = () => deletePiece(p.id);
    row.append(pick, edit, copy, del);
    list.append(row);
  });
  if (!wb.pieces.length) list.innerHTML = '<p class="muted small">No pieces yet: draw one to start.</p>';
  $('#thing-bend-card').hidden = !wb.pieces.length;
  document.querySelectorAll<HTMLButtonElement>('#thing-bend-mode button').forEach((b) => b.classList.toggle('active', b.dataset.bend === (wb.bendMode ?? 'axis')));
  $<HTMLInputElement>('#thing-bend').value = String(wb.bend ?? 0);
  $('#thing-wrap-card').hidden = !wb.pieces.length;
  $<HTMLInputElement>('#thing-wrap-smooth').value = String(wb.wrapSmooth ?? WRAP_SMOOTH);
  $<HTMLInputElement>('#thing-wrap-strength').value = String(wb.wrapStrength ?? WRAP_STRENGTH);

  const p = piece();
  $('#piece-card').hidden = !p;
  if (p) {
    document.querySelectorAll<HTMLButtonElement>('#piece-kind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === p.kind));
    const th = $<HTMLInputElement>('#piece-thickness');
    if (p.kind === 'flat') Object.assign(th, { min: '0.005', max: '0.3', step: '0.001' });
    else if (p.kind === 'turned') Object.assign(th, { min: '0.003', max: '0.12', step: '0.001' });
    else Object.assign(th, { min: '0.1', max: '3', step: '0.01' });
    th.value = String(p.thickness);
    $('#piece-thickness-label').textContent = p.kind === 'turned' ? 'Wall' : 'Thickness';
    $('#piece-turned-row').hidden = p.kind !== 'turned';
    $<HTMLInputElement>('#piece-hollow').checked = !!p.hollow;
    $<HTMLInputElement>('#piece-open').checked = !!p.open;
    $<HTMLInputElement>('#piece-open').disabled = !p.hollow;
    $<HTMLInputElement>('#piece-opacity').value = String(p.opacity ?? 1);
    $<HTMLInputElement>('#piece-blend-shape').value = String(p.blendShape ?? 0);
    $<HTMLInputElement>('#piece-blend-color').value = String(p.blendColor ?? 0);
    $('#piece-round-row').hidden = p.kind !== 'flat';
    $<HTMLInputElement>('#piece-round').value = String(p.round);
    $<HTMLInputElement>('#piece-z').value = String(p.z);
    const sw = $('#piece-swatches');
    sw.innerHTML = '';
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c.toLowerCase() === p.color.toLowerCase());
      b.onclick = () => updatePieceColor((q) => (q.color = c));
      sw.append(b);
    }
    $<HTMLInputElement>('#piece-color').value = p.color;
    $<HTMLInputElement>('#piece-glow').value = String(p.glow ?? 0);
    pieceGlowFollow();
    // (only something to do with more than one piece)
    $('#piece-color-scope').hidden = wb.pieces.length < 2;
    pieceSceneColors();
    const st = $('#piece-styles');
    st.innerHTML = '';
    // an item that inherits its material shows the wearer's instead
    st.hidden = !!wb.inherit;
    for (const s of STYLES) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="ball ${s.id}"></span>`;
      b.append(s.name);
      b.classList.toggle('active', s.id === p.style);
      b.onclick = () => updatePiece((q) => (q.style = s.id));
      st.append(b);
    }
    renderThingMaterial(wb, [p.style], $('#piece-style-params'), state.style);
  }
  renderCollection();
  refreshPieceGizmo();
}

function updatePiece(fn: (p: Piece) => void, doCommit = true) {
  const p = piece();
  if (!p) return;
  fn(p);
  syncTwin(p);
  syncWorkbench();
  if (doCommit) {
    commit();
    renderStuffPanel();
  }
}

function renderCollection() {
  const current = world.workbench?.id;
  for (const [sel, forAttach] of [['#thing-list', false], ['#attach-options', true]] as const) {
    const el = $(sel);
    el.innerHTML = '';
    const things = collection();
    if (forAttach && !things.length) {
      el.innerHTML = `<p class="muted small">Nothing here yet. Make something in the ${fa('box')} Stuff tab first.</p>`;
      continue;
    }
    const card = (name: string, thumb: string | undefined, onclick: () => void) => {
      const c = document.createElement('div');
      c.className = 'thing-card pick';
      const img = document.createElement(thumb ? 'img' : 'div');
      img.className = 'thumb';
      if (thumb) (img as HTMLImageElement).src = thumb;
      const label = document.createElement('span');
      label.className = 'thing-name';
      label.textContent = name;
      c.title = name;
      c.append(img, label);
      c.onclick = onclick;
      el.append(c);
      return c;
    };
    if (!forAttach) {
      // start something new (an empty workbench already is something new)
      const fresh = card('New', undefined, () => {
        if (world.workbench?.pieces.length) openOnBench(newThing());
      });
      fresh.classList.add('new-card');
      fresh.querySelector('.thumb')!.innerHTML = faClassic('plus');
      fresh.classList.toggle('current', !things.some((t) => t.id === current));
    }
    for (const t of things) {
      const c = card(t.name, t.thumb, () => {
        if (forAttach) attachThing(t);
        else if (t.id !== current) openOnBench(t);
      });
      if (forAttach) {
        c.classList.add('carry');
        carryFrom(c, () => t, () => (t.thumb ? `<img src="${t.thumb}" alt="" />` : fa('box')));
      }
      if (!forAttach) {
        c.classList.toggle('current', t.id === current);
        c.append(thingActions(t));
      }
    }
  }
}

$('#piece-draw').onclick = () => enterDraw({ kind: 'piece' });
/** A copy of a piece, nudged aside so it shows, right after it and picked. */
function copyPiece(id: string) {
  if (drawState) exitDraw();
  const wb = workbench();
  const i = wb.pieces.findIndex((p) => p.id === id);
  if (i < 0) return;
  const twin: Piece = { ...structuredClone(wb.pieces[i]), id: uid() };
  delete twin.twin;
  const nudge = ([x, y]: Vec2): Vec2 => [x + 0.08, y - 0.08];
  twin.outline = twin.outline.map(nudge);
  twin.holes = twin.holes.map((l) => l.map(nudge));
  wb.pieces.splice(i + 1, 0, twin);
  selectedPiece = twin.id;
  syncWorkbench();
  commit();
  renderStuffPanel();
  flashPart();
  autosaveThing();
}
function deletePiece(id: string) {
  if (drawState) exitDraw();
  const wb = workbench();
  // Both sides go together
  const other = wb.pieces.find((p) => p.id === id)?.twin;
  wb.pieces = wb.pieces.filter((p) => p.id !== id && p.id !== other);
  if (selectedPiece === id || selectedPiece === other) selectedPiece = '';
  if (other) hint('Deleted both sides (turn off Both sides to delete just one)', 2400);
  syncWorkbench();
  commit();
  renderStuffPanel();
  autosaveThing();
}
document.querySelectorAll<HTMLButtonElement>('#piece-kind button').forEach((b) => {
  b.onclick = () =>
    updatePiece((p) => {
      const kind = b.dataset.kind as Piece['kind'];
      if (kind === p.kind) return;
      p.kind = kind;
      p.thickness = kind === 'flat' ? 0.04 : kind === 'turned' ? 0.012 : 0.6;
      if (kind === 'turned' && p.hollow === undefined) {
        p.hollow = true;
        p.open = true;
      }
    });
});
$<HTMLInputElement>('#piece-hollow').onchange = (e) => updatePiece((p) => (p.hollow = (e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#piece-open').onchange = (e) => updatePiece((p) => (p.open = (e.target as HTMLInputElement).checked));
for (const [id, key] of [['#piece-thickness', 'thickness'], ['#piece-round', 'round'], ['#piece-z', 'z'], ['#piece-opacity', 'opacity'], ['#piece-blend-shape', 'blendShape'], ['#piece-blend-color', 'blendColor']] as const) {
  const input = $<HTMLInputElement>(id);
  input.oninput = () => updatePiece((p) => (p[key] = parseFloat(input.value)), false);
  input.onchange = () => commit();
}
/** Piece colors go on the picked piece, or (All) on every piece of the thing */
let pieceColorAll = false;
/** `updatePiece` for colors and glow: on every piece with All picked */
function updatePieceColor(fn: (p: Piece) => void, doCommit = true) {
  updatePiece((p) => {
    for (const q of pieceColorAll ? workbench().pieces : [p]) fn(q);
  }, doCommit);
}
const pieceColorScope = scopeSeg('#piece-color-scope', () => pieceColorAll, (all) => (pieceColorAll = all));
const pieceGlowFollow = glowFollowSeg(
  '#piece-glow-follow',
  () => piece(),
  (f) =>
    updatePieceColor((q) => {
      if (f) q.glowFollow = f;
      else delete q.glowFollow;
    }),
);
const pieceSceneColors = sceneColorRow($('#piece-scene-colors'), () => piece()?.color, (c) => updatePieceColor((q) => (q.color = c)));
glowSlider(
  '#piece-glow',
  (v) => {
    updatePieceColor((p) => {
      if (v > 0) p.glow = v;
      else delete p.glow;
    }, false);
    pieceGlowFollow();
  },
  () => commit(),
);
$<HTMLInputElement>('#piece-color').oninput = (e) => updatePieceColor((p) => (p.color = (e.target as HTMLInputElement).value), false);
$<HTMLInputElement>('#piece-color').onchange = () => {
  commit();
  renderStuffPanel();
};
$<HTMLInputElement>('#thing-name').oninput = (e) => {
  workbench().name = (e.target as HTMLInputElement).value;
};
$<HTMLInputElement>('#thing-name').onchange = () => commit();
$<HTMLInputElement>('#thing-bend').oninput = (e) => {
  workbench().bend = parseFloat((e.target as HTMLInputElement).value);
  syncWorkbench();
};
$<HTMLInputElement>('#thing-bend').onchange = () => commit();
// wrap only shows where it's worn: settled (and passed on to wearers) on release
$<HTMLInputElement>('#thing-wrap-smooth').onchange = (e) => {
  workbench().wrapSmooth = parseFloat((e.target as HTMLInputElement).value);
  commit();
};
$<HTMLInputElement>('#thing-wrap-strength').onchange = (e) => {
  workbench().wrapStrength = parseFloat((e.target as HTMLInputElement).value);
  commit();
};
document.querySelectorAll<HTMLButtonElement>('#thing-bend-mode button').forEach((b) => {
  b.onclick = () => {
    const wb = workbench();
    wb.bendMode = b.dataset.bend as BendMode;
    // picking a way to bend with nothing bent yet starts with a visible curve
    if (!wb.bend) wb.bend = 0.4;
    syncWorkbench();
    commit();
    renderStuffPanel();
  };
});
/** Copy, download and delete buttons on a My stuff card, like the ones on My creations. */
function thingActions(t: Thing): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'creation-actions thing-card-actions';
  const action = (icon: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = 'piece-icon';
    b.innerHTML = fa(icon);
    b.title = title;
    b.onclick = (e) => {
      // the card itself opens the thing
      e.stopPropagation();
      fn();
    };
    actions.append(b);
  };
  action('copy', 'Make a copy of this thing to change', () => copyThing(t));
  action('arrow-down-to-line', 'Download as a .stuff file', () => downloadThing(t));
  action('trash', 'Remove from My stuff', () => deleteThing(t));
  return actions;
}
/** The open thing is the one on the workbench (its latest changes may not be saved yet). */
const latest = (t: Thing): Thing => (t.id === world.workbench?.id ? workbench() : t);
function copyThing(t: Thing) {
  const src = latest(t);
  if (!src.pieces.length) return;
  openOnBench({ ...stripThumb(src), id: uid(), name: `${src.name.trim() || 'Thing'} copy` });
  hint('Made a copy to change', 1800);
}
function downloadThing(t: Thing) {
  const src = latest(t);
  // one kind of file: a save holding just this thing opens straight into My stuff
  saveBundle({ creatures: [], stuff: [stripThumb(src)], rigs: [] }, src.name.trim() || 'thing');
}
function deleteThing(t: Thing) {
  const src = latest(t);
  const name = src.name.trim() || 'this thing';
  if (src.pieces.length && !confirm(`Delete "${name}" from My stuff? (Creatures already wearing it keep their copy.)`)) return;
  if (t.id !== world.workbench?.id) {
    removeThing(t.id);
    renderStuffPanel();
    return;
  }
  clearTimeout(thingSaveTimer);
  removeThing(t.id);
  // carry on with the last thing in the list, or a fresh one
  const next = collection().at(-1);
  world.workbench = next ? stripThumb(next) : newThing();
  selectedPiece = '';
  $('#thing-saved').textContent = '';
  syncWorkbench();
  commit();
  renderStuffPanel();
}


// ---------------------------------------------------------------------------
// attaching stuff to body parts

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

const gizmo = new SideScaleControls(camera, canvas);
gizmo.setSpace('local');
gizmo.setSize(0.8);
scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !(e as unknown as { value: boolean }).value;
});
gizmo.addEventListener('objectChange', () => {
  invalidate();
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
  if (placing) gapBefore = floorGap();
});
gizmo.addEventListener('mouseUp', () => {
  if (piecePivot && gizmo.object === piecePivot) {
    bakePiece();
    return;
  }
  // a rescaled felt attachment regrows its fuzz at the new size
  if (selectedAttachment) creature.syncAttachments();
  if (placing && gizmo.mode === 'translate' && lifted()) setKeepFloor(false, true);
  commit();
});

let selectedAttachment = '';

function currentAttachment(): Attachment | undefined {
  return state.attachments?.find((a) => a.id === selectedAttachment);
}

function selectAttachment(id: string) {
  const obj = creature.attachmentObject(id);
  if (!obj) return deselectAttachment();
  stopPlacing();
  selectedAttachment = id;
  gizmo.showX = gizmo.showY = gizmo.showZ = true;
  gizmo.attach(obj);
  $('#attach-bar').hidden = false;
  syncAttachBar();
  updateSkeletonVisibility();
  renderCreatureStuff();
}

function deselectAttachment() {
  selectedAttachment = '';
  if (!placing) gizmo.detach();
  $('#attach-bar').hidden = true;
  $('#attach-mat-pop').hidden = true;
  // (also called while a world is being swapped, between creatures)
  if (creature) updateSkeletonVisibility();
  renderCreatureStuff();
}

// ---------------------------------------------------------------------------
// arranging creatures in the scene: the same gizmo moves, turns and resizes
// a whole creature anywhere in 3D

let placing = false;
type PlaceMode = 'translate' | 'rotate' | 'scale';

function setPlaceMode(m: PlaceMode) {
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

function startPlacing() {
  if (mode === 'stuff') return;
  if (selectedAttachment) deselectAttachment();
  placing = true;
  gizmo.showX = gizmo.showY = gizmo.showZ = true;
  gizmo.attach(creature.root);
  setPlaceMode('translate');
  $('#place-bar').hidden = false;
  $('#place-name').textContent = creatureLabel(world.active);
  $('#cr-place').classList.add('on');
  updateSkeletonVisibility();
}

function stopPlacing() {
  if (!placing) return;
  placing = false;
  gizmo.detach();
  gizmo.setSpace('local');
  $('#place-bar').hidden = true;
  $('#cr-place').classList.remove('on');
  updateSkeletonVisibility();
}

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

// ---------------------------------------------------------------------------
// the creature switcher

function renderCreatureBar() {
  const el = $('#creature-rows');
  el.innerHTML = '';
  // with others around, the camera can frame just this one
  $('#view-bar [data-view="selection"]').hidden = world.creatures.length < 2;
  // one row per creature, like the pieces in Stuff: pick (or rename) it, copy it, or remove it
  world.creatures.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'piece-row creature-row';
    row.classList.toggle('active', i === world.active && !idle);
    const pick = document.createElement('button');
    pick.className = 'piece-pick';
    const color = Object.values(s.parts)[0]?.color ?? '#ccc';
    pick.innerHTML = `<i style="background:${color}"></i>`;
    const name = document.createElement('span');
    name.className = 'creature-name';
    name.textContent = creatureLabel(i);
    pick.append(name);
    pick.title = i === world.active && !idle ? `${creatureLabel(i)}: click to rename` : creatureLabel(i);
    pick.onclick = () => {
      if (i === world.active && !idle) return renameCreatureRow(pick);
      idle = false;
      activate(i);
      flashPart();
      save();
      renderUI();
    };
    const dup = document.createElement('button');
    dup.className = 'piece-icon';
    dup.innerHTML = fa('copy');
    dup.title = 'Copy this creature';
    dup.onclick = () => duplicateCreature(i);
    const del = document.createElement('button');
    del.className = 'piece-icon';
    del.innerHTML = fa('trash');
    del.title = world.creatures.length < 2 ? 'The scene needs at least one creature' : 'Remove this creature from the scene';
    del.disabled = world.creatures.length < 2;
    del.onclick = () => removeCreature(i);
    row.append(pick, dup, del);
    el.append(row);
  });
}

/** Turns the active creature's row into a name box: Enter or clicking away keeps it, Escape doesn't. */
function renameCreatureRow(btn: HTMLButtonElement) {
  const before = state.name;
  const input = document.createElement('input');
  input.className = 'text chip-name';
  input.maxLength = 60;
  input.placeholder = `Creature ${world.active + 1}`;
  input.value = state.name ?? '';
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    state.name = keep ? input.value.trim() || undefined : before;
    renderCreatureBar();
    if (keep && state.name !== before) commit();
  };
  input.onkeydown = (e) => {
    e.stopPropagation(); // typing a name isn't a shortcut
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

/** A free spot on the floor to the right of everyone else. */
function freeSpot(): Placement {
  let maxX = -Infinity;
  for (const c of creatures) {
    const box = new THREE.Box3();
    c.root.updateMatrixWorld(true);
    for (const m of c.meshes()) box.expandByObject(m);
    if (!box.isEmpty()) maxX = Math.max(maxX, box.max.x);
  }
  return { x: Number.isFinite(maxX) ? Math.round((maxX + 0.9) * 100) / 100 : 0, z: 0, yaw: 0 };
}

function addCreature(s: CreatureState) {
  idle = false;
  exitDraw();
  world.creatures.push(s);
  creatures.push(makeCreature(s));
  activate(world.creatures.length - 1);
  commit();
  renderUI();
  frameAll();
}

$('#cr-add').onclick = () => {
  const s = defaultState(freshRig(state.rig));
  s.style = state.style;
  s.materialSettings = structuredClone(state.materialSettings);
  s.placement = freeSpot();
  addCreature(s);
  hintOnce('Added a new creature: click any creature to switch between them', 2600);
};
function duplicateCreature(i: number) {
  const src = world.creatures[i];
  const s = structuredClone(src);
  delete s.workbench;
  s.name = src.name?.trim() ? `${src.name.trim()} copy` : undefined;
  // same size, turn and height; just moved over to free floor
  const spot = freeSpot();
  s.placement = { ...(src.placement ?? spot), x: spot.x, z: spot.z };

  addCreature(s);
}
function removeCreature(i: number) {
  if (world.creatures.length < 2) return;
  const label = creatureLabel(i); // no are-you-sure: undo brings it back
  exitDraw();
  stopPlacing();
  if (i !== world.active) activate(i);
  creatures[i].dispose();
  creatures.splice(i, 1);
  world.creatures.splice(i, 1);
  creature = undefined as unknown as Creature; // the old one is gone; don't try to reset it
  activate(Math.max(0, i - 1));
  commit();
  renderUI();
  hint(`Removed ${label}: Ctrl+Z brings it back`, 2600);
}
$('#cr-place').onclick = () => {
  if (!placing) return startPlacing();
  stopPlacing();
  commit();
};

function syncAttachBar() {
  const a = currentAttachment();
  if (!a) return;
  document.querySelectorAll<HTMLButtonElement>('#attach-bar [data-gizmo]').forEach((b) => b.classList.toggle('on', b.dataset.gizmo === gizmo.mode));
  const bone = creature.bones.get(a.bone);
  $('#attach-mirror-label').hidden = !bone || !creature.mirrorBoneOf(bone);
  $<HTMLInputElement>('#attach-mirror').checked = a.mirror;
  $('#attach-mirror-label').classList.toggle('on', a.mirror);
  $<HTMLInputElement>('#attach-wrap').checked = !!a.wrap;
  $('#attach-wrap-label').classList.toggle('on', !!a.wrap);
  $('#attach-name').textContent = a.thing.name;
  if (!$('#attach-mat-pop').hidden) renderAttachMaterial();
}

/** The piece of the picked stuff its colors go on (picked in its Stuff material popover) */
let attachPieceId = '';
function attachPiece(): Piece | undefined {
  const a = currentAttachment();
  return a?.thing.pieces.find((p) => p.id === attachPieceId) ?? a?.thing.pieces[0];
}
/** Change the picked stuff's color or glow: on its piece, or (All) on every piece of it */
function updateAttachColor(fn: (p: Piece) => void, doCommit = true) {
  const a = currentAttachment();
  const p = attachPiece();
  if (!a || !p) return;
  for (const q of pieceColorAll ? a.thing.pieces : [p]) fn(q);
  creature.sync();
  if (doCommit) {
    commit();
    renderAttachMaterial();
  }
}
const attachColorScope = scopeSeg(
  '#attach-color-scope',
  () => pieceColorAll,
  (all) => {
    pieceColorAll = all;
    pieceColorScope();
  },
);
const attachGlowFollow = glowFollowSeg('#attach-glow-follow', attachPiece, (f) =>
  updateAttachColor((q) => {
    if (f) q.glowFollow = f;
    else delete q.glowFollow;
  }),
);
const attachSceneColors = sceneColorRow($('#attach-scene-colors'), () => attachPiece()?.color, (c) => updateAttachColor((q) => (q.color = c)));
glowSlider(
  '#attach-glow',
  (v) => {
    updateAttachColor((p) => {
      if (v > 0) p.glow = v;
      else delete p.glow;
    }, false);
    attachGlowFollow();
  },
  () => commit(),
);
$<HTMLInputElement>('#attach-color').oninput = (e) => updateAttachColor((p) => (p.color = (e.target as HTMLInputElement).value), false);
$<HTMLInputElement>('#attach-color').onchange = () => {
  commit();
  renderAttachMaterial();
};

function renderAttachMaterial() {
  const a = currentAttachment();
  if (!a) return;
  const p = attachPiece()!;
  const several = a.thing.pieces.length > 1;
  // which piece: a button per piece, in its color
  const pieces = $('#attach-pieces');
  pieces.hidden = !several;
  pieces.replaceChildren(
    ...a.thing.pieces.map((q, i) => {
      const b = document.createElement('button');
      b.className = 'piece-pick';
      b.classList.toggle('active', q === p);
      b.innerHTML = `<i style="background:${q.color}"></i>`;
      b.append(` ${i + 1}`);
      b.title = `Piece ${i + 1}`;
      b.onclick = () => {
        attachPieceId = q.id;
        renderAttachMaterial();
      };
      return b;
    }),
  );
  $('#attach-color-scope').hidden = !several;
  attachColorScope();
  const sw = $('#attach-swatches');
  sw.replaceChildren(
    ...SWATCHES.map((c) => {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c.toLowerCase() === p.color.toLowerCase());
      b.onclick = () => updateAttachColor((q) => (q.color = c));
      return b;
    }),
  );
  $<HTMLInputElement>('#attach-color').value = p.color;
  $<HTMLInputElement>('#attach-glow').value = String(p.glow ?? 0);
  attachGlowFollow();
  attachSceneColors();
  const part = state.parts[creature.bones.get(a.bone)?.src ?? ''];
  renderThingMaterial(a.thing, [...new Set(a.thing.pieces.map((p) => p.style))], $('#attach-mat-body'), part?.style ?? state.style);
}

function attachThing(t: Thing) {
  const bone = creature.bones.get(selected);
  if (!bone) return;
  const a: Attachment = {
    id: uid(),
    bone: selected,
    thing: stripThumb(t),
    position: creature.attachPoint(selected),
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
    mirror: !!creature.twinOf(bone),
  };
  state.attachments = [...(state.attachments ?? []), a];
  creature.sync();
  commit();
  $('#attach-pop').hidden = true;
  selectAttachment(a.id);
  hintOnce('Drag the arrows to place it; switch to rotate or scale in the top bar', 3000);
}

// ---------------------------------------------------------------------------
// carrying eyes or stuff from a menu onto the creature: while it's over the
// creature it's really there (exactly where it would land), and letting go
// keeps it

let carry: {
  what: 'eyes' | Thing;
  ghost: HTMLElement;
  /** the eye pair (index) or attachment (id) standing in while over the creature */
  preview: number | string | null;
  /** the thing's extent in its own frame, to sit it on the surface */
  box?: THREE.Box3;
} | null = null;
/** when a carry ended: the click that follows it isn't a click */
let carriedAt = 0;

/** Press and drag `el` to carry what it stands for onto the creature; a plain click still works as before. */
function carryFrom(el: HTMLElement, what: () => 'eyes' | Thing | null, ghost: () => string) {
  // the browser's own drag (of a thumbnail picture) would cancel the pointer and end the carry
  el.addEventListener('dragstart', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!carry) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const w = what();
        if (!w) return;
        const g = document.createElement('div');
        g.className = 'carry-ghost';
        g.innerHTML = ghost();
        document.body.append(g);
        carry = { what: w, ghost: g, preview: null };
        document.body.classList.add('carrying');
      }
      carryTo(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!carry) return;
      endCarry(ev.type === 'pointerup');
      carriedAt = performance.now();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  el.addEventListener(
    'click',
    (e) => {
      if (performance.now() - carriedAt > 300) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}

/** Where a carried thing's middle goes, and how it's turned, to sit on the surface at `hit` (in its part's frame). */
function sitOnSurface(hit: NonNullable<ReturnType<Creature['surfaceAt']>>, box: THREE.Box3): { position: V3; quaternion: [number, number, number, number] } {
  const rootQ = creature.root.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ);
  // upright, facing out from the surface (on top of something: facing the creature's front)
  const face = hit.normal.clone().addScaledVector(up, -hit.normal.dot(up));
  if (face.lengthSq() < 0.1) face.set(0, 0, 1).applyQuaternion(rootQ);
  face.normalize();
  const side = new THREE.Vector3().crossVectors(up, face);
  const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, face));
  // pushed out until it rests on the surface, just sunk in a little
  const out = hit.normal.clone().applyQuaternion(turn.clone().invert()).negate();
  let reach = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, out.x * x + out.y * y + out.z * z);
  const scale = creature.root.getWorldScale(new THREE.Vector3()).x;
  const at = hit.point.clone().addScaledVector(hit.normal, reach * scale * 0.85);
  const pivotQ = hit.bone.pivot.getWorldQuaternion(new THREE.Quaternion());
  const q = pivotQ.invert().multiply(turn);
  return { position: round4(hit.bone.pivot.worldToLocal(at)), quaternion: q.toArray().map((v) => Math.round(v * 1e5) / 1e5) as [number, number, number, number] };
}

/** The extent of something, in its own frame. */
function ownBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  const inv = obj.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  return box;
}

/** Take the stand-in off the creature (the pointer has left it). */
function dropPreview() {
  if (!carry || carry.preview === null) return;
  const p = carry.preview;
  if (typeof p === 'number') state.eyes.pairs.splice(p, 1);
  else state.attachments = (state.attachments ?? []).filter((a) => a.id !== p);
  carry.preview = null;
  creature.sync();
}

function carryTo(x: number, y: number) {
  if (!carry) return;
  carry.ghost.style.transform = `translate(${x}px, ${y}px)`;
  // only over the 3D view itself (not a menu on top of it)
  setRay(x, y);
  const hit = document.elementFromPoint(x, y) === canvas && !idle ? creature.surfaceAt(raycaster) : null;
  carry.ghost.classList.toggle('landing', !!hit);
  if (!hit) return dropPreview();
  if (carry.what === 'eyes') {
    if (carry.preview === null) {
      state.eyes.pairs.push({ size: 0.5, spacing: 0.5, height: 0.55 });
      carry.preview = state.eyes.pairs.length - 1;
    }
    const pair = state.eyes.pairs[carry.preview as number];
    // a limb (one of a mirrored pair, or a stalk) gets a single eye; the head gets a pair
    const b = hit.bone;
    const single = b.def.baseId !== state.rig.headId && (b.def.sideSign !== 0 || b.length > 1.6 * b.def.width);
    if (!!pair.single !== single) pair.single = single || undefined;
    moveEyesTo(carry.preview as number, 1, x, y);
    return;
  }
  const thing = carry.what;
  const id = carry.preview;
  let a = state.attachments?.find((x) => x.id === id);
  if (!a || a.bone !== hit.bone.def.id) {
    // a different part: start over on it, so it rides that part
    dropPreview();
    a = { id: uid(), bone: hit.bone.def.id, thing: stripThumb(thing), position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], mirror: !!creature.twinOf(hit.bone) };
    state.attachments = [...(state.attachments ?? []), a];
    carry.preview = a.id;
    creature.sync();
    const obj = creature.attachmentObject(a.id);
    if (!carry.box && obj) carry.box = ownBox(obj);
  }
  Object.assign(a, sitOnSurface(hit, carry.box ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())));
  creature.sync();
}

function endCarry(drop: boolean) {
  if (!carry) return;
  const c = carry;
  if (!drop) dropPreview();
  carry = null;
  c.ghost.remove();
  document.body.classList.remove('carrying');
  if (c.preview === null) {
    if (drop) hint(c.what === 'eyes' ? 'Drop the eyes onto your critter' : 'Drop it onto your critter to put it on', 1800);
    return;
  }
  commit();
  if (typeof c.preview === 'number') {
    showEyes(c.preview);
    hint('Drag the eyes to move them', 1800);
  } else {
    $('#attach-pop').hidden = true;
    pickStuff(c.preview);
  }
}

carryFrom($('#eyes-add'), () => 'eyes', () => fa('eye'));

/** Everything the creature is wearing, under Parts: picking one goes to Look with it selected, as clicking it would. */
function renderCreatureStuff() {
  const el = $('#creature-stuff');
  el.innerHTML = '';
  const all = state.attachments ?? [];
  $('#creature-stuff-sec').hidden = !all.length;
  for (const a of all) {
    const btn = document.createElement('button');
    iconLabel(btn, fa('paperclip'), a.thing.name);
    const src = creature.bones.get(a.bone)?.src;
    if (src) btn.title = `On the ${partLabel(src).toLowerCase()}`;
    btn.classList.toggle('active', a.id === selectedAttachment);
    btn.onclick = () => (a.id === selectedAttachment ? deselectAttachment() : pickStuff(a.id));
    el.append(btn);
  }
}

/** Pick a piece of stuff in Shape or Look, with the part it's on picked too (that part's handles stay hidden meanwhile). */
function pickStuff(id: string) {
  const a = state.attachments?.find((x) => x.id === id);
  if (a && creature.bones.has(a.bone)) selectPart(a.bone, false);
  selectAttachment(id);
}

function pickAttachment(x: number, y: number): string | null {
  setRay(x, y);
  const hit = raycaster.intersectObjects(creature.attachmentMeshes(), false)[0];
  return hit ? (hit.object.userData.attachmentId as string) : null;
}

$('#attach-pop-close').onclick = () => ($('#attach-pop').hidden = true);
$('#rig-attach').onclick = () => {
  closeTopPopovers();
  $('#attach-pop').hidden = false;
  renderCollection();
};
$('#attach-mat').onclick = () => {
  const pop = $('#attach-mat-pop');
  pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    closeTopPopovers();
    renderAttachMaterial();
  }
};
$('#attach-mat-close').onclick = () => ($('#attach-mat-pop').hidden = true);
document.querySelectorAll<HTMLButtonElement>('#attach-bar [data-gizmo]').forEach((b) => {
  b.onclick = () => {
    gizmo.setMode(b.dataset.gizmo as 'translate' | 'rotate' | 'scale');
    syncAttachBar();
  };
});
$<HTMLInputElement>('#attach-mirror').onchange = (e) => {
  const a = currentAttachment();
  if (!a) return;
  a.mirror = (e.target as HTMLInputElement).checked;
  creature.sync();
  commit();
  selectAttachment(a.id);
};
$<HTMLInputElement>('#attach-wrap').onchange = (e) => {
  const a = currentAttachment();
  if (!a) return;
  a.wrap = (e.target as HTMLInputElement).checked || undefined;
  creature.sync();
  commit();
  selectAttachment(a.id);
};
function removeAttachment() {
  state.attachments = (state.attachments ?? []).filter((a) => a.id !== selectedAttachment);
  deselectAttachment();
  creature.sync();
  commit();
}
$('#attach-remove').onclick = removeAttachment;
// a copy lands a little to one side of the original, so it can be seen and dragged off it
$('#attach-copy').onclick = () => {
  const a = currentAttachment();
  if (!a) return;
  const [x, y, z] = a.position;
  const copy: Attachment = { ...structuredClone(a), id: uid(), position: [x + 0.08, y + 0.08, z] };
  state.attachments = [...(state.attachments ?? []), copy];
  creature.sync();
  commit();
  selectAttachment(copy.id);
};
$('#attach-done').onclick = () => deselectAttachment();

// ---------------------------------------------------------------------------
// files

// The top-bar menus share the same corner of the viewport, so only one is open at a time.
const POPOVERS: [button: string, pop: string][] = [['#trophy-btn', '#trophy-pop'], ['#library-btn', '#library-pop'], ['#file-btn', '#file-pop'], ['#settings-btn', '#settings-pop']];
/** Open (or, if it's already open, close) one top-bar menu. Returns whether it's now open. */
function togglePopover(pop: string): boolean {
  const open = $(pop).hidden !== false;
  for (const [b, p] of POPOVERS) {
    $(p).hidden = !(open && p === pop);
    $(b).classList.toggle('on', open && p === pop);
  }
  // one menu at a time: the Attach popups would sit under Creations or Trophies
  if (open) {
    closeAttachPops();
    closeShortcutSheet();
  }
  return open;
}
function closeTopPopovers() {
  for (const [b, p] of POPOVERS) {
    $(p).hidden = true;
    $(b).classList.remove('on');
  }
}
function closeAttachPops() {
  $('#attach-pop').hidden = true;
  $('#attach-mat-pop').hidden = true;
}

$('#file-btn').onclick = () => {
  if (!togglePopover('#file-pop')) return;
  $<HTMLInputElement>('#creature-name').value = state.name ?? '';
};
$<HTMLInputElement>('#creature-name').oninput = (e) => {
  state.name = (e.target as HTMLInputElement).value;
  renderCreatureBar();
};
$<HTMLInputElement>('#creature-name').onchange = () => commit();
/** Files are named after who's in the scene: "Bimble", or "Bimble-Twin-Creature 3". */
function sceneFileName(): string {
  return world.creatures.map((_, i) => creatureLabel(i)).join('-');
}

/** A creature as it goes into a file (the workbench isn't part of it). */
function forFile(s: CreatureState): CreatureState {
  const { workbench: _wb, ...data } = s;
  return data;
}

// One kind of save: a .creature file holds everything (creatures, My stuff,
// saved body plans and the backdrop). Opening one lets you pick what to bring in.

/** The backdrop, floor, lights and depth of field. */
interface SceneLook {
  backdrop: string;
  floor: typeof floorPrefs;
  light: number;
  dof: typeof dof;
  /** where the view was: the camera, the spot it orbits, and whether it was flat (ortho) */
  camera?: { pos: V3; target: V3; ortho?: boolean };
}

/** What a save holds. Older files (.scene, .stuff, .collection, single creatures) are read into one too. */
interface Bundle {
  name?: string;
  active?: number;
  creatures: CreatureState[];
  stuff: Thing[];
  rigs: RigState[];
  look?: SceneLook;
}

function currentLook(): SceneLook {
  const look: SceneLook = { backdrop, floor: { ...floorPrefs }, light: lightTurn, dof: { ...dof } };
  // (the workbench has a view of its own; mid-flight, where it's flying to)
  if (mode !== 'stuff') {
    const r4 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4) / 1e4) as V3;
    look.camera = { pos: r4(tween?.p1 ?? camera.position), target: r4(tween?.t1v ?? controls.target), ortho: sceneOrtho };
  }
  return look;
}

function saveBundle(b: Bundle, name: string) {
  unlock('save');
  downloadText(`${safeFileName(name, 'my-creatures')}.creature`, JSON.stringify(envelope('creature', b)));
}

$('#file-save').onclick = () => {
  // its card in My creations shows it's saved
  flushCreationSave();
  saveBundle(
    { active: world.active, creatures: world.creatures.map(forFile), stuff: collection(), rigs: savedRigs(), look: currentLook() },
    sceneFileName(),
  );
  if (opened.id) noteSaved([opened.id], 'file');
};
$('#file-open').onclick = () => $<HTMLInputElement>('#file-input').click();
$<HTMLInputElement>('#file-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    openFile(await file.text(), file.name);
  } catch (err) {
    hint(`${file.name}: ${(err as Error).message}`, 3500, true);
  }
};

/** Read any CritterKiln file into a bundle. */
function bundleFrom(text: string): Bundle {
  const env = parseEnvelope(text);
  const d = env.data as Record<string, unknown>;
  const creaturesOf = (raw: unknown[]) => raw.map(migrate).filter((s): s is CreatureState => !!s);
  if (env.kind === 'creature' && Array.isArray(d.creatures)) {
    return {
      name: d.name as string | undefined,
      active: d.active as number | undefined,
      creatures: creaturesOf(d.creatures),
      stuff: ((d.stuff as Thing[] | undefined) ?? []).filter((t) => Array.isArray(t?.pieces)),
      rigs: (d.rigs as RigState[] | undefined) ?? [],
      look: d.look as SceneLook | undefined,
    };
  }
  if (env.kind === 'creature') return { creatures: creaturesOf([d]), stuff: [], rigs: [] };
  if (env.kind === 'scene') return { name: d.name as string | undefined, active: d.active as number | undefined, creatures: creaturesOf((d.creatures as unknown[]) ?? []), stuff: [], rigs: [] };
  if (env.kind === 'stuff') {
    if (!Array.isArray(d.pieces)) throw new Error('The stuff in this file could not be read.');
    return { creatures: [], stuff: [d as unknown as Thing], rigs: [] };
  }
  return { creatures: [], stuff: (d.things as Thing[] | undefined) ?? [], rigs: (d.rigs as RigState[] | undefined) ?? [] };
}

function openFile(text: string, fileName = '') {
  const env = parseEnvelope(text);
  if (env.kind === 'library') {
    void importCreations(env.data as LibraryFile);
    return;
  }
  const b = bundleFrom(text);
  for (const s of b.creatures) delete s.workbench; // the workbench belongs to the scene, not the file
  if (!b.creatures.length && !b.stuff.length && !b.rigs.length && !b.look) throw new Error('There was nothing in this file that could be read.');
  // a single thing comes straight into My stuff; anything with a creature asks
  // whether it joins the scene or replaces it
  if (!b.creatures.length && b.stuff.length === 1 && !b.rigs.length) {
    loadBundle(b, { creatures: b.creatures.map(() => true), stuff: b.stuff.map(() => true), rigs: [], look: false }, false);
    return;
  }
  showLoadPicker(b, b.name?.trim() || fileName.replace(/\.[^.]+$/, ''));
}

interface LoadChoice {
  creatures: boolean[];
  stuff: boolean[];
  rigs: boolean[];
  look: boolean;
}

/** Bring the chosen parts of a bundle in: alongside what's here, or in place of the scene. */
/** Stuff these creatures are wearing (and any other things) joins My stuff, so it can be moved or worn again. */
function keepInCollection(creatures: CreatureState[], things: Thing[] = []) {
  const have = new Set(collection().map((t) => t.id));
  for (const t of [...creatures.flatMap((s) => (s.attachments ?? []).map((a) => a.thing)), ...things]) {
    if (have.has(t.id)) continue;
    putThing(t);
    have.add(t.id);
  }
}

function loadBundle(b: Bundle, pick: LoadChoice, replace: boolean) {
  const incoming = b.creatures.filter((_, i) => pick.creatures[i]);
  const things = b.stuff.filter((_, i) => pick.stuff[i]);
  const rigs = b.rigs.filter((_, i) => pick.rigs[i]);
  exitDraw();
  deselectAttachment();
  stopPlacing();
  for (const r of rigs) saveRig(r, r.name);

  if (incoming.length && replace) {
    // a new creation: the scene it replaces stays in My creations
    leaveScene();
    const active = Math.max(0, incoming.indexOf(b.creatures[b.active ?? 0]));
    replaceWorld({ creatures: incoming, active, name: b.name }, []);
    beginCreation(null, true);
  }
  // after the old scene is saved, so it keeps its own backdrop
  // (the file's view only when it's the whole scene: added creatures are framed where they land)
  const viewed = pick.look && b.look ? applyLook(b.look, replace && incoming.length > 0) : false;
  keepInCollection(incoming, things);
  if (incoming.length && !replace) {
    // keep the file's own arrangement, shifted to free floor on the right
    const spot = freeSpot();
    const minX = Math.min(...incoming.map((s) => s.placement?.x ?? 0));
    for (const s of incoming) {
      s.placement = { ...s.placement, x: spot.x + ((s.placement?.x ?? 0) - minX), z: s.placement?.z ?? 0, yaw: s.placement?.yaw ?? 0 };
      world.creatures.push(s);
      creatures.push(makeCreature(s));
    }
    activate(world.creatures.length - 1);
  }
  commit();
  renderUI();
  renderCollection();
  renderRigs();
  if (incoming.length && mode !== 'stuff' && !viewed) {
    if (replace) freshView();
    else frameAll();
  }

  const bits = [
    incoming.length === 1 ? incoming[0].name || 'a creature' : incoming.length ? `${incoming.length} creatures` : '',
    things.length === 1 ? `"${things[0].name || 'a thing'}"` : things.length ? `${things.length} things` : '',
    rigs.length ? `${rigs.length} body plan${rigs.length > 1 ? 's' : ''}` : '',
    pick.look && b.look ? 'the backdrop' : '',
  ].filter(Boolean);
  hint(`${replace && incoming.length ? 'Opened' : 'Added'} ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}`, 2400);
}

/** Put a saved look back; with `view`, its camera too. Whether the view was put back (else it wants framing). */
function applyLook(l: SceneLook, view = true): boolean {
  setBackdrop(l.backdrop);
  Object.assign(floorPrefs, l.floor);
  saveFloor();
  applyFloor();
  lightTurn = l.light ?? 0;
  applyLighting();
  try {
    localStorage.setItem(LIGHT_KEY, JSON.stringify({ turn: lightTurn }));
  } catch {
    /* ignore */
  }
  Object.assign(dof, l.dof);
  saveDof();
  applyDof();
  renderBackdropUI();
  if (!view || !l.camera) return false;
  putView(l.camera, true);
  return true;
}

/** Look at a scene the way it was saved: flown to, or (not `fly`) straight there. */
function putView(v: NonNullable<SceneLook['camera']>, fly: boolean) {
  sceneOrtho = !!v.ortho;
  try {
    localStorage.setItem(ORTHO_KEY, sceneOrtho ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (mode !== 'stuff') setOrtho(sceneOrtho);
  const pos = new THREE.Vector3(...v.pos), target = new THREE.Vector3(...v.target);
  if (fly) return flyTo(pos, target);
  tween = null;
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
  invalidate();
}

/** The "what do you want from this file?" picker. */
function showLoadPicker(b: Bundle, title: string) {
  const pick: LoadChoice = {
    creatures: b.creatures.map(() => true),
    stuff: b.stuff.map(() => true),
    rigs: b.rigs.map(() => true),
    look: !!b.look,
  };
  // just one thing to bring in: no checklist, only "add or replace?"
  const single = b.creatures.length + b.stuff.length + b.rigs.length + (b.look ? 1 : 0) === 1;
  if (single && b.creatures[0]?.name?.trim()) title = b.creatures[0].name.trim();
  $('#load-title').textContent = title ? `Open “${title}”` : 'Open';
  $('#load-note').hidden = !single;
  $('#load-all-row').hidden = single;
  $('#load-list').hidden = single;
  const list = $('#load-list');
  list.innerHTML = '';
  const boxes: HTMLInputElement[] = [];
  const sync = () => {
    const n = [...pick.creatures, ...pick.stuff, ...pick.rigs, pick.look && !!b.look].filter(Boolean).length;
    const all = $<HTMLInputElement>('#load-all');
    all.checked = n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
    $<HTMLButtonElement>('#load-add').disabled = n === 0;
    // replacing the scene needs someone to replace it with
    $<HTMLButtonElement>('#load-replace').disabled = !pick.creatures.some(Boolean);
  };
  const group = (label: string) => {
    const h = document.createElement('div');
    h.className = 'pop-sub';
    h.textContent = label;
    list.append(h);
  };
  const row = (icon: string, name: string, get: () => boolean, set: (v: boolean) => void) => {
    const l = document.createElement('label');
    l.className = 'load-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = get();
    cb.onchange = () => {
      set(cb.checked);
      sync();
    };
    boxes.push(cb);
    const ic = document.createElement('span');
    ic.className = 'load-icon';
    ic.innerHTML = icon;
    const nm = document.createElement('span');
    nm.textContent = name;
    l.append(cb, ic, nm);
    list.append(l);
  };
  if (b.creatures.length) {
    group('Creatures');
    b.creatures.forEach((s, i) => {
      const color = Object.values(s.parts)[0]?.color ?? '#ccc';
      row(`<i class="load-dot" style="background:${color}"></i>`, s.name?.trim() || `Creature ${i + 1}`, () => pick.creatures[i], (v) => (pick.creatures[i] = v));
    });
  }
  if (b.stuff.length) {
    group('Stuff');
    b.stuff.forEach((t, i) => {
      const icon = t.thumb ? `<img src="${t.thumb}" alt="" />` : fa('box');
      row(icon, t.name?.trim() || 'Thing', () => pick.stuff[i], (v) => (pick.stuff[i] = v));
    });
  }
  if (b.rigs.length) {
    group('Body plans');
    b.rigs.forEach((r, i) => row(faClassic('bone'), r.name, () => pick.rigs[i], (v) => (pick.rigs[i] = v)));
  }
  if (b.look) {
    group('Scene');
    row(`<i class="load-dot" style="background:${b.look.backdrop}"></i>`, b.look.camera ? 'Backdrop, lighting & view' : 'Backdrop & lighting', () => pick.look, (v) => (pick.look = v));
  }
  $<HTMLInputElement>('#load-all').onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    pick.creatures.fill(on);
    pick.stuff.fill(on);
    pick.rigs.fill(on);
    pick.look = on && !!b.look;
    for (const cb of boxes) cb.checked = on;
    sync();
  };
  const close = () => ($('#load-pop').hidden = true);
  $('#load-close').onclick = close;
  $('#load-add').onclick = () => {
    close();
    loadBundle(b, pick, false);
  };
  $('#load-replace').onclick = () => {
    close();
    loadBundle(b, pick, true);
  };
  sync();
  for (const [btn, p] of POPOVERS) {
    $(p).hidden = true;
    $(btn).classList.remove('on');
  }
  $('#load-pop').hidden = false;
}

// ---------------------------------------------------------------------------
// My creations: the open scene saves itself into the library (src/library.ts)
// as you go, and the library lists everything you've made

/** What the library keeps for each scene. */
interface CreationData {
  creatures: CreatureState[];
  active: number;
  look: SceneLook;
  /** its My stuff (absent in creations saved before each one kept its own) */
  stuff?: Thing[];
}
type SavedCreation = Creation<CreationData>;
/** A backup of the whole library, as one file. */
interface LibraryFile {
  creations: SavedCreation[];
}

const CREATION_SAVE_MS = 1200;

function creationData(): CreationData {
  return { creatures: world.creatures.map(forFile), active: world.active, look: currentLook(), stuff: collection() };
}

/** "Bimble & Twin", or "Untitled" when nobody has a name. */
function creationName(c: { name?: string; data: { creatures: CreatureState[] } }): string {
  const named = c.data.creatures.map((s) => s.name?.trim()).filter(Boolean);
  return c.name?.trim() || (named.length ? named.join(' & ') : 'Untitled');
}

/** Save the open scene to the library a moment after it changes. */
function queueCreationSave() {
  // a new scene nobody has touched yet isn't worth keeping
  if (!opened.keep && hIndex <= 0) return;
  opened.keep = true;
  clearTimeout(opened.timer);
  opened.waits = 0;
  opened.timer = window.setTimeout(saveCreationWhenSettled, CREATION_SAVE_MS);
}

function saveCreationWhenSettled() {
  // mid-drag, mid-drawing or while a seamless skin is building, the picture would come out half-done
  const busy = !!drawState || !!drag || gizmo.dragging || creatures.some((c) => c.skinState === 'building');
  if (busy && ++opened.waits < 10) {
    opened.timer = window.setTimeout(saveCreationWhenSettled, 800);
    return;
  }
  saveCreationNow();
}

/** Save straight away if a save is waiting (before the scene is swapped for another). */
function flushCreationSave() {
  if (opened.timer) saveCreationNow();
}

/**
 * Before the scene is swapped for another: the thing on the workbench goes in
 * My stuff, and the scene (My stuff too) is saved to My creations.
 */
function leaveScene() {
  exitDraw();
  saveWorkbenchNow();
  // My stuff belongs to the scene now: one with stuff in it is worth keeping
  // even if its creatures were never touched (nothing in My stuff is lost)
  if (collection().length) opened.keep = true;
  saveCreationNow();
}

/** A picture of every creature in the scene, or '' when they can't be pictured right now. */
function creationThumb(): string {
  if (mode === 'stuff' || drawState) return '';
  const box = new THREE.Box3();
  for (const c of creatures) {
    c.root.updateMatrixWorld(true);
    for (const m of c.meshes()) box.expandByObject(m);
  }
  return snapThumb(box, 256);
}

function saveCreationNow() {
  clearTimeout(opened.timer);
  opened.timer = 0;
  if (!opened.keep) return;
  const data = creationData();
  const json = JSON.stringify(data);
  if (json === opened.savedJson && opened.thumb) return;
  const thumb = creationThumb();
  if (json === opened.savedJson && !thumb) return;
  if (!opened.id) {
    opened.id = uid();
    opened.created = Date.now();
    try {
      localStorage.setItem(CREATION_KEY, opened.id);
    } catch {
      /* ignore */
    }
    keepStorage();
  }
  if (thumb) opened.thumb = thumb;
  opened.savedJson = json;
  const record: SavedCreation = { id: opened.id, name: world.name?.trim() || undefined, created: opened.created, updated: Date.now(), thumb: opened.thumb, data };
  opened.writing = opened.writing.then(() => writeCreation(record));
}

let libraryWarned = false;
async function writeCreation(record: SavedCreation) {
  try {
    const before = await getCreation<CreationData>(record.id);
    // reopened after a reload: keep its original date and picture
    record.created ||= before?.created ?? record.updated;
    record.thumb ??= before?.thumb;
    if (opened.id === record.id) opened.created = record.created;
    if (before) {
      record.saved = before.saved;
      // the same scene again (a new picture, or after a reload): not a change, so a backup still covers it
      if (JSON.stringify(before.data) === JSON.stringify(record.data)) record.updated = before.updated;
    }
    await putCreation(record);
  } catch {
    if (libraryWarned) return;
    libraryWarned = true;
    hint("Couldn't save to My creations in this browser: use File › Save to keep your work", 5000, true);
  }
}

/** The open scene becomes creation `id` (null: not in the library yet). Undo starts over. */
function beginCreation(id: string | null, keep: boolean, from?: SavedCreation) {
  clearTimeout(opened.timer);
  opened.timer = 0;
  opened.id = id;
  opened.created = from?.created ?? 0;
  opened.thumb = from?.thumb;
  opened.keep = keep;
  opened.savedJson = '';
  try {
    if (id) localStorage.setItem(CREATION_KEY, id);
    else localStorage.removeItem(CREATION_KEY);
  } catch {
    /* ignore */
  }
  // undo can't reach back into another creation
  history.length = 0;
  hIndex = -1;
}

/**
 * Swap every creature in the scene for these, and My stuff for `stuff`. The
 * workbench starts empty. Call leaveScene first to keep the old scene.
 */
function replaceWorld(next: World, stuff: Thing[]) {
  exitDraw();
  clearTimeout(thingSaveTimer);
  setCollection(stuff);
  selectedPiece = '';
  $('#thing-saved').textContent = '';
  deselectAttachment();
  stopPlacing();
  for (const c of creatures) c.dispose();
  creatures.length = 0;
  creature = undefined as unknown as Creature; // replaced wholesale
  world = next;
  next.creatures.forEach((s, i) => (creatures[i] = makeCreature(s)));
  selected = '';
  // a new world starts with nothing picked: set before activate draws the handles
  idle = true;
  activate(world.active);
}

/** A fresh scene with nothing in My stuff. `keepOld` = false: the open one was just deleted. */
function newCreation(keepOld = true) {
  if (mode !== 'shape') setMode('shape');
  if (keepOld) leaveScene();
  const kept = opened.keep;
  replaceWorld(freshWorld(), []);
  beginCreation(null, false);
  commit();
  unlock('new');
  listCreations().then((l) => reach('prolific', l.length), () => {});
  renderUI();
  frameCreature(true);
  hint(kept ? 'Fresh start! The last one is in My creations' : 'Fresh start!', 2200);
}

async function openCreation(id: string) {
  closeLibrary();
  if (id === opened.id) return;
  flushCreationSave();
  const c = await getCreation<CreationData>(id).catch(() => undefined);
  const list = (c?.data.creatures ?? []).map(migrate).filter((s): s is CreatureState => !!s);
  if (!c || !list.length) return hint("That creation couldn't be opened", 2500, true);
  for (const s of list) delete s.workbench;
  if (mode === 'stuff') setMode('shape');
  leaveScene();
  replaceWorld({ creatures: list, active: Math.min(Math.max(0, c.data.active ?? 0), list.length - 1), name: c.name }, c.data.stuff ?? []);
  // and whatever its creatures wear (creations from before each kept its own stuff)
  keepInCollection(list);
  const viewed = c.data.look ? applyLook(c.data.look) : false;
  beginCreation(c.id, true, c);
  commit();
  // opening it isn't a change
  opened.savedJson = JSON.stringify(creationData());
  renderUI();
  // as it was last seen (older creations kept no view: framed afresh)
  if (!viewed) freshView();
  hint(`Opened ${creationName(c)}`, 1800);
}

const relTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const TIME_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
function timeAgo(t: number): string {
  const sec = (t - Date.now()) / 1000;
  for (const [unit, n] of TIME_UNITS) if (Math.abs(sec) >= n) return relTime.format(Math.round(sec / n), unit);
  return 'just now';
}

function openLibrary() {
  if ($('#library-pop').hidden) togglePopover('#library-pop');
  void renderLibrary();
}
function closeLibrary() {
  if (!$('#library-pop').hidden) togglePopover('#library-pop');
}
$('#library-btn').onclick = () => {
  if (togglePopover('#library-pop')) void renderLibrary();
};
$('#library-close').onclick = closeLibrary;

// ---------------------------------------------------------------------------
// trophies

function renderTrophyList() {
  if (!$('#trophy-pop').hidden) renderTrophies($('#trophy-list'), $('#trophy-count'));
}
function openTrophies() {
  if ($('#trophy-pop').hidden) togglePopover('#trophy-pop');
  renderTrophyList();
}
$('#trophy-btn').onclick = () => {
  if (togglePopover('#trophy-pop')) renderTrophyList();
};
$('#trophy-close').onclick = () => {
  if (!$('#trophy-pop').hidden) togglePopover('#trophy-pop');
};
setTrophyHandlers({ open: openTrophies, changed: renderTrophyList });

async function renderLibrary() {
  const grid = $('#creation-grid');
  // the open scene's latest changes go in first, so its card is up to date
  flushCreationSave();
  let list: SavedCreation[];
  try {
    await opened.writing;
    list = await listCreations<CreationData>();
  } catch {
    grid.innerHTML = `<p class="muted small">My creations can't be kept in this browser (a private window, or site storage is blocked). Use File › Save to keep your work.</p>`;
    return;
  }
  reach('prolific', list.length);
  grid.innerHTML = '';
  const fresh = document.createElement('button');
  fresh.className = 'creation-card creation-new';
  fresh.innerHTML = `<span class="thumb">${faClassic('plus')}</span><span class="creation-name">New creation</span>`;
  fresh.onclick = () => {
    closeLibrary();
    newCreation();
  };
  grid.append(fresh);
  for (const c of list) grid.append(creationCard(c));
  const unsaved = list.filter((c) => !saveStatus(c).ok).length;
  const note = $('#library-unsaved');
  note.hidden = !unsaved;
  note.textContent = unsaved === 1 ? '1 creation isn’t in a backup or file yet' : `${unsaved} creations aren’t in a backup or file yet`;
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'muted small library-empty';
    p.textContent = 'Nothing here yet. Whatever you make is kept here as you go.';
    grid.append(p);
  }
}

/** Whether a creation is safe in a file (a backup or its own save) as it is now. */
function saveStatus(c: SavedCreation): { ok: boolean; text: string; title: string } {
  const s = c.saved;
  const how = s?.how === 'file' ? 'saved to a file' : 'backed up';
  if (!s) return { ok: false, text: 'Only in this browser', title: 'Not in a backup or a saved file yet: Back up all, or download it' };
  const when = new Date(s.at);
  // "Oct 12" (with the year once it's not this one); the hover has the time too
  const day = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(when.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
  const full = `${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${timeAgo(s.at)})`;
  if (s.at >= c.updated) return { ok: true, text: `${s.how === 'file' ? 'Saved' : 'Backed up'} ${day}`, title: `Unchanged since it was ${how} ${full}` };
  return { ok: false, text: `Changed since ${day} ${s.how === 'file' ? 'save' : 'backup'}`, title: `Changed since it was ${how} ${full}: Back up all, or download it` };
}

/** These creations just went into a file: their cards stop asking for a backup. */
function noteSaved(ids: string[], how: SavedHow) {
  const at = Date.now();
  opened.writing = opened.writing
    .then(() => markSaved(ids, how, at))
    .catch(() => {})
    .then(() => {
      if (!$('#library-pop').hidden) void renderLibrary();
    });
}

function creationCard(c: SavedCreation): HTMLElement {
  const current = c.id === opened.id;
  const card = document.createElement('div');
  card.className = 'creation-card';
  card.classList.toggle('current', current);
  const name = creationName(c);

  const open = document.createElement('button');
  open.className = 'creation-open';
  open.title = current ? `${name} (open now)` : `Open ${name}`;
  if (c.thumb) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = c.thumb;
    img.alt = '';
    open.append(img);
  } else {
    const color = Object.values(c.data.creatures[0]?.parts ?? {})[0]?.color ?? '#ccc';
    open.innerHTML = `<span class="thumb"><i class="creation-blob" style="background:${color}"></i></span>`;
  }
  if (current) open.insertAdjacentHTML('beforeend', '<span class="creation-badge">Open now</span>');
  open.onclick = () => void openCreation(c.id);

  const label = document.createElement('span');
  label.className = 'creation-name';
  label.textContent = name;
  const meta = document.createElement('div');
  meta.className = 'creation-meta';
  const when = document.createElement('span');
  when.className = 'creation-when muted';
  when.textContent = timeAgo(c.updated);
  const st = saveStatus(c);
  const saved = document.createElement('span');
  saved.className = `creation-saved ${st.ok ? 'ok' : 'warn'}`;
  saved.innerHTML = fa(st.ok ? 'check' : 'triangle-exclamation');
  saved.append(` ${st.text}`);
  saved.title = st.title;
  meta.append(label, when, saved);

  const actions = document.createElement('div');
  actions.className = 'creation-actions';
  const action = (icon: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = 'piece-icon';
    b.innerHTML = fa(icon);
    b.title = title;
    b.onclick = fn;
    actions.append(b);
  };
  action('plus', 'Add to scene: its creatures join the one open now', () => addCreationToScene(c));
  action('pencil', 'Rename', () => renameCreation(c, label));
  action('copy', 'Make a copy', () => void copyCreation(c));
  action('arrow-down-to-line', 'Download it as a file', () => downloadCreation(c));
  action('trash', 'Delete', () => void removeCreation(c));
  card.append(open, meta, actions);
  return card;
}

function renameCreation(c: SavedCreation, label: HTMLElement) {
  const input = document.createElement('input');
  input.className = 'text creation-rename';
  input.maxLength = 60;
  input.value = c.name ?? '';
  input.placeholder = creationName({ data: c.data });
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (keep: boolean) => {
    if (done) return;
    done = true;
    const next = input.value.trim() || undefined;
    if (keep && next !== c.name) {
      c.name = next;
      if (c.id === opened.id) {
        // later saves carry the name along
        world.name = next;
        save();
      }
      await opened.writing;
      // the latest record (a backup since the cards were drawn shouldn't be undone)
      const latest = (await getCreation<CreationData>(c.id).catch(() => undefined)) ?? c;
      await putCreation({ ...latest, name: next }).catch(() => hint("Couldn't rename it", 2000, true));
    }
    void renderLibrary();
  };
  input.onkeydown = (e) => {
    e.stopPropagation(); // typing a name isn't a shortcut
    if (e.key === 'Enter') void finish(true);
    else if (e.key === 'Escape') void finish(false);
  };
  input.onblur = () => void finish(true);
}

/** Bring a creation's creatures into the open scene, beside everyone already here. */
function addCreationToScene(c: SavedCreation) {
  const d = c.id === opened.id ? creationData() : c.data;
  const list = structuredClone(d.creatures).map(migrate).filter((s): s is CreatureState => !!s);
  if (!list.length) return hint("That creation couldn't be added", 2500, true);
  for (const s of list) delete s.workbench;
  closeLibrary();
  if (mode === 'stuff') setMode('shape');
  // a fresh scene nobody has touched yet: they take the starter creature's place
  // its My stuff comes along too
  const stuff = structuredClone(d.stuff ?? []);
  loadBundle({ creatures: list, stuff, rigs: [] }, { creatures: list.map(() => true), stuff: stuff.map(() => true), rigs: [], look: false }, !opened.keep);
}

async function copyCreation(c: SavedCreation) {
  const now = Date.now();
  const data = c.id === opened.id ? creationData() : c.data;
  try {
    await opened.writing;
    const copy: SavedCreation = { ...structuredClone(c), data: structuredClone(data), id: uid(), name: `${creationName(c)} copy`, created: now, updated: now };
    // a new creation: in no file yet
    delete copy.saved;
    await putCreation(copy);
  } catch {
    hint("Couldn't copy it", 2000, true);
  }
  void renderLibrary();
}

function downloadCreation(c: SavedCreation) {
  const name = creationName(c);
  if (c.id === opened.id) flushCreationSave();
  const d = c.id === opened.id ? creationData() : c.data;
  saveBundle({ name, active: d.active, creatures: d.creatures, stuff: [], rigs: [], look: d.look }, name);
  noteSaved([c.id], 'file');
}

async function removeCreation(c: SavedCreation) {
  const name = creationName(c);
  if (!confirm(`Delete "${name}" from My creations? This can't be undone.`)) return;
  const current = c.id === opened.id;
  if (current) {
    // nothing more of it gets saved
    clearTimeout(opened.timer);
    opened.timer = 0;
    opened.keep = false;
  }
  try {
    await opened.writing;
    await deleteCreation(c.id);
  } catch {
    hint("Couldn't delete it", 2000, true);
  }
  if (current) newCreation(false);
  void renderLibrary();
}

/** The whole library as one file. */
async function backupCreations() {
  flushCreationSave();
  try {
    await opened.writing;
    const creations = await listCreations<CreationData>();
    if (!creations.length) return hint('Nothing in My creations yet', 1800);
    const day = new Date().toISOString().slice(0, 10);
    downloadText(`CritterKiln creations ${day}.creature`, JSON.stringify(envelope('library', { creations } satisfies LibraryFile)));
    unlock('backup');
    noteSaved(creations.map((c) => c.id), 'backup');
  } catch {
    hint("Couldn't read My creations", 2000, true);
  }
}
$('#library-backup').onclick = () => void backupCreations();
$('#library-import').onclick = () => $<HTMLInputElement>('#file-input').click();

/** Bring a backup's creations into the library (where yours aren't newer). */
async function importCreations(f: LibraryFile) {
  const incoming = (f.creations ?? []).filter((c) => c?.id && Array.isArray(c.data?.creatures));
  if (!incoming.length) return hint('There were no creations in this file', 2500, true);
  let added = 0;
  try {
    await opened.writing;
    const have = new Map((await listCreations()).map((c) => [c.id, c]));
    for (const c of incoming) {
      const mine = have.get(c.id);
      if (mine && mine.updated >= c.updated) continue;
      // it's in the backup it came from
      const kept: SavedCreation = { ...c, saved: { at: c.updated, how: 'backup' } };
      // the open scene would save straight over it: keep the backup's version beside it
      await putCreation(c.id === opened.id ? { ...kept, id: uid() } : kept);
      added++;
    }
  } catch {
    return hint("My creations can't be kept in this browser", 3000, true);
  }
  hint(added ? `Added ${added} creation${added > 1 ? 's' : ''} to My creations` : 'You already have everything in this file', 2400);
  openLibrary();
}

// installing as an app (where the browser offers it): its own window, and storage the browser keeps
let installPrompt: (Event & { prompt(): Promise<unknown> }) | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as typeof installPrompt;
  $('#install-app').hidden = false;
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install-app').hidden = true;
});
$('#install-app').onclick = async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  $('#install-app').hidden = true;
};

// a .creature file opened from the desktop with the installed app
interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
(window as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue?.setConsumer(async (p) => {
  for (const handle of p.files) {
    const file = await handle.getFile();
    try {
      openFile(await file.text(), file.name);
    } catch (err) {
      hint(`${file.name}: ${(err as Error).message}`, 3500, true);
    }
  }
});

// leaving the page: whatever's waiting gets saved
addEventListener('pagehide', flushCreationSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushCreationSave();
});

// ---------------------------------------------------------------------------
// UI

const SWATCHES = [
  '#f26b5b', '#ff9f6b', '#f7c873', '#fff1c9', '#9fd98b', '#5fbf9f', '#7cc6e8', '#6d8fe0',
  '#b9a3e3', '#f6a5b5', '#e86aa6', '#c98b5e', '#8d6e63', '#fdfaf4', '#9a9aa6', '#3a3340',
];

/**
 * Every color in use: the creatures, their eyes and what they wear, the thing
 * on the bench, the floor and the backdrop. The most used first.
 */
function sceneColors(): string[] {
  const used = new Map<string, number>();
  const add = (c?: string) => {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return;
    c = c.toLowerCase();
    used.set(c, (used.get(c) ?? 0) + 1);
  };
  for (const s of world.creatures) {
    for (const p of Object.values(s.parts)) add(p.color);
    if (s.eyes.enabled && (s.eyes.style === 'bead' || s.eyes.style === 'dot' || s.eyes.style === 'button')) add(s.eyes.color);
    for (const a of s.attachments ?? []) for (const p of a.thing.pieces) add(p.color);
  }
  for (const p of world.workbench?.pieces ?? []) add(p.color);
  if (floorPrefs.mode === 'material') add(floorPrefs.color);
  add(backdrop);
  return [...used].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** A color picker's "In the scene" row, kept up to date as colors change anywhere. */
function sceneColorRow(el: HTMLElement, current: () => string | undefined, pick: (c: string) => void): () => void {
  const render = () => {
    const colors = sceneColors();
    const now = current()?.toLowerCase();
    el.hidden = !colors.length;
    const sw = document.createElement('div');
    sw.className = 'swatches';
    for (const c of colors) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c === now);
      b.onclick = () => pick(c);
      sw.append(b);
    }
    const title = document.createElement('div');
    title.className = 'sub-title';
    title.textContent = 'In the scene';
    el.replaceChildren(title, sw);
  };
  sceneColorRows.push(render);
  return render;
}
function renderSceneColors() {
  // (not before the first creature is up)
  if (!creature) return;
  for (const r of sceneColorRows) r();
}
setSceneColors(sceneColors);

/**
 * Where a glow comes from (Even / Bright / Dark, under its Glow slider; only
 * shown while it glows). Returns its redraw.
 */
function glowFollowSeg(id: string, get: () => { glow?: number; glowFollow?: GlowFollow } | undefined, set: (f: GlowFollow | undefined) => void): () => void {
  const el = $(id);
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
  const render = () => {
    const o = get();
    el.hidden = !o?.glow;
    for (const b of buttons) b.classList.toggle('active', b.dataset.follow === (o?.glowFollow ?? 'even'));
  };
  for (const b of buttons) {
    b.onclick = () => {
      const f = b.dataset.follow as GlowFollow;
      set(f === 'even' ? undefined : f);
      render();
    };
  }
  return render;
}

/** A Glow slider: `set` while it's dragged, `done` when let go. */
function glowSlider(id: string, set: (v: number) => void, done: () => void) {
  const input = $<HTMLInputElement>(id);
  input.oninput = () => {
    set(parseFloat(input.value));
    invalidate();
  };
  input.onchange = () => done();
}

function partLabel(src: string): string {
  const b = creature.bones.get(src)!;
  return b.def.sideSign !== 0 ? b.def.name.replace(/ \((L|R)\)$/, '') : b.def.name;
}

function sources(): BoneRT[] {
  return creature.list.filter((b) => !b.def.mirrorOf);
}

function selPart() {
  return state.parts[creature.bones.get(selected)!.src];
}

function selectPart(id: string, tips = true) {
  idle = false;
  selected = id;
  creature.select(id);
  updateSkeletonVisibility();
  flashPart();
  renderUI();
  if (tips && mode === 'shape') shapeTips();
}

/** What the handles on a picked part do: the first time one is picked in Shape. */
function shapeTips() {
  hintOnce(`Drag the orange balls to pose · ${touchScreen() ? 'double-tap' : 'double-click'} a part to draw it`, 3600);
}

let flashStart = 0;
function flashPart() {
  flashStart = performance.now();
}

function renderRigs() {
  const el = $('#rigs');
  el.innerHTML = '';
  const options = [
    ...RIGS.map((r) => ({ base: r.id, icon: `<i class="${r.icon}" aria-hidden="true"></i>`, name: r.name })),
    ...savedRigs().map((r) => ({ base: r.base, icon: '<i class="fa-solid fa-bone" aria-hidden="true"></i>', name: r.name })),
  ];
  for (const o of options) {
    const btn = document.createElement('button');
    btn.innerHTML = `<span>${o.icon}</span>`;
    btn.title = o.name;
    btn.setAttribute('aria-label', o.name);
    btn.classList.toggle('active', o.base === state.rig.base);
    btn.onclick = () => switchRig(o.base);
    el.append(btn);
  }
}

function renderParts() {
  const el = $('#parts');
  el.innerHTML = '';
  const selSrc = creature.bones.get(selected)?.src;
  for (const b of sources()) {
    const btn = document.createElement('button');
    const p = state.parts[b.src];
    const twin = creature.list.some((o) => o.def.mirrorOf === b.def.id);
    btn.innerHTML = `<i style="background:${p.color}"></i>${partLabel(b.src)}${twin ? ' ×2' : ''}${p.outline ? ` ${fa('check')}` : ''}`;
    btn.classList.toggle('active', b.src === selSrc);
    btn.onclick = () => selectPart(b.def.id);
    el.append(btn);
  }
}

function renderPartCard() {
  const p = selPart();
  const kind = p.kind ?? 'puffy';
  document.querySelectorAll<HTMLButtonElement>('#part-kind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  // a turned part is as round as its drawing: nothing to thicken
  $('#thickness-row').hidden = kind === 'turned';
  $<HTMLInputElement>('#thickness').value = String(p.thickness);
  $<HTMLInputElement>('#opacity').value = String(p.opacity ?? 1);
  $<HTMLButtonElement>('#reset-shape').disabled = !p.outline;
}

let opacityPending = false;
$<HTMLInputElement>('#opacity').oninput = (e) => {
  const v = parseFloat((e.target as HTMLInputElement).value);
  for (const src of creature.blendedWith(selected)) state.parts[src].opacity = v;
  if (opacityPending) return;
  opacityPending = true;
  requestAnimationFrame(() => {
    opacityPending = false;
    creature.sync();
  });
};
$<HTMLInputElement>('#opacity').onchange = () => {
  creature.sync();
  commit();
};

function renderColors() {
  const p = selPart();
  const el = $('#swatches');
  el.innerHTML = '';
  for (const c of SWATCHES) {
    const btn = document.createElement('button');
    btn.style.background = c;
    btn.title = c;
    btn.classList.toggle('active', c.toLowerCase() === p.color.toLowerCase());
    btn.onclick = () => setColor(c, true);
    el.append(btn);
  }
  $<HTMLInputElement>('#color').value = p.color;
  $<HTMLInputElement>('#glow').value = String(p.glow ?? 0);
  partSceneColors();
  partGlowFollow();
}
const partGlowFollow = glowFollowSeg(
  '#glow-follow',
  () => (creature.bones.has(selected) ? selPart() : undefined),
  (f) => {
    for (const p of colorParts()) {
      if (f) p.glowFollow = f;
      else delete p.glowFollow;
    }
    creature.sync();
    creature.markMergeDirty();
    commit();
  },
);
const partSceneColors = sceneColorRow($('#scene-colors'), () => (creature.bones.has(selected) ? selPart().color : undefined), (c) => setColor(c, true));
glowSlider(
  '#glow',
  (v) => {
    for (const p of colorParts()) {
      if (v > 0) p.glow = v;
      else delete p.glow;
    }
    creature.sync();
    creature.markMergeDirty();
    partGlowFollow();
  },
  () => commit(),
);

function renderStyles() {
  const current = !styleAll ? (selPart().style ?? state.style) : state.style;
  const el = $('#styles');
  el.innerHTML = '';
  for (const s of STYLES) {
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="ball ${s.id}"></span><span><b>${s.name}</b><small>${s.desc}</small></span>`;
    btn.classList.toggle('active', s.id === current);
    btn.onclick = () => setStyle(s.id);
    el.append(btn);
  }
  renderStyleParams(current);
}

type SettingsOwner = { materialSettings?: CreatureState['materialSettings'] };

/**
 * A stuff item's material controls. "Inherits material" makes it take the
 * material of whatever wears it (type and settings: the body part it's on);
 * otherwise each piece keeps its own material, with sliders just for this item.
 */
function renderThingMaterial(thing: Thing, styles: StyleId[], el: HTMLElement, wearerStyle: StyleId) {
  el.innerHTML = '';
  // items from before inheriting meant this shared the creature's settings:
  // give them their own copy, looking just as they do now
  if (!thing.inherit && !thing.ownMaterial) {
    thing.ownMaterial = true;
    thing.materialSettings ??= {};
    for (const st of styles) thing.materialSettings[st] ??= { ...creature.settingsFor(st) };
  }
  const row = document.createElement('label');
  row.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!thing.inherit;
  box.onchange = () => {
    thing.inherit = box.checked;
    if (!thing.inherit) {
      // back to its own pieces' materials, starting from what those look like on the creature
      thing.ownMaterial = true;
      thing.materialSettings ??= {};
      for (const st of styles) thing.materialSettings[st] ??= { ...creature.settingsFor(st) };
    }
    creature.sync();
    syncWorkbench();
    commit();
    if (mode === 'stuff') renderStuffPanel();
    else renderThingMaterial(thing, styles, el, wearerStyle);
  };
  row.append(box, ' Inherits material');
  el.append(row);
  const styleName = STYLES.find((s) => s.id === wearerStyle)?.name ?? wearerStyle;
  if (thing.inherit) {
    const note = document.createElement('p');
    note.className = 'muted small inherit-note';
    note.textContent = `Made of ${styleName}, like the ${mode === 'stuff' ? 'creature' : 'part it’s on'}. Change it in Build › Material.`;
    el.append(note);
  }
  const scaleRow = document.createElement('label');
  scaleRow.className = 'check';
  scaleRow.title = 'On: fuzz keeps the same real length when the item is scaled. Off: it grows and shrinks with the item.';
  const scaleBox = document.createElement('input');
  scaleBox.type = 'checkbox';
  scaleBox.checked = thing.scaleMaterial !== false;
  scaleBox.onchange = () => {
    thing.scaleMaterial = scaleBox.checked;
    creature.sync();
    commit();
  };
  scaleRow.append(scaleBox, ' Re-adjust material on scale');
  el.append(scaleRow);
  if (thing.inherit) return;
  for (const st of styles) {
    const sub = document.createElement('div');
    sub.className = 'style-params';
    el.append(sub);
    renderStyleParams(st, sub, thing);
  }
}


/**
 * Sliders for a material. With the default owner (the creature) they apply
 * everywhere that material is used, stuff included unless the item has its
 * own settings. The number boxes take any value, past either end of the slider.
 */
function renderStyleParams(style: StyleId, el: HTMLElement = $('#style-params'), owner: SettingsOwner = state) {
  el.innerHTML = '';
  const values = styleSettings(style, owner.materialSettings?.[style]);
  const head = document.createElement('div');
  head.className = 'style-params-head';
  head.innerHTML = `<span>${STYLES.find((s) => s.id === style)!.name} settings</span>`;
  const reset = document.createElement('button');
  reset.className = 'link';
  reset.textContent = 'Reset';
  reset.onclick = () => {
    if (owner.materialSettings) delete owner.materialSettings[style];
    creature.sync();
    syncWorkbench();
    commit();
    renderStyleParams(style, el, owner);
  };
  head.append(reset);
  el.append(head);
  let pending = false;
  for (const p of STYLE_PARAMS[style]) {
    const row = document.createElement('label');
    row.className = 'slider';
    const name = document.createElement('span');
    name.textContent = p.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(values[p.key]);
    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'num';
    num.dataset.own = '1';
    num.step = String(p.step);
    num.value = String(values[p.key]);
    const apply = (v: number) => {
      owner.materialSettings ??= {};
      (owner.materialSettings[style] ??= {})[p.key] = v;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        creature.sync();
        syncWorkbench();
        if (owner === state && floorPrefs.mode === 'material' && floorPrefs.style === style) buildFloorMesh();
        // toon's ink width at 0 has no outline for the eyes to share
        if (p.key === 'ink') renderEyes();
      });
    };
    input.oninput = () => {
      num.value = input.value;
      apply(parseFloat(input.value));
    };
    input.onchange = () => commit();
    num.oninput = () => {
      const v = parseFloat(num.value);
      if (!Number.isFinite(v)) return;
      input.value = String(v); // the slider just pins at its end
      apply(v);
    };
    num.onchange = () => commit();
    row.append(name, input, num);
    el.append(row);
  }
}

// the on-screen eye card can be folded away (remembered)
const EYES_FOLD_KEY = 'creature-creator/eyes-folded';
let eyesFolded = (() => {
  try {
    return localStorage.getItem(EYES_FOLD_KEY) === '1';
  } catch {
    return false;
  }
})();
function setEyesFolded(on: boolean) {
  eyesFolded = on;
  try {
    localStorage.setItem(EYES_FOLD_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  $('#eyes-card').classList.toggle('folded', on);
}
$('#eyes-fold').onclick = () => setEyesFolded(!eyesFolded);

/** Eye pairs on the picked part (either side of a mirrored pair), by index into state.eyes.pairs. */
function partEyes(): number[] {
  return state.eyes.pairs.flatMap((p, i) => (creature.eyeBones(p).some((b) => b.def.id === selected) ? [i] : []));
}

function renderEyes() {
  const e = state.eyes;
  e.style ??= 'googly';
  // the picked part's eyes get the card; a part without any gets an Add button
  const mine = idle ? [] : partEyes();
  $('#eyes-add').hidden = idle;
  $('#eyes-card').hidden = !mine.length;
  $('#eyes-card').classList.toggle('folded', eyesFolded);
  if (!mine.length) return;
  if (!mine.includes(eyePair)) eyePair = mine[0];
  const el = $('#eye-styles');
  el.innerHTML = '';
  const options: { id: EyeStyle | 'none'; name: string }[] = [{ id: 'none', name: 'None' }, ...EYE_STYLES];
  const icons: Record<string, string> = {
    none: fa('eye-slash'),
    googly: faClassic('eyes'),
    flat: fa('circle'),
    bead: fa('circle-half-stroke'),
    dot: faClassic('circle-small'),
    button: faClassic('circle-dot'),
  };
  for (const o of options) {
    const btn = document.createElement('button');
    btn.innerHTML = `<span>${icons[o.id]}</span>${o.name}`;
    btn.classList.toggle('active', o.id === 'none' ? !e.enabled : e.enabled && e.style === o.id);
    btn.onclick = () => {
      if (o.id === 'none') e.enabled = false;
      else {
        e.enabled = true;
        e.style = o.id;
      }
      creature.sync();
      commit();
      renderEyes();
    };
    el.append(btn);
  }
  const tabs = $('#eye-pairs');
  tabs.innerHTML = '';
  mine.forEach((i, n) => {
    const btn = document.createElement('button');
    btn.textContent = `${e.pairs[i].single ? 'Eye' : 'Pair'} ${n + 1}`;
    btn.classList.toggle('active', i === eyePair);
    btn.onclick = () => {
      eyePair = i;
      renderEyes();
    };
    tabs.append(btn);
  });
  const add = document.createElement('button');
  add.textContent = '+ Add';
  add.className = 'add';
  add.onclick = () => {
    // another pair on the same part, a little smaller and lower
    const on = e.pairs[eyePair];
    e.pairs.push({ size: Math.max(0.15, on.size * 0.75), spacing: on.spacing, height: Math.max(0.1, on.height - 0.22), lift: on.lift ?? e.lift, bone: on.bone, single: on.single, turn: on.turn ?? e.turn });
    eyePair = e.pairs.length - 1;
    e.enabled = true;
    creature.sync();
    commit();
    renderEyes();
  };
  tabs.append(add);
  const del = document.createElement('button');
  del.textContent = 'Remove';
  del.className = 'remove';
  del.title = 'Take these eyes off';
  del.onclick = () => {
    e.pairs.splice(eyePair, 1);
    creature.sync();
    commit();
    renderEyes();
  };
  tabs.append(del);
  const pair = e.pairs[eyePair];
  $<HTMLInputElement>('#eye-single').checked = !!pair.single;
  $<HTMLInputElement>('#eye-size').value = String(pair.size);
  $<HTMLInputElement>('#eye-spacing').value = String(pair.spacing);
  $<HTMLInputElement>('#eye-spacing').disabled = !!pair.single;
  $<HTMLInputElement>('#eye-height').value = String(pair.height);
  // placed by hand: dragging them replaces Spacing and Height
  $('#eye-spacing-row').hidden = $('#eye-height-row').hidden = !!pair.at;
  $('#eye-placed').hidden = !pair.at;
  $('#eye-sliders').style.opacity = e.enabled ? '1' : '.4';
  $<HTMLInputElement>('#eye-lift').value = String(pair.lift ?? e.lift ?? 0);
  $<HTMLInputElement>('#eye-turn').value = String(Math.round(((pair.turn ?? e.turn ?? 0) * 180) / Math.PI));
  // finish and color only apply to the styles made of a material
  // googly and sticker eyes have a pupil to size and point
  const pupils = e.enabled && (e.style === 'googly' || e.style === 'flat');
  $('#eye-pupil-look').hidden = !pupils;
  if (pupils) {
    $('#eye-pupil-title').textContent = e.style === 'googly' ? 'Googly look' : 'Sticker look';
    $('#eye-shine-row').hidden = e.style !== 'googly';
    $<HTMLInputElement>('#eye-shine').value = String(e.shine ?? 1);
    $<HTMLInputElement>('#eye-pupil').value = String(e.pupil ?? 0.5);
    $<HTMLInputElement>('#eye-look-x').value = String(e.lookX ?? 0);
    // a sticker's loose pupil has fallen to the bottom
    $<HTMLInputElement>('#eye-look-y').value = String(e.lookY ?? (e.style === 'flat' ? -1 : 0));
    // one eye in the middle has nothing to cross with
    $('#eye-cross-row').hidden = e.pairs.every((p) => p.single);
    $<HTMLInputElement>('#eye-cross').value = String(e.cross ?? 0);
  }
  const shaped = e.enabled && (e.style === 'bead' || e.style === 'dot' || e.style === 'button');
  $('#eye-look').hidden = !shaped;
  if (shaped) {
    const finish = e.finish ?? 'body';
    document.querySelectorAll<HTMLButtonElement>('#eye-finish button').forEach((b) => b.classList.toggle('active', b.dataset.finish === finish));
    // options that only mean something on some materials (the ink outline: on a toon part)
    const inkable = creature.eyesCanInk();
    const textured = creature.eyesTextured();
    $('#eye-material-opts').hidden = !inkable && !textured;
    $('#eye-ink-row').hidden = !inkable;
    $('#eye-vary-row').hidden = !textured;
    $<HTMLInputElement>('#eye-ink').checked = !!e.ink;
    $<HTMLInputElement>('#eye-vary').checked = e.vary !== false;
    const current = (e.color ?? (e.style === 'bead' ? '#1d1a22' : '#2a2730')).toLowerCase();
    const sw = $('#eye-swatches');
    sw.innerHTML = '';
    for (const c of EYE_SWATCHES) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c === current);
      b.onclick = () => setEyeLook((x) => (x.color = c));
      sw.append(b);
    }
    $<HTMLInputElement>('#eye-color').value = current;
    $<HTMLInputElement>('#eye-glow').value = String(e.glow ?? 0);
    eyeGlowFollow();
    eyeSceneColors();
    // the lids, crescent and tilt reshape a bead or a dot; a button stays round
    $('#eye-shape').hidden = e.style === 'button';
    $<HTMLInputElement>('#eye-lid-top').value = String(e.lidTop ?? 1);
    $<HTMLInputElement>('#eye-lid-bottom').value = String(e.lidBottom ?? -1);
    $<HTMLInputElement>('#eye-crescent').value = String(e.crescent ?? 0);
    $<HTMLInputElement>('#eye-tilt').value = String(e.tilt ?? 0);
  }
}

function renderUI() {
  if (!creature.bones.has(selected)) selected = creature.list[0].def.id;
  renderAnim();
  renderRigs();
  renderParts();
  renderPartCard();
  renderColors();
  renderStyles();
  renderMerge();
  renderEyes();
  renderRigPanel();
  renderCreatureStuff();
  renderStuffPanel();
  renderCreatureBar();
  syncIdle();
}

/** Colors go on the picked part, or (Everything) on the whole creature */
let colorAll = false;
/** Materials go on the whole creature, or (Part) just the picked part */
let styleAll = true;
/** the parts a color (and its glow) goes on */
function colorParts(): PartState[] {
  return colorAll ? Object.values(state.parts) : [selPart()];
}

/** A Part | Everything toggle: shows `get()`, and `set`s it when clicked. */
function scopeSeg(id: string, get: () => boolean, set: (all: boolean) => void): () => void {
  const buttons = [...$(id).querySelectorAll<HTMLButtonElement>('button')];
  const render = () => {
    for (const b of buttons) b.classList.toggle('active', (b.dataset.scope === 'all') === get());
  };
  for (const b of buttons) {
    b.onclick = () => {
      set(b.dataset.scope === 'all');
      render();
    };
  }
  render();
  return render;
}
scopeSeg('#color-scope', () => colorAll, (all) => (colorAll = all));
scopeSeg(
  '#style-scope',
  () => styleAll,
  (all) => {
    styleAll = all;
    renderStyles();
  },
);

function setColor(c: string, doCommit: boolean) {
  for (const p of colorParts()) p.color = c;
  if (colorAll && doCommit && Object.keys(state.parts).length > 1) unlock('paint-all');
  creature.sync();
  creature.markMergeDirty();
  if (doCommit) {
    commit();
    renderColors();
  }
  renderParts();
}

function setStyle(id: StyleId) {
  if (!styleAll) {
    selPart().style = id;
  } else {
    state.style = id;
    for (const p of Object.values(state.parts)) delete p.style;
  }
  collect('materials', id);
  creature.sync();
  creature.markMergeDirty();
  commit();
  renderStyles();
  // which eye options apply depends on the material (ink on toon, varying on a textured one)
  renderEyes();
}

/**
 * A fresh copy of the skeleton a creature was started from: the current
 * template (or saved rig), so new creatures get its latest version. An edited
 * skeleton is kept as it is.
 */
function freshRig(rig: RigState): RigState {
  if (rig.base.startsWith('saved:')) return structuredClone(savedRigs().find((r) => r.base === rig.base) ?? rig);
  const t = RIGS.find((r) => r.id === rig.base);
  return t ? rigFromTemplate(t) : structuredClone(rig);
}

function switchRig(base: string) {
  const rig = base.startsWith('saved:') ? savedRigs().find((r) => r.base === base) : rigFromTemplate(getRig(base));
  if (!rig) return;
  // picking the plan it already has only does something if its skeleton is
  // out of date (made before the template changed)
  if (base === state.rig.base && JSON.stringify(rig.bones) === JSON.stringify(state.rig.bones)) return;
  if (base !== state.rig.base) unlock('body-plan');
  // no confirm: switching clears drawn shapes and pose, but it's one undo away
  const body = state.parts[creature.list[0].src].color;
  const next = defaultState(rig, body);
  // same spot in the scene, same name
  next.placement = state.placement;
  next.name = state.name;
  next.style = state.style;
  next.eyes = state.eyes;
  exitDraw();
  state = next;
  selected = '';
  buildCreature();
  commit();
  renderUI();
  frameCreature(true);
}

function setMode(m: Mode) {
  if (drawState) exitDraw();
  // leaving the workbench: keep what's on it (while it's still there to photograph)
  if (mode === 'stuff' && m !== 'stuff') saveWorkbenchNow();
  // the workbench's own backdrop and flat (ortho) view last only while it's open
  if ((mode === 'stuff') !== (m === 'stuff')) {
    paintBackdrop(m === 'stuff' ? STUFF_BACKDROP : backdrop);
    setOrtho(m === 'stuff' || sceneOrtho);
  }
  mode = m;
  if (m === ANIM_TAB) deselectAttachment();
  applyDof();
  if (m === 'look' || m === 'stuff') unlock(m);
  document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  placeModePill();
  tintMode();
  // Shape and Look are the same tools, each tab with its own layout (src/layout.ts)
  setLayoutTab(m === 'stuff' ? null : m);
  $('#stuff-panel').hidden = m !== 'stuff';
  $('#creature-bar').hidden = m === 'stuff';
  if (m === 'stuff') stopPlacing();
  if (m === 'stuff') deselectAttachment();
  if (m === 'stuff') $('#attach-pop').hidden = true;
  const wasStuff = board.visible;
  board.visible = m === 'stuff';
  for (const c of creatures) c.root.visible = m !== 'stuff';
  if (m === 'stuff') {
    syncWorkbench();
    renderStuffPanel();
    focusOnBoard();
    autosaveThing();
    hintOnce('Draw pieces on the board; the blue crosshair is where it attaches', 3200);
  } else if (wasStuff) {
    frameCreature();
  }
  updateSkeletonVisibility();
  syncIdle();
  refreshPieceGizmo();
  if (m !== 'stuff') renderRigPanel();
  if (m === 'shape') {
    if (idle) hintOnce('Click a part to begin!');
    else shapeTips();
  }
  if (m === 'look') hintOnce('Click a part, then pick its color and material', 2200);
}

/** The Color theme tints the panels by mode; a made tab by its own color. */
function tintMode() {
  const h = document.documentElement;
  const own = customTabs().find((t) => t.id === mode);
  h.dataset.mode = own ? 'custom' : mode;
  if (own) h.style.setProperty('--tab-color', own.color);
  else h.style.removeProperty('--tab-color');
}

// ---------------------------------------------------------------------------
// rig editing

/** Apply a skeleton edit, give new bones a look, rebuild, and select the first new bone. */
/** Give parts made by a rig edit their looks (and, for a split pair's right side, its own eyes). */
function applyPartCopies(copies: PartCopy[], copyShape: boolean) {
  for (const c of copies) {
    const from = state.parts[c.from];
    if (from && !state.parts[c.to]) {
      const to: PartState = structuredClone(from);
      if (!copyShape) setPartShapes(to, []);
      state.parts[c.to] = to;
    }
    // eyes on a pair belonged to both sides; a split right side keeps its own,
    // facing the way they did (a right twin turned them the other way)
    const e = state.eyes;
    if (copyShape && c.to.endsWith('R') && c.from === c.to.slice(0, -1) + 'L' && !e.pairs.some((p) => p.bone === c.to)) {
      for (const p of e.pairs.filter((p) => p.bone === c.from)) e.pairs.push({ ...p, bone: c.to, turn: -(p.turn ?? e.turn ?? 0) || undefined });
    }
  }
}

function rigEdit(fn: (rig: RigState) => PartCopy[], copyShape: boolean) {
  const copies = fn(state.rig);
  applyPartCopies(copies, copyShape);
  // an edited skeleton is no longer the saved/template one
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  // stuff on removed bones goes with them
  if (state.attachments) state.attachments = state.attachments.filter((a) => creature.bones.has(a.bone));
  if (copies.length) selected = copies[0].to;
  creature.select(selected);
  commit();
  renderUI();
}

function renderRigPanel() {
  const b = creature.bones.get(selected);
  const title = $<HTMLInputElement>('#rig-title');
  // a pair shares one name; the (L)/(R) is added on display
  if (document.activeElement !== title) title.value = b ? (state.rig.bones.find((d) => d.id === b.def.baseId)?.name ?? b.def.name) : '';
  title.disabled = !b;
  const isRoot = !b?.parent;
  const paired = !!b && b.def.sideSign !== 0;
  $<HTMLButtonElement>('#rig-dup').disabled = !b || isRoot;
  $<HTMLButtonElement>('#rig-del').disabled = !b || isRoot;
  // beside Mirror, on a mirrored pair (a one-sided part gets Mirror part there instead)
  const unlink = $<HTMLButtonElement>('#rig-unlink');
  unlink.hidden = !paired || idle;
  unlink.disabled = rigLocked();
  unlink.title = rigLocked() ? 'Turn Mirror off to unlink this pair' : 'Let the left and right sides be shaped separately';
  // a part with nothing on the other side can be mirrored (or re-linked, if it was unlinked)
  const lone = b && !idle ? mirrorTarget(state.rig, selected) : null;
  const mirrorBtn = $<HTMLButtonElement>('#rig-mirror');
  mirrorBtn.hidden = !lone;
  if (lone) {
    iconLabel(mirrorBtn, faClassic(lone.other ? 'link' : 'clone'), lone.other ? 'Re-link' : 'Mirror part');
    mirrorBtn.title = lone.other
      ? 'Join this side back up with the other: the other side becomes its mirror image again'
      : 'Copy this part onto the other side, as a mirrored pair';
  }
  $('#rig-attach').hidden = !b || idle;
  $<HTMLButtonElement>('#rig-split').disabled = !b;
  // a part on its parent's tip can come off it; one that's off can go back
  const detach = $<HTMLButtonElement>('#rig-detach');
  const loose = !!b && b.attach;
  iconLabel(detach, faClassic(loose ? 'link' : 'link-slash'), loose ? 'Reattach' : 'Detach');
  detach.title = isRoot
    ? 'The first part holds everything else, so it has nothing to come off'
    : loose
      ? 'Snap the base of this part back onto the tip of the part it hangs off'
      : 'Unhook this part from the tip it grew from, so its base can slide anywhere';
  detach.disabled = !b || isRoot;
  // the part it hangs off, and (with Auto parent off) a way to pick another
  $<HTMLInputElement>('#auto-parent').checked = rigPrefs.autoParent;
  $('#parent-name').textContent = b?.parent ? `Hangs off ${b.parent.def.name}` : b ? 'The first part: everything hangs off it' : '';
  const setP = $<HTMLButtonElement>('#set-parent');
  setP.hidden = rigPrefs.autoParent;
  setP.disabled = !b || isRoot;
  if (pickingParent && (!b || isRoot)) setPickingParent(false);
  $('#rig-pair-note').textContent = paired ? 'Mirrored pair: both sides move together.' : '';
  $<HTMLInputElement>('#rig-sym').checked = rigLocked();
  $<HTMLInputElement>('#keep-floor').checked = state.keepFloor !== false;
  $('#mirror-pill').classList.toggle('on', rigLocked());
  if (b) {
    $<HTMLInputElement>('#rig-w0').value = String(b.def.width);
    $<HTMLInputElement>('#rig-w1').value = String(b.def.widthEnd ?? b.def.width);
    // a drawn shape sets its own widths: these only count again after Reset shape
    const drawn = !!state.parts[b.src]?.outline;
    for (const w of ['w0', 'w1']) {
      $<HTMLInputElement>(`#rig-${w}`).disabled = drawn;
      $(`#rig-${w}-row`).classList.toggle('off', drawn);
      $(`#rig-${w}-row`).title = drawn ? 'This part has a drawing, which sets its own widths. Reset shape to use these.' : '';
    }
  }

  const list = $('#saved-rig-list');
  list.innerHTML = '';
  for (const r of savedRigs()) {
    const row = document.createElement('div');
    row.className = 'saved-rig';
    const load = document.createElement('button');
    load.className = 'ghost';
    iconLabel(load, faClassic('bone'), r.name);
    load.onclick = () => switchRig(r.base);
    const del = document.createElement('button');
    del.className = 'ghost';
    del.innerHTML = fa('xmark');
    del.title = 'Delete saved rig';
    del.onclick = () => {
      if (!confirm(`Delete the saved rig "${r.name}"?`)) return;
      deleteSavedRig(r.name);
      renderRigPanel();
      renderRigs();
    };
    row.append(load, del);
    list.append(row);
  }
  if (!list.children.length) list.innerHTML = '<p class="muted small">No saved rigs yet.</p>';
}

$('#rig-bone').onclick = () => {
  rigEdit((rig) => addLimb(rig, selected, rigLocked(), 1), false);
  unlock('limb');
};
$('#rig-split').onclick = () => {
  const r = splitBone(state.rig, selected);
  if (!r) {
    hint('This bone is too short to split', 1800, true);
    return;
  }
  unlock('split');
  // cut any drawing in two at the split so each half keeps its piece
  for (const [lo, hi] of r.pairs) {
    const p = state.parts[lo];
    if (!p) continue; // right twins share the left's drawing
    const upper: PartState = structuredClone(p);
    // every shape is cut at the same height (side drawings run along the bone too)
    const shapes = partShapes(p);
    const below = shapes.flatMap((sh) => {
      const l = clipLoop(sh.outline, r.at, 'below');
      return l ? [{ ...sh, outline: l.map(([x, y]) => [x, y * (r.lowScale ?? 1)] as Vec2) }] : [];
    });
    const above = shapes.flatMap((sh) => {
      const l = clipLoop(sh.outline, r.at, 'above');
      return l ? [{ ...sh, outline: l.map(([x, y]) => [x, (y - r.at) * (r.highScale ?? 1)] as Vec2) }] : [];
    });
    setPartShapes(p, below);
    setPartShapes(upper, above);
    state.parts[hi] = upper;
  }
  rigEdit(() => [], false);
  hint('Split into two jointed halves', 1800);
};

// ---- lock symmetry (remembered) ----
const RIG_PREFS_KEY = 'creature-creator/rig-prefs';
const rigPrefs: { lock: boolean; autoParent: boolean } = (() => {
  try {
    return { lock: true, autoParent: true, ...JSON.parse(localStorage.getItem(RIG_PREFS_KEY) ?? '{}') };
  } catch {
    return { lock: true, autoParent: true };
  }
})();
let rigLock = rigPrefs.lock;
function rigLocked() {
  return rigLock;
}
function saveRigPrefs() {
  try {
    localStorage.setItem(RIG_PREFS_KEY, JSON.stringify({ ...rigPrefs, lock: rigLock }));
  } catch {
    /* ignore */
  }
}
function setMirror(on: boolean) {
  rigLock = on;
  saveRigPrefs();
  renderRigPanel();
  hint(rigLock ? 'Mirror on: both sides bend, stretch and grow together' : 'Mirror off: each side on its own', 2000);
}
$<HTMLInputElement>('#ik').onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked;
  $('#ik-pill').classList.toggle('on', on);
  hint(on ? 'Pull limbs on: dragging a hand bends the elbow and shoulder too' : 'Pull limbs off: dragging bends just that joint', 2000);
};
$<HTMLInputElement>('#rig-sym').onchange = (e) => setMirror((e.target as HTMLInputElement).checked);

// ---- which part each part hangs off (its parent) ----
/** Each part's real size, from its drawing (or default shape): see PartSizes. */
function sizesIn(c: Creature): PartSizes {
  // each drawing is read once: how wide it is at evenly spaced heights along it
  const STEPS = 24;
  const profiles = new Map<string, { lo: number; hi: number; len: number; w: number[] } | null>();
  const profile = (id: string) => {
    const b = c.bones.get(id);
    if (!b) return null;
    if (profiles.has(b.src)) return profiles.get(b.src)!;
    const shapes = c.shapesFor(b);
    let lo = Infinity, hi = -Infinity;
    for (const sh of shapes) for (const [, y] of sh.outline) (lo = Math.min(lo, y)), (hi = Math.max(hi, y));
    let p: { lo: number; hi: number; len: number; w: number[] } | null = null;
    if (lo < hi) {
      const w = new Array(STEPS + 1).fill(0);
      for (const sh of shapes) {
        const o = sh.outline;
        for (let i = 0; i < o.length; i++) {
          const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length];
          // every height this edge crosses
          const a = Math.ceil(((Math.min(y0, y1) - lo) / (hi - lo)) * STEPS), z = Math.floor(((Math.max(y0, y1) - lo) / (hi - lo)) * STEPS);
          for (let k = Math.max(0, a); k <= Math.min(STEPS, z); k++) {
            const y = lo + ((hi - lo) * k) / STEPS;
            const x = y1 === y0 ? Math.max(Math.abs(x0), Math.abs(x1)) : Math.abs(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
            w[k] = Math.max(w[k], x);
          }
        }
      }
      p = { lo, hi, len: b.length, w };
    }
    profiles.set(b.src, p);
    return p;
  };
  return {
    profile(id) {
      const p = profile(id);
      return p ? { from: p.lo / p.len, to: p.hi / p.len, w: p.w } : undefined;
    },
    at: (id) => c.posedEnds(id),
  };
}
/**
 * Parts in `rig` just given new parents, still built in `c` on their old ones:
 * move each (and everything on it) so it stays exactly where it is, posed.
 */
function rehang(c: Creature, rig: RigState, ids: string[]) {
  const bones = expandRig(rig).bones;
  const moves = ids.map((id) => {
    const to = bones.find((b) => b.id === id)?.parent;
    return [id, to ? c.rehangMove(id, to) : null] as const;
  });
  for (const [id, m] of moves) if (m) moveLimb(rig, id, m);
}
const sceneName = (rig: RigState, id: string) => expandRig(rig).bones.find((b) => b.id === id)?.name ?? id;
let pickingParent = false;
function setPickingParent(on: boolean) {
  pickingParent = on;
  $('#set-parent').classList.toggle('on', on);
  $('#viewport').style.cursor = on ? 'crosshair' : '';
  if (on) hint('Click the part this one should hang off', 0);
  else hint('');
}
/** Set parent: the picked part hangs off the part clicked. */
function parentAt(x: number, y: number) {
  const target = pickPart(x, y);
  const id = selected;
  if (!target || !creature.bones.get(id)?.parent) return setPickingParent(false);
  pickingParent = false;
  $('#set-parent').classList.remove('on');
  $('#viewport').style.cursor = '';
  if (!canParent(state.rig, id, target)) {
    hint(target === id ? "A part can't hang off itself" : "That part hangs off this one, so it can't be its parent", 2200, true);
    return;
  }
  const name = (state.rig.bones.find((d) => d.id === creature.bones.get(id)!.def.baseId)?.name ?? '').replace(/ \((L|R)\)$/, '');
  if (!setParent(state.rig, id, target)) {
    hint(`${name} already hangs off ${sceneName(state.rig, target)}`, 1800);
    return;
  }
  // it stays just where it is: a pair is moved by its left twin
  const own = creature.bones.get(id)!.def;
  rehang(creature, state.rig, [own.sideSign === -1 ? own.baseId + 'L' : id]);
  rigEdit(() => [], false);
  const b = creature.bones.get(id);
  hint(`${name} now hangs off ${b?.parent ? sceneName(state.rig, b.parent.def.id) : sceneName(state.rig, target)}`, 2200);
}
$<HTMLInputElement>('#auto-parent').onchange = (e) => {
  rigPrefs.autoParent = (e.target as HTMLInputElement).checked;
  saveRigPrefs();
  if (rigPrefs.autoParent && pickingParent) setPickingParent(false);
  if (rigPrefs.autoParent) {
    // straight away, every part, for any left on the wrong part while it was off
    const rig = JSON.stringify(state.rig);
    parentsChecked.delete(state);
    buildCreature();
    if (JSON.stringify(state.rig) !== rig) commit();
  }
  renderRigPanel();
  hint(rigPrefs.autoParent ? 'Auto parent on: a part hangs off whatever its base sits on' : 'Auto parent off: use Set parent to choose', 2200);
};
$('#set-parent').onclick = () => setPickingParent(!pickingParent);

// ---- per-bone default-shape widths and bend, applied live ----
let boneEditPending = false;
function editBone(fn: (d: BoneDef) => void) {
  const b = creature.bones.get(selected);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!def) return;
  fn(def);
  if (boneEditPending) return;
  boneEditPending = true;
  requestAnimationFrame(() => {
    boneEditPending = false;
    // re-seat bones (bends move children) and rebuild the affected parts
    creature.relayout(state.rig);
    creature.sync();
  });
}
function commitBoneEdit() {
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  commit();
  renderRigPanel();
}
const round3n = (v: string) => Math.round(parseFloat(v) * 1000) / 1000;
$<HTMLInputElement>('#rig-w0').oninput = (e) => editBone((d) => (d.width = round3n((e.target as HTMLInputElement).value)));
$<HTMLInputElement>('#rig-w1').oninput = (e) => editBone((d) => (d.widthEnd = round3n((e.target as HTMLInputElement).value)));
for (const id of ['#rig-w0', '#rig-w1']) $<HTMLInputElement>(id).onchange = () => commitBoneEdit();
// ---- naming a bone ----
function renameBone(commitIt: boolean) {
  const b = creature.bones.get(selected);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  const name = $<HTMLInputElement>('#rig-title').value.trim();
  if (!def || !name) return;
  def.name = name;
  // re-seat so the bones pick up the new name (it's shown on every part list)
  creature.relayout(state.rig);
  renderParts();
  if (commitIt) {
    commit();
    renderUI();
  }
}
$<HTMLInputElement>('#rig-title').oninput = () => renameBone(false);
$<HTMLInputElement>('#rig-title').onchange = () => renameBone(true);
$<HTMLInputElement>('#rig-title').onkeydown = (e) => {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
};

$('#rig-extend').onclick = () => rigEdit((rig) => extendBone(rig, selected), false);
$('#rig-detach').onclick = () => {
  if (!creature.bones.get(selected)?.parent) return;
  const loose = creature.bones.get(selected)!.attach;
  rigEdit((rig) => (loose ? reattachBone : detachBone)(rig, selected), false);
  hint(loose ? 'Back on the tip' : 'Detached: drag the purple grip at its base to move it', 2200);
};
$('#rig-dup').onclick = () => rigEdit((rig) => duplicateLimb(rig, selected), true);
$('#rig-unlink').onclick = () => rigEdit((rig) => unlinkPair(rig, selected), true);
/**
 * Give a one-sided part a mirror image on the other side, as a linked pair. Half
 * of an unlinked pair is re-linked instead: the other half becomes its mirror image.
 */
function mirrorPart() {
  const r = mirrorLimb(state.rig, selected);
  if (!r) return;
  const relink = r.removed.length > 0;
  const parts = state.parts, pose = state.pose;
  const oldParts = { ...parts }, oldPose = { ...pose };
  const gone = new Set([...r.removed, ...r.renamed.map(([from]) => from)]);
  for (const id of gone) {
    delete parts[id];
    delete pose[id];
  }
  const to = new Map(r.renamed);
  // a pair keeps one drawing, under its left twin's id
  const left = (id: string) => id.slice(0, -1) + 'L';
  for (const [from, id] of r.renamed) {
    if (oldParts[from]) parts[left(id)] = oldParts[from];
    if (oldPose[from]) pose[id] = oldPose[from];
  }
  // eyes on the replaced side go with it; this side's now sit on both
  const e = state.eyes;
  e.pairs = e.pairs.filter((p) => !p.bone || !r.removed.includes(p.bone));
  for (const p of e.pairs) {
    const id = p.bone && to.get(p.bone);
    if (!id) continue;
    p.bone = left(id);
    // stored for the left twin, which faces the other way round
    if (r.flipped && p.turn) p.turn = -p.turn;
  }
  if (state.attachments) {
    state.attachments = state.attachments.filter((a) => !r.removed.includes(a.bone));
    for (const a of state.attachments) {
      const id = to.get(a.bone);
      if (id) (a.bone = id), (a.mirror = true);
    }
  }
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  selected = to.get(selected) ?? r.renamed[0][1];
  buildCreature();
  // the new side takes this side's pose
  creature.mirrorPose(r.renamed.map(([, id]) => creature.bones.get(id)!).filter(Boolean));
  creature.capturePose();
  creature.applyPose();
  commit();
  renderUI();
  hint(relink ? 'Linked again: the other side is its mirror image' : 'Mirrored onto the other side', 2000);
}
$('#rig-mirror').onclick = () => mirrorPart();

$('#rig-del').onclick = () => removePart();
/** Delete the picked part and everything on it (the creature's root part stays). */
function removePart() {
  if (!creature.bones.get(selected)?.parent) {
    hint("The first part holds everything else, so it can't be removed", 2000, true);
    return;
  }
  const parent = creature.bones.get(selected)?.parent?.def.id ?? '';
  rigEdit((rig) => {
    for (const d of deleteLimb(rig, selected)) {
      for (const id of partIds(d)) {
        delete state.parts[id];
        delete state.pose[id];
      }
    }
    return [];
  }, false);
  selectPart(creature.bones.has(parent) ? parent : creature.list[0].def.id);
}
$('#eyes-add').onclick = () => {
  const b = creature.bones.get(selected);
  if (!b) return;
  const e = state.eyes;
  // a limb (one of a mirrored pair, or a stalk) gets a single eye near its tip; a head gets a pair
  const limb = b.def.sideSign !== 0 || b.length > 1.6 * b.def.width;
  e.pairs.push({ size: 0.5, spacing: 0.5, height: limb ? 0.8 : 0.55, bone: b.src, single: limb || undefined });
  e.enabled = true;
  creature.sync();
  commit();
  showEyes(e.pairs.length - 1);
  hint(limb ? 'Eye added' : 'Eyes added', 1400);
};
$('#rig-save').onclick = () => {
  const input = $<HTMLInputElement>('#rig-name');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    hint('Give the rig a name first', 1800, true);
    return;
  }
  saveRig(state.rig, name);
  unlock('rig-save');
  state.rig.base = 'saved:' + name;
  state.rig.name = name;
  input.value = '';
  commit();
  renderRigs();
  renderRigPanel();
  hint(`Saved rig "${name}"`, 1800);
};

/** How much longer than asked a timed hint stays up, so there's time to read it. */
const HINT_EXTRA_MS = 4500;
const hintEl = $('#hint');
const hintRing = hintEl.querySelector<SVGCircleElement>('.hint-ring .fill')!;
function closeHint() {
  if (drawState) drawHint();
  else hintEl.classList.remove('show');
}
// the ring filling up is the timer: hovering pauses it (CSS), so the hint
// stays while it's being read; the x closes it
hintRing.addEventListener('animationend', () => closeHint());
hintEl.querySelector<HTMLButtonElement>('.hint-close')!.onclick = () => {
  hintEl.classList.remove('show');
};

/** Guidance shown since the page loaded: each tip is shown once a session (a reload brings them back). */
const hintsShown = new Set<string>();
/** A how-to tip, shown only the first time it comes up. Feedback on what was just done uses hint(). */
function hintOnce(text: string, ms = 2000) {
  if (hintsShown.has(text)) return;
  hintsShown.add(text);
  hint(text, ms);
}

/** A message at the bottom of the view; `ms` 0 keeps it up until replaced (drawing instructions). */
function hint(text: string, ms = 2000, warn = false) {
  // fingers tap
  if (touchScreen()) text = text.replace(/([Cc])lick(ing|ed)?/g, (_, c: string, end = '') => (c === 'C' ? 'T' : 't') + 'ap' + (end && 'p' + end));
  hintEl.querySelector('.hint-text')!.textContent = text;
  hintEl.classList.toggle('show', !!text);
  hintEl.classList.toggle('warn', warn);
  const timed = !!text && ms > 0;
  hintEl.classList.toggle('timed', timed);
  // restart the ring for this message
  hintRing.style.animation = 'none';
  void hintRing.getBoundingClientRect();
  hintRing.style.animation = '';
  if (timed) hintEl.style.setProperty('--hint-ms', `${ms + HINT_EXTRA_MS}ms`);
}

// ---------------------------------------------------------------------------
// settings (remembered in this browser)

const SETTINGS_KEY = 'creature-creator/settings';
type Theme = 'light' | 'dark' | 'color';
const settings: { numbers: boolean; plainText: boolean; theme: Theme; seamless: SeamlessMode; seamlessLowPoly: boolean; quality: Quality } = (() => {
  const defaults = { numbers: false, plainText: false, theme: 'light' as Theme, seamless: 'on' as SeamlessMode, seamlessLowPoly: false, quality };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
})();
setSeamlessMode(settings.seamless);
setSeamlessLowPoly(settings.seamlessLowPoly);

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function renderSettings() {
  document.body.classList.toggle('show-nums', settings.numbers);
  $<HTMLInputElement>('#set-nums').checked = settings.numbers;
  document.documentElement.classList.toggle('plain-text', settings.plainText);
  $<HTMLInputElement>('#set-plain').checked = settings.plainText;
  for (const t of ['dark', 'color']) document.documentElement.classList.toggle(`theme-${t}`, settings.theme === t);
  document.querySelectorAll<HTMLButtonElement>('#set-theme button').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
  // the browser's own bar (phones, installed app) matches the page
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  document.querySelectorAll<HTMLButtonElement>('#set-seamless button').forEach((b) => b.classList.toggle('active', b.dataset.seamless === settings.seamless));
  $<HTMLInputElement>('#set-seamless-lp').checked = settings.seamlessLowPoly;
  // nothing to apply it to while seamless joins are off
  $<HTMLInputElement>('#set-seamless-lp').disabled = settings.seamless === 'off';
  $('#set-seamless-lp-row').style.opacity = settings.seamless === 'off' ? '.45' : '1';
  document.querySelectorAll<HTMLButtonElement>('#set-quality button').forEach((b) => b.classList.toggle('active', b.dataset.quality === quality));
  if (settings.numbers) syncSliderNumbers();
}

/**
 * With "Show numbers" on, every slider has a number box beside it. Material
 * sliders make their own (marked `own`: they take values past the slider's
 * ends, so they aren't overwritten from it); the rest are added here and kept
 * in step with their slider.
 */
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;

/**
 * Let a slider hold a value past its ends (typed into its number box, or put
 * back from a saved value): it shows pinned at the end but reads back the real
 * number, so every handler that reads `.value` just works. Touching the slider
 * itself goes back to its own range.
 */
function unlimited(range: HTMLInputElement) {
  if (range.dataset.unlimited) return;
  range.dataset.unlimited = '1';
  let over: string | null = null;
  Object.defineProperty(range, 'value', {
    configurable: true,
    get: () => over ?? (nativeValue.get!.call(range) as string),
    set: (v: string) => {
      nativeValue.set!.call(range, v);
      const n = parseFloat(v);
      over = Number.isFinite(n) && (n < parseFloat(range.min) || n > parseFloat(range.max)) ? String(v) : null;
    },
  });
  const drop = () => (over = null);
  range.addEventListener('pointerdown', drop);
  range.addEventListener('keydown', drop);
}

function syncSliderNumbers() {
  document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((range) => {
    let num = range.nextElementSibling as HTMLInputElement | null;
    if (!num?.classList.contains('num')) {
      unlimited(range);
      const box = document.createElement('input');
      box.type = 'number';
      box.className = 'num';
      box.oninput = () => {
        if (!Number.isFinite(parseFloat(box.value))) return;
        // past either end, the slider pins there but keeps the typed value
        range.value = box.value;
        range.dispatchEvent(new Event('input', { bubbles: true }));
      };

      box.onchange = () => range.dispatchEvent(new Event('change', { bubbles: true }));
      range.after(box);
      num = box;
    }
    if (num.dataset.own || document.activeElement === num) return;
    num.step = range.step;
    const decimals = (range.step.split('.')[1] ?? '').length;
    const text = Number(range.value).toFixed(decimals);
    if (num.value !== text) num.value = text;
  });
}

$('#settings-btn').onclick = () => {
  if (togglePopover('#settings-pop')) renderSettings();
};

// ---- keyboard shortcut sheet ----

function openShortcutSheet() {
  closeTopPopovers();
  closeAttachPops();
  $('#keys-pop').hidden = false;
  renderShortcutSheet($('#keys-list'));
  $('#keys-reset').hidden = !hasCustomShortcuts();
}
function closeShortcutSheet() {
  stopListening();
  $('#keys-pop').hidden = true;
}
function toggleShortcutSheet() {
  if ($('#keys-pop').hidden) openShortcutSheet();
  else closeShortcutSheet();
}
$('#set-keys').onclick = () => openShortcutSheet();
$('#keys-close').onclick = () => closeShortcutSheet();
$('#keys-reset').onclick = () => {
  resetShortcuts();
  shortcutsChanged();
  renderShortcutSheet($('#keys-list'), 'Every key is back to how it started.');
};
/** A key changed: tooltips, key labels and the hints that name keys. */
function shortcutsChanged() {
  labelShortcuts();
  $('#keys-reset').hidden = !hasCustomShortcuts();
  syncDrawBar();
  drawHint();
}
labelShortcuts();
$<HTMLInputElement>('#set-seamless-lp').onchange = (e) => {
  settings.seamlessLowPoly = (e.target as HTMLInputElement).checked;
  setSeamlessLowPoly(settings.seamlessLowPoly);
  // low-poly creatures build (or drop) their skins
  for (const c of creatures) c.markMergeDirty();
  saveSettings();
  renderSettings();
};
/** Switch performance level: renderer settings now, and every shape rebuilt at the new detail. */
function setQuality(q: Quality) {
  if (q === quality) return;
  quality = settings.quality = q;
  const Q = QUALITY[q];
  setMeshDetail(Q.detail);
  setFuzzQuality(Q.fuzz);
  renderer.transmissionResolutionScale = Q.glass;
  // a new shadow map size takes a fresh map
  key.shadow.mapSize.setScalar(Q.shadow);
  key.shadow.map?.dispose();
  key.shadow.map = null;
  renderer.shadowMap.needsUpdate = true;
  // anti-aliasing: the targets are rebuilt with the new sample count on next use
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    rt.samples = Q.samples;
    rt.dispose();
  }
  gtao.updateGtaoMaterial({ samples: Q.aoSamples });
  setAO(Q.ao);
  $<HTMLInputElement>('#ao').checked = Q.ao;
  resize();
  // every creature (and the workbench) remeshed at the new detail
  exitDraw();
  stopPlacing();
  for (let i = 0; i < creatures.length; i++) {
    creatures[i].dispose();
    creatures[i] = makeCreature(world.creatures[i]);
  }
  creature = undefined as unknown as Creature; // replaced wholesale
  activate(world.active);
  benchKey = '';
  syncWorkbench();
  fitShadows();
  saveSettings();
  renderSettings();
  renderUI();
}
document.querySelectorAll<HTMLButtonElement>('#set-quality button').forEach((b) => {
  b.onclick = () => setQuality(b.dataset.quality as Quality);
});

$<HTMLInputElement>('#set-nums').onchange = (e) => {

  settings.numbers = (e.target as HTMLInputElement).checked;
  saveSettings();
  renderSettings();
};
document.querySelectorAll<HTMLButtonElement>('#set-theme button').forEach((b) => {
  b.onclick = () => {
    settings.theme = b.dataset.theme as Theme;
    saveSettings();
    renderSettings();
  };
});
$<HTMLInputElement>('#set-plain').onchange = (e) => {
  settings.plainText = (e.target as HTMLInputElement).checked;
  saveSettings();
  renderSettings();
  // the other font has other widths (and may still be loading)
  fitTopbar();
  document.fonts.ready.then(fitTopbar);
};
document.querySelectorAll<HTMLButtonElement>('#set-seamless button').forEach((b) => {
  b.onclick = () => {
    settings.seamless = b.dataset.seamless as SeamlessMode;
    setSeamlessMode(settings.seamless);
    // each creature drops (or goes on to build) its skin
    for (const c of creatures) c.markMergeDirty();
    saveSettings();
    renderSettings();
    renderMerge();
  };
});

// wire up static controls
// (one listener for them all: tabs people make come and go)
$('.modes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
  if (b) setMode(b.dataset.mode as Mode);
});

/** Drops the top bar's button labels whenever they'd overflow it (narrow window or zoomed in). */
function fitTopbar() {
  const bar = $('.topbar');
  bar.classList.remove('compact');
  // on a phone the tools scroll rather than overflow the bar
  const tools = $('.topbar .tools');
  bar.classList.toggle('compact', bar.scrollWidth > bar.clientWidth || tools.scrollWidth > tools.clientWidth);
}
new ResizeObserver(fitTopbar).observe($('.topbar'));
/** The Shape / Look / Stuff switch has one pill that slides under whichever is picked. */
function placeModePill() {
  const modes = $('.modes');
  const on = modes.querySelector<HTMLElement>('button.active');
  if (!on) return;
  modes.style.setProperty('--pill-x', `${on.offsetLeft}px`);
  modes.style.setProperty('--pill-w', `${on.offsetWidth}px`);
}
// labels dropping (compact) or the font loading change the widths
new ResizeObserver(placeModePill).observe($('.modes'));
document.fonts.ready.then(placeModePill);
// only slide once it has found its first spot
requestAnimationFrame(() => requestAnimationFrame(() => $('.modes').classList.add('slide')));
document.fonts.ready.then(fitTopbar); // the icon font and the text font change the buttons' widths
installScrollbars();
installCursorPress();
initLayout({
  onGizmos: updateSkeletonVisibility,
  // a tab made, renamed or deleted: the bar's widths changed (and maybe the open tab's color)
  onTabs: () => {
    fitTopbar();
    placeModePill();
    tintMode();
  },
  switchTo: (t) => setMode(t),
});

// On a phone the panel is a sheet under the viewport: drag its grip to resize it, tap to fold it away.
const SHEET_KEY = 'creature-creator/sheet';
{
  const app = $('#app');
  const grip = $<HTMLButtonElement>('#sheet-grip');
  const MIN_VIEW = 140; // always leave this much of the viewport
  let open = 0.42; // share of the window the open sheet takes
  let folded = false;
  try {
    const s = JSON.parse(localStorage.getItem(SHEET_KEY) ?? '{}');
    if (typeof s.open === 'number') open = s.open;
    folded = !!s.folded;
  } catch {}
  const apply = () => {
    const max = Math.max(0, app.clientHeight - 48 - grip.offsetHeight - MIN_VIEW);
    const px = folded ? 0 : Math.min(max, Math.max(80, open * app.clientHeight));
    app.style.setProperty('--sheet', `${Math.round(px)}px`);
  };
  const store = () => {
    try {
      localStorage.setItem(SHEET_KEY, JSON.stringify({ open, folded }));
    } catch {}
  };
  let drag: { y: number; px: number; moved: boolean } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, px: $('.panel').offsetHeight, moved: false };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const px = drag.px + dy;
    // drag it most of the way down and it folds away
    folded = px < 60;
    if (!folded) open = px / app.clientHeight;
    apply();
  });
  grip.addEventListener('pointerup', () => {
    if (drag && !drag.moved) folded = !folded;
    drag = null;
    apply();
    store();
  });
  grip.addEventListener('pointercancel', () => (drag = null));
  // picking a mode means wanting to see its panel
  $('.modes').addEventListener('click', (e) => {
    if (!folded || !(e.target as HTMLElement).closest('button[data-mode]')) return;
    folded = false;
    apply();
    store();
  });
  new ResizeObserver(apply).observe(app);
}
$('#draw').onclick = () => enterDraw({ kind: 'bone', boneId: selected });
$('#cancel-draw').onclick = () => exitDraw();
$('#reset-shape').onclick = () => {
  setPartShapes(selPart(), []);
  creature.sync();
  commit();
  renderUI();
};

document.querySelectorAll<HTMLButtonElement>('#part-kind button').forEach((b) => {
  b.onclick = () => {
    const p = selPart();
    const kind = b.dataset.kind as PartKind;
    if ((p.kind ?? 'puffy') === kind) return;
    if (kind === 'puffy') delete p.kind;
    else p.kind = kind;
    creature.sync();
    commit();
    renderUI();
  };
});

let thicknessPending = false;
$<HTMLInputElement>('#thickness').oninput = (e) => {
  selPart().thickness = parseFloat((e.target as HTMLInputElement).value);
  if (thicknessPending) return;
  thicknessPending = true;
  requestAnimationFrame(() => {
    thicknessPending = false;
    creature.sync();
  });
};
$<HTMLInputElement>('#thickness').onchange = () => {
  creature.sync();
  commit();
};

$<HTMLInputElement>('#color').oninput = (e) => setColor((e.target as HTMLInputElement).value, false);
$<HTMLInputElement>('#color').onchange = (e) => setColor((e.target as HTMLInputElement).value, true);

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
function renderBackdropUI() {
  renderBackdrops();
  renderFloorUI();
  $<HTMLInputElement>('#light-turn').value = String(lightTurn);
}
$<HTMLInputElement>('#light-turn').oninput = (e) => {
  lightTurn = parseFloat((e.target as HTMLInputElement).value);
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
// ---------------------------------------------------------------------------
// depth of field: focus follows the orbit target, nudged by `offset`

const DOF_KEY = 'creature-creator/dof';
const dof: { enabled: boolean; offset: number; blur: number } = (() => {
  try {
    return { enabled: false, offset: 0, blur: 0.35, ...JSON.parse(localStorage.getItem(DOF_KEY) ?? '{}') };
  } catch {
    return { enabled: false, offset: 0, blur: 0.35 };
  }
})();
let pickingFocus = false;
let focusMarkerUntil = 0;

// a ring floating on the focus plane, shown briefly while focus changes
const focusMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.2, 0.215, 64),
  new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8, depthTest: false }),
);
focusMarker.renderOrder = 1001;
focusMarker.visible = false;
scene.add(focusMarker);

function saveDof() {
  try {
    localStorage.setItem(DOF_KEY, JSON.stringify(dof));
  } catch {
    /* ignore */
  }
}

function focusDistance() {
  return Math.max(0.2, camera.position.distanceTo(controls.target) + dof.offset);
}

function applyDof() {
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
function focusAt(x: number, y: number) {
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

function renderMerge() {
  const on = state.merge ?? true;
  $<HTMLInputElement>('#merge-radius').value = String(on ? (state.mergeRadius ?? 0.1) : 0);
  $<HTMLInputElement>('#color-blend').value = String(state.mergeColors ? (state.colorBlend ?? 0.12) : 0);
  // colors only blend where parts blend
  $('#color-blend-row').classList.toggle('off', !on);
  // None is per creature, only when Settings leaves it to each creature; the
  // rest also shape the quick joins, so they're there even with seamless joins off
  const perCreature = settings.seamless === 'creature';
  const shown = perCreature && state.seamless === false ? 'none' : blendWithOf(state);
  $('#seamless-note').textContent = settings.seamless === 'off' ? '(off in Settings: picks what the quick joins blend)' : '(smooths blended parts when idle)';
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

for (const k of ['size', 'spacing', 'height'] as const) {
  const input = $<HTMLInputElement>(`#eye-${k}`);
  input.oninput = () => {
    state.eyes.pairs[eyePair][k] = parseFloat(input.value);
    creature.sync();
  };
  input.onchange = () => commit();
}

const EYE_SWATCHES = ['#1d1a22', '#2a2730', '#3b2a20', '#1f3a5a', '#2f5d3a', '#6a1f2a', '#8a6d3b', '#f4f1ea'];

function setEyeLook(fn: (e: CreatureState['eyes']) => void) {
  fn(state.eyes);
  creature.sync();
  commit();
  renderEyes();
}
for (const [id, key] of [['#eye-shine', 'shine'], ['#eye-pupil', 'pupil'], ['#eye-look-x', 'lookX'], ['#eye-look-y', 'lookY'], ['#eye-cross', 'cross'], ['#eye-lid-top', 'lidTop'], ['#eye-lid-bottom', 'lidBottom'], ['#eye-crescent', 'crescent'], ['#eye-tilt', 'tilt']] as const) {
  const input = $<HTMLInputElement>(id);
  input.oninput = () => {
    state.eyes[key] = parseFloat(input.value);
    creature.sync();
  };
  input.onchange = () => commit();
}
$('#eye-shape-reset').onclick = () =>
  setEyeLook((e) => {
    delete e.lidTop;
    delete e.lidBottom;
    delete e.crescent;
    delete e.tilt;
  });
$<HTMLInputElement>('#eye-ink').onchange = (ev) =>
  setEyeLook((e) => {
    if ((ev.target as HTMLInputElement).checked) e.ink = true;
    else delete e.ink;
  });
$<HTMLInputElement>('#eye-vary').onchange = (ev) =>
  setEyeLook((e) => {
    if ((ev.target as HTMLInputElement).checked) delete e.vary;
    else e.vary = false;
  });
document.querySelectorAll<HTMLButtonElement>('#eye-finish button').forEach((b) => {
  b.onclick = () => setEyeLook((e) => (e.finish = b.dataset.finish as EyeFinish));
});
const eyeGlowFollow = glowFollowSeg(
  '#eye-glow-follow',
  () => state.eyes,
  (f) =>
    setEyeLook((e) => {
      if (f) e.glowFollow = f;
      else delete e.glowFollow;
    }),
);
const eyeSceneColors = sceneColorRow($('#eye-scene-colors'), () => state.eyes.color, (c) => setEyeLook((x) => (x.color = c)));
glowSlider(
  '#eye-glow',
  (v) => {
    if (v > 0) state.eyes.glow = v;
    else delete state.eyes.glow;
    creature.sync();
    eyeGlowFollow();
  },
  () => commit(),
);
$<HTMLInputElement>('#eye-color').oninput = (ev) => {
  state.eyes.color = (ev.target as HTMLInputElement).value;
  creature.sync();
};
$<HTMLInputElement>('#eye-color').onchange = () => {
  commit();
  renderEyes();
};
$<HTMLInputElement>('#eye-lift').oninput = (ev) => {
  state.eyes.pairs[eyePair].lift = parseFloat((ev.target as HTMLInputElement).value);
  creature.sync();
};
$<HTMLInputElement>('#eye-lift').onchange = () => commit();
$<HTMLInputElement>('#eye-single').onchange = (ev) => {
  const pair = state.eyes.pairs[eyePair];
  if ((ev.target as HTMLInputElement).checked) pair.single = true;
  else delete pair.single;
  creature.sync();
  commit();
  renderEyes();
};
$<HTMLInputElement>('#eye-turn').oninput = (ev) => {
  state.eyes.pairs[eyePair].turn = Math.round(parseFloat((ev.target as HTMLInputElement).value) * (Math.PI / 180) * 1000) / 1000;
  creature.sync();
};
$<HTMLInputElement>('#eye-turn').onchange = () => commit();
$('#eye-unplace').onclick = () => {
  const pair = state.eyes.pairs[eyePair];
  if (!pair) return;
  delete pair.at;
  delete pair.n;
  creature.sync();
  commit();
  renderEyes();
};
$('#eye-front').onclick = () => {
  // undo their part's roll too, so the eyes look where the creature faces
  const pair = state.eyes.pairs[eyePair];
  const on = creature.eyeBones(pair)[0];
  const turn = Math.round(-(on?.def.roll ?? 0) * 1000) / 1000 || 0;
  if ((pair.turn ?? state.eyes.turn ?? 0) === turn) {
    hint('Already facing front', 1200);
    return;
  }
  pair.turn = turn;
  creature.sync();
  commit();
  renderEyes();
  hint('Eyes facing front', 1400);
};

$('#reset-pose').onclick = () => {
  creature.resetPose();
  settleOnFloor();
  commit();
  hint('Standing up straight', 1400);
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
      sceneOrtho = on;
      try {
        localStorage.setItem(ORTHO_KEY, on ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
    setOrtho(on);
  };
});

$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#spin').onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  $('#spin').classList.toggle('on', controls.autoRotate);
  if (controls.autoRotate) unlock('spin');
};
$('#new').onclick = () => newCreation();

/** Render one clean frame without handles or guides, then restore. */
function withCleanScene<T>(fn: () => T): T {
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
  if (tag === 'INPUT' && ['text', 'number', 'search'].includes((e.target as HTMLInputElement).type)) return;
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
  else if (is(e, 'mirror') && mode === 'stuff') {
    if (piece()) setPieceBothSides(!piece()!.twin);
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
  } else if (is(e, 'move') || is(e, 'rotate') || is(e, 'scale')) {
    const m = is(e, 'move') ? 'translate' : is(e, 'rotate') ? 'rotate' : 'scale';
    if (mode === 'stuff' && piecePivot) setPieceMode(m);
    else if (selectedAttachment) {
      gizmo.setMode(m);
      syncAttachBar();
    } else if (placing) setPlaceMode(m);
  } else if (is(e, 'shape')) setMode('shape');
  else if (is(e, 'look')) setMode('look');
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && k >= '4' && k <= '9' && customTabs()[+k - 4]) setMode(customTabs()[+k - 4].id);
  else if (is(e, 'frame')) {
    if (mode === 'stuff') focusOnBoard();
    else frameCreature();
  } else if (is(e, 'frameAll')) frameAll();
});

// ---------------------------------------------------------------------------
// resize + loop

function resize() {
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
      tween = null;
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
  // sliders moved by code (undo, switching parts...) keep their numbers in step
  if (settings.numbers) syncSliderNumbers();
  if (shadowsChanged()) renderer.shadowMap.needsUpdate = true;
  composer.render();
  watchSpeed(now);
}

// ---------------------------------------------------------------------------
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
var ANIM_TAB = 'animate' as const;
let animPlaying = true;
/** where in the loop we are, 0..1 */
let animT = 0;
let animLast = 0;
let animKey = '';
const animSecs = () => world.animSecs ?? 1.5;
function animOn() {
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
function pickAnimStuff(id: string) {
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
  if (a) anims[selected] = a;
  else delete anims[selected];
  if (twin && twin !== b) {
    // the twin is worked out from this side, so its timing stays half a loop off when walking
    if (a) anims[twin.def.id] = mirrorAnim(a);
    else delete anims[twin.def.id];
  }
  if (!Object.keys(anims).length) delete state.anims;
}

function renderAnim() {
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

function rayAt(e: PointerEvent) {
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

// ---------------------------------------------------------------------------
// boot

$<HTMLInputElement>('#ao').checked = gtao.enabled;
world.creatures.forEach((s, i) => (creatures[i] = makeCreature(s)));
booted = true;

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
