/**
 * Sections: Shape and Look are the same tools, laid out differently.
 *
 * Every control in the sidebar and on the view is a tool (a `.ck-tool` in
 * index.html). Each tab keeps its own layout: a list of sections, each in the
 * sidebar, pinned to a corner of the view, or hidden (brought back from the …
 * menu). Arranging a tab drags tools and whole sections anywhere, makes new
 * sections, names them and gives them an icon. How many shaping handles show
 * (Gizmos) belongs to the tab's layout too. Stuff has its own workbench and
 * no layout.
 *
 * People can make tabs of their own (… › New tab from this one): each is one
 * more layout, with a name, icon and color, between Look and Stuff.
 */

import type { MenuItem } from './contextMenu';

/** 'shape', 'look', or a made tab's id */
export type Tab = string;
/** what a tab started from: its defaults, for Reset */
type Base = 'shape' | 'look' | 'animate';
interface TabDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  base: Base;
}
export type Place = 'side' | 'tl' | 'tr' | 'bl' | 'br' | 'hidden';
export type Gizmos = 'full' | 'part' | 'none';
/** wide: a row of its own (a card on the view); button and pill: side by side; own: brings its own look */
type Kind = 'wide' | 'button' | 'pill' | 'own';

interface ToolDef {
  name: string;
  icon: string;
  kind: Kind;
  /** shown with nothing picked too */
  always?: boolean;
  /** only means anything with handles to drag */
  gizmo?: boolean;
}

const fa = (i: string) => `<i class="${i}" aria-hidden="true"></i>`;
const slab = (n: string) => `fa-slab-duo fa-regular fa-${n}`;
const duo = (n: string) => `fa-duotone fa-regular fa-${n}`;

const TOOLS: Record<string, ToolDef> = {
  plan: { name: 'Body plans', icon: duo('bone'), kind: 'wide' },
  blend: { name: 'Blend shape', icon: duo('sliders'), kind: 'wide' },
  opacity: { name: 'Opacity', icon: duo('sliders'), kind: 'wide' },
  seamless: { name: 'Seamless joins', icon: slab('wand-magic-sparkles'), kind: 'wide' },
  worn: { name: 'Stuff on this creature', icon: slab('paperclip'), kind: 'wide' },
  name: { name: 'Part name', icon: duo('tag'), kind: 'wide' },
  draw: { name: 'Draw shape', icon: slab('pencil'), kind: 'wide' },
  thickness: { name: 'Thickness', icon: duo('sliders'), kind: 'wide' },
  width0: { name: 'Base width', icon: duo('sliders'), kind: 'wide' },
  width1: { name: 'Tip width', icon: duo('sliders'), kind: 'wide' },
  'reset-shape': { name: 'Reset shape', icon: duo('rotate-left'), kind: 'button' },
  bone: { name: 'Bone', icon: duo('bone'), kind: 'button' },
  extend: { name: 'Extend', icon: duo('arrow-up-right'), kind: 'button' },
  split: { name: 'Split', icon: slab('scissors'), kind: 'button' },
  detach: { name: 'Detach / Reattach', icon: duo('link-slash'), kind: 'button' },
  parent: { name: 'Parent part', icon: duo('sitemap'), kind: 'wide' },
  stand: { name: 'Reset pose', icon: duo('person'), kind: 'button' },
  floor: { name: 'Floor', icon: slab('arrow-down-to-line'), kind: 'button' },
  'keep-floor': { name: 'Keep feet on the floor', icon: duo('square-check'), kind: 'wide' },
  swatches: { name: 'Colors', icon: slab('palette'), kind: 'wide' },
  'scene-colors': { name: 'Colors in the scene', icon: duo('swatchbook'), kind: 'wide' },
  glow: { name: 'Glow', icon: duo('lightbulb'), kind: 'wide' },
  'custom-color': { name: 'Custom color', icon: duo('eye-dropper'), kind: 'button' },
  'color-blend': { name: 'Blend colors', icon: duo('sliders'), kind: 'wide' },
  materials: { name: 'Materials', icon: slab('cloud'), kind: 'wide' },
  'material-params': { name: 'Material settings', icon: duo('sliders'), kind: 'wide' },
  markings: { name: 'Markings', icon: slab('circle'), kind: 'wide' },
  'marking-params': { name: 'Marking settings', icon: duo('sliders'), kind: 'wide' },
  arrange: { name: 'Arrange', icon: duo('arrows-up-down-left-right'), kind: 'pill' },
  pull: { name: 'Pull limbs', icon: duo('hand-back-fist'), kind: 'pill', gizmo: true },
  mirror: { name: 'Mirror', icon: slab('arrow-right-arrow-left'), kind: 'pill' },
  eyes: { name: 'Eyes', icon: slab('eye'), kind: 'own' },
  attach: { name: 'Attach stuff', icon: slab('paperclip'), kind: 'pill' },
  // the scene, not a part: out whether or not anything's picked
  'backdrop-color': { name: 'Backdrop color', icon: slab('image'), kind: 'wide', always: true },
  ground: { name: 'Floor (backdrop)', icon: slab('arrow-down-to-line'), kind: 'wide', always: true },
  'light-turn': { name: 'Lights', icon: duo('sun'), kind: 'wide', always: true },
  ao: { name: 'Ambient occlusion', icon: duo('circle-half-stroke'), kind: 'wide', always: true },
  dof: { name: 'Depth of field', icon: duo('crosshairs'), kind: 'wide', always: true },
  'photo-clear': { name: 'Transparent background', icon: duo('chess-board'), kind: 'wide', always: true },
  photo: { name: 'Take photo', icon: slab('camera'), kind: 'wide', always: true },
  anim: { name: 'Part animation', icon: slab('arrows-rotate'), kind: 'wide' },
  'anim-play': { name: 'Play loop', icon: slab('circle'), kind: 'wide', always: true },
};

interface Sec {
  id: string;
  name: string;
  /** a Slab Duo icon name, from ICONS */
  icon: string;
  color: string;
  place: Place;
  tools: string[];
  /** on the view: just its icon, which opens it */
  fold?: boolean;
  /** made by hand (can be deleted; built-in ones can only be hidden) */
  custom?: boolean;
}
interface Layout {
  sections: Sec[];
  gizmos: Gizmos;
}

