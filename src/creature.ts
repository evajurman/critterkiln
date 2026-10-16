import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bvhFor, exactDistance, sharedNormals } from './distance';
import { paintSkin, type SkinPart } from './skin';
import { buildSkinOff, laneOf } from './skinPool';
import { bounds, buildInflatedGeometry, defaultOutline, getMeshDetail, lumpFade, type Solid, type Vec2 } from './inflate';
import {
  castsShadow,
  glowMaterial,
  glowWithFlash,
  isTextured,
  setGlow,
  setFuzzMask,
  setOpacity,
  makeFuzzShells,
  makeMaterial,
  makeOutlineMaterial,
  inkNormals,
  makeStrayHairs,
  setTextureSpace,
  styleSettings,
  surfaceColor,
  type GlowFollow,
  type StyleId,
  type FuzzSpot,
  type StyleSettings,
} from './materials';
import { MAX_BEND, bendCurve, expandRig, onCurve, type BendCurve, type ExpandedBone, type ExpandedRig, type RigState, type V3 } from './rigs';
import type { PartAnim, StuffAnim } from './animate';
import { buildThing, disposeThing, partPieceGeometry, type Thing, type WrapSurface } from './stuff';

/** One drawn shape of a part, puffed up on its own: drawn from the front (the default) or from the side. */
export interface PartShape {
  outline: Vec2[];
  side?: boolean;
}

export interface PartState {
  /** the first shape (null = not drawn yet: a default capsule) */
  outline: Vec2[] | null;
  /** the first shape was drawn from the side */
  side?: boolean;
  /** any further shapes; together they make the one part */
  more?: PartShape[];
  thickness: number;
  color: string;
  /** 0..1: the color shines with its own light (0 / unset = not at all) */
  glow?: number;
  /** where in its texture it glows from (unset = evenly all over) */
  glowFollow?: GlowFollow;
  style?: StyleId;
  /** 1 = solid, lower = see-through */
  opacity?: number;
  /**
   * How its drawing becomes 3D: puffy = puffed up like a balloon (the
   * default); flat = a cut-out with rounded edges; turned = spun round the
   * bone, like a part off a lathe (robot limbs, pillars, bottles)
   */
  kind?: PartKind;
}

export type PartKind = 'puffy' | 'flat' | 'turned';

/** Every shape a part was drawn as (none if it hasn't been drawn). */
export function partShapes(p: PartState): PartShape[] {
  if (!p.outline) return [];
  return [{ outline: p.outline, ...(p.side ? { side: true } : {}) }, ...(p.more ?? [])];
}

/** Store a part's shapes (the first in `outline`, the rest in `more`). */
export function setPartShapes(p: PartState, shapes: PartShape[]) {
  p.outline = shapes[0]?.outline ?? null;
  if (shapes[0]?.side) p.side = true;
  else delete p.side;
  if (shapes.length > 1) p.more = shapes.slice(1).map((s) => ({ outline: s.outline, ...(s.side ? { side: true } : {}) }));
  else delete p.more;
}

/** A shape drawn from the side lies in the bone's YZ plane: turned a quarter round Y, so its puffing runs along X. */
export const SIDE_TURN = new THREE.Matrix4().makeRotationY(Math.PI / 2);

/** A drawn point -> the bone's own space (z = 0 in the drawing). */
export function shapePoint(side: boolean | undefined, [x, y]: Vec2, z = 0): THREE.Vector3 {
  return side ? new THREE.Vector3(z, y, -x) : new THREE.Vector3(x, y, z);
}

export type EyeStyle ='googly' | 'flat' | 'bead' | 'dot' | 'button';

export const EYE_STYLES: { id: EyeStyle; name: string }[] = [
  { id: 'googly', name: 'Googly' },
  { id: 'flat', name: 'Sticker' },
  { id: 'bead', name: 'Bead' },
  { id: 'dot', name: 'Dot' },
  { id: 'button', name: 'Button' },
];

export interface EyePair {
  size: number;
  spacing: number;
  height: number;
  /** how far this pair stands off the face, 0..1 (falls back to the old shared `lift`) */
  lift?: number;
  /** the part they sit on (both sides of a mirrored one); unset = the rig's head */
  bone?: string;
  /** one eye in the middle instead of two */
  single?: boolean;
  /** radians round the part (falls back to the old shared `turn`) */
  turn?: number;
  /**
   * placed by hand (dropped or dragged onto the part): where the first eye sits,
   * in the part's own frame, and which way the surface faced there. A pair's
   * other eye is its mirror image across the part's own middle. Unset = placed
   * from Spacing and Height, looking from the creature's front.
   */
  at?: V3;
  n?: V3;
}

export type EyeFinish = 'body' | 'gloss' | 'matte' | 'glass';

export interface EyesState {
  enabled: boolean;
  /** one style for every pair */
  style: EyeStyle;
  pairs: EyePair[];
  /** bead / dot / button: what they're made of ('body' = the head's own material) */
  finish?: EyeFinish;
  /** bead / dot / button color */
  color?: string;
  /** bead / dot / button: 0..1, the color shines with its own light */
  glow?: number;
  /** bead / dot / button: where in its texture it glows from (unset = evenly) */
  glowFollow?: GlowFollow;
  /** bead / dot / button on a toon part: outlined in its ink (default off) */
  ink?: boolean;
  /** bead / dot / button in a textured material: each eye gets its own patch of it, not the same one (default on; false = all the same) */
  vary?: boolean;
  /** googly: 1 glossy .. 0 matte (default glossy) */
  shine?: number;
  /** googly / sticker: pupil size, 0..1 (default 0.5) */
  pupil?: number;
  /**
   * googly / sticker: where the pupils look, -1..1 across (to the eye's right)
   * and up. A sticker's pupil left unset has fallen loose to the bottom.
   */
  lookX?: number;
  lookY?: number;
  /** googly / sticker: -1 the pupils look away from each other .. 1 they meet in front of the nose */
  cross?: number;
  /** bead / dot: where the upper lid cuts the eye, -1 (bottom) .. 1 (open, the default) */
  lidTop?: number;
  /** bead / dot: where the lower lid cuts the eye, -1 (open, the default) .. 1 (top) */
  lidBottom?: number;
  /** bead / dot: -1 both lids sag into a cup .. 1 they arch up into a happy crescent */
  crescent?: number;
  /** bead / dot: -1 inner corners up (worried) .. 1 inner corners down (angry) */
  tilt?: number;
  /** legacy: one stand-off for every pair (now per pair) */
  lift?: number;
  /** legacy: radians every pair is turned round the head (now per pair) */
  turn?: number;
}

/** A piece of stuff stuck onto a body part, positioned in that bone's frame. */
export interface Attachment {
  id: string;
  bone: string;
  /** embedded copy, so creature files are self-contained */
  thing: Thing;
  position: V3;
  quaternion: [number, number, number, number];
  scale: V3;
  /** also show a mirrored copy on the twin limb */
  mirror: boolean;
  /** shrink wrap: pressed onto the part's surface like a decal (instead of the thing's own bend) */
  wrap?: boolean;
  /** a looping motion in the Animate tab: see src/animate.ts */
  anim?: StuffAnim;
}

export interface CreatureState {
  name?: string;
  /** the creature's own (editable) skeleton */
  rig: RigState;
  style: StyleId;
  parts: Record<string, PartState>;
  /** per-bone rotation relative to the rest pose */
  pose: Record<string, [number, number, number, number]>;
  rootOffset: V3;
  eyes: EyesState;
  /** Smoothly fuse touching parts that share a color and material. */
  merge?: boolean;
  /** Fillet size for merging, in world units. */
  mergeRadius?: number;
  /** merge parts of the same material even when their colors differ, blending the colors */
  mergeColors?: boolean;
  /** width of the color fade at blended joins, in world units */
  colorBlend?: number;
  /** rebuild merged groups as one seamless skin when left idle (default on; see setSeamlessMode) */
  seamless?: boolean;
  /** legacy: on is blendWith 'connected', off 'all' */
  blendConnected?: boolean;
  /** which touching parts blend into each other (see BlendWith); unset: from blendConnected, or Neighbors */
  blendWith?: BlendWith;
  /** per-material slider values (missing keys use the defaults) */
  materialSettings?: Partial<Record<StyleId, StyleSettings>>;
  attachments?: Attachment[];
  /** legacy: the workbench used to live on the creature; it now belongs to the world */
  workbench?: Thing;
  /** where the creature stands in a multi-creature scene: floor position and facing */
  placement?: Placement;
  /** settle onto the floor after every bend or resize (default on; lifting the creature turns it off) */
  keepFloor?: boolean;
  /** looping motions, per part (scene id): see src/animate.ts */
  anims?: Record<string, PartAnim>;
}

export interface Placement {
  x: number;
  z: number;
  /** rotation about the vertical axis, radians (kept alongside `quat` for older files) */
  yaw: number;
  /** height off the floor (default 0) */
  y?: number;
  /** full 3D turn as a quaternion; when missing, just `yaw` */
  quat?: [number, number, number, number];
  /** overall size (default 1), or a size along each of the creature's own axes when stretched */
  scale?: number | V3;
}

/** A settled seamless skin and what it was built from. */
interface SkinEntry {
  mesh: THREE.Mesh;
  members: BoneRT[];
  /** the part each of `parts` belongs to (one per shape) */
  owners: BoneRT[];
  parts: SkinPart[];
  lowPoly: boolean;
  /** colors were baked into the geometry */
  painted: boolean;
  /** an open skin over part of a group, meeting another skin where it blends in (see peelsFor) */
  peeled?: boolean;
  /** colors the paint was made with */
  colorKey: string;
  /** the look it was last dressed in (see dressSkin) */
  lookKey?: string;
}

export interface BoneRT {
  def: ExpandedBone;
  /** id of the part whose drawing/color this bone uses */
  src: string;
  pivot: THREE.Object3D;
  parent: BoneRT | null;
  length: number;
  restQuat: THREE.Quaternion;
  restWorld: THREE.Matrix4;
  mesh: THREE.Mesh | null;
  meshKey: string;
  tip: THREE.Mesh;
  /** rig mode: handle at the bone's start, shown where a limb attaches */
  startHandle: THREE.Mesh;
  /** rig mode: drag to bend the bone (selected bone only) */
  bendHandles: THREE.Mesh[];
  /** true when the bone starts somewhere other than its parent's tip */
  attach: boolean;
  line: THREE.Line;
  guide: THREE.Group;
  /** the bone's frame in the rest pose, relative to the creature: where its textures are laid out */
  restGroup: THREE.Matrix4;
}

const DEFAULT_COLORS = ['#7cc6a4', '#f6a5b5', '#8fb8ec', '#f7c873', '#b9a3e3'];

export function defaultState(rig: RigState, color?: string): CreatureState {
  const body = color ?? DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
  const parts: Record<string, PartState> = {};
  for (const b of expandRig(rig).bones) {
    if (b.mirrorOf) continue;
    parts[b.id] = { outline: null, thickness: b.thickness ?? 1, color: b.color ?? body };
  }
  return {
    rig: structuredClone(rig),
    style: 'clay',
    parts,
    pose: {},
    rootOffset: [0, 0, 0],
    merge: true,
    mergeRadius: 0.1,
    // googly eyes start matte (saves without a shine stay glossy, as they were made)
    eyes: { enabled: true, style: 'bead', shine: 0, pairs: [{ size: 0.5, spacing: 0.5, height: 0.55 }] },
  };
}

/** App-wide seamless joins: always, never, or each creature's own choice. */
export type SeamlessMode = 'on' | 'off' | 'creature';
let seamlessMode: SeamlessMode = 'creature';
export function setSeamlessMode(m: SeamlessMode) {
  seamlessMode = m;
}
/** Seamless skins for low-poly too (off by default: re-faceting a skin changes the low-poly look) */
let seamlessLowPoly = false;
export function setSeamlessLowPoly(on: boolean) {
  seamlessLowPoly = on;
}
/**
 * Which touching parts blend into each other: every one; only a part and the
 * one it grows from (so a tail curled up to the head, or arms reaching across
 * the body, stay separate); or those, and any part a base sits in (an arm
 * blends into everything round its shoulder, but crossed arms still stay
 * apart: the default).
 */
export type BlendWith = 'all' | 'connected' | 'neighbors';
export function blendWithOf(s: CreatureState): BlendWith {
  return s.blendWith ?? (s.blendConnected === false ? 'all' : s.blendConnected ? 'connected' : 'neighbors');
}
function seamlessOn(s: CreatureState): boolean {
  return seamlessMode === 'creature' ? (s.seamless ?? true) : seamlessMode === 'on';
}

// how long one frame may spend fusing parts (see updateMerge)
const MERGE_BUDGET_MS = 8;
/** scratch: the selection flash's glow */
const FLASH = new THREE.Color();

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeometry(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) {
    if (geoCache.size > 160) {
      // drop the oldest half; geometries still in use stay alive via their meshes
      const keys = [...geoCache.keys()].slice(0, 80);
      for (const k of keys) geoCache.delete(k);
    }
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const tipMat = new THREE.MeshBasicMaterial({ color: 0xff6b4a, depthTest: false, transparent: true });
const tipHoverMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true });
const rootMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true });
const lineMat = new THREE.LineBasicMaterial({ color: 0x3a3340, depthTest: false, transparent: true, opacity: 0.55 });
const outlineLineMat = new THREE.LineBasicMaterial({ color: 0xff6b4a, depthTest: false, transparent: true, opacity: 0.9 });
const planeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
const startMat = new THREE.MeshBasicMaterial({ color: 0x8b5cf6, depthTest: false, transparent: true });
// handle/guide materials are shared by every creature: never dispose them with one
const bendMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false, transparent: true });
// a bend grip not used yet: a faint diamond with a dotted outline
const bendGhostMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false, transparent: true, opacity: 0.12 });
const bendDotMat = new THREE.LineDashedMaterial({ color: 0x16a34a, depthTest: false, transparent: true, dashSize: 0.009, gapSize: 0.007 });
// the roll ring round the selected part, and the axis it turns the part about
const rollMat = new THREE.MeshBasicMaterial({ color: 0x14b8a6, depthTest: false, transparent: true });
const rollLineMat = new THREE.LineDashedMaterial({ color: 0x14b8a6, depthTest: false, transparent: true, opacity: 0.8, dashSize: 0.035, gapSize: 0.025 });
for (const m of [tipMat, tipHoverMat, rootMat, lineMat, outlineLineMat, planeMat, startMat, bendMat, bendGhostMat, bendDotMat, rollMat, rollLineMat]) m.userData.shared = true;
const tipGeo = new THREE.SphereGeometry(0.032, 16, 12);
const startGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
const bendGeo = new THREE.OctahedronGeometry(0.042);
const bendEdges = new THREE.EdgesGeometry(bendGeo);
/** The roll ring: a thin hoop round the line from a part's base to its tip (radius 1, scaled to fit). */
function rollRingGeo(r: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, 0.012, 8, 64).rotateX(Math.PI / 2);
}

// ---------------------------------------------------------------------------
// bendy bones: the bone's local frame (X = side, Y = along the bone, Z = out
// of the drawing) is curved into a circular arc that still runs from the
// bone's start to its tip, bowing out toward a direction around the bone:
// 0 = +X (sideways in the drawing plane), pi/2 = +Z. Or, with two or more
// bend points, curved smoothly through them (rigs.ts bendCurve).

export interface Bend {
  len: number;
  /** total turn, radians (0 = straight) */
  theta: number;
  /** direction around the bone, radians */
  dir: number;
  /** bend points (as fractions of the length, in this bone's own frame) and the curve through them, instead of the arc */
  nodes?: V3[];
  /** how round the curve is at each bend point (see bendCurve) */
  round?: number[];
  curve?: BendCurve;
}

/** Curved at all (an arc or through bend points)? */
export function isBent(bd: Bend | undefined): boolean {
  return !!bd && (!!bd.theta || !!bd.curve);
}

const curveCache = new Map<string, BendCurve>();
/** The same bend at another length (bend points scale with the bone). */
export function bendAtLen(bd: Bend, len: number): Bend {
  if (!bd.nodes) return { ...bd, len };
  const key = `${len.toFixed(5)}:${JSON.stringify(bd.nodes)}:${bd.round ?? ''}`;
  let curve = curveCache.get(key);
  if (!curve) {
    if (curveCache.size > 400) curveCache.clear();
    curve = bendCurve(bd.nodes, len, bd.round);
    curveCache.set(key, curve);
  }
  return { len, theta: 0, dir: 0, nodes: bd.nodes, round: bd.round, curve };
}

/** A bone's bend. A right twin's frame is its left twin's mirrored through local Z, so its direction (and bend points) mirror too. */
export function bendOf(def: ExpandedBone, len: number): Bend {
  const flip = def.sideSign === -1 ? -1 : 1;
  const nodes = def.bendy && def.bendNodes?.length ? def.bendNodes : undefined;
  if (nodes) {
    return bendAtLen({ len, theta: 0, dir: 0, nodes: nodes.map(([x, y, z]) => [x, y, z * flip] as V3), round: def.bendRound }, len);
  }
  const theta = def.bendy ? (def.bend ?? 0) * Math.PI : 0;
  const dir = (def.bendDir ?? 0) * flip;
  return { len, theta, dir };
}

function bendKey(bd: Bend): string {
  if (bd.curve) return `|curve:${bd.len.toFixed(4)}:${JSON.stringify(bd.nodes)}:${bd.round ?? ''}`;
  return bd.theta ? `|bend:${bd.len.toFixed(4)}:${bd.theta.toFixed(4)}:${bd.dir.toFixed(4)}` : '';
}

/**
 * The in-plane bend: (u, y) with u along the bend direction. The arc's ends stay
 * on the bone's start and tip; it leaves the start turned theta/2 toward +u and
 * reaches the tip turned theta/2 the other way. Returns the turn angle there too.
 */
function planarBend(len: number, theta: number, u: number, y: number): [number, number, number] {
  const s = Math.min(len, Math.max(0, y));
  const over = y - s; // past either end the bone carries on straight along its tangent
  let cu = 0, cy = s, phi = 0;
  if (Math.abs(theta) > 1e-5) {
    const half = theta / 2;
    const r = len / (2 * Math.sin(half));
    const a = theta * (s / len) - half; // angle round the arc's centre, from the bulge
    phi = -a;
    cu = r * (Math.cos(a) - Math.cos(half));
    cy = len / 2 + r * Math.sin(a);
  }
  const c = Math.cos(phi), sn = Math.sin(phi);
  // the offset (u, over) turns with the curve: +u -> (cos, -sin), +Y -> (sin, cos)
  return [cu + c * u + sn * over, cy - sn * u + c * over, phi];
}

