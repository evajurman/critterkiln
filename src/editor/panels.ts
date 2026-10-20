import { unlock } from '../achievements';
import { stopMarkTools } from '../markingPanel';
import { customTabs, setLayoutTab } from '../layout';
import { ANIM_TAB, applyDof, renderAnim, renderMerge } from '../main';
import { $ } from './dom';
import { sceneOrtho, setOrtho } from './stage';
import { backdrop, paintBackdrop, STUFF_BACKDROP } from './floor';
import { creature, creatures, idle, type Mode, mode, selected, setModeValue, setSelected } from './state';
import { syncIdle, updateSkeletonVisibility } from './controls';
import { frameCreature } from './framing';
import { drawState, exitDraw } from './drawing';
import { autosaveThing, board, focusOnBoard, refreshPieceGizmo, renderStuffPanel, saveWorkbenchNow, syncWorkbench } from './workbench';
import { deselectAttachment } from './attach';
import { stopPlacing } from './arrange';
import { renderCreatureBar } from './creatureBar';
import { renderCreatureStuff } from './carry';
import { renderColors, renderPartCard, renderRigs, renderStyles, shapeTips } from './partPanel';
import { renderEyes } from './eyesPanel';
import { renderMarkings } from './markingsUi';
import { renderRigPanel } from './rigEdit';
import { hintOnce } from './hints';
import { placeModePill } from './topbar';

export function renderUI() {
  if (!creature.bones.has(selected)) setSelected(creature.list[0].def.id);
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
  syncIdle();
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
  if (m === ANIM_TAB) deselectAttachment();
  stopMarkTools();
  applyDof();
  if (m === 'look' || m === 'stuff') unlock(m);
  document.querySelectorAll<HTMLButtonElement>('.modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  placeModePill();
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
}

/** The Color theme tints the panels by mode; a made tab by its own color. */
export function tintMode() {
  const h = document.documentElement;
  const own = customTabs().find((t) => t.id === mode);
  h.dataset.mode = own ? 'custom' : mode;
  if (own) h.style.setProperty('--tab-color', own.color);
  else h.style.removeProperty('--tab-color');
}
