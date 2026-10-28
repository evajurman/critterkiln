// ---------------------------------------------------------------------------
// Which handles the view shows, picked by the button on the view cube: Pose
// (the bones' own handles: bend joints, slide parts), Move, Rotate or Scale
// (arrows on the picked part and everything on it; with nothing picked, or the
// first part, the whole creature), or none. Each tab starts on its own.

import * as THREE from 'three';
import { type BoneRT, type PartState } from '../creature';
import { type V3 } from '../rigs';
import { movedMarking } from '../markings';
import { gizmos } from '../layout';
import { openContextMenu, type MenuItem } from '../contextMenu';
import { keyLabel, type ShortcutId } from '../shortcuts';
import { $, faClassic } from './dom';
import { scene } from './stage';
import { buildCreature, commit, creature, idle, selected, state } from './state';
import { gizmo } from './gizmo';
import { placing, setPlaceMode, startPlacing, stopPlacing, type PlaceMode } from './arrange';
import { drawState } from './drawing';
import { markToolsOut } from '../markingPanel';
import { pivotAtRest } from './stuffToParts';
import { invalidate } from './loop';
import { hint } from './hints';

export type GizmoMode = 'pose' | PlaceMode | 'off';
export let gizmoMode: GizmoMode = 'pose';

const MODES: { mode: GizmoMode; label: string; icon: string; title: string; key?: ShortcutId }[] = [
  { mode: 'pose', label: 'Pose', icon: 'bone', title: 'The bones’ handles: bend joints, slide parts, stretch them', key: 'pose' },
  { mode: 'translate', label: 'Move', icon: 'arrows-up-down-left-right', title: 'Move the picked part (and everything on it); nothing picked: the whole creature', key: 'move' },
  { mode: 'rotate', label: 'Rotate', icon: 'rotate', title: 'Turn the picked part (and everything on it); nothing picked: the whole creature', key: 'rotate' },
  { mode: 'scale', label: 'Scale', icon: 'expand', title: 'Resize the picked part (and everything on it); nothing picked: the whole creature', key: 'scale' },
  { mode: 'off', label: 'None', icon: 'eye-slash', title: 'No handles: just the creature' },
];

/** The handles a tab starts with: its bones' (if it shows any), or none. */
export function resetGizmoMode() {
  setGizmoMode(gizmos() === 'none' ? 'off' : 'pose');
}

/** Which bones' handles show: the tab's choice (every part's, or the picked one's), every part's on a tab that shows none, or none away from Pose. */
export function poseGizmos(): 'full' | 'part' | 'none' {
  if (gizmoMode !== 'pose') return 'none';
  const g = gizmos();
  return g === 'none' ? 'full' : g;
}

export function setGizmoMode(m: GizmoMode) {
  gizmoMode = m;
  renderGizmoButton();
  applyGizmo();
}

// the arrows sit on this, at the picked part's base, turned as the part is
const proxy = new THREE.Object3D();
let onPart: BoneRT | null = null;
let applying = false;

/** Put the arrows where they go now (the picked part, the creature, or nowhere). */
export function applyGizmo() {
  if (applying || !creature) return;
  applying = true;
  try {
    const transform = gizmoMode === 'translate' || gizmoMode === 'rotate' || gizmoMode === 'scale';
    const b = !idle ? creature.bones.get(selected) : undefined;
    const busy = !!drawState || markToolsOut();
    if (!transform || busy) {
      detachPart();
      if (placing && transform) stopPlacing();
      return;
    }
    // the first part holds everything: moving it is arranging the creature
    if (!b || !b.parent) {
      detachPart();
      if (!placing) startPlacing();
      setPlaceMode(gizmoMode as PlaceMode);
      return;
    }
    if (placing) stopPlacing();
    onPart = b;
    creature.root.updateMatrixWorld(true);
    b.pivot.matrixWorld.decompose(proxy.position, proxy.quaternion, new THREE.Vector3());
    proxy.scale.setScalar(1);
    proxy.updateMatrixWorld(true);
    gizmo.showX = gizmo.showY = gizmo.showZ = true;
    gizmo.attach(proxy);
    gizmo.setMode(gizmoMode as PlaceMode);
    gizmo.setSpace(gizmoMode === 'translate' ? 'world' : 'local');
  } finally {
    applying = false;
    invalidate();
  }
}

