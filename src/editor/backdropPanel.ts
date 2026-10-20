import { unlock } from '../achievements';
import { STYLES } from '../materials';
import { $ } from './dom';
import { applyLighting, LIGHT_KEY, lightTurn, setLightTurn } from './stage';
import { applyFloor, backdrop, BACKDROPS, type FloorMode, floorPrefs, saveFloor, setBackdrop } from './floor';
import { setAO } from './post';
import { mode } from './state';
import { glowFollowSeg, glowSlider, renderSceneColors, sceneColorRow } from './widgets';

function renderBackdrops() {
  const el = $('#backdrops');
  el.innerHTML = '';
  for (const c of BACKDROPS) {
    const btn = document.createElement('button');
    btn.style.background = c;
    btn.title = c;
    btn.classList.toggle('active', c === backdrop);
    btn.onclick = () => {
      setBackdrop(c);
      if (c !== BACKDROPS[0]) unlock('backdrop');
      renderBackdrops();
    };
    el.append(btn);
  }
  $<HTMLInputElement>('#backdrop-color').value = backdrop;
  renderSceneColors();
}
/** The Backdrop section's controls, showing what's set (src/layout.ts puts them wherever the tab has them). */
export function renderBackdropUI() {
  renderBackdrops();
  renderFloorUI();
  $<HTMLInputElement>('#light-turn').value = String(lightTurn);
}

const FLOOR_SWATCHES = ['#d6c7b3', '#b9a58a', '#8d6e63', '#ece6da', '#a9c2a4', '#a3b3cf', '#4a4350', '#2b2f3a'];

function renderFloorUI() {
  document.querySelectorAll<HTMLButtonElement>('#floor-mode button').forEach((b) => b.classList.toggle('active', b.dataset.floor === floorPrefs.mode));
  $('#floor-mirror-opts').hidden = floorPrefs.mode !== 'mirror';
  $('#floor-material-opts').hidden = floorPrefs.mode !== 'material';
  $<HTMLInputElement>('#floor-reflect').value = String(floorPrefs.reflect);
  $<HTMLInputElement>('#floor-color').value = floorPrefs.color;
  const styles = $('#floor-styles');
  styles.innerHTML = '';
  for (const s of STYLES) {
    if (s.id === 'glass') continue;
    const b = document.createElement('button');
    b.innerHTML = `<span class="ball ${s.id}"></span>`;
    b.append(s.name);
    b.classList.toggle('active', s.id === floorPrefs.style);
    b.title = s.desc;
    b.onclick = () => updateFloor(() => (floorPrefs.style = s.id));
    styles.append(b);
  }
  const sw = $('#floor-swatches');
  sw.innerHTML = '';
  for (const c of FLOOR_SWATCHES) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.classList.toggle('active', c === floorPrefs.color);
    b.onclick = () => updateFloor(() => (floorPrefs.color = c));
    sw.append(b);
  }
  $<HTMLInputElement>('#floor-glow').value = String(floorPrefs.glow);
  floorGlowFollow();
  renderSceneColors();
}
let floorGlowFollow: () => void;

function updateFloor(fn: () => void) {
  fn();
  saveFloor();
  applyFloor();
  renderFloorUI();
}

export function initBackdropPanel() {
  sceneColorRow($('#backdrop-scene-colors'), () => backdrop, (c) => {
    setBackdrop(c);
    unlock('backdrop');
    renderBackdrops();
  });
  $<HTMLInputElement>('#light-turn').oninput = (e) => {
    setLightTurn(parseFloat((e.target as HTMLInputElement).value));
    applyLighting();
    try {
      localStorage.setItem(LIGHT_KEY, JSON.stringify({ turn: lightTurn }));
    } catch {
      /* ignore */
    }
  };
  $<HTMLInputElement>('#backdrop-color').oninput = (e) => {
    setBackdrop((e.target as HTMLInputElement).value);
    unlock('backdrop');
    renderBackdrops();
  };
  floorGlowFollow = glowFollowSeg(
    '#floor-glow-follow',
    () => floorPrefs,
    (f) =>
      updateFloor(() => {
        if (f) floorPrefs.glowFollow = f;
        else delete floorPrefs.glowFollow;
      }),
  );
  sceneColorRow($('#floor-scene-colors'), () => floorPrefs.color, (c) => updateFloor(() => (floorPrefs.color = c)));
  glowSlider(
    '#floor-glow',
    (v) => {
      floorPrefs.glow = v;
      applyFloor();
      floorGlowFollow();
    },
    () => saveFloor(),
  );
  document.querySelectorAll<HTMLButtonElement>('#floor-mode button').forEach((b) => {
    b.onclick = () => updateFloor(() => (floorPrefs.mode = b.dataset.floor as FloorMode));
  });
  $<HTMLInputElement>('#floor-reflect').oninput = (e) => {
    floorPrefs.reflect = parseFloat((e.target as HTMLInputElement).value);
    saveFloor();
    applyFloor();
  };
  $<HTMLInputElement>('#floor-color').oninput = (e) => {
    floorPrefs.color = (e.target as HTMLInputElement).value;
    saveFloor();
    applyFloor();
  };
  $<HTMLInputElement>('#floor-color').onchange = () => renderFloorUI();
  $<HTMLInputElement>('#ao').onchange = (e) => setAO((e.target as HTMLInputElement).checked);
  // the Backdrop section is always out (no popup to open first), so it starts showing what is set
  renderBackdropUI();
}
