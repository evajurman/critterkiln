// ---------------------------------------------------------------------------
// What a section's changes go on: the picked part (or piece), or Everything on
// the creature (or the thing). Each section keeps its own, remembered in this
// browser for every creation. The toggle at the top of the inspector sets all
// the sections showing; right-clicking a section sets just it, and a section
// that differs from the rest says so with a chip on its title.

import { SEP, type MenuEntry } from '../contextMenu';
import { $ } from './dom';
import { renderUI } from './panels';
import { mode } from './state';

export type ScopeKind = 'color' | 'material' | 'markings';
export type Scope = 'part' | 'all';
/** A creature's parts, or the pieces of the thing on the workbench */
export type ScopeOf = 'part' | 'piece';

const KEY = 'creature-creator/scope';
/** Until changed: a material is nearly always the whole creature's; colors and markings go on a part */
const DEFAULTS: Record<ScopeKind, Scope> = { color: 'part', material: 'all', markings: 'part' };
/** Free's Look tab: everything starts on the whole creature (its own choices, apart from Guided's) */
const LOOK_DEFAULTS: Record<ScopeKind, Scope> = { color: 'all', material: 'all', markings: 'all' };
const inLook = (of: ScopeOf) => of === 'part' && mode === 'look';
const NAMES: Record<ScopeKind, string> = { color: 'Color', material: 'Material', markings: 'Markings' };
/** The tools whose changes follow a scope (material sliders are the material's own, wherever it's used) */
const TOOLS: Record<string, ScopeKind> = {
  'custom-color': 'color',
  swatches: 'color',
  'scene-colors': 'color',
  glow: 'color',
  materials: 'material',
  markings: 'markings',
};

let saved: Record<string, Scope> = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
} catch {
  // (private window, blocked storage: the defaults)
}

export function scopeOf(k: ScopeKind, of: ScopeOf = 'part'): Scope {
  const s = saved[`${inLook(of) ? 'look' : of}:${k}`];
  return s === 'part' || s === 'all' ? s : (inLook(of) ? LOOK_DEFAULTS : DEFAULTS)[k];
}

function setScope(kinds: ScopeKind[], s: Scope, of: ScopeOf) {
  for (const k of kinds) saved[`${inLook(of) ? 'look' : of}:${k}`] = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // (still set for now)
  }
  renderUI();
}

const label = (s: Scope, of: ScopeOf) => (s === 'all' ? 'Everything' : of === 'piece' ? 'Piece' : 'Part');
const whole = (of: ScopeOf) => (of === 'piece' ? 'every piece of the thing' : 'every part of the creature');
const one = (of: ScopeOf) => (of === 'piece' ? 'the picked pieces' : 'the picked parts');

/** A Part|Everything toggle for `kinds`: on when they all agree, neither when they don't; a click sets them all. */
export function renderScopeToggle(seg: HTMLElement, kinds: ScopeKind[], of: ScopeOf) {
  seg.hidden = !kinds.length;
  if (!kinds.length) return;
  if (!seg.childElementCount) {
    for (const s of ['part', 'all'] as Scope[]) {
      const b = document.createElement('button');
      b.dataset.scope = s;
      b.textContent = label(s, of);
      seg.append(b);
    }
  }
  const now = kinds.map((k) => scopeOf(k, of));
  const mixed = now.some((s) => s !== now[0]);
  for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
    const s = b.dataset.scope as Scope;
    b.classList.toggle('active', !mixed && now[0] === s);
    b.title = `${kinds.map((k) => NAMES[k]).join(', ')} change ${s === 'all' ? whole(of) : one(of)}`;
    b.onclick = () => setScope(kinds, s, of);
  }
  seg.classList.toggle('mixed', mixed);
  seg.setAttribute('aria-label', mixed ? 'What changes: mixed, each section says' : `What changes: ${label(now[0], of)}`);
}

