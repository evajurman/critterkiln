// ---------------------------------------------------------------------------
// The outliner: a row per creature in the scene, with its parts under it, to
// pick, rename, add, copy and remove them.

import * as THREE from 'three';
import { Creature, defaultState, type BoneRT, type CreatureState, type PartState, type Placement } from '../creature';
import { ANIM_KINDS } from '../animate';
import { duplicateLimb } from '../rigs';
import { $, fa, pickHow, type PickHow } from './dom';
import { activate, commit, creature, creatures, idle, makeCreature, save, selected, setCreature, setIdle, state, world } from './state';
import { creatureLabel } from './controls';
import { frameAll } from './framing';
import { exitDraw } from './drawing';
import { placing, startPlacing, stopPlacing } from './arrange';
import { partTree, pickedSrcs, selectAllParts, selectPart } from './partPanel';
import { renderUI } from './panels';
import { freshRig, partName, removePart, rigEdit, setPartName } from './rigEdit';
import { hint, hintOnce } from './hints';

/** creatures whose parts are folded away under their row (the > beside it); the rest show theirs, like a tree */
export const partsShut = new WeakSet<CreatureState>();

export function renderCreatureBar() {
  renderStrip();
  const el = $('#creature-rows');
  el.innerHTML = '';
  // with others around, the camera can frame just this one
  $('#view-bar [data-view="selection"]').hidden = world.creatures.length < 2;
  // one row per creature, like the pieces in Stuff: pick (or rename) it, copy it, or remove it
  world.creatures.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'piece-row creature-row';
    row.classList.toggle('active', i === world.active && !idle);
    const pick = document.createElement('button');
    pick.className = 'piece-pick';
    const color = Object.values(s.parts)[0]?.color ?? '#ccc';
    pick.innerHTML = `<i style="background:${color}"></i>`;
    const name = document.createElement('span');
    name.className = 'creature-name';
    name.textContent = creatureLabel(i);
    pick.append(name);
    pick.title = `${creatureLabel(i)}: click to pick every part · double-click to rename`;
    // a click picks the whole creature (every part); a second, quick one renames it
    pick.onclick = () => {
      const again = lastCreatureClick.i === i && performance.now() - lastCreatureClick.at < 450;
      lastCreatureClick = { i, at: again ? 0 : performance.now() };
      if (again && i === world.active) return renameCreatureRow(el.querySelectorAll<HTMLButtonElement>('.creature-row .piece-pick')[i]);
      if (i !== world.active) activate(i);
      selectAllParts();
      save();
    };
    const dup = document.createElement('button');
    dup.className = 'piece-icon';
    dup.innerHTML = fa('copy');
    dup.title = 'Copy this creature';
    dup.onclick = () => duplicateCreature(i);
    const del = document.createElement('button');
    del.className = 'piece-icon';
    del.innerHTML = fa('trash');
    del.title = world.creatures.length < 2 ? 'The scene needs at least one creature' : 'Remove this creature from the scene';
    del.disabled = world.creatures.length < 2;
    del.onclick = () => removeCreature(i);
    const open = !partsShut.has(s);
    const fold = document.createElement('button');
    fold.className = 'piece-icon parts-fold' + (open ? ' open' : '');
    fold.innerHTML = '<i class="fa-duotone fa-regular fa-chevron-down" aria-hidden="true"></i>';
    fold.title = open ? 'Hide its parts' : 'Show its parts';
    fold.setAttribute('aria-expanded', String(open));
    fold.onclick = () => {
      if (open) partsShut.add(s);
      else partsShut.delete(s);
      renderCreatureBar();
    };
    row.prepend(fold);
    row.append(pick, dup, del);
    el.append(row);
    if (open) el.append(partRows(i));
  });
}

/**
 * One row per part of creature `i` (a pair is one row), each under the part it hangs off and
 * indented a step deeper: its color, name and motion; clicking one picks it, and its icons copy
 * or delete it (with everything on it).
 */
function partRows(i: number): HTMLElement {
  const s = world.creatures[i];
  const c = creatures[i];
  const list = document.createElement('div');
  list.className = 'part-rows';
  const picked = new Set(i === world.active && !idle ? pickedSrcs() : []);
  const pickIt = (id: string, how: PickHow = 'one') => {
    if (i !== world.active || idle) {
      setIdle(false);
      activate(i);
      how = 'one';
    }
    selectPart(id, true, how);
  };
  for (const { bone, depth } of partTree(c)) {
    const p = s.parts[bone.src];
    if (p) list.append(partRow(i, bone, p, depth, picked.has(bone.src), pickIt));
  }
  return list;
}

