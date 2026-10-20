import { Creature, defaultState, partShapes, setPartShapes, type PartState } from '../creature';
import { unlock } from '../achievements';
import { clipLoop, type Vec2 } from '../inflate';
import {
  RIGS,
  addLimb,
  canParent,
  deleteLimb,
  deleteSavedRig,
  detachBone,
  expandRig,
  extendBone,
  getRig,
  mirrorLimb,
  mirrorTarget,
  partIds,
  reattachBone,
  moveLimb,
  rigFromTemplate,
  saveRig,
  savedRigs,
  setParent,
  splitBone,
  unlinkPair,
  type BoneDef,
  type PartCopy,
  type PartSizes,
  type RigState,
} from '../rigs';
import { $, fa, faClassic, iconLabel } from './dom';
import { buildCreature, commit, creature, idle, parentsChecked, selected, setSelected, setState, state } from './state';
import { pickPart, showEyes } from './controls';
import { frameCreature } from './framing';
import { exitDraw } from './drawing';
import { renderCreatureBar } from './creatureBar';
import { renderRigs, selectPart } from './partPanel';
import { renderUI } from './panels';
import { hint } from './hints';

/**
 * A fresh copy of the skeleton a creature was started from: the current
 * template (or saved rig), so new creatures get its latest version. An edited
 * skeleton is kept as it is.
 */
export function freshRig(rig: RigState): RigState {
  if (rig.base.startsWith('saved:')) return structuredClone(savedRigs().find((r) => r.base === rig.base) ?? rig);
  const t = RIGS.find((r) => r.id === rig.base);
  return t ? rigFromTemplate(t) : structuredClone(rig);
}

export function switchRig(base: string) {
  const rig = base.startsWith('saved:') ? savedRigs().find((r) => r.base === base) : rigFromTemplate(getRig(base));
  if (!rig) return;
  // picking the plan it already has only does something if its skeleton is
  // out of date (made before the template changed)
  if (base === state.rig.base && JSON.stringify(rig.bones) === JSON.stringify(state.rig.bones)) return;
  if (base !== state.rig.base) unlock('body-plan');
  // no confirm: switching clears drawn shapes and pose, but it's one undo away
  const body = state.parts[creature.list[0].src].color;
  const next = defaultState(rig, body);
  // same spot in the scene, same name
  next.placement = state.placement;
  next.name = state.name;
  next.style = state.style;
  next.eyes = state.eyes;
  exitDraw();
  setState(next);
  setSelected('');
  buildCreature();
  commit();
  renderUI();
  frameCreature(true);
}

// rig editing

/** Apply a skeleton edit, give new bones a look, rebuild, and select the first new bone. */
/** Give parts made by a rig edit their looks (and, for a split pair's right side, its own eyes). */
export function applyPartCopies(copies: PartCopy[], copyShape: boolean) {
  for (const c of copies) {
    const from = state.parts[c.from];
    if (from && !state.parts[c.to]) {
      const to: PartState = structuredClone(from);
      if (!copyShape) setPartShapes(to, []);
      state.parts[c.to] = to;
    }
    // eyes on a pair belonged to both sides; a split right side keeps its own,
    // facing the way they did (a right twin turned them the other way)
    const e = state.eyes;
    if (copyShape && c.to.endsWith('R') && c.from === c.to.slice(0, -1) + 'L' && !e.pairs.some((p) => p.bone === c.to)) {
      for (const p of e.pairs.filter((p) => p.bone === c.from)) e.pairs.push({ ...p, bone: c.to, turn: -(p.turn ?? e.turn ?? 0) || undefined });
    }
  }
}

export function rigEdit(fn: (rig: RigState) => PartCopy[], copyShape: boolean) {
  const copies = fn(state.rig);
  applyPartCopies(copies, copyShape);
  // an edited skeleton is no longer the saved/template one
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  buildCreature();
  // stuff on removed bones goes with them
  if (state.attachments) state.attachments = state.attachments.filter((a) => creature.bones.has(a.bone));
  if (copies.length) setSelected(copies[0].to);
  creature.select(selected);
  commit();
  renderUI();
}

