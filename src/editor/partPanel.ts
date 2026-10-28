// ---------------------------------------------------------------------------
// The picked part's panel: its shape, color, glow, opacity and material; and
// picking parts (one, several, or every part of the creature).

import { markingsOf, setPartShapes, type BoneRT, type Creature, type CreatureState, type PartKind, type PartState } from '../creature';
import { collect, unlock } from '../achievements';
import { STYLE_PARAMS, STYLES, styleSettings, type StyleId } from '../materials';
import { RIGS, savedRigs } from '../rigs';
import { $, type PickHow } from './dom';
import { buildFloorMesh, floorPrefs } from './floor';
import { alsoPicked, commit, creature, idle, mode, selected, setIdle, setSelected, state } from './state';
import { touchScreen, updateSkeletonVisibility } from './controls';
import { enterDraw, exitDraw } from './drawing';
import { renderCreatureBar } from './creatureBar';
import { glowFollowSeg, glowSlider, sceneColorRow, SWATCHES } from './widgets';
import { renderEyes } from './eyesPanel';
import { renderUI } from './panels';
import { selPartId } from './markingsUi';
import { switchRig } from './rigEdit';
import { hintOnce } from './hints';
import { scopeOf, type ScopeKind } from './scope';

export function partLabel(src: string): string {
  const b = creature.bones.get(src)!;
  return b.def.sideSign !== 0 ? b.def.name.replace(/ \((L|R)\)$/, '') : b.def.name;
}

function sources(): BoneRT[] {
  return creature.list.filter((b) => !b.def.mirrorOf);
}

/** A hollow turned part's wall when it hasn't one of its own: a share of its widest radius (see partPieceGeometry). */
function defaultWall(p: PartState): number {
  const xs = (p.outline ?? []).map((q) => Math.abs(q[0]));
  return Math.max(0.004, 0.12 * Math.max(0, ...xs));
}

/** A part slider: the picked part follows as it's dragged, kept on release. */
function partSlider(sel: string, set: (p: PartState, v: number) => void) {
  const input = $<HTMLInputElement>(sel);
  let pending = false;
  input.oninput = () => {
    set(selPart(), parseFloat(input.value));
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      creature.sync();
    });
  };
  input.onchange = () => {
    creature.sync();
    commit();
    renderUI();
  };
}

function selPart() {
  return state.parts[creature.bones.get(selected)!.src];
}

/** The picked parts' bones: the main one (the one shaped and posed) first, then any picked along with it. */
export function pickedBones(): string[] {
  return [selected, ...[...alsoPicked].filter((id) => id !== selected && creature.bones.has(id))];
}
/** The picked parts' drawings (a pair's two sides share one), main part first. */
export function pickedSrcs(): string[] {
  return [...new Set(pickedBones().flatMap((id) => creature.bones.get(id)?.src ?? []))];
}
function pickedParts(): PartState[] {
  return pickedSrcs().flatMap((src) => state.parts[src] ?? []);
}
/** Every part of the creature is picked: colors and materials go on the whole creature, markings over all of it. */
export function allPicked(): boolean {
  return !idle && pickedSrcs().length >= Object.keys(state.parts).length;
}
/** A section's changes go on the whole creature: it's set to Everything, or every part is picked. */
export function wholeFor(k: ScopeKind): boolean {
  return !idle && (scopeOf(k) === 'all' || allPicked());
}
/** The parts a section's changes go on: every one, or the picked ones. */
function partsFor(k: ScopeKind): PartState[] {
  return wholeFor(k) ? Object.values(state.parts) : pickedParts();
}

/** What Look shows the color and glow of: the main part. */
function shownLook(): { color: string; glow?: number } {
  return selPart();
}

/**
 * The parts in the order the Scene list shows them: each under the part it hangs off, a step
 * deeper (a pair is listed once, by its first side, so a part on its other side hangs off that too).
 */