function partRow(i: number, b: BoneRT, p: PartState, depth: number, active: boolean, pickIt: (id: string, how?: PickHow) => void): HTMLElement {
  const s = world.creatures[i];
  const c = creatures[i];
  const twin = c.list.find((o) => o.def.mirrorOf === b.def.id);
  const anim = s.anims?.[b.def.id] ?? (twin && s.anims?.[twin.def.id]);
  const kind = anim && ANIM_KINDS.find((k) => k.kind === anim.kind);
  const name = b.def.sideSign !== 0 ? b.def.name.replace(/ \((L|R)\)$/, '') : b.def.name;
  const row = document.createElement('div');
  row.className = 'part-row' + (active ? ' active' : '');
  row.style.setProperty('--depth', String(depth));
  row.dataset.bone = b.def.id;
  const btn = document.createElement('button');
  btn.className = 'part-pick';
  btn.innerHTML =
    `<i style="background:${p.color}"></i><span class="part-name">${name}${twin ? ' ×2' : ''}</span>` +
    (p.outline ? `<span class="part-mark" title="Drawn">${fa('check')}</span>` : '') +
    (kind ? `<span class="part-mark" title="Moves: ${kind.name}"><i class="fa-duotone fa-regular fa-${kind.icon}" aria-hidden="true"></i></span>` : '');
  btn.title = (kind ? `${name}: moves (${kind.name})` : name) + ' · Ctrl-click to pick one more · Shift-click to pick everything between · double-click to rename';
  btn.onclick = (e) => {
    // Ctrl: one more part picked (or one less); Shift: everything from the main pick to this one
    if (pickHow(e) !== 'one') {
      pickIt(b.def.id, pickHow(e));
      save();
      return;
    }
    // picking re-draws the list, so a double click lands on a new row: tell it by the time between
    const again = lastPartClick.id === b.def.id && performance.now() - lastPartClick.at < 450;
    lastPartClick = { id: b.def.id, at: again ? 0 : performance.now() };
    pickIt(b.def.id);
    save();
    if (again) renamePartRow(b.def.id);
  };
  // the first part holds everything else: it can't be copied or removed
  const isRoot = !b.parent;
  const dup = document.createElement('button');
  dup.className = 'piece-icon';
  dup.innerHTML = fa('copy');
  dup.title = isRoot ? "The first part holds everything else, so it can't be copied" : `Copy ${name} and everything attached to it`;
  dup.disabled = isRoot;
  dup.onclick = () => {
    pickIt(b.def.id);
    rigEdit((rig) => duplicateLimb(rig, selected), true);
  };
  const del = document.createElement('button');
  del.className = 'piece-icon';
  del.innerHTML = fa('trash');
  del.title = isRoot ? "The first part holds everything else, so it can't be removed" : `Remove ${name} and everything attached to it`;
  del.disabled = isRoot;
  del.onclick = () => {
    pickIt(b.def.id);
    removePart();
  };
  const add = document.createElement('button');
  add.className = 'piece-icon part-add phone-only';
  add.innerHTML = fa(active ? 'check' : 'plus');
  add.title = active ? `Leave ${name} out of the picked parts` : `Pick ${name} too`;
  add.setAttribute('aria-label', add.title);
  add.onclick = () => {
    pickIt(b.def.id, 'toggle');
    save();
  };
  row.append(add, btn, dup, del);
  return row;
}

let lastPartClick = { id: '', at: 0 };
let lastCreatureClick = { i: -1, at: 0 };