/** Section icons: a small toolbox of Slab Duo icons */
const ICONS: [name: string, words: string][] = [
  ['palette', 'color paint art'],
  ['pencil', 'draw write edit shape'],
  ['scissors', 'cut split trim'],
  ['wand-magic-sparkles', 'magic sparkle fun favorite'],
  ['hand', 'shape grab body'],
  ['eye', 'eyes look see'],
  ['face-smile', 'face happy pose'],
  ['camera', 'photo view picture'],
  ['paperclip', 'attach clip stuff'],
  ['gear', 'settings tools options'],
  ['briefcase', 'stuff bag kit toolbox'],
  ['shield', 'armor protect'],
  ['umbrella', 'cover dome'],
  ['cloud', 'soft puffy material'],
  ['expand', 'size scale arrange move'],
  ['arrow-right-arrow-left', 'mirror swap sides'],
  ['arrows-rotate', 'spin turn rotate'],
  ['arrow-down-to-line', 'floor ground down'],
  ['copy', 'duplicate copy'],
  ['trash', 'delete remove'],
  ['trophy', 'star award best'],
  ['image', 'picture backdrop'],
  ['folder', 'files save'],
  ['check', 'done ok tick'],
  ['square', 'shape box'],
  ['circle', 'shape round dot'],
  ['triangle', 'shape point'],
];
const COLORS = ['#ff6b4a', '#f2b21b', '#2f9a68', '#14a596', '#3b82f6', '#8a63d2', '#e0609a', '#a8743f'];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const SECTIONS: Omit<Sec, 'place'>[] = [
  { id: 'plan', name: 'Body plan', icon: 'hand', color: '#c98f5a', tools: ['plan'] },
  { id: 'parts', name: 'Parts', icon: 'square', color: '#f07a32', tools: ['blend', 'seamless', 'worn'] },
  { id: 'part', name: 'This part', icon: 'pencil', color: '#e5823a', tools: ['name', 'draw', 'thickness', 'width0', 'width1', 'reset-shape'] },
  { id: 'grow', name: 'Grow', icon: 'scissors', color: '#d0486a', tools: ['bone', 'extend', 'split', 'detach', 'parent'] },
  { id: 'pose', name: 'Pose', icon: 'face-smile', color: '#e9a51f', tools: ['stand', 'floor', 'keep-floor'] },
  { id: 'color', name: 'Color', icon: 'palette', color: '#a66ad6', tools: ['custom-color', 'swatches', 'scene-colors', 'glow', 'color-blend', 'opacity'] },
  { id: 'material', name: 'Material', icon: 'cloud', color: '#5fa0d8', tools: ['materials', 'material-params'] },
  { id: 'markings', name: 'Markings', icon: 'circle', color: '#d0486a', tools: ['markings', 'marking-params'] },
  { id: 'quick', name: 'Arrange', icon: 'expand', color: '#3b82f6', tools: ['arrange', 'pull'] },
  { id: 'mirror', name: 'Mirror', icon: 'arrow-right-arrow-left', color: '#14a596', tools: ['mirror'] },
  { id: 'eyes', name: 'Eyes', icon: 'eye', color: '#5b6170', tools: ['eyes'] },
  { id: 'attach', name: 'Attach', icon: 'paperclip', color: '#8a8f99', tools: ['attach'] },
  { id: 'backdrop', name: 'Backdrop', icon: 'image', color: '#8a63d2', tools: ['backdrop-color', 'ground', 'light-turn', 'ao', 'dof'], fold: true },
  { id: 'photo', name: 'Photo', icon: 'camera', color: '#3b82f6', tools: ['photo-clear', 'photo'], fold: true },
  { id: 'anim', name: 'Animate this part', icon: 'arrows-rotate', color: '#e0609a', tools: ['anim'] },
  { id: 'loop', name: 'Loop', icon: 'circle', color: '#8a63d2', tools: ['anim-play'] },
];
/** The two tabs differ only in where their sections start out, and in their gizmos */
const DEFAULT_PLACES: Record<Base, Record<string, Place>> = {
  shape: {
    plan: 'side', parts: 'side', part: 'side', grow: 'side', pose: 'side', color: 'hidden', material: 'hidden', markings: 'hidden',
    quick: 'tl', mirror: 'tl', eyes: 'tl', attach: 'tl', backdrop: 'hidden', photo: 'hidden', anim: 'hidden', loop: 'hidden',
  },
  look: {
    plan: 'hidden', parts: 'hidden', part: 'hidden', grow: 'hidden', pose: 'hidden', color: 'side', material: 'side', markings: 'side',
    quick: 'tl', mirror: 'hidden', eyes: 'tl', attach: 'tl', backdrop: 'tr', photo: 'tr', anim: 'hidden', loop: 'hidden',
  },
  animate: {
    plan: 'hidden', parts: 'side', part: 'hidden', grow: 'hidden', pose: 'hidden', color: 'hidden', material: 'hidden', markings: 'hidden',
    quick: 'hidden', mirror: 'tl', eyes: 'hidden', attach: 'hidden', backdrop: 'tr', photo: 'tr', anim: 'side', loop: 'side',
  },
};
const DEFAULT_GIZMOS: Record<Base, Gizmos> = { shape: 'full', look: 'none', animate: 'none' };

/**
 * Guided: the modes become steps, one after another down the rail, each a
 * fixed layout of just its sections (not arranged by hand, not saved).
 */
interface StepDef {
  id: string;
  name: string;
  /** what to do in this step, at the top of the inspector */
  note: string;
  /** the note on a touch screen, where it differs (no Ctrl or Shift) */
  touchNote?: string;
  gizmos: Gizmos;
  /** its sections in the inspector, in order */
  side: string[];
  /** sections on the view's corners */
  corners?: Record<string, Place>;
  /** tools taken out of their own section into another one: tool -> section */
  move?: Record<string, string>;
  /** a button under the note that takes you somewhere (Dress up: to Stuff, to make something) */
  action?: { label: string; to: Tab };
}
export const STEPS: readonly StepDef[] = [
  { id: 'step-plan', name: 'Body plan', gizmos: 'none', side: ['plan'], note: 'Pick a starting skeleton. You can add, cut and redraw every part later.' },
  { id: 'step-draw', name: 'Draw', gizmos: 'part', side: ['part'], corners: { mirror: 'tl' }, note: 'Pick a part, then Draw shape (or double-click the part) and draw its outline: it puffs up like a balloon.' },
  { id: 'step-grow', name: 'Grow & pose', gizmos: 'full', side: ['grow', 'pose', 'parts'], corners: { quick: 'tl', mirror: 'tl' }, note: 'Drag the orange handles to bend joints and the purple ones to slide parts; add, extend or split parts, and choose how smoothly they join.' },
  { id: 'step-face', name: 'Face', gizmos: 'none', side: ['eyes'], note: 'Add eyes: drag them onto the critter, then pick a style and a look.' },
  { id: 'step-color', name: 'Color', gizmos: 'none', side: ['color', 'material', 'markings'], note: 'Click a part (Ctrl-click adds one, Shift-click everything between, Ctrl+A all of them), then pick its colors, material and markings.', touchNote: 'Tap a part (hold one to add it, or use + in the parts list up top), then pick its colors, material and markings.' },
  { id: 'step-dress', name: 'Dress up', gizmos: 'none', side: ['attach'], move: { worn: 'attach' }, note: 'Pick a part, then Attach stuff to put something from My stuff on it. Or make something new.', action: { label: 'Make new stuff ›', to: 'stuff' } },
  { id: 'step-show', name: 'Show off', gizmos: 'none', side: ['backdrop', 'photo'], note: 'Set the scene, frame your critter and take a photo.' },
];
const stepOf = (t: Tab | null) => STEPS.find((s) => s.id === t);
/** In Guided, Stuff (the workbench) is part of Dress up: it opens from there and goes back there */
export const STUFF_STEP = 'step-dress';
export const isStep = (t: Tab | null) => !!stepOf(t);

