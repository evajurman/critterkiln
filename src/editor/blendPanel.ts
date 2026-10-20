// ---------------------------------------------------------------------------
// Blending: how far parts blend into one another and their colors, and which
// parts blend.

import { blendWithOf, type BlendWith } from '../creature';
import { $ } from './dom';
import { commit, creature, state } from './state';
import { settings } from './settings';

export function renderMerge() {
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

export function initBlendPanel() {
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
  document.querySelectorAll<HTMLButtonElement>('#blend-with button').forEach((b) => {
    b.onclick = () => setBlendWith(b.dataset.with as BlendWith | 'none');
  });
}
