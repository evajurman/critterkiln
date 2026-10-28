// ---------------------------------------------------------------------------
// The outliner: a row per creature in the scene, with its parts under it, to
// pick, rename, add, copy and remove them.

import * as THREE from 'three';
import { Creature, defaultState, type Attachment, type BoneRT, type CreatureState, type PartState, type Placement } from '../creature';
import { ANIM_KINDS, STUFF_KINDS } from '../animate';
import { DUPLICATE_OFFSET, duplicateLimb, nextRoot } from '../rigs';
import { movedMarking } from '../markings';
import { chooseCopy, kitOf, linkedCopies, linkOf, thingTop, unlink } from './kits';
import { editInStuff, solo } from './focus';
import { openContextMenu, SEP } from '../contextMenu';
import { keyLabel, type ShortcutId } from '../shortcuts';
import { clip, copyPicked, pasteClip } from './clipboard';
import { enterDraw, exitDraw } from './drawing';
import { $, fa, pickHow, type PickHow } from './dom';
import { activate, commit, creature, creatures, idle, makeCreature, mode, save, selected, setCreature, setIdle, state, world } from './state';
import { creatureLabel } from './controls';
import { frameAll, partToFloor } from './framing';
import { stopPlacing } from './arrange';
import { partTree, pickedSrcs, selectAllParts, selectPart } from './partPanel';
import { renderUI } from './panels';
import { freshRig, partName, removePart, rigEdit, setPartName } from './rigEdit';
import { hint, hintOnce } from './hints';
import { creatureId, setOffstage } from './riders';

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
    // the Stuff tab lists just its bench; the rest, everyone but the bench
    if (!!s.table !== (mode === 'stuff')) return;
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
    // a creature worn by another says so; one off stage can be brought back on
    const host = s.rides && world.creatures.findIndex((o) => o.id === s.rides!.on);
    if (host !== undefined && host >= 0) {
      const tag = document.createElement('span');
      tag.className = 'creature-tag';
      tag.innerHTML = fa('paperclip');
      tag.title = `Rides on ${creatureLabel(host)} (right-click it in the view to take it off)`;
      name.append(tag);
    }
    const stage = document.createElement('button');
    stage.className = 'piece-icon' + (s.offstage ? ' on' : '');
    stage.innerHTML = fa(s.offstage ? 'eye-slash' : 'eye');
    stage.title = s.offstage ? 'Off stage: only seen while you edit it, or scattered. Click to bring it back' : 'Take it off stage: only seen while you edit it, or where it’s scattered over another creature';
    stage.onclick = () => setOffstage(creatures[i], !s.offstage);
    row.classList.toggle('offstage', !!s.offstage);
    row.append(pick, stage, dup, del);
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
  // (mid-swap, a creature can be in the scene before it's built)
  if (!c) return list;
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
    // (the Stuff tab's bench stand is hidden: only what's on it is listed)
    if (p && !p.hidden) list.append(partRow(i, bone, p, depth, picked.has(bone.src), pickIt));
  }
  return list;
}

/**
 * The picked part and everything on it, copied just below it: its drawing, looks
 * and markings (moved with it). `link`: its top joins those linked duplicates;
 * null: a copy of its own; undefined: as the part is.
 */
function duplicateHere(link: string | null | undefined) {
  rigEdit((rig) => {
    const copies = duplicateLimb(rig, selected);
    const by = new THREE.Matrix4().makeTranslation(...DUPLICATE_OFFSET);
    copies.forEach((c, n) => {
      const from = state.parts[c.from];
      if (!from || state.parts[c.to]) return;
      const p = structuredClone(from);
      if (p.markings) p.markings = p.markings.map((mk) => movedMarking(mk, by));
      // (the top is the first copy, and its twin)
      if (n === 0 || copies[0].to.replace(/[LR]$/, '') === c.to.replace(/[LR]$/, '')) {
        if (link) p.link = link;
        else if (link === null) delete p.link;
      }
      state.parts[c.to] = p;
    });
    return copies;
  }, true);
}

function partRow(i: number, b: BoneRT, p: PartState, depth: number, active: boolean, pickIt: (id: string, how?: PickHow) => void): HTMLElement {
  const s = world.creatures[i];
  const c = creatures[i];
  const twin = c.list.find((o) => o.def.mirrorOf === b.def.id);
  const anim = s.anims?.[b.def.id] ?? (twin && s.anims?.[twin.def.id]);
  // (or a move on the part it hangs off: orbit, spin...)
  const move = s.moves?.[b.def.id] ?? (twin && s.moves?.[twin.def.id]);
  const kind = anim ? ANIM_KINDS.find((k) => k.kind === anim.kind) : move && STUFF_KINDS.find((k) => k.kind === move.kind);
  // the top of a thing (a part kept apart from the body), and whether it's one of linked duplicates
  const thing = !!p.apart && !(b.parent && s.parts[b.parent.src]?.apart);
  const linked = thing && !!p.link && linkedCopies(p.link).length > 1;
  const name = b.def.sideSign !== 0 ? b.def.name.replace(/ \((L|R)\)$/, '') : b.def.name;
  const row = document.createElement('div');
  row.className = 'part-row' + (active ? ' active' : '');
  row.style.setProperty('--depth', String(depth));
  row.dataset.bone = b.def.id;
  const btn = document.createElement('button');
  btn.className = 'part-pick';
  btn.innerHTML =
    `<i style="background:${p.color}"></i><span class="part-name">${name}${twin ? ' ×2' : ''}</span>` +
    (thing ? `<span class="part-mark" title="A thing: kept apart from the body">${fa('paperclip')}</span>` : '') +
    (linked ? `<span class="part-mark" title="A linked duplicate: change one and the rest change too (right-click to unlink)">${fa('link')}</span>` : '') +
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
  // the first part holds everything else: it can't be copied, and removing it leaves the rest (one of them takes its place)
  const isRoot = !b.parent;
  const dup = document.createElement('button');
  dup.className = 'piece-icon';
  dup.innerHTML = fa('copy');
  dup.title = isRoot ? "The first part holds everything else, so it can't be copied" : `Copy ${name} and everything attached to it`;
  dup.disabled = isRoot;
  dup.onclick = () => {
    pickIt(b.def.id);
    const top = thingTop(creature, selected);
    const picked = creature.bones.get(selected);
    // a thing kept apart from the body: a linked duplicate, or a copy of its own
    if (top && (top === picked || creature.twinOf(top) === picked)) {
      const r = dup.getBoundingClientRect();
      chooseCopy(r.left, r.bottom + 4, (linked) => duplicateHere(linked ? linkOf(top) : null));
    } else duplicateHere(undefined);
  };
  const del = document.createElement('button');
  del.className = 'piece-icon';
  del.innerHTML = fa('trash');
  const next = isRoot ? nextRoot(s.rig, b.def.id) : null;
  del.title = isRoot ? (next ? `Remove ${name} on its own: what's on it stays, hanging off ${next.name}` : "Nothing on it could take its place, so it can't be removed") : `Remove ${name} and everything attached to it`;
  del.disabled = isRoot && !next;
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
  // right-click: what can be done to it, picked first
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pickIt(b.def.id);
    rowMenu(e.clientX, e.clientY, b.def.id);
  });
  return row;
}

