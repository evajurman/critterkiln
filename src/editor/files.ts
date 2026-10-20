// ---------------------------------------------------------------------------
// Files: saving the scene (or a thing) to a file and opening one, with the
// choice of what to bring in.

import * as THREE from 'three';
import { type CreatureState } from '../creature';
import { unlock } from '../achievements';
import { collection, downloadText, envelope, parseEnvelope, putThing, safeFileName, type Thing } from '../stuff';
import { saveRig, savedRigs, type RigState, type V3 } from '../rigs';
import { $, fa, faClassic } from './dom';
import { applyLighting, camera, LIGHT_KEY, lightTurn, ORTHO_KEY, sceneOrtho, setLightTurn, setOrtho, setSceneOrtho } from './stage';
import { applyFloor, backdrop, floorPrefs, saveFloor, setBackdrop } from './floor';
import { activate, commit, creatures, makeCreature, migrate, mode, opened, state, world } from './state';
import { controls, creatureLabel } from './controls';
import { flyTo, frameAll, freshView, setTween, tween } from './framing';
import { exitDraw } from './drawing';
import { renderCollection } from './workbench';
import { deselectAttachment } from './attach';
import { stopPlacing } from './arrange';
import { freeSpot, renderCreatureBar } from './creatureBar';
import { POPOVERS, togglePopover } from './popovers';
import { beginCreation, flushCreationSave, leaveScene, type LibraryFile, replaceWorld } from './creations';
import { importCreations, noteSaved } from './libraryPanel';
import { renderRigs } from './partPanel';
import { renderUI } from './panels';
import { hint } from './hints';
import { renderBackdropUI } from './backdropPanel';
import { applyDof, dof, saveDof } from './dof';
import { invalidate } from './loop';

/** Files are named after who's in the scene: "Bimble", or "Bimble-Twin-Creature 3". */
export function sceneFileName(): string {
  return world.creatures.map((_, i) => creatureLabel(i)).join('-');
}

/** A creature as it goes into a file (the workbench isn't part of it). */
export function forFile(s: CreatureState): CreatureState {
  const { workbench: _wb, ...data } = s;
  return data;
}

// One kind of save: a .creature file holds everything (creatures, My stuff,
// saved body plans and the backdrop). Opening one lets you pick what to bring in.

/** The backdrop, floor, lights and depth of field. */
export interface SceneLook {
  backdrop: string;
  floor: typeof floorPrefs;
  light: number;
  dof: typeof dof;
  /** where the view was: the camera, the spot it orbits, and whether it was flat (ortho) */
  camera?: { pos: V3; target: V3; ortho?: boolean };
}

/** What a save holds. Older files (.scene, .stuff, .collection, single creatures) are read into one too. */
interface Bundle {
  name?: string;
  active?: number;
  creatures: CreatureState[];
  stuff: Thing[];
  rigs: RigState[];
  look?: SceneLook;
}

export function currentLook(): SceneLook {
  const look: SceneLook = { backdrop, floor: { ...floorPrefs }, light: lightTurn, dof: { ...dof } };
  // (the workbench has a view of its own; mid-flight, where it's flying to)
  if (mode !== 'stuff') {
    const r4 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4) / 1e4) as V3;
    look.camera = { pos: r4(tween?.p1 ?? camera.position), target: r4(tween?.t1v ?? controls.target), ortho: sceneOrtho };
  }
  return look;
}

export function saveBundle(b: Bundle, name: string) {
  unlock('save');
  downloadText(`${safeFileName(name, 'my-creatures')}.creature`, JSON.stringify(envelope('creature', b)));
}

/** Read any CritterKiln file into a bundle. */
function bundleFrom(text: string): Bundle {
  const env = parseEnvelope(text);
  const d = env.data as Record<string, unknown>;
  const creaturesOf = (raw: unknown[]) => raw.map(migrate).filter((s): s is CreatureState => !!s);
  if (env.kind === 'creature' && Array.isArray(d.creatures)) {
    return {
      name: d.name as string | undefined,
      active: d.active as number | undefined,
      creatures: creaturesOf(d.creatures),
      stuff: ((d.stuff as Thing[] | undefined) ?? []).filter((t) => Array.isArray(t?.pieces)),
      rigs: (d.rigs as RigState[] | undefined) ?? [],
      look: d.look as SceneLook | undefined,
    };
  }
  if (env.kind === 'creature') return { creatures: creaturesOf([d]), stuff: [], rigs: [] };
  if (env.kind === 'scene') return { name: d.name as string | undefined, active: d.active as number | undefined, creatures: creaturesOf((d.creatures as unknown[]) ?? []), stuff: [], rigs: [] };
  if (env.kind === 'stuff') {
    if (!Array.isArray(d.pieces)) throw new Error('The stuff in this file could not be read.');
    return { creatures: [], stuff: [d as unknown as Thing], rigs: [] };
  }
  return { creatures: [], stuff: (d.things as Thing[] | undefined) ?? [], rigs: (d.rigs as RigState[] | undefined) ?? [] };
}

