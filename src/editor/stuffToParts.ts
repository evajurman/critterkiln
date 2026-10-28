// ---------------------------------------------------------------------------
// Stuff from before things were parts: worn things (attachments) become parts
// on the creature, each piece a part placed exactly where it was, kept apart
// from the body; things a Scatter marking scatters become small creatures kept
// off stage, which the scatter then scatters. Done once, as a creature loads.

import * as THREE from 'three';
import { Creature, defaultState, type Attachment, type BoneRT, type CreatureState, type PartState } from '../creature';
import { bendOf, bendPoint, isBent, restFrame, type Bend } from '../bend';
import { expandRig, type BoneDef, type RigState, type V3 } from '../rigs';
import { bounds, type Vec2 } from '../inflate';
import { placeMatrix, thingReaches, uid, type Piece, type Thing } from '../stuff';
import { movedMarking, shownMarkings } from '../markings';
import { mirrorMove } from '../animate';

const ONE = new THREE.Vector3(1, 1, 1);
const FLIP_Z = new THREE.Matrix4().makeScale(1, 1, -1);
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
const r3 = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e5) / 1e5) as V3;

/** A converted piece: its part (in its own drawing's space) and where that space sits. */
interface PiecePart {
  piece: Piece;
  part: PartState;
  /** part space -> the thing's space (scaled to how it was worn) */
  toThing: THREE.Matrix4;
  length: number;
  width: number;
}

/**
 * Worn things into parts (each linked to My stuff, as the same thing
 * everywhere), and scattered things into creatures kept off stage. Returns
 * those new creatures (their scatters point at them already), and the worn
 * things, for My stuff.
 */
export function convertStuff(s: CreatureState): { offstage: CreatureState[]; worn: Thing[] } {
  const made: CreatureState[] = [];
  const worn: Thing[] = [];
  if (s.attachments?.length) {
    const probe = new Creature(s, true);
    for (const a of s.attachments) {
      wornToParts(s, probe, a);
      if (!worn.some((t) => t.id === a.thing.id)) worn.push(a.thing);
    }
    probe.dispose();
    delete s.attachments;
  }
  for (const m of [...(s.markings ?? []), ...Object.values(s.parts).flatMap((p) => p.markings ?? [])]) {
    if (m.type !== 'scatter' || !m.thing) continue;
    if (m.thing.pieces.some((p) => p.outline.length >= 3)) {
      const c = thingCreature(m.thing);
      made.push(c);
      m.source = c.id;
    }
    delete m.thing;
  }
  delete s.workbench;
  return { offstage: made, worn };
}

/** Each piece of a thing as a part: outline scaled and moved so the bone runs through it, and where its space is in the thing's. */
function pieceParts(thing: Thing, k: number, look: (p: Piece) => Pick<PartState, 'style' | 'materialSettings'>, apart: (p: Piece) => true | string): PiecePart[] {
  const reach = thingReaches(thing);
  return thing.pieces
    .filter((p) => p.outline.length >= 3)
    .map((p) => {
      const scale = ([x, y]: Vec2): Vec2 => [x * k, y * k];
      const outline = p.outline.map(scale);
      const b = bounds(outline);
      // the bone runs up the middle of what's drawn (a turned piece spins round its centre line: it stays there)
      const cx = p.kind === 'turned' ? 0 : (b.minX + b.maxX) / 2;
      const shift = ([x, y]: Vec2): Vec2 => [x - cx, y - b.minY];
      const placed = placeMatrix(p);
      const pos = new THREE.Vector3().setFromMatrixPosition(placed).multiplyScalar(k);
      const q = new THREE.Quaternion().setFromRotationMatrix(placed);
      const toThing = new THREE.Matrix4()
        .compose(pos, q, ONE)
        .multiply(new THREE.Matrix4().makeTranslation(cx, b.minY, p.z * k));
      const shaped = { ...look(p) };
      const part: PartState = {
        outline: outline.map(shift),
        thickness: 1,
        color: p.color,
        ...shaped,
        apart: apart(p),
        ...(p.opacity !== undefined && p.opacity < 1 ? { opacity: p.opacity } : {}),
        ...(p.glow ? { glow: p.glow } : {}),
        ...(p.glowFollow ? { glowFollow: p.glowFollow } : {}),
      };
      if (p.kind !== 'turned' && p.holes.length) part.holes = p.holes.map((h) => h.map(scale).map(shift));
      if (p.kind === 'flat') {
        part.kind = 'flat';
        // a flat part's depth goes with its width (see pieceKindGeometry)
        part.thickness = Math.max(0.003, p.thickness) * k / (0.3 * Math.max(b.w, 1e-3));
        part.round = p.round;
      } else if (p.kind === 'turned') {
        part.kind = 'turned';
        if (p.hollow) Object.assign(part, { hollow: true, wall: p.thickness * k }, p.open ? { open: true } : {});
      } else part.thickness = p.thickness;
      // (laid out in the thing's own space still: see wornToParts)
      const marks = shownMarkings(thing.markings, p.markings, p.id).map((mk) => {
        const c = structuredClone(mk);
        delete c.skip;
        return c;
      });
      if (marks.length) part.markings = marks;
      return { piece: p, part, toThing, length: Math.max(0.02, b.h), width: Math.min(0.2, Math.max(0.03, b.w * 0.5)), reach };
    })
    .map(({ reach, ...pp }) => {
      if (Math.abs(thing.bend ?? 0) >= 0.005) {
        pp.part.curve = thing.bend;
        pp.part.curveMode = thing.bendMode ?? 'axis';
        pp.part.thingSpace = { m: pp.toThing.toArray(), reach: reach.reach * k, wrapReach: reach.wrapReach * k };
      }
      return pp;
    });
}