/** A section title's chip: what that section changes; a click flips it. */
export function scopeChip(k: ScopeKind, of: ScopeOf, named = false): HTMLButtonElement {
  const s = scopeOf(k, of);
  const b = document.createElement('button');
  b.className = 'scope-chip' + (s === 'all' ? ' all' : '');
  b.textContent = (named ? `${NAMES[k]}: ` : '') + label(s, of);
  b.title = `${NAMES[k]} changes ${s === 'all' ? whole(of) : one(of)}. Click for ${s === 'all' ? one(of) : whole(of)}`;
  b.onclick = (e) => {
    // (not the title's own click, which folds a section on the view)
    e.stopPropagation();
    setScope([k], s === 'all' ? 'part' : 'all', of);
  };
  return b;
}

/** The kinds that don't go along with the rest, so get a chip: none when they all agree, all of them when there's no clear majority. */
export function oddKinds(kinds: ScopeKind[], of: ScopeOf): Set<ScopeKind> {
  const alls = kinds.filter((k) => scopeOf(k, of) === 'all').length;
  if (!alls || alls === kinds.length) return new Set();
  const most: Scope | null = alls * 2 > kinds.length ? 'all' : alls * 2 < kinds.length ? 'part' : null;
  return new Set(kinds.filter((k) => scopeOf(k, of) !== most));
}

/** Right-click choices for what `kinds` change: the picked parts (or pieces), or everything. */
export function scopeItems(kinds: ScopeKind[], of: ScopeOf): MenuEntry[] {
  return kinds.flatMap((k): MenuEntry[] => [
    SEP,
    { label: `${NAMES[k]}: just ${one(of)}`, checked: scopeOf(k, of) === 'part', run: () => setScope([k], 'part', of) },
    { label: `${NAMES[k]}: everything`, title: `${NAMES[k]} changes ${whole(of)}`, checked: scopeOf(k, of) === 'all', run: () => setScope([k], 'all', of) },
  ]);
}

/** The scope choices for whatever was right-clicked: a section of the creature's, or a group on the piece card. */
export function scopeMenu(at: HTMLElement): MenuEntry[] {
  const sec = at.closest<HTMLElement>('.ck-sec');
  if (sec) return scopeItems(kindsIn(sec), 'part');
  const card = $('#piece-card');
  if (!card.contains(at)) return [];
  // on the piece card: the group under the last title above what was clicked
  let k: ScopeKind | undefined;
  for (const c of card.children) {
    if (c.classList.contains('scope-title')) k = (c as HTMLElement).dataset.scope as ScopeKind;
    if (c.contains(at)) break;
  }
  return k ? scopeItems([k], 'piece') : [];
}

/** The kinds a section's tools change, in order */
function kindsIn(sec: Element): ScopeKind[] {
  const tools = [...sec.querySelectorAll<HTMLElement>(':scope > .ck-body > .ck-tool:not(.ck-off)')];
  return [...new Set(tools.flatMap((t) => TOOLS[t.dataset.tool!] ?? []))];
}

/** The creature's toggle (over the sections showing), and chips on the titles of sections that differ from the rest. */
export function renderScope() {
  const shown = new Set<ScopeKind>();
  const secs = [...document.querySelectorAll<HTMLElement>('.ck-sec')].filter((sec) => !sec.closest('#ck-hidden'));
  for (const sec of secs) {
    sec.querySelectorAll(':scope > .ck-title .scope-chip').forEach((c) => c.remove());
    // a phone shows one section at a time: the toggle is for the one showing
    if (sec.getClientRects().length) kindsIn(sec).forEach((k) => shown.add(k));
  }
  const odd = oddKinds([...shown], 'part');
  for (const sec of secs) {
    const kinds = kindsIn(sec).filter((k) => odd.has(k));
    sec.querySelector(':scope > .ck-title')?.append(...kinds.map((k) => scopeChip(k, 'part', kindsIn(sec).length > 1)));
  }
  renderScopeToggle($('#scope-toggle'), [...shown], 'part');
}
