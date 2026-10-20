import { Creature, setSeamlessLowPoly, setSeamlessMode, type SeamlessMode } from '../creature';
import { setMeshDetail } from '../inflate';
import { setFuzzQuality } from '../materials';
import { hasCustomShortcuts, labelShortcuts, renderShortcutSheet, resetShortcuts, stopListening } from '../shortcuts';
import { $ } from './dom';
import { key, quality, type Quality, QUALITY, renderer, setQualityValue } from './stage';
import { composer, gtao, setAO } from './post';
import { activate, creature, creatures, fitShadows, makeCreature, setCreature, world } from './state';
import { drawHint, exitDraw, syncDrawBar } from './drawing';
import { benchKey, setBenchKey, syncWorkbench } from './workbench';
import { stopPlacing } from './arrange';
import { closeAttachPops, closeTopPopovers, togglePopover } from './popovers';
import { renderUI } from './panels';
import { fitTopbar } from './topbar';
import { renderMerge } from './blendPanel';
import { resize } from './loop';

// settings (remembered in this browser)

const SETTINGS_KEY = 'creature-creator/settings';
type Theme = 'light' | 'dark' | 'color';
export let settings: { numbers: boolean; plainText: boolean; theme: Theme; seamless: SeamlessMode; seamlessLowPoly: boolean; quality: Quality };

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function renderSettings() {
  document.body.classList.toggle('show-nums', settings.numbers);
  $<HTMLInputElement>('#set-nums').checked = settings.numbers;
  document.documentElement.classList.toggle('plain-text', settings.plainText);
  $<HTMLInputElement>('#set-plain').checked = settings.plainText;
  for (const t of ['dark', 'color']) document.documentElement.classList.toggle(`theme-${t}`, settings.theme === t);
  document.querySelectorAll<HTMLButtonElement>('#set-theme button').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
  // the browser's own bar (phones, installed app) matches the page
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  document.querySelectorAll<HTMLButtonElement>('#set-seamless button').forEach((b) => b.classList.toggle('active', b.dataset.seamless === settings.seamless));
  $<HTMLInputElement>('#set-seamless-lp').checked = settings.seamlessLowPoly;
  // nothing to apply it to while seamless joins are off
  $<HTMLInputElement>('#set-seamless-lp').disabled = settings.seamless === 'off';
  $('#set-seamless-lp-row').style.opacity = settings.seamless === 'off' ? '.45' : '1';
  document.querySelectorAll<HTMLButtonElement>('#set-quality button').forEach((b) => b.classList.toggle('active', b.dataset.quality === quality));
  if (settings.numbers) syncSliderNumbers();
}

/**
 * With "Show numbers" on, every slider has a number box beside it. Material
 * sliders make their own (marked `own`: they take values past the slider's
 * ends, so they aren't overwritten from it); the rest are added here and kept
 * in step with their slider.
 */
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;

/**
 * Let a slider hold a value past its ends (typed into its number box, or put
 * back from a saved value): it shows pinned at the end but reads back the real
 * number, so every handler that reads `.value` just works. Touching the slider
 * itself goes back to its own range.
 */
function unlimited(range: HTMLInputElement) {
  if (range.dataset.unlimited) return;
  range.dataset.unlimited = '1';
  let over: string | null = null;
  Object.defineProperty(range, 'value', {
    configurable: true,
    get: () => over ?? (nativeValue.get!.call(range) as string),
    set: (v: string) => {
      nativeValue.set!.call(range, v);
      const n = parseFloat(v);
      over = Number.isFinite(n) && (n < parseFloat(range.min) || n > parseFloat(range.max)) ? String(v) : null;
    },
  });
  const drop = () => (over = null);
  range.addEventListener('pointerdown', drop);
  range.addEventListener('keydown', drop);
}

export function syncSliderNumbers() {
  document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((range) => {
    let num = range.nextElementSibling as HTMLInputElement | null;
    if (!num?.classList.contains('num')) {
      unlimited(range);
      const box = document.createElement('input');
      box.type = 'number';
      box.className = 'num';
      box.oninput = () => {
        if (!Number.isFinite(parseFloat(box.value))) return;
        // past either end, the slider pins there but keeps the typed value
        range.value = box.value;
        range.dispatchEvent(new Event('input', { bubbles: true }));
      };

      box.onchange = () => range.dispatchEvent(new Event('change', { bubbles: true }));
      range.after(box);
      num = box;
    }
    if (num.dataset.own || document.activeElement === num) return;
    num.step = range.step;
    const decimals = (range.step.split('.')[1] ?? '').length;
    const text = Number(range.value).toFixed(decimals);
    if (num.value !== text) num.value = text;
  });
}