export function openFile(text: string, fileName = '') {
  const env = parseEnvelope(text);
  if (env.kind === 'library') {
    void importCreations(env.data as LibraryFile);
    return;
  }
  const b = bundleFrom(text);
  for (const s of b.creatures) delete s.workbench; // the workbench belongs to the scene, not the file
  if (!b.creatures.length && !b.stuff.length && !b.rigs.length && !b.look) throw new Error('There was nothing in this file that could be read.');
  // a single thing comes straight into My stuff; anything with a creature asks
  // whether it joins the scene or replaces it
  if (!b.creatures.length && b.stuff.length === 1 && !b.rigs.length) {
    loadBundle(b, { creatures: b.creatures.map(() => true), stuff: b.stuff.map(() => true), rigs: [], look: false }, false);
    return;
  }
  showLoadPicker(b, b.name?.trim() || fileName.replace(/\.[^.]+$/, ''));
}

interface LoadChoice {
  creatures: boolean[];
  stuff: boolean[];
  rigs: boolean[];
  look: boolean;
}

/** Bring the chosen parts of a bundle in: alongside what's here, or in place of the scene. */
/** Stuff these creatures are wearing (and any other things) joins My stuff, so it can be moved or worn again. */
export function keepInCollection(creatures: CreatureState[], things: Thing[] = []) {
  const have = new Set(collection().map((t) => t.id));
  for (const t of [...creatures.flatMap((s) => (s.attachments ?? []).map((a) => a.thing)), ...things]) {
    if (have.has(t.id)) continue;
    putThing(t);
    have.add(t.id);
  }
}

export function loadBundle(b: Bundle, pick: LoadChoice, replace: boolean) {
  const incoming = b.creatures.filter((_, i) => pick.creatures[i]);
  const things = b.stuff.filter((_, i) => pick.stuff[i]);
  const rigs = b.rigs.filter((_, i) => pick.rigs[i]);
  exitDraw();
  deselectAttachment();
  stopPlacing();
  for (const r of rigs) saveRig(r, r.name);

  if (incoming.length && replace) {
    // a new creation: the scene it replaces stays in My creations
    leaveScene();
    const active = Math.max(0, incoming.indexOf(b.creatures[b.active ?? 0]));
    replaceWorld({ creatures: incoming, active, name: b.name }, []);
    beginCreation(null, true);
  }
  // after the old scene is saved, so it keeps its own backdrop
  // (the file's view only when it's the whole scene: added creatures are framed where they land)
  const viewed = pick.look && b.look ? applyLook(b.look, replace && incoming.length > 0) : false;
  keepInCollection(incoming, things);
  if (incoming.length && !replace) {
    // keep the file's own arrangement, shifted to free floor on the right
    const spot = freeSpot();
    const minX = Math.min(...incoming.map((s) => s.placement?.x ?? 0));
    for (const s of incoming) {
      s.placement = { ...s.placement, x: spot.x + ((s.placement?.x ?? 0) - minX), z: s.placement?.z ?? 0, yaw: s.placement?.yaw ?? 0 };
      world.creatures.push(s);
      creatures.push(makeCreature(s));
    }
    activate(world.creatures.length - 1);
  }
  commit();
  renderUI();
  renderCollection();
  renderRigs();
  if (incoming.length && mode !== 'stuff' && !viewed) {
    if (replace) freshView();
    else frameAll();
  }

  const bits = [
    incoming.length === 1 ? incoming[0].name || 'a creature' : incoming.length ? `${incoming.length} creatures` : '',
    things.length === 1 ? `"${things[0].name || 'a thing'}"` : things.length ? `${things.length} things` : '',
    rigs.length ? `${rigs.length} body plan${rigs.length > 1 ? 's' : ''}` : '',
    pick.look && b.look ? 'the backdrop' : '',
  ].filter(Boolean);
  hint(`${replace && incoming.length ? 'Opened' : 'Added'} ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')}`, 2400);
}

/** Put a saved look back; with `view`, its camera too. Whether the view was put back (else it wants framing). */
export function applyLook(l: SceneLook, view = true): boolean {
  setBackdrop(l.backdrop);
  Object.assign(floorPrefs, l.floor);
  saveFloor();
  applyFloor();
  setLightTurn(l.light ?? 0);
  applyLighting();
  try {
    localStorage.setItem(LIGHT_KEY, JSON.stringify({ turn: lightTurn }));
  } catch {
    /* ignore */
  }
  Object.assign(dof, l.dof);
  saveDof();
  applyDof();
  renderBackdropUI();
  if (!view || !l.camera) return false;
  putView(l.camera, true);
  return true;
}