const ctx = (n: string) => `fa-duotone fa-regular fa-${n}`;

/** A part's row, right-clicked: renaming, drawing, duplicating (linked or its own), unlinking, keeping it in My stuff, deleting. */
function rowMenu(x: number, y: number, id: string) {
  const b = creature.bones.get(id);
  if (!b) return;
  const p = state.parts[b.src];
  const name = (b.def.sideSign !== 0 ? b.def.name.replace(/ \((L|R)\)$/, '') : b.def.name) || 'Part';
  const isRoot = !b.parent;
  const top = thingTop(creature, id);
  const isTop = !!top && (top === b || creature.twinOf(top) === b);
  const copies = isTop && p.link ? linkedCopies(p.link) : [];
  const here = copies.filter((c) => world.creatures[c.i] === state && c.top !== top!.def.id);
  const key = (k: ShortcutId) => keyLabel(k) || undefined;
  openContextMenu(x, y, name, [
    { label: 'Rename', icon: ctx('pen'), run: () => renamePartRow(id) },
    { label: 'Draw shape', icon: ctx('pencil'), key: key('draw'), run: () => enterDraw({ kind: 'bone', boneId: id }) },
    SEP,
    ...(isTop
      ? [
          { label: 'Linked duplicate', icon: ctx('link'), note: 'Change one and every linked copy changes too', run: () => duplicateHere(linkOf(top!)) },
          { label: 'Unique copy', icon: ctx('clone'), note: 'A copy of its own, to change on its own', run: () => duplicateHere(null) },
        ]
      : [{ label: 'Duplicate', icon: ctx('clone'), disabled: isRoot, title: isRoot ? 'The first part holds everything else' : undefined, run: () => duplicateHere(undefined) }]),
    { label: 'Copy', icon: ctx('copy'), key: key('copy'), disabled: isRoot, run: () => copyPicked() },
    clip && { label: 'Paste onto it', icon: ctx('paste'), key: key('paste'), run: () => pasteClip(null) },
    isTop && !state.table && {
      label: 'Edit in Stuff',
      icon: ctx('briefcase'),
      note: 'On its own, on the blueprint: every copy follows',
      run: () => {
        const kit = kitOf(top!);
        if (kit) editInStuff(kit);
        else hint('Draw it first', 1600, true);
      },
    },
    isTop && { label: 'Solo', icon: ctx('eye'), note: 'Just this thing, where it is: the rest hidden until Done', run: () => solo(id) },
    copies.length > 1 && { label: 'Unlink', icon: ctx('link-slash'), note: `Its own from now on: the other ${copies.length - 1 === 1 ? 'copy stops' : `${copies.length - 1} copies stop`} following it, and it them`, run: () => unlink(top!) },
    here.length > 0 && {
      label: 'Pick its linked copies',
      icon: ctx('object-group'),
      title: 'Pick every linked copy on this creature too',
      run: () => {
        for (const c of here) selectPart(c.top, false, 'toggle');
        save();
      },
    },
    SEP,
    !isRoot && {
      label: 'Keep apart from the body',
      icon: ctx('link-slash'),
      checked: !!p.apart,
      title: 'Never blends into the parts it touches: worn things like a hat or glasses',
      run: () => {
        if (p.apart) delete p.apart;
        else p.apart = true;
        creature.sync();
        commit();
        renderUI();
      },
    },
    !isRoot && { label: 'Part to floor', icon: ctx('arrow-down-to-line'), title: 'Move it straight down until its lowest point touches the floor', run: () => partToFloor(id) },
    SEP,
    {
      label: 'Delete',
      icon: 'fa-slab-duo fa-regular fa-trash',
      key: key('delete'),
      danger: true,
      disabled: isRoot && !nextRoot(state.rig, b.def.id),
      title: isRoot ? 'Just this part: what’s on it stays, hanging off the part that takes its place' : `${name} and everything attached to it`,
      run: removePart,
    },
  ]);
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
  strip.replaceChildren(unfold, ...dots, ...(mode === 'stuff' ? [] : [add]));
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
  creatureId(s);
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
  // a copy of its own: it stands on the floor, beside the rest
  delete s.id;
  delete s.rides;
  s.keepFloor = src.rides ? true : src.keepFloor;
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
}