export function renderRigPanel() {
  const b = creature.bones.get(selected);
  const title = $<HTMLInputElement>('#rig-title');
  // a pair shares one name; the (L)/(R) is added on display
  if (document.activeElement !== title) title.value = b ? (state.rig.bones.find((d) => d.id === b.def.baseId)?.name ?? b.def.name) : '';
  title.disabled = !b;
  const isRoot = !b?.parent;
  const paired = !!b && b.def.sideSign !== 0;
  // beside Mirror, on a mirrored pair (a one-sided part gets Mirror part there instead)
  const unlink = $<HTMLButtonElement>('#rig-unlink');
  unlink.hidden = !paired || idle;
  unlink.disabled = rigLocked();
  unlink.title = rigLocked() ? 'Turn Mirror off to unlink this pair' : 'Let the left and right sides be shaped separately';
  // a part with nothing on the other side can be mirrored (or re-linked, if it was unlinked)
  const lone = b && !idle ? mirrorTarget(state.rig, selected) : null;
  const mirrorBtn = $<HTMLButtonElement>('#rig-mirror');
  mirrorBtn.hidden = !lone;
  if (lone) {
    iconLabel(mirrorBtn, faClassic(lone.other ? 'link' : 'clone'), lone.other ? 'Relink pair' : 'Mirror part');
    mirrorBtn.title = lone.other
      ? 'Join this side back up with the other: the other side becomes its mirror image again'
      : 'Copy this part onto the other side, as a mirrored pair';
  }
  $('#rig-attach').hidden = !b || idle;
  $<HTMLButtonElement>('#rig-split').disabled = !b;
  // a part on its parent's tip can come off it; one that's off can go back
  const detach = $<HTMLButtonElement>('#rig-detach');
  const loose = !!b && b.attach;
  iconLabel(detach, faClassic(loose ? 'link' : 'link-slash'), loose ? 'Reattach' : 'Detach');
  detach.title = isRoot
    ? 'The first part holds everything else, so it has nothing to come off'
    : loose
      ? 'Snap the base of this part back onto the tip of the part it hangs off'
      : 'Unhook this part from the tip it grew from, so its base can slide anywhere';
  detach.disabled = !b || isRoot;
  // the part it hangs off, and (with Auto parent off) a way to pick another
  $<HTMLInputElement>('#auto-parent').checked = rigPrefs.autoParent;
  $('#parent-name').textContent = b?.parent ? `Hangs off ${b.parent.def.name}` : b ? 'The first part: everything hangs off it' : '';
  const setP = $<HTMLButtonElement>('#set-parent');
  setP.hidden = rigPrefs.autoParent;
  setP.disabled = !b || isRoot;
  if (pickingParent && (!b || isRoot)) setPickingParent(false);
  title.title = paired ? 'Rename this pair: both sides share one name' : 'Rename this part';
  $<HTMLInputElement>('#rig-sym').checked = rigLocked();
  $<HTMLInputElement>('#keep-floor').checked = state.keepFloor !== false;
  $('#mirror-pill').classList.toggle('on', rigLocked());
  if (b) {
    $<HTMLInputElement>('#rig-w0').value = String(b.def.width);
    $<HTMLInputElement>('#rig-w1').value = String(b.def.widthEnd ?? b.def.width);
    // a drawn shape sets its own widths: these only count again after Reset shape
    const drawn = !!state.parts[b.src]?.outline;
    for (const w of ['w0', 'w1']) {
      $<HTMLInputElement>(`#rig-${w}`).disabled = drawn;
      $(`#rig-${w}-row`).classList.toggle('off', drawn);
      $(`#rig-${w}-row`).title = drawn ? 'This part has a drawing, which sets its own widths. Reset shape to use these.' : '';
    }
  }

  const list = $('#saved-rig-list');
  list.innerHTML = '';
  for (const r of savedRigs()) {
    const row = document.createElement('div');
    row.className = 'saved-rig';
    const load = document.createElement('button');
    load.className = 'ghost';
    iconLabel(load, faClassic('bone'), r.name);
    load.onclick = () => switchRig(r.base);
    const del = document.createElement('button');
    del.className = 'ghost';
    del.innerHTML = fa('xmark');
    del.title = 'Delete saved rig';
    del.onclick = () => {
      if (!confirm(`Delete the saved rig "${r.name}"?`)) return;
      deleteSavedRig(r.name);
      renderRigPanel();
      renderRigs();
    };
    row.append(load, del);
    list.append(row);
  }
  if (!list.children.length) list.innerHTML = '<p class="muted small">No saved rigs yet.</p>';
}

