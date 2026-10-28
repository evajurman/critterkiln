import * as THREE from 'three';
import { bvhFor, exactDistance, sharedNormals } from './distance';
import { paintSkin, type SkinPart } from './skin';
import { buildSkinOff, laneOf } from './skinPool';
import { buildInflatedGeometry, defaultOutline, getMeshDetail, lumpFade, type Solid, type Vec2 } from './inflate';
import {
  castsShadow,
  glowWithFlash,
  setGlow,
  setFuzzMask,
  setOpacity,
  makeFuzzShells,
  makeMaterial,
  makeOutlineMaterial,
  makeStrayHairs,
  setTextureSpace,
  styleSettings,
  surfaceColor,
  type GlowFollow,
  type StyleId,
  type FuzzSpot,
  type StyleSettings,
} from './materials';
import { expandRig, type ExpandedBone, type ExpandedRig, type RigState, type V3 } from './rigs';
import type { PartAnim, StuffAnim } from './animate';
import { MAX_LAYERS, applyMarkings, markingKey, markingsKey, painted, setPictures, shownMarkings, type Marking } from './markings';
import { copyMove, scatterCopies, type ScatterBlocker, type ScatterCopy } from './scatter';
import { curvedGeometry, wrappedGeometry, type CurveSpace, type Thing, type WrapSurface } from './stuff';
import {
  type Bend,
  bendChild,
  bendGeometry,
  bendGrips,
  bendKey,
  bendOf,
  bendPoint,
  bonePoints,
  carryOnBend,
  isBent,
  joinShapes,
  pieceKindGeometry,
  restFrame,
  turnSideways,
} from './bend';
import { buildEye, varyEyeTexture } from './eyes';

/** One drawn shape of a part, puffed up on its own: drawn from the front (the default) or from the side. */
export interface PartShape {
  outline: Vec2[];
  side?: boolean;
  /** cut-outs (erased inside it while drawing): flat and puffy parts */
  holes?: Vec2[][];
}

export interface PartState {
  /** the first shape (null = not drawn yet: a default capsule) */
  outline: Vec2[] | null;
  /** the first shape was drawn from the side */
  side?: boolean;
  /** cut-outs in the first shape */
  holes?: Vec2[][];
  /** any further shapes; together they make the one part */
  more?: PartShape[];
  thickness: number;
  color: string;
  /** 0..1: the color shines with its own light (0 / unset = not at all) */
  glow?: number;
  /** where it glows from: the material, its markings, or (unset) evenly all over */
  glowFollow?: GlowFollow;
  style?: StyleId;
  /** patterns over its material (spots, stripes, cracks...), the last on top: see src/markings.ts */
  markings?: Marking[];
  /** 1 = solid, lower = see-through */
  opacity?: number;
  /**
   * How its drawing becomes 3D: puffy = puffed up like a balloon (the
   * default); flat = a cut-out with rounded edges; turned = spun round the
   * bone, like a part off a lathe (robot limbs, pillars, bottles)
   */
  kind?: PartKind;
  /** turned: a hollow shell rather than solid (cups, hats, pots) */
  hollow?: boolean;
  /** turned + hollow: left open at the tip end */
  open?: boolean;
  /**
   * Kept apart from the body: never blends into the parts it touches (a hat,
   * glasses). A name instead of true: blends only with the parts kept apart
   * under the same name (the pieces of one thing).
   */
  apart?: boolean | string;
  /** flat: how rounded its edges are, 0..1 (unset: 0.7) */
  round?: number;
  /** not shown, and not there to click or measure (the Stuff tab's bench stands its thing on one) */
  hidden?: boolean;
  /** turned + hollow: wall thickness (unset: a share of its widest radius) */
  wall?: number;
  /**
   * the top part of a thing: where the thing sits on the body, in this part's
   * own frame (a 4x4: origin where it touches, Z out of the surface, Y up).
   * Unset: it stands straight out along its bone.
   */
  sits?: number[];
  /** the top part of a thing from My stuff: which one (Update everywhere puts a change on every copy) */
  link?: string;
  /** curved: -1..1 (0 = flat as drawn); positive curves the edges back */
  curve?: number;
  /** along its centre line (a shield, a wing) or round its middle (a dome) */
  curveMode?: 'axis' | 'radial';
  /** kept apart: pressed onto the body like a decal, 0..1 (0 / unset = not) */
  wrap?: number;
  /** wrapped: how widely the body's surface is evened out first, 0..1 */
  wrapSmooth?: number;
  /**
   * Stuff made before it was parts: the space of the thing it was a piece of,
   * as this part's frame sees it (a 4x4, column-major), and how far that thing
   * reached, so it curves and wraps as the whole thing did.
   */
  thingSpace?: { m: number[]; reach: number; wrapReach: number };
  /** its own material settings, instead of the creature's for that material */
  materialSettings?: Partial<Record<StyleId, StyleSettings>>;
}

export type PartKind = 'puffy' | 'flat' | 'turned';

/**
 * The markings a part's material draws: the whole creature's (but those
 * turned off on it), then its own, the last on top. (Not its scatters: see scattersOf.)
 */
export function markingsOf(s: CreatureState, id: string): Marking[] {
  return painted(shownMarkings(s.markings, s.parts[id]?.markings, id));
}

/** The scatters a part shows (once they've a thing or a creature to scatter, even a thing not drawn yet), the whole creature's first. */
export function scattersOf(s: CreatureState, id: string): Marking[] {
  return shownMarkings(s.markings, s.parts[id]?.markings, id).filter((m) => m.type === 'scatter' && !!m.id && (!!m.thing || !!m.source));
}

/**
 * Which parts can blend into one surface, as a key per part: the same
 * material (and the same color, unless colors blend), whatever markings they
 * have, each fading in and out across the joins. Only if they'd need more
 * markings between them than one surface draws (MAX_LAYERS) do parts with
 * different markings stay apart.
 */