/** Where the straight-bone point (x, y, z) goes once bent, plus the turn angle there (an arc's). */
function bendPoint(bd: Bend, x: number, y: number, z: number): [number, number, number, number] {
  if (bd.curve) {
    const { p } = onCurve(bd.curve, bd.len, x, y, z);
    return [p[0], p[1], p[2], 0];
  }
  if (!bd.theta) return [x, y, z, 0];
  const c = Math.cos(bd.dir), s = Math.sin(bd.dir);
  const u = c * x + s * z; // along the bend direction
  const w = -s * x + c * z; // across it (unchanged by the bend)
  const [u2, y2, phi] = planarBend(bd.len, bd.theta, u, y);
  return [c * u2 - s * w, y2, s * u2 + c * w, phi];
}

/** Turn a direction vector (x, y, z) by the bend's local turn angle `phi`. */
function bendVector(bd: Bend, phi: number, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(bd.dir), s = Math.sin(bd.dir);
  const u = c * x + s * z;
  const w = -s * x + c * z;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const u2 = cp * u + sp * y;
  const y2 = -sp * u + cp * y;
  return [c * u2 - s * w, y2, s * u2 + c * w];
}

/** Curve a part's geometry (and its merge spheres) to follow its bent bone. */
function bendGeometry(src: THREE.BufferGeometry, bd: Bend): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  if (bd.curve) {
    for (let i = 0; i < pos.count; i++) {
      const f = onCurve(bd.curve, bd.len, pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, f.p[0], f.p[1], f.p[2]);
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      nor.setXYZ(i, f.x[0] * nx + f.t[0] * ny + f.z[0] * nz, f.x[1] * nx + f.t[1] * ny + f.z[1] * nz, f.x[2] * nx + f.t[2] * ny + f.z[2] * nz);
    }
  } else for (let i = 0; i < pos.count; i++) {
    const [x, y, z, phi] = bendPoint(bd, pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, x, y, z);
    const [nx, ny, nz] = bendVector(bd, phi, nor.getX(i), nor.getY(i), nor.getZ(i));
    nor.setXYZ(i, nx, ny, nz);
  }
  const solid = src.userData.solid as Solid | undefined;
  if (solid) {
    const sp = Float32Array.from(solid.spheres);
    const zs = new Float32Array(sp.length / 3);
    for (let i = 0; i < sp.length; i += 3) {
      const [x, y, z] = bendPoint(bd, sp[i], sp[i + 1], solid.zs ? solid.zs[i / 3] : 0);
      sp[i] = x;
      sp[i + 1] = y;
      zs[i / 3] = z;
    }
    g.userData = { ...src.userData, solid: { ...solid, spheres: sp, zs }, sharedNormals: undefined };
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A shape drawn from the side: its puffed-up geometry (and merge spheres) turned into the bone's YZ plane. */
function turnSideways(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  g.applyMatrix4(SIDE_TURN);
  const solid = src.userData.solid as Solid | undefined;
  g.userData = { ...src.userData, sharedNormals: undefined };
  if (solid) {
    // (x, y) in the drawing -> (0, y, -x) on the bone
    const n = solid.spheres.length / 3;
    const sp = Float32Array.from(solid.spheres);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      zs[i] = -sp[i * 3];
      sp[i * 3] = 0;
    }
    g.userData.solid = { ...solid, spheres: sp, zs, sideways: new Uint8Array(n).fill(1) } satisfies Solid;
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Drop zero-area triangles (a turned part's ends close up at the centre line
 * in rings of them): they have no direction, which throws off inside/outside
 * for the seamless skin. Non-indexed geometry only.
 */
function withoutSlivers(src: THREE.BufferGeometry): THREE.BufferGeometry {
  if (src.index) return src;
  const pos = src.getAttribute('position');
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) keep.push(i);
  }
  if (keep.length * 3 === pos.count) return src;
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const size = attr.itemSize;
    const arr = new Float32Array(keep.length * 3 * size);
    keep.forEach((i, k) => {
      for (let v = 0; v < 3; v++) for (let j = 0; j < size; j++) arr[(k * 3 + v) * size + j] = attr.getComponent(i + v, j);
    });
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  g.userData = { ...src.userData };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  src.dispose();
  return g;
}

/**
 * A flat or turned part's geometry. Its merge "spheres" only say how thick it
 * is (joins are sized by that): half a flat part's depth, a turned part's
 * widest radius.
 */
function pieceKindGeometry(kind: 'flat' | 'turned', outline: Vec2[], thickness: number, lowPoly: boolean): THREE.BufferGeometry {
  const b = bounds(outline);
  const size = Math.max(b.w, b.h, 1e-3);
  // a flat part's depth goes with its width (thickness 1: about a third as deep as it is wide)
  const depth = Math.max(0.004, 0.3 * thickness * b.w);
  const step = Math.max(0.002, size / 48) / Math.sqrt(getMeshDetail());
  const g = withoutSlivers(partPieceGeometry(kind, outline, depth, lowPoly, step));
  const r = kind === 'flat' ? depth / 2 : Math.max(Math.abs(b.minX), Math.abs(b.maxX));
  g.userData = { ...g.userData, solid: { spheres: new Float32Array([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, r]), thickness: 1 } satisfies Solid };
  return g;
}

/** Several shapes of one part as one geometry (they just overlap), with all their merge spheres. */
function joinShapes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(geos) ?? geos[0].clone();
  const solids = geos.map((x) => x.userData.solid as Solid | undefined).filter((x): x is Solid => !!x);
  const counts = solids.map((x) => x.spheres.length / 3);
  const spheres = new Float32Array(counts.reduce((a, c) => a + c, 0) * 3);
  const zs = new Float32Array(spheres.length / 3);
  const sideways = new Uint8Array(spheres.length / 3);
  let at = 0;
  solids.forEach((x, j) => {
    spheres.set(x.spheres, at * 3);
    if (x.zs) zs.set(x.zs, at);
    if (x.sideways) sideways.set(x.sideways, at);
    at += counts[j];
  });
  const facets = geos.map((x) => x.userData.facet as number | undefined).filter((x): x is number => x !== undefined);
  g.userData = {
    solid: { spheres, thickness: solids[0]?.thickness ?? 1, zs, sideways } satisfies Solid,
    ...(facets.length ? { facet: Math.min(...facets) } : {}),
  };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * A child's local transform after its parent bone is bent: it rides along the
 * arc but keeps pointing the same way, so bending one part never swings the
 * rest of the skeleton (the ends don't move, so limbs there stay put).
 */
function bendChild(bd: Bend, local: THREE.Matrix4): THREE.Matrix4 {
  if (!isBent(bd)) return local;
  const p = new THREE.Vector3().setFromMatrixPosition(local);
  const s = Math.min(bd.len, Math.max(0, p.y));
  const [x, y, z] = bendPoint(bd, 0, s, 0);
  return new THREE.Matrix4().makeTranslation(x, y - s, z).multiply(local);
}

/** Points along a (possibly bent) bone, for the skeleton line. */
function bonePoints(bd: Bend): THREE.Vector3[] {
  const n = bd.curve ? 48 : bd.theta ? 16 : 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const [x, y, z] = bendPoint(bd, 0, (bd.len * i) / n, 0);
    return new THREE.Vector3(x, y, z);
  });
}

/** Where a bone's middle sits (the bend handle). */
function bendMid(bd: Bend): THREE.Vector3 {
  const [x, y, z] = bendPoint(bd, 0, bd.len / 2, 0);
  return new THREE.Vector3(x, y, z);
}

/**
 * A bend grip: a bend point in use (solid; `node` says which, none for an
 * arc's middle), or one waiting in a gap between them (dotted; `gap` says
 * which: 0 from the start to the first point, and so on to the tip).
 */
export interface BendGrip {
  at: THREE.Vector3;
  used: boolean;
  node?: number;
  gap?: number;
}
/** too short a gap (in the bone's units) gets no grip of its own: it'd be too fiddly to tell apart */
const MIN_GAP = 0.06;

/** Where the bend grips sit: a straight bone's middle (waiting), an arc's middle, or each bend point, with waiting ones in the gaps between. */
function bendGrips(bd: Bend): BendGrip[] {
  const pt = (y: number) => {
    const [x, py, z] = bendPoint(bd, 0, y, 0);
    return new THREE.Vector3(x, py, z);
  };
  if (!bd.nodes) {
    if (!bd.theta) return [{ at: pt(bd.len / 2), used: false }];
    const arcLen = bd.len * (Math.abs(bd.theta) / 2 / Math.sin(Math.abs(bd.theta) / 2));
    const out: BendGrip[] = [{ at: pt(bd.len / 2), used: true }];
    if (arcLen / 2 >= MIN_GAP) out.push({ at: pt(bd.len / 4), used: false, gap: 0 }, { at: pt((bd.len * 3) / 4), used: false, gap: 1 });
    return out;
  }
  const c = bd.curve!;
  // how far along the curve each point sits (it passes through them), as a fraction
  const along = (v: THREE.Vector3) => {
    let best = 0, d = Infinity;
    for (let i = 0; i <= c.k; i++) {
      const e = (c.pts[i * 3] - v.x) ** 2 + (c.pts[i * 3 + 1] - v.y) ** 2 + (c.pts[i * 3 + 2] - v.z) ** 2;
      if (e < d) (d = e), (best = i);
    }
    return best / c.k;
  };
  const used = bd.nodes.map(([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(bd.len));
  const out: BendGrip[] = used.map((at, i) => ({ at, used: true, node: i }));
  const fs = [0, ...used.map(along), 1];
  for (let g = 0; g + 1 < fs.length; g++) {
    if ((fs[g + 1] - fs[g]) * c.length < 2 * MIN_GAP) continue;
    out.push({ at: pt(((fs[g] + fs[g + 1]) / 2) * bd.len), used: false, gap: g });
  }
  return out;
}

/**
 * The bend that puts a bone's middle at local point `p`: direction from where
 * it sits around the bone, amount from how far it's pulled off the straight line.
 */
export function bendFromMid(len: number, p: THREE.Vector3): { bend: number; dir: number } {
  const off = Math.hypot(p.x, p.z);
  const dir = Math.atan2(p.z, p.x);
  // an arc through both ends bulges (len / 2) * tan(theta / 4) at its middle
  const theta = 4 * Math.atan((2 * off) / len);
  return { bend: Math.min(MAX_BEND, theta / Math.PI), dir };
}

/** Rest-pose world frame of a bone: X = drawing side, Y = along the bone, origin at its start. */
function restFrame(def: ExpandedBone) {
  const start = new THREE.Vector3(...def.start);
  const dir = new THREE.Vector3(...def.end).sub(start);
  const length = Math.max(dir.length(), 1e-3);
  dir.normalize();
  const side = new THREE.Vector3(...def.side);
  side.addScaledVector(dir, -side.dot(dir));
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0).addScaledVector(dir, -dir.x);
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize();
  // roll: turn the drawing about the bone. A right twin is its left twin's
  // mirror image, so it turns the other way
  if (def.roll) side.applyAxisAngle(dir, def.roll * (def.sideSign === -1 ? -1 : 1));
  const normal = new THREE.Vector3().crossVectors(side, dir).normalize();
  return { length, world: new THREE.Matrix4().makeBasis(side, dir, normal).setPosition(start) };
}

const rootGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);

