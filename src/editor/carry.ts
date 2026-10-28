// ---------------------------------------------------------------------------
// Carrying eyes or a thing from My stuff onto the creature. Eyes are really
// there while they're over the creature (exactly where they'd land); a thing
// lands where it's let go.

import { $, fa } from './dom';
import { canvas } from './stage';
import { commit, creature, idle, state } from './state';
import { moveEyesTo, raycaster, setRay, showEyes } from './controls';
import { hint } from './hints';
import { putOn, type Kit } from './kits';

let carry: {
  what: 'eyes' | Kit;
  ghost: HTMLElement;
  /** the eye pair (index) standing in while over the creature */
  preview: number | null;
  /** where a thing would land (over the creature) */
  at?: { x: number; y: number };
} | null = null;
/** when a carry ended: the click that follows it isn't a click */
let carriedAt = 0;

/** Press and drag `el` to carry what it stands for onto the creature; a plain click still works as before. */
export function carryFrom(el: HTMLElement, what: () => 'eyes' | Kit | null, ghost: () => string) {
  // the browser's own drag (of a thumbnail picture) would cancel the pointer and end the carry
  el.addEventListener('dragstart', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!carry) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const w = what();
        if (!w) return;
        const g = document.createElement('div');
        g.className = 'carry-ghost';
        g.innerHTML = ghost();
        document.body.append(g);
        carry = { what: w, ghost: g, preview: null };
        document.body.classList.add('carrying');
      }
      carryTo(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!carry) return;
      endCarry(ev.type === 'pointerup');
      carriedAt = performance.now();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  el.addEventListener(
    'click',
    (e) => {
      if (performance.now() - carriedAt > 300) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}

function dropPreview() {
  if (!carry || carry.preview === null) return;
  state.eyes.pairs.splice(carry.preview, 1);
  carry.preview = null;
  creature.sync();
}

function carryTo(x: number, y: number) {
  if (!carry) return;
  carry.ghost.style.transform = `translate(${x}px, ${y}px)`;
  // only over the 3D view itself (not a menu on top of it)
  setRay(x, y);
  const hit = document.elementFromPoint(x, y) === canvas && !idle ? creature.surfaceAt(raycaster) : null;
  carry.ghost.classList.toggle('landing', !!hit);
  carry.at = hit ? { x, y } : undefined;
  if (!hit) return dropPreview();
  if (carry.what !== 'eyes') return;
  if (carry.preview === null) {
    state.eyes.pairs.push({ size: 0.5, spacing: 0.5, height: 0.55 });
    carry.preview = state.eyes.pairs.length - 1;
  }
  const pair = state.eyes.pairs[carry.preview];
  // a limb (one of a mirrored pair, or a stalk) gets a single eye; the head gets a pair
  const b = hit.bone;
  const single = b.def.baseId !== state.rig.headId && (b.def.sideSign !== 0 || b.length > 1.6 * b.def.width);
  if (!!pair.single !== single) pair.single = single || undefined;
  moveEyesTo(carry.preview, 1, x, y);
}

function endCarry(drop: boolean) {
  if (!carry) return;
  const c = carry;
  if (!drop) dropPreview();
  carry = null;
  c.ghost.remove();
  document.body.classList.remove('carrying');
  if (c.what !== 'eyes') {
    if (drop && c.at) putOn(c.what, c.at);
    else if (drop) hint('Drop it onto your critter to put it on', 1800);
    return;
  }
  if (c.preview === null) {
    if (drop) hint('Drop the eyes onto your critter', 1800);
    return;
  }
  commit();
  showEyes(c.preview);
  hint('Drag the eyes to move them', 1800);
}

export function initCarry() {
  carryFrom($('#eyes-add'), () => 'eyes', () => fa('eye'));
}
