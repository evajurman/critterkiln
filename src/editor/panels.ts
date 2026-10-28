// ---------------------------------------------------------------------------
// Which tab is open (setMode), and redrawing every panel (renderUI).

import { enterBench, leaveBench } from './focus';
import { unlock } from '../achievements';
import { stopMarkTools } from '../markingPanel';
import { customTabs, guidedOn, isStep, noteTab, setGuided, setLayoutTab } from '../layout';
import { $ } from './dom';
import { alsoPicked, creature, idle, type Mode, mode, selected, setModeValue, setSelected, state, world } from './state';
import { creatureLabel, syncIdle, updateSkeletonVisibility } from './controls';
import { drawState, exitDraw } from './drawing';
import { renderCreatureBar } from './creatureBar';
import { resetGizmoMode } from './gizmoMode';
import { allPicked, partLabel, pickedSrcs, renderColors, renderPartCard, renderRigs, renderStyles, selectPart, shapeTips } from './partPanel';
import { renderEyes } from './eyesPanel';
import { renderMarkings } from './markingsUi';
import { partName, renderRigPanel } from './rigEdit';
import { hintOnce } from './hints';
import { applyDof } from './dof';
import { renderMerge } from './blendPanel';
import { setPickPill } from './sheet';
import { renderAnim } from './animateTab';
import { renderScope } from './scope';
import { stopPattern } from './pattern';

export function renderUI() {
  if (!creature.bones.has(selected)) setSelected(creature.list[0].def.id);
  // parts picked along with it that are gone now (removed, undone)
  for (const id of alsoPicked) if (!creature.bones.has(id)) alsoPicked.delete(id);
  renderAnim();
  renderRigs();
  renderPartCard();
  renderColors();
  renderStyles();
  renderMarkings();
  renderMerge();
  renderEyes();
  renderRigPanel();
  renderCreatureBar();
  renderInspectorHead();
  syncIdle();
  renderScope();
}

export function setMode(m: Mode) {
  if (drawState) exitDraw();
  const was = mode;
  // (a pattern's preview is for the tab it was started in)
  stopPattern();
  setModeValue(m);
  // a step is Guided, any other mode Free (its key, say)
  if (isStep(m) !== guidedOn()) setGuided(isStep(m));
  document.querySelectorAll<HTMLButtonElement>('#guided-seg button').forEach((b) => b.classList.toggle('active', (b.dataset.guided === 'on') === guidedOn()));
  noteTab(m);
  stopMarkTools();
  applyDof();
  if (m === 'look') unlock(m);
  document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  // on a phone the rail is a row that scrolls: keep the open mode (or step) in sight
  document.querySelector('.rail button.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  tintMode();
  // the Stuff tab works on one thing on its own: no new creatures from there
  $('#cr-add').hidden = m === 'stuff';
  // Shape and Look are the same tools, each tab with its own layout (src/layout.ts)
  // the Stuff tab: the blueprint bench out (or away again)
  if (m === 'stuff' && was !== 'stuff') enterBench();
  else if (was === 'stuff' && m !== 'stuff') leaveBench();
  setLayoutTab(m);
  // each tab starts with its own handles (the button on the view cube changes them)
  resetGizmoMode();
  updateSkeletonVisibility();
  syncIdle();
  renderRigPanel();
  if (m === 'shape') {
    if (idle) hintOnce('Click a part to begin!');
    else shapeTips();
  }
  if (m === 'look') hintOnce('Click a part, then pick its color and material', 2200);
  // a step's tools are for a part: with nothing picked, start on the first one
  if (isStep(m) && idle) selectPart(creature.list[0].def.id, false);
}

/** The inspector's head: the picked part, under the creature and the part it hangs off. */
function renderInspectorHead() {
  const b = creature.bones.get(selected);
  const side = (n: string) => n.replace(/ \((L|R)\)$/, '');
  const srcs = pickedSrcs();
  const several = !idle && srcs.length > 1;
  const path = idle ? '' : several ? creatureLabel(world.active) : [creatureLabel(world.active), b?.parent && side(b.parent.def.name)].filter(Boolean).join(' › ');
  let name = idle ? 'Nothing picked' : partName() || (b ? side(b.def.name) : '');
  if (several) name = allPicked() ? `All ${Object.keys(state.parts).length} parts` : srcs.length === 2 ? srcs.map(partLabel).join(' + ') : `${srcs.length} parts`;
  $('#inspector-path').textContent = path;
  $('#inspector-name').textContent = name;
  setPickPill(name, idle ? null : (state.parts[b?.src ?? '']?.color ?? null));
}

/** The Color theme tints the panels by mode; a made tab by its own color. */
export function tintMode() {
  const h = document.documentElement;
  const own = customTabs().find((t) => t.id === mode);
  h.dataset.mode = own ? 'custom' : mode;
  if (own) h.style.setProperty('--tab-color', own.color);
  else h.style.removeProperty('--tab-color');
}