function stepLayout(st: StepDef): Layout {
  const sections = SECTIONS.map((s): Sec => ({
    ...s,
    tools: s.tools.filter((t) => !st.move?.[t]),
    fold: undefined,
    place: st.side.includes(s.id) ? 'side' : (st.corners?.[s.id] ?? 'hidden'),
  }));
  for (const [tool, to] of Object.entries(st.move ?? {})) sections.find((s) => s.id === to)!.tools.push(tool);
  const rank = (s: Sec) => (st.side.includes(s.id) ? st.side.indexOf(s.id) : st.side.length);
  sections.sort((a, b) => rank(a) - rank(b));
  return { sections, gizmos: st.gizmos };
}
/** each tool's home section, where it goes back to if its own section is deleted */
const HOME = new Map(SECTIONS.flatMap((s) => s.tools.map((t) => [t, s.id] as const)));
const PLACE_NAMES: [Place, string][] = [
  ['side', 'Sidebar'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right'], ['hidden', 'Hidden'],
];
const made = (t: Tab) => tabs.find((o) => o.id === t);
const BASES: readonly Base[] = ['shape', 'look', 'animate'];
const isBase = (t: unknown): t is Base => BASES.includes(t as Base);
const tabName = (t: Tab) => (t === 'shape' ? 'Shape' : t === 'look' ? 'Look' : t === 'animate' ? 'Animate' : (made(t)?.name ?? stepOf(t)?.name ?? 'Tab'));
const baseOf = (t: Tab): Base => (isBase(t) ? t : (made(t)?.base ?? 'shape'));

function defaults(t: Tab): Layout {
  const b = baseOf(t);
  const sections = SECTIONS.map((s) => ({ ...s, tools: [...s.tools], place: DEFAULT_PLACES[b][s.id] }));
  // Animate: the part's motion and the loop come first
  if (b === 'animate') for (const id of ['loop', 'anim']) sections.unshift(...sections.splice(sections.findIndex((s) => s.id === id), 1));
  return { sections, gizmos: DEFAULT_GIZMOS[b] };
}

/** A saved layout, with anything stale dropped and any tool it's missing (new in the app) put back home, where it sits by default. */
function repair(raw: unknown, t: Tab): Layout {
  const d = defaults(t);
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Layout).sections)) return d;
  const r = raw as Layout;
  const seen = new Set<string>();
  const places = new Set(PLACE_NAMES.map(([p]) => p));
  const sections: Sec[] = [];
  for (const s of r.sections) {
    if (!s || typeof s.id !== 'string' || sections.some((o) => o.id === s.id)) continue;
    const builtin = d.sections.find((o) => o.id === s.id);
    if (!builtin && !s.custom) continue;
    const tools = (Array.isArray(s.tools) ? s.tools : []).filter((x) => typeof x === 'string' && TOOLS[x] && !seen.has(x));
    tools.forEach((x) => seen.add(x));
    sections.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 40) : (builtin?.name ?? 'Section'),
      icon: ICONS.some(([n]) => n === s.icon) ? s.icon : (builtin?.icon ?? 'square'),
      color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : (builtin?.color ?? COLORS[0]),
      place: places.has(s.place) ? s.place : (builtin?.place ?? 'side'),
      tools,
      fold: !!s.fold || undefined,
      custom: builtin ? undefined : true,
    });
  }
  for (const b of d.sections) if (!sections.some((s) => s.id === b.id)) sections.push({ ...b, tools: [] });
  for (const id of Object.keys(TOOLS)) {
    if (seen.has(id)) continue;
    const home = sections.find((s) => s.id === HOME.get(id))!;
    // after the nearest tool that comes before it there by default (or before the nearest after it)
    const order = SECTIONS.find((s) => s.id === home.id)!.tools;
    const at = order.indexOf(id);
    const before = order.slice(0, at).reverse().find((o) => home.tools.includes(o));
    const after = order.slice(at + 1).find((o) => home.tools.includes(o));
    const i = before ? home.tools.indexOf(before) + 1 : after ? home.tools.indexOf(after) : home.tools.length;
    home.tools.splice(i, 0, id);
    seen.add(id);
  }
  return { sections, gizmos: ['full', 'part', 'none'].includes(r.gizmos) ? r.gizmos : d.gizmos };
}

// v2: the Studio shell (rail, outliner, inspector) starts everyone on its own defaults
const KEY = 'creature-creator/layout-v2';
let saved: Record<string, unknown> = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
} catch {}
const tabs: TabDef[] = (Array.isArray(saved.tabs) ? (saved.tabs as Partial<TabDef>[]) : []).flatMap((t, i, all) =>
  t && typeof t.id === 'string' && /^t[0-9a-z]+$/.test(t.id) && all.findIndex((o) => o?.id === t.id) === i
    ? [{
        id: t.id,
        name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 24) : 'Tab',
        icon: ICONS.some(([n]) => n === t.icon) ? t.icon! : 'wand-magic-sparkles',
        color: typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
        base: isBase(t.base) ? t.base : 'shape',
      } as TabDef]
    : [],
);
/** Off: the tabs down the rail are just their icons (Shape, Look, Animate and Stuff too) */
let showTabNames = saved.showTabNames !== false;
const toolIds = (raw: unknown) => (Array.isArray(raw) ? (raw as unknown[]).filter((id): id is string => typeof id === 'string' && !!TOOLS[id]) : []);
const layouts: Record<Tab, Layout> = { shape: repair(saved.shape, 'shape'), look: repair(saved.look, 'look'), animate: repair(saved.animate, 'animate') };
for (const t of tabs) layouts[t.id] = repair(saved[t.id], t.id);
for (const st of STEPS) layouts[st.id] = stepLayout(st);
/** options the notice was told never to mention again */
let quietTools = new Set(toolIds(saved.quietTools));
function save() {
  try {
    const own = Object.fromEntries(Object.entries(layouts).filter(([t]) => !isStep(t)));
    localStorage.setItem(KEY, JSON.stringify({ ...own, tabs, showTabNames, quietTools: quietTools.size ? [...quietTools] : undefined }));
  } catch {}
}

let tab: Tab | null = 'shape';
/** A phone (or a tablet held upright): the view's too small for sections on its corners, so they join the sheet, and its sections are tabs (style.css uses the same test) */
const phone = matchMedia('(max-width: 760px), (max-width: 1100px) and (orientation: portrait)');
/** fingers, not a mouse: no Ctrl or Shift to hold */
const touch = matchMedia('(pointer: coarse)');
/** the section tab open on a phone, per tab (or step) */
const openSec: Record<string, string> = {};
let idle = false;
let editing = false;
const tools = new Map<string, HTMLElement>();
/** canvas sections folded into a button that are open right now */
const opened = new Set<string>();
let onGizmos = () => {};
let onTabs = () => {};
let switchTo = (_t: Tab) => {};
/** back to Dress up from Stuff, with the list of things to put on open */
let putOn = () => {};

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const secIcon = (s: Pick<Sec, 'icon' | 'color'>) => `<i class="${slab(s.icon)} ck-ic" style="--ic:${s.color}" aria-hidden="true"></i>`;
const layout = () => layouts[tab!];
const find = (id: string) => layout().sections.find((s) => s.id === id);

/** The handles for shaping and posing in the tab that's open: every part's, the picked part's, or none. */
export function gizmos(): Gizmos {
  return tab ? layouts[tab].gizmos : 'none';
}

export function setLayoutTab(t: Tab | null) {
  if (t === tab) return;
  tab = t;
  if (!t) editing = false;
  closePops();
  render();
}

/** The right-click menu on the tabs along the top: their names and icons, or just icons. */
export function tabNamesMenu(): MenuItem[] {
  const set = (on: boolean) => {
    showTabNames = on;
    save();
    renderTabs();
  };
  return [
    { label: 'Icons and names', checked: showTabNames, run: () => set(true) },
    { label: 'Just icons', checked: !showTabNames, run: () => set(false) },
  ];
}

