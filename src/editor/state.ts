import * as THREE from 'three';
import { Creature, defaultState, type CreatureState } from '../creature';
import { bump, checkScene } from '../achievements';
import { type Thing } from '../stuff';
import { migrateMarkings } from '../markings';
import { stopMarkTools } from '../markingPanel';
import { type Tab } from '../layout';
import { RIGS, expandRig, movedBases, reparentAll, rigFromTemplate, type RigState, type V3 } from '../rigs';
import { animSecs, hint, invalidate, queueCreationSave, rehang, renderSceneColors, renderUI, rigPrefs, sceneName, sizesIn } from '../main';
import { $ } from './dom';
import { key, KEY_AT, lightSpin, scene } from './stage';
import { updateSkeletonVisibility } from './controls';
import { drawState, exitDraw } from './drawing';
import { autosaveThing, syncWorkbench, workbench } from './workbench';
import { deselectAttachment, selectAttachment, selectedAttachment } from './attach';
import { placing, startPlacing, stopPlacing } from './arrange';
import { partsOpen } from './creatureBar';

// state + history

/**
 * The whole scene: several creatures, one of which is active. `state` and
 * `creature` always point at the active one, so every panel and tool works on
 * whichever creature is selected.
 */
export interface World {
  creatures: CreatureState[];
  active: number;
  /** the thing on the Stuff workbench (shared by the whole scene) */
  workbench?: Thing;
  /** scene name, used for .scene files */
  name?: string;
  /** how long one whole animation loop takes, seconds (Animate tab) */
  animSecs?: number;
}

const WORLD_KEY = 'creature-creator/world';
const OLD_KEY = 'creature-creator/v1';
/** which of My creations the open scene is (kept apart from the world, so undo can't change it) */
export const CREATION_KEY = 'critterkiln/creation';
export let loadedWorld: World | null;
export let world: World;
export function setWorld(v: typeof world) {
  world = v;
}
/** The open scene's place in My creations. */
export const opened = {
  id: localStorage.getItem(CREATION_KEY),
  created: 0,
  thumb: undefined as string | undefined,
  /** a scene only joins the library once something's been done to it (or it came from somewhere) */
  keep: false,
  /** what was last written, so an unchanged scene isn't saved again */
  savedJson: '',
  timer: 0,
  /** how many times the save has waited for a drag or skin to finish */
  waits: 0,
  /** writes queue up so they land in order */
  writing: Promise.resolve(),
};
export let state: CreatureState;
export function setState(v: typeof state) {
  state = v;
}
export const creatures: Creature[] = [];
export let creature: Creature;
export function setCreature(v: typeof creature) {
  creature = v;
}
/** redraws each color picker's "In the scene" row (see sceneColorRow) */
export const sceneColorRows: (() => void)[] = [];
export let selected = '';
export function setSelected(v: typeof selected) {
  selected = v;
}
/** Nothing picked: no creature or part shows as selected (no handles, no part editor) until one is clicked. */
export let idle = true;
export function setIdle(v: typeof idle) {
  idle = v;
}
/** Shape, Look, a tab people made (src/layout.ts), or Stuff */
export type Mode = Tab | 'stuff';
export let mode: Mode = 'shape';
export function setModeValue(v: typeof mode) {
  mode = v;
}
export let eyePair = 0;
export function setEyePair(v: typeof eyePair) {
  eyePair = v;
}

export function freshWorld(): World {
  return { creatures: [defaultState(rigFromTemplate(RIGS[0]))], active: 0 };
}

function loadWorld(): World | null {
  try {
    const raw = localStorage.getItem(WORLD_KEY);
    if (raw) {
      const w = JSON.parse(raw) as World;
      const list = (w.creatures ?? []).map(migrate).filter((s): s is CreatureState => !!s);
      if (list.length) return { creatures: list, active: Math.min(Math.max(0, w.active ?? 0), list.length - 1), workbench: w.workbench, name: w.name, animSecs: w.animSecs };
    }
    // the single-creature autosave from before scenes existed
    const old = localStorage.getItem(OLD_KEY);
    const s = old ? migrate(JSON.parse(old)) : null;
    if (s) {
      const workbench = s.workbench;
      delete s.workbench;
      return { creatures: [s], active: 0, workbench };
    }
  } catch {
    /* fall through to a fresh scene */
  }
  return null;
}

