import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bvhFor, exactDistance, sharedNormals } from './distance';
import { buildSkin, paintSkin, type SkinPart } from './skin';
import { buildInflatedGeometry, defaultOutline, getMeshDetail, type Solid, type Vec2 } from './inflate';
import {
  castsShadow,
  isTextured,
  setFuzzMask,
  setOpacity,
  makeFuzzShells,
  makeMaterial,
  makeOutlineMaterial,
  makeStrayHairs,
  setTextureSpace,
  styleSettings,
  surfaceColor,
  type StyleId,
  type FuzzSpot,
  type StyleSettings,
} from './materials';
import { MAX_BEND, expandRig, stretchBend, type ExpandedBone, type ExpandedRig, type RigState, type V3 } from './rigs';
import { buildThing, disposeThing, type Thing } from './stuff';

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
  style?: StyleId;
  /** 1 = solid, lower = see-through */
  opacity?: number;
}

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
  /** per-material slider values (missing keys use the defaults) */
  materialSettings?: Partial<Record<StyleId, StyleSettings>>;
  attachments?: Attachment[];
  /** legacy: the workbench used to live on the creature; it now belongs to the world */
  workbench?: Thing;
  /** where the creature stands in a multi-creature scene: floor position and facing */
  placement?: Placement;
  /** settle onto the floor after every bend or resize (default on; lifting the creature turns it off) */
  keepFloor?: boolean;
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
  /** overall size (default 1) */
  scale?: number;
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
  bendHandle: THREE.Mesh;
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
    eyes: { enabled: true, style: 'bead', pairs: [{ size: 0.5, spacing: 0.5, height: 0.55 }] },
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
function seamlessOn(s: CreatureState): boolean {
  return seamlessMode === 'creature' ? (s.seamless ?? true) : seamlessMode === 'on';
}

// how long one frame may spend fusing parts (see updateMerge)
const MERGE_BUDGET_MS = 8;

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
// the size gizmo around the selected part
const sizerMat = new THREE.MeshBasicMaterial({ color: 0x14b8a6, depthTest: false, transparent: true });
const sizerLineMat = new THREE.LineDashedMaterial({ color: 0x14b8a6, depthTest: false, transparent: true, opacity: 0.8, dashSize: 0.035, gapSize: 0.025 });
for (const m of [tipMat, tipHoverMat, rootMat, lineMat, outlineLineMat, planeMat, startMat, bendMat, sizerMat, sizerLineMat]) m.userData.shared = true;
const tipGeo = new THREE.SphereGeometry(0.032, 16, 12);
const startGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
const bendGeo = new THREE.OctahedronGeometry(0.042);
const arrowGeo = new THREE.ConeGeometry(0.034, 0.075, 16);
const cornerGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
/** The roll ring: a thin hoop round the line from a part's base to its tip (radius 1, scaled to fit). */
function rollRingGeo(r: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, 0.012, 8, 64).rotateX(Math.PI / 2);
}

// ---------------------------------------------------------------------------
// bendy bones: the bone's local frame (X = side, Y = along the bone, Z = out
// of the drawing) is curved into a circular arc that still runs from the
// bone's start to its tip, bowing out toward a direction around the bone:
// 0 = +X (sideways in the drawing plane), pi/2 = +Z.

export interface Bend {
  len: number;
  /** total turn, radians (0 = straight) */
  theta: number;
  /** direction around the bone, radians */
  dir: number;
}

/** A bone's bend. A right twin's frame is its left twin's mirrored through local Z, so its direction mirrors too. */
export function bendOf(def: ExpandedBone, len: number): Bend {
  const theta = def.bendy ? (def.bend ?? 0) * Math.PI : 0;
  const dir = (def.bendDir ?? 0) * (def.sideSign === -1 ? -1 : 1);
  return { len, theta, dir };
}

