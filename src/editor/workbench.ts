// ---------------------------------------------------------------------------
// The stuff workbench: a thing is drawn and changed right where it is on the
// creature, worn or scattered (see editStuff), on a board that sits where it
// does; moving, turning, mirroring and saving its pieces, the stuff panel and
// My stuff.

import * as THREE from 'three';
import { type Attachment, type BoneRT, type CreatureState, type PartState } from '../creature';
import { type Marking } from '../markings';
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
import { copyLimb, flipLimbClip, partIds, pasteLimb, type LimbClip, type V3 } from '../rigs';
import { $, fa, faClassic, iconLabel, pickHow, type PickHow } from './dom';
import { camera, canvas, key, scene, view } from './stage';
import { composer } from './post';
import { commit, creature, creatures, idle, type Mode, mode, save, selected, setIdle, state, world } from './state';
import { controls, hover, raycaster, setRay, updateSkeletonVisibility } from './controls';
import { setMode } from './panels';
import { flyTo } from './framing';
import { drawState, enterDraw, exitDraw, pendingPieces, symOn } from './drawing';
import { gizmo, selectedAttachment } from './attach';
import { placing } from './arrange';
import { attachThing } from './attachPanel';
import { carryFrom, pickStuff, sitOnSurface } from './carry';
import { saveBundle } from './files';
import { queueCreationSave } from './creations';
import { glowFollowSeg, glowSlider, sceneColorRow, SWATCHES } from './widgets';
import { flashPart, partLabel, renderThingMaterial } from './partPanel';
import { creatureId, editCreature, setOffstage, wearCreature } from './riders';
import { creatureLabel } from './controls';
import { pieceMarks } from './markingsUi';
import { rigEdit } from './rigEdit';
import { hint, hintOnce } from './hints';
import { withCleanScene } from './snapshot';
import { invalidate } from './loop';
import { oddKinds, renderScopeToggle, scopeChip, scopeOf, type ScopeKind } from './scope';

// The board sits where the thing being edited is on the creature (see
// followBoard); its XY plane is the drawing plane and its origin (the
// crosshair, while drawing) is where the thing attaches.
export const board = new THREE.Group();
board.matrixAutoUpdate = false;
board.visible = false;
const boardGrid = new THREE.Group();
boardGrid.visible = false;

/** What the workbench is editing, where it is: a worn thing (attachment id), or what a scatter scatters (marking id; shown on its first copy). */
export type StuffTarget = { kind: 'worn'; id: string } | { kind: 'scatter'; id: string };
export let stuffTarget: StuffTarget | null = null;
/** the tab editing stuff goes back to, and the view it was seen from there */
let stuffReturn: Mode = 'look';
let viewBefore: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

/** The active creature's scatter with this id, on the whole creature or one part. */
function scatterMarking(id: string): Marking | undefined {
  return [...(state.markings ?? []), ...Object.values(state.parts).flatMap((p) => p.markings ?? [])].find((m) => m.type === 'scatter' && m.id === id);
}

/** Where the edited thing sits: the part it's on and its place in that part's frame (null: it's gone). */
function targetFrame(t: StuffTarget): { bone: BoneRT; place: THREE.Matrix4 } | null {
  if (t.kind === 'worn') {
    const a = state.attachments?.find((x) => x.id === t.id);
    const bone = a && creature.bones.get(a.bone);
    if (!a || !bone) return null;
    return { bone, place: new THREE.Matrix4().compose(new THREE.Vector3(...a.position), new THREE.Quaternion(...a.quaternion), new THREE.Vector3(...a.scale)) };
  }
  const f = creature.scatterCopyFrame(t.id);
  const bone = f && creature.bones.get(f.pivot.userData.boneId as string);
  return f && bone ? { bone, place: f.matrix } : null;
}

/** Keep the board on the thing being edited, as the creature is posed now. */
export function followBoard() {
  const t = stuffTarget;
  if (!t || mode !== 'stuff') return;
  const f = targetFrame(t);
  // undone out of existence (or its scatter turned off): nothing left to edit
  if (!f) {
    queueMicrotask(finishStuff);
    return;
  }
  creature.root.updateMatrixWorld(true);
  board.matrix.multiplyMatrices(f.bone.pivot.matrixWorld, f.place);
  board.updateMatrixWorld(true);
}

/**
 * Edit a worn thing, or what a scatter scatters, right where it is on the
 * creature: everything wearing it (every copy) changes with it, and it's kept
 * in My stuff as you go.
 */
