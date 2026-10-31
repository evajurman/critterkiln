// ---------------------------------------------------------------------------
// Working on a thing on its own. The Stuff tab: the blueprint bench, a green
// stage with nothing else about, the thing standing on a grid and changed
// with the same part tools; the bench's copy is a linked duplicate, so every
// creature wearing it follows. Solo: right where it's worn, everything else
// hidden; Done (or Esc) brings the rest back. And what a scatter scatters:
// changed where it stands (off stage), Done going back to the creature it's
// scattered over.

import * as THREE from 'three';
import { defaultState, type BoneRT, type CreatureState } from '../creature';
import { deleteLimb, type RigState } from '../rigs';
import { uid } from '../stuff';
import { $ } from './dom';
import { activate, commit, creature, creatures, makeCreature, mode, setIdle, state, world } from './state';
import { exitDraw, drawState } from './drawing';
import { stopPlacing } from './arrange';
import { frameCreature, flyTo } from './framing';
import { camera, scene, sceneOrtho, setOrtho } from './stage';
import { controls } from './controls';
import { selectPart } from './partPanel';
import { renderUI, setMode } from './panels';
import { growThingAt } from './rigEdit';
import { putOnTable, thingTop, type Kit } from './kits';
import { backdrop, paintBackdrop } from './floor';
import { invalidate } from './loop';
import { hint } from './hints';
import { editCreature } from './riders';
import { creatureLabel } from './controls';
import { freeSpot } from './creatureBar';

/** the blueprint's color (the Stuff tab's own backdrop) */
const BLUEPRINT = '#adcfa5';

// ---- Solo ----

let soloTop: string | null = null;

/** While on the bench, or in Solo, only the creature being worked on shows. */
export const othersHidden = () => !!soloTop || mode === 'stuff';

/** In Solo: the parts shown (the thing's, and its twin's), worked out afresh as it's changed. */
export function soloIds(): Set<string> | null {
  if (!soloTop) return null;
  const top = creature.bones.get(soloTop);
  if (!top) return null;
  const ids = new Set<string>();
  const add = (b: BoneRT) => {
    ids.add(b.def.id);
    for (const o of creature.list) if (o.parent === b) add(o);
  };
  add(top);
  const twin = creature.twinOf(top);
  if (twin) add(twin);
  return ids;
}

/** Just this thing, where it's worn: the rest of the creature (and everyone else) hidden, the view on it. */
export function solo(id: string) {
  const top = thingTop(creature, id);
  if (!top) return;
  leaveSolo();
  stopPlacing();
  soloTop = top.def.id;
  creature.solo = soloIds();
  selectPart(top.def.id, false);
  const box = new THREE.Box3();
  for (const sid of creature.solo ?? []) {
    const m = creature.bones.get(sid)?.mesh;
    if (m) box.expandByObject(m);
  }
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length() * 0.9, 0.3);
    const dir = camera.position.clone().sub(controls.target).normalize();
    flyTo(c.clone().addScaledVector(dir, r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), c);
  }
  $('#focus-name').textContent = `Solo: ${top.def.name.replace(/ \((L|R)\)$/, '')}`;
  $('#focus-name').title = '';
  $('#focus-bar').hidden = false;
  hint('Just this thing: change it like any part. Done (or Esc) brings the rest back', 2600);
  invalidate();
}

export function leaveSolo() {
  if (!soloTop) return;
  soloTop = null;
  creature.solo = null;
  $('#focus-bar').hidden = true;
  renderUI();
  invalidate();
}

export const inSolo = () => !!soloTop;

// ---- what a scatter scatters, being changed ----