function blendKeys(s: CreatureState, blendColors: boolean): Map<string, string> {
  // (a part with its own material settings only blends with parts with the same ones)
  const base = (p: PartState) => (p.style ?? s.style) + (blendColors ? '' : p.color.toLowerCase()) + (p.materialSettings?.[p.style ?? s.style] ? JSON.stringify(p.materialSettings[p.style ?? s.style]) : '');
  const marks = new Map<string, Set<string>>();
  for (const [id, p] of Object.entries(s.parts)) for (const m of markingsOf(s, id)) (marks.get(base(p)) ?? marks.set(base(p), new Set()).get(base(p))!).add(markingKey(m));
  // a part kept apart is a group of its own
  return new Map(Object.entries(s.parts).map(([id, p]) => [id, base(p) + ((marks.get(base(p))?.size ?? 0) > MAX_LAYERS ? markingsKey(markingsOf(s, id)) : '') + (p.apart === true ? `|apart:${id}` : p.apart ? `|apart=${p.apart}` : '')]));
}

/** Whether a part is pressed onto the body (only a part kept apart from it can be). */
function wraps(p: PartState | undefined): boolean {
  return !!p?.apart && !!p.wrap && p.wrap > 0.005;
}

/**
 * Where a part curves and wraps from: the old thing's space for stuff that
 * became parts, otherwise its own drawing, from the middle of what's drawn
 * (the centre line is the bone's).
 */
function curveSpaceOf(p: PartState, shapes: PartShape[], rightTwin: boolean): CurveSpace {
  const space = curveSpaceAsDrawn(p, shapes);
  // a right twin's frame is its left twin's mirror image with Z flipped: flipped back, it curves (and wraps) the mirror image's way
  if (rightTwin) space.m.multiply(new THREE.Matrix4().makeScale(1, 1, -1));
  return space;
}
export function curveSpaceAsDrawn(p: PartState, shapes: PartShape[]): CurveSpace {
  if (p.thingSpace) return { m: new THREE.Matrix4().fromArray(p.thingSpace.m), reach: p.thingSpace.reach, wrapReach: p.thingSpace.wrapReach };
  const pts = shapes.flatMap((sh) => sh.outline);
  const ys = pts.map((q) => q[1]);
  const cy = pts.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  let axis = 0, round = 0;
  for (const [x, y] of pts) {
    axis = Math.max(axis, Math.abs(x));
    round = Math.max(round, Math.hypot(x, y - cy));
  }
  return { m: new THREE.Matrix4().makeTranslation(0, -cy, 0), reach: (p.curveMode ?? 'axis') === 'axis' ? axis : round, wrapReach: round };
}

/** A reshaped copy keeps the original's merge data (how thick the part is, for joins). */
function withSolid(g: THREE.BufferGeometry, from: THREE.BufferGeometry): THREE.BufferGeometry {
  if (from.userData.solid && !g.userData.solid) g.userData = { ...g.userData, solid: from.userData.solid };
  return g;
}

/** The markings one surface over these parts draws (each once, in order), and how much of each a part has (1 or 0: see paintMarks). */
function surfaceMarkings(s: CreatureState, bones: BoneRT[]): { layers: Marking[]; marksOf: (b: BoneRT) => number[] } {
  const layers: Marking[] = [];
  for (const b of bones) for (const m of markingsOf(s, b.src)) if (layers.length < MAX_LAYERS && !layers.some((l) => markingKey(l) === markingKey(m))) layers.push(m);
  const has = (b: BoneRT, l: Marking) => markingsOf(s, b.src).some((m) => markingKey(m) === markingKey(l));
  return { layers, marksOf: (b) => layers.map((l) => (has(b, l) ? 1 : 0)) };
}

/** Every shape a part was drawn as (none if it hasn't been drawn). */
export function partShapes(p: PartState): PartShape[] {
  if (!p.outline) return [];
  return [{ outline: p.outline, ...(p.side ? { side: true } : {}), ...(p.holes?.length ? { holes: p.holes } : {}) }, ...(p.more ?? [])];
}

/** Store a part's shapes (the first in `outline`, the rest in `more`). */
export function setPartShapes(p: PartState, shapes: PartShape[]) {
  p.outline = shapes[0]?.outline ?? null;
  if (shapes[0]?.side) p.side = true;
  else delete p.side;
  if (shapes[0]?.holes?.length) p.holes = shapes[0].holes;
  else delete p.holes;
  if (shapes.length > 1) p.more = shapes.slice(1).map((s) => ({ outline: s.outline, ...(s.side ? { side: true } : {}), ...(s.holes?.length ? { holes: s.holes } : {}) }));
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
  /** googly / sticker: 0 a round pupil .. 1 a cat's slit (default round) */
  cat?: number;
  /** googly / sticker: the pupil's color (default near black) */
  pupilColor?: string;
  /** googly / sticker: the eyeball's (or sticker's) color round the pupil (default white) */
  eyeballColor?: string;
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
  /** stays the same however the scene changes (what rides on it, or scatters it, holds on to) */
  id?: string;
  /** worn on a part of another creature: it goes where that part goes (instead of standing on the floor) */
  rides?: Ride;
  /** kept off the stage: only seen scattered over others (and while it's the one being edited) */
  offstage?: boolean;
  /** the table things are made on (see src/editor/focus.ts): there only while it's out */
  table?: boolean;
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
  /**
   * looping moves of a whole part on the part it hangs off (scene id): orbit,
   * spin, bob, swing, pulse, in that part's frame (what worn stuff used to do)
   */
  moves?: Record<string, StuffAnim>;
  /** markings on the whole creature (each can be turned off on some parts), under the parts' own */
  markings?: Marking[];
  /** pictures its markings show, by id (each kept once, however many parts show it) */
  pictures?: Record<string, string>;
  /** 1 once patterns that used to be material settings (stone cracks, metal patina...) are parts' markings (see migrateMarkings) */
  markingsV?: number;
  /** 2 once things' markings are laid out where the things are (see repairThingMarkings) */
  stuffV?: number;
}