const GUIDED_KEY = 'creature-creator/guided';
/** Guided: the rail shows the steps; and the step last open there, and the mode last open in Free */
let guided = { on: false, step: STEPS[0].id, free: 'shape' as Tab };
try {
  const g = JSON.parse(localStorage.getItem(GUIDED_KEY) ?? '{}');
  guided = { on: g.on === true, step: stepOf(g.step) ? g.step : STEPS[0].id, free: typeof g.free === 'string' && !isStep(g.free) ? g.free : 'shape' };
} catch {}
function saveGuided() {
  try {
    localStorage.setItem(GUIDED_KEY, JSON.stringify(guided));
  } catch {}
}
export function guidedOn(): boolean {
  return guided.on;
}
/** Where Guided (or Free) opens: the step (or mode) last open there. */
export function guidedTab(on = guided.on): Tab {
  return on ? guided.step : guided.free;
}
/** Remember the step (or mode) just opened, for coming back to Guided (or Free). */
export function noteTab(t: Tab) {
  if (isStep(t)) guided.step = t;
  else guided.free = t;
  saveGuided();
}
export function setGuided(on: boolean) {
  guided.on = on;
  saveGuided();
  $('#app').classList.toggle('guided', on);
}

/** The tabs people made, in order along the top. */
export function customTabs(): readonly { id: string; name: string; color: string }[] {
  return tabs;
}

export function setLayoutIdle(v: boolean) {
  if (v === idle) return;
  idle = v;
  sync();
}

export function initLayout(opts: { onGizmos: () => void; onTabs: () => void; switchTo: (t: Tab) => void; putOn: () => void }) {
  onGizmos = opts.onGizmos;
  onTabs = opts.onTabs;
  switchTo = opts.switchTo;
  putOn = opts.putOn;
  renderTabs();
  for (const w of document.querySelectorAll<HTMLElement>('.ck-tool')) {
    const id = w.dataset.tool!;
    const d = TOOLS[id];
    if (!d) continue;
    w.dataset.kind = d.kind;
    // what it shows as while arranging: a name to drag around
    const chip = el('span', 'ck-chip', `${fa('fa-duotone fa-regular fa-grip-dots-vertical ck-grab')}${fa(d.icon)}<span>${esc(d.name)}</span>`);
    chip.title = 'Drag to another section, the sidebar, or a corner of the view';
    chip.addEventListener('pointerdown', (e) => startDrag(e, 'tool', id, chip));
    w.append(chip);
    tools.set(id, w);
  }
  for (const [p, name] of PLACE_NAMES) {
    const c = container(p);
    c.dataset.place = p;
    c.dataset.label = name;
  }
  // a tool that hides itself (no eyes yet, nothing worn) leaves no empty section behind
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  }).observe($('#app'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  $('#ck-menu-btn').onclick = (e) => {
    e.stopPropagation();
    if (menu) closePops();
    else openMenu();
  };
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.ck-pop, #ck-menu-btn, .ck-icon-btn')) closePops();
    // a folded section closes when you go on with something else
    if (opened.size && !t.closest('.ck-folded')) {
      opened.clear();
      for (const s of document.querySelectorAll('.ck-sec.ck-open')) s.classList.remove('ck-open');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (menu || picker)) closePops();
    else if (e.key === 'Escape' && editing && !(e.target as HTMLElement).closest('input')) setEditing(false);
  });
  phone.addEventListener('change', () => render());
  render();
  const missing = noticeTools();
  if (missing.length) showUpdateNotice(missing);
}

function container(p: Place): HTMLElement {
  if (p === 'side') return $('#ck-side');
  if (p === 'hidden') return $('#ck-hidden');
  return $(`.ck-dock[data-corner="${p}"]`);
}

// ---------------------------------------------------------------------------
// drawing the layout

/** The made tabs' buttons on the rail, between Animate and Stuff; and whether the tabs show their names. */
function renderTabs() {
  const modes = $('.modes');
  modes.querySelectorAll('.ck-tab').forEach((b) => b.remove());
  const stuff = modes.querySelector('[data-mode="stuff"]');
  for (const t of tabs) {
    const b = el('button', 'ck-tab', `${tabIcon(t)}<span class="lbl"> ${esc(t.name)}</span>`);
    b.dataset.mode = t.id;
    const key = tabs.indexOf(t) + 5;
    b.title = key <= 9 ? `${t.name} (${key})` : t.name;
    b.classList.toggle('active', t.id === tab);
    modes.insertBefore(b, stuff);
  }
  // Guided's steps, numbered, after the modes (only one set shows: see #app.guided)
  modes.querySelectorAll('.ck-step').forEach((b) => b.remove());
  STEPS.forEach((st, i) => {
    const b = el('button', 'ck-step', `<span class="step-num">${i + 1}</span><span class="lbl"> ${esc(st.name)}</span>`);
    b.dataset.mode = st.id;
    b.title = `Step ${i + 1}: ${st.name}`;
    b.classList.toggle('active', st.id === tab);
    modes.append(b);
  });
  $('#app').classList.toggle('tab-icons', !showTabNames);
  onTabs();
}
const tabIcon = (t: Pick<TabDef, 'icon' | 'color'>) => `<i class="${slab(t.icon)} ck-ic" style="--ic:${t.color}" aria-hidden="true"></i>`;

/** In a step: what to do, at the top of the inspector, and Back / Next at the bottom. */
function renderStep() {
  const st = stepOf(tab);
  // Stuff from Guided: making something for Dress up
  const making = !tab && guided.on;
  const note = $('#step-note');
  const foot = $('#step-foot');
  note.hidden = foot.hidden = !st && !making;
  const action = $<HTMLButtonElement>('#step-action');
  action.hidden = !st?.action;
  if (st?.action) {
    action.textContent = st.action.label;
    action.onclick = () => switchTo(st.action!.to);
  }
  const back = $<HTMLButtonElement>('#step-back');
  const next = $<HTMLButtonElement>('#step-next');
  renderStepBar(st, making);
  if (making) {
    $('#step-text').textContent = 'Making stuff for Dress up: draw pieces on the board. The blue cross is where it sits on a part. It’s kept in My stuff as you go.';
    back.hidden = next.hidden = false;
    back.textContent = '‹ Back to Dress up';
    back.onclick = () => switchTo(STUFF_STEP);
    next.textContent = 'Put it on ›';
    next.onclick = putOn;
    return;
  }
  if (!st) return;
  $('#step-text').textContent = (touch.matches && st.touchNote) || st.note;
  const i = STEPS.indexOf(st);
  back.hidden = i === 0;
  next.hidden = i === STEPS.length - 1;
  if (i > 0) {
    back.textContent = `‹ ${STEPS[i - 1].name}`;
    back.onclick = () => switchTo(STEPS[i - 1].id);
  }
  if (i < STEPS.length - 1) {
    next.textContent = `Next: ${STEPS[i + 1].name} ›`;
    next.onclick = () => switchTo(STEPS[i + 1].id);
  }
}