/** Turns the picked part's row (in the creature bar) into a name box: Enter or clicking away keeps it, Escape doesn't. */
function renamePartRow(id: string) {
  const row = [...document.querySelectorAll<HTMLElement>('#creature-rows .part-row')].find((r) => r.dataset.bone === id);
  const label = row?.querySelector('.part-name');
  if (!row || !label) return;
  const input = document.createElement('input');
  input.className = 'text chip-name';
  input.maxLength = 60;
  input.value = partName();
  label.replaceWith(input);
  input.onclick = (e) => e.stopPropagation(); // clicking in the box doesn't pick the part again
  input.focus();
  input.select();
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    if (keep && input.value.trim() && input.value.trim() !== partName()) setPartName(input.value, true);
    else renderCreatureBar();
  };
  input.onkeydown = (e) => {
    e.stopPropagation(); // typing a name isn't a shortcut (Backspace would delete the part)
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

/** Turns the active creature's row into a name box: Enter or clicking away keeps it, Escape doesn't. */
function renameCreatureRow(btn: HTMLButtonElement) {
  const before = state.name;
  const input = document.createElement('input');
  input.className = 'text chip-name';
  input.maxLength = 60;
  input.placeholder = `Creature ${world.active + 1}`;
  input.value = state.name ?? '';
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    state.name = keep ? input.value.trim() || undefined : before;
    renderCreatureBar();
    if (keep && state.name !== before) commit();
  };
  input.onkeydown = (e) => {
    e.stopPropagation(); // typing a name isn't a shortcut
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

/** The Scene list folded: a dot per creature (a click picks every part of it), then add, and unfold. */
function renderStrip() {
  const strip = $('#scene-strip');
  const unfold = document.createElement('button');
  unfold.className = 'strip-unfold';
  unfold.innerHTML = '<i class="fa-duotone fa-regular fa-chevrons-right" aria-hidden="true"></i>';
  unfold.title = 'Unfold the Scene list';
  unfold.setAttribute('aria-label', 'Unfold the Scene list');
  unfold.onclick = () => setSceneFolded(false);
  const dots = world.creatures.map((s, i) => {
    const b = document.createElement('button');
    b.className = 'strip-creature' + (i === world.active && !idle ? ' active' : '');
    b.style.background = Object.values(s.parts)[0]?.color ?? '#ccc';
    b.title = `${creatureLabel(i)}: click to pick every part`;
    b.setAttribute('aria-label', creatureLabel(i));
    b.onclick = () => {
      if (i !== world.active) activate(i);
      selectAllParts();
      save();
    };
    return b;
  });
  const add = document.createElement('button');
  add.className = 'strip-add';
  add.innerHTML = '<i class="fa-duotone fa-regular fa-plus" aria-hidden="true"></i>';
  add.title = 'Add a new creature to the scene';
  add.setAttribute('aria-label', 'Add a creature');
  add.onclick = () => $('#cr-add').click();
  strip.replaceChildren(unfold, ...dots, add);
}

const FOLD_KEY = 'creature-creator/scene-folded';
/** Folded or not, as chosen by hand; unset: folded in a smaller window */
let foldChoice: boolean | null = null;
try {
  const v = localStorage.getItem(FOLD_KEY);
  if (v === 'true' || v === 'false') foldChoice = v === 'true';
} catch {}
const smallWindow = matchMedia('(max-width: 1440px)');
function applyFold() {
  $('#app').classList.toggle('scene-folded', foldChoice ?? smallWindow.matches);
}
function setSceneFolded(v: boolean) {
  foldChoice = v;
  try {
    localStorage.setItem(FOLD_KEY, String(v));
  } catch {}
  applyFold();
}

/** A free spot on the floor to the right of everyone else. */
export function freeSpot(): Placement {
  let maxX = -Infinity;
  for (const c of creatures) {
    const box = new THREE.Box3();
    c.root.updateMatrixWorld(true);
    for (const m of c.meshes()) box.expandByObject(m);
    if (!box.isEmpty()) maxX = Math.max(maxX, box.max.x);
  }
  return { x: Number.isFinite(maxX) ? Math.round((maxX + 0.9) * 100) / 100 : 0, z: 0, yaw: 0 };
}

function addCreature(s: CreatureState) {
  setIdle(false);
  exitDraw();
  world.creatures.push(s);
  creatures.push(makeCreature(s));
  activate(world.creatures.length - 1);
  commit();
  renderUI();
  frameAll();
}
function duplicateCreature(i: number) {
  const src = world.creatures[i];
  const s = structuredClone(src);
  delete s.workbench;
  s.name = src.name?.trim() ? `${src.name.trim()} copy` : undefined;
  // same size, turn and height; just moved over to free floor
  const spot = freeSpot();
  s.placement = { ...(src.placement ?? spot), x: spot.x, z: spot.z };

  addCreature(s);
}
function removeCreature(i: number) {
  if (world.creatures.length < 2) return;
  const label = creatureLabel(i); // no are-you-sure: undo brings it back
  exitDraw();
  stopPlacing();
  if (i !== world.active) activate(i);
  creatures[i].dispose();
  creatures.splice(i, 1);
  world.creatures.splice(i, 1);
  setCreature(undefined as unknown as Creature); // the old one is gone; don't try to reset it
  activate(Math.max(0, i - 1));
  commit();
  renderUI();
  hint(`Removed ${label}: Ctrl+Z brings it back`, 2600);
}

export function initCreatureBar() {
  applyFold();
  smallWindow.addEventListener('change', applyFold);
  $('#scene-fold').onclick = () => setSceneFolded(true);
  $('#cr-add').onclick = () => {
    const s = defaultState(freshRig(state.rig));
    s.style = state.style;
    s.materialSettings = structuredClone(state.materialSettings);
    s.placement = freeSpot();
    addCreature(s);
    hintOnce('Added a new creature: click any creature to switch between them', 2600);
  };
  $('#cr-place').onclick = () => {
    if (!placing) return startPlacing();
    stopPlacing();
    commit();
  };
}