/** The biggest piece holds the rest (they hang off it, so they go where it goes). */
function rootIndex(pieces: PiecePart[]): number {
  let best = 0, area = -1;
  pieces.forEach((pp, i) => {
    const b = bounds(pp.part.outline!);
    if (b.w * b.h > area) (area = b.w * b.h), (best = i);
  });
  return best;
}

/** A bone whose rest frame is `R` (a turn and a place, in skeleton coordinates). */
function boneAt(id: string, name: string, parent: string | undefined, R: THREE.Matrix4, length: number, width: number, mirror: boolean): BoneDef {
  const start = new THREE.Vector3().setFromMatrixPosition(R);
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  R.extractBasis(x, y, z);
  return { id, name, ...(parent ? { parent } : {}), start: r3(start), end: r3(start.clone().addScaledVector(y.normalize(), length)), side: r3(x.normalize()), width, mirror };
}

/** A bone's pivot at rest, in skeleton coordinates (what worn stuff was placed in: it carries a bent parent's shift). */
export function pivotAtRest(b: BoneRT): THREE.Matrix4 {
  const chain: BoneRT[] = [];
  for (let o: BoneRT | null = b; o; o = o.parent) chain.unshift(o);
  const m = new THREE.Matrix4();
  for (const o of chain) m.multiply(new THREE.Matrix4().compose(o.pivot.position, o.restQuat, ONE));
  return m;
}

/** The rest frame a child of a bent bone needs so that, shifted along the bend as children are (bendChild), it lands at `want` (its place in the parent). */
function unbend(bd: Bend, want: THREE.Matrix4): THREE.Matrix4 {
  if (!isBent(bd)) return want.clone();
  const goal = new THREE.Vector3().setFromMatrixPosition(want);
  const out = want.clone();
  const at = goal.clone();
  for (let i = 0; i < 5; i++) {
    const sy = Math.min(bd.len, Math.max(0, at.y));
    const [bx, by, bz] = bendPoint(bd, 0, sy, 0);
    at.copy(goal).sub(new THREE.Vector3(bx, by - sy, bz));
  }
  return out.setPosition(at);
}