/** Guided on a phone: the rail along the bottom is one step at a time, with dots for where you are. */
function renderStepBar(st: StepDef | undefined, making: boolean) {
  const at = making ? STEPS.findIndex((o) => o.id === STUFF_STEP) : st ? STEPS.indexOf(st) : -1;
  if (at < 0) return;
  const back = $<HTMLButtonElement>('#sb-back');
  const next = $<HTMLButtonElement>('#sb-next');
  $('#sb-label').textContent = making ? 'Dress up · making stuff' : `Step ${at + 1} of ${STEPS.length} · ${STEPS[at].name}`;
  $('#sb-dots').replaceChildren(...STEPS.map((o, i) => {
    const d = el('span', i === at ? 'on' : i < at ? 'done' : '');
    d.title = o.name;
    return d;
  }));
  back.disabled = !making && at === 0;
  back.title = making ? 'Back to Dress up' : at > 0 ? `Back: ${STEPS[at - 1].name}` : '';
  back.onclick = () => switchTo(making ? STUFF_STEP : STEPS[at - 1].id);
  next.hidden = !making && at === STEPS.length - 1;
  next.textContent = making ? 'Put it on \u203a' : 'Next \u203a';
  next.title = making ? 'Back to Dress up, to put it on' : at < STEPS.length - 1 ? `Next: ${STEPS[at + 1].name}` : '';
  next.onclick = making ? putOn : () => switchTo(STEPS[at + 1].id);
}

function render() {
  renderStep();
  const pool = $('#ck-pool');
  for (const w of tools.values()) pool.append(w);
  for (const [p] of PLACE_NAMES) container(p).replaceChildren();
  document.body.classList.toggle('ck-editing', editing);
  renderBanner();
  // (Stuff isn't arranged; the view cube is the view's own, not a section)
  if (!tab) return sync();
  const tray = container('hidden');
  tray.append(el('div', 'ck-tray-title', 'Hidden <span class="muted">· drop sections here to hide them</span>'));
  // on a phone the corners' sections come after the sheet's own (unless they're being arranged)
  const onPhone = phone.matches && !editing;
  const placeOf = (s: Sec): Place => (onPhone && s.place !== 'hidden' ? 'side' : s.place);
  const sections = layout().sections;
  for (const s of [...sections.filter((o) => o.place === 'side'), ...sections.filter((o) => o.place !== 'side')]) {
    const e = sectionEl(s, placeOf(s));
    container(placeOf(s)).append(e);
  }
  renderSecTabs();
  sync();
}

function sectionEl(s: Sec, place = s.place): HTMLElement {
  const canvas = place !== 'side' && place !== 'hidden';
  const sec = el('section', 'ck-sec');
  sec.dataset.sec = s.id;
  sec.classList.toggle('ck-folded', canvas && !!s.fold);
  sec.classList.toggle('ck-open', opened.has(s.id));

  // arranging: grip, icon, name, where it goes
  const head = el('div', 'ck-head');
  const grip = el('button', 'ck-grip piece-icon', fa(duo('grip-dots-vertical')));
  grip.title = 'Drag this section somewhere else';
  grip.setAttribute('aria-label', 'Move section');
  grip.addEventListener('pointerdown', (e) => startDrag(e, 'sec', s.id, grip));
  const icon = el('button', 'ck-icon-btn piece-icon', secIcon(s));
  icon.title = 'Pick an icon and color';
  icon.onclick = () =>
    openPicker(s, icon, s.id, () => {
      icon.innerHTML = secIcon(s);
      const title = document.querySelector(`.ck-sec[data-sec="${s.id}"] .ck-fold-btn`);
      if (title) title.innerHTML = `${secIcon(s)} ${esc(s.name)}`;
    });
  const name = el('input', 'text ck-name') as HTMLInputElement;
  name.value = s.name;
  name.maxLength = 40;
  name.title = 'Rename this section';
  name.onchange = () => {
    s.name = name.value.trim() || s.name;
    name.value = s.name;
    save();
  };
  name.onkeydown = (e) => {
    // (a block, not an expression: an on-handler returning false would cancel every other key)
    if (e.key === 'Enter') name.blur();
  };
  const where = el('select', 'ck-place') as HTMLSelectElement;
  where.title = 'Where this section goes';
  where.innerHTML = PLACE_NAMES.map(([p, n]) => `<option value="${p}"${p === s.place ? ' selected' : ''}>${n}</option>`).join('');
  where.onchange = () => moveSection(s.id, where.value as Place, null);
  head.append(grip, icon, name, where);
  if (canvas) {
    const fold = el('button', 'ck-fold piece-icon' + (s.fold ? ' on' : ''), fa(duo(s.fold ? 'square-chevron-down' : 'square-minus')));
    fold.title = s.fold ? 'Show the whole section' : 'Fold into one button that opens it';
    fold.onclick = () => {
      s.fold = !s.fold || undefined;
      save();
      render();
    };
    head.append(fold);
  }
  if (s.custom) {
    const del = el('button', 'piece-icon', fa(slab('trash')));
    del.title = 'Delete this section (its tools go back where they came from)';
    del.onclick = () => deleteSection(s.id);
    head.append(del);
  }

  const title = el('h3', 'ck-title', esc(s.name));
  const foldBtn = el('button', 'pill-toggle ck-fold-btn', `${secIcon(s)} ${esc(s.name)}`);
  foldBtn.onclick = () => {
    const open = sec.classList.toggle('ck-open');
    if (open) opened.add(s.id);
    else opened.delete(s.id);
  };
  const body = el('div', 'ck-body');
  for (const id of s.tools) body.append(tools.get(id)!);
  body.append(el('p', 'ck-empty-note muted small', 'Drag tools here'));
  sec.append(head, title, foldBtn, body);
  return sec;
}

/** Which tools have anything to show right now, and so which sections do. */
function sync() {
  const g = gizmos();
  for (const [id, w] of tools) {
    const d = TOOLS[id];
    const own = [...w.children].filter((c) => !c.classList.contains('ck-chip')) as HTMLElement[];
    w.classList.toggle('ck-off', (idle && !d.always) || (!!d.gizmo && g === 'none') || own.every((c) => c.hidden));
  }
  for (const sec of document.querySelectorAll<HTMLElement>('.ck-sec')) {
    const live = [...sec.querySelectorAll<HTMLElement>(':scope > .ck-body > .ck-tool')].filter((t) => !t.classList.contains('ck-off'));
    sec.classList.toggle('ck-empty', !live.length);
    sec.classList.toggle('ck-carded', live.some((t) => t.dataset.kind === 'wide'));
  }
  // a step's layout is fixed: nothing to arrange or bring back
  $('#ck-menu-btn').hidden = !tab || isStep(tab);
  syncSecTabs();
}

/** On a phone: a tab per section in the sheet (only one shows at a time). */
function renderSecTabs() {
  const row = $('#sec-tabs');
  row.replaceChildren();
  if (!tab) return;
  for (const sec of document.querySelectorAll<HTMLElement>('#ck-side > .ck-sec')) {
    const s = find(sec.dataset.sec!);
    if (!s) continue;
    const b = el('button', 'sec-tab', esc(s.name));
    b.dataset.sec = s.id;
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      openSec[tab!] = s.id;
      syncSecTabs();
    };
    row.append(b);
  }
}
function syncSecTabs() {
  const row = $('#sec-tabs');
  const live = [...document.querySelectorAll<HTMLElement>('#ck-side > .ck-sec:not(.ck-empty)')].map((e) => e.dataset.sec!);
  const on = tab && live.includes(openSec[tab]) ? openSec[tab] : live[0];
  for (const b of row.querySelectorAll<HTMLButtonElement>('.sec-tab')) {
    b.hidden = !live.includes(b.dataset.sec!);
    b.classList.toggle('active', b.dataset.sec === on);
    b.setAttribute('aria-selected', String(b.dataset.sec === on));
  }
  // one section: no tabs, just it
  row.hidden = live.length < 2;
  for (const sec of document.querySelectorAll<HTMLElement>('#ck-side > .ck-sec')) sec.classList.toggle('sec-on', sec.dataset.sec === on);
}