/** Bring a saved creature (autosave or file) up to the current format. */
export function migrate(data: unknown): CreatureState | null {
  try {
    const s = data as CreatureState & { rigId?: string };
    if (!s || typeof s !== 'object' || !s.parts) return null;
    // saves from before rigs were editable: adopt the template, drop the old-format pose
    if (!s.rig) {
      const t = RIGS.find((r) => r.id === s.rigId);
      if (!t) return null;
      s.rig = rigFromTemplate(t);
      s.pose = {};
      delete s.rigId;
    }
    // from the pose-keyframes try: a creature closed mid-Animate gets its own pose back
    const kf = s as { keys?: unknown; animBase?: { pose: CreatureState['pose']; root: V3 } };
    if (kf.animBase) {
      s.pose = kf.animBase.pose;
      s.rootOffset = kf.animBase.root;
    }
    delete kf.animBase;
    delete kf.keys;
    const e = s.eyes as Partial<CreatureState['eyes']> & { size?: number; spacing?: number; height?: number };
    if (!e.pairs) {
      s.eyes = {
        enabled: e.enabled ?? true,
        style: e.style ?? 'googly',
        pairs: [{ size: e.size ?? 0.5, spacing: e.spacing ?? 0.5, height: e.height ?? 0.55 }],
      };
    }
    return s;
  } catch {
    return null;
  }
}

export function save() {
  try {
    localStorage.setItem(WORLD_KEY, JSON.stringify(world));
  } catch {
    /* storage full or blocked; nothing to do */
  }
  queueCreationSave();
}

export const history: string[] = [];
export let hIndex = -1;
export function setHIndex(v: typeof hIndex) {
  hIndex = v;
}

export function commit() {
  invalidate();
  renderSceneColors();
  world.creatures[world.active] = state;
  const snap = JSON.stringify(world);
  if (snap === history[hIndex]) return;
  history.splice(hIndex + 1);
  history.push(snap);
  if (history.length > 120) history.shift();
  hIndex = history.length - 1;
  save();
  updateUndo();
  fitShadows();
  if (mode === 'stuff') autosaveThing();
  checkScene(world.creatures, world.workbench);
}

function restore(snap: string) {
  invalidate();
  const next = JSON.parse(snap) as World;
  // Rebuild only creatures whose skeleton changed (or that are new); the rest
  // just take their restored state.
  for (let i = 0; i < next.creatures.length; i++) {
    const s = next.creatures[i];
    const c = creatures[i];
    // undo puts parents back as they were: nothing to re-check
    parentsChecked.set(s, structuredClone(s.rig));
    if (c && JSON.stringify(c.state.rig) === JSON.stringify(s.rig)) {
      c.state = s;
      c.sync();
      // merge settings may differ without any part or pose changing
      c.markMergeDirty();
    } else {
      c?.dispose();
      creatures[i] = makeCreature(s);
    }
  }
  while (creatures.length > next.creatures.length) creatures.pop()!.dispose();
  // (undo brings back copies: their parts lists stay open or closed)
  next.creatures.forEach((s, i) => {
    if (world.creatures[i] && partsOpen.has(world.creatures[i])) partsOpen.add(s);
  });
  world = next;
  activate(world.active);
  syncWorkbench();
  if (mode === 'stuff') autosaveThing();
  if (selectedAttachment) selectAttachment(selectedAttachment);
  save();
  fitShadows();
  renderUI();
}

export function undo() {
  if (hIndex <= 0) return;
  if (drawState) exitDraw(); // a shape waiting for Done isn't in the history yet
  restore(history[--hIndex]);
  updateUndo();
  bump('undo');
}

export function redo() {
  if (hIndex >= history.length - 1) return;
  if (drawState) exitDraw();
  restore(history[++hIndex]);
  updateUndo();
}