// ---- lock symmetry (remembered) ----
const RIG_PREFS_KEY = 'creature-creator/rig-prefs';
export const rigPrefs: { lock: boolean; autoParent: boolean } = (() => {
  try {
    return { lock: true, autoParent: true, ...JSON.parse(localStorage.getItem(RIG_PREFS_KEY) ?? '{}') };
  } catch {
    return { lock: true, autoParent: true };
  }
})();
export let rigLock = rigPrefs.lock;
export function rigLocked() {
  return rigLock;
}
function saveRigPrefs() {
  try {
    localStorage.setItem(RIG_PREFS_KEY, JSON.stringify({ ...rigPrefs, lock: rigLock }));
  } catch {
    /* ignore */
  }
}
export function setMirror(on: boolean) {
  rigLock = on;
  saveRigPrefs();
  renderRigPanel();
  hint(rigLock ? 'Mirror on: both sides bend, stretch and grow together' : 'Mirror off: each side on its own', 2000);
}

// ---- which part each part hangs off (its parent) ----
/** Each part's real size, from its drawing (or default shape): see PartSizes. */
export function sizesIn(c: Creature): PartSizes {
  // each drawing is read once: how wide it is at evenly spaced heights along it
  const STEPS = 24;
  const profiles = new Map<string, { lo: number; hi: number; len: number; w: number[] } | null>();
  const profile = (id: string) => {
    const b = c.bones.get(id);
    if (!b) return null;
    if (profiles.has(b.src)) return profiles.get(b.src)!;
    const shapes = c.shapesFor(b);
    let lo = Infinity, hi = -Infinity;
    for (const sh of shapes) for (const [, y] of sh.outline) (lo = Math.min(lo, y)), (hi = Math.max(hi, y));
    let p: { lo: number; hi: number; len: number; w: number[] } | null = null;
    if (lo < hi) {
      const w = new Array(STEPS + 1).fill(0);
      for (const sh of shapes) {
        const o = sh.outline;
        for (let i = 0; i < o.length; i++) {
          const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length];
          // every height this edge crosses
          const a = Math.ceil(((Math.min(y0, y1) - lo) / (hi - lo)) * STEPS), z = Math.floor(((Math.max(y0, y1) - lo) / (hi - lo)) * STEPS);
          for (let k = Math.max(0, a); k <= Math.min(STEPS, z); k++) {
            const y = lo + ((hi - lo) * k) / STEPS;
            const x = y1 === y0 ? Math.max(Math.abs(x0), Math.abs(x1)) : Math.abs(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
            w[k] = Math.max(w[k], x);
          }
        }
      }
      p = { lo, hi, len: b.length, w };
    }
    profiles.set(b.src, p);
    return p;
  };
  return {
    profile(id) {
      const p = profile(id);
      return p ? { from: p.lo / p.len, to: p.hi / p.len, w: p.w } : undefined;
    },
    at: (id) => c.posedEnds(id),
  };
}
/**
 * Parts in `rig` just given new parents, still built in `c` on their old ones:
 * move each (and everything on it) so it stays exactly where it is, posed.
 */