// ---- keyboard shortcut sheet ----

function openShortcutSheet() {
  closeTopPopovers();
  closeAttachPops();
  $('#keys-pop').hidden = false;
  renderShortcutSheet($('#keys-list'));
  $('#keys-reset').hidden = !hasCustomShortcuts();
}
export function closeShortcutSheet() {
  stopListening();
  $('#keys-pop').hidden = true;
}
export function toggleShortcutSheet() {
  if ($('#keys-pop').hidden) openShortcutSheet();
  else closeShortcutSheet();
}
/** A key changed: tooltips, key labels and the hints that name keys. */
export function shortcutsChanged() {
  labelShortcuts();
  $('#keys-reset').hidden = !hasCustomShortcuts();
  syncDrawBar();
  drawHint();
}
/** Switch performance level: renderer settings now, and every shape rebuilt at the new detail. */
function setQuality(q: Quality) {
  if (q === quality) return;
  setQualityValue(settings.quality = q);
  const Q = QUALITY[q];
  setMeshDetail(Q.detail);
  setFuzzQuality(Q.fuzz);
  renderer.transmissionResolutionScale = Q.glass;
  // a new shadow map size takes a fresh map
  key.shadow.mapSize.setScalar(Q.shadow);
  key.shadow.map?.dispose();
  key.shadow.map = null;
  renderer.shadowMap.needsUpdate = true;
  // anti-aliasing: the targets are rebuilt with the new sample count on next use
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    rt.samples = Q.samples;
    rt.dispose();
  }
  gtao.updateGtaoMaterial({ samples: Q.aoSamples });
  setAO(Q.ao);
  $<HTMLInputElement>('#ao').checked = Q.ao;
  resize();
  // every creature (and the workbench) remeshed at the new detail
  exitDraw();
  stopPlacing();
  for (let i = 0; i < creatures.length; i++) {
    creatures[i].dispose();
    creatures[i] = makeCreature(world.creatures[i]);
  }
  setCreature(undefined as unknown as Creature); // replaced wholesale
  activate(world.active);
  setBenchKey('');
  syncWorkbench();
  fitShadows();
  saveSettings();
  renderSettings();
  renderUI();
}

export function initSettings() {
  settings = (() => {
    const defaults = { numbers: false, plainText: false, theme: 'light' as Theme, seamless: 'on' as SeamlessMode, seamlessLowPoly: false, quality };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
      return defaults;
    }
  })();
  setSeamlessMode(settings.seamless);
  setSeamlessLowPoly(settings.seamlessLowPoly);
  $('#settings-btn').onclick = () => {
    if (togglePopover('#settings-pop')) renderSettings();
  };
  $('#set-keys').onclick = () => openShortcutSheet();
  $('#keys-close').onclick = () => closeShortcutSheet();
  $('#keys-reset').onclick = () => {
    resetShortcuts();
    shortcutsChanged();
    renderShortcutSheet($('#keys-list'), 'Every key is back to how it started.');
  };
  labelShortcuts();
  $<HTMLInputElement>('#set-seamless-lp').onchange = (e) => {
    settings.seamlessLowPoly = (e.target as HTMLInputElement).checked;
    setSeamlessLowPoly(settings.seamlessLowPoly);
    // low-poly creatures build (or drop) their skins
    for (const c of creatures) c.markMergeDirty();
    saveSettings();
    renderSettings();
  };
  document.querySelectorAll<HTMLButtonElement>('#set-quality button').forEach((b) => {
    b.onclick = () => setQuality(b.dataset.quality as Quality);
  });
  $<HTMLInputElement>('#set-nums').onchange = (e) => {

    settings.numbers = (e.target as HTMLInputElement).checked;
    saveSettings();
    renderSettings();
  };
  document.querySelectorAll<HTMLButtonElement>('#set-theme button').forEach((b) => {
    b.onclick = () => {
      settings.theme = b.dataset.theme as Theme;
      saveSettings();
      renderSettings();
    };
  });
  $<HTMLInputElement>('#set-plain').onchange = (e) => {
    settings.plainText = (e.target as HTMLInputElement).checked;
    saveSettings();
    renderSettings();
    // the other font has other widths (and may still be loading)
    fitTopbar();
    document.fonts.ready.then(fitTopbar);
  };
  document.querySelectorAll<HTMLButtonElement>('#set-seamless button').forEach((b) => {
    b.onclick = () => {
      settings.seamless = b.dataset.seamless as SeamlessMode;
      setSeamlessMode(settings.seamless);
      // each creature drops (or goes on to build) its skin
      for (const c of creatures) c.markMergeDirty();
      saveSettings();
      renderSettings();
      renderMerge();
    };
  });
}
