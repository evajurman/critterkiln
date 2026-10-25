// ---------------------------------------------------------------------------
// The eyes panel: their style, size, spacing, color, lids and finish.

import { EYE_STYLES, type CreatureState, type EyeFinish, type EyeStyle } from '../creature';
import { $, fa, faClassic } from './dom';
import { key } from './stage';
import { commit, creature, eyePair, idle, selected, setEyePair, state } from './state';
import { glowFollowSeg, glowSlider, sceneColorRow } from './widgets';
import { hint } from './hints';

// the on-screen eye card can be folded away (remembered)
const EYES_FOLD_KEY = 'creature-creator/eyes-folded';
let eyesFolded = (() => {
  try {
    return localStorage.getItem(EYES_FOLD_KEY) === '1';
  } catch {
    return false;
  }
})();
export function setEyesFolded(on: boolean) {
  eyesFolded = on;
  try {
    localStorage.setItem(EYES_FOLD_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  $('#eyes-card').classList.toggle('folded', on);
}

/** Eye pairs on the picked part (either side of a mirrored pair), by index into state.eyes.pairs. */
function partEyes(): number[] {
  return state.eyes.pairs.flatMap((p, i) => (creature.eyeBones(p).some((b) => b.def.id === selected) ? [i] : []));
}

export function renderEyes() {
  const e = state.eyes;
  e.style ??= 'googly';
  // the picked part's eyes get the card; a part without any gets an Add button
  const mine = idle ? [] : partEyes();
  $('#eyes-add').hidden = idle;
  $('#eyes-card').hidden = !mine.length;
  $('#eyes-card').classList.toggle('folded', eyesFolded);
  if (!mine.length) return;
  if (!mine.includes(eyePair)) setEyePair(mine[0]);
  const el = $('#eye-styles');
  el.innerHTML = '';
  const options: { id: EyeStyle | 'none'; name: string }[] = [{ id: 'none', name: 'None' }, ...EYE_STYLES];
  const icons: Record<string, string> = {
    none: fa('eye-slash'),
    googly: faClassic('eyes'),
    flat: fa('circle'),
    bead: fa('circle-half-stroke'),
    dot: faClassic('circle-small'),
    button: faClassic('circle-dot'),
  };
  for (const o of options) {
    const btn = document.createElement('button');
    btn.innerHTML = `<span>${icons[o.id]}</span>${o.name}`;
    btn.classList.toggle('active', o.id === 'none' ? !e.enabled : e.enabled && e.style === o.id);
    btn.onclick = () => {
      if (o.id === 'none') e.enabled = false;
      else {
        e.enabled = true;
        e.style = o.id;
      }
      creature.sync();
      commit();
      renderEyes();
    };
    el.append(btn);
  }
  const tabs = $('#eye-pairs');
  tabs.innerHTML = '';
  mine.forEach((i, n) => {
    const btn = document.createElement('button');
    btn.textContent = `${e.pairs[i].single ? 'Eye' : 'Pair'} ${n + 1}`;
    btn.classList.toggle('active', i === eyePair);
    btn.onclick = () => {
      setEyePair(i);
      renderEyes();
    };
    tabs.append(btn);
  });
  const add = document.createElement('button');
  add.textContent = '+ Add';
  add.className = 'add';
  add.onclick = () => {
    // another pair on the same part, a little smaller and lower
    const on = e.pairs[eyePair];
    e.pairs.push({ size: Math.max(0.15, on.size * 0.75), spacing: on.spacing, height: Math.max(0.1, on.height - 0.22), lift: on.lift ?? e.lift, bone: on.bone, single: on.single, turn: on.turn ?? e.turn });
    setEyePair(e.pairs.length - 1);
    e.enabled = true;
    creature.sync();
    commit();
    renderEyes();
  };
  tabs.append(add);
  const del = document.createElement('button');
  del.textContent = 'Remove';
  del.className = 'remove';
  del.title = 'Take these eyes off';
  del.onclick = () => {
    e.pairs.splice(eyePair, 1);
    creature.sync();
    commit();
    renderEyes();
  };
  tabs.append(del);
  const pair = e.pairs[eyePair];
  $<HTMLInputElement>('#eye-single').checked = !!pair.single;
  $<HTMLInputElement>('#eye-size').value = String(pair.size);
  $<HTMLInputElement>('#eye-spacing').value = String(pair.spacing);
  $<HTMLInputElement>('#eye-spacing').disabled = !!pair.single;
  $<HTMLInputElement>('#eye-height').value = String(pair.height);
  // placed by hand: dragging them replaces Spacing and Height
  $('#eye-spacing-row').hidden = $('#eye-height-row').hidden = !!pair.at;
  $('#eye-placed').hidden = !pair.at;
  $('#eye-sliders').style.opacity = e.enabled ? '1' : '.4';
  $<HTMLInputElement>('#eye-lift').value = String(pair.lift ?? e.lift ?? 0);
  $<HTMLInputElement>('#eye-turn').value = String(Math.round(((pair.turn ?? e.turn ?? 0) * 180) / Math.PI));
  // finish and color only apply to the styles made of a material
  // googly and sticker eyes have a pupil to size and point
  const pupils = e.enabled && (e.style === 'googly' || e.style === 'flat');
  $('#eye-pupil-look').hidden = !pupils;
  if (pupils) {
    $('#eye-pupil-title').textContent = e.style === 'googly' ? 'Googly look' : 'Sticker look';
    $('#eye-shine-row').hidden = e.style !== 'googly';
    $<HTMLInputElement>('#eye-shine').value = String(e.shine ?? 1);
    $<HTMLInputElement>('#eye-pupil').value = String(e.pupil ?? 0.5);
    $<HTMLInputElement>('#eye-cat').value = String(e.cat ?? 0);
    $<HTMLInputElement>('#eye-pupil-color').value = e.pupilColor ?? (e.style === 'flat' ? '#151216' : '#1b1720');
    $<HTMLInputElement>('#eye-eyeball-color').value = e.eyeballColor ?? '#ffffff';
    $('#eye-colors-reset').hidden = !e.pupilColor && !e.eyeballColor;
    $<HTMLInputElement>('#eye-look-x').value = String(e.lookX ?? 0);
    // a sticker's loose pupil has fallen to the bottom
    $<HTMLInputElement>('#eye-look-y').value = String(e.lookY ?? (e.style === 'flat' ? -1 : 0));
    // one eye in the middle has nothing to cross with
    $('#eye-cross-row').hidden = e.pairs.every((p) => p.single);
    $<HTMLInputElement>('#eye-cross').value = String(e.cross ?? 0);
  }
  const shaped = e.enabled && (e.style === 'bead' || e.style === 'dot' || e.style === 'button');
  $('#eye-look').hidden = !shaped;
  if (shaped) {
    const finish = e.finish ?? 'body';
    document.querySelectorAll<HTMLButtonElement>('#eye-finish button').forEach((b) => b.classList.toggle('active', b.dataset.finish === finish));
    // options that only mean something on some materials (the ink outline: on a toon part)
    const inkable = creature.eyesCanInk();
    const textured = creature.eyesTextured();
    $('#eye-material-opts').hidden = !inkable && !textured;
    $('#eye-ink-row').hidden = !inkable;
    $('#eye-vary-row').hidden = !textured;
    $<HTMLInputElement>('#eye-ink').checked = !!e.ink;
    $<HTMLInputElement>('#eye-vary').checked = e.vary !== false;
    const current = (e.color ?? (e.style === 'bead' ? '#1d1a22' : '#2a2730')).toLowerCase();
    const sw = $('#eye-swatches');
    sw.innerHTML = '';
    for (const c of EYE_SWATCHES) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c === current);
      b.onclick = () => setEyeLook((x) => (x.color = c));
      sw.append(b);
    }
    $<HTMLInputElement>('#eye-color').value = current;
    $<HTMLInputElement>('#eye-glow').value = String(e.glow ?? 0);
    eyeGlowFollow();
    eyeSceneColors();
    // the lids, crescent and tilt reshape a bead or a dot; a button stays round
    $('#eye-shape').hidden = e.style === 'button';
    $<HTMLInputElement>('#eye-lid-top').value = String(e.lidTop ?? 1);
    $<HTMLInputElement>('#eye-lid-bottom').value = String(e.lidBottom ?? -1);
    $<HTMLInputElement>('#eye-crescent').value = String(e.crescent ?? 0);
    $<HTMLInputElement>('#eye-tilt').value = String(e.tilt ?? 0);
  }
}