export function rehang(c: Creature, rig: RigState, ids: string[]) {
  const bones = expandRig(rig).bones;
  const moves = ids.map((id) => {
    const to = bones.find((b) => b.id === id)?.parent;
    return [id, to ? c.rehangMove(id, to) : null] as const;
  });
  for (const [id, m] of moves) if (m) moveLimb(rig, id, m);
}
export const sceneName = (rig: RigState, id: string) => expandRig(rig).bones.find((b) => b.id === id)?.name ?? id;
export let pickingParent = false;
export function setPickingParent(on: boolean) {
  pickingParent = on;
  $('#set-parent').classList.toggle('on', on);
  $('#viewport').style.cursor = on ? 'crosshair' : '';
  if (on) hint('Click the part this one should hang off', 0);
  else hint('');
}
/** Set parent: the picked part hangs off the part clicked. */
export function parentAt(x: number, y: number) {
  const target = pickPart(x, y);
  const id = selected;
  if (!target || !creature.bones.get(id)?.parent) return setPickingParent(false);
  pickingParent = false;
  $('#set-parent').classList.remove('on');
  $('#viewport').style.cursor = '';
  if (!canParent(state.rig, id, target)) {
    hint(target === id ? "A part can't hang off itself" : "That part hangs off this one, so it can't be its parent", 2200, true);
    return;
  }
  const name = (state.rig.bones.find((d) => d.id === creature.bones.get(id)!.def.baseId)?.name ?? '').replace(/ \((L|R)\)$/, '');
  if (!setParent(state.rig, id, target)) {
    hint(`${name} already hangs off ${sceneName(state.rig, target)}`, 1800);
    return;
  }
  // it stays just where it is: a pair is moved by its left twin
  const own = creature.bones.get(id)!.def;
  rehang(creature, state.rig, [own.sideSign === -1 ? own.baseId + 'L' : id]);
  rigEdit(() => [], false);
  const b = creature.bones.get(id);
  hint(`${name} now hangs off ${b?.parent ? sceneName(state.rig, b.parent.def.id) : sceneName(state.rig, target)}`, 2200);
}

// ---- per-bone default-shape widths and bend, applied live ----
let boneEditPending = false;
function editBone(fn: (d: BoneDef) => void) {
  const b = creature.bones.get(selected);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  if (!def) return;
  fn(def);
  if (boneEditPending) return;
  boneEditPending = true;
  requestAnimationFrame(() => {
    boneEditPending = false;
    // re-seat bones (bends move children) and rebuild the affected parts
    creature.relayout(state.rig);
    creature.sync();
  });
}
export function commitBoneEdit() {
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  commit();
  renderRigPanel();
}
const round3n = (v: string) => Math.round(parseFloat(v) * 1000) / 1000;
// ---- naming a bone ----
function renameBone(commitIt: boolean) {
  setPartName($<HTMLInputElement>('#rig-title').value, commitIt);
}
/** The picked part's name (a pair shares one). */
export function partName() {
  const b = creature.bones.get(selected);
  return (b && state.rig.bones.find((d) => d.id === b.def.baseId)?.name) ?? '';
}
/** Names the picked part (both of a pair); a blank name is ignored. */
export function setPartName(raw: string, commitIt: boolean) {
  const b = creature.bones.get(selected);
  const def = b && state.rig.bones.find((d) => d.id === b.def.baseId);
  const name = raw.trim();
  if (!def || !name) return;
  def.name = name;
  // re-seat so the bones pick up the new name (it's shown on every part list)
  creature.relayout(state.rig);
  renderCreatureBar();
  if (commitIt) {
    commit();
    renderUI();
  }
}
/**
 * Give a one-sided part a mirror image on the other side, as a linked pair. Half
 * of an unlinked pair is re-linked instead: the other half becomes its mirror image.
 */
