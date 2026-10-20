// ---------------------------------------------------------------------------
// Little widgets the panels share: the swatches of colors in the scene, glow
// sliders and where a glow comes from, and Part | Everything toggles.

import { followOf, type GlowFollow } from '../materials';
import { type Marking } from '../markings';
import { setSceneColors } from '../layout';
import { $ } from './dom';
import { backdrop, floorPrefs } from './floor';
import { creature, creatures, mode, sceneColorRows, world } from './state';
import { workbench } from './workbench';
import { invalidate } from './loop';

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

export function initWidgets() {
  setSceneColors(sceneColors);
}