/** Free skins for good: their materials, dressing and geometry. */
function disposeSkins(skins: SkinEntry[]) {
  for (const { mesh } of skins) {
    mesh.removeFromParent();
    mesh.traverse((o) => {
      ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
      if (o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    mesh.geometry.dispose();
  }
}

export class Creature {
  /** placement in the scene (floor position + facing); holds `group` */
  readonly root = new THREE.Group();
  /** the creature itself; its position is the pose's root offset */
  readonly group = new THREE.Group();
  rig: ExpandedRig;
  readonly bones = new Map<string, BoneRT>();
  readonly list: BoneRT[] = [];
  readonly rootHandle: THREE.Mesh;
  /** one group of eyes per part that has some */
  private eyes: THREE.Group[] = [];
  private eyesKey = '';
  state: CreatureState;
  selected: string | null = null;
  private drawFocus: string | null = null;
  /** the part in drawFocus is being drawn from the side */
  private drawSide = false;
  private mergeDirty = true;
  /** the parts' glows the skins were last dressed for */
  private glowKey = '';
  /** where the next frame's fusing picks up (see updateMerge) */
  private mergeCursor = 0;
  // seamless skins: built when idle, thrown away on any change
  private skins: SkinEntry[] = [];
  /** shape the current (or pending) skin was built for; see skinShapeKey */
  private skinKey = '';
  private skinVersion = 0;
  skinState: 'none' | 'building' | 'ready' = 'none';
  /** when the shape or pose last changed (performance.now) */
  lastChange = performance.now();
  /** eye spots in each part's own space (by bone id), for keeping felt fuzz off them */
  private eyeSpots = new Map<string, FuzzSpot[]>();
  /** the roll gizmo on the selected part: a ring to turn it about its length, and that axis */
  private rollGizmo = new THREE.Group();
  private rollRing: THREE.Mesh;
  private rollAxis: THREE.Line;
  /** a roll is being dragged: keep its axis showing */
  rolling = false;
  private dragging = false;
  private dragUnfused = false;
  /**
   * Something on this creature is being dragged. Joins that move meanwhile
   * fade their colors only across the fillet (no wider measuring than the
   * shape needs, which is what makes wide color fades slow), or, when
   * `unfused` (the fast setting), aren't fused at all: the parts just
   * overlap. Letting go brings the full join back.
   */
  setDragging(on: boolean, unfused = false) {
    if (on === this.dragging && unfused === this.dragUnfused) return;
    this.dragging = on;
    this.dragUnfused = on && unfused;
    if (!on) this.mergeDirty = true;
  }
  private attached = new Map<string, { key: string; main: THREE.Group; twin: THREE.Group | null; bone: BoneRT; twinBone: BoneRT | null }>();

  /** `skeletonOnly`: just the posed skeleton, no meshes (for measuring it, cheaply) */
  constructor(state: CreatureState, skeletonOnly = false) {
    this.state = state;
    this.root.add(this.group);
    this.rig = expandRig(state.rig);
    this.ensureParts();
    this.buildSkeleton();
    this.rootHandle = new THREE.Mesh(rootGeo, rootMat);
    this.rootHandle.renderOrder = 1000;
    this.rootHandle.userData.handle = 'root';
    this.list[0].pivot.parent!.add(this.rootHandle);
    this.rootHandle.position.copy(this.list[0].pivot.position);
    // (its hoop is sized to the part in updateRollRing)
    this.rollRing = new THREE.Mesh(new THREE.BufferGeometry(), rollMat);
    this.rollRing.renderOrder = 1000;
    this.rollRing.userData.kind = 'roll';
    this.rollRing.userData.ring = 0;
    this.rollGizmo.add(this.rollRing);
    // what rolling turns the part round: shown while the ring is hovered or dragged
    this.rollAxis = new THREE.Line(new THREE.BufferGeometry(), rollLineMat);
    this.rollAxis.renderOrder = 999;
    this.rollAxis.visible = false;
    this.rollGizmo.add(this.rollAxis);
    this.rollGizmo.visible = false;
    if (skeletonOnly) this.applyPose();
    else this.sync();
  }

  // -------------------------------------------------------------------------
  // skeleton

  /** Every drawable bone needs a part slot (new limbs start from their parent's look). */
  private ensureParts() {
    const fallback = Object.values(this.state.parts)[0] ?? { outline: null, thickness: 1, color: DEFAULT_COLORS[0] };
    for (const b of this.rig.bones) {
      if (b.mirrorOf || this.state.parts[b.id]) continue;
      const parentPart = b.parent ? this.state.parts[this.rig.bones.find((o) => o.id === b.parent)?.mirrorOf ?? b.parent] : null;
      const like = parentPart ?? fallback;
      this.state.parts[b.id] = { outline: null, thickness: b.thickness ?? 1, color: b.color ?? like.color, style: like.style };
    }
  }

  private buildSkeleton() {
    for (const def of this.rig.bones) {
      const { length, world: restWorld } = restFrame(def);
      const parent = def.parent ? this.bones.get(def.parent)! : null;
      let local = parent ? parent.restWorld.clone().invert().multiply(restWorld) : restWorld.clone();
      // children of a bendy bone ride along its curve
      if (parent) local = bendChild(bendOf(parent.def, parent.length), local);
      const pivot = new THREE.Object3D();
      const scale = new THREE.Vector3();
      local.decompose(pivot.position, pivot.quaternion, scale);
      pivot.userData.boneId = def.id;
      (parent ? parent.pivot : this.group).add(pivot);

      const bd = bendOf(def, length);
      const tipAt = bendPoint(bd, 0, length, 0);
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.set(tipAt[0], tipAt[1], tipAt[2]);
      tip.renderOrder = 1000;
      tip.userData.handle = def.id;
      tip.userData.kind = 'end';
      pivot.add(tip);

      const startHandle = new THREE.Mesh(startGeo, startMat);
      // drawn over the roll ring, which crosses it when seen edge-on
      startHandle.renderOrder = 1001;
      startHandle.userData.handle = def.id;
      startHandle.userData.kind = 'start';
      startHandle.visible = false;
      pivot.add(startHandle);
      const attach = !parent || !!def.loose || new THREE.Vector3(...def.start).distanceTo(new THREE.Vector3(...parent.def.end)) > 0.02;

      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bonePoints(bd)), lineMat);

      // rig mode: drag these to bend the bone (shown on the selected bone; see placeBendHandles)
      const bendHandles: THREE.Mesh[] = [];
      line.renderOrder = 999;
      pivot.add(line);

      const guide = new THREE.Group();
      guide.visible = false;
      pivot.add(guide);

      const rt: BoneRT = {
        def,
        src: def.mirrorOf ?? def.id,
        pivot,
        parent,
        length,
        restQuat: pivot.quaternion.clone(),
        restWorld,
        mesh: null,
        meshKey: '',
        tip,
        startHandle,
        bendHandles,
        attach,
        line,
        guide,
        restGroup: new THREE.Matrix4(),
      };
      this.bones.set(def.id, rt);
      this.list.push(rt);
      this.placeBendHandles(rt, bd);
    }
    this.updateRestFrames();
  }

  /**
   * The bend grips (see bendGrips): solid ones in use, dotted ones waiting.
   * `userData` says which: `used`, and `node` or `gap`.
   */
  private placeBendHandles(b: BoneRT, bd: Bend) {
    const grips = bendGrips(bd);
    const shown = b.bendHandles.some((h) => h.visible);
    while (b.bendHandles.length > grips.length) b.bendHandles.pop()!.removeFromParent();
    while (b.bendHandles.length < grips.length) {
      const h = new THREE.Mesh(bendGeo, bendMat);
      h.renderOrder = 1000;
      h.userData.handle = b.def.id;
      h.userData.kind = 'bend';
      const dots = new THREE.LineSegments(bendEdges, bendDotMat);
      dots.computeLineDistances();
      dots.renderOrder = 1000;
      dots.raycast = () => {};
      h.add(dots);
      b.pivot.add(h);
      b.bendHandles.push(h);
    }
    b.bendHandles.forEach((h, i) => {
      const g = grips[i];
      h.position.copy(g.at);
      h.userData.used = g.used;
      h.userData.node = g.node;
      h.userData.gap = g.gap;
      h.material = g.used ? bendMat : bendGhostMat;
      h.children[0].visible = !g.used;
    });
    this.showBendGrips(b, shown);
  }

  /** While a bend grip is dragged, the waiting ones stay out of the way (they move to the new gaps on letting go). */
  bendDragging = false;
  private showBendGrips(b: BoneRT, on: boolean) {
    for (const h of b.bendHandles) h.visible = on && (h.userData.used || !this.bendDragging);
  }
  /** Start or end a bend drag (see bendDragging). */
  setBendDragging(on: boolean) {
    this.bendDragging = on;
    this.setSkeletonVisible(this.skeletonShown);
  }

  /** Recompute every bone's rest-pose frame (in place: materials hold on to them). */
  private updateRestFrames() {
    const one = new THREE.Vector3(1, 1, 1);
    for (const b of this.list) {
      b.restGroup.compose(b.pivot.position, b.restQuat, one);
      if (b.parent) b.restGroup.premultiply(b.parent.restGroup);
    }
  }

  /**
   * Rig editing: re-seat every bone from an edited skeleton with the same
   * bones, without rebuilding meshes (they stretch to fit until the next full build).
   */
  relayout(rig: RigState) {
    this.baseTouch.clear();
    const next = expandRig(rig);
    for (const def of next.bones) {
      const b = this.bones.get(def.id);
      if (!b) continue;
      const { length, world } = restFrame(def);
      let local = b.parent ? b.parent.restWorld.clone().invert().multiply(world) : world.clone();
      if (b.parent) local = bendChild(bendOf(b.parent.def, b.parent.length), local);
      local.decompose(b.pivot.position, b.restQuat, new THREE.Vector3());
      b.restWorld = world;
      b.def = def;
      if (b.mesh) b.mesh.scale.y = length / b.length;
      const bd = bendOf(def, length);
      const tipAt = bendPoint(bd, 0, length, 0);
      b.tip.position.set(tipAt[0], tipAt[1], tipAt[2]);
      this.placeBendHandles(b, bd);
      b.line.geometry.dispose();
      b.line.geometry = new THREE.BufferGeometry().setFromPoints(bonePoints(bd));
    }
    this.rootHandle.position.copy(this.list[0].pivot.position);
    this.updateRestFrames();
    // reshaping keeps the pose: bones stay bent the way they were
    this.applyPose();
    this.mergeDirty = true;
    this.updateRollRing();
  }

  settingsFor(style: StyleId): StyleSettings {
    return styleSettings(style, this.state.materialSettings?.[style]);
  }

  part(id: string): PartState {
    const b = this.bones.get(id)!;
    return this.state.parts[b.src];
  }

  /** The part's shapes, or the default capsule if it hasn't been drawn. */
  shapesFor(b: BoneRT): PartShape[] {
    const shapes = partShapes(this.state.parts[b.src]);
    return shapes.length ? shapes : [{ outline: defaultOutline(b.length, b.def.width, b.def.widthEnd ?? b.def.width) }];
  }

  // -------------------------------------------------------------------------
  // sync state -> scene

  applyPlacement() {
    const p = this.state.placement ?? { x: 0, z: 0, yaw: 0 };
    this.root.position.set(p.x, p.y ?? 0, p.z);
    if (p.quat) this.root.quaternion.set(...p.quat);
    else this.root.rotation.set(0, p.yaw, 0);
    if (Array.isArray(p.scale)) this.root.scale.set(...p.scale);
    else this.root.scale.setScalar(p.scale ?? 1);
  }

  /** Read the placement back from the root (after a gizmo drag). */
  capturePlacement() {
    const r = (v: number, k = 1000) => Math.round(v * k) / k;
    const q = this.root.quaternion;
    const upright = Math.abs(q.x) < 1e-5 && Math.abs(q.z) < 1e-5;
    const p: Placement = {
      x: r(this.root.position.x),
      z: r(this.root.position.z),
      yaw: r(new THREE.Euler().setFromQuaternion(q, 'YXZ').y, 10000),
    };
    if (Math.abs(this.root.position.y) > 1e-4) p.y = r(this.root.position.y);
    if (!upright) p.quat = q.toArray().map((v) => r(v, 1e5)) as [number, number, number, number];
    const s = this.root.scale;
    if (Math.abs(s.x - s.y) > 1e-4 || Math.abs(s.y - s.z) > 1e-4) p.scale = [r(s.x), r(s.y), r(s.z)];
    else if (Math.abs(s.x - 1) > 1e-4) p.scale = r(s.x);
    this.state.placement = p;
  }

  /** Remove from the scene and free per-creature GPU resources. */
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m && !m.userData.shared) m.dispose();
    });
    for (const b of this.list) (b.mesh?.userData.mergeGeo as THREE.BufferGeometry | undefined)?.dispose();
    for (const sks of this.skinCache.values()) disposeSkins(sks);
    this.skinCache.clear();
  }

  sync() {
    this.baseTouch.clear();
    const s = this.state;
    this.applyPlacement();
    // a glow change alone (painting the whole creature, undo) leaves every
    // part's mesh as it is, but the skins still need it
    const glowKey = JSON.stringify(Object.values(s.parts).map((p) => [p.glow ?? 0, p.glowFollow]));
    if (glowKey !== this.glowKey) {
      this.glowKey = glowKey;
      this.mergeDirty = true;
    }
    for (const b of this.list) {
      const p = s.parts[b.src];
      const style = p.style ?? s.style;
      const shapes = this.shapesFor(b);
      const k = this.settingsFor(style);
      const kind = p.kind ?? 'puffy';
      const geoOpts = {
        kind,
        thickness: p.thickness,
        lowPoly: style === 'lowpoly',
        facetScale: style === 'lowpoly' ? k.facets : undefined,
        colorJitter: style === 'lowpoly' ? k.variation : undefined,
        lumps: style === 'clay' ? k.lumps : style === 'stone' ? k.rugged : 0,
      };
      const geoKey = JSON.stringify([shapes, geoOpts, getMeshDetail()]);
      const key = geoKey + style + p.color + JSON.stringify(k) + (p.opacity ?? 1) + bendKey(bendOf(b.def, b.length));
      if (key === b.meshKey) {
        this.glowPart(b);
        continue;
      }
      b.meshKey = key;
      this.mergeDirty = true;
      if (b.mesh) {
        b.pivot.remove(b.mesh);
        b.mesh.traverse((o) => {
          ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
          if (o instanceof THREE.LineSegments) o.geometry.dispose();
        });
        (b.mesh.userData.mergeGeo as THREE.BufferGeometry | undefined)?.dispose();
      }
      const bd = bendOf(b.def, b.length);
      const seed = hashString(b.src);
      // each shape puffed up on its own (turned a quarter round if drawn from the side), then bent with the bone
      const straightGeo = (sh: PartShape, i: number, opts: typeof geoOpts) => {
        const sk = JSON.stringify([sh.outline, opts, getMeshDetail(), i]) + (sh.side ? 'side' : '');
        const flat = cachedGeometry(sk, () =>
          opts.kind === 'puffy' ? buildInflatedGeometry(sh.outline, { ...opts, seed: seed + i }) : pieceKindGeometry(opts.kind, sh.outline, opts.thickness, opts.lowPoly),
        );
        return { sk, geo: sh.side ? cachedGeometry(sk + 'turned', () => turnSideways(flat)) : flat };
      };
      const shapeGeo = (sh: PartShape, i: number, opts: typeof geoOpts) => {
        const { sk, geo: turned } = straightGeo(sh, i, opts);
        return isBent(bd) ? cachedGeometry(sk + bendKey(bd), () => bendGeometry(turned, bd)) : turned;
      };
      const geo =
        shapes.length === 1
          ? shapeGeo(shapes[0], 0, geoOpts)
          : cachedGeometry(geoKey + bendKey(bd), () => joinShapes(shapes.map((sh, i) => shapeGeo(sh, i, geoOpts))));
      const mesh = new THREE.Mesh(geo, makeMaterial(style, p.color, k));
      mesh.userData.baseGeo = geo;
      // the roll ring is sized to the part as if it were straight (and stretching a tip re-bends it from straight)
      const straightBox = new THREE.Box3();
      shapes.forEach((sh, i) => {
        const g = straightGeo(sh, i, geoOpts).geo;
        if (!g.boundingBox) g.computeBoundingBox();
        straightBox.union(g.boundingBox!);
      });
      mesh.userData.straightBox = straightBox;
      mesh.userData.bend = bd;
      // the part unbent, for re-bending it live while it's resized
      mesh.userData.straightGeo = () =>
        shapes.length === 1 ? straightGeo(shapes[0], 0, geoOpts).geo : cachedGeometry(geoKey + 'straight', () => joinShapes(shapes.map((sh, i) => straightGeo(sh, i, geoOpts).geo)));
      // The seamless skin is built from each shape on its own (shapes of one
      // part overlap, which would confuse inside/outside on the joined mesh),
      // and from the smooth (un-lumped) shapes: lumps can fold thin parts over themselves
      const smoothOpts = { ...geoOpts, lumps: 0 };
      mesh.userData.skinGeos = () => shapes.map((sh, i) => shapeGeo(sh, i, smoothOpts));
      // eyes sit on the smooth shape too, with the lumps eased out under them (see syncEyes)
      if (geoOpts.lumps) {
        mesh.userData.lumpyGeo = geo;
        mesh.userData.smoothGeo = () =>
          shapes.length === 1
            ? shapeGeo(shapes[0], 0, smoothOpts)
            : cachedGeometry(JSON.stringify([shapes, smoothOpts, getMeshDetail()]) + bendKey(bd), () => joinShapes(shapes.map((sh, i) => shapeGeo(sh, i, smoothOpts))));
      }
      mesh.userData.opacity = p.opacity ?? 1;
      mesh.castShadow = castsShadow(style);
      // (soft shadows also draw receivers into the shadow map: glass mustn't block the light)
      mesh.receiveShadow = castsShadow(style);
      mesh.userData.boneId = b.def.id;
      if (style === 'toon' && k.ink > 0) {
        const ink = new THREE.Mesh(geo, makeOutlineMaterial(k.ink, false, k));
        ink.userData.boneId = b.def.id;
        ink.raycast = () => {};
        mesh.add(ink);
      }
      if (style === 'felt') {
        for (const shell of makeFuzzShells(geo, p.color, k)) mesh.add(shell);
        if (k.hairs > 0) mesh.add(makeStrayHairs(geo, p.color, hashString(b.def.id), k.hairs, false, 1, k.fuzz));
      }
      setOpacity(mesh, p.opacity ?? 1);
      // textures (and fuzz) are laid out in the rest pose and bend with the bones
      setTextureSpace(mesh, b.restGroup);
      b.pivot.add(mesh);
      b.mesh = mesh;
      this.glowPart(b);
    }
    this.applyPose();
    this.syncEyes();
    this.syncAttachments();
    this.refreshHighlight();
    this.updateRollRing();
  }

  // -------------------------------------------------------------------------
  // attached stuff

  twinOf(b: BoneRT): BoneRT | null {
    if (b.def.sideSign === 0) return null;
    return this.bones.get(b.def.baseId + (b.def.sideSign === 1 ? 'R' : 'L')) ?? null;
  }

  /** Where an attachment's mirrored copy goes: the twin limb, or (a middle part) the part itself, across the creature's middle. */
  mirrorBoneOf(b: BoneRT): BoneRT | null {
    return b.def.sideSign === 0 ? b : this.twinOf(b);
  }

  syncAttachments() {
    const list = this.state.attachments ?? [];
    const alive = new Set<string>();
    for (const a of list) {
      const bone = this.bones.get(a.bone);
      if (!bone) continue;
      alive.add(a.id);
      const twinBone = a.mirror ? this.mirrorBoneOf(bone) : null;
      // an item that inherits its material takes the material of the part it's on
      const part = this.state.parts[bone.src];
      const wearer = { style: part?.style ?? this.state.style, settingsFor: (st: StyleId) => this.settingsFor(st) };
      const styles = a.thing.inherit ? [wearer.style] : a.thing.pieces.map((p) => p.style);
      // felt fuzz and toon ink are sized for the attachment's scale, so a big
      // rescale rebuilds them (unless the item opts out, and lets them scale along with it)
      const sized = a.thing.scaleMaterial !== false && styles.some((s) => s === 'felt' || s === 'toon');
      const unit = sized ? Math.round(Math.cbrt(Math.abs(a.scale[0] * a.scale[1] * a.scale[2])) * 20) / 20 || 1 : 1;
      // a wrapped item follows the creature under it: moving, posing or reshaping either reshapes it
      const wrapKey = a.wrap ? [a.thing.wrapSmooth, a.thing.wrapStrength, a.position, a.quaternion, a.scale, this.state.pose, this.list.map((b) => [b.meshKey, b.mesh?.scale.toArray()])] : 0;
      const key = JSON.stringify([a.thing.pieces, a.thing.ownMaterial, a.thing.inherit, a.thing.materialSettings, a.thing.bend, a.thing.bendMode, a.bone, twinBone?.def.id, this.state.materialSettings, wearer.style, unit, getMeshDetail(), wrapKey]);
      let rec = this.attached.get(a.id);
      if (!rec || rec.key !== key) {
        const settings = wearer;
        const wrap = wrapKey ? this.wrapSurface(a, bone) : undefined;
        if (rec && rec.bone === bone && rec.twinBone === twinBone) {
          // same place: swap the contents but keep the groups (the gizmo may hold one)
          for (const g of [rec.main, rec.twin]) {
            if (!g) continue;
            for (const c of [...g.children]) {
              c.removeFromParent();
              disposeThing(c);
            }
            g.add(buildThing(a.thing, settings, unit, wrap));
          }
          rec.key = key;
        } else {
          if (rec) this.dropAttachment(rec);
          const main = new THREE.Group();
          main.add(buildThing(a.thing, settings, unit, wrap));
          bone.pivot.add(main);
          let twin: THREE.Group | null = null;
          if (twinBone) {
            twin = new THREE.Group();
            twin.add(buildThing(a.thing, settings, unit, wrap));
            twin.matrixAutoUpdate = false;
            twinBone.pivot.add(twin);
          }
          rec = { key, main, twin, bone, twinBone };
          this.attached.set(a.id, rec);
        }
        for (const g of [rec.main, rec.twin]) g?.traverse((o) => (o.userData.attachmentId = a.id));
      }
      this.placeStuff(a, rec.main);
      this.updateTwin(a.id);
    }
    for (const [id, rec] of this.attached) {
      if (alive.has(id)) continue;
      this.dropAttachment(rec);
      this.attached.delete(id);
    }
  }

  /**
   * For a shrink-wrapped item: how far along its Z the creature's outer surface
   * sits at each point of its drawing (in its own units), found by casting a
   * ray from in front at every part, as posed now; the nearest hit wins, so an
   * item on the body hugs whatever is in front of it there. Past the creature's
   * edge, the nearest bit of surface. (The twin shows the same shape: the
   * other side is this one mirrored.)
   */
  private wrapSurface(a: Attachment, bone: BoneRT): WrapSurface | undefined {
    this.group.updateMatrixWorld(true);
    const parts = this.list.flatMap((b) => {
      const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
      if (!b.mesh || !geo) return [];
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const toWorld = b.mesh.matrixWorld.clone();
      return [{ bvh: bvhFor(geo), toWorld, toGeo: toWorld.clone().invert(), sphere: geo.boundingSphere!.clone().applyMatrix4(toWorld) }];
    });
    if (!parts.length) return undefined;
    const place = new THREE.Matrix4().compose(new THREE.Vector3(...a.position), new THREE.Quaternion(...a.quaternion), new THREE.Vector3(...a.scale));
    const thingToWorld = bone.pivot.matrixWorld.clone().multiply(place);
    const toThing = thingToWorld.clone().invert();
    const all = new THREE.Sphere();
    new THREE.Box3().setFromPoints(parts.flatMap((q) => [q.sphere.center.clone().addScalar(-q.sphere.radius), q.sphere.center.clone().addScalar(q.sphere.radius)])).getBoundingSphere(all);
    const down = new THREE.Vector3(0, 0, -1).transformDirection(thingToWorld);
    const world = new THREE.Ray(), local = new THREE.Ray();
    const p = new THREE.Vector3(), q = new THREE.Vector3(), best = new THREE.Vector3();
    const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    return (x, y) => {
      p.set(x, y, 0).applyMatrix4(thingToWorld);
      // start well clear of the creature, in front of it
      world.origin.copy(p).addScaledVector(down, -(all.radius * 2 + p.distanceTo(all.center)));
      world.direction.copy(down);
      let near = Infinity;
      for (const part of parts) {
        if (!world.intersectsSphere(part.sphere)) continue;
        local.copy(world).applyMatrix4(part.toGeo);
        const h = part.bvh.raycastFirst(local, THREE.DoubleSide);
        if (!h) continue;
        q.copy(h.point).applyMatrix4(part.toWorld);
        const d = q.distanceTo(world.origin);
        if (d < near) (near = d), best.copy(q);
      }
      if (near === Infinity) {
        for (const part of parts) {
          const h = part.bvh.closestPointToPoint(q.copy(p).applyMatrix4(part.toGeo), hit);
          if (!h) continue;
          q.copy(h.point).applyMatrix4(part.toWorld);
          const d = q.distanceTo(p);
          if (d < near) (near = d), best.copy(q);
        }
      }
      return near === Infinity ? 0 : best.applyMatrix4(toThing).z;
    };
  }

  private dropAttachment(rec: { main: THREE.Group; twin: THREE.Group | null }) {
    for (const g of [rec.main, rec.twin]) {
      if (!g) continue;
      g.removeFromParent();
      disposeThing(g);
    }
  }

  /**
   * The twin limb's frame is this one mirrored across its local Z, so the
   * mirrored copy uses M * A with M = diag(1, 1, -1). On a middle part the
   * copy rides the same part, mirrored across the creature's middle (x = 0 at
   * rest): R^-1 * diag(-1, 1, 1) * R * A, with R the part's rest frame.
   */
  updateTwin(id: string) {
    const rec = this.attached.get(id);
    if (!rec?.twin) return;
    rec.main.updateMatrix();
    if (rec.twinBone === rec.bone) {
      const r = rec.bone.restGroup;
      rec.twin.matrix.copy(r).invert().multiply(new THREE.Matrix4().makeScale(-1, 1, 1)).multiply(r).multiply(rec.main.matrix);
    } else rec.twin.matrix.makeScale(1, 1, -1).multiply(rec.main.matrix);
    rec.twin.matrixWorldNeedsUpdate = true;
  }

  /**
   * Looping stuff motions (Animate tab): per attachment, a move in its part's
   * frame applied after its own placement. Never saved into the placement.
   */
  private stuffAnim: Map<string, THREE.Matrix4> | null = null;
  setStuffAnim(m: Map<string, THREE.Matrix4> | null) {
    if (!m && !this.stuffAnim) return;
    this.stuffAnim = m;
    for (const a of this.state.attachments ?? []) {
      const rec = this.attached.get(a.id);
      if (!rec) continue;
      this.placeStuff(a, rec.main);
      this.updateTwin(a.id);
    }
  }

  /** Put an attachment where it's placed (plus its motion, if one's showing). */
  private placeStuff(a: Attachment, g: THREE.Group) {
    g.position.set(...a.position);
    g.quaternion.set(...a.quaternion);
    g.scale.set(...a.scale);
    const m = this.stuffAnim?.get(a.id);
    if (!m) return;
    g.updateMatrix();
    new THREE.Matrix4().multiplyMatrices(m, g.matrix).decompose(g.position, g.quaternion, g.scale);
  }

  /**
   * An attachment's own frame, as placed (no motion), in its part's frame:
   * the middle of what it's made of, which way its drawing faces (its Z, out
   * of the board), its X, and how big it is across.
   */
  stuffFrame(id: string): { center: THREE.Vector3; normal: THREE.Vector3; side: THREE.Vector3; size: number; origin: THREE.Vector3 } | null {
    const a = this.state.attachments?.find((x) => x.id === id);
    const rec = this.attached.get(id);
    if (!a || !rec) return null;
    const place = new THREE.Matrix4().compose(new THREE.Vector3(...a.position), new THREE.Quaternion(...a.quaternion), new THREE.Vector3(...a.scale));
    // its contents' box in its own (unplaced) frame
    rec.main.updateMatrixWorld(true);
    const toMain = rec.main.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    rec.main.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!(o instanceof THREE.Mesh) || !geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      box.union(geo.boundingBox!.clone().applyMatrix4(toMain.clone().multiply(o.matrixWorld)));
    });
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 0.1 : box.getSize(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().makeScale(...a.scale)).length();
    const q = new THREE.Quaternion(...a.quaternion);
    return {
      center: c.applyMatrix4(place),
      normal: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      side: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      size: Math.abs(size),
      origin: new THREE.Vector3(...a.position),
    };
  }

  /** Which way is up (the creature's +Y, at rest) in a part's frame. */
  upIn(boneId: string): THREE.Vector3 {
    const b = this.bones.get(boneId);
    if (!b) return new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3(0, 1, 0).transformDirection(b.restGroup.clone().invert());
  }

  attachmentObject(id: string): THREE.Group | null {
    return this.attached.get(id)?.main ?? null;
  }

  attachmentMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const rec of this.attached.values()) {
      for (const g of [rec.main, rec.twin]) g?.traverse((o) => o instanceof THREE.Mesh && out.push(o));
    }
    return out;
  }

  /** A reasonable first placement: centred on the part, on its front surface. */
  attachPoint(boneId: string): V3 {
    const b = this.bones.get(boneId);
    const geo = b?.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
    if (!b || !geo?.boundingBox) return [0, 0, 0];
    const bb = geo.boundingBox;
    return [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z * 0.9];
  }

  /**
   * Looping motion shown on top of the pose (Animate tab): per bone, a turn
   * after its pose and how puffed up it is. Never saved into the pose.
   */
  private anim: Map<string, { q: THREE.Quaternion; s: number }> | null = null;
  /** meshes puffed by Breathe, to put back to their own width */
  private puffed = new Set<THREE.Mesh>();
  setAnim(a: Map<string, { q: THREE.Quaternion; s: number }> | null) {
    if (!a && !this.anim) return;
    this.anim = a;
    this.applyPose();
  }

  applyPose() {
    this.baseTouch.clear();
    // only a real change re-merges: sync() calls this on every look edit too
    const before = this.list.map((b) => b.pivot.quaternion.clone());
    const puffBefore = [...this.puffed].map((m) => m.scale.x).join();
    const pos = this.group.position.clone();
    for (const m of this.puffed) m.scale.x = m.scale.z = 1;
    this.puffed.clear();
    for (const b of this.list) {
      const q = this.state.pose[b.def.id];
      b.pivot.quaternion.copy(b.restQuat);
      if (q) b.pivot.quaternion.multiply(new THREE.Quaternion(...q));
      const a = this.anim?.get(b.def.id);
      if (a) {
        b.pivot.quaternion.multiply(a.q);
        // TODO(anim): eyes and attached stuff don't puff with the part
        if (b.mesh && a.s !== 1) {
          b.mesh.scale.x = b.mesh.scale.z = a.s;
          this.puffed.add(b.mesh);
        }
      }
    }
    if ([...this.puffed].map((m) => m.scale.x).join() !== puffBefore) this.mergeDirty = true;
    this.group.position.set(...this.state.rootOffset);
    if (!this.group.position.equals(pos) || this.list.some((b, i) => !b.pivot.quaternion.equals(before[i]))) this.mergeDirty = true;
  }

  capturePose() {
    const pose: CreatureState['pose'] = {};
    for (const b of this.list) {
      // the looping motion on top is left out
      const a = this.anim?.get(b.def.id);
      const posed = a ? b.pivot.quaternion.clone().multiply(a.q.clone().invert()) : b.pivot.quaternion;
      if (posed.angleTo(b.restQuat) > 1e-4) {
        const q = b.restQuat.clone().invert().multiply(posed);
        pose[b.def.id] = [q.x, q.y, q.z, q.w];
      }
    }
    this.state.pose = pose;
    this.state.rootOffset = this.group.position.toArray() as V3;
  }

  /** Where a bone is now, posed, in the skeleton's coordinates: its base, and the end of its straight line. */
  posedEnds(id: string): { start: V3; end: V3 } | undefined {
    const b = this.bones.get(id);
    if (!b) return undefined;
    this.group.updateMatrixWorld(true);
    const m = this.group.matrixWorld.clone().invert().multiply(b.pivot.matrixWorld);
    const at = (y: number) => new THREE.Vector3(0, y, 0).applyMatrix4(m).toArray() as V3;
    return { start: at(0), end: at(b.length) };
  }

  /**
   * A bone about to hang off `parentId` instead: the rigid move its rest frame
   * (and everything on it) needs to stay exactly where it is now, posed, under
   * the new parent. Null if nothing has to move. Column-major, in the
   * skeleton's coordinates.
   */
  rehangMove(id: string, parentId: string): number[] | null {
    const c = this.bones.get(id), p = this.bones.get(parentId);
    if (!c?.parent || !p) return null;
    this.group.updateMatrixWorld(true);
    const toGroup = this.group.matrixWorld.clone().invert();
    const inGroup = (o: THREE.Object3D) => toGroup.clone().multiply(o.matrixWorld);
    // where it sits now, leaving out its own pose (which it keeps)
    const here = inGroup(c.pivot.parent!).multiply(new THREE.Matrix4().compose(c.pivot.position, c.restQuat, new THREE.Vector3(1, 1, 1)));
    const local = inGroup(p.pivot).invert().multiply(here);
    // a bent parent carries its children along its curve (bendChild): take that back out
    const bd = bendOf(p.def, p.length);
    if (isBent(bd)) {
      const m = new THREE.Vector3().setFromMatrixPosition(local), t = m.clone();
      for (let i = 0; i < 8; i++) {
        const s = Math.min(bd.len, Math.max(0, t.y));
        const [x, y, z] = bendPoint(bd, 0, s, 0);
        t.set(m.x - x, m.y - (y - s), m.z - z);
      }
      local.setPosition(t);
    }
    const move = p.restWorld.clone().multiply(local).multiply(c.restWorld.clone().invert());
    return move.equals(new THREE.Matrix4()) ? null : move.elements.slice();
  }

  resetPose() {
    this.state.pose = {};
    this.state.rootOffset = [0, 0, 0];
    this.applyPose();
  }

  // -------------------------------------------------------------------------
  // merging: parts with the same color and material are fused with a smooth
  // union. Each vertex near a neighbouring part is moved onto the blended
  // surface (a fillet) and its normal is blended too, so the seam disappears.

  /** Recompute merged geometry if the pose or parts changed. Cheap when clean. Returns true if it did. */
  updateMerge(): boolean {
    if (!this.mergeDirty) return false;
    this.mergeDirty = false;
    // Only shape changes invalidate the settled skin; a look-only change
    // (material sliders, opacity, colors while blending, eyes...) just
    // re-dresses it.
    const key = this.skinShapeKey();
    if (key !== this.skinKey) {
      this.skinKey = key;
      this.invalidateSkin();
      this.mergeDirty = false; // merging right now anyway
    } else if (this.skinState === 'ready') {
      for (const sk of this.skins) this.dressSkin(sk);
    }
    const s = this.state;
    const on = s.merge ?? true;
    const k = s.mergeRadius ?? 0.1;
    // with color blending, parts of one material merge whatever their color
    const blend = on && !!s.mergeColors;
    const kc = blend ? (s.colorBlend ?? 0.12) : 0;
    this.root.updateMatrixWorld(true);
    this.rootInv.copy(this.root.matrixWorld).invert();

    const groups = new Map<string, BoneRT[]>();
    for (const b of this.list) {
      if (!b.mesh) continue;
      const p = s.parts[b.src];
      const key = (p.style ?? s.style) + (blend ? '' : p.color.toLowerCase());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }

    // parts under a finished skin are hidden: fused again once the skin goes
    const skinned = new Set(this.skinState === 'ready' ? this.skins.flatMap((sk) => sk.members) : []);
    // A frame only spends so long fusing (a creature with many touching parts
    // would otherwise make a drag stutter): the rest carry on next frame,
    // taking turns so every part catches up. Parts already follow their bones;
    // only a join's fillet can trail a frame or two.
    const work = [...groups.values()].flatMap((members) => members.map((b) => [b, members] as const));
    const start = performance.now();
    for (let w = 0; w < work.length; w++) {
      const at = (this.mergeCursor + w) % work.length;
      const deadline = start + MERGE_BUDGET_MS;
      if (w > 0 && performance.now() > deadline) {
        this.mergeCursor = at;
        this.mergeDirty = true;
        break;
      }
      const [b, members] = work[at];
      if (skinned.has(b)) continue;
      // a part re-bent live while it's resized shows just that, unfused, until it's rebuilt
      const live = b.mesh!.userData.liveGeo as THREE.BufferGeometry | undefined;
      if (live) {
        this.setMeshGeometry(b, live, false);
        continue;
      }
      const base = b.mesh!.userData.baseGeo as THREE.BufferGeometry;
      const nbrs = on && members.length > 1 ? members.filter((o) => o !== b && !o.mesh!.userData.liveGeo && this.blendable(b, o) && this.near(b, o, Math.max(k, kc))) : [];
      if (nbrs.length === 0) {
        this.setMeshGeometry(b, base, false);
        continue;
      }
      let g = b.mesh!.userData.mergeGeo as THREE.BufferGeometry | undefined;
      if (!g || g.userData.base !== base) {
        g?.dispose();
        g = base.clone();
        g.userData = { base };
        b.mesh!.userData.mergeGeo = g;
      }
      // only paint colors when a neighbour actually has a different color
      const myColor = s.parts[b.src].color.toLowerCase();
      const paint = blend && nbrs.some((o) => s.parts[o.src].color.toLowerCase() !== myColor);
      const done = this.fuse(b, base, g, nbrs, k, paint ? kc : 0, deadline);
      this.setMeshGeometry(b, g, paint);
      if (!done) {
        // out of time partway through this part: it goes first next frame
        this.mergeCursor = at;
        this.mergeDirty = true;
        break;
      }
    }
    return true;
  }

  markMergeDirty() {
    this.mergeDirty = true;
  }

  /** joins still waiting to be (fully) fused: updateMerge() has more to do */
  get mergePending(): boolean {
    return this.mergeDirty;
  }

  /**
   * Swap in base or fused geometry. When `painted`, color comes from the
   * per-vertex colors baked by fuse(), so materials switch to white * vertex color.
   */
  private setMeshGeometry(b: BoneRT, g: THREE.BufferGeometry, painted: boolean) {
    const mesh = b.mesh!;
    mesh.geometry = g;
    // ink hulls and fuzz shells follow the fused surface
    for (const c of mesh.children) if (c instanceof THREE.Mesh) c.geometry = g;
    const part = this.state.parts[b.src];
    const lowPoly = (part.style ?? this.state.style) === 'lowpoly';
    // body + fuzz shells (stray-hair lines keep their own per-hair colors)
    const mats = [mesh.material, ...mesh.children.filter((c) => c instanceof THREE.Mesh).map((c) => (c as THREE.Mesh).material)];
    for (const m of mats as THREE.MeshStandardMaterial[]) {
      if (!m || !('color' in m) || m.userData?.ink) continue;
      const want = painted || lowPoly;
      if (m.vertexColors !== want) {
        m.vertexColors = want;
        m.needsUpdate = true;
      }
      // back to the color the material was made with (not the plain part
      // color: glass, say, is only tinted by it), or white under baked colors
      m.userData.baseColor ??= m.color.clone();
      if (painted) m.color.setRGB(1, 1, 1);
      else m.color.copy(m.userData.baseColor as THREE.Color);
    }
    mesh.userData.painted = painted;
    this.glowPart(b);
  }

  /** A part's glow, on its mesh (tinted by baked colors when it has them). */
  private glowPart(b: BoneRT) {
    if (!b.mesh) return;
    const p = this.state.parts[b.src];
    setGlow(b.mesh, p.color, p.glow ?? 0, { painted: !!b.mesh.userData.painted, follow: p.glowFollow });
  }

  // -------------------------------------------------------------------------
  // seamless skin: when the creature is left alone, merged groups are rebuilt
  // as one continuous surface (see skin.ts); any change drops back to the fast
  // per-part merge above.

  /**
   * Skins put aside by invalidateSkin, by the shape they were built for (see
   * skinShapeKey), most recent last: undo, or a setting turned back, finds its
   * skin here instead of building it again.
   */
  private skinCache = new Map<string, SkinEntry[]>();
  /** the shape the current skins were built for */
  private skinsKey = '';
  /** the skins being built: how much work each is, and how far along */
  private skinWork: { w: number; done: number; lane: number }[] = [];
  /**
   * How far along building the skins is (0..1). Skins on different workers
   * build side by side, so it's the busiest worker that decides how long
   * it all takes: how much of its work is left.
   */
  get skinProgress(): number {
    const total = new Map<number, number>(), left = new Map<number, number>();
    for (const j of this.skinWork) {
      total.set(j.lane, (total.get(j.lane) ?? 0) + j.w);
      left.set(j.lane, (left.get(j.lane) ?? 0) + j.w * (1 - j.done));
    }
    const most = Math.max(0, ...total.values());
    return most > 0 ? 1 - Math.max(0, ...left.values()) / most : 0;
  }
  /** A skin for the shape as it is now is kept aside: settling costs nothing. */
  get skinKept(): boolean {
    return this.skinState === 'none' && this.skinCache.has(this.skinKey);
  }

  /** Drop the settled skin and show the individual parts again (it's kept aside for a while). */
  invalidateSkin() {
    this.skinVersion++;
    this.lastChange = performance.now();
    this.skinState = 'none';
    if (!this.skins.length) return;
    // the parts come back into view: they may have skipped merging meanwhile
    this.mergeDirty = true;
    for (const { mesh, members } of this.skins) {
      mesh.removeFromParent();
      for (const b of members) if (b.mesh) b.mesh.visible = true;
    }
    this.skinCache.delete(this.skinsKey);
    this.skinCache.set(this.skinsKey, this.skins);
    this.skins = [];
    // a few skins, and not too big all together
    const verts = (sks: SkinEntry[]) => sks.reduce((n, sk) => n + sk.mesh.geometry.getAttribute('position').count, 0);
    let total = [...this.skinCache.values()].reduce((n, sks) => n + verts(sks), 0);
    for (const [key, sks] of this.skinCache) {
      if (this.skinCache.size <= 4 && total <= 1.5e6) break;
      this.skinCache.delete(key);
      total -= verts(sks);
      disposeSkins(sks);
    }
  }

  /** Build seamless skins for every merged group. Resolves false if interrupted. */
  async settle(): Promise<boolean> {
    const s = this.state;
    if (this.skinState !== 'none' || !(s.merge ?? true) || !seamlessOn(s) || this.drawFocus) return false;
    const key = this.skinShapeKey();
    // built for this very shape before: just put it back (if its parts are all still here)
    const kept = this.skinCache.get(key);
    if (kept) {
      this.skinCache.delete(key);
      if (kept.every((sk) => sk.owners.every((b) => this.list.includes(b) && b.mesh))) {
        for (const sk of kept) {
          this.group.add(sk.mesh);
          this.dressSkin(sk);
        }
        this.skins = kept;
        this.skinsKey = key;
        this.skinState = 'ready';
        return true;
      }
      disposeSkins(kept);
    }
    const version = this.skinVersion;
    this.skinState = 'building';
    this.skinWork = [];
    this.root.updateMatrixWorld(true);
    this.rootInv.copy(this.root.matrixWorld).invert();
    const toGroup = this.group.matrixWorld.clone().invert();
    const kMax = s.mergeRadius ?? 0.1;
    const blend = !!s.mergeColors;
    const kc = blend ? (s.colorBlend ?? 0.12) : 0;

    // same groups as the fast merge: one material (and one color unless blending)
    const groups = new Map<string, BoneRT[]>();
    for (const b of this.list) {
      if (!b.mesh) continue;
      const p = s.parts[b.src];
      const key = (p.style ?? s.style) + (blend ? '' : p.color.toLowerCase());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }
    const radius = (b: BoneRT) => {
      const sol = (b.mesh!.userData.baseGeo as THREE.BufferGeometry).userData.solid as Solid | undefined;
      let m = 0;
      if (sol) for (let i = 2; i < sol.spheres.length; i += 3) m = Math.max(m, sol.spheres[i]);
      return Math.max(0.01, m * Math.min(1, sol?.thickness ?? 1));
    };

    // flat and turned parts keep their crisp edges (the skin's grid would
    // round them off): they stay their own meshes, fused at their joins
    const crisp = (b: BoneRT) => (s.parts[b.src].kind ?? 'puffy') !== 'puffy';

    const built: SkinEntry[] = [];
    const jobs: Promise<Omit<SkinEntry, 'mesh' | 'painted' | 'colorKey'> & { geo: THREE.BufferGeometry | null }>[] = [];
    for (const [, members] of groups) {
      // only parts that actually touch another part in the group
      const joined = members.filter((b) => !crisp(b) && members.some((o) => o !== b && !crisp(o) && this.blendable(b, o) && this.near(b, o, kMax)));
      if (joined.length < 2) continue;
      const part = s.parts[joined[0].src];
      const style = part.style ?? s.style;
      const k = this.settingsFor(style);
      const minR = Math.min(...joined.map(radius));
      const lowPoly = style === 'lowpoly';
      const textured = isTextured(style);
      // low-poly keeps its own parts (and fast joins) unless the setting says otherwise
      if (lowPoly && !seamlessLowPoly) continue;
      // low-poly is built smooth like the rest, then re-faceted to each part's own facet size
      // a coarser grid with less mesh detail (Settings > Performance)
      const h = Math.min(0.02, Math.max(0.006, minR / 2.5)) / Math.sqrt(getMeshDetail());

      // clay lumps go back on after the skin is built
      const lumps = style === 'clay' || style === 'stone' ? ((style === 'clay' ? k.lumps : k.rugged) ?? 0) * Math.min(0.012, Math.max(0.004, minR * 0.08)) : 0;
      const onlyConnected = blendWithOf(s) !== 'all';

      // Parts that don't blend but press together closer than the grid can
      // keep apart would fuse anyway: the one reaching in is peeled off into a
      // skin of its own (built with the parts it blends into: the one it grows
      // from, and with Neighbors any its base sits in).
      const peels = onlyConnected ? this.peelsFor(joined, h) : [];
      const peeled = new Set(peels.flat());
      const rest = joined.filter((b) => !peeled.has(b));
      const sets: { members: BoneRT[]; bases: BoneRT[] }[] = [
        { members: rest.filter((b) => rest.some((o) => o !== b && this.blendable(b, o) && this.near(b, o, kMax))), bases: [] },
        // two peeled parts blending into each other: the join is the first one's
        ...peels.map((sub, i) => ({ members: sub, bases: joined.filter((o) => !sub.includes(o) && !peels.slice(0, i).some((p) => p.includes(o)) && sub.some((b) => this.blendable(b, o) && this.near(b, o, kMax))) })),
      ];

      for (const { members: shown, bases } of sets) {
        // crisp parts joined to these blend into the skin from their side; the skin meets them halfway
        const beside = members.filter((o) => crisp(o) && [...shown, ...bases].some((b) => this.blendable(b, o) && this.near(b, o, kMax)));
        const all = [...bases, ...shown, ...beside];
        if (shown.length + bases.length < 2) continue;
        // a part drawn as several shapes joins in as each of them
        const owners: BoneRT[] = [];
        const parts: SkinPart[] = all.flatMap((b) => {
          const geos = (b.mesh!.userData.skinGeos as (() => THREE.BufferGeometry[]) | undefined)?.() ?? [b.mesh!.userData.baseGeo as THREE.BufferGeometry];
          owners.push(...geos.map(() => b));
          return geos.map((geo) => ({
            geo,
            toSkin: toGroup.clone().multiply(b.mesh!.matrixWorld),
            // textured materials lay their textures out in the rest pose
            toRest: textured ? b.restGroup.clone().multiply(b.mesh!.matrix) : undefined,
            color: this.shownColor(b),
            glow: s.parts[b.src].glow ?? 0,
            k: Math.max(0.005, Math.min(kMax, 0.6 * radius(b))),
            facet: geo.userData.facet as number | undefined,
          }));
        });
        const linked = onlyConnected ? (a: number, b: number) => this.blendable(owners[a], owners[b]) : undefined;
        const keep = bases.length || beside.length ? owners.map((o) => (bases.includes(o) ? 0 : beside.includes(o) ? 2 : 1)) : undefined;
        // no lumps under the eyes (they sit on the smooth shape: see flattenUnderEyes)
        const eyes = lumps
          ? shown.flatMap((b) => {
              const toSkin = toGroup.clone().multiply(b.mesh!.matrixWorld);
              const sc = new THREE.Vector3().setFromMatrixScale(toSkin);
              const scale = (sc.x + sc.y + sc.z) / 3;
              return (this.eyeSpots.get(b.def.id) ?? []).map((sp) => {
                const at = new THREE.Vector3(sp.x, sp.y, sp.z).applyMatrix4(toSkin);
                return { x: at.x, y: at.y, z: at.z, r: (sp.eye ?? sp.r) * scale };
              });
            })
          : undefined;
        // every skin builds at once (on its own worker: see skinPool)
        const lane = this.state.name + '|' + shown.map((b) => b.def.id).join();
        // its share of the progress: about as much work as it has surface, in grid cells
        const work = { w: 0, done: 0, lane: laneOf(lane) };
        for (const p of parts) {
          if (!p.geo.boundingBox) p.geo.computeBoundingBox();
          const sz = p.geo.boundingBox!.getSize(new THREE.Vector3());
          work.w += (2 * (sz.x * sz.y + sz.y * sz.z + sz.z * sz.x)) / (h * h);
        }
        this.skinWork.push(work);
        const progress = (d: number) => (work.done = Math.max(work.done, d));
        jobs.push(
          buildSkinOff(parts, { h, colorBlend: kc, lowPoly, lumps, eyes, linked, keep, progress, shouldStop: () => version !== this.skinVersion }, lane).then((geo) => ((work.done = 1), {
            geo,
            members: shown,
            owners,
            parts,
            lowPoly,
            peeled: bases.length > 0,
          })),
        );
      }
    }
    const done = await Promise.all(jobs);
    if (version !== this.skinVersion) {
      // something changed meanwhile: it'll be retried once things settle again
      for (const { geo } of done) geo?.dispose();
      return false;
    }
    for (const { geo, ...sk } of done) {
      // this group couldn't be skinned: its parts just stay fast-merged (never retry
      // in a loop; the skin is only attempted again after the next change)
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo);
      mesh.receiveShadow = true;
      mesh.raycast = () => {}; // picking still goes to the (hidden) parts
      mesh.userData.skin = true;
      built.push({
        ...sk,
        mesh,
        painted: !!geo.userData.painted,
        colorKey: JSON.stringify([sk.parts.map((p) => [p.color.getHex(), p.glow]), kc]),
      });
    }

    // swap: skins in (dressed in the current look), their parts out
    for (const sk of built) {
      this.group.add(sk.mesh);
      this.dressSkin(sk);
    }
    this.skins = built;
    this.skinsKey = key;
    this.skinState = 'ready';
    return true;
  }

  /**
   * What a skin's shape depends on. Anything else (material sliders that
   * don't reshape, opacity, eyes, stuff, colors while blending) only needs
   * the existing skin re-dressed, not rebuilt.
   */
  private skinShapeKey(): string {
    const s = this.state;
    const blend = !!s.mergeColors;
    const r4 = (v: number) => Math.round(v * 1e4);
    return JSON.stringify([
      s.merge ?? true,
      seamlessOn(s),
      seamlessLowPoly,
      // the skin's grid is as fine as the parts' meshes
      getMeshDetail(),
      s.mergeRadius,
      blend,
      blendWithOf(s),
      s.rig,
      // eyes flatten clay lumps under them (on anything else they're only dressing)
      [...this.eyeSpots].filter(([id]) => this.bones.get(id)?.mesh?.userData.lumpyGeo).map(([id, spots]) => [id, spots.map((sp) => [sp.x, sp.y, sp.z, sp.r].map(r4))]),
      // (not the root offset: the skin is built in the group's own space, so moving the whole creature leaves it as it is)
      this.list.map((b) => b.pivot.quaternion.toArray().map(r4)),
      [...this.puffed].map((m) => r4(m.scale.x)),
      Object.entries(s.parts).map(([id, p]) => {
        const style = p.style ?? s.style;
        const k = this.settingsFor(style);
        // clay lumps and low-poly facet size change the shape; with blending off, color changes the groups
        return [id, partShapes(p), p.thickness, p.kind, style, style === 'clay' ? k.lumps : style === 'stone' ? k.rugged : 0, style === 'lowpoly' ? k.facets : 0, blend ? '' : p.color.toLowerCase()];
      }),
    ]);
  }

  /** Give a skin the current look: colors, material, felt fuzz, toon ink, opacity. */
  private dressSkin(sk: SkinEntry) {
    const s = this.state;
    const part = s.parts[sk.members[0].src];
    const style = part.style ?? s.style;
    const k = this.settingsFor(style);
    const kc = s.mergeColors ? (s.colorBlend ?? 0.12) : 0;

    // repaint only if the colors (or the fade width) changed
    sk.parts.forEach((p, i) => {
      p.color.copy(this.shownColor(sk.owners[i]));
      p.glow = s.parts[sk.owners[i].src].glow ?? 0;
    });
    const colorKey = JSON.stringify([sk.parts.map((p) => [p.color.getHex(), p.glow]), kc]);
    if (colorKey !== sk.colorKey) {
      sk.painted = paintSkin(sk.mesh.geometry, sk.parts, kc, sk.lowPoly);
      sk.colorKey = colorKey;
    }

    // nothing about the look changed (e.g. another part was edited): keep the
    // current dressing; rebuilding felt fuzz and stray hairs is expensive
    // a skin glows from where its first glowing part does
    const follow = sk.owners.map((b) => s.parts[b.src]).find((p) => p.glow)?.glowFollow;
    const lookKey = JSON.stringify([style, part.color, part.glow ?? 0, follow, k, part.opacity ?? 1, sk.painted, colorKey, [...this.eyeSpots]]);
    if (lookKey === sk.lookKey) {
      for (const b of sk.members) if (b.mesh) b.mesh.visible = false;
      return;
    }
    sk.lookKey = lookKey;

    const mesh = sk.mesh;
    for (const c of [...mesh.children]) {
      mesh.remove(c);
      c.traverse((o) => {
        ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
        if (o instanceof THREE.LineSegments) o.geometry.dispose();
      });
    }
    (mesh.material as THREE.Material | undefined)?.dispose();
    const geo = mesh.geometry;
    const mat = makeMaterial(style, part.color, k) as THREE.MeshStandardMaterial;
    if (geo.getAttribute('color')) {
      mat.vertexColors = true;
      if (sk.painted) mat.color.setRGB(1, 1, 1);
    }
    if (sk.peeled) {
      // where it flattens onto the skin underneath, it wins rather than flickering
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -1;
    }
    mesh.material = mat;
    mesh.castShadow = mesh.receiveShadow = castsShadow(style);
    if (style === 'toon' && k.ink > 0) {
      const ink = new THREE.Mesh(geo, makeOutlineMaterial(k.ink, false, k));
      ink.raycast = () => {};
      mesh.add(ink);
    }
    if (style === 'felt') {
      for (const shell of makeFuzzShells(geo, part.color, k)) {
        if (sk.painted) {
          // fuzz takes the skin's blended colors, not the first part's
          const sm = shell.material as THREE.MeshStandardMaterial;
          sm.vertexColors = true;
          sm.color.setRGB(1, 1, 1);
        }
        mesh.add(shell);
      }
      if (k.hairs > 0) mesh.add(makeStrayHairs(geo, part.color, 11, k.hairs, sk.painted, 1, k.fuzz));
    }
    setOpacity(mesh, part.opacity ?? 1);
    // parts that glow differently carry their glow per point
    const attr = !!geo.getAttribute('glow');
    setGlow(mesh, part.color, attr ? 1 : (part.glow ?? 0), { painted: sk.painted, attr, follow });
    // laid out from the rest positions the skin was built with
    if (geo.getAttribute('restPos')) setTextureSpace(mesh, 'attributes');

    // parts may have been rebuilt (new meshes) by the look change: keep them hidden
    for (const b of sk.members) if (b.mesh) b.mesh.visible = false;

    // keep felt fuzz off the eyes on the skin too
    const eyed = sk.members.filter((b) => b.mesh && this.eyeSpots.get(b.def.id)?.length);
    if (eyed.length) {
      this.group.updateMatrixWorld(true);
      const fromGroup = this.group.matrixWorld.clone().invert();
      const v = new THREE.Vector3();
      setFuzzMask(mesh, eyed.flatMap((b) => {
        const toSkin = fromGroup.clone().multiply(b.mesh!.matrixWorld);
        return this.eyeSpots.get(b.def.id)!.map((sp) => (v.set(sp.x, sp.y, sp.z).applyMatrix4(toSkin), { x: v.x, y: v.y, z: v.z, r: sp.r }));
      }));
    } else {
      setFuzzMask(mesh, []);
    }
  }

  /** A part's color as its material shows it (see surfaceColor). */
  private shownColor(b: BoneRT): THREE.Color {
    const p = this.state.parts[b.src];
    const style = p.style ?? this.state.style;
    return surfaceColor(style, p.color, this.settingsFor(style));
  }

  /**
   * A part's mesh relative to the creature's placement (root), so merging
   * works the same however the creature is moved, turned or resized.
   */
  private rootInv = new THREE.Matrix4();
  private rel(o: THREE.Object3D): THREE.Matrix4 {
    return this.rootInv.clone().multiply(o.matrixWorld);
  }

  /**
   * The parts blended into one with this one: same material (and color,
   * unless colors blend), touching through a chain. A seamless skin shows
   * them as one surface, so they share one opacity. Returns part (drawing) ids.
   */
  blendedWith(id: string): string[] {
    const start = this.bones.get(id);
    if (!start?.mesh) return start ? [start.src] : [];
    const s = this.state;
    const blend = !!s.mergeColors;
    const k = Math.max(s.mergeRadius ?? 0.1, blend ? (s.colorBlend ?? 0.12) : 0);
    if (!(s.merge ?? true) || k <= 0) return [start.src];
    const key = (b: BoneRT) => {
      const p = s.parts[b.src];
      return (p.style ?? s.style) + (blend ? '' : p.color.toLowerCase());
    };
    this.root.updateMatrixWorld(true);
    this.rootInv.copy(this.root.matrixWorld).invert();
    const same = this.list.filter((b) => b.mesh && key(b) === key(start));
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const a = queue.pop()!;
      for (const b of same) if (!seen.has(b) && this.blendable(a, b) && this.near(a, b, k)) (seen.add(b), queue.push(b));
    }
    return [...new Set([...seen].map((b) => b.src))];
  }

  /**
   * Grade every pair of parts in a skin group that don't blend by how close
   * they come. Apart, or a near miss the grid can still show as a gap: one
   * skin keeps them separate. A tight contact (closer than a couple of grid
   * cells, or pressed into each other) would fuse on the grid, so the part
   * reaching in, the one whose base or tip is nearer the contact, is peeled
   * off. Returns each peeled part followed by the parts growing from it.
   */
  private peelsFor(joined: BoneRT[], h: number): BoneRT[][] {
    const s = this.state;
    const gap = 2 * h;
    const picked = new Set<BoneRT>();
    for (let i = 0; i < joined.length; i++) {
      for (let j = i + 1; j < joined.length; j++) {
        const a = joined[i], b = joined[j];
        if (this.blendable(a, b) || !this.near(a, b, gap)) continue;
        const at = this.contact(a, b, gap);
        if (!at) continue;
        const pick = this.reachingIn(a, b, at);
        if (pick) picked.add(pick);
      }
    }
    const grows = (b: BoneRT, from: BoneRT) => {
      for (let p = b.parent; p; p = p.parent) if (p === from) return true;
      return false;
    };
    // a part growing from one already peeled goes with it
    const tops = [...picked].filter((r) => ![...picked].some((o) => o !== r && grows(r, o)));
    return tops.map((r) => [r, ...joined.filter((b) => grows(b, r))]);
  }

  /** Where two parts come within `gap` of each other (the middle of it, in world space), or null. */
  private contact(a: BoneRT, b: BoneRT, gap: number): THREE.Vector3 | null {
    const sum = new THREE.Vector3();
    let count = 0;
    const toGroup = this.group.matrixWorld.clone().invert();
    const v = new THREE.Vector3(), g = new THREE.Vector3(), sc = new THREE.Vector3();
    const from = (x: BoneRT, y: BoneRT) => {
      const gx = x.mesh!.userData.baseGeo as THREE.BufferGeometry;
      const gy = y.mesh!.userData.baseGeo as THREE.BufferGeometry;
      const toY = y.mesh!.matrixWorld.clone().invert().multiply(x.mesh!.matrixWorld);
      // the gap in y's own units
      sc.setFromMatrixScale(toGroup.clone().multiply(y.mesh!.matrixWorld));
      const reach = gap / ((sc.x + sc.y + sc.z) / 3);
      const bvh = bvhFor(gy), normals = sharedNormals(gy);
      const P = gx.getAttribute('position');
      const step = Math.max(1, Math.floor(P.count / 4000));
      for (let i = 0; i < P.count; i += step) {
        v.fromBufferAttribute(P, i).applyMatrix4(toY);
        if (exactDistance(gy, bvh, normals, v, reach, g) < reach) {
          sum.add(v.applyMatrix4(y.mesh!.matrixWorld));
          count++;
        }
      }
    };
    from(a, b);
    from(b, a);
    return count ? sum.divideScalar(count) : null;
  }

  /**
   * Of two parts in contact at `at`, the one reaching into the other: whose
   * base or tip is nearer the contact, for its length (a hand gripping a
   * leg, not the leg it grips). The first part of a creature never is.
   */
  private reachingIn(a: BoneRT, b: BoneRT, at: THREE.Vector3): BoneRT | null {
    const grade = (x: BoneRT) => {
      if (!x.parent) return Infinity;
      const base = x.pivot.getWorldPosition(new THREE.Vector3());
      const tip = x.tip.getWorldPosition(new THREE.Vector3());
      return Math.min(at.distanceTo(base), at.distanceTo(tip)) / Math.max(1e-3, base.distanceTo(tip));
    };
    const ga = grade(a), gb = grade(b);
    if (!Number.isFinite(ga) && !Number.isFinite(gb)) return null;
    return ga <= gb ? a : b;
  }

  /** Whether two parts may blend into each other (see BlendWith). */
  private blendable(a: BoneRT, b: BoneRT): boolean {
    const mode = blendWithOf(this.state);
    if (mode === 'all' || a === b || a.parent === b || b.parent === a) return true;
    return mode === 'neighbors' && (this.baseIn(a, b) || this.baseIn(b, a));
  }

  /** Answers of baseIn, until the pose or the parts change. */
  private baseTouch = new Map<BoneRT, Map<BoneRT, boolean>>();
  /**
   * Whether part `a`'s base sits in part `b`, as posed: the start of `a` (as
   * thick as `a` is there) overlaps or rests on `b`. What makes them neighbors (see
   * BlendWith). Not the blend distance: turned up, that reaches across to
   * parts that only pass by, like crossed arms' hands at each other's elbows.
   */
  private baseIn(a: BoneRT, b: BoneRT): boolean {
    let row = this.baseTouch.get(a);
    if (!row) this.baseTouch.set(a, (row = new Map()));
    const known = row.get(b);
    if (known !== undefined) return known;
    // with half its thickness to spare: a base resting on a part's surface counts
    const touches = this.reachAt(a, b) < 1.5 * Math.max(0, -this.reachAt(a, a));
    row.set(b, touches);
    return touches;
  }

  /** How far part `a`'s base is from part `b`'s surface, in creature units (negative inside, Infinity when far). */
  private reachAt(a: BoneRT, b: BoneRT): number {
    const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
    if (!geo) return Infinity;
    this.group.updateMatrixWorld(true);
    const q = a.pivot.getWorldPosition(new THREE.Vector3()).applyMatrix4(b.mesh!.matrixWorld.clone().invert());
    const sc = new THREE.Vector3().setFromMatrixScale(this.group.matrixWorld.clone().invert().multiply(b.mesh!.matrixWorld));
    const scale = (sc.x + sc.y + sc.z) / 3;
    return exactDistance(geo, bvhFor(geo), sharedNormals(geo), q, 1 / scale, new THREE.Vector3()) * scale;
  }

  private near(a: BoneRT, b: BoneRT, k: number): boolean {
    const ga = a.mesh!.userData.baseGeo as THREE.BufferGeometry;
    const gb = b.mesh!.userData.baseGeo as THREE.BufferGeometry;
    const ca = ga.boundingSphere!.center.clone().applyMatrix4(this.rel(a.mesh!));
    const cb = gb.boundingSphere!.center.clone().applyMatrix4(this.rel(b.mesh!));
    return ca.distanceTo(cb) < ga.boundingSphere!.radius + gb.boundingSphere!.radius + k;
  }

  /**
   * Fuse this part's surface into its neighbours (smooth-min fillet) and,
   * when `kc` > 0, bake a color gradient that meets 50/50 at the seam.
   */
  private fuse(b: BoneRT, base: THREE.BufferGeometry, out: THREE.BufferGeometry, nbrs: BoneRT[], kMax: number, kc: number, deadline = Infinity): boolean {
    const solidA = base.userData.solid as Solid;
    const maxR = (sol: Solid) => {
      let m = 0;
      for (let i = 2; i < sol.spheres.length; i += 3) m = Math.max(m, sol.spheres[i]);
      return m * Math.min(1, sol.thickness);
    };
    const rA = maxR(solidA);
    const own = this.shownColor(b);
    // Color fades are measured a bit wider than asked (up to the slider's
    // top), so dragging the fade slider only redoes colors, not the shape.
    const reach = kc > 0 ? Math.max(kc, Math.min(0.4, 2 * kc)) : 0;

    // "world" here is the creature's own placement space (see rel)
    const toWorld = this.rel(b.mesh!);
    const toLocal = toWorld.clone().invert();

    const rotW = new THREE.Matrix3().setFromMatrix4(toWorld);
    const rotL = new THREE.Matrix3().setFromMatrix4(toLocal);
    const myKey = this.state.parts[b.src].color.toLowerCase();
    const r6 = (v: number) => v.toFixed(6);
    const all = nbrs.map((o) => {
      const g = o.mesh!.userData.baseGeo as THREE.BufferGeometry;
      const solid = g.userData.solid as Solid;
      // keep fillets in proportion: a thin antenna shouldn't get a huge blob
      const k = Math.max(0.005, Math.min(kMax, 0.6 * Math.min(rA, maxR(solid))));
      const oWorld = this.rel(o.mesh!);
      // from this part's own space into the neighbour's
      const toO = oWorld.clone().invert().multiply(toWorld);
      const colorKey = this.state.parts[o.src].color.toLowerCase();
      return {
        id: o.def.id,
        geo: g,
        k,
        toO,
        rot: new THREE.Matrix3().setFromMatrix4(oWorld),
        // what this neighbour's distances depend on: its shape and where it sits relative to us
        fieldKey: [g.uuid, ...toO.elements.map(r6)].join(','),
        color: this.shownColor(o),
        // same-colored neighbours don't tint
        tints: kc > 0 && colorKey !== myKey,
      };
    });

    // Each neighbour's distance field over this part's vertices is remembered,
    // and only worked out again when that neighbour moved relative to us (or
    // the color fade reaches further than it was measured). Gradients are kept
    // in this part's own space, so they hold however the pair is carried round.
    type Field = { key: string; maxD: number; f: Float32Array; g: Float32Array };
    const old = (out.userData.fields as Map<string, Field> | undefined) ?? new Map<string, Field>();
    // fast setting, mid-drag: joins that moved are left unfused until it's over
    const dragUnfused = this.dragging && this.dragUnfused;
    const others = dragUnfused ? all.filter((o) => old.get(o.id)?.key === o.fieldKey) : all;
    const skipped = others.length < all.length;

    // Nothing this part's fused shape depends on has changed (posing a leg
    // leaves every join it isn't in as it was): keep it. Narrowed fades and
    // unfused joins from a drag are put back once it's over.
    const relKey = [base.uuid, kMax, kc, own.getHex(), ...others.flatMap((o) => [o.id, o.fieldKey, o.color.getHex()])].join(';');
    if (out.userData.relKey === relKey && !(out.userData.narrow && !this.dragging)) return true;

    const p0 = base.getAttribute('position') as THREE.BufferAttribute;
    // shared-corner normals so split (low-poly) vertices all move the same way
    const n0 = sharedNormals(base);
    const p1 = out.getAttribute('position') as THREE.BufferAttribute;
    const n1 = out.getAttribute('normal') as THREE.BufferAttribute;
    // low-poly keeps its per-facet shading variation underneath the tint
    const jitter = base.getAttribute('color') as THREE.BufferAttribute | undefined;
    let c1 = out.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (kc > 0 && !c1) {
      c1 = new THREE.BufferAttribute(new Float32Array(p0.count * 3), 3);
      out.setAttribute('color', c1);
    }
    const pw = new THREE.Vector3(), nw = new THREE.Vector3(), q = new THREE.Vector3();
    const grad = new THREE.Vector3(), gw = new THREE.Vector3(), gsum = new THREE.Vector3();
    const col = new THREE.Color();

    // per neighbour: how wide its color fade is this time
    const fades: number[] = [];
    const fields = new Map<string, Field>();
    const rel = new THREE.Matrix3();
    let complete = true;
    for (const o of others) {
      // only a neighbour that tints needs measuring out to the fade's reach
      // (anything deeper inside than k is left as it is either way)
      let maxD = o.tints ? Math.max(o.k, reach) : o.k;
      let fld = old.get(o.id);
      // mid-drag, a join that moved (or was already narrowed) is measured
      // only as far as its fillet, and its colors fade across just that
      if (this.dragging && o.tints && (!fld || fld.key !== o.fieldKey || fld.maxD < maxD)) maxD = o.k;
      fades.push(o.tints ? Math.min(kc, maxD) : 0);
      const stale = !fld || fld.key !== o.fieldKey || fld.maxD < maxD;
      if (stale && fld && performance.now() > deadline) {
        // out of time: last frame's field stands in until it's measured again
        complete = false;
      } else if (stale) {
        fld = { key: o.fieldKey, maxD, f: new Float32Array(p0.count).fill(Infinity), g: new Float32Array(p0.count * 3) };
        const box = o.geo.boundingBox!.clone().expandByScalar(maxD);
        const bvh = bvhFor(o.geo);
        const normals = sharedNormals(o.geo);
        // neighbour's directions into ours
        rel.copy(rotL).multiply(o.rot);
        for (let i = 0; i < p0.count; i++) {
          q.fromBufferAttribute(p0, i).applyMatrix4(o.toO);
          if (!box.containsPoint(q)) continue;
          // exact signed distance to the neighbour's real surface, so both sides build the same fillet
          const f = exactDistance(o.geo, bvh, normals, q, maxD, grad);
          fld.f[i] = f;
          if (f < Infinity) grad.applyMatrix3(rel).toArray(fld.g, i * 3);
        }
      }
      fields.set(o.id, fld!);
    }
    out.userData.fields = fields;
    const F = others.map((o) => fields.get(o.id)!);

    const n = others.length;
    const paint = (i: number) => {
      col.copy(own);
      for (let j = 0; j < n; j++) {
        const o = others[j];
        const f = F[j].f[i];
        const fade = fades[j];
        if (o.tints && f < fade) {
          // 50/50 at the seam, fading to our own color kc away from it
          const t = Math.min(1, Math.max(0, 1 - f / fade));
          col.lerp(o.color, 0.5 * t * t * (3 - 2 * t));
        }
      }
      const jv = jitter ? jitter.getX(i) : 1;
      c1!.setXYZ(i, col.r * jv, col.g * jv, col.b * jv);
    };

    for (let i = 0; i < p0.count; i++) {
      pw.fromBufferAttribute(p0, i).applyMatrix4(toWorld);
      nw.fromBufferAttribute(n0, i).applyMatrix3(rotW).normalize();
      // running smooth-min of (this surface = 0, each neighbour's distance)
      let d = 0;
      gsum.copy(nw);
      let touched = false;
      for (let j = 0; j < n; j++) {
        const o = others[j];
        const f = F[j].f[i];
        if (f >= o.k) continue;
        gw.fromArray(F[j].g, i * 3).applyMatrix3(rotW).normalize();
        const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (f - d)) / o.k));
        d = f * (1 - h) + d * h - o.k * h * (1 - h);
        gsum.multiplyScalar(h).addScaledVector(gw, 1 - h);
        touched = true;
      }
      if (c1) {
        if (kc > 0) paint(i);
        else {
          const jv = jitter ? jitter.getX(i) : 1;
          c1.setXYZ(i, jv, jv, jv);
        }
      }
      if (!touched) {
        p1.setXYZ(i, p0.getX(i), p0.getY(i), p0.getZ(i));
        n1.setXYZ(i, n0.getX(i), n0.getY(i), n0.getZ(i));
        continue;
      }
      // Deep inside a neighbour: leave it hidden. In the blend band: one
      // Newton step onto the fused surface.
      const kk = others[0].k;
      const w = 1 - Math.min(1, Math.max(0, (-d - 0.3 * kk) / (0.5 * kk)));
      const g2 = Math.max(gsum.lengthSq(), 0.05);
      let step = (-d / g2) * w;
      step = Math.max(-kk, Math.min(kk * 1.5, step));
      pw.addScaledVector(gsum, step);
      nw.lerp(gsum.normalize(), w).normalize();
      pw.applyMatrix4(toLocal);
      nw.applyMatrix3(rotL).normalize();
      p1.setXYZ(i, pw.x, pw.y, pw.z);
      n1.setXYZ(i, nw.x, nw.y, nw.z);
    }
    p1.needsUpdate = true;
    n1.needsUpdate = true;
    if (c1) c1.needsUpdate = true;
    out.computeBoundingSphere();
    out.userData.relKey = complete ? relKey : undefined;
    out.userData.narrow = skipped || fades.some((fd, j) => others[j].tints && fd < kc);
    return complete;
  }

  // -------------------------------------------------------------------------
  // eyes

  /** The bones an eye pair sits on: its own part (both sides of a mirrored one), or else the head. */
  eyeBones(pair: EyePair): BoneRT[] {
    const on = pair.bone ? this.list.filter((b) => b.src === pair.bone) : [];
    const head = this.bones.get(this.rig.headId);
    return on.length ? on : head ? [head] : [];
  }

  private syncEyes() {
    const e = this.state.eyes;
    const used = [...new Set(e.pairs.flatMap((p) => this.eyeBones(p)))];
    const key = JSON.stringify([e, used.map((b) => [b.def.id, b.meshKey, b.length, this.rollTurn(b).toArray()]), this.state.style, this.state.materialSettings]);
    if (key === this.eyesKey) return;
    this.eyesKey = key;
    this.mergeDirty = true;
    for (const g of this.eyes) g.removeFromParent();
    this.eyes = [];
    // felt: clear fuzz from under the eyes (reset first; refilled below); clay: lumps back
    for (const b of this.list) if (b.mesh) (setFuzzMask(b.mesh, []), this.flattenUnderEyes(b, []));
    // the seamless skin reads these too: no eyes, no bare patches
    this.eyeSpots = new Map();
    if (!e.enabled) return;
    const groups = new Map<BoneRT, THREE.Group>();
    for (const [pairIndex, pair] of e.pairs.entries()) {
      for (const b of this.eyeBones(pair)) {
        if (!b.mesh) continue;
        let group = groups.get(b);
        if (!group) {
          group = new THREE.Group();
          groups.set(b, group);
          b.pivot.add(group);
          this.eyes.push(group);
          this.eyeSpots.set(b.def.id, []);
        }
        this.placeEyes(b, pair, pairIndex, group, this.eyeSpots.get(b.def.id)!);
      }
    }
    for (const [b] of groups) {
      setFuzzMask(b.mesh!, this.eyeSpots.get(b.def.id)!);
      this.flattenUnderEyes(b, this.eyeSpots.get(b.def.id)!);
    }
  }

  /**
   * Clay and stone: ease a part's lumps out under its eyes, so each eye sits
   * on the smooth shape it was placed on (not sunk into a lump, or tipped off
   * one). No spots puts every lump back.
   */
  private flattenUnderEyes(b: BoneRT, spots: FuzzSpot[]) {
    const mesh = b.mesh!;
    const lumpy = mesh.userData.lumpyGeo as THREE.BufferGeometry | undefined;
    if (!lumpy) return;
    let geo = lumpy;
    if (spots.length) {
      const smooth = (mesh.userData.smoothGeo as () => THREE.BufferGeometry)();
      const A = lumpy.getAttribute('position'), S = smooth.getAttribute('position');
      if (A.count === S.count) {
        geo = lumpy.clone();
        const P = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < P.count; i++) {
          const x = S.getX(i), y = S.getY(i), z = S.getZ(i);
          let w = 1;
          for (const sp of spots) w *= lumpFade(Math.hypot(x - sp.x, y - sp.y, z - sp.z), sp.eye ?? sp.r);
          P.setXYZ(i, x + (A.getX(i) - x) * w, y + (A.getY(i) - y) * w, z + (A.getZ(i) - z) * w);
        }
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
      }
    }
    const old = mesh.userData.baseGeo as THREE.BufferGeometry;
    if (old === geo) return;
    // the part (and its ink outline) show it; joins are rebuilt from it
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry === old) o.geometry = geo;
    });
    if (mesh.geometry === old) mesh.geometry = geo;
    mesh.userData.baseGeo = geo;
    if (old !== lumpy) old.dispose();
    this.mergeDirty = true;
  }

  /**
   * How far rolling has turned a part from where it was drawn, in skeleton
   * space: its own roll, and each roll above it (rolling a part carries
   * everything hanging off it round its length). Root-most first, each about
   * the rolled part's axis as it is now.
   */
  private rollTurn(part: BoneRT): THREE.Quaternion {
    const q = new THREE.Quaternion();
    for (let b: BoneRT | null = part; b; b = b.parent) {
      const r = (b.def.roll ?? 0) * (b.def.sideSign === -1 ? -1 : 1);
      if (!r) continue;
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(b.restWorld);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(axis, r));
    }
    return q;
  }

  /**
   * How a pair placed by hand mirrors on a part (in its own frame): across the
   * creature's left-right, through the part's middle. A part may be laid out
   * with its own sideways axis pointing anywhere (a head built facing up), so
   * this is the creature's sideways seen from the part, without any along its
   * length (a limb pointing sideways mirrors across its width instead).
   * `leftFrame`: the spot is in a right twin's left-twin frame (Z mirrored).
   */
  eyeMirror(b: BoneRT, leftFrame = false): { across: THREE.Vector3; mid: THREE.Vector3 } {
    const geo = (b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined) ?? b.mesh?.geometry;
    const mid = new THREE.Vector3();
    if (geo) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      geo.boundingBox!.getCenter(mid);
    }
    const across = new THREE.Vector3(1, 0, 0).transformDirection(b.restWorld.clone().invert());
    across.y = 0;
    if (across.length() < 0.5) across.set(1, 0, 0);
    across.normalize();
    if (leftFrame && b.def.sideSign === -1) {
      across.z = -across.z;
      mid.z = -mid.z;
    }
    return { across, mid };
  }

  /** Stick one pair (or single eye) onto a part, found by aiming at it from the creature's front. */
  private placeEyes(part: BoneRT, pair: EyePair, pairIndex: number, group: THREE.Group, spots: FuzzSpot[]) {
    const e = this.state.eyes;
    // Work in the part's rest frame so eyes stick to it whatever the pose.
    const toWorld = part.restWorld;
    const toLocal = toWorld.clone().invert();
    // on the smooth shape: lumps are eased out under the eyes (see flattenUnderEyes)
    const geo = (part.mesh!.userData.smoothGeo as (() => THREE.BufferGeometry) | undefined)?.() ?? (part.mesh!.userData.baseGeo as THREE.BufferGeometry) ?? part.mesh!.geometry;
    const forward = new THREE.Vector3(...(this.rig.eyeDir ?? [0, 0, 1])).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(up.dot(forward)) > 0.9) up.set(0, 0, -1);
    up.addScaledVector(forward, -up.dot(forward)).normalize();
    // the eyes stick to the part: rolling it (or a part it hangs from) carries them
    // round, and Facing turns them further (the other way on a right-hand twin, so the two sides mirror)
    const rolled = this.rollTurn(part);
    forward.applyQuaternion(rolled);
    up.applyQuaternion(rolled);
    const turn = (pair.turn ?? e.turn ?? 0) * (part.def.sideSign === -1 ? -1 : 1);
    if (turn) {
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(toWorld);
      forward.applyAxisAngle(axis, turn);
      up.applyAxisAngle(axis, turn);
    }
    const right = new THREE.Vector3().crossVectors(up, forward);
    const localForward = forward.clone().transformDirection(toLocal);

    // extents of the part as seen from the front
    const pos = geo.getAttribute('position');
    const v = new THREE.Vector3();
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity, maxF = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toWorld);
      const r = v.dot(right), u = v.dot(up), f = v.dot(forward);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      maxF = Math.max(maxF, f);
    }
    const sizeR = maxR - minR, sizeU = maxU - minU;

    const probe = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();

    const partStyle = this.state.parts[part.src].style ?? this.state.style;
    const localUp = up.clone().transformDirection(toLocal);

    const r = Math.max(0.02, Math.min(sizeR, sizeU) * 0.16 * (0.4 + pair.size * 1.2));
    // where each eye is looked for: a ray in the part's frame (and, for one
    // placed by hand, the spot it should land nearest)
    const aims: { sgn: number; from: THREE.Vector3; dir: THREE.Vector3; near?: THREE.Vector3 }[] = [];
    if (pair.at) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const { across, mid } = this.eyeMirror(part);
      const reach = geo.boundingBox!.getSize(new THREE.Vector3()).length();
      const at = new THREE.Vector3(...pair.at);
      const n = new THREE.Vector3(...(pair.n ?? [0, 0, 1])).normalize();
      // kept in the left twin's frame; a right twin's is that mirrored across its Z
      if (part.def.sideSign === -1) {
        at.z = -at.z;
        n.z = -n.z;
      }
      // a pair dropped on the middle line is pushed apart so the two don't overlap
      const off = at.clone().sub(mid).dot(across);
      if (!pair.single && Math.abs(off) < r * 1.15) at.addScaledVector(across, (off < 0 ? -1 : 1) * r * 1.15 - off);
      const spin = (pair.turn ?? e.turn ?? 0) * (part.def.sideSign === -1 ? -1 : 1);
      const Y = new THREE.Vector3(0, 1, 0);
      for (const sgn of pair.single ? [0] : [1, -1]) {
        const p = at.clone(), d = n.clone();
        if (sgn === -1) {
          p.addScaledVector(across, -2 * p.clone().sub(mid).dot(across));
          d.addScaledVector(across, -2 * d.dot(across));
        }
        // Facing turns them round the part
        p.applyAxisAngle(Y, spin);
        d.applyAxisAngle(Y, spin);
        aims.push({ sgn, from: p.clone().addScaledVector(d, reach), dir: d.negate(), near: p });
      }
    } else {
      for (const sgn of pair.single ? [0] : [1, -1]) {
        const originW = new THREE.Vector3()
          .addScaledVector(right, (minR + maxR) / 2 + sgn * (sizeR / 2) * pair.spacing * 0.8)
          .addScaledVector(up, minU + sizeU * pair.height)
          .addScaledVector(forward, maxF + 1);
        aims.push({ sgn, from: originW.applyMatrix4(toLocal), dir: localForward.clone().negate() });
      }
    }
    for (const { sgn, from, dir, near } of aims) {
      ray.set(from, dir);
      const hits = ray.intersectObject(probe, false).filter((h) => h.face);
      // by hand: the surface nearest the spot (a fold of the part may be in front of it)
      const hit = near ? hits.sort((a, b) => a.point.distanceTo(near) - b.point.distanceTo(near))[0] : hits[0];
      if (!hit || !hit.face) continue;

      // Flat eyes lie flush with the surface; round ones mostly look forward
      // (or, placed by hand, mostly out from where they sit)
      const surfN = hit.face.normal.clone().normalize();
      const flat = e.style === 'flat' || e.style === 'button' || e.style === 'dot';
      const z = flat ? surfN : near ? surfN.clone().addScaledVector(localForward, 0.6).normalize() : surfN.clone().multiplyScalar(0.5).add(localForward).normalize();
      const y = localUp.clone().addScaledVector(z, -localUp.dot(z)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      const eye = new THREE.Group();
      eye.userData.eye = { pair: pairIndex, r, sgn };
      // on a part with an ink outline, the eyes can have one too
      eye.userData.inkable = partStyle === 'toon' && this.settingsFor(partStyle).ink > 0;
      // (set once built, below)
      eye.userData.textured = false;
      eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      // stand-off: lift the eye out along its facing direction
      eye.position.copy(hit.point).addScaledVector(z, (pair.lift ?? e.lift ?? 0) * r * 1.2);
      const style = EYE_STYLES.some((o) => o.id === e.style) ? e.style : 'googly';
      const built = buildEye(style, r, sgn, partStyle, this.settingsFor(partStyle), e);
      // a textured material lays out the same patch on every eye (they're the same shape) unless shifted
      if (e.vary !== false) varyEyeTexture(built, hashString(`${part.def.id}:${pairIndex}:${sgn}`));
      eye.add(built);
      eye.traverse((m) => {
        m.raycast = () => {};
        // glass casts no shadow, as with the body (see castsShadow): a glass
        // creature's glass beads would leave two shadows floating on the floor
        // (nor does ink, as on the body)
        const mat = m instanceof THREE.Mesh ? (m.material as THREE.MeshPhysicalMaterial) : null;
        m.castShadow = !!mat && !(mat.transmission > 0) && !mat.userData.ink;
      });
      eye.traverse((m) => {
        if (((m as THREE.Mesh).material as THREE.Material | undefined)?.userData.triplanar) eye.userData.textured = true;
      });
      group.add(eye);
      // bare patch just inside the eye's own rim, so it stays hidden behind it
      spots.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z, r: r * (style === 'flat' ? 1.1 : style === 'button' ? 1.0 : 0.85), eye: r });
    }
  }

  // -------------------------------------------------------------------------
  // selection / drawing visuals

  select(id: string | null) {
    this.selected = id;
    this.refreshHighlight();
    this.setSkeletonVisible(this.skeletonShown); // move the bend handle to the new selection
  }

  /** Bones that share a drawing with `id` (itself plus its mirror twin). */
  linked(id: string): BoneRT[] {
    const src = this.bones.get(id)?.src;
    return this.list.filter((b) => b.src === src);
  }

  private refreshHighlight() {
    for (const b of this.list) this.updateGuide(b, this.drawFocus === b.def.id);
  }

  /** Glow the selected part (and its twin); k fades 1 -> 0. */
  flash(id: string | null, k: number) {
    const src = id ? this.bones.get(id)?.src : null;
    for (const b of this.list) {
      const m = b.mesh?.material as THREE.MeshStandardMaterial | undefined;
      if (m && 'emissive' in m) glowWithFlash(m, b.src === src && k > 0 ? FLASH.setRGB(1, 0.42, 0.29).multiplyScalar(0.45 * k) : undefined);
      // A part under a seamless skin is hidden, so its own glow can't be
      // seen: glow a copy of its surface, puffed out a touch, over the skin.
      let hl = this.highlights.get(b);
      const on = !!b.mesh && !b.mesh.visible && b.src === src && k > 0;
      if (!on) {
        if (hl) hl.visible = false;
        continue;
      }
      if (!hl) {
        hl = new THREE.Mesh(b.mesh!.geometry, this.highlightMat);
        hl.raycast = () => {};
        hl.renderOrder = 5;
        this.highlights.set(b, hl);
      }
      if (hl.parent !== b.pivot) b.pivot.add(hl);
      hl.geometry = b.mesh!.geometry;
      hl.position.copy(b.mesh!.position);
      hl.quaternion.copy(b.mesh!.quaternion);
      hl.scale.copy(b.mesh!.scale);
      hl.visible = true;
    }
    this.highlightMat.opacity = 0.8 * Math.max(0, k);
  }

  private highlights = new Map<BoneRT, THREE.Mesh>();
  private highlightMat = (() => {
    const m = new THREE.MeshBasicMaterial({ color: 0xff9a70, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.012;');
    };
    return m;
  })();


  private updateGuide(b: BoneRT, on: boolean) {
    b.guide.clear();
    b.guide.visible = on;
    if (!on) return;
    for (const sh of this.shapesFor(b)) {
      const pts = sh.outline.map((q) => shapePoint(sh.side, q));
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), outlineLineMat);
      loop.renderOrder = 998;
      b.guide.add(loop);
    }
    if (this.drawFocus === b.def.id) {
      const r = Math.max(b.length, b.def.width) * 1.6 + 0.3;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64), planeMat);
      disc.position.y = b.length / 2;
      // drawing from the side: the disc stands in the bone's YZ plane
      if (this.drawSide) disc.rotation.y = Math.PI / 2;
      disc.raycast = () => {};
      b.guide.add(disc);
    }
  }

  setDrawFocus(id: string | null, side = false) {
    this.drawFocus = id;
    this.drawSide = !!id && side;
    if (id) this.invalidateSkin();
    for (const b of this.list) {
      const m = b.mesh?.material as THREE.Material | undefined;
      if (!m) continue;
      const dim = id !== null && b.def.id !== id;
      const self = id !== null && b.def.id === id;
      const own = (b.mesh!.userData.opacity as number) ?? 1;
      m.transparent = dim || self || own < 0.999;
      m.opacity = dim ? 0.18 : self ? 0.45 : own;
      m.depthWrite = !(dim || self);
      m.needsUpdate = true;
      const style = this.state.parts[b.src].style ?? this.state.style;
      b.mesh!.castShadow = !dim && castsShadow(style);
      for (const c of b.mesh!.children) c.visible = !id;
    }
    this.updateRollRing();
    for (const g of this.eyes) g.visible = !id;
    for (const rec of this.attached.values()) {
      rec.main.visible = !id;
      if (rec.twin) rec.twin.visible = !id;
    }
    this.refreshHighlight();
  }

  private skeletonShown = false;
  /** Gizmos: handles on every part, or only on the picked part (and its twin) */
  static handleScope: 'all' | 'part' = 'all';

  setSkeletonVisible(v: boolean) {
    this.skeletonShown = v;
    const sel = this.selected ? this.bones.get(this.selected) : null;
    const only = Creature.handleScope === 'part' && sel ? new Set(this.linked(sel.def.id)) : null;
    for (const b of this.list) {
      const show = v && (!only || only.has(b));
      b.tip.visible = show;
      b.line.visible = show;
      // the slide and bend grips only on the selected bone (the twin follows by symmetry)
      b.startHandle.visible = v && b === sel && b.attach;
      this.showBendGrips(b, v && b === sel);
    }
    // the move-everything square belongs to the first part
    this.rootHandle.visible = v && (!only || !sel!.parent);
    this.updateRollRing();
  }

  private boingAt = 0;
  private boingMeshes: [THREE.Mesh, THREE.Vector3][] = [];

  /** A quick squash-and-stretch wobble on a part (and its twin), e.g. after resizing it. */
  boing(id: string) {
    this.endBoing();
    this.boingMeshes = this.linked(id).flatMap((b) => (b.mesh ? [[b.mesh, b.mesh.scale.clone()] as [THREE.Mesh, THREE.Vector3]] : []));
    this.boingAt = performance.now();
  }

  private endBoing() {
    for (const [m, s] of this.boingMeshes) m.scale.copy(s);
    this.boingMeshes = [];
  }

  /** Advance the wobble; true while it's still moving. */
  tickBoing(now: number): boolean {
    if (!this.boingMeshes.length) return false;
    const t = (now - this.boingAt) / 420;
    if (t >= 1) {
      this.endBoing();
      return true;
    }
    const w = Math.sin(t * Math.PI * 3) * (1 - t) * 0.09;
    for (const [m, s] of this.boingMeshes) m.scale.set(s.x * (1 - w * 0.6), s.y * (1 + w), s.z * (1 - w * 0.6));
    return true;
  }

  /** Fit the roll ring round the selected part, as it's shown right now. */
  updateRollRing() {
    const b = this.selected ? this.bones.get(this.selected) : null;
    const box = b?.mesh?.userData.straightBox as THREE.Box3 | undefined;
    this.rollGizmo.visible = !!b && !!box && this.skeletonShown && !this.drawFocus;
    if (!b || !box || !this.rollGizmo.visible) return;
    if (this.rollGizmo.parent !== b.pivot) b.pivot.add(this.rollGizmo);
    const sc = b.mesh!.scale;
    // round the straight line from base to tip (in the part's stretched size), however the part's bent
    const pad = 0.025;
    const y0 = box.min.y * sc.y - pad;
    const y1 = box.max.y * sc.y + pad;
    const ringY = y0 + (y1 - y0) * 0.15;
    const ringR = Math.max(-box.min.x * sc.x + pad, box.max.x * sc.x + pad, -box.min.z * sc.z + pad, box.max.z * sc.z + pad, 0.08);
    const tipY = b.tip.position.y;
    this.rollAxis.geometry.dispose();
    this.rollAxis.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, Math.min(0, y0), 0), new THREE.Vector3(0, Math.max(tipY, y1), 0)]);
    this.rollAxis.computeLineDistances();
    const h = this.rollRing;
    h.userData.handle = b.def.id;
    if (Math.abs(h.userData.ring - ringR) > 1e-4) {
      h.geometry.dispose();
      h.geometry = rollRingGeo(ringR);
      h.userData.ring = ringR;
    }
    h.position.set(0, ringY, 0);
  }

  /**
   * While a bent part is stretched by its tip, re-bend its mesh to the new
   * shape rather than just stretching the old curve. It's rebuilt properly on
   * letting go.
   */
  previewBend(id: string) {
    for (const b of this.linked(id)) {
      const m = b.mesh;
      const straight = m?.userData.straightGeo as (() => THREE.BufferGeometry) | undefined;
      if (!m || !straight) continue;
      const s = m.scale;
      const bd = bendOf(b.def, b.length * s.y);
      if (!isBent(bd) && !isBent(m.userData.bend as Bend)) continue;
      // bent at its new size, then shrunk back by the mesh's stretch (which the frame is laid out with)
      const sized = straight().clone().scale(s.x, s.y, s.z);
      sized.userData = {};
      const g = bendGeometry(sized, bd).scale(1 / s.x, 1 / s.y, 1 / s.z);
      sized.dispose();
      (m.userData.liveGeo as THREE.BufferGeometry | undefined)?.dispose();
      m.userData.liveGeo = g;
      // (the toon ink follows it; fuzz shells and hairs are left out until it's rebuilt)
      for (const o of m.children) if (!(o instanceof THREE.Mesh) || o.userData.boneId === undefined) o.visible = false;
      this.setMeshGeometry(b, g, false);
    }
    // the merge would otherwise put the old shape back
    this.mergeDirty = true;
  }

  setHandleHover(obj: THREE.Object3D | null) {
    for (const b of this.list) {
      b.tip.material = b.tip === obj ? tipHoverMat : tipMat;
      b.startHandle.material = b.startHandle === obj ? tipHoverMat : startMat;
      for (const h of b.bendHandles) h.material = h === obj ? tipHoverMat : h.userData.used ? bendMat : bendGhostMat;
    }
    this.rollRing.material = this.rollRing === obj ? tipHoverMat : rollMat;
    // whatever's under the pointer swells a little, so it's clear what you'll grab (the ring just lights up)
    for (const h of [this.rootHandle, this.rollRing, ...this.list.flatMap((b) => [b.tip, b.startHandle, ...b.bendHandles])]) h.scale.setScalar(h === obj && h.userData.ring === undefined ? 1.45 : 1);
    this.rollAxis.visible = this.rolling || obj?.userData.kind === 'roll';
  }

  handles(): THREE.Object3D[] {
    // (the roll ring only while it's shown)
    return [...(this.rollGizmo.visible ? [this.rollRing] : []), ...this.list.flatMap((b) => b.bendHandles), ...this.list.map((b) => b.startHandle), this.rootHandle, ...this.list.map((b) => b.tip)];
  }

  meshes(): THREE.Object3D[] {
    return this.list.flatMap((b) => (b.mesh ? [b.mesh] : []));
  }

  /**
   * Where a ray first meets the creature: the part, the spot and which way the
   * surface faces there, in the scene and in the part's own frame. `local` is
   * as the part's definition sees it: on a right twin, mirrored back across Z.
   */
  surfaceAt(ray: THREE.Raycaster): { bone: BoneRT; point: THREE.Vector3; normal: THREE.Vector3; local: THREE.Vector3; localNormal: THREE.Vector3 } | null {
    const hit = ray.intersectObjects(this.meshes(), false)[0];
    const bone = hit?.face && this.bones.get(hit.object.userData.boneId as string);
    if (!hit?.face || !bone) return null;
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    bone.pivot.updateMatrixWorld(true);
    const toLocal = bone.pivot.matrixWorld.clone().invert();
    const local = hit.point.clone().applyMatrix4(toLocal);
    const localNormal = normal.clone().transformDirection(toLocal);
    if (bone.def.sideSign === -1) {
      local.z = -local.z;
      localNormal.z = -localNormal.z;
    }
    return { bone, point: hit.point.clone(), normal, local, localNormal };
  }

  /**
   * The eye pair a ray hits first, and how far along. The eyes themselves
   * don't take raycasts (clicks go through to the head), so each eye counts as
   * a ball of its own size.
   */
  /** Whether any eye is made of a textured material (so its texture can be varied). */
  eyesTextured(): boolean {
    return this.eyes.some((g) => g.children.some((eye) => eye.userData.textured));
  }

  /** Whether any eye sits on a part drawn with an ink outline (so an outline would show on it). */
  eyesCanInk(): boolean {
    return this.eyes.some((g) => g.children.some((eye) => eye.userData.inkable));
  }

  pickEye(ray: THREE.Ray): { pair: number; distance: number; sgn: number; bone: string } | null {
    const shown = this.eyes.filter((g) => g.parent && g.visible);
    let best: { pair: number; distance: number; sgn: number; bone: string } | null = null;
    const sphere = new THREE.Sphere();
    const at = new THREE.Vector3();
    for (const eye of shown.flatMap((g) => g.children)) {
      const { pair, r, sgn } = eye.userData.eye as { pair: number; r: number; sgn: number };
      eye.getWorldPosition(sphere.center);
      const ws = eye.getWorldScale(at);
      sphere.radius = r * Math.max(ws.x, ws.y, ws.z);
      if (!ray.intersectSphere(sphere, at)) continue;
      const distance = at.distanceTo(ray.origin);
      if (!best || distance < best.distance) best = { pair, distance, sgn, bone: (eye.parent?.parent?.userData.boneId as string) ?? '' };
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // posing

  /** Rotate a bone (in world space) so its tip points at `target`. */
  aimBone(b: BoneRT, effector: THREE.Vector3, target: THREE.Vector3) {
    const origin = b.pivot.getWorldPosition(new THREE.Vector3());
    const from = effector.clone().sub(origin);
    const to = target.clone().sub(origin);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
    const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const parentQ = b.pivot.parent!.getWorldQuaternion(new THREE.Quaternion());
    const worldQ = parentQ.clone().multiply(b.pivot.quaternion);
    worldQ.premultiply(q);
    b.pivot.quaternion.copy(parentQ.invert().multiply(worldQ));
    b.pivot.updateMatrixWorld(true);
  }

  /**
   * Drag a bone tip toward `target` with CCD IK, optionally bending its
   * ancestors too: the whole limb, stopping at an anchored part or below one
   * other things grow from too (a head with ears: an ear moves by itself, not
   * the head it's on).
   */
  dragTip(id: string, target: THREE.Vector3, ik: boolean): BoneRT[] {
    const b = this.bones.get(id)!;
    const chain: BoneRT[] = [b];
    const branches = (p: BoneRT) => this.list.filter((c) => c.parent === p).length > 1;
    if (ik) {
      let p = b.parent;
      while (p && !p.def.anchor && !branches(p)) {
        chain.push(p);
        p = p.parent;
      }
    }
    this.mergeDirty = true;
    // turning the body itself: the legs it stands on keep hanging the way they
    // were, so it rears up or leans over its feet instead of tipping the whole critter
    const legs = b.parent ? [] : this.list.filter((c) => c.parent === b && this.reachesFloor(c));
    const legQ = legs.map((c) => c.pivot.getWorldQuaternion(new THREE.Quaternion()));
    const iterations = chain.length > 1 ? Math.max(12, chain.length * 4) : 1;
    const tipPos = new THREE.Vector3();
    for (let it = 0; it < iterations; it++) {
      for (const j of chain) {
        b.tip.getWorldPosition(tipPos);
        this.aimBone(j, tipPos, target);
      }
    }
    if (legs.length) {
      const bodyQ = b.pivot.getWorldQuaternion(new THREE.Quaternion()).invert();
      legs.forEach((c, i) => {
        c.pivot.quaternion.copy(bodyQ.clone().multiply(legQ[i]));
        c.pivot.updateMatrixWorld(true);
      });
    }
    // turning the parts it hangs from (or the head itself) doesn't tip the head over
    const head = this.bones.get(this.rig.headId);
    for (let h = head ?? null; h; h = h.parent) {
      if (!chain.includes(h)) continue;
      this.levelHead(head!);
      break;
    }
    return chain;
  }

  /** A limb that (as drawn) reaches down to the floor, itself or through the parts hanging off it. */
  private reachesFloor(b: BoneRT): boolean {
    // by where its far end is: a neck can start low on a serpent and still rise
    const low = (d: ExpandedBone) => d.end[1];
    const floor = Math.min(...this.list.map((o) => low(o.def)));
    const top = Math.max(...this.list.map((o) => Math.max(o.def.start[1], o.def.end[1])));
    const near = floor + (top - floor) * 0.12;
    const under = (o: BoneRT): boolean => low(o.def) < near || this.list.some((c) => c.parent === o && under(c));
    return under(b);
  }

  /**
   * Turn the head about its own length (only) so it's as upright as it was
   * drawn: its side across level, or tipped by however much its rest pose is.
   * Aiming swings parts the shortest way, which tilts a head riding on them.
   */
  levelHead(b: BoneRT) {
    const Y = new THREE.Vector3(0, 1, 0);
    const levelSide = (along: THREE.Vector3, up: THREE.Vector3) => new THREE.Vector3().crossVectors(up, along);
    // how far its rest pose is tipped, in skeleton space: against up as the
    // eyes see it (rolling a part it hangs from carries that round too)
    const restAlong = new THREE.Vector3(0, 1, 0).transformDirection(b.restWorld);
    const restSide = new THREE.Vector3(1, 0, 0).transformDirection(b.restWorld);
    const restUp = b.parent ? Y.clone().applyQuaternion(this.rollTurn(b.parent)) : Y;
    const restLevel = levelSide(restAlong, restUp);
    if (restLevel.lengthSq() < 0.05) return;
    restLevel.normalize();
    const tip = Math.atan2(new THREE.Vector3().crossVectors(restLevel, restSide).dot(restAlong), restLevel.dot(restSide));
    // where it is now, in the scene
    const up = Y.clone().applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    const worldQ = b.pivot.getWorldQuaternion(new THREE.Quaternion());
    const along = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQ);
    const want = levelSide(along, up);
    // pointing (nearly) straight up or down: there's no level to keep
    if (want.lengthSq() < 0.05) return;
    want.normalize().applyAxisAngle(along, tip);
    const twist = Math.atan2(new THREE.Vector3().crossVectors(side, want).dot(along), side.dot(want));
    if (Math.abs(twist) < 1e-5) return;
    worldQ.premultiply(new THREE.Quaternion().setFromAxisAngle(along, twist));
    const parentQ = b.pivot.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.pivot.quaternion.copy(parentQ.invert().multiply(worldQ));
    b.pivot.updateMatrixWorld(true);
  }

  /**
   * Give the other side the mirror image of these bones' pose. Works in the
   * creature's own space: each bone's turn away from its rest pose is
   * reflected across the centre plane and applied to its twin.
   */
  mirrorPose(bones: BoneRT[]) {
    const groupQ = this.group.getWorldQuaternion(new THREE.Quaternion());
    const inGroup = (o: THREE.Object3D) => groupQ.clone().invert().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    const restQ = (b: BoneRT) => new THREE.Quaternion().setFromRotationMatrix(b.restGroup);
    // parents first, so each twin is set against its parent's new pose
    const ordered = [...bones].sort((a, b) => this.list.indexOf(a) - this.list.indexOf(b));
    for (const b of ordered) {
      const twin = this.twinOf(b);
      if (!twin) continue;
      this.group.updateMatrixWorld(true);
      const turn = inGroup(b.pivot).multiply(restQ(b).invert());
      const mirrored = new THREE.Quaternion(turn.x, -turn.y, -turn.z, turn.w);
      const want = mirrored.multiply(restQ(twin));
      const parentQ = inGroup(twin.pivot.parent!);
      twin.pivot.quaternion.copy(parentQ.invert().multiply(want));
      twin.pivot.updateMatrixWorld(true);
    }
    this.mergeDirty = true;
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Eye styles. Each eye is built in a frame where +Z points out of the face,
// +Y is "up" on the face, and the origin sits on the surface.

const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
const glossyWhite = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1 });
const glossyBlack = () => new THREE.MeshPhysicalMaterial({ color: 0x1b1720, roughness: 0.12, clearcoat: 1 });

