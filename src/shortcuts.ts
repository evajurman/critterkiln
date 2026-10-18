// ---------------------------------------------------------------------------
// Keyboard shortcuts: one table of what each key does, which the key handler,
// the tooltips and the shortcut sheet all read. Keys can be changed on the
// sheet; changes are kept in this browser.

import { tipOf } from './tooltip';

export type ShortcutId =
  | 'shape' | 'look' | 'stuff'
  | 'undo' | 'redo'
  | 'frame' | 'frameAll'
  | 'draw' | 'mirror' | 'delete' | 'help'
  | 'move' | 'rotate' | 'scale'
  | 'erase' | 'side';

interface Shortcut {
  id: ShortcutId;
  group: string;
  label: string;
  /** more about where it works, shown under the label */
  note?: string;
  keys: string[];
}

const SHORTCUTS: Shortcut[] = [
  { id: 'shape', group: 'Getting around', label: 'Shape tab', keys: ['1'] },
  { id: 'look', group: 'Getting around', label: 'Look tab', keys: ['2'] },
  { id: 'stuff', group: 'Getting around', label: 'Stuff tab', keys: ['3'] },
  { id: 'frame', group: 'Getting around', label: 'Frame what you’re working on', note: 'While drawing: face the drawing again', keys: ['f'] },
  { id: 'frameAll', group: 'Getting around', label: 'Frame everyone', keys: ['shift+a'] },
  { id: 'help', group: 'Getting around', label: 'Keyboard shortcuts', keys: ['?'] },
  { id: 'undo', group: 'Editing', label: 'Undo', keys: ['ctrl+z'] },
  { id: 'redo', group: 'Editing', label: 'Redo', keys: ['ctrl+shift+z', 'ctrl+y'] },
  { id: 'draw', group: 'Editing', label: 'Draw', note: 'A new part, or a stuff piece. While drawing: the Draw tool', keys: ['d'] },
  { id: 'mirror', group: 'Editing', label: 'Mirror', note: 'Both sides of a pair change together; while drawing, one half is copied across the centre line; on a stuff piece, a mirror image on the other side', keys: ['m'] },
  { id: 'delete', group: 'Editing', label: 'Delete', note: 'The picked part, stuff or piece', keys: ['delete', 'backspace'] },
  { id: 'move', group: 'Move, rotate and scale', label: 'Move', note: 'Pieces, worn stuff, a creature you’re arranging, and a drawing', keys: ['w'] },
  { id: 'rotate', group: 'Move, rotate and scale', label: 'Rotate', keys: ['e'] },
  { id: 'scale', group: 'Move, rotate and scale', label: 'Scale', keys: ['r'] },
  { id: 'erase', group: 'Drawing', label: 'Erase tool', keys: ['x'] },
  { id: 'side', group: 'Drawing', label: 'Front or side view', note: 'Drawing a body part', keys: ['v'] },
];

/** Keys that always do the same thing, listed on the sheet but not changeable (or takeable). `combo`: a key named as on this computer (⌘ on a Mac). */
const FIXED: { label: string; keys?: string; combo?: string; group: string; note?: string }[] = [
  { group: 'Getting around', label: 'Your own tabs', keys: '4 – 9' },
  { group: 'Getting around', label: 'Pan the view: drag with Space held, or right-drag. Shift+drag on empty space too (not while drawing)', keys: 'Space' },
  { group: 'Editing', label: 'Keep a dragged grip to one axis', note: 'Hold while dragging: it moves along the creature’s X, Y or Z, whichever you’re mostly moving along', combo: 'shift' },
  { group: 'Editing', label: 'Snap a dragged grip', note: 'Hold while dragging: it jumps onto the base or tip of another part near the pointer', combo: 'ctrl' },
  { group: 'Drawing', label: 'Keep the drawing (Done)', keys: 'Enter' },
  { group: 'Drawing', label: 'Cancel the drawing', keys: 'Esc' },
];
const RESERVED = new Set(['enter', 'escape', 'space', 'tab', '4', '5', '6', '7', '8', '9']);

const STORE_KEY = 'critterkiln/shortcuts';
let custom: Partial<Record<ShortcutId, string[]>> = {};
try {
  custom = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
} catch {
  /* ignore */
}

