// ---------------------------------------------------------------------------
// Creatures as items: a creature can ride on a part of another (worn, like a
// hat that's a whole creature), going wherever that part goes; and one can be
// kept off stage, only seen scattered over others (see scatter markings) and
// while it's the one being edited. Either way it's still a creature in the
// scene: clicking it edits it like any other.

import { checkScattered, othersHidden } from './focus';
import * as THREE from 'three';
import { Creature, type BoneRT, type CreatureState, type Ride } from '../creature';
import { uid } from '../stuff';
import { camera } from './stage';
import { activate, commit, creature, creatures, mode, state, world } from './state';
import { creatureLabel, raycaster, setRay, setKeepFloor, settleOnFloor } from './controls';
import { drawState } from './drawing';
import { freeSpot } from './creatureBar';
import { selectAllParts } from './partPanel';
import { renderUI } from './panels';
import { frameCreature } from './framing';
import { hint } from './hints';
import { invalidate } from './loop';

/** A creature's id, given one if it has none (or shares another's). */
export function creatureId(s: CreatureState): string {
  if (!s.id || world.creatures.some((o) => o !== s && o.id === s.id)) s.id = uid();
  return s.id;
}

/** The creature in the scene with this id. */
export function creatureById(id: string): Creature | undefined {
  const i = world.creatures.findIndex((s) => s.id === id);
  return i >= 0 ? creatures[i] : undefined;
}

/** The part a creature rides on, if it rides on one that's still there. */
function hostOf(s: CreatureState): { host: Creature; bone: BoneRT } | null {
  const host = s.rides && creatureById(s.rides.on);
  const bone = host && host.bones.get(s.rides!.bone);
  return host && bone && host.state !== s ? { host, bone } : null;
}

/** Whether `a` rides (or rides on something riding, and so on) on `b`. */
function ridesOn(a: CreatureState, b: CreatureState): boolean {
  const seen = new Set<CreatureState>();
  for (let s: CreatureState | undefined = a; s?.rides && !seen.has(s); ) {
    seen.add(s);
    const next = world.creatures.find((o) => o.id === s!.rides!.on);
    if (next === b) return true;
    s = next;
  }
  return false;
}

const place = new THREE.Matrix4();
/**
 * Riders go where the parts they ride on are now (hosts first, so a rider on
 * a rider keeps up); creatures off stage show only while they're the one
 * being edited. Before every frame drawn.
 */
export function followRiders() {
  checkScattered();
  const done = new Set<Creature>();
  const follow = (c: Creature, depth = 0) => {
    if (done.has(c) || depth > 8) return;
    done.add(c);
    const h = hostOf(c.state);
    if (!h) return;
    follow(h.host, depth + 1);
    const r = c.state.rides!;
    h.host.root.updateMatrixWorld(true);
    place.compose(new THREE.Vector3(...r.position), new THREE.Quaternion(...r.quaternion), new THREE.Vector3(...r.scale));
    place.premultiply(h.bone.pivot.matrixWorld).decompose(c.root.position, c.root.quaternion, c.root.scale);
    c.root.updateMatrixWorld(true);
  };
  for (const c of creatures) follow(c);
  // (drawing a part hides the others itself; on the table, or in Solo, only the one being worked on shows)
  if (!drawState) for (const c of creatures) c.root.visible = c === creature || (!c.state.offstage && !c.state.table && !othersHidden());
}

/** After the active creature was moved by hand (its Move, Rotate or Scale handles): if it rides, it rides where it was put. */
export function captureRide(c: Creature) {
  const h = hostOf(c.state);
  if (!h) return;
  h.host.root.updateMatrixWorld(true);
  c.root.updateMatrixWorld(true);
  c.state.rides = rideFrom(c.state.rides!.on, h.bone, c.root.matrixWorld);
}

const r4 = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
/** A ride on `bone` that puts the rider's floor point at `world`. */
function rideFrom(on: string, bone: BoneRT, world: THREE.Matrix4): Ride {
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  bone.pivot.matrixWorld.clone().invert().multiply(world).decompose(pos, q, s);
  return { on, bone: bone.def.id, position: r4(pos.toArray()) as Ride['position'], quaternion: r4(q.toArray()) as Ride['quaternion'], scale: r4(s.toArray()) as Ride['scale'] };
}

/**
 * Creature `rider` rides on `host` at a spot on its surface: standing on it
 * (its up out of the surface), facing the way it faced as near as it can, and
 * as big as it is now.
 */