/**
 * A sphere built at its real size (rather than a unit sphere scaled down), so
 * textured materials keep the same density and bump strength as the head.
 */
function realSphere(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = sphereGeo.clone().scale(sx, sy, sz);
  // low-poly materials read per-vertex color
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  return g;
}

const shapedSphereGeo = new THREE.SphereGeometry(1, 64, 40);

/**
 * A bead / dot squeezed into an expression: the lids cut it top and bottom
 * (each column keeps a round cross-section, so the cut eye stays a smooth
 * pebble with tapered corners), the crescent bends it into an arch or a cup,
 * and the tilt turns it, mirrored so both eyes lean toward or away from the nose.
 */
function shapedEye(sx: number, sy: number, sz: number, sgn: number, e: EyesState): THREE.BufferGeometry {
  const top = e.lidTop ?? 1;
  const bottom = e.lidBottom ?? -1;
  const crescent = e.crescent ?? 0;
  const tilt = e.tilt ?? 0;
  if (top >= 1 && bottom <= -1 && !crescent && !tilt) return realSphere(sx, sy, sz);

  // the lids never quite meet
  const t = Math.min(1, Math.max(top, bottom + 0.08));
  const b = Math.max(-1, Math.min(bottom, t - 0.08));
  // how far across the cut eye reaches: where the circle still spans both lids
  const cut = Math.max(0, b, -t);
  const reach = Math.sqrt(1 - cut * cut);
  const bend = crescent * 0.7;
  // mirrored, so +tilt drops each eye's inner corner (local -X faces the nose on the left eye)
  const angle = (sgn || 1) * tilt * (Math.PI / 4);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  const g = shapedSphereGeo.clone();
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = Math.sqrt(Math.max(0, 1 - x * x));
    // squeezed across so the cut eye ends in a point rather than a collapsed sliver
    const nx = x * reach;
    const nh = Math.sqrt(Math.max(0, 1 - nx * nx));
    const lo = Math.max(b, -nh), hi = Math.min(t, nh);
    const mid = (lo + hi) / 2, half = Math.max(0, (hi - lo) / 2);
    // each column of the sphere becomes a circle spanning just the open part
    const k = h > 1e-6 ? half / h : 0;
    // the arch rises in the middle, kept centred on the eye
    const ny = mid + y * k + bend * (0.5 - x * x);
    const px = nx * sx, py = ny * sy;
    pos.setXYZ(i, px * cos - py * sin, px * sin + py * cos, z * k * sz);
  }
  const merged = mergeVertices(g);
  g.dispose();
  merged.computeVertexNormals();
  // low-poly materials read per-vertex color
  merged.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(merged.getAttribute('position').count * 3).fill(1), 3));
  return merged;
}