function bendKey(bd: Bend): string {
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

/** Where the straight-bone point (x, y, z) goes once bent, plus the turn angle there. */
function bendPoint(bd: Bend, x: number, y: number, z: number): [number, number, number, number] {
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
  for (let i = 0; i < pos.count; i++) {
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
  if (!bd.theta) return local;
  const p = new THREE.Vector3().setFromMatrixPosition(local);
  const s = Math.min(bd.len, Math.max(0, p.y));
  const [x, y, z] = bendPoint(bd, 0, s, 0);
  return new THREE.Matrix4().makeTranslation(x, y - s, z).multiply(local);
}

/** Points along a (possibly bent) bone, for the skeleton line. */
function bonePoints(bd: Bend): THREE.Vector3[] {
  const n = bd.theta ? 16 : 1;
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
  /** the size gizmo: a dashed box round the selected part with grips to stretch and fatten it */
  private sizer = new THREE.Group();
  private sizerBox: THREE.LineLoop;
  readonly sizerHandles: THREE.Mesh[] = [];
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

  constructor(state: CreatureState) {
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
    this.sizerBox = new THREE.LineLoop(new THREE.BufferGeometry(), sizerLineMat);
    this.sizerBox.renderOrder = 999;
    this.sizer.add(this.sizerBox);
    // [kind, sign]: 'len' stretches along the bone, 'wid' fattens it, 'size' does both, 'roll' turns it about its length
    const grips = [['len', 1], ['wid', -1], ['wid', 1], ['size', -1], ['size', 1], ['roll', 1]] as const;
    for (const [kind, sign] of grips) {
      // (the roll ring's hoop is sized to the part in updateSizer)
      const h = new THREE.Mesh(kind === 'size' ? cornerGeo : kind === 'roll' ? new THREE.BufferGeometry() : arrowGeo, sizerMat);
      if (kind === 'wid') h.rotation.z = (-sign * Math.PI) / 2;
      if (kind === 'size') h.rotation.z = Math.PI / 4;
      if (kind === 'roll') h.userData.ring = 0;
      h.renderOrder = 1000;
      h.userData.kind = kind;
      h.userData.sign = sign;
      this.sizerHandles.push(h);
      this.sizer.add(h);
    }
    // what rolling turns the part round: shown while the ring is hovered or dragged
    this.rollAxis = new THREE.Line(new THREE.BufferGeometry(), sizerLineMat);
    this.rollAxis.renderOrder = 999;
    this.rollAxis.visible = false;
    this.sizer.add(this.rollAxis);
    this.sizer.visible = false;
    this.sync();
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
      startHandle.renderOrder = 1000;
      startHandle.userData.handle = def.id;
      startHandle.userData.kind = 'start';
      startHandle.visible = false;
      pivot.add(startHandle);
      const attach = !parent || new THREE.Vector3(...def.start).distanceTo(new THREE.Vector3(...parent.def.end)) > 0.02;

      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bonePoints(bd)), lineMat);

      // rig mode: drag this to bend the bone (shown on the selected bone)
      const bendHandle = new THREE.Mesh(bendGeo, bendMat);
      bendHandle.position.copy(bendMid(bd));
      bendHandle.renderOrder = 1000;
      bendHandle.userData.handle = def.id;
      bendHandle.userData.kind = 'bend';
      bendHandle.visible = false;
      pivot.add(bendHandle);
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
        bendHandle,
        attach,
        line,
        guide,
        restGroup: new THREE.Matrix4(),
      };
      this.bones.set(def.id, rt);
      this.list.push(rt);
    }
    this.updateRestFrames();
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
      b.bendHandle.position.copy(bendMid(bd));
      b.line.geometry.dispose();
      b.line.geometry = new THREE.BufferGeometry().setFromPoints(bonePoints(bd));
    }
    this.rootHandle.position.copy(this.list[0].pivot.position);
    this.updateRestFrames();
    // reshaping keeps the pose: bones stay bent the way they were
    this.applyPose();
    this.mergeDirty = true;
    this.updateSizer();
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
    this.root.scale.setScalar(p.scale ?? 1);
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
    if (Math.abs(this.root.scale.x - 1) > 1e-4) p.scale = r(this.root.scale.x);
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
    this.sizerBox.geometry.dispose();
  }

  sync() {
    const s = this.state;
    this.applyPlacement();
    for (const b of this.list) {
      const p = s.parts[b.src];
      const style = p.style ?? s.style;
      const shapes = this.shapesFor(b);
      const k = this.settingsFor(style);
      const geoOpts = {
        thickness: p.thickness,
        lowPoly: style === 'lowpoly',
        facetScale: style === 'lowpoly' ? k.facets : undefined,
        colorJitter: style === 'lowpoly' ? k.variation : undefined,
        lumps: style === 'clay' ? k.lumps : style === 'stone' ? k.rugged : 0,
      };
      const geoKey = JSON.stringify([shapes, geoOpts, getMeshDetail()]);
      const key = geoKey + style + p.color + JSON.stringify(k) + (p.opacity ?? 1) + bendKey(bendOf(b.def, b.length));
      if (key === b.meshKey) continue;
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
        const flat = cachedGeometry(sk, () => buildInflatedGeometry(sh.outline, { ...opts, seed: seed + i }));
        return { sk, geo: sh.side ? cachedGeometry(sk + 'turned', () => turnSideways(flat)) : flat };
      };
      const shapeGeo = (sh: PartShape, i: number, opts: typeof geoOpts) => {
        const { sk, geo: turned } = straightGeo(sh, i, opts);
        return bd.theta ? cachedGeometry(sk + bendKey(bd), () => bendGeometry(turned, bd)) : turned;
      };
      const geo =
        shapes.length === 1
          ? shapeGeo(shapes[0], 0, geoOpts)
          : cachedGeometry(geoKey + bendKey(bd), () => joinShapes(shapes.map((sh, i) => shapeGeo(sh, i, geoOpts))));
      const mesh = new THREE.Mesh(geo, makeMaterial(style, p.color, k));
      mesh.userData.baseGeo = geo;
      // the size gizmo frames the part as if it were straight, then bends along with it
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
      mesh.userData.opacity = p.opacity ?? 1;
      mesh.castShadow = castsShadow(style);
      // (soft shadows also draw receivers into the shadow map: glass mustn't block the light)
      mesh.receiveShadow = castsShadow(style);
      mesh.userData.boneId = b.def.id;
      if (style === 'toon' && k.ink > 0) {
        const ink = new THREE.Mesh(geo, makeOutlineMaterial(k.ink));
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
    }
    this.applyPose();
    this.syncEyes();
    this.syncAttachments();
    this.refreshHighlight();
    this.updateSizer();
  }

  // -------------------------------------------------------------------------
  // attached stuff

  twinOf(b: BoneRT): BoneRT | null {
    if (b.def.sideSign === 0) return null;
    return this.bones.get(b.def.baseId + (b.def.sideSign === 1 ? 'R' : 'L')) ?? null;
  }

  syncAttachments() {
    const list = this.state.attachments ?? [];
    const alive = new Set<string>();
    for (const a of list) {
      const bone = this.bones.get(a.bone);
      if (!bone) continue;
      alive.add(a.id);
      const twinBone = a.mirror ? this.twinOf(bone) : null;
      // an item that inherits its material takes the material of the part it's on
      const part = this.state.parts[bone.src];
      const wearer = { style: part?.style ?? this.state.style, settingsFor: (st: StyleId) => this.settingsFor(st) };
      const styles = a.thing.inherit ? [wearer.style] : a.thing.pieces.map((p) => p.style);
      // felt fuzz and toon ink are sized for the attachment's scale, so a big
      // rescale rebuilds them (unless the item opts out, and lets them scale along with it)
      const sized = a.thing.scaleMaterial !== false && styles.some((s) => s === 'felt' || s === 'toon');
      const unit = sized ? Math.round(Math.cbrt(Math.abs(a.scale[0] * a.scale[1] * a.scale[2])) * 20) / 20 || 1 : 1;
      const key = JSON.stringify([a.thing.pieces, a.thing.ownMaterial, a.thing.inherit, a.thing.materialSettings, a.thing.bend, a.thing.bendMode, a.bone, twinBone?.def.id, this.state.materialSettings, wearer.style, unit, getMeshDetail()]);
      let rec = this.attached.get(a.id);
      if (!rec || rec.key !== key) {
        const settings = wearer;
        if (rec && rec.bone === bone && rec.twinBone === twinBone) {
          // same place: swap the contents but keep the groups (the gizmo may hold one)
          for (const g of [rec.main, rec.twin]) {
            if (!g) continue;
            for (const c of [...g.children]) {
              c.removeFromParent();
              disposeThing(c);
            }
            g.add(buildThing(a.thing, settings, unit));
          }
          rec.key = key;
        } else {
          if (rec) this.dropAttachment(rec);
          const main = new THREE.Group();
          main.add(buildThing(a.thing, settings, unit));
          bone.pivot.add(main);
          let twin: THREE.Group | null = null;
          if (twinBone) {
            twin = new THREE.Group();
            twin.add(buildThing(a.thing, settings, unit));
            twin.matrixAutoUpdate = false;
            twinBone.pivot.add(twin);
          }
          rec = { key, main, twin, bone, twinBone };
          this.attached.set(a.id, rec);
        }
        for (const g of [rec.main, rec.twin]) g?.traverse((o) => (o.userData.attachmentId = a.id));
      }
      rec.main.position.set(...a.position);
      rec.main.quaternion.set(...a.quaternion);
      rec.main.scale.set(...a.scale);
      this.updateTwin(a.id);
    }
    for (const [id, rec] of this.attached) {
      if (alive.has(id)) continue;
      this.dropAttachment(rec);
      this.attached.delete(id);
    }
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
   * mirrored copy uses M * A with M = diag(1, 1, -1).
   */
  updateTwin(id: string) {
    const rec = this.attached.get(id);
    if (!rec?.twin) return;
    rec.main.updateMatrix();
    rec.twin.matrix.makeScale(1, 1, -1).multiply(rec.main.matrix);
    rec.twin.matrixWorldNeedsUpdate = true;
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

  applyPose() {
    // only a real change re-merges: sync() calls this on every look edit too
    const before = this.list.map((b) => b.pivot.quaternion.clone());
    const pos = this.group.position.clone();
    for (const b of this.list) {
      const q = this.state.pose[b.def.id];
      b.pivot.quaternion.copy(b.restQuat);
      if (q) b.pivot.quaternion.multiply(new THREE.Quaternion(...q));
    }
    this.group.position.set(...this.state.rootOffset);
    if (!this.group.position.equals(pos) || this.list.some((b, i) => !b.pivot.quaternion.equals(before[i]))) this.mergeDirty = true;
  }

  capturePose() {
    const pose: CreatureState['pose'] = {};
    for (const b of this.list) {
      if (b.pivot.quaternion.angleTo(b.restQuat) > 1e-4) {
        const q = b.restQuat.clone().invert().multiply(b.pivot.quaternion);
        pose[b.def.id] = [q.x, q.y, q.z, q.w];
      }
    }
    this.state.pose = pose;
    this.state.rootOffset = this.group.position.toArray() as V3;
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
      const nbrs = on && members.length > 1 ? members.filter((o) => o !== b && !o.mesh!.userData.liveGeo && this.near(b, o, Math.max(k, kc))) : [];
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
  }

  // -------------------------------------------------------------------------
  // seamless skin: when the creature is left alone, merged groups are rebuilt
  // as one continuous surface (see skin.ts); any change drops back to the fast
  // per-part merge above.

  /** Drop the settled skin and show the individual parts again. */
  invalidateSkin() {
    this.skinVersion++;
    this.lastChange = performance.now();
    this.skinState = 'none';
    if (!this.skins.length) return;
    // the parts come back into view: they may have skipped merging meanwhile
    this.mergeDirty = true;
    for (const { mesh, members } of this.skins) {
      mesh.removeFromParent();
      mesh.traverse((o) => {
        ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
        if (o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      mesh.geometry.dispose();
      for (const b of members) if (b.mesh) b.mesh.visible = true;
    }
    this.skins = [];
  }

  /** Build seamless skins for every merged group. Resolves false if interrupted. */
  async settle(): Promise<boolean> {
    const s = this.state;
    if (this.skinState !== 'none' || !(s.merge ?? true) || !seamlessOn(s) || this.drawFocus) return false;
    const version = this.skinVersion;
    this.skinState = 'building';
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

    const built: SkinEntry[] = [];
    for (const [, members] of groups) {
      // only parts that actually touch another part in the group
      const joined = members.filter((b) => members.some((o) => o !== b && this.near(b, o, kMax)));
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

      // a part drawn as several shapes joins in as each of them
      const owners: BoneRT[] = [];
      const parts: SkinPart[] = joined.flatMap((b) => {
        const geos = (b.mesh!.userData.skinGeos as (() => THREE.BufferGeometry[]) | undefined)?.() ?? [b.mesh!.userData.baseGeo as THREE.BufferGeometry];
        owners.push(...geos.map(() => b));
        return geos.map((geo) => ({
          geo,
          toSkin: toGroup.clone().multiply(b.mesh!.matrixWorld),
          // textured materials lay their textures out in the rest pose
          toRest: textured ? b.restGroup.clone().multiply(b.mesh!.matrix) : undefined,
          color: this.shownColor(b),
          k: Math.max(0.005, Math.min(kMax, 0.6 * radius(b))),
          facet: geo.userData.facet as number | undefined,
        }));
      });
      // clay lumps go back on after the skin is built
      const lumps = style === 'clay' || style === 'stone' ? ((style === 'clay' ? k.lumps : k.rugged) ?? 0) * Math.min(0.012, Math.max(0.004, minR * 0.08)) : 0;
      const geo = await buildSkin(parts, { h, colorBlend: kc, lowPoly, lumps, shouldStop: () => version !== this.skinVersion });
      if (version !== this.skinVersion) {
        // something changed meanwhile: it'll be retried once things settle again
        geo?.dispose();
        for (const bm of built) bm.mesh.geometry.dispose();
        return false;
      }
      // this group couldn't be skinned: its parts just stay fast-merged (never retry
      // in a loop; the skin is only attempted again after the next change)
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo);
      mesh.receiveShadow = true;
      mesh.raycast = () => {}; // picking still goes to the (hidden) parts
      mesh.userData.skin = true;
      built.push({
        mesh,
        members: joined,
        owners,
        parts,
        lowPoly,
        painted: !!geo.userData.painted,
        colorKey: JSON.stringify([parts.map((p) => p.color.getHex()), kc]),
      });
    }
    if (version !== this.skinVersion) return false;

    // swap: skins in (dressed in the current look), their parts out
    for (const sk of built) {
      this.group.add(sk.mesh);
      this.dressSkin(sk);
    }
    this.skins = built;
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
      s.mergeRadius,
      blend,
      s.rig,
      this.group.position.toArray().map(r4),
      this.list.map((b) => b.pivot.quaternion.toArray().map(r4)),
      Object.entries(s.parts).map(([id, p]) => {
        const style = p.style ?? s.style;
        const k = this.settingsFor(style);
        // clay lumps and low-poly facet size change the shape; with blending off, color changes the groups
        return [id, partShapes(p), p.thickness, style, style === 'clay' ? k.lumps : style === 'stone' ? k.rugged : 0, style === 'lowpoly' ? k.facets : 0, blend ? '' : p.color.toLowerCase()];
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
    sk.parts.forEach((p, i) => p.color.copy(this.shownColor(sk.owners[i])));
    const colorKey = JSON.stringify([sk.parts.map((p) => p.color.getHex()), kc]);
    if (colorKey !== sk.colorKey) {
      sk.painted = paintSkin(sk.mesh.geometry, sk.parts, kc, sk.lowPoly);
      sk.colorKey = colorKey;
    }

    // nothing about the look changed (e.g. another part was edited): keep the
    // current dressing; rebuilding felt fuzz and stray hairs is expensive
    const lookKey = JSON.stringify([style, part.color, k, part.opacity ?? 1, sk.painted, colorKey, [...this.eyeSpots]]);
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
    mesh.material = mat;
    mesh.castShadow = mesh.receiveShadow = castsShadow(style);
    if (style === 'toon' && k.ink > 0) {
      const ink = new THREE.Mesh(geo, makeOutlineMaterial(k.ink));
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
      for (const b of same) if (!seen.has(b) && this.near(a, b, k)) (seen.add(b), queue.push(b));
    }
    return [...new Set([...seen].map((b) => b.src))];
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
    // felt: clear fuzz from under the eyes (reset first; refilled below)
    for (const b of this.list) if (b.mesh) setFuzzMask(b.mesh, []);
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
    for (const [b] of groups) setFuzzMask(b.mesh!, this.eyeSpots.get(b.def.id)!);
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

  /** The middle of a part's drawing, side to side, in its own frame: a hand-placed pair of eyes mirrors across it. */
  partMid(b: BoneRT): number {
    const geo = (b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined) ?? b.mesh?.geometry;
    if (!geo) return 0;
    if (!geo.boundingBox) geo.computeBoundingBox();
    return (geo.boundingBox!.min.x + geo.boundingBox!.max.x) / 2;
  }

  /** Stick one pair (or single eye) onto a part, found by aiming at it from the creature's front. */
  private placeEyes(part: BoneRT, pair: EyePair, pairIndex: number, group: THREE.Group, spots: FuzzSpot[]) {
    const e = this.state.eyes;
    // Work in the part's rest frame so eyes stick to it whatever the pose.
    const toWorld = part.restWorld;
    const toLocal = toWorld.clone().invert();
    const geo = (part.mesh!.userData.baseGeo as THREE.BufferGeometry) ?? part.mesh!.geometry;
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
      const mid = this.partMid(part);
      const reach = geo.boundingBox!.getSize(new THREE.Vector3()).length();
      const at = new THREE.Vector3(...pair.at);
      const n = new THREE.Vector3(...(pair.n ?? [0, 0, 1])).normalize();
      // kept in the left twin's frame; a right twin's is that mirrored across its Z
      if (part.def.sideSign === -1) {
        at.z = -at.z;
        n.z = -n.z;
      }
      // a pair dropped on the middle line is pushed apart so the two don't overlap
      if (!pair.single && Math.abs(at.x - mid) < r * 1.15) at.x = mid + (at.x < mid ? -1 : 1) * r * 1.15;
      const spin = (pair.turn ?? e.turn ?? 0) * (part.def.sideSign === -1 ? -1 : 1);
      const Y = new THREE.Vector3(0, 1, 0);
      for (const sgn of pair.single ? [0] : [1, -1]) {
        const p = at.clone(), d = n.clone();
        if (sgn === -1) {
          p.x = 2 * mid - p.x;
          d.x = -d.x;
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
      eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      // stand-off: lift the eye out along its facing direction
      eye.position.copy(hit.point).addScaledVector(z, (pair.lift ?? e.lift ?? 0) * r * 1.2);
      const style = EYE_STYLES.some((o) => o.id === e.style) ? e.style : 'googly';
      eye.add(buildEye(style, r, sgn || 1, partStyle, this.settingsFor(partStyle), e));
      eye.traverse((m) => {
        m.raycast = () => {};
        // glass casts no shadow, as with the body (see castsShadow): a glass
        // creature's glass beads would leave two shadows floating on the floor
        m.castShadow = !(m instanceof THREE.Mesh && (m.material as THREE.MeshPhysicalMaterial).transmission > 0);
      });
      group.add(eye);
      // bare patch just inside the eye's own rim, so it stays hidden behind it
      spots.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z, r: r * (style === 'flat' ? 1.1 : style === 'button' ? 1.0 : 0.85) });
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
      if (m && 'emissive' in m) {
        if (b.src === src && k > 0) m.emissive.setRGB(1, 0.42, 0.29).multiplyScalar(0.45 * k);
        else m.emissive.setScalar(0);
      }
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
    this.updateSizer();
    for (const g of this.eyes) g.visible = !id;
    for (const rec of this.attached.values()) {
      rec.main.visible = !id;
      if (rec.twin) rec.twin.visible = !id;
    }
    this.refreshHighlight();
  }

  private skeletonShown = false;

  setSkeletonVisible(v: boolean) {
    this.skeletonShown = v;
    const sel = this.selected ? this.bones.get(this.selected) : null;
    for (const b of this.list) {
      b.tip.visible = v;
      b.line.visible = v;
      // the slide and bend grips only on the selected bone (the twin follows by symmetry)
      b.startHandle.visible = v && b === sel && b.attach;
      b.bendHandle.visible = v && b === sel;
    }
    this.rootHandle.visible = v;
    this.updateSizer();
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

  /** Fit the size gizmo round the selected part, as it's shown right now. */
  updateSizer() {
    const b = this.selected ? this.bones.get(this.selected) : null;
    const box = b?.mesh?.userData.straightBox as THREE.Box3 | undefined;
    this.sizer.visible = !!b && !!box && this.skeletonShown && !this.drawFocus;
    if (!b || !box || !this.sizer.visible) return;
    if (this.sizer.parent !== b.pivot) b.pivot.add(this.sizer);
    const sc = b.mesh!.scale;
    // laid out round the straight part (in its stretched size), then bent onto it
    const pad = 0.025;
    const x0 = box.min.x * sc.x - pad;
    const x1 = box.max.x * sc.x + pad;
    const y0 = box.min.y * sc.y - pad;
    const y1 = box.max.y * sc.y + pad;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const pts: THREE.Vector3[] = [];
    const bent = !!((b.mesh!.userData.liveBend ?? b.mesh!.userData.bend) as Bend | undefined)?.theta;
    corners.forEach(([ax, ay], i) => {
      const [bx, by] = corners[(i + 1) % 4];
      // the long sides follow the curve
      const n = bent && ax === bx ? 16 : 1;
      for (let j = 0; j < n; j++) pts.push(this.sizerPoint(b, new THREE.Vector3(ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n, 0)));
    });
    this.sizerBox.geometry.dispose();
    this.sizerBox.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.sizerBox.computeLineDistances();
    const cy = (y0 + y1) / 2;
    // the roll ring and its axis: round the straight line from base to tip, however the part's bent
    const ringY = y0 + (y1 - y0) * 0.15;
    const ringR = Math.max(-x0, x1, -box.min.z * sc.z + pad, box.max.z * sc.z + pad, 0.08);
    const tipY = b.tip.position.y;
    this.rollAxis.geometry.dispose();
    this.rollAxis.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, Math.min(0, y0), 0), new THREE.Vector3(0, Math.max(tipY, y1), 0)]);
    this.rollAxis.computeLineDistances();
    for (const h of this.sizerHandles) {
      h.userData.handle = b.def.id;
      const sign = h.userData.sign as number;
      if (h.userData.kind === 'roll') {
        if (Math.abs(h.userData.ring - ringR) > 1e-4) {
          h.geometry.dispose();
          h.geometry = rollRingGeo(ringR);
          h.userData.ring = ringR;
        }
        h.position.set(0, ringY, 0);
        continue;
      }
      const at = new THREE.Vector3();
      if (h.userData.kind === 'len') at.set((x0 + x1) / 2, y1 + 0.07, 0);
      else if (h.userData.kind === 'wid') at.set(sign < 0 ? x0 - 0.06 : x1 + 0.06, cy, 0);
      else at.set(sign < 0 ? x0 : x1, y1, 0);
      h.userData.at = at;
      // the point on the part itself it stands for (without the frame's padding), which resizing moves
      h.userData.inner = new THREE.Vector3(
        h.userData.kind === 'len' ? ((box.min.x + box.max.x) / 2) * sc.x : (sign < 0 ? box.min.x : box.max.x) * sc.x,
        h.userData.kind === 'wid' ? (((box.min.y + box.max.y) / 2) * sc.y) : box.max.y * sc.y,
        0,
      );
      h.position.copy(this.sizerPoint(b, at));
      // turned with the curve where it sits
      const turn = (h.userData.turn ??= h.quaternion.clone()) as THREE.Quaternion;
      h.quaternion.copy(this.sizerTurn(b, at).multiply(turn));
    }
  }

  /** Where a point laid out round the straight part sits on it as it's bent (in the bone's frame). */
  sizerPoint(b: BoneRT, at: THREE.Vector3): THREE.Vector3 {
    // being resized: re-bent already, in the bone's own units
    const live = b.mesh?.userData.liveBend as Bend | undefined;
    if (live) {
      const [x, y, z] = bendPoint(live, at.x, at.y, at.z);
      return new THREE.Vector3(x, y, z);
    }
    const bd = b.mesh?.userData.bend as Bend | undefined;
    if (!bd?.theta) return at.clone();
    const sc = b.mesh!.scale;
    // bent as the mesh is (before its stretch), then stretched with it
    const [x, y, z] = bendPoint(bd, at.x / sc.x, at.y / sc.y, at.z / sc.z);
    return new THREE.Vector3(x * sc.x, y * sc.y, z * sc.z);
  }

  /** How far the bend turns things at a point laid out round the straight part. */
  private sizerTurn(b: BoneRT, at: THREE.Vector3): THREE.Quaternion {
    const live = b.mesh?.userData.liveBend as Bend | undefined;
    const bd = live ?? (b.mesh?.userData.bend as Bend | undefined);
    if (!bd?.theta) return new THREE.Quaternion();
    const sc = live ? new THREE.Vector3(1, 1, 1) : b.mesh!.scale;
    const phi = bendPoint(bd, at.x / sc.x, at.y / sc.y, at.z / sc.z)[3];
    // the bend turns its direction toward -Y by phi, about the axis square to both
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-Math.sin(bd.dir), 0, Math.cos(bd.dir)), -phi);
  }

  /**
   * The part's bend as it's shown now, in the bone's own units (what sizerAfter
   * works from).
   */
  bendNow(b: BoneRT): Bend {
    return bendOf(b.def, b.length * (b.mesh?.scale.y ?? 1));
  }

  /**
   * Where a size grip (laid out at `at`, standing for the point `inner` on the
   * part) would be after resizing by `kLen` along and `kWid` across, in the
   * bone's frame from before, when it was bent `bd`. With `alongBend` a bent
   * part's curve carries on (the bone turning to keep its start where it was);
   * without, the whole part grows, curve and all.
   */
  sizerAfter(bd: Bend, at: THREE.Vector3, inner: THREE.Vector3, kLen: number, kWid: number, alongBend: boolean): THREE.Vector3 {
    const len = bd.len;
    const st = alongBend ? stretchBend(len, bd.theta, kLen) : { len: len * kLen, theta: bd.theta, turn: 0 };
    const c = st.len / len;
    const p = new THREE.Vector3(inner.x * kWid + at.x - inner.x, inner.y * c + at.y - inner.y, at.z);
    const [x, y, z] = bendPoint({ len: st.len, theta: st.theta, dir: bd.dir }, p.x, p.y, p.z);
    const q = new THREE.Vector3(x, y, z);
    return st.turn ? q.applyAxisAngle(new THREE.Vector3(-Math.sin(bd.dir), 0, Math.cos(bd.dir)), st.turn) : q;
  }

  /**
   * While a bent part is resized (its bend may change too), re-bend its mesh
   * to the new shape rather than just stretching the old curve. It's rebuilt
   * properly on letting go.
   */
  previewBend(id: string) {
    for (const b of this.linked(id)) {
      const m = b.mesh;
      const straight = m?.userData.straightGeo as (() => THREE.BufferGeometry) | undefined;
      if (!m || !straight) continue;
      const s = m.scale;
      const bd = bendOf(b.def, b.length * s.y);
      if (!bd.theta && !(m.userData.bend as Bend).theta) continue;
      // bent at its new size, then shrunk back by the mesh's stretch (which the frame is laid out with)
      const sized = straight().clone().scale(s.x, s.y, s.z);
      sized.userData = {};
      const g = bendGeometry(sized, bd).scale(1 / s.x, 1 / s.y, 1 / s.z);
      sized.dispose();
      (m.userData.liveGeo as THREE.BufferGeometry | undefined)?.dispose();
      m.userData.liveGeo = g;
      m.userData.liveBend = bd;
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
      b.bendHandle.material = b.bendHandle === obj ? tipHoverMat : bendMat;
    }
    for (const h of this.sizerHandles) h.material = h === obj ? tipHoverMat : sizerMat;
    // whatever's under the pointer swells a little, so it's clear what you'll grab (the ring just lights up)
    for (const h of [this.rootHandle, ...this.sizerHandles, ...this.list.flatMap((b) => [b.tip, b.startHandle, b.bendHandle])]) h.scale.setScalar(h === obj && h.userData.ring === undefined ? 1.45 : 1);
    this.rollAxis.visible = this.rolling || obj?.userData.kind === 'roll';
  }

  handles(): THREE.Object3D[] {
    return [...this.sizerHandles, ...this.list.map((b) => b.bendHandle), ...this.list.map((b) => b.startHandle), this.rootHandle, ...this.list.map((b) => b.tip)];
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
  pickEye(ray: THREE.Ray): { pair: number; distance: number; sgn: number; bone: string } | null {
    const shown = this.eyes.filter((g) => g.parent && g.visible);
    let best: { pair: number; distance: number; sgn: number; bone: string } | null = null;
    const sphere = new THREE.Sphere();
    const at = new THREE.Vector3();
    for (const eye of shown.flatMap((g) => g.children)) {
      const { pair, r, sgn } = eye.userData.eye as { pair: number; r: number; sgn: number };
      eye.getWorldPosition(sphere.center);
      sphere.radius = r * eye.getWorldScale(at).x;
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

  /** Drag a bone tip toward `target`, optionally bending up to `chain` ancestors (CCD IK). */
  dragTip(id: string, target: THREE.Vector3, ik: boolean): BoneRT[] {
    const b = this.bones.get(id)!;
    const chain: BoneRT[] = [b];
    if (ik) {
      let p = b.parent;
      while (p && chain.length < 3 && !p.def.anchor) {
        chain.push(p);
        p = p.parent;
      }
    }
    this.mergeDirty = true;
    // turning the body itself: the legs it stands on keep hanging the way they
    // were, so it rears up or leans over its feet instead of tipping the whole critter
    const legs = b.parent ? [] : this.list.filter((c) => c.parent === b && this.reachesFloor(c));
    const legQ = legs.map((c) => c.pivot.getWorldQuaternion(new THREE.Quaternion()));
    const iterations = chain.length > 1 ? 12 : 1;
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

/** Pupil size as a scale on the default, 0.5x .. 1.5x. */
function pupilScale(e: EyesState): number {
  return 0.5 + (e.pupil ?? 0.5);
}

function buildEye(style: EyeStyle, r: number, sgn: number, headStyle: StyleId, headSettings: StyleSettings, e: EyesState): THREE.Object3D {
  const g = new THREE.Group();
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
      roll.rotation.set(-(e.lookY ?? 0) * 0.7, (e.lookX ?? 0) * 0.7, 0, 'YXZ');
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
      const px = e.lookX !== undefined ? e.lookX * travel : Math.max(-travel, Math.min(travel, sgn * 0.13 + 0.05));
      const py = (e.lookY ?? -1) * travel;
      // kept inside the disc when pushed into a corner (the loose one is as it always was)
      const placed = e.lookX !== undefined || e.lookY !== undefined;
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
      add(realSphere(r * 0.8, r * 0.8, r * 0.8), eyeMaterial(finish, e.color ?? '#1d1a22', headStyle, headSettings), [0, 0, -r * 0.3], [1, 1, 1]);
      break;
    }
    case 'dot': {
      // a flat disc of dark wool/clay pressed onto the face
      add(realSphere(r * 0.95, r * 0.95, r * 0.28), eyeMaterial(finish, e.color ?? '#2a2730', headStyle, headSettings), [0, 0, 0], [1, 1, 1]);
      break;
    }
    case 'button': {
      const R = r * 1.05;
      // buttons are glossy plastic unless a finish is chosen
      const mat =
        finish === 'body'
          ? new THREE.MeshPhysicalMaterial({ color: e.color ?? 0x2a2230, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 })
          : eyeMaterial(finish, e.color ?? '#2a2230', headStyle, headSettings);
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
      }
      break;
    }
  }
  return g;
}