export function partTree(c: Creature = creature): { bone: BoneRT; depth: number }[] {
  const row = (b: BoneRT) => (b.def.mirrorOf ? (c.bones.get(b.def.mirrorOf) ?? b) : b);
  const kids = new Map<BoneRT | null, BoneRT[]>();
  for (const b of c.list.filter((o) => !o.def.mirrorOf)) {
    const up = b.parent ? row(b.parent) : null;
    kids.set(up, [...(kids.get(up) ?? []), b]);
  }
  const out: { bone: BoneRT; depth: number }[] = [];
  const add = (b: BoneRT, depth: number) => {
    out.push({ bone: b, depth });
    for (const k of kids.get(b) ?? []) add(k, depth + 1);
  };
  for (const b of kids.get(null) ?? []) add(b, 0);
  return out;
}

/**
 * Picks a part: just it; or (`toggle`) one more, as the main one, or one less; or (`range`)
 * every part in the Scene list from the main one to it, the main one staying main.
 */
export function selectPart(id: string, tips = true, how: PickHow = 'one') {
  const src = creature.bones.get(id)?.src;
  if (idle || !src) how = 'one';
  if (how === 'toggle') {
    const had = pickedBones().filter((b) => creature.bones.get(b)?.src === src);
    if (!had.length) {
      alsoPicked.add(selected);
    } else {
      // the last one picked stays picked
      if (pickedSrcs().length < 2) return;
      for (const b of [...alsoPicked]) if (creature.bones.get(b)?.src === src) alsoPicked.delete(b);
      if (had.includes(selected)) id = pickedBones().find((b) => creature.bones.get(b)?.src !== src)!;
      else id = selected;
      alsoPicked.delete(id);
    }
  } else if (how === 'range') {
    const order = partTree().map((r) => r.bone);
    const mainSrc = creature.bones.get(selected)?.src;
    const a = order.findIndex((b) => b.src === mainSrc);
    const z = order.findIndex((b) => b.src === src);
    alsoPicked.clear();
    if (a >= 0 && z >= 0) for (const b of order.slice(Math.min(a, z), Math.max(a, z) + 1)) if (b.src !== mainSrc) alsoPicked.add(b.def.id);
    id = selected;
  } else alsoPicked.clear();
  setIdle(false);
  setSelected(id);
  creature.select(id);
  updateSkeletonVisibility();
  flashPart();
  renderUI();
  if (tips && mode === 'shape') shapeTips();
}

/** Picks every part of the creature (the main part stays the one shaped and posed). */
export function selectAllParts() {
  setIdle(false);
  if (!creature.bones.has(selected)) setSelected(creature.list[0].def.id);
  for (const b of sources()) if (b.def.id !== selected) alsoPicked.add(b.def.id);
  creature.select(selected);
  updateSkeletonVisibility();
  flashPart();
  renderUI();
}

/** What the handles on a picked part do: the first time one is picked in Shape. */
export function shapeTips() {
  hintOnce(`Drag the orange balls to pose · ${touchScreen() ? 'double-tap' : 'double-click'} a part to draw it`, 3600);
}

export let flashStart = 0;
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