/** while one is: it (by id), and the creature and view to go back to */
let scattered: { id: string; from: string; pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

/** Change what a scatter scatters (a creature kept off stage, usually): Done (or Esc) goes back to the one it's scattered over. */
export function editScattered(id: string) {
  leaveSolo();
  const from = state.id;
  if (!from || from === id) return editCreature(id);
  // made to be scattered, it was laid out with Z out of the surface: on its own, it stands up (Z up) on free floor
  const at = creatures.find((c) => c.state.id === id);
  if (at?.state.offstage && !at.state.placement) {
    at.state.placement = { ...freeSpot(), quat: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
    at.applyPlacement();
  }
  if (!scattered || scattered.id !== id) scattered = { id, from: scattered?.from ?? from, pos: scattered?.pos ?? camera.position.clone(), target: scattered?.target ?? controls.target.clone() };
  editCreature(id);
  const i = world.creatures.findIndex((s) => s.id === id);
  $('#focus-name').textContent = `Editing: ${creatureLabel(i)}`;
  $('#focus-name').title = 'Every copy follows what you do to it';
  $('#focus-bar').hidden = false;
}

/** Back to the creature it's scattered over, as it was seen (`go` false: just let go, staying where things are). */
export function leaveScattered(go = true) {
  if (!scattered) return;
  const { from, pos, target } = scattered;
  scattered = null;
  $('#focus-bar').hidden = true;
  if (!go) return;
  if (drawState) exitDraw();
  const i = world.creatures.findIndex((s) => s.id === from);
  if (i >= 0) {
    activate(i);
    flyTo(pos, target);
  }
  renderUI();
  invalidate();
  hint('Back', 1200);
}

export const inScattered = () => !!scattered;

/** Gone to another creature some other way (clicked it, say): the Done bar goes too. */
export function checkScattered() {
  if (scattered && state.id !== scattered.id) leaveScattered(false);
}

// ---- the Stuff tab's bench ----

/** a grid under the bench's thing, like the blueprint it's drawn on (in the scene only while the tab is open: hidden, it still showed through) */
const grid = new THREE.GridHelper(3, 30, 0x5f9a56, 0x8fbf86);

/** where things were left off: the creature the bench took over from, and the view of it */
let back: { i: number; pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
/** what to put on the bench as the tab opens (null: something new; undefined: what was there last) */
let pending: Kit | null | undefined;
let lastKit: Kit | null = null;

/** The bench: an invisible stand (its one part, hidden) with the thing standing on it at floor level. */
function benchCreature(): CreatureState {
  const rig: RigState = { base: 'custom', name: 'Bench', headId: 'bench', bones: [{ id: 'bench', name: 'Bench', start: [0, -0.2, 0], end: [0, 0, 0], side: [1, 0, 0], width: 0.2 }] };
  const s = defaultState(rig, '#c9ccd6');
  s.parts.bench = { ...s.parts.bench, hidden: true };
  return {
    ...s,
    id: uid(),
    name: 'Stuff',
    table: true,
    offstage: true,
    keepFloor: false,
    placement: { x: 0, z: 0, yaw: 0 },
    eyes: { ...s.eyes, enabled: false, pairs: [] },
  };
}

/** The bench's creature index, made if it isn't out. */
function benchIndex(): number {
  let i = world.creatures.findIndex((s) => s.table);
  if (i < 0) {
    const s = benchCreature();
    world.creatures.push(s);
    creatures.push(makeCreature(s));
    i = world.creatures.length - 1;
  }
  return i;
}

/** Opening the Stuff tab: the bench out, the blueprint showing, the view on it (see setMode). */
export function enterBench() {
  leaveSolo();
  leaveScattered(false);
  if (drawState) exitDraw();
  stopPlacing();
  if (!back || !world.creatures[back.i] || world.creatures[back.i].table) {
    back = { i: world.active, pos: camera.position.clone(), target: controls.target.clone() };
  }
  const i = benchIndex();
  setIdle(false);
  activate(i);
  paintBackdrop(BLUEPRINT);
  setOrtho(true);
  scene.add(grid);
  const kit = pending !== undefined ? pending : lastKit;
  pending = undefined;
  const has = creature.list.some((b) => b.parent?.def.id === 'bench');
  if (kit || kit === null || !has) putOnBench(kit ?? null, false);
  frameCreature(new THREE.Vector3(0, 0.45, 1));
  renderUI();
  invalidate();
}

/** Leaving the Stuff tab: the bench put away (what was made on it is in My stuff, and on whatever wears it), back where you were. */
export function leaveBench() {
  if (drawState) exitDraw();
  grid.removeFromParent();
  paintBackdrop(backdrop);
  setOrtho(sceneOrtho);
  commit();
  const i = world.creatures.findIndex((s) => s.table);
  const to = back && back.i !== i && world.creatures[back.i] ? back.i : world.creatures.findIndex((s) => !s.table);
  activate(Math.max(0, to));
  if (i >= 0) {
    creatures[i].dispose();
    creatures.splice(i, 1);
    world.creatures.splice(i, 1);
    if (world.active > i) world.active--;
    activate(world.active);
  }
  if (back) flyTo(back.pos, back.target);
  back = null;
  renderUI();
  invalidate();
}

/** Something on the bench: `kit` from My stuff (every copy follows what's done to it here), or (null) something new, drawn straight away. */
export function putOnBench(kit: Kit | null, rebuild = true) {
  if (drawState) exitDraw();
  lastKit = kit;
  const i = benchIndex();
  const s = world.creatures[i];
  // whatever was on it goes (it's in My stuff already)
  for (const d of s.rig.bones.filter((b) => b.parent === 'bench')) {
    for (const r of deleteLimb(s.rig, d.id)) for (const k of [r.id, r.id + 'L', r.id + 'R']) {
      delete s.parts[k];
      delete s.moves?.[k];
    }
  }
  creatures[i].dispose();
  creatures[i] = makeCreature(s);
  activate(i);
  const bench = creature.bones.get('bench')!;
  let top: string | null = null;
  if (kit) {
    top = putOnTable(creature, kit, bench);
    creatures[i].dispose();
    creatures[i] = makeCreature(state);
    activate(i);
  }
  if (rebuild) renderUI();
  if (top && creature.bones.has(top)) {
    selectPart(top, false);
    hint(`${kit!.name} on its own: change it like any part, and every creature wearing it follows`, 2800);
  } else {
    // something new, standing up from the middle of the bench
    selectPart('bench', false);
    growThingAt(bench, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
  }
  invalidate();
}

/** Work on a thing on its own, in the Stuff tab: `kit` (from My stuff), or (null) something new. */
export function editInStuff(kit: Kit | null) {
  if (mode === 'stuff') return putOnBench(kit);
  pending = kit;
  setMode('stuff');
}

/** Any bench left over (a reload while one was out, a saved scene): gone before the scene is built. */
export function clearTables(w: { creatures: CreatureState[]; active: number }) {
  const before = w.creatures.length;
  w.creatures = w.creatures.filter((s) => !s.table);
  if (w.creatures.length !== before) w.active = Math.max(0, Math.min(w.active, w.creatures.length - 1));
  back = null;
}

export function initFocus() {
  $('#focus-done').onclick = () => (scattered ? leaveScattered() : leaveSolo());
}
