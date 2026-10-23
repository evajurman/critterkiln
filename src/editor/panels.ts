// ---------------------------------------------------------------------------
// Which tab is open (setMode), and redrawing every panel (renderUI).

import { unlock } from '../achievements';
import { stopMarkTools } from '../markingPanel';
import { customTabs, guidedOn, isStep, noteTab, setGuided, setLayoutTab, STUFF_STEP } from '../layout';
import { $ } from './dom';
import { sceneOrtho, setOrtho } from './stage';
import { backdrop, paintBackdrop, STUFF_BACKDROP } from './floor';
import { alsoPicked, creature, creatures, idle, type Mode, mode, selected, setModeValue, setSelected, state, world } from './state';
import { creatureLabel, syncIdle, updateSkeletonVisibility } from './controls';
import { frameCreature } from './framing';
import { drawState, exitDraw } from './drawing';
import { autosaveThing, board, focusOnBoard, refreshPieceGizmo, renderStuffPanel, saveWorkbenchNow, syncWorkbench } from './workbench';
import { deselectAttachment } from './attach';
import { stopPlacing } from './arrange';
import { renderCreatureBar } from './creatureBar';
import { renderCreatureStuff } from './carry';
import { allPicked, partLabel, pickedSrcs, renderColors, renderPartCard, renderRigs, renderStyles, selectPart, shapeTips } from './partPanel';
import { renderEyes } from './eyesPanel';
import { renderMarkings } from './markingsUi';
import { partName, renderRigPanel } from './rigEdit';
import { hintOnce } from './hints';
import { applyDof } from './dof';
import { renderMerge } from './blendPanel';
import { setPickPill } from './sheet';
import { ANIM_TAB, renderAnim } from './animateTab';
import { renderScope } from './scope';

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
  renderCreatureStuff();
  renderStuffPanel();
  renderCreatureBar();
  renderInspectorHead();
  syncIdle();
  renderScope();
}

export function setMode(m: Mode) {
  if (drawState) exitDraw();
  // leaving the workbench: keep what's on it (while it's still there to photograph)
  if (mode === 'stuff' && m !== 'stuff') saveWorkbenchNow();
  // the workbench's own backdrop and flat (ortho) view last only while it's open
  if ((mode === 'stuff') !== (m === 'stuff')) {
    paintBackdrop(m === 'stuff' ? STUFF_BACKDROP : backdrop);
    setOrtho(m === 'stuff' || sceneOrtho);
  }
  setModeValue(m);
  // a step is Guided, any other mode Free (its key, say); Stuff is either: in Guided it's part of Dress up
  if (m !== 'stuff' && isStep(m) !== guidedOn()) setGuided(isStep(m));
  document.querySelectorAll<HTMLButtonElement>('#guided-seg button').forEach((b) => b.classList.toggle('active', (b.dataset.guided === 'on') === guidedOn()));
  if (!(m === 'stuff' && guidedOn())) noteTab(m);
  if (m === ANIM_TAB) deselectAttachment();
  stopMarkTools();
  applyDof();
  if (m === 'look' || m === 'stuff') unlock(m);
  const lit = m === 'stuff' && guidedOn() ? STUFF_STEP : m;
  document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === lit));
  // on a phone the rail is a row that scrolls: keep the open mode (or step) in sight
  document.querySelector('.rail button.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  tintMode();
  // Shape and Look are the same tools, each tab with its own layout (src/layout.ts)
  setLayoutTab(m === 'stuff' ? null : m);
  $('#stuff-panel').hidden = m !== 'stuff';
  $('#creature-bar').hidden = m === 'stuff';
  if (m === 'stuff') stopPlacing();
  if (m === 'stuff') deselectAttachment();
  if (m === 'stuff') $('#attach-pop').hidden = true;
  const wasStuff = board.visible;
  board.visible = m === 'stuff';
  for (const c of creatures) c.root.visible = m !== 'stuff';
  if (m === 'stuff') {
    syncWorkbench();
    renderStuffPanel();
    focusOnBoard();
    autosaveThing();
    hintOnce('Draw pieces on the board; the blue crosshair is where it attaches', 3200);
  } else if (wasStuff) {
    frameCreature();
  }
  updateSkeletonVisibility();
  syncIdle();
  refreshPieceGizmo();
  if (m !== 'stuff') renderRigPanel();
  if (m === 'shape') {
    if (idle) hintOnce('Click a part to begin!');
    else shapeTips();
  }
  if (m === 'look') hintOnce('Click a part, then pick its color and material', 2200);
  // a step's tools are for a part: with nothing picked, start on the first one
  if (isStep(m) && idle) selectPart(creature.list[0].def.id, false);
}

/** The inspector's head: the picked part, under the creature and the part it hangs off (Stuff has none). */
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