function uniqueBoneId(rig: RigState, base: string): string {
  const used = new Set(expandRig(rig).bones.flatMap((b) => [b.id, b.baseId]));
  let i = 1;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** A worn thing as parts on the part wearing it (and its mirror image, if it showed on both sides). */
function wornToParts(s: CreatureState, probe: Creature, a: Attachment) {
  const wearer = probe.bones.get(a.bone);
  if (!wearer || !a.thing.pieces.length) return;
  const k = Math.cbrt(Math.abs(a.scale[0] * a.scale[1] * a.scale[2])) || 1;
  const wearerPart = s.parts[wearer.src];
  const thing = a.thing;
  const group = thing.pieces.some((p) => (p.blendShape ?? 0) > 0) ? `thing-${a.id}` : null;
  const pieces = pieceParts(
    thing,
    k,
    (p) => {
      // made of what the part wearing it is made of, or its pieces' own (with the thing's own settings, if it had them)
      if (thing.inherit) return { style: wearerPart?.style ?? s.style };
      const own = thing.ownMaterial && thing.materialSettings?.[p.style];
      return { style: p.style, ...(own ? { materialSettings: { [p.style]: structuredClone(own) } } : {}) };
    },
    // pieces that blended into each other still do; the rest stay apart from everything
    (p) => (group && (p.blendShape ?? 0) > 0 ? group : true),
  );
  if (!pieces.length) return;
  if (a.wrap) {
    const reach = thingReaches(thing);
    for (const pp of pieces) {
      delete pp.part.curve;
      delete pp.part.curveMode;
      Object.assign(pp.part, {
        wrap: thing.wrapStrength ?? 1,
        wrapSmooth: thing.wrapSmooth ?? 0.3,
        thingSpace: { m: pp.toThing.toArray(), reach: reach.reach * k, wrapReach: reach.wrapReach * k },
      });
    }
  }
  // where the thing sat, in skeleton coordinates: its frame, scaled as it was worn
  const place = new THREE.Matrix4().compose(new THREE.Vector3(...a.position), new THREE.Quaternion(...a.quaternion), ONE);
  const thingAt = pivotAtRest(wearer).multiply(place);
  const ri = rootIndex(pieces);
  const order = [pieces[ri], ...pieces.filter((_, i) => i !== ri)];

  // shown on both sides: a mirrored pair, defined on +X (its other side worked out by mirroring)
  const twin = a.mirror ? probe.mirrorBoneOf(wearer) : null;
  const pair = !!twin;
  // worn on the -X side (the right twin, or left of a middle part's middle): the +X side is its mirror image
  const onMinus = pair && (wearer.def.sideSign !== 0 ? wearer.def.sideSign === -1 : new THREE.Vector3().setFromMatrixPosition(thingAt.clone().multiply(order[0].toThing)).x < 0);
  // (mirrored, its frame is turned so it stays a turn: Z flipped)
  const toPlus = (m: THREE.Matrix4) => (onMinus ? MIRROR_X.clone().multiply(m).multiply(FLIP_Z) : m);
  // where the thing's own points go (mirrored on the +X side, not turned: the frames above are turned to stay frames)
  const pointsAt = onMinus ? MIRROR_X.clone().multiply(thingAt) : thingAt.clone();
  // its markings were laid out in the thing's space (as it was drawn, before it was sized): now in the creature's, where it was
  const marksAt = pointsAt.clone().multiply(new THREE.Matrix4().makeScale(k, k, k));
  for (const pp of order) if (pp.part.markings) pp.part.markings = pp.part.markings.map((mk) => movedMarking(mk, marksAt));
  const plusWearer = wearer.def.sideSign === -1 && pair ? twin! : wearer;
  // (a single thing on one side of a pair hangs off that side; a pair off the pair as a whole)
  const parent = pair ? (wearer.def.sideSign !== 0 ? wearer.def.baseId : wearer.def.id) : wearer.def.id;
  const parentAt = pair ? pivotAtRest(plusWearer) : pivotAtRest(wearer);
  const parentRest = pair ? plusWearer.restWorld : wearer.restWorld;
  const parentBend = bendOf(pair ? plusWearer.def : wearer.def, pair ? plusWearer.length : wearer.length);

  const rig = s.rig;
  const rootId = uniqueBoneId(rig, 'thing');
  const scene = (id: string) => (pair ? id + 'L' : id);
  let rootRest: THREE.Matrix4 | null = null;
  let rootAt: THREE.Matrix4 | null = null;
  order.forEach((pp, i) => {
    const id = i === 0 ? rootId : uniqueBoneId(rig, `${rootId}-`);
    const at = toPlus(thingAt.clone().multiply(pp.toThing));
    let rest: THREE.Matrix4;
    if (i === 0) {
      // in its parent's frame, as it's built there (children of a bent part are shifted along its bend)
      const local = parentAt.clone().invert().multiply(at);
      rest = parentRest.clone().multiply(unbend(parentBend, local));
      rootRest = rest;
      rootAt = at;
      // where the thing sat, as its top part sees it (My stuff places it the same way again)
      pp.part.sits = rest.clone().invert().multiply(pointsAt).toArray();
      // the same thing as in My stuff
      pp.part.link = thing.id;
    } else rest = rootRest!.clone().multiply(rootAt!.clone().invert().multiply(at));
    const name = i === 0 ? thing.name.trim() || 'Thing' : `${thing.name.trim() || 'Thing'} ${i + 1}`;
    rig.bones.push(boneAt(id, name, i === 0 ? parent : rootId, rest, pp.length, pp.width, pair));
    // stored for the +X side: its other side mirrors it (see curveSpaceOf)
    if (onMinus && pp.part.thingSpace) pp.part.thingSpace.m = new THREE.Matrix4().fromArray(pp.part.thingSpace.m).multiply(FLIP_Z).toArray();
    s.parts[scene(id)] = pp.part;
  });
  if (rig.base && !rig.base.startsWith('custom')) rig.base = 'custom';
  s.pictures = { ...s.pictures, ...thing.pictures };

  // its motion goes with the part holding the rest, in the frame of the part it's on
  if (a.anim) {
    const moves = (s.moves ??= {});
    if (!pair) moves[rootId] = structuredClone(a.anim);
    else if (wearer.def.sideSign !== 0) moves[rootId + 'L'] = moves[rootId + 'R'] = structuredClone(a.anim);
    else {
      // off a middle part, each side is the other's mirror image
      const here = structuredClone(a.anim), there = mirrorMove(a.anim);
      moves[rootId + 'L'] = onMinus ? there : here;
      moves[rootId + 'R'] = onMinus ? here : there;
    }
  }
}

/** A scattered thing as a small creature of its own, kept off stage: its pieces as parts, where they were in the thing. */
export function thingCreature(thing: Thing): CreatureState {
  const group = thing.pieces.some((p) => (p.blendShape ?? 0) > 0) ? 'thing' : null;
  const pieces = pieceParts(thing, 1, (p) => ({ style: p.style, ...(thing.ownMaterial && thing.materialSettings?.[p.style] ? { materialSettings: { [p.style]: structuredClone(thing.materialSettings[p.style]!) } } : {}) }), (p) =>
    group && (p.blendShape ?? 0) > 0 ? group : true,
  );
  const ri = rootIndex(pieces);
  const order = [pieces[ri], ...pieces.filter((_, i) => i !== ri)];
  const rig: RigState = { base: 'custom', name: thing.name || 'Thing', headId: 'piece1', bones: [] };
  order.forEach((pp, i) => rig.bones.push(boneAt(`piece${i + 1}`, i === 0 ? thing.name.trim() || 'Thing' : `Piece ${i + 1}`, i === 0 ? undefined : 'piece1', pp.toThing, pp.length, pp.width, false)));
  const c = defaultState(rig, order[0].piece.color);
  order.forEach((pp, i) => (c.parts[`piece${i + 1}`] = pp.part));
  // it sits on the surface as the thing did: its crosshair at the origin, facing out along Z
  c.parts.piece1.sits = order[0].toThing.clone().invert().toArray();
  return {
    ...c,
    id: uid(),
    name: thing.name.trim() || 'Thing',
    offstage: true,
    keepFloor: false,
    eyes: { ...c.eyes, enabled: false, pairs: [] },
    ...(thing.pictures ? { pictures: structuredClone(thing.pictures) } : {}),
  };
}

/**
 * Things made parts before their markings moved with them (stuff converted, or
 * put on from My stuff, by an earlier version): their markings were left in
 * the thing's own space. Each thing's top part knows where it sits, so they're
 * laid out there now. (Things worn bigger or smaller than drawn keep their
 * markings' size as drawn.)
 */
export function repairThingMarkings(s: CreatureState) {
  const bones = expandRig(s.rig).bones;
  const kids = (id: string) => bones.filter((b) => b.parent === id);
  for (const top of bones) {
    const p = s.parts[top.id];
    if (!p?.sits) continue;
    const at = restFrame(top).world.multiply(new THREE.Matrix4().fromArray(p.sits));
    const stack = [top];
    while (stack.length) {
      const b = stack.pop()!;
      const q = s.parts[b.id];
      if (q?.markings) q.markings = q.markings.map((mk) => movedMarking(mk, at));
      stack.push(...kids(b.id));
    }
  }
}

/** Whether a creature still has stuff from before things were parts. */
export function hasOldStuff(s: CreatureState): boolean {
  return !!s.attachments?.length || [...(s.markings ?? []), ...Object.values(s.parts).flatMap((p) => p.markings ?? [])].some((m) => m.type === 'scatter' && !!m.thing);
}
