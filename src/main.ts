import { getCreation } from './library';
import { $ } from './editor/dom';
import { applyLighting, camera, renderer, scene, sceneOrtho, setOrtho } from './editor/stage';
import { applyFloor, initFloor } from './editor/floor';
import { composer, gtao, initPost } from './editor/post';
import {
  activate,
  booted,
  commit,
  creature,
  creatures,
  freshWorld,
  idle,
  initState,
  loadedWorld,
  makeCreature,
  mode,
  opened,
  setBooted,
  world,
} from './editor/state';
import { controls, initControls, viewMoved } from './editor/controls';
import { flyTo, initFraming } from './editor/framing';
import { drawState, initDrawing, localToOverlay, partPlane, screenToLocal } from './editor/drawing';
import { initWorkbench } from './editor/workbench';
import { gizmo, initAttach, selectAttachment } from './editor/attach';
import { initArrange } from './editor/arrange';
import { initCreatureBar } from './editor/creatureBar';
import { initAttachPanel } from './editor/attachPanel';
import { initCarry } from './editor/carry';
import { initFiles, openFile, putView } from './editor/files';
import { type CreationData, initCreations } from './editor/creations';
import { initTrophyPanel } from './editor/trophyPanel';
import { initLibraryPanel } from './editor/libraryPanel';
import { initInstall } from './editor/install';
import { initWidgets } from './editor/widgets';
import { initPartPanel, selectAllParts } from './editor/partPanel';
import { initEyesPanel } from './editor/eyesPanel';
import { renderUI, setMode } from './editor/panels';
import { guidedOn, guidedTab } from './layout';
import { initMarkingsUi } from './editor/markingsUi';
import { initRigEdit } from './editor/rigEdit';
import { hintOnce, initHints } from './editor/hints';
import { initSettings, renderSettings } from './editor/settings';
import { initTopbar } from './editor/topbar';
import { initSheet } from './editor/sheet';
import { initBackdropPanel } from './editor/backdropPanel';
import { initDof } from './editor/dof';
import { initBlendPanel } from './editor/blendPanel';
import { initSnapshot } from './editor/snapshot';
import { initKeys } from './editor/keys';
import { initViewMenu } from './editor/viewMenu';
import { initLoop, loop, resize } from './editor/loop';
import { initAnimateTab } from './editor/animateTab';
import { initAnimGif } from './editor/animGif';

initFloor();
initPost();
initState();
initControls();
initDrawing();
initWorkbench();
initAttach();
initArrange();
initCreatureBar();
initAttachPanel();
initCarry();
initFiles();
initCreations();
initTrophyPanel();
initLibraryPanel();
initInstall();
initWidgets();
initPartPanel();
initEyesPanel();
initMarkingsUi();
initRigEdit();
initHints();
initSettings();
initTopbar();
initSheet();
initBackdropPanel();
initDof();
initBlendPanel();
initFraming();
initSnapshot();
initKeys();
initViewMenu();
initLoop();
initAnimateTab();
initAnimGif();

// boot

$<HTMLInputElement>('#ao').checked = gtao.enabled;
world.creatures.forEach((s, i) => (creatures[i] = makeCreature(s)));
setBooted(true);

activate(world.active);
// the very first time: its only creature picked
if (!loadedWorld) selectAllParts();
// My creations: the open scene's details are read back; a scene from before
// the library existed joins it
if (opened.id) {
  opened.keep = true;
  const id = opened.id;
  void getCreation<CreationData>(id)
    .then((c) => {
      if (!c || opened.id !== id) return;
      opened.created ||= c.created;
      opened.thumb ??= c.thumb;
      opened.savedJson ||= JSON.stringify(c.data);
      // and seen as it was left (unless the view's already been moved)
      const v = c.data.look?.camera;
      if (v && !viewMoved && mode !== 'stuff') putView(v, false);
    })
    .catch(() => {});
} else if (loadedWorld && JSON.stringify(loadedWorld.creatures) !== JSON.stringify(freshWorld().creatures)) {
  opened.keep = true;
}
commit();
renderUI();
// Guided opens on the step it was left at
if (guidedOn()) setMode(guidedTab());
if (mode === 'shape' && idle) hintOnce('Click a part to begin!');
renderSettings();
applyLighting();
applyFloor();
setOrtho(sceneOrtho);
resize();
requestAnimationFrame(loop);

// works offline and installs as an app (the worker is written at build time: vite.config.ts)
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// handy for poking at the scene from the dev-tools console
if (import.meta.env.DEV) Object.assign(window, { __cc: { scene, camera, renderer, composer, controls, flyTo, renderNow: () => { controls.update(); composer.render(); }, screenToLocal, localToOverlay, partPlane, get creature() { return creature; }, get drawState() { return drawState; }, openFile, selectAttachment, gizmo } });