/** Material for bead / dot / button eyes. */
function eyeMaterial(finish: EyeFinish, color: string, headStyle: StyleId, headSettings: StyleSettings): THREE.Material {
  switch (finish) {
    case 'gloss':
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
    case 'matte':
      return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    case 'glass':
      // a colored glass marble: strong tint so the color reads
      return makeMaterial('glass', color, { ...styleSettings('glass'), ...(headStyle === 'glass' ? headSettings : {}), tint: 0.85 });
    default:
      // glass: tinted strongly, or a dark eye color barely shows through clear glass
      return makeMaterial(headStyle, color, headStyle === 'glass' ? { ...headSettings, tint: Math.max(headSettings.tint, 0.85) } : headSettings);
  }
}

/** An eye's material, glowing in its color as much as the eyes are set to. */
function eyeGlow(m: THREE.Material, color: string, e: EyesState): THREE.Material {
  glowMaterial(m, color, e.glow ?? 0, { follow: e.glowFollow });
  return m;
}

/** Pupil size as a scale on the default, 0.5x .. 1.5x. */
function pupilScale(e: EyesState): number {
  return 0.5 + (e.pupil ?? 0.5);
}

/**
 * `sgn` is which side the eye is on: 1 the creature's left (+X), -1 its right,
 * 0 a single eye in the middle (which has no other eye to cross with).
 */
