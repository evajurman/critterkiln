import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setMeshDetail } from '../inflate';
import { setFuzzQuality, setGlassEnvironment, setSketchPixelRatio } from '../materials';
import { controls, gizmo, invalidate, renderOverlay } from '../main';
import { $ } from './dom';
import { bokeh, gtao, scenePass } from './post';
import { fitShadows } from './state';

// renderer / scene

export const viewport = $('#viewport');
export const canvas = $<HTMLCanvasElement>('#gl');
export const overlay = $<HTMLCanvasElement>('#overlay');
export const octx = overlay.getContext('2d')!;

// performance: how much work each frame and each shape takes (Settings)

export type Quality = 'high' | 'balanced' | 'fast';
export const QUALITY: Record<Quality, { dpr: number; detail: number; fuzz: number; samples: number; shadow: number; ao: boolean; aoSamples: number; glass: number }> = {
  high: { dpr: 2, detail: 1, fuzz: 1, samples: 4, shadow: 2048, ao: true, aoSamples: 16, glass: 1 },
  balanced: { dpr: 1.5, detail: 0.6, fuzz: 0.67, samples: 4, shadow: 2048, ao: true, aoSamples: 8, glass: 0.75 },
  fast: { dpr: 1, detail: 0.35, fuzz: 0.34, samples: 2, shadow: 1024, ao: false, aoSamples: 8, glass: 0.5 },
};
export let quality: Quality = (() => {
  try {
    const q = JSON.parse(localStorage.getItem('creature-creator/settings') ?? '{}').quality;
    return q in QUALITY ? (q as Quality) : 'high';
  } catch {
    return 'high';
  }
})();
export function setQualityValue(v: typeof quality) {
  quality = v;
}
export const pixelRatio = () => Math.min(devicePixelRatio, QUALITY[quality].dpr);
setMeshDetail(QUALITY[quality].detail);
setFuzzQuality(QUALITY[quality].fuzz);

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
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

export const scene = new THREE.Scene();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
setGlassEnvironment(scene.environment);
scene.environmentIntensity = 0.3;

// Studio lighting: a warm key casting soft shadows, a cool fill, and a rim to
// separate the silhouette from the backdrop. Ambient is kept low so form reads.
export const hemi = new THREE.HemisphereLight(0xffffff, 0xbfae98, 0.45);
scene.add(hemi);
export const key = new THREE.DirectionalLight(0xfff0dc, 3.2);
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
export const fill = new THREE.DirectionalLight(0xdce6ff, 0.55);
scene.add(fill);
export const rim = new THREE.DirectionalLight(0xfff4f8, 1.4);
scene.add(rim);

// The whole rig of lights can be turned around the scene (Backdrop > Lighting).
// Where each light sits at a turn of 0; the key's is relative to the creatures.
export const KEY_AT = new THREE.Vector3(2.2, 0, 3.0);
const FILL_AT = new THREE.Vector3(-4, 1.8, 2.5);
const RIM_AT = new THREE.Vector3(-1.5, 3, -4.5);
export const LIGHT_KEY = 'creature-creator/light';
export let lightTurn = (() => {
  try {
    return Number(JSON.parse(localStorage.getItem(LIGHT_KEY) ?? '{}').turn) || 0;
  } catch {
    return 0;
  }
})();
export function setLightTurn(v: typeof lightTurn) {
  lightTurn = v;
}
export function lightSpin(): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(lightTurn));
}
export function applyLighting() {
  const q = lightSpin();
  fill.position.copy(FILL_AT).applyQuaternion(q);
  rim.position.copy(RIM_AT).applyQuaternion(q);
  fitShadows();
}

// Invisible floor that only shows shadows and contact occlusion, so the
// backdrop color is seamless in every direction.
export const shadowMat = new THREE.ShadowMaterial({ opacity: 0.55 });
export const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), shadowMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.renderOrder = 2; // shadows draw over the mirror veil
scene.add(ground);

export const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
camera.position.set(2.8, 2.0, 4.4);
// Ortho: the controls still move `camera`; orthoCam follows it, as big as
// `camera` sees at the orbit centre, so framing and zooming work the same.
// It draws from behind its spot too (negative near), so nothing close is cut off.
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 100);
/** whichever of the two draws the scene (and is picked and projected through) */
export let view: THREE.PerspectiveCamera | THREE.OrthographicCamera = camera;

export const ORTHO_KEY = 'creature-creator/ortho';
/** Shape and Look's choice (Stuff always opens in ortho) */
export let sceneOrtho = (() => {
  try {
    return localStorage.getItem(ORTHO_KEY) === '1';
  } catch {
    return false;
  }
})();
export function setSceneOrtho(v: typeof sceneOrtho) {
  sceneOrtho = v;
}

/** Keep orthoCam on `camera`'s spot, facing the same way, framing what it frames at the orbit centre. */
export function syncView() {
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
export function setOrtho(on: boolean) {
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