export function renderPartCard() {
  const p = selPart();
  const kind = p.kind ?? 'puffy';
  document.querySelectorAll<HTMLButtonElement>('#part-kind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  // a turned part is as round as its drawing: nothing to thicken
  $('#thickness-row').hidden = kind === 'turned';
  $('#part-turned-row').hidden = kind !== 'turned';
  $<HTMLInputElement>('#part-hollow').checked = !!p.hollow;
  $<HTMLInputElement>('#part-open').checked = !!p.open;
  $<HTMLInputElement>('#part-open').disabled = !p.hollow;
  $<HTMLInputElement>('#part-apart').checked = !!p.apart;
  $('#part-round-row').hidden = kind !== 'flat';
  $<HTMLInputElement>('#part-round').value = String(p.round ?? 0.7);
  $('#part-wall-row').hidden = kind !== 'turned' || !p.hollow;
  $<HTMLInputElement>('#part-wall').value = String(p.wall ?? defaultWall(p));
  $<HTMLInputElement>('#part-curve').value = String(p.curve ?? 0);
  // no curve: just the choice (the slider shows once it curves one way or the other)
  const curveMode = p.curve ? (p.curveMode ?? 'axis') : 'none';
  document.querySelectorAll<HTMLButtonElement>('#part-curve-mode button').forEach((b) => b.classList.toggle('active', b.dataset.curve === curveMode));
  $('#part-curve-row').hidden = curveMode === 'none';
  // only something kept apart from the body can be pressed onto it
  const wrapIn = $<HTMLInputElement>('#part-wrap');
  wrapIn.value = String(p.wrap ?? 0);
  wrapIn.disabled = !p.apart;
  $('#part-wrap-row').title = p.apart ? 'Press it onto the body like a decal' : 'Keep it apart from the body first: then it can be pressed onto it';
  $('#part-wrap-smooth-row').hidden = !p.apart || !p.wrap;
  $<HTMLInputElement>('#part-wrap-smooth').value = String(p.wrapSmooth ?? 0.3);
  $<HTMLInputElement>('#thickness').value = String(p.thickness);
  $<HTMLInputElement>('#opacity').value = String(p.opacity ?? 1);
  $<HTMLButtonElement>('#reset-shape').disabled = !p.outline;
}

let opacityPending = false;

export function renderColors() {
  const p = shownLook();
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
export let partGlowFollow: () => void;
let partSceneColors: () => void;

export function renderStyles() {
  const whole = wholeFor('material');
  const current = whole ? state.style : (selPart().style ?? state.style);
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
  renderOwnStyles(whole);
  if (!whole) renderPartMaterial(selPart(), current);
  else renderStyleParams(current);
}

/**
 * A part's material settings: the creature's for that material, or (Just this
 * part) its own, starting from how it looks now.
 */
function renderPartMaterial(p: PartState, style: StyleId) {
  const el = $('#style-params');
  el.innerHTML = '';
  const row = document.createElement('label');
  row.className = 'check';
  row.title = 'On: these settings are this part’s own. Off: it shares the creature’s settings for this material.';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!p.materialSettings?.[style];
  box.onchange = () => {
    if (box.checked) p.materialSettings = { ...p.materialSettings, [style]: { ...creature.settingsOf(p, style) } };
    else if (p.materialSettings) {
      delete p.materialSettings[style];
      if (!Object.keys(p.materialSettings).length) delete p.materialSettings;
    }
    creature.sync();
    commit();
    renderPartMaterial(p, style);
  };
  row.append(box, ' Just this part');
  const sub = document.createElement('div');
  el.append(row, sub);
  renderStyleParams(style, sub, p.materialSettings?.[style] ? p : state);
}

type SettingsOwner = { materialSettings?: CreatureState['materialSettings'] };

/**
 * Sliders for a material. With the default owner (the creature) they apply
 * everywhere that material is used, stuff included unless the item has its
 * own settings. The number boxes take any value, past either end of the slider.
 */
function renderStyleParams(style: StyleId, el: HTMLElement = $('#style-params'), owner: SettingsOwner = state, after?: () => void) {
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
    after?.();
    commit();
    renderStyleParams(style, el, owner, after);
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
        if (owner === state && floorPrefs.mode === 'material' && floorPrefs.style === style) buildFloorMesh();
        // toon's ink width at 0 has no outline for the eyes to share
        if (p.key === 'ink') renderEyes();
      });
    };
    input.oninput = () => {
      num.value = input.value;
      apply(parseFloat(input.value));
    };
    const keep = () => {
      after?.();
      commit();
    };
    input.onchange = keep;
    num.oninput = () => {
      const v = parseFloat(num.value);
      if (!Number.isFinite(v)) return;
      input.value = String(v); // the slider just pins at its end
      apply(v);
    };
    num.onchange = keep;
    row.append(name, input, num);
    el.append(row);
  }
}

/** On Everything: the parts with a material of their own (set on Part), each with a × back to the creature's. */
function renderOwnStyles(whole: boolean) {
  const el = $('#style-own');
  const own = whole ? Object.entries(state.parts).filter(([, p]) => p.style && p.style !== state.style) : [];
  el.hidden = !own.length;
  el.replaceChildren();
  if (!own.length) return;
  el.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'Keep their own:' }));
  for (const [src, p] of own) {
    const b = document.createElement('button');
    b.className = 'own-chip';
    b.innerHTML = `<span class="ball ${p.style}"></span>`;
    b.append(`${partLabel(src)} · ${STYLES.find((s) => s.id === p.style)?.name ?? p.style} `);
    b.insertAdjacentHTML('beforeend', '<i class="fa-duotone fa-regular fa-xmark" aria-hidden="true"></i>');
    b.title = `Make ${partLabel(src)} ${STYLES.find((s) => s.id === state.style)?.name ?? state.style}, like the rest`;
    b.onclick = () => {
      delete p.style;
      creature.sync();
      creature.markMergeDirty();
      commit();
      renderStyles();
      renderEyes();
    };
    el.append(b);
  }
}

