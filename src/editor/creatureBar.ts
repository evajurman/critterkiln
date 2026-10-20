// ---------------------------------------------------------------------------
// The creature switcher: a row per creature in the scene, with its parts under
// it, to pick, rename, add, copy and remove them.

import * as THREE from 'three';
import { Creature, defaultState, type BoneRT, type CreatureState, type PartState, type Placement } from '../creature';
import { ANIM_KINDS } from '../animate';
import { duplicateLimb } from '../rigs';
import { $, fa } from './dom';
import { activate, commit, creature, creatures, idle, makeCreature, save, selected, setCreature, setIdle, state, world } from './state';
import { creatureLabel } from './controls';
import { frameAll } from './framing';
import { exitDraw } from './drawing';
import { placing, startPlacing, stopPlacing } from './arrange';
import { flashPart, selectPart } from './partPanel';
import { renderUI } from './panels';
import { freshRig, partName, removePart, rigEdit, setPartName } from './rigEdit';
import { hint, hintOnce } from './hints';

/** creatures whose parts are shown under their row (the > beside it) */
export const partsOpen = new WeakSet<CreatureState>();

export function renderCreatureBar() {
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
    pick.title = i === world.active && !idle ? `${creatureLabel(i)}: click to rename` : creatureLabel(i);
    pick.onclick = () => {
      if (i === world.active && !idle) return renameCreatureRow(pick);
      setIdle(false);
      activate(i);
      flashPart();
      save();
      renderUI();
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
    const open = partsOpen.has(s);
    const fold = document.createElement('button');
    fold.className = 'piece-icon parts-fold' + (open ? ' open' : '');
    fold.innerHTML = '<i class="fa-duotone fa-regular fa-chevron-down" aria-hidden="true"></i>';
    fold.title = open ? 'Hide its parts' : 'Show its parts';
    fold.setAttribute('aria-expanded', String(open));
    fold.onclick = () => {
      if (open) partsOpen.delete(s);
      else partsOpen.add(s);
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
  const picked = i === world.active && !idle ? creature.bones.get(selected)?.src : undefined;
  // a pair is listed by its left twin, so a part on the right twin hangs off that row too
  const row = (b: BoneRT) => (b.def.mirrorOf ? (c.bones.get(b.def.mirrorOf) ?? b) : b);
  const kids = new Map<BoneRT | null, BoneRT[]>();
  for (const b of c.list.filter((o) => !o.def.mirrorOf)) {
    const up = b.parent ? row(b.parent) : null;
    kids.set(up, [...(kids.get(up) ?? []), b]);
  }
  const pickIt = (id: string) => {
    if (i !== world.active || idle) {
      setIdle(false);
      activate(i);
    }
    selectPart(id);
  };
  const add = (b: BoneRT, depth: number) => {
    const p = s.parts[b.src];
    if (p) list.append(partRow(i, b, p, depth, b.src === picked, pickIt));
    for (const k of kids.get(b) ?? []) add(k, depth + 1);
  };
  for (const b of kids.get(null) ?? []) add(b, 0);
  return list;
}

function partRow(i: number, b: BoneRT, p: PartState, depth: number, active: boolean, pickIt: (id: string) => void): HTMLElement {
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
  btn.title = (kind ? `${name}: moves (${kind.name})` : name) + ' · double-click to rename';
  btn.onclick = () => {
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
  row.append(btn, dup, del);
  return row;
}

let lastPartClick = { id: '', at: 0 };

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
