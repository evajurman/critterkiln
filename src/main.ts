import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  blendWithOf,
  Creature,
  defaultState,
  EYE_STYLES,
  markingsOf,
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
  type PartState,
  type SeamlessMode,
} from './creature';
import { collect, reach, renderTrophies, setTrophyHandlers, unlock } from './achievements';
import { bounds, clipLoop, setMeshDetail, type Vec2 } from './inflate';
import { collection, downloadText, envelope, placeMatrix, safeFileName, setCollection, uid, type Thing } from './stuff';
import { STYLE_PARAMS, STYLES, followOf, setFuzzQuality, setSketchPixelRatio, styleSettings, type GlowFollow, type StyleId } from './materials';
import { onMarkingTexture, type Marking } from './markings';
import { MarkingPanel, followMarkTools, initMarkingTools, markGizmoMode, markToolKey, stopMarkTools } from './markingPanel';
import { installScrollbars } from './scrollbars';
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
import { arrangeMenu, customTabs, tabNamesMenu, initLayout, setLayoutTab, setSceneColors } from './layout';
import { installCursorPress } from './cursorPress';
import { installTooltips } from './tooltip';
import {
  captureShortcut,
  hasCustomShortcuts,
  is,
  keyLabel,
  labelShortcuts,
  renderShortcutSheet,
  resetShortcuts,
  stopListening,
  type ShortcutId,
} from './shortcuts';
import { openContextMenu, SEP, type MenuEntry, type MenuItem } from './contextMenu';
import { deleteCreation, getCreation, keepStorage, listCreations, markSaved, putCreation, type Creation, type SavedHow } from './library';
import {
  RIGS,
  addLimb,
  canParent,
  deleteLimb,
  deleteSavedRig,
  detachBone,
  expandRig,
  extendBone,
  getRig,
  mirrorLimb,
  mirrorTarget,
  partIds,
  reattachBone,
  moveLimb,
  rigFromTemplate,
  saveRig,
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
import { $, fa, faClassic, iconLabel } from './editor/dom';
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
  type Quality,
  QUALITY,
  renderer,
  rim,
  scene,
  sceneOrtho,
  setLightTurn,
  setOrtho,
  setQualityValue,
  shadowMat,
  syncView,
  view,
  viewport,
} from './editor/stage';
import {
  applyFloor,
  backdrop,
  BACKDROPS,
  buildFloorMesh,
  type FloorMode,
  floorPrefs,
  initFloor,
  mirror,
  neutralTone,
  paintBackdrop,
  refreshFloorColors,
  saveFloor,
  setBackdrop,
  sizeMirror,
  STUFF_BACKDROP,
  tintForBackdrop,
} from './editor/floor';
import { aoTexel, bokeh, composer, gtao, initPost, setAO } from './editor/post';
import {
  activate,
  booted,
  buildCreature,
  commit,
  CREATION_KEY,
  creature,
  creatures,
  eyePair,
  fitShadows,
  freshWorld,
  hIndex,
  history,
  idle,
  initState,
  loadedWorld,
  makeCreature,
  migrate,
  mode,
  type Mode,
  opened,
  parentsChecked,
  redo,
  save,
  sceneColorRows,
  selected,
  setBooted,
  setCreature,
  setEyePair,
  setHIndex,
  setIdle,
  setModeValue,
  setSelected,
  setState,
  setWorld,
  state,
  undo,
  world,
  type World,
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
  showEyes,
  syncIdle,
  touchScreen,
  updateSkeletonVisibility,
  viewChanged,
  viewMoved,
} from './editor/controls';
import { flyTo, focusOnBone, frameAll, frameCreature, freshView, initFraming, partToFloor, setTween, tween } from './editor/framing';
import {
  drawHint,
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
  spacePan,
  syncDrawBar,
  toggleSymmetry,
} from './editor/drawing';
import {
  autosaveThing,
  bench,
  benchKey,
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
  refreshPieceGizmo,
  renderStuffPanel,
  saveWorkbenchNow,
  selectedPiece,
  setBenchKey,
  setPieceMirror,
  setPieceMode,
  setSelectedPiece,
  snapThumb,
  syncTwin,
  syncWorkbench,
  thingSaveTimer,
  twinOf,
  workbench,
} from './editor/workbench';
import { deselectAttachment, gizmo, initAttach, selectAttachment, selectedAttachment } from './editor/attach';
import { initArrange, type PlaceMode, placing, setPlaceMode, startPlacing, stopPlacing } from './editor/arrange';
import { initCreatureBar, renderCreatureBar } from './editor/creatureBar';
import { initAttachPanel, removeAttachment, syncAttachBar } from './editor/attachPanel';
import { initCarry, pickAttachment, pickStuff, renderCreatureStuff } from './editor/carry';
import { closeAttachPops, closeTopPopovers, togglePopover } from './editor/popovers';
import {
  applyLook,
  currentLook,
  forFile,
  initFiles,
  keepInCollection,
  loadBundle,
  openFile,
  putView,
  saveBundle,
  sceneFileName,
  type SceneLook,
} from './editor/files';

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
export interface LibraryFile {
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
export function queueCreationSave() {
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
export function flushCreationSave() {
  if (opened.timer) saveCreationNow();
}

/**
 * Before the scene is swapped for another: the thing on the workbench goes in
 * My stuff, and the scene (My stuff too) is saved to My creations.
 */
export function leaveScene() {
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
export function beginCreation(id: string | null, keep: boolean, from?: SavedCreation) {
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
  setHIndex(-1);
}

/**
 * Swap every creature in the scene for these, and My stuff for `stuff`. The
 * workbench starts empty. Call leaveScene first to keep the old scene.
 */
export function replaceWorld(next: World, stuff: Thing[]) {
  exitDraw();
  clearTimeout(thingSaveTimer);
  setCollection(stuff);
  setSelectedPiece('');
  $('#thing-saved').textContent = '';
  deselectAttachment();
  stopPlacing();
  for (const c of creatures) c.dispose();
  creatures.length = 0;
  setCreature(undefined as unknown as Creature); // replaced wholesale
  setWorld(next);
  next.creatures.forEach((s, i) => (creatures[i] = makeCreature(s)));
  setSelected('');
  // a new world starts with nothing picked: set before activate draws the handles
  setIdle(true);
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
export function noteSaved(ids: string[], how: SavedHow) {
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
export async function importCreations(f: LibraryFile) {
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

// UI

export const SWATCHES = [
  '#f26b5b', '#ff9f6b', '#f7c873', '#fff1c9', '#9fd98b', '#5fbf9f', '#7cc6e8', '#6d8fe0',
  '#b9a3e3', '#f6a5b5', '#e86aa6', '#c98b5e', '#8d6e63', '#fdfaf4', '#9a9aa6', '#3a3340',
];

/**
 * Every color in use: the creatures (and their markings), their eyes and what they wear, the thing
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
    for (const p of Object.values(s.parts)) {
      add(p.color);
      for (const m of p.markings ?? []) add(m.color);
    }
    for (const m of s.markings ?? []) add(m.color);
    if (s.eyes.enabled && (s.eyes.style === 'bead' || s.eyes.style === 'dot' || s.eyes.style === 'button')) add(s.eyes.color);
    for (const a of s.attachments ?? []) for (const p of a.thing.pieces) add(p.color);
  }
  for (const p of world.workbench?.pieces ?? []) add(p.color);
  if (floorPrefs.mode === 'material') add(floorPrefs.color);
  add(backdrop);
  return [...used].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** A color picker's "In the scene" row, kept up to date as colors change anywhere. */
export function sceneColorRow(el: HTMLElement, current: () => string | undefined, pick: (c: string) => void): () => void {
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
export function renderSceneColors() {
  // (not before the first creature is up)
  if (!creature) return;
  for (const r of sceneColorRows) r();
}
setSceneColors(sceneColors);

/**
 * Where a glow comes from (Even / Bright / Dark, under its Glow slider; only
 * shown while it glows). Returns its redraw.
 */
export function glowFollowSeg(id: string, get: () => { glow?: number; glowFollow?: GlowFollow; markings?: Marking[] } | undefined, set: (f: GlowFollow | undefined) => void): () => void {
  const el = $(id);
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
  const render = () => {
    const o = get();
    el.hidden = !o?.glow;
    for (const b of buttons) {
      b.classList.toggle('active', b.dataset.follow === followOf(o?.glowFollow));
      // (glowing from the markings needs some markings)
      if (b.dataset.follow === 'markings') b.hidden = !o?.markings?.length;
    }
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
export function glowSlider(id: string, set: (v: number) => void, done: () => void) {
  const input = $<HTMLInputElement>(id);
  input.oninput = () => {
    set(parseFloat(input.value));
    invalidate();
  };
  input.onchange = () => done();
}

export function partLabel(src: string): string {
  const b = creature.bones.get(src)!;
  return b.def.sideSign !== 0 ? b.def.name.replace(/ \((L|R)\)$/, '') : b.def.name;
}

function sources(): BoneRT[] {
  return creature.list.filter((b) => !b.def.mirrorOf);
}

function selPart() {
  return state.parts[creature.bones.get(selected)!.src];
}

export function selectPart(id: string, tips = true) {
  setIdle(false);
  setSelected(id);
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
export function flashPart() {
  flashStart = performance.now();
}

export function renderRigs() {
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
  () => (creature.bones.has(selected) ? { ...selPart(), markings: markingsOf(state, selPartId()) } : undefined),
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
    btn.innerHTML = `<span class="ball ${s.id}"></span><b>${s.name}</b>`;
    btn.title = s.desc;
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
export function renderThingMaterial(thing: Thing, styles: StyleId[], el: HTMLElement, wearerStyle: StyleId) {
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
  row.title = thing.inherit
    ? `Made of ${styleName}, like the ${mode === 'stuff' ? 'creature' : 'part it’s on'}. Change it in Look › Material.`
    : `Off: its pieces keep their own materials. On: it’s made of whatever the ${mode === 'stuff' ? 'creature' : 'part it’s on'} is made of`;
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
    input.dataset.default = String(p.value);
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
export function setEyesFolded(on: boolean) {
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
  if (!mine.includes(eyePair)) setEyePair(mine[0]);
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
      setEyePair(i);
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
    setEyePair(e.pairs.length - 1);
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

export function renderUI() {
  if (!creature.bones.has(selected)) setSelected(creature.list[0].def.id);
  renderAnim();
  renderRigs();
  renderPartCard();
  renderColors();
  renderStyles();
  renderMarkings();
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
export function scopeSeg(id: string, get: () => boolean, set: (all: boolean) => void): () => void {
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
  renderCreatureBar();
}

// Markings: patterns over the material (see src/markings.ts and the panel in
// src/markingPanel.ts), on the whole creature or one part. The same panel
// marks stuff pieces on the workbench (see pieceMarks).

initMarkingTools({
  gizmo,
  scene,
  canvas,
  view: () => view,
  rayAt: (x, y) => {
    setRay(x, y);
    return raycaster;
  },
  invalidate: () => invalidate(),
  commit: () => commit(),
  hint: (text, ms, warn) => hint(text, ms, warn),
  hintOnce: (text, ms) => hintOnce(text, ms),
  takeOver: () => {
    stopPlacing();
    if (selectedAttachment) deselectAttachment();
  },
  toolsChanged: () => {
    updateSkeletonVisibility();
    if (mode === 'stuff') refreshPieceGizmo();
  },
  busy: () => spacePan || !!drawState,
});

// a picture loading or a font arriving redraws whatever shows it
onMarkingTexture(() => invalidate());

function selPartId(): string {
  return creature.bones.get(selected)!.src;
}

/** The creature's markings, by part. */
const partMarks = new MarkingPanel(
  {
    unit: 'part',
    whole: 'creature',
    picked: () => (mode !== 'stuff' && creature.bones.has(selected) ? selPartId() : null),
    units: () => Object.keys(state.parts),
    wholeMarkings: () => state.markings,
    ownMarkings: (id) => state.parts[id]?.markings,
    setWhole: (list) => {
      if (list.length) state.markings = list;
      else delete state.markings;
    },
    setOwn: (id, list) => {
      const p = state.parts[id];
      if (!p) return;
      if (list.length) p.markings = list;
      else delete p.markings;
    },
    pictures: () => state.pictures,
    setPictures: (p) => {
      if (p) state.pictures = p;
      else delete state.pictures;
    },
    colorOf: (id) => state.parts[id]?.color ?? '#808080',
    changed: (doCommit) => {
      // glowing from the markings needs some markings
      for (const [id, p] of Object.entries(state.parts)) if (p.glowFollow === 'markings' && !markingsOf(state, id).length) delete p.glowFollow;
      creature.sync();
      creature.markMergeDirty();
      if (doCommit) commit();
      partGlowFollow();
    },
    // markings are laid out in the rest pose: shown on the picked part as it's posed now
    frame: () => {
      const b = creature.bones.get(selected);
      if (!b) return null;
      creature.root.updateMatrixWorld(true);
      return { toWorld: b.pivot.matrixWorld.clone().multiply(b.restGroup.clone().invert()), middle: new THREE.Vector3(0, b.length / 2, 0).applyMatrix4(b.restGroup) };
    },
    surface: (ray) => {
      const hit = creature.surfaceAt(ray);
      if (!hit) return null;
      const b = hit.bone;
      return { point: hit.point, at: hit.point.clone().applyMatrix4(b.pivot.matrixWorld.clone().invert()).applyMatrix4(b.restGroup) };
    },
    // (the skeleton's two sides mirror across X, as pairs of parts do)
    mirror: (v) => v.setX(-v.x),
  },
  { list: $('#markings'), params: $('#marking-params') },
);
scopeSeg(
  '#mark-scope',
  () => partMarks.all,
  (all) => {
    partMarks.all = all;
    partMarks.render();
  },
);

function renderMarkings() {
  partMarks.render();
}

/** The workbench thing's markings, by piece. */
export const pieceMarks = new MarkingPanel(
  {
    unit: 'piece',
    whole: 'thing',
    picked: () => (mode === 'stuff' && piece() ? selectedPiece : null),
    units: () => workbench().pieces.map((p) => p.id),
    wholeMarkings: () => workbench().markings,
    ownMarkings: (id) => workbench().pieces.find((p) => p.id === id)?.markings,
    setWhole: (list) => {
      const wb = workbench();
      if (list.length) wb.markings = list;
      else delete wb.markings;
    },
    setOwn: (id, list) => {
      const p = workbench().pieces.find((q) => q.id === id);
      if (!p) return;
      if (list.length) p.markings = list;
      else delete p.markings;
      // (a mirrored piece's other side has them too)
      syncTwin(p);
    },
    pictures: () => workbench().pictures,
    setPictures: (p) => {
      const wb = workbench();
      if (p) wb.pictures = p;
      else delete wb.pictures;
    },
    colorOf: (id) => workbench().pieces.find((p) => p.id === id)?.color ?? '#808080',
    changed: (doCommit) => {
      syncWorkbench();
      invalidate();
      if (doCommit) commit();
    },
    // laid out in the thing's own space: the board's
    frame: () => {
      const p = piece();
      if (!p || !bench) return null;
      bench.updateMatrixWorld(true);
      const b = bounds(p.outline);
      return { toWorld: bench.matrixWorld.clone(), middle: new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, p.z).applyMatrix4(placeMatrix(p)) };
    },
    surface: (ray) => {
      if (!bench) return null;
      const hit = ray.intersectObject(bench, true)[0];
      if (!hit) return null;
      return { point: hit.point, at: hit.point.clone().applyMatrix4(bench.matrixWorld.clone().invert()) };
    },
    // across the centre line, as Mirror makes pieces
    mirror: (v) => v.setX(-v.x),
  },
  { list: $('#piece-markings'), params: $('#piece-marking-params') },
);
scopeSeg(
  '#piece-mark-scope',
  () => pieceMarks.all,
  (all) => {
    pieceMarks.all = all;
    pieceMarks.render();
  },
);

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
export function freshRig(rig: RigState): RigState {
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
  setState(next);
  setSelected('');
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
  setModeValue(m);
  if (m === ANIM_TAB) deselectAttachment();
  stopMarkTools();
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

// rig editing

/** Apply a skeleton edit, give new bones a look, rebuild, and select the first new bone. */
/** Give parts made by a rig edit their looks (and, for a split pair's right side, its own eyes). */
export function applyPartCopies(copies: PartCopy[], copyShape: boolean) {
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

export function rigEdit(fn: (rig: RigState) => PartCopy[], copyShape: boolean) {
  const copies = fn(state.rig);
  applyPartCopies(copies, copyShape);
  // an edited skeleton is no longer the saved/template one
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  // stuff on removed bones goes with them
  if (state.attachments) state.attachments = state.attachments.filter((a) => creature.bones.has(a.bone));
  if (copies.length) setSelected(copies[0].to);
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
    iconLabel(mirrorBtn, faClassic(lone.other ? 'link' : 'clone'), lone.other ? 'Relink pair' : 'Mirror part');
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
  title.title = paired ? 'Rename this pair: both sides share one name' : 'Rename this part';
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
export const rigPrefs: { lock: boolean; autoParent: boolean } = (() => {
  try {
    return { lock: true, autoParent: true, ...JSON.parse(localStorage.getItem(RIG_PREFS_KEY) ?? '{}') };
  } catch {
    return { lock: true, autoParent: true };
  }
})();
let rigLock = rigPrefs.lock;
export function rigLocked() {
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
export function sizesIn(c: Creature): PartSizes {
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
export function rehang(c: Creature, rig: RigState, ids: string[]) {
  const bones = expandRig(rig).bones;
  const moves = ids.map((id) => {
    const to = bones.find((b) => b.id === id)?.parent;
    return [id, to ? c.rehangMove(id, to) : null] as const;
  });
  for (const [id, m] of moves) if (m) moveLimb(rig, id, m);
}
export const sceneName = (rig: RigState, id: string) => expandRig(rig).bones.find((b) => b.id === id)?.name ?? id;
export let pickingParent = false;
function setPickingParent(on: boolean) {
  pickingParent = on;
  $('#set-parent').classList.toggle('on', on);
  $('#viewport').style.cursor = on ? 'crosshair' : '';
  if (on) hint('Click the part this one should hang off', 0);
  else hint('');
}
/** Set parent: the picked part hangs off the part clicked. */
export function parentAt(x: number, y: number) {
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
export function commitBoneEdit() {
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
  setPartName($<HTMLInputElement>('#rig-title').value, commitIt);
}
/** The picked part's name (a pair shares one). */
export function partName() {
  const b = creature.bones.get(selected);
  return (b && state.rig.bones.find((d) => d.id === b.def.baseId)?.name) ?? '';
}
/** Names the picked part (both of a pair); a blank name is ignored. */
export function setPartName(raw: string, commitIt: boolean) {
  const b = creature.bones.get(selected);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  const name = raw.trim();
  if (!def || !name) return;
  def.name = name;
  // re-seat so the bones pick up the new name (it's shown on every part list)
  creature.relayout(state.rig);
  renderCreatureBar();
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
  setSelected(to.get(selected) ?? r.renamed[0][1]);
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

/** Delete the picked part and everything on it (the creature's root part stays). */
export function removePart() {
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
export function hintOnce(text: string, ms = 2000) {
  if (hintsShown.has(text)) return;
  hintsShown.add(text);
  hint(text, ms);
}

/** A message at the bottom of the view; `ms` 0 keeps it up until replaced (drawing instructions). */
export function hint(text: string, ms = 2000, warn = false) {
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
export function closeShortcutSheet() {
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
  setQualityValue(settings.quality = q);
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
  setCreature(undefined as unknown as Creature); // replaced wholesale
  activate(world.active);
  setBenchKey('');
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
installTooltips();
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
initFraming();

$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#spin').onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  $('#spin').classList.toggle('on', controls.autoRotate);
  if (controls.autoRotate) unlock('spin');
};
$('#new').onclick = () => newCreation();

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
var ANIM_TAB = 'animate' as const;
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
