import * as THREE from 'three';
import { partShapes, setPartShapes, type BoneRT, type PartShape } from '../creature';
import { unlock } from '../achievements';
import { bounds, combineLoops, signedArea, smoothLoop, symmetrize, type Vec2 } from '../inflate';
import { type Piece } from '../stuff';
import { keyLabel } from '../shortcuts';
import { $ } from './dom';
import { canvas, octx, overlay, view, viewport } from './stage';
import { commit, creature, creatures, mode, selected, state } from './state';
import { controls, raycaster, setRay, touchScreen, updateSkeletonVisibility } from './controls';
import { focusOnBone } from './framing';
import { addPieces, board, focusOnBoard, focusOnPlane, framePiece, holesInside, piece, refreshPieceGizmo, replacePiece, syncWorkbench } from './workbench';
import { deselectAttachment, gizmo } from './attach';
import { renderCreatureBar } from './creatureBar';
import { flashPart, partLabel } from './partPanel';
import { hint, hintOnce } from './hints';

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
export let drawState: DrawState | null = null;

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
export function symOn(): boolean {
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

export function drawHint() {
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

export function enterDraw(target: DrawTarget = { kind: 'bone', boneId: selected }) {
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
export function setDrawSide(side: boolean) {
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
export function exitDraw(keep = false) {
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

export function syncDrawBar() {
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

export function toggleSymmetry() {
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

export function partPlane(frame: THREE.Object3D): THREE.Plane {
  frame.updateMatrixWorld(true);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, frame.getWorldPosition(new THREE.Vector3()));
}

export function screenToLocal(frame: THREE.Object3D, plane: THREE.Plane, x: number, y: number): Vec2 | null {
  setRay(x, y);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  const l = frame.worldToLocal(hit);
  return [Math.round(l.x * 1e4) / 1e4, Math.round(l.y * 1e4) / 1e4];
}

/** Drawing-plane point -> overlay pixel coordinates. */
export function localToOverlay(frame: THREE.Object3D, [x, y]: Vec2): Vec2 {
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
export function pendingPieces(ds: DrawState): { outline: Vec2[]; holes: Vec2[][] }[] {
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
export function finishDraw() {
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
  renderCreatureBar();
  flashPart();
  hintOnce('Inflated! Drag to look around, or pick another part', 2200);
}

function addStrokePoint(p: Vec2) {
  if (!drawState) return;
  drawState.pts.push(p);
  const l = screenToLocal(drawState.frame, partPlane(drawState.frame), p[0], p[1]);
  if (l) drawState.local.push(l);
}

// On a touch screen a second finger means "move the view": whatever the first
// finger had started is dropped and both touches go to the camera controls,
// which follow them (on the document) until they're lifted.
const drawTouches = new Map<number, PointerEvent>();
let touchView = false;

// Hold Space to pan with the left button (while drawing, the drawing layer steps aside meanwhile).
// Outside drawing, Shift+drag pans as well: OrbitControls does that itself.
export let spacePan = false;
export function setSpacePan(on: boolean) {
  if (spacePan === on) return;
  spacePan = on;
  overlay.style.pointerEvents = on ? 'none' : '';
  controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  gizmo.enabled = !on;
  viewport.classList.toggle('space-pan', on);
}

export function renderOverlay() {
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
export function setDrawTool(tool: DrawTool) {
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

export function initDrawing() {
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
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') setSpacePan(false);
  });
  window.addEventListener('blur', () => setSpacePan(false));
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
  document.querySelectorAll<HTMLButtonElement>('#draw-tools [data-tool]').forEach((b) => {
    b.onclick = () => setDrawTool(b.dataset.tool as DrawTool);
  });
  $('#done-draw').onclick = () => finishDraw();
}