const EYE_SWATCHES = ['#1d1a22', '#2a2730', '#3b2a20', '#1f3a5a', '#2f5d3a', '#6a1f2a', '#8a6d3b', '#f4f1ea'];

function setEyeLook(fn: (e: CreatureState['eyes']) => void) {
  fn(state.eyes);
  creature.sync();
  commit();
  renderEyes();
}
let eyeGlowFollow: () => void;
let eyeSceneColors: () => void;

export function initEyesPanel() {
  $('#eyes-fold').onclick = () => setEyesFolded(!eyesFolded);
  for (const k of ['size', 'spacing', 'height'] as const) {
    const input = $<HTMLInputElement>(`#eye-${k}`);
    input.oninput = () => {
      state.eyes.pairs[eyePair][k] = parseFloat(input.value);
      creature.sync();
    };
    input.onchange = () => commit();
  }
  for (const [id, key] of [['#eye-shine', 'shine'], ['#eye-pupil', 'pupil'], ['#eye-cat', 'cat'], ['#eye-look-x', 'lookX'], ['#eye-look-y', 'lookY'], ['#eye-cross', 'cross'], ['#eye-lid-top', 'lidTop'], ['#eye-lid-bottom', 'lidBottom'], ['#eye-crescent', 'crescent'], ['#eye-tilt', 'tilt']] as const) {
    const input = $<HTMLInputElement>(id);
    input.oninput = () => {
      state.eyes[key] = parseFloat(input.value);
      creature.sync();
    };
    input.onchange = () => commit();
  }
  for (const [id, key] of [['#eye-pupil-color', 'pupilColor'], ['#eye-eyeball-color', 'eyeballColor']] as const) {
    const input = $<HTMLInputElement>(id);
    input.oninput = () => {
      state.eyes[key] = input.value;
      creature.sync();
    };
    input.onchange = () => {
      commit();
      renderEyes();
    };
  }
  $('#eye-colors-reset').onclick = () =>
    setEyeLook((e) => {
      delete e.pupilColor;
      delete e.eyeballColor;
    });
  $('#eye-shape-reset').onclick = () =>
    setEyeLook((e) => {
      delete e.lidTop;
      delete e.lidBottom;
      delete e.crescent;
      delete e.tilt;
    });
  $<HTMLInputElement>('#eye-ink').onchange = (ev) =>
    setEyeLook((e) => {
      if ((ev.target as HTMLInputElement).checked) e.ink = true;
      else delete e.ink;
    });
  $<HTMLInputElement>('#eye-vary').onchange = (ev) =>
    setEyeLook((e) => {
      if ((ev.target as HTMLInputElement).checked) delete e.vary;
      else e.vary = false;
    });
  document.querySelectorAll<HTMLButtonElement>('#eye-finish button').forEach((b) => {
    b.onclick = () => setEyeLook((e) => (e.finish = b.dataset.finish as EyeFinish));
  });
  eyeGlowFollow = glowFollowSeg(
    '#eye-glow-follow',
    () => state.eyes,
    (f) =>
      setEyeLook((e) => {
        if (f) e.glowFollow = f;
        else delete e.glowFollow;
      }),
  );
  eyeSceneColors = sceneColorRow($('#eye-scene-colors'), () => state.eyes.color, (c) => setEyeLook((x) => (x.color = c)));
  glowSlider(
    '#eye-glow',
    (v) => {
      if (v > 0) state.eyes.glow = v;
      else delete state.eyes.glow;
      creature.sync();
      eyeGlowFollow();
    },
    () => commit(),
  );
  $<HTMLInputElement>('#eye-color').oninput = (ev) => {
    state.eyes.color = (ev.target as HTMLInputElement).value;
    creature.sync();
  };
  $<HTMLInputElement>('#eye-color').onchange = () => {
    commit();
    renderEyes();
  };
  $<HTMLInputElement>('#eye-lift').oninput = (ev) => {
    state.eyes.pairs[eyePair].lift = parseFloat((ev.target as HTMLInputElement).value);
    creature.sync();
  };
  $<HTMLInputElement>('#eye-lift').onchange = () => commit();
  $<HTMLInputElement>('#eye-single').onchange = (ev) => {
    const pair = state.eyes.pairs[eyePair];
    if ((ev.target as HTMLInputElement).checked) pair.single = true;
    else delete pair.single;
    creature.sync();
    commit();
    renderEyes();
  };
  $<HTMLInputElement>('#eye-turn').oninput = (ev) => {
    state.eyes.pairs[eyePair].turn = Math.round(parseFloat((ev.target as HTMLInputElement).value) * (Math.PI / 180) * 1000) / 1000;
    creature.sync();
  };
  $<HTMLInputElement>('#eye-turn').onchange = () => commit();
  $('#eye-unplace').onclick = () => {
    const pair = state.eyes.pairs[eyePair];
    if (!pair) return;
    delete pair.at;
    delete pair.n;
    creature.sync();
    commit();
    renderEyes();
  };
  $('#eye-front').onclick = () => {
    // undo their part's roll too, so the eyes look where the creature faces
    const pair = state.eyes.pairs[eyePair];
    const on = creature.eyeBones(pair)[0];
    const turn = Math.round(-(on?.def.roll ?? 0) * 1000) / 1000 || 0;
    if ((pair.turn ?? state.eyes.turn ?? 0) === turn) {
      hint('Already facing front', 1200);
      return;
    }
    pair.turn = turn;
    creature.sync();
    commit();
    renderEyes();
    hint('Eyes facing front', 1400);
  };
}