function mirrorPart() {
  const r = mirrorLimb(state.rig, selected);
  if (!r) return;
  const relink = r.removed.length > 0;
  const parts = state.parts, pose = state.pose;
  const oldParts = { ...parts }, oldPose = { ...pose };
  const gone = new Set([...r.removed, ...r.renamed.map(([from]) => from)]);
  for (const id of gone) {
    delete parts[id];
    delete pose[id];
  }
  const to = new Map(r.renamed);
  // a pair keeps one drawing, under its left twin's id
  const left = (id: string) => id.slice(0, -1) + 'L';
  for (const [from, id] of r.renamed) {
    if (oldParts[from]) parts[left(id)] = oldParts[from];
    if (oldPose[from]) pose[id] = oldPose[from];
  }
  // eyes on the replaced side go with it; this side's now sit on both
  const e = state.eyes;
  e.pairs = e.pairs.filter((p) => !p.bone || !r.removed.includes(p.bone));
  for (const p of e.pairs) {
    const id = p.bone && to.get(p.bone);
    if (!id) continue;
    p.bone = left(id);
    // stored for the left twin, which faces the other way round
    if (r.flipped && p.turn) p.turn = -p.turn;
  }
  if (state.attachments) {
    state.attachments = state.attachments.filter((a) => !r.removed.includes(a.bone));
    for (const a of state.attachments) {
      const id = to.get(a.bone);
      if (id) (a.bone = id), (a.mirror = true);
    }
  }
  if (!state.rig.base.startsWith('custom')) state.rig.base = 'custom';
  setSelected(to.get(selected) ?? r.renamed[0][1]);
  buildCreature();
  // the new side takes this side's pose
  creature.mirrorPose(r.renamed.map(([, id]) => creature.bones.get(id)!).filter(Boolean));
  creature.capturePose();
  creature.applyPose();
  commit();
  renderUI();
  hint(relink ? 'Linked again: the other side is its mirror image' : 'Mirrored onto the other side', 2000);
}

/** Delete the picked part and everything on it (the creature's root part stays). */
export function removePart() {
  if (!creature.bones.get(selected)?.parent) {
    hint("The first part holds everything else, so it can't be removed", 2000, true);
    return;
  }
  const parent = creature.bones.get(selected)?.parent?.def.id ?? '';
  rigEdit((rig) => {
    for (const d of deleteLimb(rig, selected)) {
      for (const id of partIds(d)) {
        delete state.parts[id];
        delete state.pose[id];
      }
    }
    return [];
  }, false);
  selectPart(creature.bones.has(parent) ? parent : creature.list[0].def.id);
}