function renderBanner() {
  const b = $('#ck-banner');
  b.hidden = !editing || !tab;
  if (b.hidden) return b.replaceChildren();
  const t = made(tab!);
  b.innerHTML = `<div class="ck-banner-text"><b>Arranging ${t ? 'this tab' : tabName(tab!)}</b>
    <span class="muted small">Drag tools and sections around. Drop one on a corner of the view to pin it there.</span></div>`;
  // a made tab: its name and icon
  if (t) {
    const own = el('div', 'ck-tab-row');
    const icon = el('button', 'ck-icon-btn piece-icon', tabIcon(t));
    icon.title = 'Pick an icon and color for this tab';
    icon.onclick = () =>
      openPicker(t, icon, t.id, () => {
        icon.innerHTML = tabIcon(t);
        renderTabs();
      });
    const name = el('input', 'text ck-tab-name') as HTMLInputElement;
    name.value = t.name;
    name.maxLength = 24;
    name.title = 'Rename this tab';
    name.oninput = () => {
      t.name = name.value.trim() || t.name;
      save();
      renderTabs();
    };
    name.onchange = () => (name.value = t.name);
    name.onkeydown = (e) => {
      // (a block, not an expression: an on-handler returning false would cancel every other key)
      if (e.key === 'Enter') name.blur();
    };
    own.append(icon, name);
    b.append(own);
  }
  const row = el('div', 'ck-banner-actions');
  const add = el('button', 'ghost', `${fa(duo('plus'))} New section`);
  add.onclick = () => newSection('side', []);
  const done = el('button', 'primary slim', `${fa(slab('check'))} Done`);
  done.onclick = () => setEditing(false);
  row.append(add, done);
  b.append(row);
}

function setEditing(on: boolean) {
  editing = on && !!tab && !isStep(tab);
  closePops();
  render();
}

// ---------------------------------------------------------------------------
// changing the layout

function moveSection(id: string, place: Place, before: string | null) {
  const L = layout();
  const i = L.sections.findIndex((s) => s.id === id);
  if (i < 0) return;
  const [s] = L.sections.splice(i, 1);
  s.place = place;
  const j = before ? L.sections.findIndex((o) => o.id === before) : -1;
  if (j >= 0) L.sections.splice(j, 0, s);
  else L.sections.push(s);
  save();
  render();
}

function takeTool(id: string) {
  for (const s of layout().sections) s.tools = s.tools.filter((t) => t !== id);
}

function moveTool(id: string, secId: string, before: string | null) {
  takeTool(id);
  const s = find(secId)!;
  const j = before ? s.tools.indexOf(before) : -1;
  if (j >= 0) s.tools.splice(j, 0, id);
  else s.tools.push(id);
  save();
  render();
}

function newSection(place: Place, toolIds: string[], before: string | null = null) {
  for (const t of toolIds) takeTool(t);
  const name = toolIds.length === 1 ? TOOLS[toolIds[0]].name : 'New section';
  const s: Sec = { id: 'c' + Date.now().toString(36), name, icon: pick(ICONS)[0], color: pick(COLORS), place, tools: toolIds, custom: true };
  const L = layout();
  const j = before ? L.sections.findIndex((o) => o.id === before) : -1;
  if (j >= 0) L.sections.splice(j, 0, s);
  else L.sections.push(s);
  save();
  render();
  if (!toolIds.length) {
    const input = document.querySelector<HTMLInputElement>(`.ck-sec[data-sec="${s.id}"] .ck-name`);
    input?.scrollIntoView({ block: 'nearest' });
    input?.select();
  }
}

function deleteSection(id: string) {
  const L = layout();
  const s = find(id);
  if (!s?.custom) return;
  L.sections = L.sections.filter((o) => o !== s);
  for (const t of s.tools) find(HOME.get(t)!)!.tools.push(t);
  save();
  render();
}

/** What the notice mentions: tools no tab shows (new ones go where they sit by default, so only ones hidden away), unless told not to */
function noticeTools(): string[] {
  const shown = new Set(Object.entries(layouts).filter(([t]) => !isStep(t)).flatMap(([, L]) => L.sections.filter((s) => s.place !== 'hidden').flatMap((s) => s.tools)));
  return Object.keys(TOOLS).filter((id) => !shown.has(id) && !quietTools.has(id));
}

/** Options missing from the tabs (from an update, or a change made to them): stays until closed; × brings it back next time. */
function showUpdateNotice(missing: string[]) {
  const box = document.querySelector('.toasts') ?? document.body.appendChild(el('div', 'toasts'));
  const names = missing.map((id) => TOOLS[id].name);
  const card = el(
    'div',
    'toast update-toast',
    `<span class="toast-icon">${fa('fa-solid fa-wand-magic-sparkles')}</span>
    <span class="toast-text">
      <span class="toast-kicker">${fa('fa-solid fa-sliders')} Your tabs</span>
      <span class="toast-title">${names.length > 1 ? 'Some options aren’t' : 'An option isn’t'} showing in your tabs</span>
      <span class="toast-desc"><b>${names.map(esc).join(', ')}</b>: new in a recent update, or tucked away by a change to your tabs</span>
      <span class="update-actions">
        <button class="primary slim" data-act="reset">Reset Tabs to show all options</button>
        <button class="ghost" data-act="forever">Dismiss this for ${names.length > 1 ? `these ${names.length} options` : esc(names[0])}</button>
      </span>
    </span>
    <button class="pop-close update-close" data-act="close" title="Close (it'll be back next time)" aria-label="Close">${fa(duo('xmark'))}</button>`,
  );
  card.setAttribute('role', 'status');
  const leave = () => {
    card.classList.add('leaving');
    card.addEventListener('animationend', () => card.remove(), { once: true });
    setTimeout(() => card.remove(), 600);
  };
  card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
    b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'reset') {
        // Shape and Look back to how they start out (keeping which handles show)
        for (const t of BASES) layouts[t] = { ...defaults(t), gizmos: layouts[t].gizmos };
        quietTools.clear();
        closePops();
        render();
        onGizmos();
      }
      if (act === 'forever') for (const id of missing) quietTools.add(id);
      if (act !== 'close') save();
      leave();
    };
  });
  box.append(card);
}

function resetTab() {
  const back = made(tab!) ? `the way ${tabName(baseOf(tab!))} starts out` : 'the way it started';
  if (!tab || !confirm(`Put the ${tabName(tab)} tab back ${back}? Sections you made for it go.`)) return;
  layouts[tab] = defaults(tab);
  // the tabs notice can mention anything this hid again
  quietTools.clear();
  save();
  closePops();
  render();
  onGizmos();
}

/** Shape's, Look's and Stuff's own icons: a new tab starts with another */
const BUILTIN_TAB_ICONS = new Set(['hand', 'palette', 'briefcase']);