/** Where a creature rides on another: the other's id, the part, and its place in that part's frame (its floor point there). */
export interface Ride {
  on: string;
  bone: string;
  position: V3;
  quaternion: [number, number, number, number];
  scale: V3;
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
/** a foot the body stands on (see plantedFeet): the parts from it up to the body, and where it rests */
export interface Planted {
  chain: BoneRT[];
  at: THREE.Vector3;
}

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
    // touching parts of different colors fade into each other
    mergeColors: true,
    colorBlend: 0.2,
    // (made now: nothing to bring up to date, see migrateMarkings)
    markingsV: 2,
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
for (const m of [tipMat, tipHoverMat, lineMat, outlineLineMat, planeMat, startMat, bendMat, bendGhostMat, bendDotMat, rollMat, rollLineMat]) m.userData.shared = true;
const tipGeo = new THREE.SphereGeometry(0.032, 16, 12);
const startGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
const bendGeo = new THREE.OctahedronGeometry(0.042);
const bendEdges = new THREE.EdgesGeometry(bendGeo);
/** The roll ring: a thin hoop round the line from a part's base to its tip (radius 1, scaled to fit). */
function rollRingGeo(r: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, 0.012, 8, 64).rotateX(Math.PI / 2);
}

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
  /** Another creature in the scene, by its id (for scattering copies of it): set by the editor. */
  static find: (id: string) => Creature | undefined = () => undefined;
  /** goes up whenever it's rebuilt or posed (creatures scattered with it look again) */
  version = 0;
  /** placement in the scene (floor position + facing); holds `group` */
  readonly root = new THREE.Group();
  /** the creature itself; its position is the pose's root offset */
  readonly group = new THREE.Group();
  rig: ExpandedRig;
  readonly bones = new Map<string, BoneRT>();
  readonly list: BoneRT[] = [];
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
  /** scattered copies, per part and scatter (bone id | marking id) */
  private scattered = new Map<string, ScatterRec>();
  /** the scatters' motion clock: seconds, and how long one loop is */
  private scatterClock = { t: 0, loop: 1.5 };

  /** `skeletonOnly`: just the posed skeleton, no meshes (for measuring it, cheaply) */
  constructor(state: CreatureState, skeletonOnly = false) {
    this.state = state;
    this.root.add(this.group);
    this.rig = expandRig(state.rig);
    this.ensureParts();
    this.buildSkeleton();
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
      this.followEyes(b, bd);
      this.placeBendHandles(b, bd);
      b.line.geometry.dispose();
      b.line.geometry = new THREE.BufferGeometry().setFromPoints(bonePoints(bd));
    }
    this.updateRestFrames();
    // reshaping keeps the pose: bones stay bent the way they were
    this.applyPose();
    this.mergeDirty = true;
    this.updateRollRing();
  }

  /** Solo: the only parts shown, and the only ones that can be clicked (null: all of them). */
  solo: Set<string> | null = null;

  /** The parts a click can land on (in Solo, just those shown). */
  pickable(): THREE.Object3D[] {
    const only = this.solo;
    return only ? this.list.flatMap((b) => (b.mesh && only.has(b.def.id) ? [b.mesh] : [])) : this.meshes();
  }

  /** Show just these parts (no blended skin, no eyes, no other part's handles or scattered copies) while `fn` runs. */
  withOnly<T>(ids: Set<string>, fn: () => T): T {
    const hidden: THREE.Object3D[] = [];
    const hide = (o: THREE.Object3D) => {
      if (!o.visible) return;
      o.visible = false;
      hidden.push(o);
    };
    for (const b of this.list) {
      if (ids.has(b.def.id)) continue;
      for (const o of [b.mesh, b.tip, b.line, b.startHandle]) if (o) hide(o);
    }
    for (const sk of this.skins) hide(sk.mesh);
    for (const e of this.eyes) hide(e);
    for (const rec of this.scattered.values()) hide(rec.group);
    try {
      return fn();
    } finally {
      for (const o of hidden) o.visible = true;
    }
  }

  /** A part's settings for a material: its own if it has them, otherwise the creature's. */
  settingsOf(p: PartState | undefined, style: StyleId): StyleSettings {
    const own = p?.materialSettings?.[style];
    return own ? styleSettings(style, { ...this.state.materialSettings?.[style], ...own }) : this.settingsFor(style);
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
    this.version++;
    this.baseTouch.clear();
    const s = this.state;
    setPictures(s.pictures);
    this.applyPlacement();
    // a glow change alone (painting the whole creature, undo) leaves every
    // part's mesh as it is, but the skins still need it
    const glowKey = JSON.stringify(Object.values(s.parts).map((p) => [p.glow ?? 0, p.glowFollow]));
    if (glowKey !== this.glowKey) {
      this.glowKey = glowKey;
      this.mergeDirty = true;
    }
    const buildPart = (b: BoneRT) => {
      const p = s.parts[b.src];
      const style = p.style ?? s.style;
      const shapes = this.shapesFor(b);
      const k = this.settingsOf(p, style);
      const kind = p.kind ?? 'puffy';
      const curve = p.curve && Math.abs(p.curve) >= 0.005 ? p.curve : 0;
      const wrap = wraps(p) ? p.wrap! : 0;
      const geoOpts = {
        kind,
        ...(kind === 'turned' && p.hollow ? { hollow: true, open: !!p.open, ...(p.wall ? { wall: p.wall } : {}) } : {}),
        ...(kind === 'flat' && p.round !== undefined ? { round: p.round } : {}),
        ...(curve ? { curve, curveMode: p.curveMode ?? 'axis', thingSpace: p.thingSpace } : {}),
        thickness: p.thickness,
        lowPoly: style === 'lowpoly',
        facetScale: style === 'lowpoly' ? k.facets : undefined,
        colorJitter: style === 'lowpoly' ? k.variation : undefined,
        lumps: style === 'clay' ? k.lumps : style === 'stone' ? k.rugged : 0,
      };
      const geoKey = JSON.stringify([shapes, geoOpts, getMeshDetail()]);
      const marks = markingsOf(s, b.src);
      // a wrapped part follows the body as it's shaped and posed
      const wrapKey = wrap ? JSON.stringify([wrap, p.wrapSmooth, s.pose, b.pivot.matrixWorld.elements.map((v) => Math.round(v * 1e4)), this.list.filter((o) => !s.parts[o.src].apart).map((o) => o.meshKey)]) : '';
      const key = geoKey + style + p.color + JSON.stringify(k) + markingsKey(marks) + (p.opacity ?? 1) + bendKey(bendOf(b.def, b.length)) + wrapKey;
      if (key === b.meshKey) {
        this.glowPart(b);
        return;
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
        (b.mesh.userData.wrappedGeo as THREE.BufferGeometry | undefined)?.dispose();
      }
      const bd = bendOf(b.def, b.length);
      const space = curve || wrap ? curveSpaceOf(p, shapes, b.def.sideSign === -1) : null;
      const seed = hashString(b.src);
      // each shape puffed up on its own (turned a quarter round if drawn from the side), then bent with the bone
      const straightGeo = (sh: PartShape, i: number, opts: typeof geoOpts) => {
        const sk = JSON.stringify([sh.outline, sh.holes, opts, getMeshDetail(), i]) + (sh.side ? 'side' : '');
        const flat = cachedGeometry(sk, () => {
          const g =
            opts.kind === 'puffy'
              ? buildInflatedGeometry(sh.outline, { ...opts, seed: seed + i, holes: sh.holes })
              : pieceKindGeometry(opts.kind, sh.outline, opts.thickness, opts.lowPoly, {
                  holes: sh.holes,
                  hollow: 'hollow' in opts && opts.hollow,
                  open: 'open' in opts && opts.open,
                  wall: 'wall' in opts ? opts.wall : undefined,
                  round: 'round' in opts ? opts.round : undefined,
                });
          // curved in its own drawing's plane, before it's turned a quarter round or bent with the bone
          if (!('curve' in opts) || !opts.curve || !space) return g;
          const c = curvedGeometry(g, opts.curveMode ?? 'axis', opts.curve, space);
          return c === g ? g : withSolid(c, g);
        });
        return { sk, geo: sh.side ? cachedGeometry(sk + 'turned', () => turnSideways(flat)) : flat };
      };
      const shapeGeo = (sh: PartShape, i: number, opts: typeof geoOpts) => {
        const { sk, geo: turned } = straightGeo(sh, i, opts);
        return isBent(bd) ? cachedGeometry(sk + bendKey(bd), () => bendGeometry(turned, bd)) : turned;
      };
      let geo =
        shapes.length === 1
          ? shapeGeo(shapes[0], 0, geoOpts)
          : cachedGeometry(geoKey + bendKey(bd), () => joinShapes(shapes.map((sh, i) => shapeGeo(sh, i, geoOpts))));
      let wrappedGeo: THREE.BufferGeometry | null = null;
      if (wrap && space) {
        const surface = this.surfaceUnder(b.pivot.matrixWorld.clone().multiply(space.m.clone().invert()), (o) => !!s.parts[o.src].apart);
        if (surface) geo = wrappedGeo = withSolid(wrappedGeometry(geo, surface, p.wrapSmooth ?? 0.3, wrap, space), geo);
      }
      const mesh = new THREE.Mesh(geo, makeMaterial(style, p.color, k));
      if (wrappedGeo) mesh.userData.wrappedGeo = wrappedGeo;
      applyMarkings(mesh.material as THREE.Material, marks);
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
        for (const shell of makeFuzzShells(geo, p.color, k)) {
          // the fuzz takes the markings too, or it would hide them
          applyMarkings(shell.material as THREE.Material, marks);
          mesh.add(shell);
        }
        if (k.hairs > 0) mesh.add(makeStrayHairs(geo, p.color, hashString(b.def.id), k.hairs, false, 1, k.fuzz));
      }
      setOpacity(mesh, p.opacity ?? 1);
      // (a hidden part keeps its place, unseen)
      if (p.hidden) mesh.visible = false;
      // textures (and fuzz) are laid out in the rest pose and bend with the bones
      setTextureSpace(mesh, b.restGroup);
      b.pivot.add(mesh);
      b.mesh = mesh;
      this.glowPart(b);
    };
    // parts pressed onto the body go last, onto the rest as it's posed now
    const wrapped = this.list.filter((b) => wraps(s.parts[b.src]));
    for (const b of this.list) if (!wrapped.includes(b)) buildPart(b);
    if (wrapped.length) {
      this.applyPose();
      this.group.updateMatrixWorld(true);
      for (const b of wrapped) buildPart(b);
    }
    this.applyPose();
    this.syncEyes();
    this.syncScatter();
    this.refreshHighlight();
    this.updateRollRing();
  }

  // -------------------------------------------------------------------------
  // pairs, and the surface under a thing

  twinOf(b: BoneRT): BoneRT | null {
    if (b.def.sideSign === 0) return null;
    return this.bones.get(b.def.baseId + (b.def.sideSign === 1 ? 'R' : 'L')) ?? null;
  }

  /** Where an attachment's mirrored copy goes: the twin limb, or (a middle part) the part itself, across the creature's middle. */
  mirrorBoneOf(b: BoneRT): BoneRT | null {
    return b.def.sideSign === 0 ? b : this.twinOf(b);
  }

  /**
   * The creature's outer surface seen from in front of a space (`thingToWorld`;
   * its -Z points at the body): how far along its Z the surface sits under
   * each point (x, y) of it, as posed now. Parts `skip` says to leave out don't count.
   */
  surfaceUnder(thingToWorld: THREE.Matrix4, skip: (b: BoneRT) => boolean = () => false): WrapSurface | undefined {
    this.group.updateMatrixWorld(true);
    const parts = this.list.flatMap((b) => {
      if (skip(b)) return [];
      const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
      if (!b.mesh || !geo) return [];
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const toWorld = b.mesh.matrixWorld.clone();
      return [{ bvh: bvhFor(geo), toWorld, toGeo: toWorld.clone().invert(), sphere: geo.boundingSphere!.clone().applyMatrix4(toWorld) }];
    });
    if (!parts.length) return undefined;
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

  // -------------------------------------------------------------------------
  // scattered stuff: copies of a thing over parts (scatter markings, see src/scatter.ts)

  private syncScatter() {
    const s = this.state;
    const alive = new Set<string>();
    // where copies go hangs on every part's shape (they keep out of each other)
    const shapes = hashString(this.list.map((b) => b.meshKey).join('|'));
    let blockers: (ScatterBlocker & { bone: BoneRT })[] | null = null;
    for (const b of this.list) {
      if (!b.mesh) continue;
      for (const m of scattersOf(s, b.src)) {
        const id = b.def.id + '|' + m.id;
        alive.add(id);
        const style = s.parts[b.src]?.style ?? s.style;
        // (how they move doesn't change where they are)
        const key = JSON.stringify([{ ...m, motion: 0, skip: 0 }, style, s.materialSettings, getMeshDetail(), shapes]);
        let rec = this.scattered.get(id);
        if (rec?.key === key) {
          rec.m = m;
          continue;
        }
        if (rec) this.dropScatter(rec);
        blockers ??= this.scatterBlockers();
        rec = this.buildScatter(b, m, style, blockers.filter((o) => o.bone !== b));
        rec.key = key;
        this.scattered.set(id, rec);
      }
    }
    for (const [id, rec] of this.scattered) {
      if (alive.has(id)) continue;
      this.dropScatter(rec);
      this.scattered.delete(id);
    }
    for (const rec of this.scattered.values()) this.placeCopies(rec);
  }

  /** Every part, as something copies mustn't sit inside, in the rest pose. */
  private scatterBlockers(): (ScatterBlocker & { bone: BoneRT })[] {
    return this.list.flatMap((o) => {
      const geo = o.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
      if (!geo) return [];
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      return [{ bone: o, geo, bvh: bvhFor(geo), fromRest: o.restGroup.clone().invert(), sphere: geo.boundingSphere!.clone().applyMatrix4(o.restGroup) }];
    });
  }

  private buildScatter(b: BoneRT, m: Marking, style: StyleId, blockers: ScatterBlocker[]): ScatterRec {
    // the scattered creature lends its own meshes, as they are
    const looks = this.sourceMeshes(m);
    const box = new THREE.Box3();
    for (const l of looks) {
      if (!l.mesh.geometry.boundingBox) l.mesh.geometry.computeBoundingBox();
      box.union(l.mesh.geometry.boundingBox!.clone().applyMatrix4(l.rel));
    }
    const extent = box.isEmpty() ? 0.3 : box.getSize(new THREE.Vector3()).length();
    const geo = b.mesh!.userData.baseGeo as THREE.BufferGeometry;
    // (a pair of parts share their part's spots: mirror images)
    const copies = scatterCopies(m, { geo, toRest: b.restGroup, up: this.upIn(b.def.id) }, blockers, extent, b.src);
    const group = new THREE.Group();
    b.pivot.add(group);
    const rec: ScatterRec = { key: '', m, bone: b, group, copies, parts: [], look: m.source ? this.sourceLook(m.source) : '' };
    this.dressCopies(rec, looks);
    return rec;
  }

  /** One instanced mesh per mesh of what's scattered (fuzz and ink too): every copy in one go. */
  private dressCopies(rec: ScatterRec, looks: { mesh: THREE.Mesh; rel: THREE.Matrix4 }[]) {
    for (const p of rec.parts) {
      p.mesh.removeFromParent();
      p.mesh.dispose();
    }
    rec.parts = [];
    if (!rec.copies.length) return;
    for (const { mesh: o, rel } of looks) {
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, rec.copies.length);
      mesh.castShadow = o.castShadow;
      mesh.receiveShadow = o.receiveShadow;
      mesh.renderOrder = o.renderOrder;
      // (copies move: their bounds aren't kept up to date)
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      rec.parts.push({ mesh, rel });
      rec.group.add(mesh);
    }
  }

  /** A scattered creature's meshes, as it looks now (none if it's gone, or it's this one). */
  private sourceMeshes(m: Marking): { mesh: THREE.Mesh; rel: THREE.Matrix4 }[] {
    const src = m.source ? Creature.find(m.source) : undefined;
    return src && src !== this ? src.lookMeshes() : [];
  }

  /** What a scattered creature looks like now, in short: a change means its copies need dressing again. */
  private sourceLook(id: string): string {
    const src = Creature.find(id);
    if (!src || src === this) return 'none';
    return src.version + ':' + src.lookMeshes().map((l) => `${l.mesh.geometry.id}.${(l.mesh.material as THREE.Material).uuid}`).join(',');
  }

  /** Copies of other creatures follow them as they're changed or posed. True if any did. */
  refreshScatterSources(): boolean {
    let changed = false;
    for (const rec of this.scattered.values()) {
      if (!rec.m.source) continue;
      const look = this.sourceLook(rec.m.source);
      if (look === rec.look) continue;
      rec.look = look;
      this.dressCopies(rec, this.sourceMeshes(rec.m));
      this.placeCopies(rec);
      changed = true;
    }
    return changed;
  }

  /**
   * What this creature looks like: each mesh showing (parts or their skin,
   * eyes, worn stuff; no handles, no scattered copies) and where it sits on
   * it, posed but not placed. For scattering copies of it over another.
   */
  lookMeshes(): { mesh: THREE.Mesh; rel: THREE.Matrix4 }[] {
    this.root.updateMatrixWorld(true);
    const toRoot = this.root.matrixWorld.clone().invert();
    const shown = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p && p !== this.root; p = p.parent) if (!p.visible) return false;
      return true;
    };
    const out: { mesh: THREE.Mesh; rel: THREE.Matrix4 }[] = [];
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.userData.handle || o.userData.kind || !shown(o)) return;
      // (the editor's own see-through guides and highlights draw over everything: not part of its look)
      const mat = o.material as THREE.Material;
      if (mat.depthTest === false) return;
      out.push({ mesh: o, rel: toRoot.clone().multiply(o.matrixWorld) });
    });
    return out;
  }

  private dropScatter(rec: ScatterRec) {
    rec.group.removeFromParent();
    for (const p of rec.parts) p.mesh.dispose();
  }

  /** The scatter's first copy (the one hidden while it's edited): on the first part with any, in order. */
  private firstCopies(id: string): ScatterRec | null {
    for (const b of this.list) {
      const rec = this.scattered.get(b.def.id + '|' + id);
      if (rec?.copies.length) return rec;
    }
    return null;
  }

  /** Put each copy where it goes, moved (by the clock) if the scatter moves. */
  private placeCopies(rec: ScatterRec) {
    const move = new THREE.Matrix4(), out = new THREE.Matrix4();
    rec.copies.forEach((c, i) => {
      copyMove(rec.m, c.phase, this.scatterClock.t, this.scatterClock.loop, move);
      for (const p of rec.parts) {
        out.multiplyMatrices(c.matrix, move).multiply(p.rel);
        p.mesh.setMatrixAt(i, out);
      }
    });
    for (const p of rec.parts) p.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Move scattered copies to `t` seconds (on a loop `loop` long). True if any moved. */
  tickScatter(t: number, loop: number): boolean {
    this.scatterClock = { t, loop };
    let moved = false;
    for (const rec of this.scattered.values()) {
      if (!rec.m.motion || !rec.copies.length || !rec.group.visible) continue;
      this.placeCopies(rec);
      moved = true;
    }
    return moved;
  }

  /** Show or hide every scattered copy. */
  setScatterVisible(on: boolean) {
    for (const rec of this.scattered.values()) rec.group.visible = on;
  }

  /** Which way is up (the creature's +Y, at rest) in a part's frame. */
  upIn(boneId: string): THREE.Vector3 {
    const b = this.bones.get(boneId);
    if (!b) return new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3(0, 1, 0).transformDirection(b.restGroup.clone().invert());
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

  /** Parts' moves on the parts they hang off, shown on top of the pose (see CreatureState.moves): per bone, in its parent's frame. */
  private moving: Map<string, THREE.Matrix4> | null = null;
  /** where each moved part's base was before its move, and where the move put it */
  private movedFrom = new Map<BoneRT, { base: THREE.Vector3; at: THREE.Vector3 }>();
  setMoves(m: Map<string, THREE.Matrix4> | null) {
    if (!m && !this.moving) return;
    this.moving = m;
    this.applyPose();
  }

  /** A part's base, as placed (without a move showing on it). */
  private basePosition(b: BoneRT): THREE.Vector3 {
    const was = this.movedFrom.get(b);
    return was && b.pivot.position.equals(was.at) ? was.base.clone() : b.pivot.position.clone();
  }

  /**
   * A part, in the frame of the part it hangs off, as posed but not moving:
   * its middle, which way it stands out (along its bone) and across (its
   * side), its size, and its base. What a move goes round, rocks from or grows from.
   */
  moveFrame(id: string): { center: THREE.Vector3; normal: THREE.Vector3; side: THREE.Vector3; size: number; origin: THREE.Vector3 } | null {
    const b = this.bones.get(id);
    if (!b?.parent || !b.mesh) return null;
    const q = b.restQuat.clone();
    const pose = this.state.pose[b.def.id];
    if (pose) q.multiply(new THREE.Quaternion(...pose));
    const origin = this.basePosition(b);
    const local = new THREE.Matrix4().compose(origin, q, new THREE.Vector3(1, 1, 1));
    const geo = b.mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox!.clone().applyMatrix4(local);
    return {
      center: box.getCenter(new THREE.Vector3()),
      normal: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      side: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      size: box.getSize(new THREE.Vector3()).length(),
      origin,
    };
  }

  applyPose() {
    this.version++;
    this.baseTouch.clear();
    // only a real change re-merges: sync() calls this on every look edit too
    const before = this.list.map((b) => b.pivot.quaternion.clone());
    const puffBefore = [...this.puffed].map((m) => m.scale.x).join();
    const pos = this.group.position.clone();
    for (const m of this.puffed) m.scale.x = m.scale.z = 1;
    this.puffed.clear();
    // moved parts back where they're placed (unless they've been placed again since)
    for (const [b, was] of this.movedFrom) {
      if (b.pivot.position.equals(was.at)) b.pivot.position.copy(was.base);
      b.pivot.scale.setScalar(1);
    }
    this.movedFrom.clear();
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
    if (this.moving) {
      for (const b of this.list) {
        const m = this.moving.get(b.def.id);
        if (!m || !b.parent) continue;
        const base = b.pivot.position.clone();
        const local = m.clone().multiply(new THREE.Matrix4().compose(base, b.pivot.quaternion, new THREE.Vector3(1, 1, 1)));
        local.decompose(b.pivot.position, b.pivot.quaternion, b.pivot.scale);
        this.movedFrom.set(b, { base, at: b.pivot.position.clone() });
      }
    }
    if ([...this.puffed].map((m) => m.scale.x).join() !== puffBefore) this.mergeDirty = true;
    this.group.position.set(...this.state.rootOffset);
    if (!this.group.position.equals(pos) || this.list.some((b, i) => !b.pivot.quaternion.equals(before[i]))) this.mergeDirty = true;
  }

  capturePose() {
    const pose: CreatureState['pose'] = {};
    // (moves on top are left out too)
    if (this.moving) this.setMoves(null);
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

  /** Where a bone is now, posed, in the skeleton's coordinates: its base, the end of its straight line, and (bent) the curve between. */
  posedEnds(id: string): { start: V3; end: V3; path?: V3[] } | undefined {
    const b = this.bones.get(id);
    if (!b) return undefined;
    this.group.updateMatrixWorld(true);
    const m = this.group.matrixWorld.clone().invert().multiply(b.pivot.matrixWorld);
    const at = (y: number) => new THREE.Vector3(0, y, 0).applyMatrix4(m).toArray() as V3;
    // a bent part: the curve it follows, too (a base in its sag is in it)
    const bd = bendOf(b.def, b.length);
    const path = isBent(bd) ? bonePoints(bd).map((p) => p.applyMatrix4(m).toArray() as V3) : undefined;
    return { start: at(0), end: at(b.length), path };
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

    const keys = blendKeys(s, blend);
    const groups = new Map<string, BoneRT[]>();
    for (const b of this.list) {
      if (!b.mesh) continue;
      const key = keys.get(b.src)!;
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
    const keys = blendKeys(s, blend);
    const groups = new Map<string, BoneRT[]>();
    for (const b of this.list) {
      if (!b.mesh) continue;
      const key = keys.get(b.src)!;
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
      const k = this.settingsOf(part, style);
      const minR = Math.min(...joined.map(radius));
      const lowPoly = style === 'lowpoly';
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
      // (only low-poly, built on the grid, needs it: fillets join the parts as they are, and ones that don't blend just meet in a crease)
      const peels = onlyConnected && lowPoly ? this.peelsFor(joined, h) : [];
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
        const marked = surfaceMarkings(s, all);
        const parts: SkinPart[] = all.flatMap((b) => {
          const geos = (b.mesh!.userData.skinGeos as (() => THREE.BufferGeometry[]) | undefined)?.() ?? [b.mesh!.userData.baseGeo as THREE.BufferGeometry];
          owners.push(...geos.map(() => b));
          return geos.map((geo) => ({
            geo,
            toSkin: toGroup.clone().multiply(b.mesh!.matrixWorld),
            // textures and markings are laid out in the rest pose
            toRest: b.restGroup.clone().multiply(b.mesh!.matrix),
            color: this.shownColor(b),
            glow: s.parts[b.src].glow ?? 0,
            marks: marked.marksOf(b),
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
        colorKey: JSON.stringify([sk.parts.map((p) => [p.color.getHex(), p.glow, p.marks]), kc]),
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
        const k = this.settingsOf(p, style);
        // clay lumps and low-poly facet size change the shape; with blending off, color changes the groups
        return [id, partShapes(p), p.thickness, p.kind, p.hollow, p.open, p.round, p.wall, p.curve, p.curveMode, p.thingSpace, style, style === 'clay' ? k.lumps : style === 'stone' ? k.rugged : 0, style === 'lowpoly' ? k.facets : 0, blend ? '' : p.color.toLowerCase()];
      }),
      // which parts blend together (markings split them up): changing a marking they all share only re-dresses the skin
      ((keys) => [...keys.values()].map((k) => [...keys.values()].indexOf(k)))(blendKeys(s, blend)),
    ]);
  }

  /** Give a skin the current look: colors, material, felt fuzz, toon ink, opacity. */
  private dressSkin(sk: SkinEntry) {
    const s = this.state;
    const part = s.parts[sk.members[0].src];
    const style = part.style ?? s.style;
    const k = this.settingsOf(part, style);
    const kc = s.mergeColors ? (s.colorBlend ?? 0.12) : 0;
    // every marking its parts have, each fading out over the parts without it (see paintMarks)
    const marked = surfaceMarkings(s, sk.owners);

    // repaint only if the colors (or the fade width) changed
    sk.parts.forEach((p, i) => {
      p.color.copy(this.shownColor(sk.owners[i]));
      p.glow = s.parts[sk.owners[i].src].glow ?? 0;
      p.marks = marked.marksOf(sk.owners[i]);
    });
    const colorKey = JSON.stringify([sk.parts.map((p) => [p.color.getHex(), p.glow, p.marks]), kc]);
    if (colorKey !== sk.colorKey) {
      sk.painted = paintSkin(sk.mesh.geometry, sk.parts, kc, sk.lowPoly);
      sk.colorKey = colorKey;
    }

    // nothing about the look changed (e.g. another part was edited): keep the
    // current dressing; rebuilding felt fuzz and stray hairs is expensive
    // a skin glows from where its first glowing part does
    const follow = sk.owners.map((b) => s.parts[b.src]).find((p) => p.glow)?.glowFollow;
    const lookKey = JSON.stringify([style, part.color, part.glow ?? 0, follow, k, markingsKey(marked.layers), part.opacity ?? 1, sk.painted, colorKey, [...this.eyeSpots]]);
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
    applyMarkings(mat, marked.layers, !!geo.getAttribute('markW'));
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
        applyMarkings(shell.material as THREE.Material, marked.layers, !!geo.getAttribute('markW'));
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
    return surfaceColor(style, p.color, this.settingsOf(p, style));
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
    const keys = blendKeys(s, blend);
    const key = (b: BoneRT) => keys.get(b.src);
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
    // with half its thickness to spare: a base resting on a part's surface counts. Its thickness a
    // little way up it: right at the bone's start it's only as thick as the rounded end there
    const bd = bendOf(a.def, a.length);
    const thick = Math.max(
      0,
      ...[0, 0.1, 0.2].map((f) => {
        const [x, y, z] = bendPoint(bd, 0, a.length * f, 0);
        return -this.reachAt(a.pivot.localToWorld(new THREE.Vector3(x, y, z)), a);
      }),
    );
    const touches = this.reachAt(a.pivot.getWorldPosition(new THREE.Vector3()), b) < 1.5 * thick;
    row.set(b, touches);
    return touches;
  }

  /** How far a point (in the scene) is from part `b`'s surface, in creature units (negative inside, Infinity when far). */
  private reachAt(at: THREE.Vector3, b: BoneRT): number {
    const geo = b.mesh?.userData.baseGeo as THREE.BufferGeometry | undefined;
    if (!geo) return Infinity;
    this.group.updateMatrixWorld(true);
    const q = at.clone().applyMatrix4(b.mesh!.matrixWorld.clone().invert());
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
   * While a part's stretched (its mesh not yet rebuilt), its eyes ride the
   * same spots on it, from where they were placed on the mesh as built to the
   * bone's new shape `to`. They're placed afresh once it's rebuilt.
   */
  private followEyes(b: BoneRT, to: Bend) {
    const from = (b.mesh?.userData.bend as Bend | undefined) ?? { len: b.length, theta: 0, dir: 0 };
    for (const g of this.eyes) {
      if (g.parent !== b.pivot) continue;
      for (const eye of g.children) {
        const rest = eye.userData.rest as THREE.Vector3 | undefined;
        if (rest) eye.position.copy(carryOnBend(from, to, 1, rest).p);
      }
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
      // (where it sits on the mesh as built, for riding a stretch: see followEyes)
      eye.userData.rest = eye.position.clone();
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

  /** Glow the selected parts (and their twins); k fades 1 -> 0. */
  flash(ids: string | string[] | null, k: number) {
    const srcs = new Set((Array.isArray(ids) ? ids : ids ? [ids] : []).map((id) => this.bones.get(id)?.src));
    for (const b of this.list) {
      const m = b.mesh?.material as THREE.MeshStandardMaterial | undefined;
      if (m && 'emissive' in m) glowWithFlash(m, srcs.has(b.src) && k > 0 ? FLASH.setRGB(1, 0.42, 0.29).multiplyScalar(0.45 * k) : undefined);
      // A part under a seamless skin is hidden, so its own glow can't be
      // seen: glow a copy of its surface, puffed out a touch, over the skin.
      let hl = this.highlights.get(b);
      const on = !!b.mesh && !b.mesh.visible && srcs.has(b.src) && k > 0;
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
      // (a hidden part has no handles either)
      const show = v && (!only || only.has(b)) && !this.state.parts[b.src]?.hidden;
      b.tip.visible = show;
      b.line.visible = show;
      // the slide and bend grips only on the selected bone (the twin follows by symmetry)
      // (on the body it moves the body over the feet it stands on, so only when it stands on any)
      b.startHandle.visible = v && b === sel && b.attach && (!!b.parent || this.plantedFeet(b).length > 0);
      this.showBendGrips(b, v && b === sel);
    }
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
    for (const h of [this.rollRing, ...this.list.flatMap((b) => [b.tip, b.startHandle, ...b.bendHandles])]) h.scale.setScalar(h === obj && h.userData.ring === undefined ? 1.45 : 1);
    this.rollAxis.visible = this.rolling || obj?.userData.kind === 'roll';
  }

  handles(): THREE.Object3D[] {
    // (the roll ring only while it's shown)
    return [...(this.rollGizmo.visible ? [this.rollRing] : []), ...this.list.flatMap((b) => b.bendHandles), ...this.list.map((b) => b.startHandle), ...this.list.map((b) => b.tip)];
  }

  meshes(): THREE.Object3D[] {
    return this.list.flatMap((b) => (b.mesh && !this.state.parts[b.src]?.hidden ? [b.mesh] : []));
  }

  /**
   * Where a ray first meets the creature: the part, the spot and which way the
   * surface faces there, in the scene and in the part's own frame. `local` is
   * as the part's definition sees it: on a right twin, mirrored back across Z.
   */
  surfaceAt(ray: THREE.Raycaster, only?: BoneRT): { bone: BoneRT; point: THREE.Vector3; normal: THREE.Vector3; local: THREE.Vector3; localNormal: THREE.Vector3 } | null {
    const hit = ray.intersectObjects(only ? (only.mesh ? [only.mesh] : []) : this.pickable(), false)[0];
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
   * The spot on a part that faces `eye` (a ray at its middle, through whatever's
   * in front of it), or failing that its side facing away from the creature's middle.
   */
  surfaceFacing(b: BoneRT, eye: THREE.Vector3): ReturnType<Creature['surfaceAt']> {
    b.pivot.updateMatrixWorld(true);
    const mid = b.pivot.localToWorld(new THREE.Vector3(0, b.length / 2, 0));
    const ray = new THREE.Raycaster(eye.clone(), mid.clone().sub(eye).normalize());
    const seen = this.surfaceAt(ray, b);
    if (seen) return seen;
    const middle = new THREE.Box3().setFromObject(this.group).getCenter(new THREE.Vector3());
    const out = mid.clone().sub(middle);
    if (out.lengthSq() < 1e-6) out.copy(eye).sub(mid);
    out.normalize();
    ray.set(mid.clone().addScaledVector(out, 10), out.clone().negate());
    return this.surfaceAt(ray, b);
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
    const chain = this.ikChain(id, ik);
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

  /**
   * The limbs a body stands on: each with the parts from its foot (its lowest
   * tip, as posed) up to the body, and where that foot is now. Moving the body
   * and then reaching them back (reachFeet) keeps the feet planted.
   */
  plantedFeet(body: BoneRT): Planted[] {
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const hangsFrom = (o: BoneRT, leg: BoneRT) => {
      for (let p: BoneRT | null = o; p; p = p.parent) if (p === leg) return true;
      return false;
    };
    const feet = this.list
      .filter((c) => c.parent === body && this.reachesFloor(c))
      .map((leg) => {
        const foot = this.list.filter((o) => hangsFrom(o, leg)).reduce((a, o) => (at(o.tip).y < at(a.tip).y ? o : a));
        const chain: BoneRT[] = [];
        for (let p: BoneRT | null = foot; p && p !== body; p = p.parent) chain.push(p);
        return { chain, at: at(foot.tip) };
      });
    // a leg posed up off the floor (kicking, stepping) isn't stood on: it rides along
    const low = Math.min(...feet.map((f) => f.at.y));
    const near = low + (at(body.pivot).y - low) * 0.15;
    return feet.filter((f) => f.at.y <= near);
  }

  /** The body's base grip: the creature moved by `d` (in its own space) from `from`, and the legs bent back to their feet. */
  moveBodyOver(feet: Planted[], from: THREE.Vector3, d: THREE.Vector3) {
    this.group.position.copy(from).add(d);
    this.group.updateMatrixWorld(true);
    this.reachFeet(feet);
  }

  /** Bend each limb (CCD, as dragTip) so its foot is back where it was planted. */
  reachFeet(feet: Planted[]) {
    this.mergeDirty = true;
    const tipPos = new THREE.Vector3();
    for (const { chain, at } of feet) {
      const foot = chain[0];
      for (let it = 0; it < Math.max(12, chain.length * 4); it++) {
        for (const j of chain) {
          foot.tip.getWorldPosition(tipPos);
          this.aimBone(j, tipPos, at);
        }
      }
    }
  }

  /** The parts dragging this one's tip turns (see dragTip): it, and with IK the limb above it. */
  /** The lowest point of a part's own mesh, in the scene (and the bone it's on). */
  lowestPoint(b: BoneRT): THREE.Vector3 | null {
    const m = b.mesh;
    const pos = m?.geometry.getAttribute('position');
    if (!m || !pos) return null;
    m.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let low: THREE.Vector3 | null = null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (!low || v.y < low.y) low = v.clone();
    }
    return low;
  }

  ikChain(id: string, ik: boolean): BoneRT[] {
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
    return chain;
  }

  /** These parts and every part hanging off them. */
  withBelow(bones: BoneRT[]): Set<BoneRT> {
    const set = new Set(bones);
    for (const b of this.list) {
      for (let p = b.parent; p; p = p.parent) {
        if (set.has(p)) {
          set.add(b);
          break;
        }
      }
    }
    return set;
  }

  /** Every part's base and tip, where they are now (things a dragged grip can snap to). */
  nodes(skip: Set<BoneRT> = new Set()): { bone: BoneRT; end: 'base' | 'tip'; at: THREE.Vector3 }[] {
    return this.list
      .filter((b) => !skip.has(b))
      .flatMap((b) => [
        { bone: b, end: 'base' as const, at: b.pivot.getWorldPosition(new THREE.Vector3()) },
        { bone: b, end: 'tip' as const, at: b.tip.getWorldPosition(new THREE.Vector3()) },
      ]);
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

/** One part's copies of one scatter. */
interface ScatterRec {
  key: string;
  m: Marking;
  bone: BoneRT;
  group: THREE.Group;
  /** a scattered creature's look when the copies were dressed (see sourceLook) */
  look: string;
  copies: ScatterCopy[];
  /** each mesh of the thing, as instances, and where it sits in the thing */
  parts: { mesh: THREE.InstancedMesh; rel: THREE.Matrix4 }[];
}


function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