export function initRigEdit() {
  $('#rig-bone').onclick = () => {
    rigEdit((rig) => addLimb(rig, selected, rigLocked(), 1), false);
    unlock('limb');
  };
  $('#rig-split').onclick = () => {
    const r = splitBone(state.rig, selected);
    if (!r) {
      hint('This bone is too short to split', 1800, true);
      return;
    }
    unlock('split');
    // cut any drawing in two at the split so each half keeps its piece
    for (const [lo, hi] of r.pairs) {
      const p = state.parts[lo];
      if (!p) continue; // right twins share the left's drawing
      const upper: PartState = structuredClone(p);
      // every shape is cut at the same height (side drawings run along the bone too)
      const shapes = partShapes(p);
      const below = shapes.flatMap((sh) => {
        const l = clipLoop(sh.outline, r.at, 'below');
        return l ? [{ ...sh, outline: l.map(([x, y]) => [x, y * (r.lowScale ?? 1)] as Vec2) }] : [];
      });
      const above = shapes.flatMap((sh) => {
        const l = clipLoop(sh.outline, r.at, 'above');
        return l ? [{ ...sh, outline: l.map(([x, y]) => [x, (y - r.at) * (r.highScale ?? 1)] as Vec2) }] : [];
      });
      setPartShapes(p, below);
      setPartShapes(upper, above);
      state.parts[hi] = upper;
    }
    rigEdit(() => [], false);
    hint('Split into two jointed halves', 1800);
  };
  $<HTMLInputElement>('#ik').onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    $('#ik-pill').classList.toggle('on', on);
    hint(on ? 'Pull limbs on: dragging a hand bends the elbow and shoulder too' : 'Pull limbs off: dragging bends just that joint', 2000);
  };
  $<HTMLInputElement>('#rig-sym').onchange = (e) => setMirror((e.target as HTMLInputElement).checked);
  $<HTMLInputElement>('#auto-parent').onchange = (e) => {
    rigPrefs.autoParent = (e.target as HTMLInputElement).checked;
    saveRigPrefs();
    if (rigPrefs.autoParent && pickingParent) setPickingParent(false);
    if (rigPrefs.autoParent) {
      // straight away, every part, for any left on the wrong part while it was off
      const rig = JSON.stringify(state.rig);
      parentsChecked.delete(state);
      buildCreature();
      if (JSON.stringify(state.rig) !== rig) commit();
    }
    renderRigPanel();
    hint(rigPrefs.autoParent ? 'Auto parent on: a part hangs off whatever its base sits on' : 'Auto parent off: use Set parent to choose', 2200);
  };
  $('#set-parent').onclick = () => setPickingParent(!pickingParent);
  $<HTMLInputElement>('#rig-w0').oninput = (e) => editBone((d) => (d.width = round3n((e.target as HTMLInputElement).value)));
  $<HTMLInputElement>('#rig-w1').oninput = (e) => editBone((d) => (d.widthEnd = round3n((e.target as HTMLInputElement).value)));
  for (const id of ['#rig-w0', '#rig-w1']) $<HTMLInputElement>(id).onchange = () => commitBoneEdit();
  $<HTMLInputElement>('#rig-title').oninput = () => renameBone(false);
  $<HTMLInputElement>('#rig-title').onchange = () => renameBone(true);
  $<HTMLInputElement>('#rig-title').onkeydown = (e) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };
  $('#rig-extend').onclick = () => rigEdit((rig) => extendBone(rig, selected), false);
  $('#rig-detach').onclick = () => {
    if (!creature.bones.get(selected)?.parent) return;
    const loose = creature.bones.get(selected)!.attach;
    rigEdit((rig) => (loose ? reattachBone : detachBone)(rig, selected), false);
    hint(loose ? 'Back on the tip' : 'Detached: drag the purple grip at its base to move it', 2200);
  };
  $('#rig-unlink').onclick = () => rigEdit((rig) => unlinkPair(rig, selected), true);
  $('#rig-mirror').onclick = () => mirrorPart();
  $('#eyes-add').onclick = () => {
    const b = creature.bones.get(selected);
    if (!b) return;
    const e = state.eyes;
    // a limb (one of a mirrored pair, or a stalk) gets a single eye near its tip; a head gets a pair
    const limb = b.def.sideSign !== 0 || b.length > 1.6 * b.def.width;
    e.pairs.push({ size: 0.5, spacing: 0.5, height: limb ? 0.8 : 0.55, bone: b.src, single: limb || undefined });
    e.enabled = true;
    creature.sync();
    commit();
    showEyes(e.pairs.length - 1);
    hint(limb ? 'Eye added' : 'Eyes added', 1400);
  };
  $('#rig-save').onclick = () => {
    const input = $<HTMLInputElement>('#rig-name');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      hint('Give the rig a name first', 1800, true);
      return;
    }
    saveRig(state.rig, name);
    unlock('rig-save');
    state.rig.base = 'saved:' + name;
    state.rig.name = name;
    input.value = '';
    commit();
    renderRigs();
    renderRigPanel();
    hint(`Saved rig "${name}"`, 1800);
  };
}