// sliding a part's base (the purple grip): through parts on a flat plane, or
// over the surface of whatever part is under the pointer. Alt gives the other
// one; which is plain is a choice on the sheet.
const SURFACE_KEY = 'critterkiln/slide-over-surface';
let surfaceFirst = false;
try {
  surfaceFirst = localStorage.getItem(SURFACE_KEY) === '1';
} catch {
  /* ignore */
}
/** Whether a base slid with Alt held (or not) rides the surface under the pointer. */
export function ridesSurface(alt: boolean): boolean {
  return surfaceFirst !== alt;
}
function setSurfaceFirst(on: boolean) {
  surfaceFirst = on;
  try {
    if (on) localStorage.setItem(SURFACE_KEY, '1');
    else localStorage.removeItem(SURFACE_KEY);
  } catch {
    /* ignore */
  }
}

function keysOf(id: ShortcutId): string[] {
  return custom[id] ?? SHORTCUTS.find((s) => s.id === id)!.keys;
}

function store() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(custom));
  } catch {
    /* ignore */
  }
}

/** A key press as a combo string: "w", "shift+a", "ctrl+z", "delete", "?" */
export function comboOf(e: KeyboardEvent): string {
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  else if (k === 'esc') k = 'escape';
  // shift is part of typing "?" or "!": don't count it
  const punct = k.length === 1 && !/[a-z0-9]/.test(k);
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey && !punct) mods.push('shift');
  return [...mods, k].join('+');
}

/** Whether this key press is (one of) the shortcut's keys. */
export function is(e: KeyboardEvent, id: ShortcutId): boolean {
  return keysOf(id).includes(comboOf(e));
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const NAMES: Record<string, string> = {
  ctrl: MAC ? '⌘' : 'Ctrl', alt: MAC ? '⌥' : 'Alt', shift: 'Shift', delete: 'Delete', backspace: 'Backspace',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', pageup: 'Page Up', pagedown: 'Page Down',
};

function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) => NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+');
}

/** How the shortcut's main key is written: "W", "Shift+A" (empty if it has none). */
export function keyLabel(id: ShortcutId): string {
  const k = keysOf(id)[0];
  return k ? comboLabel(k) : '';
}

/**
 * Tooltips and <kbd> labels on everything marked data-shortcut="id": the
 * title gets the key in brackets on the end, the kbd shows it.
 */
export function labelShortcuts(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-shortcut]').forEach((el) => {
    const label = keyLabel(el.dataset.shortcut as ShortcutId);
    // the tooltip as written, minus any key it was written with
    el.dataset.tip ??= tipOf(el).replace(/\s*\([^()]*\)$/, '');
    if (el.dataset.tip) el.title = label ? `${el.dataset.tip} (${label})` : el.dataset.tip;
    const kbd = el.querySelector('kbd');
    if (kbd) {
      kbd.textContent = label;
      kbd.hidden = !label;
    }
  });
}

// ---- the sheet ----

let listening: ShortcutId | null = null;

function setKeys(id: ShortcutId, keys: string[]) {
  const def = SHORTCUTS.find((s) => s.id === id)!;
  if (keys.join() === def.keys.join()) delete custom[id];
  else custom[id] = keys;
}

/** Give the shortcut this key, taking it from whatever had it. Returns what lost it. */
function assign(id: ShortcutId, combo: string): Shortcut | undefined {
  let lost: Shortcut | undefined;
  for (const s of SHORTCUTS) {
    if (s.id === id) continue;
    const keys = keysOf(s.id);
    if (!keys.includes(combo)) continue;
    setKeys(s.id, keys.filter((k) => k !== combo));
    lost = s;
  }
  setKeys(id, [combo]);
  store();
  return lost;
}

function keyChips(keys: string[]): string {
  return keys.length ? keys.map((k) => `<kbd>${comboLabel(k)}</kbd>`).join(' ') : '<span class="muted small">None</span>';
}