/** Look at a scene the way it was saved: flown to, or (not `fly`) straight there. */
export function putView(v: NonNullable<SceneLook['camera']>, fly: boolean) {
  setSceneOrtho(!!v.ortho);
  try {
    localStorage.setItem(ORTHO_KEY, sceneOrtho ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (mode !== 'stuff') setOrtho(sceneOrtho);
  const pos = new THREE.Vector3(...v.pos), target = new THREE.Vector3(...v.target);
  if (fly) return flyTo(pos, target);
  setTween(null);
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
  invalidate();
}

/** The "what do you want from this file?" picker. */
function showLoadPicker(b: Bundle, title: string) {
  const pick: LoadChoice = {
    creatures: b.creatures.map(() => true),
    stuff: b.stuff.map(() => true),
    rigs: b.rigs.map(() => true),
    look: !!b.look,
  };
  // just one thing to bring in: no checklist, only "add or replace?"
  const single = b.creatures.length + b.stuff.length + b.rigs.length + (b.look ? 1 : 0) === 1;
  if (single && b.creatures[0]?.name?.trim()) title = b.creatures[0].name.trim();
  $('#load-title').textContent = title ? `Open “${title}”` : 'Open';
  $('#load-note').hidden = !single;
  $('#load-all-row').hidden = single;
  $('#load-list').hidden = single;
  const list = $('#load-list');
  list.innerHTML = '';
  const boxes: HTMLInputElement[] = [];
  const sync = () => {
    const n = [...pick.creatures, ...pick.stuff, ...pick.rigs, pick.look && !!b.look].filter(Boolean).length;
    const all = $<HTMLInputElement>('#load-all');
    all.checked = n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
    $<HTMLButtonElement>('#load-add').disabled = n === 0;
    // replacing the scene needs someone to replace it with
    $<HTMLButtonElement>('#load-replace').disabled = !pick.creatures.some(Boolean);
  };
  const group = (label: string) => {
    const h = document.createElement('div');
    h.className = 'pop-sub';
    h.textContent = label;
    list.append(h);
  };
  const row = (icon: string, name: string, get: () => boolean, set: (v: boolean) => void) => {
    const l = document.createElement('label');
    l.className = 'load-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = get();
    cb.onchange = () => {
      set(cb.checked);
      sync();
    };
    boxes.push(cb);
    const ic = document.createElement('span');
    ic.className = 'load-icon';
    ic.innerHTML = icon;
    const nm = document.createElement('span');
    nm.textContent = name;
    l.append(cb, ic, nm);
    list.append(l);
  };
  if (b.creatures.length) {
    group('Creatures');
    b.creatures.forEach((s, i) => {
      const color = Object.values(s.parts)[0]?.color ?? '#ccc';
      row(`<i class="load-dot" style="background:${color}"></i>`, s.name?.trim() || `Creature ${i + 1}`, () => pick.creatures[i], (v) => (pick.creatures[i] = v));
    });
  }
  if (b.stuff.length) {
    group('Stuff');
    b.stuff.forEach((t, i) => {
      const icon = t.thumb ? `<img src="${t.thumb}" alt="" />` : fa('box');
      row(icon, t.name?.trim() || 'Thing', () => pick.stuff[i], (v) => (pick.stuff[i] = v));
    });
  }
  if (b.rigs.length) {
    group('Body plans');
    b.rigs.forEach((r, i) => row(faClassic('bone'), r.name, () => pick.rigs[i], (v) => (pick.rigs[i] = v)));
  }
  if (b.look) {
    group('Scene');
    row(`<i class="load-dot" style="background:${b.look.backdrop}"></i>`, b.look.camera ? 'Backdrop, lighting & view' : 'Backdrop & lighting', () => pick.look, (v) => (pick.look = v));
  }
  $<HTMLInputElement>('#load-all').onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    pick.creatures.fill(on);
    pick.stuff.fill(on);
    pick.rigs.fill(on);
    pick.look = on && !!b.look;
    for (const cb of boxes) cb.checked = on;
    sync();
  };
  const close = () => ($('#load-pop').hidden = true);
  $('#load-close').onclick = close;
  $('#load-add').onclick = () => {
    close();
    loadBundle(b, pick, false);
  };
  $('#load-replace').onclick = () => {
    close();
    loadBundle(b, pick, true);
  };
  sync();
  for (const [btn, p] of POPOVERS) {
    $(p).hidden = true;
    $(btn).classList.remove('on');
  }
  $('#load-pop').hidden = false;
}

export function initFiles() {
  $('#file-btn').onclick = () => {
    if (!togglePopover('#file-pop')) return;
    $<HTMLInputElement>('#creature-name').value = state.name ?? '';
  };
  $<HTMLInputElement>('#creature-name').oninput = (e) => {
    state.name = (e.target as HTMLInputElement).value;
    renderCreatureBar();
  };
  $<HTMLInputElement>('#creature-name').onchange = () => commit();
  $('#file-save').onclick = () => {
    // its card in My creations shows it's saved
    flushCreationSave();
    saveBundle(
      { active: world.active, creatures: world.creatures.map(forFile), stuff: collection(), rigs: savedRigs(), look: currentLook() },
      sceneFileName(),
    );
    if (opened.id) noteSaved([opened.id], 'file');
  };
  $('#file-open').onclick = () => $<HTMLInputElement>('#file-input').click();
  $<HTMLInputElement>('#file-input').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      openFile(await file.text(), file.name);
    } catch (err) {
      hint(`${file.name}: ${(err as Error).message}`, 3500, true);
    }
  };
}