export function editStuff(target: StuffTarget) {
  const thing = target.kind === 'worn' ? state.attachments?.find((a) => a.id === target.id)?.thing : scatterMarking(target.id)?.thing;
  if (!thing) return;
  if (mode === 'stuff') leaveStuff();
  else {
    stuffReturn = mode;
    viewBefore = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  stuffTarget = target;
  unlock('stuff');
  world.workbench = stripThumb(thing);
  setSelectedPiece('');
  $('#thing-saved').textContent = '';
  creature.setEditingStuff(target.id);
  setMode('stuff');
}

/** Done editing: back to the tab it was opened from, with a worn thing picked. */
export function finishStuff() {
  if (mode !== 'stuff') return;
  const t = stuffTarget;
  setMode(stuffReturn === 'stuff' ? 'look' : stuffReturn);
  if (t?.kind === 'worn' && state.attachments?.some((a) => a.id === t.id)) pickStuff(t.id);
  // back to how the creature was seen before
  if (viewBefore) flyTo(viewBefore.pos, viewBefore.target);
  viewBefore = null;
}

/** Leaving the workbench (whichever way): keep what's on it, and put away a thing nothing was drawn for. */
export function leaveStuff() {
  const t = stuffTarget;
  saveWorkbenchNow();
  stuffTarget = null;
  creature.setEditingStuff(null);
  if (!t || world.workbench?.pieces.length) return;
  if (t.kind === 'worn') state.attachments = (state.attachments ?? []).filter((a) => a.id !== t.id);
  else delete scatterMarking(t.id)?.thing;
  creature.sync();
  commit();
}

/**
 * Something new, drawn on the creature: at the spot under `at` on the screen
 * (or the front of the picked part), worn there, and drawn straight away.
 */
export function newStuffHere(at?: { x: number; y: number }) {
  if (!creature.bones.has(selected)) return;
  let hit = null;
  if (at) {
    setRay(at.x, at.y);
    hit = creature.surfaceAt(raycaster);
  }
  if (!hit) {
    // where the camera looks at the picked part
    const b = creature.bones.get(selected)!;
    b.pivot.updateMatrixWorld(true);
    const mid = b.pivot.localToWorld(new THREE.Vector3(0, b.length / 2, 0));
    raycaster.set(camera.position.clone(), mid.sub(camera.position).normalize());
    const h = creature.surfaceAt(raycaster);
    if (h?.bone === b) hit = h;
  }
  // (sat on the surface as a small thing would, so what's drawn isn't half buried)
  const spot = hit ? sitOnSurface(hit, new THREE.Box3(new THREE.Vector3(-0.05, -0.05, -0.03), new THREE.Vector3(0.05, 0.05, 0.03))) : null;
  const thing = { ...newThing(), name: 'Thing' };
  const a: Attachment = {
    id: uid(),
    bone: hit?.bone.def.id ?? selected,
    thing,
    position: spot?.position ?? creature.attachPoint(selected),
    quaternion: spot?.quaternion ?? [0, 0, 0, 1],
    scale: [1, 1, 1],
    mirror: false,
  };
  state.attachments = [...(state.attachments ?? []), a];
  creature.sync();
  commit();
  editStuff({ kind: 'worn', id: a.id });
  enterDraw({ kind: 'piece' });
}

/** A scatter's thing, drawn new where its first copy goes. */
function newScatterThing(m: Marking, set: (patch: Partial<Marking>) => void) {
  set({ thing: { ...newThing(), name: 'Thing' } });
  if (!creature.scatterCopyFrame(m.id!)) {
    hint('Nowhere to put them yet: try another Where, or more of them', 2600, true);
    return;
  }
  editStuff({ kind: 'scatter', id: m.id! });
  enterDraw({ kind: 'piece' });
}

/** What a scatter scatters, in its settings: one of My stuff, something new, or the one it has, to edit where it is. */
export function renderScatterThing(el: HTMLElement, m: Marking, set: (patch: Partial<Marking>) => void) {
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'sub-title';
  head.textContent = 'What';
  const list = document.createElement('div');
  list.className = 'thing-list scatter-things';
  const card = (name: string, inner: string, title: string, on: boolean, onclick: () => void) => {
    const c = document.createElement('button');
    c.className = 'thing-card pick' + (on ? ' current' : '');
    c.title = title;
    c.innerHTML = `<span class="thumb">${inner}</span><span class="thing-name"></span>`;
    c.querySelector('.thing-name')!.textContent = name;
    c.onclick = onclick;
    list.append(c);
    return c;
  };
  card('Draw new', faClassic('pencil'), 'Draw something new, right where the first one goes; every copy follows as you draw', false, () => newScatterThing(m, set)).classList.add('new-card');
  const things = collection();
  for (const t of things) {
    card(t.name, t.thumb ? `<img src="${t.thumb}" alt="" />` : fa('box'), `Scatter ${t.name}`, !m.source && m.thing?.id === t.id, () => {
      set({ thing: stripThumb(t), source: undefined });
      unlock('scatter');
    });
  }
  // one it has that's not in My stuff (from a file, say)
  if (!m.source && m.thing?.pieces.length && !things.some((t) => t.id === m.thing!.id)) card(m.thing.name, fa('box'), m.thing.name, true, () => {});
  // or another creature in the scene: little critters all over this one (off stage, it's only seen here)
  world.creatures.forEach((s, i) => {
    if (i === world.active) return;
    const id = creatureId(s);
    const c = card(creatureLabel(i), '', `Scatter copies of ${creatureLabel(i)}: change it, and they change too`, m.source === id, () => {
      set({ source: id, thing: undefined });
      unlock('scatter');
    });
    creatureSwatch(c.querySelector('.thumb')!, s);
  });
  el.append(head, list);
  const source = m.source ? world.creatures.findIndex((s) => s.id === m.source) : -1;
  if (source >= 0) {
    const edit = document.createElement('button');
    edit.className = 'ghost scatter-edit';
    edit.innerHTML = `${fa('pencil')} Change ${creatureLabel(source)}`;
    edit.title = 'Edit that creature: every copy follows (click this one to come back)';
    edit.onclick = () => editCreature(m.source!);
    el.append(edit);
    if (!world.creatures[source].offstage) {
      const off = document.createElement('button');
      off.className = 'link';
      off.textContent = 'Keep it off stage';
      off.title = 'Only seen scattered here (and while you edit it)';
      off.onclick = () => setOffstage(creatures[source], true);
      el.append(off);
    }
  } else if (m.thing?.pieces.length) {
    const edit = document.createElement('button');
    edit.className = 'ghost scatter-edit';
    edit.innerHTML = `${fa('pencil')} Change it here`;
    edit.title = 'Change it where the first one is: every copy (and anything wearing it) follows';
    edit.onclick = () => editStuff({ kind: 'scatter', id: m.id! });
    el.append(edit);
  } else if (!things.length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Draw something to scatter: spikes, scales, a flower…';
    el.append(p);
  }
}
export let bench: THREE.Group | null = null;
export let benchKey = '';
export function setBenchKey(v: typeof benchKey) {
  benchKey = v;
}
export let selectedPiece = '';
/** Picks one piece (and only it). */
export function setSelectedPiece(v: typeof selectedPiece) {
  selectedPiece = v;
  alsoPickedPieces.clear();
}
/** More pieces picked along with `selectedPiece` (Shift- or Ctrl-click, or Ctrl+A): colors, glow, materials and markings go on them all. */
const alsoPickedPieces = new Set<string>();
/** The picked pieces that are still on the thing, the main one first. */
export function pickedPieces(): Piece[] {
  const pieces = workbench().pieces;
  const main = pieces.find((p) => p.id === selectedPiece);
  return main ? [main, ...pieces.filter((p) => p !== main && alsoPickedPieces.has(p.id))] : [];
}
/** Every piece of the thing is picked: new markings go over the whole thing. */
export function allPiecesPicked(): boolean {
  return pickedPieces().length >= workbench().pieces.length;
}
/** A section's changes go on every piece: it's set to Everything, or every piece is picked. */
function wholeThingFor(k: ScopeKind): boolean {
  return scopeOf(k, 'piece') === 'all' || allPiecesPicked();
}
/** Picks a piece: just it; or (`toggle`) one more, as the main one, or one less; or (`range`) every piece from the main one to it in the list, the main one staying main. */
export function choosePiece(id: string, how: PickHow = 'one') {
  if (how === 'one' || !selectedPiece) return setSelectedPiece(id);
  const picked = pickedPieces().map((p) => p.id);
  if (how === 'range') {
    const ids = workbench().pieces.map((p) => p.id);
    const a = ids.indexOf(selectedPiece);
    const z = ids.indexOf(id);
    alsoPickedPieces.clear();
    if (a >= 0 && z >= 0) for (const o of ids.slice(Math.min(a, z), Math.max(a, z) + 1)) if (o !== selectedPiece) alsoPickedPieces.add(o);
  } else if (!picked.includes(id)) {
    alsoPickedPieces.add(selectedPiece);
    selectedPiece = id;
  } else if (picked.length > 1) {
    alsoPickedPieces.delete(id);
    if (id === selectedPiece) {
      selectedPiece = picked.find((o) => o !== id)!;
      alsoPickedPieces.delete(selectedPiece);
    }
  }
}
/** Picks every piece of the thing. */
export function selectAllPieces() {
  const pieces = workbench().pieces;
  if (!pieces.length) return;
  if (!pieces.some((p) => p.id === selectedPiece)) selectedPiece = pieces[0].id;
  for (const p of pieces) if (p.id !== selectedPiece) alsoPickedPieces.add(p.id);
  flashPart();
  renderStuffPanel();
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

/** On the workbench, a thing that inherits its material shows the part it's on's (as it does worn or scattered). */
function benchWearer(): Wearer {
  const f = stuffTarget && targetFrame(stuffTarget);
  const style = (f && state.parts[f.bone.src]?.style) || state.style;
  return { style, settingsFor: (s) => creature.settingsFor(s) };
}

export function syncWorkbench() {
  followBoard();
  // the grid (and the crosshair where it attaches) only while drawing
  boardGrid.visible = drawState?.target.kind === 'piece';
  const thing = benchThing();
  const wearer = benchWearer();
  const key = JSON.stringify([thing.pieces, thing.markings, thing.pictures, thing.ownMaterial, thing.inherit, thing.materialSettings, thing.bend, thing.bendMode, state.materialSettings, wearer.style, getMeshDetail()]);
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
  bench = buildThing(thing, wearer);
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
  spreadThing(saved);
  save();
  // My stuff is saved with the creation
  queueCreationSave();
  renderCollection();
}

/** Every creature wearing (or scattered with) this thing gets it as it is now: a thing is the same thing everywhere (copy it in My stuff for one of its own). */
function spreadThing(t: Thing) {
  world.creatures.forEach((s, i) => {
    let changed = false;
    for (const a of s.attachments ?? []) {
      if (a.thing.id !== t.id || a.thing === t) continue;
      a.thing = stripThumb(t);
      changed = true;
    }
    for (const m of [...(s.markings ?? []), ...Object.values(s.parts).flatMap((p) => p.markings ?? [])]) {
      if (m.type !== 'scatter' || m.thing?.id !== t.id || m.thing === t) continue;
      m.thing = stripThumb(t);
      changed = true;
    }
    if (changed) creatures[i]?.sync();
  });
  if (world.workbench?.id === t.id && world.workbench !== t) world.workbench = stripThumb(t);
}

/** A worn (or scattered) thing changed where it is (its colors, materials, markings): the same change in My stuff and on everything else with it. */
export function shareThing(t: Thing) {
  if (!t.pieces.length) return;
  const kept = collection().find((x) => x.id === t.id);
  putThing({ ...stripThumb(t), thumb: kept?.thumb });
  spreadThing(t);
  queueCreationSave();
  renderCollection();
}

/** Look straight at a drawing plane (a tilted piece's), from the side it faces. */
export function focusOnPlane(frame: THREE.Object3D) {
  const c = frame.getWorldPosition(new THREE.Vector3());
  const n = new THREE.Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  // face it from whichever side the camera is already on
  if (n.dot(camera.position.clone().sub(c)) < 0) n.negate();
  flyTo(c.clone().addScaledVector(n, 1.4 * boardScale()), c);
}

/** How big the board is in the scene (a scatter's copies are small). */
function boardScale(): number {
  return Math.abs(new THREE.Vector3().setFromMatrixScale(board.matrixWorld).x) || 1;
}

/** Look at the thing being edited from in front of it (the way the board faces, out of the creature). */
export function focusOnBoard() {
  followBoard();
  const c = board.getWorldPosition(new THREE.Vector3());
  const k = boardScale();
  // what's drawn so far, with room round it (nothing yet: a board's worth)
  let r = 0.5 * k;
  if (bench) {
    const box = new THREE.Box3().setFromObject(bench);
    if (!box.isEmpty()) r = Math.max(0.25 * k, box.getSize(new THREE.Vector3()).length() * 0.7);
  }
  const n = new THREE.Vector3(0, 0, 1).transformDirection(board.matrixWorld);
  let dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  if (stuffTarget?.kind === 'scatter') {
    // one of many small copies: from further off, and a little from above it, so the ones round it and the surface they're on show too
    n.addScaledVector(new THREE.Vector3(0, 1, 0).transformDirection(board.matrixWorld), 0.6).normalize();
    dist = Math.max(0.9, dist * 2.5);
  }
  flyTo(c.clone().addScaledVector(n, Math.max(0.5, dist)), c);
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
  setSelectedPiece(made[0].id);
  unlock('piece');
  if (stuffTarget?.kind === 'scatter') unlock('scatter');
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
  setSelectedPiece(old.id);
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

/** Glow the picked pieces (k fades 1 -> 0). */
export function flashPiece(k: number) {
  const picked = new Set(k > 0 ? pickedPieces().map((p) => p.id) : []);
  bench?.traverse((m) => {
    if (!m.userData.pieceId || !(m as THREE.Mesh).isMesh) return;
    const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (!mat || !('emissive' in mat)) return;
    glowWithFlash(mat, picked.has(m.userData.pieceId) && k > 0 ? new THREE.Color(1, 0.42, 0.29).multiplyScalar(0.45 * k) : undefined);
  });
}

/** Render just the thing, framed, into a small square image for the collection (the creature it's on stepping out of the picture). */
function captureThumb(): string {
  if (!bench) return '';
  const shown = creatures.map((c) => c.root.visible);
  for (const c of creatures) c.root.visible = false;
  try {
    return snapThumb(new THREE.Box3().setFromObject(bench));
  } finally {
    creatures.forEach((c, i) => (c.root.visible = shown[i]));
  }
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
  const grid = boardGrid.visible;
  boardGrid.visible = false;
  const url = withCleanScene(() => {
    composer.render();
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')!.drawImage(canvas, sx, sy, side, side, 0, 0, size, size);
    return out.toDataURL('image/jpeg', 0.82);
  });
  boardGrid.visible = grid;
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
  // what it is and where: worn on a part, or scattered
  const t = stuffTarget;
  const f = t && targetFrame(t);
  const on = f ? partLabel(f.bone.src).toLowerCase() : 'creature';
  $('#stuff-where').textContent = t?.kind === 'scatter' ? 'Scattered' : `On the ${on}`;
  $('#stuff-note').textContent =
    t?.kind === 'scatter'
      ? 'Draw it where the first one is: every copy follows. It’s kept in My stuff as you go.'
      : 'Draw it right where it sits. It’s kept in My stuff as you go, and anything else wearing it changes too.';
  if (!wb.pieces.some((p) => p.id === selectedPiece)) setSelectedPiece(wb.pieces[wb.pieces.length - 1]?.id ?? '');
  const picked = new Set(pickedPieces().map((p) => p.id));

  const list = $('#pieces');
  list.innerHTML = '';
  // one row per piece: pick it, redraw it, or throw it away
  wb.pieces.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'piece-row';
    row.classList.toggle('active', picked.has(p.id));
    const pick = document.createElement('button');
    pick.className = 'piece-pick';
    pick.innerHTML = `<i style="background:${p.color}"></i>`;
    pick.insertAdjacentHTML('beforeend', p.kind === 'flat' ? fa('rectangle-wide') : p.kind === 'turned' ? faClassic('jar') : fa('cloud'));
    pick.append(` Piece ${i + 1}${p.holes.length ? ` (${p.holes.length} hole${p.holes.length > 1 ? 's' : ''})` : ''}`);
    const t = twinOf(p);
    if (t) pick.insertAdjacentHTML('beforeend', ` <span class="piece-twin" title="Mirror image of Piece ${wb.pieces.indexOf(t) + 1}">${fa('arrow-right-arrow-left')}</span>`);
    pick.title = 'Ctrl-click to pick one more · Shift-click to pick everything between';
    pick.onclick = (e) => {
      choosePiece(p.id, pickHow(e));
      flashPart();
      renderStuffPanel();
    };
    const edit = document.createElement('button');
    edit.className = 'piece-icon';
    edit.innerHTML = fa('pencil');
    edit.title = 'Redraw this piece: add to it, erase bits (erase inside it for a hole), or move, size and turn it. Or double-click it';
    edit.onclick = () => {
      setSelectedPiece(p.id);
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
  // (only worn things wrap onto the body)
  $('#thing-wrap-card').hidden = !wb.pieces.length || stuffTarget?.kind === 'scatter';
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
      b.onclick = () => updatePicked((q) => (q.color = c));
      sw.append(b);
    }
    $<HTMLInputElement>('#piece-color').value = p.color;
    $<HTMLInputElement>('#piece-glow').value = String(p.glow ?? 0);
    pieceGlowFollow();
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
      b.onclick = () => updatePicked((q) => (q.style = s.id), true, 'material');
      st.append(b);
    }
    renderThingMaterial(wb, [p.style], $('#piece-style-params'), state.style);
  }
  // on Everything (or with every piece picked), new markings go over the whole thing
  pieceMarks.all = wholeThingFor('markings');
  renderPieceScope(!!p && !wb.inherit);
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

/** My stuff, to put on the picked part (click, or drag it onto the creature), or draw something new there. */
export function renderCollection() {
  const el = $('#attach-options');
  el.innerHTML = '';
  const things = collection();
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
  const fresh = card('Draw new', undefined, () => {
    $('#attach-pop').hidden = true;
    newStuffHere();
  });
  fresh.title = 'Draw something new, right on this part';
  fresh.classList.add('new-card');
  fresh.querySelector('.thumb')!.innerHTML = faClassic('pencil');
  for (const t of things) {
    const c = card(t.name, t.thumb, () => attachThing(t));
    c.classList.add('carry');
    carryFrom(c, () => t, () => (t.thumb ? `<img src="${t.thumb}" alt="" />` : fa('box')));
    c.append(thingActions(t));
  }
  if (!things.length) el.insertAdjacentHTML('beforeend', '<p class="muted small">Nothing in My stuff yet: draw something, right on your critter.</p>');
  // the scene's other creatures can be worn too (they stay creatures: click one to change it)
  const others = world.creatures.map((s, i) => ({ s, i })).filter(({ i }) => i !== world.active);
  if (!others.length) return;
  const head = document.createElement('div');
  head.className = 'sub-title attach-creatures-head';
  head.textContent = 'Creatures in the scene';
  head.title = 'Put one on this part: it rides there, wherever the part goes, and stays a creature you can click and change';
  el.append(head);
  for (const { s, i } of others) {
    const c = card(creatureLabel(i), undefined, () => {
      $('#attach-pop').hidden = true;
      wearCreature(i, selected);
    });
    creatureSwatch(c.querySelector('.thumb')!, s);
    c.title = `Put ${creatureLabel(i)} on this part`;
  }
}

/** A creature's card picture: its color, with a paw. */
function creatureSwatch(el: Element, s: CreatureState) {
  el.classList.add('creature-swatch');
  (el as HTMLElement).style.background = Object.values(s.parts)[0]?.color ?? '#ccc';
  el.innerHTML = fa('paw');
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
  setSelectedPiece(twin.id);
  syncWorkbench();
  commit();
  renderStuffPanel();
  flashPart();
  autosaveThing();
}

// Copy and paste (Ctrl+C, Ctrl+V): a part and everything on it, or a stuff
// piece (both sides when mirrored). Kept while the page is open, so it pastes
// into another creature or thing too. A part lands on the surface under the
// pointer, or else on the part it came off (or the picked one); a piece lands a
// little further down each time.
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

/**
 * Paste what was copied, if it fits where you are (a part in Shape or Look, a
 * piece in Stuff). A part goes where `at` (the pointer, by default) is on the creature.
 */
export function pasteClip(at: { x: number; y: number } | null = hover.over ? hover : null): boolean {
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
    setSelectedPiece(pasted[0].id);
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
  const n = ++c.pastes;
  const spot = (at && surfaceUnderPointer(at.x, at.y)) || fallbackSpot(c.limb, n);
  if (!spot) return false;
  const top = c.limb.bones[0];
  const { on } = spot;
  let point = spot.point;
  let limb = c.limb;
  const side = (v: number) => (Math.abs(v) > 0.02 ? Math.sign(v) : 0);
  if (top.mirror) {
    // a pair is defined by its left twin (on +X): the right one lands on the spot then
    if (point[0] < 0) point = [-point[0], point[1], point[2]];
  } else if (side(point[0]) * side(top.start[0]) < 0) {
    // a single part pasted on the creature's other side comes as its mirror image (pointing out, not in)
    limb = flipLimbClip(limb);
  }
  const from = limb.bones[0].start;
  const offset: V3 = [point[0] - from[0], point[1] - from[1], point[2] - from[2]];
  // a pair hangs off a pair as a whole; anything else off the part it's on
  const parent = top.mirror && on.def.sideSign !== 0 ? on.def.baseId : on.def.id;
  rigEdit((rig) => {
    const copies = pasteLimb(rig, limb, selected, offset, parent);
    for (const p of copies) if (c.parts[p.from]) state.parts[p.to] = structuredClone(c.parts[p.from]);
    return copies;
  }, true);
  setIdle(false);
  updateSkeletonVisibility();
  flashPart();
  hint('Pasted', 1000);
  return true;
}

/** A part's own frame (Z mirrored on a right twin, as surfaceAt gives it) to skeleton coordinates, and back. */
function frameToSkeleton(b: BoneRT, v: THREE.Vector3): THREE.Vector3 {
  return v.applyMatrix4(b.restWorld);
}
function skeletonToFrame(b: BoneRT, v: THREE.Vector3): THREE.Vector3 {
  return v.applyMatrix4(b.restWorld.clone().invert());
}

const round3 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1000) / 1000) as V3;