export function rideAt(rider: Creature, host: Creature, hit: { bone: BoneRT; point: THREE.Vector3; normal: THREE.Vector3 }) {
  const up = hit.normal.clone().normalize();
  rider.root.updateMatrixWorld(true);
  const facing = new THREE.Vector3(0, 0, 1).transformDirection(rider.root.matrixWorld);
  facing.addScaledVector(up, -facing.dot(up));
  if (facing.lengthSq() < 1e-6) facing.set(1, 0, 0).addScaledVector(up, -up.x);
  facing.normalize();
  const side = new THREE.Vector3().crossVectors(up, facing);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, facing));
  const world = new THREE.Matrix4().compose(hit.point, q, rider.root.getWorldScale(new THREE.Vector3()));
  host.root.updateMatrixWorld(true);
  rider.state.rides = rideFrom(creatureId(host.state), hit.bone, world);
  // it rides now: no settling onto the floor
  rider.state.keepFloor = false;
  followRiders();
  commit();
  renderUI();
  hint(`${creatureLabel(creatures.indexOf(rider))} rides on ${creatureLabel(creatures.indexOf(host))} now: it goes where that part goes (the Scale handles size it)`, 3000);
}

/** Where the camera looks at a creature's part: a spot on its surface (or none). */
export function spotOnPart(c: Creature, boneId: string) {
  const b = c.bones.get(boneId);
  if (!b) return null;
  b.pivot.updateMatrixWorld(true);
  const mid = b.pivot.localToWorld(new THREE.Vector3(0, b.length / 2, 0));
  const from = camera.position.clone();
  raycaster.set(from, mid.clone().sub(from).normalize());
  const hit = c.surfaceAt(raycaster);
  return hit?.bone === b ? hit : null;
}

/** Put creature `i` on the active creature's picked part (from My stuff's list of creatures). */
export function wearCreature(i: number, boneId: string) {
  const rider = creatures[i];
  if (!rider || rider === creature) return;
  if (ridesOn(state, rider.state)) return hint(`${creatureLabel(world.active)} already rides on it`, 2400, true);
  const hit = spotOnPart(creature, boneId);
  if (!hit) return hint('Turn the view so you can see that part, then try again', 2400, true);
  rideAt(rider, creature, hit);
}

/** Back down on the floor, beside everyone else. */
export function takeOff(c: Creature = creature) {
  if (!c.state.rides) return;
  delete c.state.rides;
  c.state.placement = freeSpot();
  c.applyPlacement();
  if (c === creature) {
    setKeepFloor(true);
    // (as it stood on the creature: its feet may be below the floor)
    settleOnFloor();
  } else c.state.keepFloor = true;
  commit();
  renderUI();
  hint('Back on the floor', 1600);
}

/** Off stage: only seen scattered (and while it's the one being edited), or back on the stage. */
export function setOffstage(c: Creature, on: boolean) {
  if (on) c.state.offstage = true;
  else delete c.state.offstage;
  followRiders();
  invalidate();
  commit();
  renderUI();
  if (on) hint('Off stage: it only shows while you edit it, or where it’s scattered', 2600);
}

// ---- picking where the active creature rides: click a spot on another ----

export let pickingRide = false;
export function startPickingRide() {
  if (creatures.length < 2 || mode === 'stuff') return;
  pickingRide = true;
  document.body.classList.add('picking-spot');
  hint('Click the spot on another creature to put it on (Esc: never mind)', 0);
}
export function stopPickingRide() {
  if (!pickingRide) return;
  pickingRide = false;
  document.body.classList.remove('picking-spot');
  hint('');
}

/** A click while picking where to ride. */
export function rideClick(x: number, y: number) {
  setRay(x, y);
  let best: { host: Creature; hit: NonNullable<ReturnType<Creature['surfaceAt']>> } | null = null;
  for (const c of creatures) {
    if (c === creature || !c.root.visible || ridesOn(c.state, state)) continue;
    const hit = c.surfaceAt(raycaster);
    if (hit && (!best || hit.point.distanceTo(raycaster.ray.origin) < best.hit.point.distanceTo(raycaster.ray.origin))) best = { host: c, hit };
  }
  stopPickingRide();
  if (!best) return hint('That’s not on another creature', 1800, true);
  rideAt(creature, best.host, best.hit);
}

/** Edit another creature (one that's scattered, say): it becomes the one every panel works on. */
export function editCreature(id: string) {
  const i = world.creatures.findIndex((s) => s.id === id);
  if (i < 0) return;
  activate(i);
  selectAllParts();
  followRiders();
  renderUI();
  frameCreature();
  hint(`Editing ${creatureLabel(i)}: its copies change with it. Done (or Esc) goes back`, 3000);
}

export function initRiders() {
  Creature.find = (id) => creatureById(id);
  for (const s of world.creatures) creatureId(s);
}
