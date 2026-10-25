// ---------------------------------------------------------------------------
// Floor options: none / backdrop (shadow catcher) / mirror / material, and the
// backdrop color behind everything.

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { makeMaterial, setGlow, styleSettings, type GlowFollow, type StyleId } from '../materials';
import { ground, hemi, pixelRatio, scene, shadowMat, viewport } from './stage';
import { mode, state } from './state';

export type FloorMode = 'none' | 'shadow' | 'mirror' | 'material';
const FLOOR_KEY = 'creature-creator/floor';
export let floorPrefs: { mode: FloorMode; style: StyleId; color: string; glow: number; glowFollow?: GlowFollow; reflect: number };
export let mirror: Reflector | null = null;
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
let floorMesh: THREE.Mesh | null = null;
let floorKey = '';

export function saveFloor() {
  try {
    localStorage.setItem(FLOOR_KEY, JSON.stringify(floorPrefs));
  } catch {
    /* ignore */
  }
}

/** Veil and fog both match the (tone-compensated) backdrop exactly. */
export function refreshFloorColors() {
  const bg = scene.background as THREE.Color | null;
  if (!bg) return;
  (veil.material as THREE.MeshBasicMaterial).color.copy(bg);
  if (scene.fog) (scene.fog as THREE.Fog).color.copy(bg);
}

export function sizeMirror() {
  if (!mirror) return;
  const dpr = pixelRatio();
  mirror.getRenderTarget().setSize(Math.round(viewport.clientWidth * dpr), Math.round(viewport.clientHeight * dpr));
}

/** A real floor surface in one of the creature materials. */
export function buildFloorMesh() {
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

export function applyFloor() {
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
export const BACKDROPS = ['#f5efe4', '#fbe3e1', '#e3efe0', '#dfe9f5', '#ebe3f5', '#fff4c7', '#3a3340', '#1d2433'];
export let backdrop = localStorage.getItem(BG_KEY) ?? BACKDROPS[0];

/** three's Neutral tone mapping (exposure 1), mirrored in JS. */
export function neutralTone([r, g, b]: number[]): number[] {
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
export function tintForBackdrop(c: THREE.Color) {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  shadowMat.color.setHSL((hsl.h + 0.02) % 1, Math.min(1, hsl.s * 0.8 + 0.1), hsl.l * 0.25);
  hemi.groundColor.copy(c).multiplyScalar(0.8);
}

/** The Stuff workbench has its own backdrop while it's open; the scene's comes back after. */
export function paintBackdrop(hex: string) {
  const c = new THREE.Color(hex);
  scene.background = untoned(c);
  tintForBackdrop(c);
  refreshFloorColors();
}

export function setBackdrop(hex: string) {
  backdrop = hex;
  paintBackdrop(hex);
  try {
    localStorage.setItem(BG_KEY, hex);
  } catch {
    /* ignore */
  }
}

export function initFloor() {
  floorPrefs = (() => {
    const defaults = { mode: 'shadow' as FloorMode, style: 'clay' as StyleId, color: '#d6c7b3', glow: 0, reflect: 0.55 };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(FLOOR_KEY) ?? '{}') };
    } catch {
      return defaults;
    }
  })();
  scene.add(veil);
  paintBackdrop(backdrop);
}