function detachPart() {
  if (onPart && gizmo.object === proxy) gizmo.detach();
  onPart = null;
}

/** The creature's arrows were put on or taken off some other way (clicking away, a new creature): the switcher follows. */
export function placingChanged(on: boolean) {
  if (applying) return;
  if (on && gizmoMode !== 'translate' && gizmoMode !== 'rotate' && gizmoMode !== 'scale') gizmoMode = 'translate';
  else if (!on && (gizmoMode === 'translate' || gizmoMode === 'rotate' || gizmoMode === 'scale') && (idle || !creature.bones.get(selected)?.parent)) gizmoMode = gizmos() === 'none' ? 'off' : 'pose';
  renderGizmoButton();
}

// ---- dragging the arrows on a part: it moves live, and is set into the skeleton on release ----

let drag: { b: BoneRT; start: THREE.Matrix4; startProxy: THREE.Matrix4; parentInv: THREE.Matrix4; local0: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 } } | null = null;

export function partGizmoDown(): boolean {
  if (!onPart || gizmo.object !== proxy) return false;
  const b = onPart;
  creature.root.updateMatrixWorld(true);
  drag = {
    b,
    start: b.pivot.matrixWorld.clone(),
    startProxy: proxy.matrixWorld.clone(),
    parentInv: b.pivot.parent!.matrixWorld.clone().invert(),
    local0: { p: b.pivot.position.clone(), q: b.pivot.quaternion.clone(), s: b.pivot.scale.clone() },
  };
  return true;
}

/** The change since the drag began, as a move in the world (sized evenly: a part grows the same all round). */
function dragDelta(): THREE.Matrix4 | null {
  if (!drag) return null;
  if (gizmo.mode === 'scale') {
    const k = Math.cbrt(Math.abs(proxy.scale.x * proxy.scale.y * proxy.scale.z)) || 1;
    proxy.scale.setScalar(k);
  }
  proxy.updateMatrixWorld(true);
  return proxy.matrixWorld.clone().multiply(drag.startProxy.clone().invert());
}

export function partGizmoChange(): boolean {
  if (!drag || gizmo.object !== proxy) return false;
  const d = dragDelta()!;
  const local = drag.parentInv.clone().multiply(d).multiply(drag.start);
  local.decompose(drag.b.pivot.position, drag.b.pivot.quaternion, drag.b.pivot.scale);
  // its joins follow it as it goes
  creature.markMergeDirty();
  return true;
}

export function partGizmoUp(): boolean {
  if (!drag || gizmo.object !== proxy) return false;
  const { b, start, local0 } = drag;
  const d = dragDelta()!;
  drag = null;
  b.pivot.position.copy(local0.p);
  b.pivot.quaternion.copy(local0.q);
  b.pivot.scale.copy(local0.s);
  // the change in the part's own frame, then as it would be at rest: that's what the skeleton holds
  const own = start.clone().invert().multiply(d).multiply(start);
  const rest = pivotAtRest(b);
  let m = rest.clone().multiply(own).multiply(rest.clone().invert());
  // a pair is defined by its +X twin: the change mirrored across
  if (b.def.sideSign === -1) {
    const mx = new THREE.Matrix4().makeScale(-1, 1, 1);
    m = mx.clone().multiply(m).multiply(mx);
  }
  const k = new THREE.Vector3().setFromMatrixScale(m).x;
  if (own.equals(new THREE.Matrix4())) return true;
  moveLimb(b, m, k);
  buildCreature();
  commit();
  if (k > 1.001 || k < 0.999) hint(k > 1 ? 'Bigger' : 'Smaller', 900);
  return true;
}

