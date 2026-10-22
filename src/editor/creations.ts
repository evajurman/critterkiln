// ---------------------------------------------------------------------------
// My creations: the open scene saves itself into the library (src/library.ts)
// as you go, and the library lists everything you've made.

import * as THREE from 'three';
import { Creature, type CreatureState } from '../creature';
import { reach, unlock } from '../achievements';
import { guidedOn, STEPS } from '../layout';
import { collection, setCollection, uid, type Thing } from '../stuff';
import { getCreation, keepStorage, listCreations, putCreation, type Creation } from '../library';
import { $ } from './dom';
import {
  activate,
  commit,
  CREATION_KEY,
  creature,
  creatures,
  freshWorld,
  hIndex,
  history,
  idle,
  makeCreature,
  migrate,
  mode,
  opened,
  selected,
  setCreature,
  setHIndex,
  setIdle,
  setSelected,
  setWorld,
  world,
  type World,
} from './state';
import { drag } from './controls';
import { frameCreature, freshView } from './framing';
import { drawState, exitDraw } from './drawing';
import { saveWorkbenchNow, selectedPiece, setSelectedPiece, snapThumb, thingSaveTimer } from './workbench';
import { deselectAttachment, gizmo } from './attach';
import { stopPlacing } from './arrange';
import { togglePopover } from './popovers';
import { applyLook, currentLook, forFile, keepInCollection, type SceneLook } from './files';
import { renderLibrary } from './libraryPanel';
import { renderUI, setMode } from './panels';
import { hint } from './hints';

/** What the library keeps for each scene. */
export interface CreationData {
  creatures: CreatureState[];
  active: number;
  look: SceneLook;
  /** its My stuff (absent in creations saved before each one kept its own) */
  stuff?: Thing[];
}
export type SavedCreation = Creation<CreationData>;
/** A backup of the whole library, as one file. */
export interface LibraryFile {
  creations: SavedCreation[];
}

const CREATION_SAVE_MS = 1200;

export function creationData(): CreationData {
  return { creatures: world.creatures.map(forFile), active: world.active, look: currentLook(), stuff: collection() };
}

/** "Bimble & Twin", or "Untitled" when nobody has a name. */
export function creationName(c: { name?: string; data: { creatures: CreatureState[] } }): string {
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
export function newCreation(keepOld = true) {
  // back to the start: the first step in Guided, Shape in Free
  const start = guidedOn() ? STEPS[0].id : 'shape';
  if (mode !== start) setMode(start);
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

export async function openCreation(id: string) {
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
export function timeAgo(t: number): string {
  const sec = (t - Date.now()) / 1000;
  for (const [unit, n] of TIME_UNITS) if (Math.abs(sec) >= n) return relTime.format(Math.round(sec / n), unit);
  return 'just now';
}

export function openLibrary() {
  if ($('#library-pop').hidden) togglePopover('#library-pop');
  void renderLibrary();
}
export function closeLibrary() {
  if (!$('#library-pop').hidden) togglePopover('#library-pop');
}

export function initCreations() {
  $('#library-btn').onclick = () => {
    if (togglePopover('#library-pop')) void renderLibrary();
  };
  $('#library-close').onclick = closeLibrary;
  // leaving the page: whatever's waiting gets saved
  addEventListener('pagehide', flushCreationSave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushCreationSave();
  });
}