/** A new tab, starting as a copy of this one; open, and being arranged, with its name ready to type. */
function newTab() {
  const from = tab!;
  const t: TabDef = { id: 't' + Date.now().toString(36), name: `Tab ${tabs.length + 1}`, icon: pick(ICONS.filter(([n]) => !BUILTIN_TAB_ICONS.has(n)))[0], color: pick(COLORS), base: baseOf(from) };
  tabs.push(t);
  layouts[t.id] = structuredClone(layout());
  save();
  closePops();
  renderTabs();
  editing = true;
  switchTo(t.id);
  document.querySelector<HTMLInputElement>('.ck-tab-name')?.select();
}

function deleteTab() {
  const t = made(tab!);
  if (!t || !confirm(`Delete the "${t.name}" tab and its layout?`)) return;
  tabs.splice(tabs.indexOf(t), 1);
  delete layouts[t.id];
  save();
  closePops();
  editing = false;
  renderTabs();
  switchTo('shape');
}

function setGizmos(g: Gizmos) {
  layout().gizmos = g;
  save();
  sync();
  onGizmos();
}

/**
 * The right-click menu's Arrange choices for the section (and tool) `at` is
 * in: where the section goes, hiding it, or arranging by dragging. Null when
 * it isn't in one (or the tab has no layout: Stuff).
 */
export function arrangeMenu(at: HTMLElement): MenuItem | null {
  const secEl = at.closest<HTMLElement>('.ck-sec');
  const s = tab && !isStep(tab) && secEl ? find(secEl.dataset.sec!) : undefined;
  if (!s) return null;
  const toolId = at.closest<HTMLElement>('.ck-tool')?.dataset.tool;
  const canvas = s.place !== 'side' && s.place !== 'hidden';
  const sub: MenuItem[] = [
    { label: 'Drag to arrange…', icon: duo('grip-dots-vertical'), checked: editing || undefined, run: () => setEditing(!editing) },
    ...PLACE_NAMES.filter(([p]) => p !== 'hidden').map(([p, name]): MenuItem => ({
      label: name,
      checked: s.place === p,
      run: () => moveSection(s.id, p, null),
    })),
    { label: `Hide “${s.name}”`, icon: duo('eye-slash'), run: () => moveSection(s.id, 'hidden', null) },
  ];
  if (canvas) sub.push({ label: s.fold ? 'Show the whole section' : 'Fold into one button', icon: duo(s.fold ? 'square-chevron-down' : 'square-minus'), run: () => {
    s.fold = !s.fold || undefined;
    save();
    render();
  } });
  // one tool on its own: tucked away in a hidden section of its own, like dropping it on the Hidden tray
  if (toolId && s.tools.length > 1) sub.push({ label: `Hide just “${TOOLS[toolId].name}”`, icon: duo('eye-slash'), run: () => newSection('hidden', [toolId]) });
  return { label: 'Arrange', icon: duo('arrows-up-down-left-right'), sub };
}

// ---------------------------------------------------------------------------
// dragging tools and sections

type Target =
  | { kind: 'tool'; sec: string; before: string | null }
  | { kind: 'sec'; place: Place; before: string | null }
  | { kind: 'new'; place: Place };

let drag: {
  what: 'tool' | 'sec';
  id: string;
  x0: number;
  y0: number;
  from: HTMLElement;
  ghost?: HTMLElement;
  mark?: HTMLElement;
  over?: HTMLElement;
  target?: Target | null;
  /** where the pointer is, for scrolling a crowded corner (or the sidebar) while held near its edge */
  x?: number;
  y?: number;
  scrolling?: number;
} | null = null;

function startDrag(e: PointerEvent, what: 'tool' | 'sec', id: string, from: HTMLElement) {
  if (!editing || e.button !== 0) return;
  e.preventDefault();
  drag = { what, id, x0: e.clientX, y0: e.clientY, from };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function moveDrag(e: PointerEvent) {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    const label = drag.what === 'tool' ? drag.from.innerHTML : `${secIcon(find(drag.id)!)} ${esc(find(drag.id)!.name)}`;
    drag.ghost = el('div', 'ck-ghost', label);
    drag.mark = el('div', 'ck-mark');
    document.body.append(drag.ghost, drag.mark);
    (drag.what === 'tool' ? tools.get(drag.id)! : drag.from.closest('.ck-sec')!).classList.add('ck-lifted');
    document.body.classList.add('ck-dragging');
  }
  drag.ghost.style.translate = `${e.clientX + 10}px ${e.clientY + 6}px`;
  drag.target = targetAt(e.clientX, e.clientY);
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.scrolling ??= requestAnimationFrame(edgeScroll);
}

