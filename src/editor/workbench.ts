// ---------------------------------------------------------------------------
// The stuff workbench (the Stuff tab): pieces drawn on the board make a thing
// to wear; moving, turning, mirroring and saving them, and the stuff panel.

import * as THREE from 'three';
import { type PartState } from '../creature';
import { unlock } from '../achievements';
import { bounds, getMeshDetail, pointInPolygon, type Vec2 } from '../inflate';
import {
  buildThing,
  collection,
  disposeThing,
  mirrorShape,
  newPiece,
  newThing,
  putThing,
  removeThing,
  uid,
  type BendMode,
  WRAP_SMOOTH,
  WRAP_STRENGTH,
  type Piece,
  type Thing,
  type Wearer,
} from '../stuff';
import { STYLES, glowWithFlash } from '../materials';
import { markToolsOut } from '../markingPanel';
import { copyLimb, partIds, pasteLimb, type LimbClip } from '../rigs';
import { $, fa, faClassic, iconLabel } from './dom';
import { camera, canvas, key, scene, view } from './stage';
import { composer } from './post';
import { commit, creature, creatures, idle, mode, save, selected, setIdle, state, world } from './state';
import { raycaster, setRay, updateSkeletonVisibility } from './controls';
import { flyTo } from './framing';
import { drawState, enterDraw, exitDraw, pendingPieces, symOn } from './drawing';
import { gizmo, selectedAttachment } from './attach';
import { placing } from './arrange';
import { attachThing } from './attachPanel';
import { carryFrom } from './carry';
import { saveBundle } from './files';
import { queueCreationSave } from './creations';
import { glowFollowSeg, glowSlider, sceneColorRow, scopeSeg, SWATCHES } from './widgets';
import { flashPart, renderThingMaterial } from './partPanel';
import { pieceMarks } from './markingsUi';
import { rigEdit } from './rigEdit';
import { hint, hintOnce } from './hints';
import { withCleanScene } from './snapshot';
import { invalidate } from './loop';

// The board sits at chest height; its XY plane is the drawing plane and its
// origin (the crosshair) is where the thing will attach to a body part.
export const board = new THREE.Group();
board.position.set(0, 1, 0);
board.visible = false;
const boardGrid = new THREE.Group();
export let bench: THREE.Group | null = null;
export let benchKey = '';
export function setBenchKey(v: typeof benchKey) {
  benchKey = v;
}
export let selectedPiece = '';
export function setSelectedPiece(v: typeof selectedPiece) {
  selectedPiece = v;
}

export function workbench(): Thing {
  world.workbench ??= newThing();
  return world.workbench;
}

export function piece(): Piece | undefined {
  return workbench().pieces.find((p) => p.id === selectedPiece);
}