function buildEye(style: EyeStyle, r: number, sgn: number, headStyle: StyleId, headSettings: StyleSettings, e: EyesState): THREE.Object3D {
  const g = new THREE.Group();
  // crossing turns each pupil toward the middle (-X on the left eye, +X on the right)
  const crossX = -sgn * (e.cross ?? 0);
  const finish = e.finish ?? 'body';
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, scale: V3) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    g.add(m);
    return m;
  };

  switch (style) {
    case 'googly': {
      const shine = e.shine ?? 1;
      const white = glossyWhite();
      white.roughness = 0.75 - 0.6 * shine;
      white.clearcoat = shine;
      const black = glossyBlack();
      black.roughness = 0.7 - 0.58 * shine;
      black.clearcoat = shine;
      add(sphereGeo, white, [0, 0, -r * 0.35], [r, r, r]);
      // the pupil rolls round the eyeball's centre to look about
      const roll = new THREE.Group();
      roll.position.set(0, 0, -r * 0.35);
      const across = THREE.MathUtils.clamp((e.lookX ?? 0) + crossX, -1.5, 1.5);
      roll.rotation.set(-(e.lookY ?? 0) * 0.7, across * 0.7, 0, 'YXZ');
      g.add(roll);
      const k = pupilScale(e);
      const pupil = new THREE.Mesh(sphereGeo, black);
      pupil.position.set(0, 0, r * 0.82);
      pupil.scale.set(r * 0.55 * k, r * 0.6 * k, r * 0.3);
      roll.add(pupil);
      // the catchlight is a reflection: it stays put, and fades out on a matte eye
      if (shine > 0.05) {
        const glint = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: shine < 1, opacity: Math.min(1, shine * 1.2) });
        add(sphereGeo, glint, [r * 0.2, r * 0.25, r * 0.67], [r * 0.14, r * 0.14, r * 0.14]);
      }
      break;
    }
    case 'flat': {
      // craft-store sticker eye: white disc, a loose pupil that has fallen to the bottom, clear dome
      const R = r * 1.15;
      const disc = new THREE.CylinderGeometry(1, 1, 1, 40);
      disc.rotateX(Math.PI / 2);
      add(disc, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), [0, 0, R * 0.06], [R, R, R * 0.12]);
      const pr = Math.min(0.85, 0.58 * pupilScale(e));
      // how far the pupil can roll before it reaches the rim
      const travel = Math.max(0, 0.94 - pr);
      // left alone, it has fallen to the bottom, each side jiggled a little differently
      const loose = Math.max(-travel, Math.min(travel, (sgn || 1) * 0.13 + 0.05));
      const px = (e.lookX !== undefined ? e.lookX * travel : loose) + crossX * travel;
      const py = (e.lookY ?? -1) * travel;
      // kept inside the disc when pushed into a corner (the loose one is as it always was)
      const placed = e.lookX !== undefined || e.lookY !== undefined || !!e.cross;
      const d = Math.hypot(px, py), k = placed && d > travel && d > 0 ? travel / d : 1;
      add(disc, new THREE.MeshStandardMaterial({ color: 0x151216, roughness: 0.4 }), [px * k * R, py * k * R, R * 0.14], [R * pr, R * pr, R * 0.04]);
      const dome = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateX(Math.PI / 2);
      add(
        dome,
        new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.1, clearcoat: 1, depthWrite: false }),
        [0, 0, R * 0.1],
        [R * 1.02, R * 1.02, R * 0.38],
      );
      break;
    }
    case 'bead': {
      // a bead, by default in the creature's own material
      add(shapedEye(r * 0.8, r * 0.8, r * 0.8, sgn, e), eyeGlow(eyeMaterial(finish, e.color ?? '#1d1a22', headStyle, headSettings), e.color ?? '#1d1a22', e), [0, 0, -r * 0.3], [1, 1, 1]);
      break;
    }
    case 'dot': {
      // a flat disc of dark wool/clay pressed onto the face
      add(shapedEye(r * 0.95, r * 0.95, r * 0.28, sgn, e), eyeGlow(eyeMaterial(finish, e.color ?? '#2a2730', headStyle, headSettings), e.color ?? '#2a2730', e), [0, 0, 0], [1, 1, 1]);
      break;
    }
    case 'button': {
      const R = r * 1.05;
      // buttons are glossy plastic unless a finish is chosen
      const mat = eyeGlow(
        finish === 'body'
          ? new THREE.MeshPhysicalMaterial({ color: e.color ?? 0x2a2230, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 })
          : eyeMaterial(finish, e.color ?? '#2a2230', headStyle, headSettings),
        e.color ?? '#2a2230',
        e,
      );
      const body = new THREE.CylinderGeometry(1, 0.94, 1, 40);
      body.rotateX(Math.PI / 2);
      add(body, mat, [0, 0, R * 0.1], [R, R, R * 0.2]);
      add(new THREE.TorusGeometry(1, 0.12, 12, 40), mat, [0, 0, R * 0.2], [R * 0.86, R * 0.86, R * 0.8]);
      const hole = new THREE.CylinderGeometry(1, 1, 1, 12);
      hole.rotateX(Math.PI / 2);
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x0b090d });
      const thread = new THREE.MeshStandardMaterial({ color: 0xf1e7d6, roughness: 0.9 });
      const o = R * 0.26;
      for (const [hx, hy] of [[-o, o], [o, o], [-o, -o], [o, -o]]) add(hole, holeMat, [hx, hy, R * 0.2], [R * 0.1, R * 0.1, R * 0.02]);
      const box = new THREE.BoxGeometry(1, 1, 1);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const t = add(box, thread, [0, 0, R * 0.23], [o * 2 * Math.SQRT2 + R * 0.12, R * 0.06, R * 0.04]);
        t.rotation.z = a;
        // too fine to ink: the outline would swallow it
        t.userData.noInk = true;
      }
      break;
    }
  }
  // a toon head can draw its eyes in the same ink as itself
  if (e.ink && (style === 'bead' || style === 'dot' || style === 'button') && headStyle === 'toon' && headSettings.ink > 0) inkEye(g, headSettings);
  return g;
}