function setColor(c: string, doCommit: boolean) {
  for (const p of partsFor('color')) p.color = c;
  if (wholeFor('color') && doCommit && Object.keys(state.parts).length > 1) unlock('paint-all');
  creature.sync();
  creature.markMergeDirty();
  if (doCommit) {
    commit();
    renderColors();
  }
  renderCreatureBar();
}

/** A material on the picked parts; on Everything (or with every part picked), it's the whole creature's (parts added later too), but not the parts with their own. */
function setStyle(id: StyleId) {
  if (!wholeFor('material')) {
    for (const p of pickedParts()) p.style = id;
  } else {
    // parts with their own material keep it (listed under the materials, each with a × back to this)
    state.style = id;
    for (const p of Object.values(state.parts)) if (p.style === id) delete p.style;
  }
  collect('materials', id);
  creature.sync();
  creature.markMergeDirty();
  commit();
  renderStyles();
  // which eye options apply depends on the material (ink on toon, varying on a textured one)
  renderEyes();
}

let thicknessPending = false;

export function initPartPanel() {
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
  partGlowFollow = glowFollowSeg(
    '#glow-follow',
    () => (creature.bones.has(selected) ? { ...selPart(), markings: markingsOf(state, selPartId()) } : undefined),
    (f) => {
      for (const p of partsFor('color')) {
        if (f) p.glowFollow = f;
        else delete p.glowFollow;
      }
      creature.sync();
      creature.markMergeDirty();
      commit();
    },
  );
  partSceneColors = sceneColorRow($('#scene-colors'), () => (creature.bones.has(selected) ? shownLook().color : undefined), (c) => setColor(c, true));
  glowSlider(
    '#glow',
    (v) => {
      for (const p of partsFor('color')) {
        if (v > 0) p.glow = v;
        else delete p.glow;
      }
      creature.sync();
      creature.markMergeDirty();
      partGlowFollow();
    },
    () => commit(),
  );
  $('#draw').onclick = () => enterDraw({ kind: 'bone', boneId: selected });
  $('#cancel-draw').onclick = () => exitDraw();
  $('#reset-shape').onclick = () => {
    setPartShapes(selPart(), []);
    creature.sync();
    commit();
    renderUI();
  };
  for (const [sel, key] of [['#part-hollow', 'hollow'], ['#part-open', 'open'], ['#part-apart', 'apart']] as const) {
    $<HTMLInputElement>(sel).onchange = (e) => {
      const p = selPart();
      if ((e.target as HTMLInputElement).checked) p[key] = true;
      else delete p[key];
      creature.sync();
      commit();
      renderUI();
    };
  }
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
  partSlider('#part-round', (p, v) => (p.round = v));
  partSlider('#part-wall', (p, v) => (p.wall = v));
  partSlider('#part-curve', (p, v) => {
    if (Math.abs(v) < 0.005) delete p.curve;
    else p.curve = v;
  });
  partSlider('#part-wrap', (p, v) => {
    if (v < 0.005) delete p.wrap;
    else p.wrap = v;
  });
  partSlider('#part-wrap-smooth', (p, v) => (p.wrapSmooth = v));
  document.querySelectorAll<HTMLButtonElement>('#part-curve-mode button').forEach((b) => {
    b.onclick = () => {
      const p = selPart();
      if (b.dataset.curve === 'none') {
        delete p.curve;
        delete p.curveMode;
      } else {
        p.curveMode = b.dataset.curve as 'axis' | 'radial';
        // picking a way to curve with nothing curved yet starts with a visible curve
        if (!p.curve) p.curve = 0.4;
      }
      creature.sync();
      commit();
      renderUI();
    };
  });
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
}
