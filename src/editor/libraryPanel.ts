import { type CreatureState } from '../creature';
import { reach, unlock } from '../achievements';
import { downloadText, envelope, uid } from '../stuff';
import { deleteCreation, getCreation, listCreations, markSaved, putCreation, type SavedHow } from '../library';
import { $, fa, faClassic } from './dom';
import { creatures, migrate, mode, opened, save, world } from './state';
import { loadBundle, saveBundle } from './files';
import {
  closeLibrary,
  type CreationData,
  creationData,
  creationName,
  flushCreationSave,
  type LibraryFile,
  newCreation,
  openCreation,
  openLibrary,
  type SavedCreation,
  timeAgo,
} from './creations';
import { setMode } from './panels';
import { hint } from './hints';

export async function renderLibrary() {
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

export function initLibraryPanel() {
  $('#library-backup').onclick = () => void backupCreations();
  $('#library-import').onclick = () => $<HTMLInputElement>('#file-input').click();
}