/** Holes from `loops` that actually sit inside piece `p`. */
export function holesInside(p: Piece, loops: Vec2[][]): Vec2[][] {
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

export function syncWorkbench() {
  const thing = benchThing();
  const key = JSON.stringify([thing.pieces, thing.markings, thing.pictures, thing.ownMaterial, thing.inherit, thing.materialSettings, thing.bend, thing.bendMode, state.materialSettings, state.style, getMeshDetail()]);
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
export let pieceMode: PieceMode = 'translate';
let pieceDim: '2d' | '3d' = '2d';
export let piecePivot: THREE.Group | null = null;

export function refreshPieceGizmo() {
  const p = piece();
  const on = mode === 'stuff' && !drawState && !!p && !!bench && !markToolsOut();
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
  // Mirror: the other side follows the gizmo, mirrored, while it's dragged
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

export function setPieceMode(m: PieceMode) {
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
export function bakePiece() {
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

// ---- Mirror: a piece and its mirror image, kept in step ----

/** A piece's other side, if it has one. */
export function twinOf(p: Piece): Piece | undefined {
  return p.twin ? workbench().pieces.find((q) => q.id === p.twin) : undefined;
}

/** After `p` changed: its other side becomes its mirror image again (shape, place, color, everything). */
export function syncTwin(p: Piece | undefined) {
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

/** Mirror on: a mirror image of the picked piece on the other side. Off: the two go their own ways. */
export function setPieceMirror(on: boolean) {
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

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
/** While a piece is dragged: put its other side where the same change, mirrored, takes it. */
export function mirrorTwinLive() {
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
export function framePiece(p: Piece): THREE.Object3D {
  if (!p.place) return board;
  pieceFrame.position.set(...p.place.position);
  pieceFrame.quaternion.set(...p.place.quaternion);
  pieceFrame.updateMatrixWorld(true);
  return pieceFrame;
}

// ---- auto-save: the thing on the workbench is kept in My stuff as you go ----

export let thingSaveTimer = 0;
export function autosaveThing() {
  if (!world.workbench?.pieces.length) return;
  clearTimeout(thingSaveTimer);
  thingSaveTimer = window.setTimeout(saveWorkbenchNow, 450);
}

/** Put the workbench thing in the collection now (with a fresh picture), and update anything wearing it. */
export function saveWorkbenchNow() {
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
export function focusOnPlane(frame: THREE.Object3D) {
  const c = frame.getWorldPosition(new THREE.Vector3());
  const n = new THREE.Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  // face it from whichever side the camera is already on
  if (n.dot(camera.position.clone().sub(c)) < 0) n.negate();
  flyTo(c.clone().addScaledVector(n, 1.4), c);
}

export function focusOnBoard() {
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
export function addPieces(shapes: { outline: Vec2[]; holes: Vec2[][] }[]) {
  const wb = workbench();
  const made = shapes.map((sh) => ({ ...newPiece(sh.outline, piece()), holes: sh.holes }));
  // drawn with Mirror on, a mirrored pair stays one: Mirror
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
export function replacePiece(id: string, shapes: { outline: Vec2[]; holes: Vec2[][] }[]) {
  const wb = workbench();
  const i = wb.pieces.findIndex((p) => p.id === id);
  if (i < 0 || !shapes.length) {
    exitDraw();
    return;
  }
  const old = wb.pieces[i];
  const next: Piece[] = shapes.map((sh, k) => ({ ...structuredClone(old), outline: sh.outline, holes: sh.holes, id: k ? uid() : old.id }));
  // Mirror: the other side follows a redraw, unless it came out as several pieces
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

export function pickPiece(x: number, y: number): string | null {
  if (!bench) return null;
  setRay(x, y);
  // fuzz and ink sit inside a piece's mesh, and the selected piece sits in a pivot
  for (const hit of raycaster.intersectObjects(bench.children, true)) {
    for (let o: THREE.Object3D | null = hit.object; o && o !== bench; o = o.parent) if (o.userData.pieceId) return o.userData.pieceId as string;
  }
  return null;
}

/** Glow the selected piece (k fades 1 -> 0). */
export function flashPiece(k: number) {
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
export function snapThumb(box: THREE.Box3, size = 160): string {
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

export function stripThumb(t: Thing): Thing {
  const { thumb: _thumb, ...rest } = structuredClone(t);
  return rest;
}

export function renderStuffPanel() {
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
    if (t) pick.insertAdjacentHTML('beforeend', ` <span class="piece-twin" title="Mirror image of Piece ${wb.pieces.indexOf(t) + 1}">${fa('arrow-right-arrow-left')}</span>`);
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
      b.title = s.desc;
      b.onclick = () => updatePiece((q) => (q.style = s.id));
      st.append(b);
    }
    renderThingMaterial(wb, [p.style], $('#piece-style-params'), state.style);
  }
  pieceMarks.render();
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

export function renderCollection() {
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
/** A copy of a piece, nudged aside so it shows, right after it and picked. */
export function copyPiece(id: string) {
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

// Copy and paste (Ctrl+C, Ctrl+V): a part and everything on it, or a stuff
// piece (both sides when mirrored). Kept while the page is open, so it pastes
// into another creature or thing too; each paste lands a little further down.
type Clip = { kind: 'part'; limb: LimbClip; parts: Record<string, PartState>; pastes: number } | { kind: 'piece'; pieces: Piece[]; pastes: number };
export let clip: Clip | null = null;

/** Copy whatever's picked. False when nothing copyable is. */
export function copyPicked(): boolean {
  if (drawState || selectedAttachment) return false;
  if (mode === 'stuff') {
    const p = piece();
    if (!p) return false;
    const t = twinOf(p);
    clip = { kind: 'piece', pieces: structuredClone(t ? [p, t] : [p]), pastes: 0 };
    hint(t ? 'Copied both sides of the piece' : 'Copied the piece', 1400);
    return true;
  }
  if (idle || placing || !creature.bones.get(selected)) return false;
  const limb = copyLimb(state.rig, selected);
  if (!limb) {
    hint("The first part holds everything else, so it can't be copied", 2000, true);
    return true;
  }
  const parts: Record<string, PartState> = {};
  for (const d of limb.bones) for (const id of partIds(d)) if (state.parts[id]) parts[id] = structuredClone(state.parts[id]);
  clip = { kind: 'part', limb, parts, pastes: 0 };
  hint(limb.bones.length > 1 ? 'Copied the part and everything on it' : 'Copied the part', 1400);
  return true;
}

/** Paste what was copied, if it fits where you are (a part in Shape or Look, a piece in Stuff). */
export function pasteClip(): boolean {
  if (!clip || drawState) return false;
  if (clip.kind === 'piece') {
    if (mode !== 'stuff') return false;
    const n = ++clip.pastes;
    const ids = new Map(clip.pieces.map((p) => [p.id, uid()]));
    // a mirrored pair only moves down, so it stays a mirror image
    const dx = clip.pieces.length > 1 ? 0 : 0.08 * n;
    const nudge = ([x, y]: Vec2): Vec2 => [x + dx, y - 0.08 * n];
    const pasted = clip.pieces.map((p): Piece => {
      const c: Piece = { ...structuredClone(p), id: ids.get(p.id)! };
      if (p.twin) c.twin = ids.get(p.twin);
      c.outline = c.outline.map(nudge);
      c.holes = c.holes.map((l) => l.map(nudge));
      return c;
    });
    workbench().pieces.push(...pasted);
    selectedPiece = pasted[0].id;
    syncWorkbench();
    commit();
    renderStuffPanel();
    flashPart();
    autosaveThing();
    hint('Pasted', 1000);
    return true;
  }
  if (mode === 'stuff' || placing) return false;
  const c = clip;
  // moved down when the original is still here, so the copy shows
  const here = c.limb.bones.some((d) => state.rig.bones.some((b) => b.id === d.id));
  const n = here ? ++c.pastes : 0;
  rigEdit((rig) => {
    const copies = pasteLimb(rig, c.limb, selected, [0, -0.18 * n, 0]);
    for (const p of copies) if (c.parts[p.from]) state.parts[p.to] = structuredClone(c.parts[p.from]);
    return copies;
  }, true);
  setIdle(false);
  updateSkeletonVisibility();
  flashPart();
  hint('Pasted', 1000);
  return true;
}

export function deletePiece(id: string) {
  if (drawState) exitDraw();
  const wb = workbench();
  // a mirrored pair goes together
  const other = wb.pieces.find((p) => p.id === id)?.twin;
  wb.pieces = wb.pieces.filter((p) => p.id !== id && p.id !== other);
  if (selectedPiece === id || selectedPiece === other) selectedPiece = '';
  if (other) hint('Deleted both sides (turn off Mirror to delete just one)', 2400);
  syncWorkbench();
  commit();
  renderStuffPanel();
  autosaveThing();
}
/** Piece colors go on the picked piece, or (All) on every piece of the thing */
export let pieceColorAll = false;
export function setPieceColorAll(v: typeof pieceColorAll) {
  pieceColorAll = v;
}
/** `updatePiece` for colors and glow: on every piece with All picked */
function updatePieceColor(fn: (p: Piece) => void, doCommit = true) {
  updatePiece((p) => {
    for (const q of pieceColorAll ? workbench().pieces : [p]) fn(q);
  }, doCommit);
}
export let pieceColorScope: () => void;
let pieceGlowFollow: () => void;
let pieceSceneColors: () => void;
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

export function initWorkbench() {
  scene.add(board);
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
  $<HTMLInputElement>('#piece-mirror').onchange = (e) => setPieceMirror((e.target as HTMLInputElement).checked);
  document.querySelectorAll<HTMLButtonElement>('#piece-bar [data-piece]').forEach((b) => {
    b.onclick = () => setPieceMode(b.dataset.piece as PieceMode);
  });
  document.querySelectorAll<HTMLButtonElement>('#piece-bar [data-dim]').forEach((b) => {
    b.onclick = () => setPieceDim(b.dataset.dim as '2d' | '3d');
  });
  $('#piece-flat').onclick = () => layPieceFlat();
  $('#piece-draw').onclick = () => enterDraw({ kind: 'piece' });
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
  pieceColorScope = scopeSeg('#piece-color-scope', () => pieceColorAll, (all) => (pieceColorAll = all));
  pieceGlowFollow = glowFollowSeg(
    '#piece-glow-follow',
    () => piece(),
    (f) =>
      updatePieceColor((q) => {
        if (f) q.glowFollow = f;
        else delete q.glowFollow;
      }),
  );
  pieceSceneColors = sceneColorRow($('#piece-scene-colors'), () => piece()?.color, (c) => updatePieceColor((q) => (q.color = c)));
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
}