/** A part and everything on it, moved (turned, sized evenly) by `m` in the skeleton's coordinates; their markings too. */
export function moveLimb(b: BoneRT, m: THREE.Matrix4, k: number) {
  const rig = state.rig;
  const ids = new Set<string>();
  const add = (id: string) => {
    ids.add(id);
    for (const d of rig.bones) if (d.parent === id || d.parent === id + 'L' || d.parent === id + 'R') add(d.id);
  };
  add(b.def.baseId);
  const r4 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4) / 1e4) as V3;
  const turn = new THREE.Matrix4().extractRotation(m);
  for (const d of rig.bones) {
    if (!ids.has(d.id)) continue;
    d.start = r4(new THREE.Vector3(...d.start).applyMatrix4(m));
    d.end = r4(new THREE.Vector3(...d.end).applyMatrix4(m));
    d.side = r4(new THREE.Vector3(...d.side).applyMatrix4(turn).normalize());
    for (const id of [d.id, d.id + 'L']) {
      const p = state.parts[id];
      if (p?.markings) p.markings = p.markings.map((mk) => movedMarking(mk, m));
    }
    if (Math.abs(k - 1) > 1e-4) {
      d.width = Math.round(d.width * k * 1e4) / 1e4;
      if (d.widthEnd !== undefined) d.widthEnd = Math.round(d.widthEnd * k * 1e4) / 1e4;
      for (const id of [d.id, d.id + 'L']) if (state.parts[id]) scalePart(state.parts[id], k);
    }
  }
  if (!rig.base.startsWith('custom')) rig.base = 'custom';
}

/** A part's drawing (and what goes with it) at `k` times its size. */
export function scalePart(p: PartState, k: number) {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const grow = (l: [number, number][]) => l.map(([x, y]) => [r4(x * k), r4(y * k)] as [number, number]);
  if (p.outline) p.outline = grow(p.outline);
  if (p.holes) p.holes = p.holes.map(grow);
  for (const sh of p.more ?? []) {
    sh.outline = grow(sh.outline);
    if (sh.holes) sh.holes = sh.holes.map(grow);
  }
  if (p.wall) p.wall *= k;
  const sized = (a: number[]) => {
    const m = new THREE.Matrix4().fromArray(a);
    m.elements[12] *= k;
    m.elements[13] *= k;
    m.elements[14] *= k;
    return m.toArray();
  };
  if (p.sits) p.sits = sized(p.sits);
  if (p.thingSpace) p.thingSpace = { m: sized(p.thingSpace.m), reach: p.thingSpace.reach * k, wrapReach: p.thingSpace.wrapReach * k };
}

// ---- the button on the view cube ----

function renderGizmoButton() {
  const btn = document.getElementById('gizmo-mode');
  if (!btn) return;
  const m = MODES.find((x) => x.mode === gizmoMode)!;
  btn.innerHTML = faClassic(m.icon);
  btn.title = `Handles: ${m.label} (click to change)`;
  btn.classList.toggle('on', gizmoMode !== 'off');
}

/** The handles to choose from, as menu items (the view cube's button, and right-clicking the view). */
export function handleItems(): MenuItem[] {
  return MODES.map((x) => ({
    label: x.label,
    icon: `fa-duotone fa-regular fa-${x.icon}`,
    title: x.title,
    checked: x.mode === gizmoMode || undefined,
    ...(x.key && keyLabel(x.key) ? { key: keyLabel(x.key) } : {}),
    run: () => setGizmoMode(x.mode),
  }));
}

export function initGizmoMode() {
  scene.add(proxy);
  const btn = $('#gizmo-mode');
  btn.onclick = () => {
    const r = btn.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 4, 'Handles', handleItems());
  };
  renderGizmoButton();
}