/**
 * The spot on the creature under the pointer (a little inside the surface), in
 * skeleton coordinates (where it is on the unposed creature), and the part it's on.
 */
function surfaceUnderPointer(x: number, y: number): { on: BoneRT; point: V3 } | null {
  setRay(x, y);
  const hit = creature.surfaceAt(raycaster);
  if (!hit) return null;
  return { on: hit.bone, point: round3(frameToSkeleton(hit.bone, hit.local.clone().addScaledVector(hit.localNormal, -0.03))) };
}

/**
 * Where a copied limb goes with nothing under the pointer: on the surface of
 * the part it came off (if it's here), otherwise the picked part, at its
 * middle, on the side the limb was on; each paste after slides along the part
 * so they don't stack (and keeps clear of the original).
 */
function fallbackSpot(limb: LimbClip, n: number): { on: BoneRT; point: V3 } | null {
  const top = limb.bones[0];
  const twin = (id: string | undefined) => (id ? (creature.bones.get(id) ?? creature.bones.get(id + 'L')) : undefined);
  const orig = twin(top.parent);
  const on = orig ?? creature.bones.get(selected) ?? creature.list[0];
  if (!on) return null;
  const start = new THREE.Vector3(...on.def.start);
  const axis = new THREE.Vector3(...on.def.end).sub(start);
  const len = axis.length() || 1;
  axis.divideScalar(len);
  const was = new THREE.Vector3(...top.start);
  const wasAlong = was.clone().sub(start).dot(axis) / len;
  // the original's still here: keep clear of where it sits
  const here = !!orig && limb.bones.some((d) => state.rig.bones.some((b) => b.id === d.id));
  const spots = [0.5, 0.3, 0.7, 0.15, 0.85].filter((f) => !here || Math.abs(f - wasAlong) > 0.12);
  const along = spots[(n - 1) % spots.length];
  const mid = start.clone().addScaledVector(axis, along * len);
  // which way out of the part: toward where the limb was, on the part it came off; otherwise the
  // part's own side of the creature (a part down the middle: the limb's side, or the front)
  const sideOf = (v: number) => (Math.abs(v) > 0.02 ? Math.sign(v) : 0);
  const out = orig
    ? was.clone().sub(mid)
    : new THREE.Vector3(sideOf(mid.x) || (top.mirror ? 1 : sideOf(top.start[0])), 0, 0);
  if (out.lengthSq() < 1e-8) out.set(...(state.rig.eyeDir ?? [0, 0, 1]));
  // square to the part (a part lying along that way: its front, or up)
  for (const v of [out.clone(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]) {
    out.copy(v).addScaledVector(axis, -v.dot(axis));
    if (out.lengthSq() > 1e-6) break;
  }
  out.normalize();
  // aim at the part from outside, on that side, to find its surface
  on.pivot.updateMatrixWorld(true);
  const flip = (v: THREE.Vector3) => (on.def.sideSign === -1 ? v.setZ(-v.z) : v);
  const far = on.pivot.localToWorld(flip(skeletonToFrame(on, mid.clone().addScaledVector(out, 10))));
  const near = on.pivot.localToWorld(flip(skeletonToFrame(on, mid.clone())));
  raycaster.set(far, near.clone().sub(far).normalize());
  const hit = on.mesh ? raycaster.intersectObject(on.mesh, false)[0] : undefined;
  if (!hit?.face) return { on, point: round3(mid.addScaledVector(out, on.def.width * 0.42)) };
  const inward = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).negate();
  const local = flip(on.pivot.worldToLocal(hit.point.clone().addScaledVector(inward, 0.03)));
  return { on, point: round3(frameToSkeleton(on, local)) };
}