/** Where a drop at (x, y) would go, with the blue line (or outline) showing it. */
function targetAt(x: number, y: number): Target | null {
  const d = drag!;
  const mark = d.mark!;
  mark.hidden = true;
  d.over?.classList.remove('ck-over');
  d.over = undefined;
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!hit) return null;
  const line = (r: DOMRect, top: number) => {
    mark.hidden = false;
    Object.assign(mark.style, { left: `${r.left}px`, top: `${top - 2}px`, width: `${r.width}px` });
  };
  const outline = (c: HTMLElement) => {
    d.over = c;
    c.classList.add('ck-over');
  };
  const holder = hit.closest<HTMLElement>('#ck-side, #ck-hidden, .ck-dock') ?? (hit.closest('.panel') ? container('side') : null);
  if (!holder) return null;
  const place = holder.dataset.place as Place;
  const sec = hit.closest<HTMLElement>('.ck-sec');

  if (d.what === 'tool') {
    if (sec) {
      const body = sec.querySelector<HTMLElement>(':scope > .ck-body')!;
      const rows = [...body.querySelectorAll<HTMLElement>(':scope > .ck-tool')].filter((t) => t.dataset.tool !== d.id);
      const next = rows.find((t) => {
        const r = t.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      const br = body.getBoundingClientRect();
      if (next) line(br, next.getBoundingClientRect().top - 2);
      else line(br, rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom + 2 : br.top + br.height / 2);
      return { kind: 'tool', sec: sec.dataset.sec!, before: next?.dataset.tool ?? null };
    }
    outline(holder);
    return { kind: 'new', place };
  }
  const others = [...holder.querySelectorAll<HTMLElement>(':scope > .ck-sec')].filter((s) => s.dataset.sec !== d.id);
  const next = others.find((s) => {
    const r = s.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  const hr = holder.getBoundingClientRect();
  if (next) line(hr, next.getBoundingClientRect().top - 4);
  else if (others.length) line(hr, others[others.length - 1].getBoundingClientRect().bottom + 4);
  else outline(holder);
  return { kind: 'sec', place, before: next?.dataset.sec ?? null };
}

/** Held near the top or bottom of a scrolling corner or the sidebar: scroll it, faster nearer the edge. */
function edgeScroll() {
  const d = drag;
  if (!d?.ghost) return;
  const hit = document.elementFromPoint(d.x!, d.y!);
  const box = hit?.closest<HTMLElement>('.ck-dock, .panel');
  if (box && box.scrollHeight > box.clientHeight + 1) {
    const r = box.getBoundingClientRect();
    const edge = 36;
    const dy = d.y! < r.top + edge ? -(r.top + edge - d.y!) : d.y! > r.bottom - edge ? d.y! - (r.bottom - edge) : 0;
    if (dy) {
      box.scrollTop += dy / 3;
      d.target = targetAt(d.x!, d.y!);
    }
  }
  d.scrolling = requestAnimationFrame(edgeScroll);
}

function endDrag() {
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  const d = drag;
  drag = null;
  if (d?.scrolling) cancelAnimationFrame(d.scrolling);
  if (!d?.ghost) return;
  d.ghost.remove();
  d.mark?.remove();
  d.over?.classList.remove('ck-over');
  document.body.classList.remove('ck-dragging');
  document.querySelector('.ck-lifted')?.classList.remove('ck-lifted');
  const t = d.target;
  if (!t) return;
  if (d.what === 'sec' && t.kind === 'sec') moveSection(d.id, t.place, t.before);
  else if (d.what === 'tool' && t.kind === 'tool') moveTool(d.id, t.sec, t.before);
  else if (d.what === 'tool' && t.kind === 'new') newSection(t.place, [d.id]);
}

// ---------------------------------------------------------------------------
// the … menu and the icon picker

let menu: HTMLElement | null = null;
let picker: HTMLElement | null = null;

function closePops() {
  menu?.remove();
  picker?.remove();
  menu = picker = null;
  $('#ck-menu-btn').classList.remove('on');
}

/** A small popup beside `anchor`, kept on screen. */
function popAt(pop: HTMLElement, anchor: HTMLElement) {
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const x = Math.min(Math.max(8, r.right - w), innerWidth - w - 8);
  const below = r.bottom + 6;
  const y = below + h < innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
}

function openMenu() {
  if (!tab) return;
  closePops();
  const L = layout();
  menu = el('div', 'popover ck-pop ck-menu');
  menu.append(el('div', 'pop-title', esc(made(tab) ? tabName(tab) : `${tabName(tab)} tab`)));
  menu.append(el('div', 'pop-sub', 'Gizmos'));
  const seg = el('div', 'seg');
  for (const [g, label, tip] of [
    ['full', 'Full', 'Handles on every part'],
    ['part', 'Selected part', 'Handles only on the part you picked'],
    ['none', 'None', 'No handles: just click parts to pick them'],
  ] as const) {
    const b = el('button', g === L.gizmos ? 'active' : '', label);
    b.title = tip;
    b.onclick = () => {
      setGizmos(g);
      seg.querySelectorAll('button').forEach((o) => o.classList.toggle('active', o === b));
    };
    seg.append(b);
  }
  menu.append(seg);

  const hidden = L.sections.filter((s) => s.place === 'hidden');
  menu.append(el('div', 'pop-sub', 'Hidden sections'));
  if (!hidden.length) menu.append(el('p', 'muted small', 'Nothing hidden.'));
  const list = el('div', 'ck-hidden-list');
  for (const s of hidden) {
    const row = el('button', 'ck-menu-row', `${secIcon(s)}<span>${esc(s.name)}</span>${fa(duo('plus'))}`);
    row.title = 'Show this section at the bottom of the sidebar';
    row.onclick = () => {
      moveSection(s.id, 'side', null);
      openMenu();
    };
    list.append(row);
  }
  menu.append(list);
  const arrange = el('button', 'ghost wide', `${fa(duo('grip-dots-vertical'))} ${editing ? 'Stop arranging' : 'Arrange this tab…'}`);
  arrange.title = 'Move tools between sections, pin sections to the view, make your own';
  arrange.onclick = () => setEditing(!editing);
  menu.append(arrange);

  menu.append(el('div', 'pop-sub', 'Tabs'));
  const add = el('button', 'ghost wide', `${fa(duo('plus'))} New tab from this one`);
  add.title = 'A tab of your own along the top, starting as a copy of this one';
  add.onclick = newTab;
  const names = el('label', 'check', `<input type="checkbox"${showTabNames ? ' checked' : ''} /> Show tab names`);
  names.title = 'Off: the tabs along the top are just their icons';
  names.querySelector('input')!.onchange = (e) => {
    showTabNames = (e.target as HTMLInputElement).checked;
    save();
    renderTabs();
  };
  menu.append(add, names);
  const links = el('div', 'ck-menu-links');
  const reset = el('button', 'link', 'Reset this tab');
  reset.onclick = resetTab;
  links.append(reset);
  if (made(tab)) {
    const del = el('button', 'link', 'Delete this tab');
    del.onclick = deleteTab;
    links.append(del);
  }
  menu.append(links);
  popAt(menu, $('#ck-menu-btn'));
  $('#ck-menu-btn').classList.add('on');
}

/** Icon and color for a section or a tab (`key` names it, so a second click on the same one closes the picker). */
/** the colors in use in the scene (main.ts), offered under the icon color too */
let sceneColors: () => string[] = () => [];
export function setSceneColors(fn: () => string[]) {
  sceneColors = fn;
}

function openPicker(s: { icon: string; color: string }, anchor: HTMLElement, key: string, changed: () => void) {
  const again = picker?.dataset.key === key;
  closePops();
  if (again) return;
  picker = el('div', 'popover ck-pop ck-picker');
  picker.dataset.key = key;
  const search = el('input', 'text wide') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search icons';
  const grid = el('div', 'ck-icon-grid');
  const update = () => {
    changed();
    save();
    fill();
  };
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren();
    for (const [n, words] of ICONS) {
      if (q && !`${n} ${words}`.includes(q)) continue;
      const b = el('button', 'piece-icon' + (n === s.icon ? ' active' : ''), secIcon({ icon: n, color: s.color }));
      b.title = n.replace(/-/g, ' ');
      b.onclick = () => {
        s.icon = n;
        update();
      };
      grid.append(b);
    }
    if (!grid.children.length) grid.append(el('p', 'muted small', 'No icons match.'));
  };
  search.oninput = fill;
  const colors = el('div', 'swatches ck-colors');
  for (const c of COLORS) {
    const b = el('button', c === s.color ? 'active' : '');
    b.style.background = c;
    b.title = 'Icon color';
    b.onclick = () => {
      s.color = c;
      colors.querySelectorAll('button').forEach((o) => o.classList.toggle('active', o === b));
      update();
    };
    colors.append(b);
  }
  const custom = el('label', 'color-pick', '<input type="color" /> Custom');
  const ci = custom.querySelector('input')!;
  ci.value = s.color;
  ci.oninput = () => {
    s.color = ci.value;
    colors.querySelectorAll('button').forEach((o) => o.classList.remove('active'));
    update();
  };
  // the scene's own colors, to match an icon to a creature
  const inScene = el('div', 'scene-colors');
  const used = sceneColors();
  inScene.hidden = !used.length;
  const usedRow = el('div', 'swatches');
  for (const c of used) {
    const b = el('button', c === s.color.toLowerCase() ? 'active' : '');
    b.style.background = c;
    b.title = c;
    b.onclick = () => {
      s.color = c;
      ci.value = c;
      colors.querySelectorAll('button').forEach((o) => o.classList.remove('active'));
      usedRow.querySelectorAll('button').forEach((o) => o.classList.toggle('active', o === b));
      update();
    };
    usedRow.append(b);
  }
  inScene.append(el('div', 'sub-title', 'In the scene'), usedRow);
  fill();
  picker.append(search, grid, el('div', 'pop-sub', 'Color'), colors, custom, inScene);
  popAt(picker, anchor);
  search.focus();
}
