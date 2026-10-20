// ---------------------------------------------------------------------------
// The picked part's panel: its shape, color, glow, opacity and material.

import { markingsOf, setPartShapes, type BoneRT, type CreatureState, type PartKind, type PartState } from '../creature';
import { collect, unlock } from '../achievements';
import { type Thing } from '../stuff';
import { STYLE_PARAMS, STYLES, styleSettings, type StyleId } from '../materials';
import { RIGS, savedRigs } from '../rigs';
import { $ } from './dom';
import { buildFloorMesh, floorPrefs } from './floor';
import { commit, creature, idle, mode, selected, setIdle, setSelected, state } from './state';
import { touchScreen, updateSkeletonVisibility } from './controls';
import { enterDraw, exitDraw } from './drawing';
import { renderStuffPanel, syncWorkbench } from './workbench';
import { renderCreatureBar } from './creatureBar';
import { glowFollowSeg, glowSlider, sceneColorRow, scopeSeg, SWATCHES } from './widgets';
import { renderEyes } from './eyesPanel';
import { renderUI } from './panels';
import { selPartId } from './markingsUi';
import { switchRig } from './rigEdit';
import { hintOnce } from './hints';

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
  $<HTMLInputElement>('#thickness').value = String(p.thickness);
  $<HTMLInputElement>('#opacity').value = String(p.opacity ?? 1);
  $<HTMLButtonElement>('#reset-shape').disabled = !p.outline;
}

let opacityPending = false;

export function renderColors() {
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
export let partGlowFollow: () => void;
let partSceneColors: () => void;

export function renderStyles() {
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

/** Colors go on the picked part, or (Everything) on the whole creature */
let colorAll = false;
/** Materials go on the whole creature, or (Part) just the picked part */
let styleAll = true;
/** the parts a color (and its glow) goes on */
function colorParts(): PartState[] {
  return colorAll ? Object.values(state.parts) : [selPart()];
}

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
      for (const p of colorParts()) {
        if (f) p.glowFollow = f;
        else delete p.glowFollow;
      }
      creature.sync();
      creature.markMergeDirty();
      commit();
    },
  );
  partSceneColors = sceneColorRow($('#scene-colors'), () => (creature.bones.has(selected) ? selPart().color : undefined), (c) => setColor(c, true));
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
  scopeSeg('#color-scope', () => colorAll, (all) => (colorAll = all));
  scopeSeg(
    '#style-scope',
    () => styleAll,
    (all) => {
      styleAll = all;
      renderStyles();
    },
  );
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