/**
 * Give each piece of an eye its own patch of a textured material: the
 * texture is laid out shifted and turned by an amount picked from `seed`,
 * the same every time, so the eye keeps its look between rebuilds.
 */
function varyEyeTexture(g: THREE.Object3D, seed: number) {
  let s = seed || 1;
  // xorshift: a few repeatable random numbers 0..1
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2));
    const shift = new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(10);
    // (the materials are the eye's own, made fresh for it)
    setTextureSpace(o, new THREE.Matrix4().compose(shift, turn, new THREE.Vector3(1, 1, 1)));
  });
}

/**
 * Ink hulls round each solid piece of an eye. A piece's size is baked into its
 * hull's shape, so the line is as wide as the body's, however the piece is squashed.
 * Glints, holes and the clear dome (basic or see-through materials) go without.
 */
function inkEye(g: THREE.Object3D, k: StyleSettings) {
  const meshes: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.noInk) meshes.push(o);
  });
  for (const m of meshes) {
    const mat = m.material as THREE.Material;
    if (mat instanceof THREE.MeshBasicMaterial || mat.transparent) continue;
    const geo = inkNormals(m.geometry.clone().scale(m.scale.x, m.scale.y, m.scale.z));
    const ink = new THREE.Mesh(geo, makeOutlineMaterial(k.ink, true, k));
    ink.position.copy(m.position);
    ink.quaternion.copy(m.quaternion);
    m.parent!.add(ink);
  }
}