/** Draw the sheet into `list`; `note` shows what just happened (a key taken from something else). */
export function renderShortcutSheet(list: HTMLElement, note = '') {
  list.innerHTML = '';
  if (note) {
    const p = document.createElement('p');
    p.className = 'keys-note small';
    p.textContent = note;
    list.append(p);
  }
  const groups = [...new Set([...SHORTCUTS.map((s) => s.group), ...FIXED.map((f) => f.group)])];
  for (const g of groups) {
    const sec = document.createElement('section');
    sec.className = 'keys-group';
    sec.innerHTML = `<div class="pop-sub">${g}</div>`;
    for (const s of SHORTCUTS.filter((s) => s.group === g)) {
      const row = document.createElement('div');
      row.className = 'keys-row';
      const text = document.createElement('div');
      text.className = 'keys-text';
      text.innerHTML = `<span>${s.label}</span>${s.note ? `<span class="muted small">${s.note}</span>` : ''}`;
      const btn = document.createElement('button');
      btn.className = 'keys-btn';
      btn.title = 'Click, then press the key you want';
      const waiting = listening === s.id;
      btn.classList.toggle('on', waiting);
      btn.innerHTML = waiting ? '<span class="small">Press a key…</span>' : keyChips(keysOf(s.id));
      btn.onclick = () => {
        listening = waiting ? null : s.id;
        renderShortcutSheet(list);
      };
      row.append(text, btn);
      sec.append(row);
    }
    for (const f of FIXED.filter((f) => f.group === g)) {
      const row = document.createElement('div');
      row.className = 'keys-row fixed';
      const note = f.note ? `<span class="muted small">${f.note}</span>` : '';
      row.innerHTML = `<div class="keys-text"><span>${f.label}</span>${note}</div><span class="keys-btn"><kbd>${f.combo ? comboLabel(f.combo) : f.keys}</kbd></span>`;
      sec.append(row);
    }
    if (g === 'Editing') {
      // sliding a base: which way is plain, which needs Alt
      const row = document.createElement('div');
      row.className = 'keys-row fixed';
      const alt = comboLabel('alt');
      row.innerHTML = `<div class="keys-text"><span>Slide a part's base ${surfaceFirst ? 'through parts' : 'over the surface of a part'}</span><span class="muted small">Drag the purple grip with this held. Plain dragging slides it ${surfaceFirst ? 'over the surface of the part under the pointer' : 'through parts'}.</span></div><span class="keys-btn"><kbd>${alt}</kbd></span>`;
      const swap = document.createElement('label');
      swap.className = 'check keys-swap';
      swap.innerHTML = `<input type="checkbox" ${surfaceFirst ? 'checked' : ''} /> <span>Slide bases over surfaces <span class="muted">(${alt} slides through)</span></span>`;
      swap.querySelector('input')!.onchange = (e) => {
        setSurfaceFirst((e.target as HTMLInputElement).checked);
        renderShortcutSheet(list);
      };
      sec.append(row, swap);
    }
    list.append(sec);
  }
}

/** Stop waiting for a key (the sheet closed). */
export function stopListening() {
  listening = null;
}

/**
 * Handle a key press while the sheet waits for one. Returns true if it took
 * the press (the app shouldn't act on it).
 */
export function captureShortcut(e: KeyboardEvent, list: HTMLElement, changed: () => void): boolean {
  if (!listening) return false;
  e.preventDefault();
  e.stopPropagation();
  if (['shift', 'control', 'alt', 'meta'].includes(e.key.toLowerCase())) return true;
  const combo = comboOf(e);
  const id = listening;
  listening = null;
  if (combo === 'escape') {
    renderShortcutSheet(list);
    return true;
  }
  if (RESERVED.has(combo)) {
    renderShortcutSheet(list, `${comboLabel(combo)} is kept for something else. Pick another key.`);
    return true;
  }
  const lost = assign(id, combo);
  const label = SHORTCUTS.find((s) => s.id === id)!.label;
  renderShortcutSheet(list, lost ? `${comboLabel(combo)} is now ${label}, so ${lost.label} lost it.` : '');
  changed();
  return true;
}

/** Back to the keys it came with. */
export function resetShortcuts() {
  custom = {};
  listening = null;
  store();
  setSurfaceFirst(false);
}

export function hasCustomShortcuts(): boolean {
  return Object.keys(custom).length > 0 || surfaceFirst;
}