export function deletePiece(id: string) {
  if (drawState) exitDraw();
  const wb = workbench();
  // a mirrored pair goes together
  const other = wb.pieces.find((p) => p.id === id)?.twin;
  wb.pieces = wb.pieces.filter((p) => p.id !== id && p.id !== other);
  if (selectedPiece === id || selectedPiece === other) setSelectedPiece('');
  if (other) hint('Deleted both sides (turn off Mirror to delete just one)', 2400);
  syncWorkbench();
  commit();
  renderStuffPanel();
  autosaveThing();
}
/** The piece card's Piece|Everything toggle, and chips on its Color, Material and Markings titles where they differ. */
function renderPieceScope(material: boolean) {
  const kinds: ScopeKind[] = material ? ['color', 'material', 'markings'] : ['color', 'markings'];
  renderScopeToggle($('#piece-scope'), kinds, 'piece');
  $('#piece-material-title').hidden = !material;
  // a chip only on a group that differs from the rest (right-click a group to set just it)
  const odd = oddKinds(kinds, 'piece');
  for (const t of document.querySelectorAll<HTMLElement>('#piece-card .scope-title')) {
    t.querySelector('.scope-chip')?.remove();
    const k = t.dataset.scope as ScopeKind;
    if (odd.has(k)) t.append(scopeChip(k, 'piece'));
  }
}
/** `updatePiece` for colors, glow and materials (`k`): on every picked piece, or on Everything every piece */
function updatePicked(fn: (p: Piece) => void, doCommit = true, k: ScopeKind = 'color') {
  const main = piece();
  const others = wholeThingFor(k) ? workbench().pieces.filter((q) => q !== main) : pickedPieces().slice(1);
  updatePiece((p) => {
    fn(p);
    for (const q of others) {
      fn(q);
      syncTwin(q);
    }
  }, doCommit);
}
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
  action('copy', 'Make a copy of this thing (to change one and not the other)', () => copyThing(t));
  action('arrow-down-to-line', 'Download as a .stuff file', () => downloadThing(t));
  action('trash', 'Remove from My stuff', () => deleteThing(t));
  return actions;
}
function copyThing(t: Thing) {
  if (!t.pieces.length) return;
  putThing({ ...structuredClone(t), id: uid(), name: `${t.name.trim() || 'Thing'} copy` });
  queueCreationSave();
  renderCollection();
  hint('Copied: put the copy on, then change it', 2000);
}
function downloadThing(t: Thing) {
  // one kind of file: a save holding just this thing opens straight into My stuff
  saveBundle({ creatures: [], stuff: [stripThumb(t)], rigs: [] }, t.name.trim() || 'thing');
}
function deleteThing(t: Thing) {
  const name = t.name.trim() || 'this thing';
  if (t.pieces.length && !confirm(`Delete "${name}" from My stuff? (Creatures already wearing it keep their copy.)`)) return;
  removeThing(t.id);
  queueCreationSave();
  renderCollection();
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
  $('#stuff-done').onclick = () => finishStuff();
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
  pieceGlowFollow = glowFollowSeg(
    '#piece-glow-follow',
    () => piece(),
    (f) =>
      updatePicked((q) => {
        if (f) q.glowFollow = f;
        else delete q.glowFollow;
      }),
  );
  pieceSceneColors = sceneColorRow($('#piece-scene-colors'), () => piece()?.color, (c) => updatePicked((q) => (q.color = c)));
  glowSlider(
    '#piece-glow',
    (v) => {
      updatePicked((p) => {
        if (v > 0) p.glow = v;
        else delete p.glow;
      }, false);
      pieceGlowFollow();
    },
    () => commit(),
  );
  $<HTMLInputElement>('#piece-color').oninput = (e) => updatePicked((p) => (p.color = (e.target as HTMLInputElement).value), false);
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