function updateUndo() {
  $<HTMLButtonElement>('#undo').disabled = hIndex <= 0;
  $<HTMLButtonElement>('#redo').disabled = hIndex >= history.length - 1;
}

/** past loading: re-hung parts get a hint */
export let booted = false;
export function setBooted(v: typeof booted) {
  booted = v;
}
/**
 * Each creature's skeleton as Auto parent last checked it: an edit only
 * re-checks the parts whose base it moved. A creature without one (just
 * opened) has every part checked.
 */
export const parentsChecked = new WeakMap<CreatureState, RigState>();
export function makeCreature(s: CreatureState): Creature {
  // stone cracks, metal patina and the like used to be material settings: now they're markings
  migrateMarkings(s);
  // Auto parent: each part hangs off whatever its base sits on, as you see it (posed)
  if (rigPrefs.autoParent) {
    const before = parentsChecked.get(s);
    const only = before && movedBases(before, s.rig);
    if (!only || only.size) {
      // measured on just the skeleton: the creature itself is only built once
      const probe = new Creature(s, true);
      const changed = reparentAll(s.rig, sizesIn(probe), only).map((x) => x.id);
      rehang(probe, s.rig, changed);
      probe.dispose();
      if (booted && changed.length) {
        const b = changed.length === 1 && expandRig(s.rig).bones.find((x) => x.id === changed[0]);
        if (b && b.parent) hint(`${b.name.replace(/ \((L|R)\)$/, '')} now hangs off ${sceneName(s.rig, b.parent)}`, 2200);
        else if (!b) hint(`${changed.length} parts now hang off the parts their bases sit on`, 2200);
      }
    }
  }
  parentsChecked.set(s, structuredClone(s.rig));
  const c = new Creature(s);
  scene.add(c.root);
  c.root.visible = mode !== 'stuff';
  c.setSkeletonVisible(false);
  return c;
}

/** Make creature `i` the one every panel and tool works on. */
export function activate(i: number) {
  const next = creatures[i];
  const switching = creature !== next;
  // gizmos belong to the previous creature (first: leaving Arrange would show its handles again)
  if (switching) {
    stopPlacing();
    // (and a marking's gizmo, or the brush)
    stopMarkTools();
  }
  if (creature && switching) {
    creature.setSkeletonVisible(false);
    creature.flash(null, 0);
  }
  world.active = i;
  state = world.creatures[i];
  creature = next;
  if (switching) deselectAttachment();
  if (!creature.bones.has(selected)) selected = creature.list[0].def.id;
  creature.select(selected);
  updateSkeletonVisibility();
}

/** Rebuild the active creature from `state` (after skeleton changes, new files...). */
export function buildCreature() {
  const i = world.active;
  const wasPlacing = placing;
  creatures[i]?.dispose();
  world.creatures[i] = state;
  creatures[i] = makeCreature(state);
  creature = creatures[i];
  if (!creature.bones.has(selected)) selected = creature.list[0].def.id;
  creature.select(selected);
  updateSkeletonVisibility();
  // gizmos pointed at the old creature's objects
  if (selectedAttachment) selectAttachment(selectedAttachment);
  if (wasPlacing) startPlacing();
}

/** Keep the key light's shadow area covering every creature. */
export function fitShadows() {
  const box = new THREE.Box3();
  for (const c of creatures) {
    c.root.updateMatrixWorld(true);
    for (const m of c.meshes()) box.expandByObject(m);
  }
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const half = box.isEmpty() ? 3 : Math.max(3, box.getSize(new THREE.Vector3()).length() / 2 + 1);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -half;
  cam.right = cam.top = half;
  cam.far = 14 + half;
  cam.updateProjectionMatrix();
  key.target.position.set(center.x, 0, center.z);
  const off = KEY_AT.clone().applyQuaternion(lightSpin());
  key.position.set(center.x + off.x, 4.6 + half * 0.3, center.z + off.z);
  key.target.updateMatrixWorld();
}

export function initState() {
  loadedWorld = loadWorld();
  world = loadedWorld ?? freshWorld();
  state = world.creatures[world.active];
}
