export type V3 = [number, number, number];

/**
 * A bone is also a body part: you draw its outline in the plane spanned by
 * `side` (horizontal on the drawing) and the bone direction (vertical).
 * Coordinates: Y up, creature faces +Z, creature's left is +X.
 */
export interface BoneDef {
  id: string;
  name: string;
  parent?: string;
  start: V3;
  end: V3;
  side: V3;
  /** default shape width at the base of the bone */
  width: number;
  /** default shape width at the tip (defaults to `width`) */
  widthEnd?: number;
  /** curve the bone into an arc in its drawing plane */
  bendy?: boolean;
  /** how far it curves, -1..1 (a full 1 is about a half-circle) */
  bend?: number;
  /**
   * which way it curves, radians around the bone: 0 = sideways in the drawing
   * plane, pi/2 = out of the drawing (for a body: forward), pi = the other side
   */
  bendDir?: number;
  /**
   * bend points: the bone curves smoothly through them (instead of one
   * arc, bend and bendDir), each one where it sits in the
   * bone's frame as a fraction of its length (X side, Y along, Z out)
   */
  bendNodes?: V3[];
  /** how round the curve is at each bend point (1 = round, 0 = a corner, 2 = swollen; unset = 1) */
  bendRound?: number[];
  /**
   * turn the bone about the line from its base to its tip, radians: the
   * drawing (and so a flat part like a wing) turns with it
   */
  roll?: number;
  thickness?: number;
  color?: string;
  /** Define once on the +X side; a mirrored twin is generated. */
  mirror?: boolean;
  /** IK chains stop before reaching this bone. */
  anchor?: boolean;
  /** detached: its base can slide anywhere, even back onto its parent's tip */
  loose?: boolean;
  /** Filled in by expansion: the part whose drawing this bone reuses. */
  mirrorOf?: string;
}

export interface RigDef {
  id: string;
  name: string;
  /** Font Awesome classes for the picker button. */
  icon: string;
  headId: string;
  /** Direction the face looks, for placing eyes (default +Z). */
  eyeDir?: V3;
  bones: BoneDef[];
}

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const Z: V3 = [0, 0, 1];

const biped: RigDef = {
  id: 'biped',
  name: 'Biped',
  icon: 'fa-solid fa-person-limbs-wide',
  headId: 'head',
  // one bone per limb: short and stout (Split a bone in Rig mode for elbows and knees)
  bones: [
    { id: 'body', name: 'Body', start: [0, 0.44, 0], end: [0, 1.0, 0], side: X, width: 0.82, anchor: true },
    { id: 'head', name: 'Head', parent: 'body', start: [0, 1.01, 0], end: [0, 1.56, 0], side: X, width: 0.6 },
    { id: 'arm', name: 'Arm', parent: 'body', start: [0.34, 0.88, 0], end: [0.58, 0.58, 0], side: Y, width: 0.22, widthEnd: 0.2, mirror: true },
    { id: 'leg', name: 'Leg', parent: 'body', start: [0.2, 0.48, 0], end: [0.21, 0.12, 0], side: X, width: 0.29, widthEnd: 0.27, mirror: true },
  ],
};

const quadruped: RigDef = {
  id: 'quadruped',
  name: 'Quadruped',
  icon: 'fa-solid fa-dog',
  headId: 'head',
  bones: [
    { id: 'body', name: 'Body', start: [0, 0.64, -0.46], end: [0, 0.68, 0.46], side: Y, width: 0.66, anchor: true },
    { id: 'head', name: 'Head', parent: 'body', start: [0, 0.78, 0.42], end: [0, 1.12, 0.8], side: Y, width: 0.52 },
    { id: 'tail', name: 'Tail', parent: 'body', start: [0, 0.72, -0.52], end: [0, 0.98, -0.86], side: Y, width: 0.14 },
    { id: 'frontLeg', name: 'Front leg', parent: 'body', start: [0.21, 0.56, 0.32], end: [0.22, 0.12, 0.35], side: Z, width: 0.24, widthEnd: 0.22, mirror: true },
    { id: 'backLeg', name: 'Back leg', parent: 'body', start: [0.21, 0.56, -0.34], end: [0.22, 0.12, -0.36], side: Z, width: 0.26, widthEnd: 0.23, mirror: true },
    // short ears up on top of the head
    { id: 'ear', name: 'Ear', parent: 'head', start: [0.11, 1.16, 0.72], end: [0.15, 1.32, 0.7], side: X, width: 0.16, widthEnd: 0.1, mirror: true },
  ],
};

const bird: RigDef = {
  id: 'bird',
  name: 'Bird',
  icon: 'fa-solid fa-crow',
  headId: 'head',
  bones: [
    { id: 'body', name: 'Body', start: [0, 0.47, -0.38], end: [0, 0.75, 0.28], side: Y, width: 0.58, anchor: true },
    { id: 'head', name: 'Head', parent: 'body', start: [0, 0.79, 0.24], end: [0, 1.21, 0.36], side: Z, width: 0.42 },
    { id: 'beak', name: 'Beak', parent: 'head', start: [0, 1.03, 0.46], end: [0, 0.99, 0.74], side: Y, width: 0.13, thickness: 0.7, color: '#f2a23a' },
    // folded wings: from the shoulder at the neck line, down and back along the body
    { id: 'wing', name: 'Wing', parent: 'body', start: [0.27, 0.72, 0.2], end: [0.32, 0.44, -0.42], side: Y, width: 0.36, widthEnd: 0.22, thickness: 0.25, mirror: true, bendy: true, bend: 0 },
    { id: 'tail', name: 'Tail', parent: 'body', start: [0, 0.49, -0.38], end: [0, 0.37, -0.86], side: X, width: 0.34, thickness: 0.28 },
    // short stub legs
    { id: 'leg', name: 'Leg', parent: 'body', start: [0.12, 0.42, 0.02], end: [0.13, 0.06, 0.05], side: Z, width: 0.1, widthEnd: 0.13, mirror: true, color: '#f2a23a' },
  ],
};

const serpent: RigDef = {
  id: 'serpent',
  eyeDir: [0, 0.6, 1],
  name: 'Serpent',
  icon: 'fa-solid fa-snake',
  headId: 'head',
  // laid out straight along the middle, front to back, every part's drawing
  // square to the creature, so turning one part keeps the rest symmetric and
  // the head level. A neck rises from the front of the body in a gentle S to
  // hold the head up, looking forward; the tail slithers off behind in a
  // sideways S. Dragging the head uncurls the neck, stopping at the anchored body
  bones: [
    { id: 'body', name: 'Body', start: [0, 0.17, -0.22], end: [0, 0.17, 0.22], side: X, width: 0.34, anchor: true },
    { id: 'neck', name: 'Neck', parent: 'body', start: [0, 0.19, 0.2], end: [0, 0.7, 0.32], side: X, width: 0.31, widthEnd: 0.28, bendy: true, bend: 0.35, bendDir: -Math.PI / 2 },
    { id: 'head', name: 'Head', parent: 'neck', start: [0, 0.7, 0.3], end: [0, 0.68, 0.76], side: X, width: 0.42, thickness: 0.7 },
    { id: 'tail', name: 'Tail', parent: 'body', start: [0, 0.17, -0.22], end: [0, 0.16, -0.66], side: X, width: 0.33, widthEnd: 0.27, bendy: true, bend: 0.4 },
    { id: 'tip', name: 'Tail tip', parent: 'tail', start: [0, 0.16, -0.66], end: [0, 0.12, -1.06], side: X, width: 0.26, widthEnd: 0.07, bendy: true, bend: 0.4, bendDir: Math.PI },
  ],
};

const bug: RigDef = {
  id: 'bug',
  eyeDir: [0, 0.4, 1],
  name: 'Bug',
  icon: 'fa-solid fa-ant',
  headId: 'head',
  bones: [
    { id: 'body', name: 'Body', start: [0, 0.5, -0.55], end: [0, 0.56, 0.28], side: X, width: 0.6, anchor: true },
    { id: 'head', name: 'Head', parent: 'body', start: [0, 0.56, 0.26], end: [0, 0.62, 0.68], side: X, width: 0.42 },
    { id: 'antenna', name: 'Antenna', parent: 'head', start: [0.08, 0.72, 0.56], end: [0.24, 1.02, 0.86], side: Y, width: 0.05, mirror: true },
    { id: 'legA', name: 'Front leg', parent: 'body', start: [0.18, 0.52, 0.14], end: [0.55, 0.74, 0.32], side: Z, width: 0.09, mirror: true },
    { id: 'footA', name: 'Front foot', parent: 'legA', start: [0.55, 0.74, 0.32], end: [0.78, 0.03, 0.55], side: Z, width: 0.07, mirror: true },
    { id: 'legB', name: 'Middle leg', parent: 'body', start: [0.2, 0.52, -0.12], end: [0.6, 0.74, -0.12], side: Z, width: 0.09, mirror: true },
    { id: 'footB', name: 'Middle foot', parent: 'legB', start: [0.6, 0.74, -0.12], end: [0.88, 0.03, -0.14], side: Z, width: 0.07, mirror: true },
    { id: 'legC', name: 'Back leg', parent: 'body', start: [0.18, 0.52, -0.36], end: [0.55, 0.74, -0.55], side: Z, width: 0.09, mirror: true },
    { id: 'footC', name: 'Back foot', parent: 'legC', start: [0.55, 0.74, -0.55], end: [0.78, 0.03, -0.82], side: Z, width: 0.07, mirror: true },
  ],
};

function mirrorV(v: V3): V3 {
  return [-v[0], v[1], v[2]];
}
/** Bend points for the other side: its frame is this one's mirrored through Z (like bendDir turning the other way) */
export function mirrorNodes(n: V3[] | undefined): V3[] | undefined {
  return n?.map(([x, y, z]) => [x, y, -z]);
}

export const RIGS: RigDef[] = [biped, quadruped, bird, serpent, bug];

export function getRig(id: string): RigDef {
  return RIGS.find((r) => r.id === id) ?? RIGS[0];
}

// ---------------------------------------------------------------------------
// Editable rigs. A creature owns a copy of its skeleton (RigState) so it can be
// reshaped; `mirror: true` defs are expanded into L/R twins for the scene.

export interface RigState {
  /** template id, or `saved:<name>` */
  base: string;
  name: string;
  headId: string;
  eyeDir?: V3;
  bones: BoneDef[];
}

/** A bone as it exists in the scene, after mirroring. */
export interface ExpandedBone extends BoneDef {
  /** id of the definition this came from */
  baseId: string;
  /** +1 left twin, -1 right twin, 0 unmirrored */
  sideSign: 1 | -1 | 0;
}

export interface ExpandedRig {
  headId: string;
  eyeDir?: V3;
  bones: ExpandedBone[];
}

export function rigFromTemplate(t: RigDef): RigState {
  return { base: t.id, name: t.name, headId: t.headId, eyeDir: t.eyeDir, bones: structuredClone(t.bones) };
}

export function expandRig(rig: RigState): ExpandedRig {
  const mirrored = new Set(rig.bones.filter((b) => b.mirror).map((b) => b.id));
  const out: ExpandedBone[] = [];
  const mapParent = (p: string | undefined, suffix: 'L' | 'R') => (p && mirrored.has(p) ? p + suffix : p);
  for (const b of rig.bones) {
    if (!b.mirror) {
      // a single bone hanging off a mirrored pair attaches to one side (left by default)
      const parent = b.parent && mirrored.has(b.parent) ? b.parent + 'L' : b.parent;
      out.push({ ...b, parent, baseId: b.id, sideSign: 0 });
      continue;
    }
    out.push({ ...b, id: b.id + 'L', name: b.name + ' (L)', parent: mapParent(b.parent, 'L'), baseId: b.id, sideSign: 1 });
    out.push({
      ...b,
      id: b.id + 'R',
      name: b.name + ' (R)',
      parent: mapParent(b.parent, 'R'),
      start: mirrorV(b.start),
      end: mirrorV(b.end),
      side: mirrorV(b.side),
      mirrorOf: b.id + 'L',
      baseId: b.id,
      sideSign: -1,
    });
  }
  // parents before children, dropping anything whose parent no longer exists
  const ids = new Set(out.map((b) => b.id));
  const placed = new Set<string>();
  const sorted: ExpandedBone[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const b of out) {
      if (placed.has(b.id)) continue;
      if (!b.parent || placed.has(b.parent) || !ids.has(b.parent)) {
        sorted.push(b.parent && !ids.has(b.parent) ? { ...b, parent: undefined } : b);
        placed.add(b.id);
        progress = true;
      }
    }
  }
  return { headId: rig.headId, eyeDir: rig.eyeDir, bones: sorted };
}

// ---------------------------------------------------------------------------
// Editing operations. They mutate the RigState and report which parts
// (drawing/color slots, keyed by scene id) should be created or copied.

export interface PartCopy {
  from: string;
  to: string;
}

function findDef(rig: RigState, sceneId: string) {
  const ex = expandRig(rig).bones.find((b) => b.id === sceneId);
  if (!ex) return null;
  const def = rig.bones.find((b) => b.id === ex.baseId)!;
  return { ex, def };
}

function uniqueId(rig: RigState, base: string): string {
  const taken = new Set(rig.bones.flatMap((b) => [b.id, b.id + 'L', b.id + 'R']));
  const stem = base.replace(/\d+$/, '');
  for (let n = 2; ; n++) if (!taken.has(stem + n) && !taken.has(stem + n + 'L')) return stem + n;
}

/** Definition ids of a bone and everything hanging off it (both twins for pairs). */
export function subtreeDefs(rig: RigState, sceneId: string): Set<string> {
  const bones = expandRig(rig).bones;
  const start = bones.find((b) => b.id === sceneId);
  if (!start) return new Set();
  const roots = new Set([sceneId]);
  if (start.sideSign !== 0) roots.add(start.baseId + (start.sideSign === 1 ? 'R' : 'L'));
  const scene = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bones) if (b.parent && scene.has(b.parent) && !scene.has(b.id)) (scene.add(b.id), (grew = true));
  }
  return new Set(bones.filter((b) => scene.has(b.id)).map((b) => b.baseId));
}

/** The scene ids that own drawings (parts) for a definition. */
export function partIds(def: BoneDef): string[] {
  return def.mirror ? [def.id + 'L', def.id + 'R'] : [def.id];
}
function partSrc(def: BoneDef): string {
  return def.mirror ? def.id + 'L' : def.id;
}

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const round3 = (a: V3): V3 => a.map((v) => Math.round(v * 1000) / 1000) as V3;
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Turn v by angle a about the unit axis k (Rodrigues). */
function turn3(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a), kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = cross3(k, v);
  return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * kv * (1 - c)) as V3;
}

/**
 * A bone curved through bend points, sampled evenly along its length: where
 * each sample sits in the bone's frame, and the frame there (X side, T along
 * the curve, Z out), carried along without twisting.
 */
export interface BendCurve {
  /** samples - 1 */
  k: number;
  /** its length, end to end along the curve */
  length: number;
  pts: Float64Array;
  xs: Float64Array;
  ts: Float64Array;
  zs: Float64Array;
}

/**
 * The curve from a bone's start through its bend points (`nodes`, as fractions
 * of `len`) to its tip, sampled evenly by length. Each stretch between points
 * follows the circles through its neighbours: points on one circle give that
 * circle exactly (one point makes the same arc as a plain bend), others curve
 * as evenly as they can. `round` (per point, 1 = that) sharpens the curve
 * there toward a corner (0) or swells it (up to 2).
 */
export function bendCurve(nodes: V3[], len: number, round?: number[]): BendCurve {
  const q: V3[] = [[0, 0, 0], ...nodes.map((n) => scale3(n, len)), [0, len, 0]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (v: V3): V3 => scale3(v, 1 / (len3(v) || 1));
  /** the tangent at `at` of the circle through a, b, c (on to the next point), or along the line if they're in one */
  const circleTangent = (a: V3, b: V3, c: V3, at: V3, toward: V3): V3 => {
    const u = sub3(a, c), v = sub3(b, c);
    const uxv = cross3(u, v);
    const d = dot(uxv, uxv);
    if (d < 1e-12 * Math.max(1e-9, dot(u, u) * dot(v, v))) return unit(toward);
    const o = add3(c, scale3(cross3(sub3(scale3(v, dot(u, u)), scale3(u, dot(v, v))), uxv), 1 / (2 * d)));
    const t = unit(cross3(unit(uxv), sub3(at, o)));
    return dot(t, toward) < 0 ? scale3(t, -1) : t;
  };
  const m = q.length - 1;
  const tq: V3[] = q.map((p, i) => {
    if (i === 0) return circleTangent(q[0], q[1], q[Math.min(2, m)], p, sub3(q[1], q[0]));
    if (i === m) return circleTangent(q[Math.max(0, m - 2)], q[m - 1], q[m], p, sub3(q[m], q[m - 1]));
    return circleTangent(q[i - 1], q[i], q[i + 1], p, sub3(q[i + 1], q[i - 1]));
  });
  const roundAt = (i: number) => (i === 0 || i === m ? 1 : (round?.[i - 1] ?? 1));
  const dense: V3[] = [];
  const PER = 48;
  for (let i = 0; i < m; i++) {
    const p0 = q[i], p1 = q[i + 1];
    const c = len3(sub3(p1, p0));
    // a cubic as close to the arc between the two tangents as it gets
    const th = Math.min(Math.acos(Math.max(-1, Math.min(1, dot(tq[i], tq[i + 1])))), Math.PI * 0.95);
    const mag = c / Math.cos(th / 4) ** 2;
    const m0 = scale3(tq[i], mag * roundAt(i)), m1 = scale3(tq[i + 1], mag * roundAt(i + 1));
    for (let j = i === 0 ? 0 : 1; j <= PER; j++) {
      const t = j / PER, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      dense.push(add3(add3(scale3(p0, h00), scale3(m0, h10)), add3(scale3(p1, h01), scale3(m1, h11))));
    }
  }
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + len3(sub3(dense[i], dense[i - 1])));
  const total = acc[acc.length - 1] || 1;
  const k = 128;
  const out = new Float64Array((k + 1) * 3);
  for (let i = 0, j = 0; i <= k; i++) {
    const want = (total * i) / k;
    while (j < dense.length - 2 && acc[j + 1] < want) j++;
    const f = Math.min(1, Math.max(0, (want - acc[j]) / (acc[j + 1] - acc[j] || 1)));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = dense[j][c] + (dense[j + 1][c] - dense[j][c]) * f;
  }
  const at = (i: number): V3 => [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
  const norm = (v: V3): V3 => scale3(v, 1 / (len3(v) || 1));
  const xs = new Float64Array(out.length), ts = new Float64Array(out.length), zs = new Float64Array(out.length);
  const tan = (i: number) => norm(sub3(at(Math.min(k, i + 1)), at(Math.max(0, i - 1))));
  // the start's frame: the straight bone's, turned the least way onto the curve
  let t = tan(0);
  const axis = cross3([0, 1, 0], t);
  const ang = Math.atan2(len3(axis), t[1]);
  let x: V3 = len3(axis) > 1e-9 ? turn3([1, 0, 0], norm(axis), ang) : t[1] < 0 ? [-1, 0, 0] : [1, 0, 0];
  for (let i = 0; i <= k; i++) {
    if (i) {
      // double reflection: carries the frame along with as little twist as can be
      const v1 = sub3(at(i), at(i - 1));
      const c1 = dot(v1, v1) || 1;
      const xl = sub3(x, scale3(v1, (2 * dot(v1, x)) / c1));
      const tl = sub3(t, scale3(v1, (2 * dot(v1, t)) / c1));
      const t2 = tan(i);
      const v2 = sub3(t2, tl);
      const c2 = dot(v2, v2) || 1;
      x = norm(sub3(xl, scale3(v2, (2 * dot(v2, xl)) / c2)));
      t = t2;
    }
    const z = cross3(x, t);
    for (let c = 0; c < 3; c++) {
      xs[i * 3 + c] = x[c];
      ts[i * 3 + c] = t[c];
      zs[i * 3 + c] = z[c];
    }
  }
  return { k, length: total, pts: out, xs, ts, zs };
}

/** Where the straight-bone point (x, y, z) sits on the curve, `len` long, plus the frame there. */
export function onCurve(c: BendCurve, len: number, x: number, y: number, z: number): { p: V3; x: V3; t: V3; z: V3 } {
  const s = Math.min(len, Math.max(0, y));
  const over = y - s; // past either end it carries on straight
  const u = (s / len) * c.k;
  const i = Math.min(c.k - 1, Math.floor(u));
  const f = u - i;
  const get = (a: Float64Array): V3 => [0, 1, 2].map((n) => a[i * 3 + n] + (a[(i + 1) * 3 + n] - a[i * 3 + n]) * f) as V3;
  const P = get(c.pts), X = get(c.xs), T = get(c.ts), Z = get(c.zs);
  return { p: add3(add3(add3(P, scale3(X, x)), scale3(T, over)), scale3(Z, z)), x: X, t: T, z: Z };
}

/** Bend points evenly along a curve (as fractions of `len`), the ends left out. */
export function sampleNodes(at: (y: number) => V3, len: number, n: number): V3[] {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => at((len * (i + 1)) / (n + 1)).map((v) => r(v / len)) as V3);
}

/** the most a bone bends, as a fraction of a half turn: three quarters of a full circle */
export const MAX_BEND = 1.5;

/**
 * Move a joint in the rest pose. `kind` 'end' moves the bone's tip; 'start'
 * moves the whole bone. Everything hanging below follows. `delta` is in world
 * space for the scene bone that was grabbed; mirrored twins follow.
 */
export function moveJoint(rig: RigState, sceneId: string, kind: 'start' | 'end', delta: V3, lockCenter = false) {
  const bones = expandRig(rig).bones;
  const grabbed = bones.find((b) => b.id === sceneId);
  if (!grabbed) return;
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const moved = new Set<string>();
  // with symmetry locked, bones sitting on the centre line stay on it
  const centred = new Map<string, [boolean, boolean]>();
  if (lockCenter) {
    for (const d of rig.bones) if (!d.mirror) centred.set(d.id, [Math.abs(d.start[0]) < 0.02, Math.abs(d.end[0]) < 0.02]);
  }
  const relock = () => {
    for (const [id, [s, e]] of centred) {
      const d = byId.get(id)!;
      if (s) d.start = [0, d.start[1], d.start[2]];
      if (e) d.end = [0, d.end[1], d.end[2]];
    }
  };

  // scene bones below the grabbed one on this side, and on the twin side
  const below = (rootId: string) => {
    const set = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of bones) if (b.parent && set.has(b.parent) && !set.has(b.id)) (set.add(b.id), (grew = true));
    }
    set.delete(rootId);
    return bones.filter((b) => set.has(b.id));
  };
  const shift = (b: ExpandedBone, d: V3, sign: number) => {
    const def = byId.get(b.baseId)!;
    if (moved.has(def.id)) return;
    moved.add(def.id);
    // defs live on the +X side; convert a right-twin delta back
    const dd: V3 = sign === -1 ? mirrorV(d) : d;
    def.start = round3(add3(def.start, dd));
    def.end = round3(add3(def.end, dd));
  };

  const def = byId.get(grabbed.baseId)!;
  const own: V3 = grabbed.sideSign === -1 ? mirrorV(delta) : delta;
  if (kind === 'start') def.start = round3(add3(def.start, own));
  def.end = round3(add3(def.end, own));
  moved.add(def.id);
  for (const b of below(grabbed.id)) shift(b, delta, b.sideSign);
  if (grabbed.sideSign !== 0) {
    const twin = grabbed.baseId + (grabbed.sideSign === 1 ? 'R' : 'L');
    for (const b of below(twin)) shift(b, mirrorV(delta), b.sideSign);
  }
  relock();
}

/**
 * Resize a bone in the rest pose: `kLen` stretches it along its length (from
 * its base), `kWidth` fattens its default shape. Limbs hanging off it keep
 * their place on it: one on the tip rides the tip, one halfway up stays
 * halfway. Returns how much its start-to-tip length changed.
 */
export function scaleBone(rig: RigState, sceneId: string, kLen: number, kWidth: number): number {
  const f = findDef(rig, sceneId);
  if (!f) return 1;
  const d = f.def;
  const axis = sub3(d.end, d.start);
  const len = len3(axis);
  if (len < 1e-6) return 1;
  const u = scale3(axis, 1 / len);
  d.end = round3(add3(d.start, scale3(axis, kLen)));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  d.width = r3(Math.max(0.01, d.width * kWidth));
  if (d.widthEnd !== undefined) d.widthEnd = r3(Math.max(0.01, d.widthEnd * kWidth));
  const kids = (id: string) => rig.bones.filter((b) => b.parent === id);
  const shiftTree = (b: BoneDef, by: V3) => {
    b.start = round3(add3(b.start, by));
    b.end = round3(add3(b.end, by));
    for (const k of kids(b.id)) shiftTree(k, by);
  };
  for (const c of kids(d.id)) {
    const rel = sub3(c.start, d.start);
    const t = rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2];
    const lateral = sub3(rel, scale3(u, t));
    const next = add3(add3(d.start, scale3(u, t * kLen)), scale3(lateral, kWidth));
    shiftTree(c, sub3(next, c.start));
  }
  return kLen;
}

/**
 * Carry everything hanging off a bone round with it when its roll changes by
 * `delta` (as stored on its definition, i.e. for the left twin). The bone's own
 * roll is left to the caller.
 *
 * Mirrored pairs hanging off a middle part can't turn with it and stay mirror
 * images. With `keepMirror` they swing together (each side the mirror of the
 * other); without, they're split into separate left and right parts first, so
 * everything turns as one.
 */
export function rollLimb(rig: RigState, sceneId: string, delta: number, keepMirror: boolean): PartCopy[] {
  const f = findDef(rig, sceneId);
  if (!f || !delta) return [];
  const copies: PartCopy[] = [];
  if (!keepMirror && !f.def.mirror) {
    for (;;) {
      const below = subtreeDefs(rig, sceneId);
      const pair = rig.bones.find((d) => d.mirror && below.has(d.id));
      if (!pair) break;
      copies.push(...unlinkPair(rig, pair.id + 'L'));
    }
  }
  const bones = expandRig(rig).bones;
  const byId = new Map(bones.map((b) => [b.id, b]));
  const defs = new Map(rig.bones.map((b) => [b.id, b]));
  // which of the rolled twins (if either) a scene bone hangs from
  const rootOf = (b: ExpandedBone): ExpandedBone | null => {
    for (let p = b.parent ? byId.get(b.parent) : undefined; p; p = p.parent ? byId.get(p.parent) : undefined) {
      if (p.baseId === f.def.id) return p;
    }
    return null;
  };
  const done = new Set<string>();
  for (const b of bones) {
    // a mirrored part's definition is its left twin; the right one follows it
    if (b.sideSign === -1 || b.baseId === f.def.id || done.has(b.baseId)) continue;
    const root = rootOf(b);
    const d = defs.get(b.baseId);
    if (!root || !d) continue;
    done.add(b.baseId);
    const axis = sub3(root.end, root.start);
    const len = len3(axis);
    if (len < 1e-6) continue;
    const k = scale3(axis, 1 / len);
    // the right twin is the mirror image, so it rolls the other way
    const a = root.sideSign === -1 ? -delta : delta;
    const about = (p: V3) => round3(add3(root.start, turn3(sub3(p, root.start), k, a)));
    d.start = about(d.start);
    d.end = about(d.end);
    d.side = round3(turn3(d.side, k, a));
  }
  return copies;
}

/**
 * Sprout a new limb from the side of a bone: two segments, or a single bone
 * with `segments: 1`. With `symmetric`, it comes as a mirrored pair (and on one
 * side of a pair, it goes on both sides); without, just where it was asked for.
 */
export function addLimb(rig: RigState, sceneId: string, symmetric: boolean, segments: 1 | 2 = 2): PartCopy[] {
  const f = findDef(rig, sceneId);
  if (!f) return [];
  const { ex } = f;
  const mid = scale3(add3(ex.start, ex.end), 0.5);
  const outward = mid[0] >= 0 ? 1 : -1;
  const attach: V3 = [mid[0] + outward * ex.width * 0.42, mid[1], mid[2]];
  const w = Math.max(0.06, Math.min(0.2, ex.width * 0.35));
  const s1: V3 = attach;
  const e1: V3 = add3(s1, [outward * 0.3, -0.12, 0]);
  const e2: V3 = add3(e1, [outward * 0.26, -0.12, 0]);

  const pairParent = ex.sideSign !== 0;
  // on one side of a pair it goes on both sides only when mirroring
  const mirror = symmetric && (pairParent || Math.abs(attach[0]) > 0.02);
  // pair defs live on +X; a single limb on a paired bone attaches to that exact side
  const toDef = (v: V3): V3 => (mirror && v[0] < 0 ? mirrorV(v) : v);
  const parent = pairParent && mirror ? ex.baseId : ex.id;
  const src = partSrc(f.def);
  if (segments === 1) {
    const id = uniqueId(rig, 'bone');
    const end = add3(s1, [outward * 0.4, -0.16, 0]);
    rig.bones.push({ id, name: 'Bone', parent, start: round3(toDef(s1)), end: round3(toDef(end)), side: [0, 1, 0], width: w, mirror });
    return [{ from: src, to: mirror ? id + 'L' : id }];
  }
  const id1 = uniqueId(rig, 'limb');
  rig.bones.push({ id: id1, name: 'Limb', parent, start: round3(toDef(s1)), end: round3(toDef(e1)), side: [0, 1, 0], width: w, mirror });
  const id2 = uniqueId(rig, 'limb');
  rig.bones.push({ id: id2, name: 'Limb tip', parent: id1, start: round3(toDef(e1)), end: round3(toDef(e2)), side: [0, 1, 0], width: w * 0.85, mirror });
  return [id1, id2].map((id) => ({ from: src, to: mirror ? id + 'L' : id }));
}

/** Result of splitting a bone: which drawings to cut, and where. */
export interface SplitResult {
  /** [lower part id, upper (new) part id] pairs, one per side */
  pairs: [string, string][];
  /** height (along the bone) of the cut, in the bone's drawing coordinates */
  at: number;
}

/**
 * Split a bone at its middle into two jointed halves. Anything that hung off
 * the far half moves to the new bone; a bendy bone shares its curve between them.
 */
export function splitBone(rig: RigState, sceneId: string): SplitResult | null {
  const f = findDef(rig, sceneId);
  if (!f) return null;
  const d = f.def;
  const dir = sub3(d.end, d.start);
  const len = len3(dir);
  if (len < 0.04) return null;
  const mid = round3(scale3(add3(d.start, d.end), 0.5));
  const w0 = d.width, w1 = d.widthEnd ?? d.width;
  const wMid = Math.round(((w0 + w1) / 2) * 1000) / 1000;
  const nid = uniqueId(rig, d.id.replace(/\d+$/, ''));
  const upper: BoneDef = {
    ...structuredClone(d),
    id: nid,
    name: d.name.replace(/ \d+$/, '') + ' 2',
    parent: d.id,
    start: mid,
    end: [...d.end],
    width: wMid,
    widthEnd: w1,
    anchor: false,
    // the lower half keeps any detached base; the upper one sits on its tip
    loose: undefined,
  };
  if (d.bendy && d.bend) {
    upper.bend = d.bend / 2;
    d.bend = d.bend / 2;
  }
  if (d.bendNodes?.length) {
    // each half takes its half of the curve, leaning the same way off its own straight line
    const c = bendCurve(d.bendNodes, len);
    const midOff = onCurve(c, len, 0, len / 2, 0).p;
    const half = (from: number): V3[] =>
      sampleNodes((y) => {
        const p = onCurve(c, len, 0, from + y, 0).p;
        // off the line from this half's start to its end on the curve
        const f = y / (len / 2);
        const a: V3 = from ? midOff : [0, 0, 0];
        const b: V3 = from ? [0, len, 0] : midOff;
        const line = add3(scale3(a, 1 - f), scale3(b, f));
        return [p[0] - line[0], y + (p[1] - line[1]), p[2] - line[2]];
      }, len / 2, d.bendNodes!.length);
    d.bendNodes = half(0);
    upper.bendNodes = half(len / 2);
    // the halves are new points, round again
    delete d.bendRound;
    delete upper.bendRound;
  }
  d.end = mid;
  d.widthEnd = wMid;

  // children attached past the middle now hang off the new bone
  // how far along the (original) bone a point sits: 0 = base, 1 = tip
  const along = (p: V3) => ((p[0] - d.start[0]) * dir[0] + (p[1] - d.start[1]) * dir[1] + (p[2] - d.start[2]) * dir[2]) / (len * len);
  for (const c of rig.bones) {
    if (c === upper) continue;
    if (c.parent === d.id) {
      if (along(c.start) > 0.5) c.parent = nid;
    } else if (!c.mirror && d.mirror && (c.parent === d.id + 'L' || c.parent === d.id + 'R')) {
      // a single bone hanging off one twin: measure it on the +X side where `d` lives
      const side = c.parent.slice(-1);
      if (along(side === 'R' ? mirrorV(c.start) : c.start) > 0.5) c.parent = nid + side;
    }
  }
  rig.bones.splice(rig.bones.indexOf(d) + 1, 0, upper);
  const lower = partIds(d), top = partIds(upper);
  return { pairs: lower.map((id, i) => [id, top[i]] as [string, string]), at: len / 2 };
}

/** Add one segment continuing on from the tip of a bone (a hand, a tail tip...). */
export function extendBone(rig: RigState, sceneId: string): PartCopy[] {
  const f = findDef(rig, sceneId);
  if (!f) return [];
  const { def } = f;
  const dir = sub3(def.end, def.start);
  const l = len3(dir) || 1;
  const segLen = Math.max(0.15, l * 0.6);
  const id = uniqueId(rig, def.id.replace(/[LR]$/, ''));
  const mirror = !!def.mirror;
  // pairs extend both twins; a single bone on a pair extends that side only
  rig.bones.push({
    id,
    name: def.name.replace(/ tip$/, '') + ' tip',
    parent: def.id,
    start: [...def.end],
    end: round3(add3(def.end, scale3(dir, segLen / l))),
    side: [...def.side],
    roll: def.roll,
    width: def.width * 0.8,
    mirror,
  });
  return [{ from: partSrc(def), to: mirror ? id + 'L' : id }];
}

/**
 * Detach a bone from its parent's tip so its base can slide anywhere (like a
 * Bone sprouted from the side); it still hangs off the parent and moves with it.
 */
export function detachBone(rig: RigState, sceneId: string): PartCopy[] {
  const f = findDef(rig, sceneId);
  if (f?.def.parent) f.def.loose = true;
  return [];
}

/** Snap a detached bone's base back onto its parent's tip; everything on it follows. */
export function reattachBone(rig: RigState, sceneId: string): PartCopy[] {
  const f = findDef(rig, sceneId);
  const parent = f && expandRig(rig).bones.find((b) => b.id === f.ex.parent);
  if (!f || !parent) return [];
  moveJoint(rig, sceneId, 'start', sub3(parent.end, f.ex.start));
  delete f.def.loose;
  return [];
}

/** Copy a bone and everything hanging off it, nudged down so it's visible. */
export function duplicateLimb(rig: RigState, sceneId: string): PartCopy[] {
  const f = findDef(rig, sceneId);
  if (!f || !f.def.parent) return [];
  const defs = subtreeDefs(rig, sceneId);
  const idMap = new Map<string, string>();
  const copies: BoneDef[] = [];
  const offset: V3 = [0, -0.18, 0];
  for (const d of rig.bones) {
    if (!defs.has(d.id)) continue;
    const nid = uniqueId({ ...rig, bones: [...rig.bones, ...copies] }, d.id);
    idMap.set(d.id, nid);
    copies.push({ ...structuredClone(d), id: nid, start: round3(add3(d.start, offset)), end: round3(add3(d.end, offset)) });
  }
  const remap = (p: string | undefined) => {
    if (!p) return p;
    if (idMap.has(p)) return idMap.get(p);
    const m = p.match(/^(.*)([LR])$/); // single bone attached to one twin of a copied pair
    if (m && idMap.has(m[1])) return idMap.get(m[1]) + m[2];
    return p;
  };
  for (const c of copies) c.parent = remap(c.parent);
  rig.bones.push(...copies);
  const parts: PartCopy[] = [];
  for (const d of rig.bones.filter((b) => defs.has(b.id))) {
    const nd = copies.find((c) => c.id === idMap.get(d.id))!;
    const from = partIds(d), to = partIds(nd);
    to.forEach((t, i) => parts.push({ from: from[i] ?? from[0], to: t }));
  }
  return parts;
}

/** Remove a bone and everything hanging off it. Returns removed definition ids. */
export function deleteLimb(rig: RigState, sceneId: string): BoneDef[] {
  const f = findDef(rig, sceneId);
  if (!f || !f.def.parent) return [];
  const defs = subtreeDefs(rig, sceneId);
  const removed = rig.bones.filter((b) => defs.has(b.id));
  rig.bones = rig.bones.filter((b) => !defs.has(b.id));
  return removed;
}

/** Split a mirrored pair (and everything below it) into independent left and right bones. */
export function unlinkPair(rig: RigState, sceneId: string): PartCopy[] {
  const f = findDef(rig, sceneId);
  if (!f || !f.def.mirror) return [];
  const defs = subtreeDefs(rig, sceneId);
  const mirroredIds = new Set(rig.bones.filter((b) => b.mirror).map((b) => b.id));
  const out: BoneDef[] = [];
  const parts: PartCopy[] = [];
  for (const d of rig.bones) {
    if (!defs.has(d.id) || !d.mirror) {
      // a single bone on the pair hung off its left side; that's now a bone of its own
      const split = !!d.parent && defs.has(d.parent) && mirroredIds.has(d.parent);
      out.push(split ? { ...d, parent: d.parent + 'L' } : d);
      continue;
    }
    // scene ids stay the same (armL / armR), so drawings and poses carry over
    const parentFor = (s: 'L' | 'R') => (d.parent && mirroredIds.has(d.parent) ? d.parent + s : d.parent);
    out.push({ ...d, id: d.id + 'L', name: d.name + ' (L)', mirror: false, parent: parentFor('L') });
    out.push({
      ...d,
      id: d.id + 'R',
      name: d.name + ' (R)',
      mirror: false,
      parent: parentFor('R'),
      start: mirrorV(d.start),
      end: mirrorV(d.end),
      side: mirrorV(d.side),
      roll: d.roll ? -d.roll : undefined,
      bendDir: d.bendDir ? -d.bendDir : d.bendDir,
      bendNodes: mirrorNodes(d.bendNodes),
    });
    parts.push({ from: d.id + 'L', to: d.id + 'R' });
  }
  rig.bones = out;
  return parts;
}

/** Off the centre line with no twin: a part with nothing on the other side. */
function oneSided(b: ExpandedBone): boolean {
  return b.sideSign === 0 && (Math.abs(b.start[0]) > 0.02 || Math.abs(b.end[0]) > 0.02);
}

/**
 * What mirroring a one-sided part would act on: the top of the one-sided limb
 * it belongs to, and, when it's one half of an unlinked pair (armL / armR),
 * the other half that re-linking replaces. Null for a part that already has a
 * twin, or sits on the centre line.
 */
export function mirrorTarget(rig: RigState, sceneId: string): { root: ExpandedBone; other: ExpandedBone | null } | null {
  const bones = expandRig(rig).bones;
  const byId = new Map(bones.map((b) => [b.id, b]));
  let root = byId.get(sceneId);
  if (!root || !oneSided(root)) return null;
  for (let p = root.parent ? byId.get(root.parent) : undefined; p && oneSided(p); p = p.parent ? byId.get(p.parent) : undefined) root = p;
  // a pair hanging below can't be mirrored again
  const defs = subtreeDefs(rig, root.id);
  if (rig.bones.some((d) => defs.has(d.id) && d.mirror)) return null;
  const m = root.id.match(/^(.+)([LR])$/);
  const other = m ? byId.get(m[1] + (m[2] === 'L' ? 'R' : 'L')) : undefined;
  const stem = (p?: string) => p?.replace(/[LR]$/, '');
  const matches = !!other && oneSided(other) && stem(other.parent) === stem(root.parent) && Math.sign(other.start[0] + other.end[0]) !== Math.sign(root.start[0] + root.end[0]);
  return { root, other: matches ? other! : null };
}

export interface MirrorResult {
  /** old scene id -> new scene id of the same bone (on its own side) */
  renamed: [string, string][];
  /** scene ids of the replaced other side, now gone */
  removed: string[];
  /** the bones were on the right (-X): their new left twins are the mirror image */
  flipped: boolean;
}

/**
 * Turn a one-sided limb into a mirrored pair. If it was half of an unlinked
 * pair, the other half is replaced by its mirror image (re-linking them);
 * otherwise a mirror image appears on the other side.
 */
export function mirrorLimb(rig: RigState, sceneId: string): MirrorResult | null {
  const t = mirrorTarget(rig, sceneId);
  if (!t) return null;
  const { root, other } = t;
  const flipped = root.start[0] + root.end[0] < 0;
  const own = subtreeDefs(rig, root.id);
  const gone = other ? subtreeDefs(rig, other.id) : new Set<string>();
  const keep = rig.bones.filter((d) => !gone.has(d.id));
  const taken = new Set(keep.filter((d) => !own.has(d.id)).flatMap((d) => [d.id, d.id + 'L', d.id + 'R']));
  const newId = new Map<string, string>();
  for (const d of keep) {
    if (!own.has(d.id)) continue;
    // re-linking drops the L/R it got when it was unlinked
    let stem = other ? d.id.replace(/[LR]$/, '') : d.id;
    for (let n = 2; taken.has(stem) || taken.has(stem + 'L') || taken.has(stem + 'R'); n++) stem = d.id.replace(/[LR]?\d*$/, '') + n;
    taken.add(stem).add(stem + 'L').add(stem + 'R');
    newId.set(d.id, stem);
  }
  const mirroredIds = new Set(keep.filter((d) => d.mirror).map((d) => d.id));
  const renamed: [string, string][] = [];
  rig.bones = keep.map((d) => {
    const id = newId.get(d.id);
    if (!id) return d;
    let parent = d.parent;
    if (parent && newId.has(parent)) parent = newId.get(parent);
    // on one twin of a pair: the new pair hangs off both twins
    else if (parent && /[LR]$/.test(parent) && mirroredIds.has(parent.slice(0, -1))) parent = parent.slice(0, -1);
    renamed.push([d.id, id + (flipped ? 'R' : 'L')]);
    const out: BoneDef = { ...d, id, name: d.name.replace(/ \((L|R)\)$/, ''), parent, mirror: true };
    // a pair is defined by its left twin
    if (flipped) {
      out.start = mirrorV(d.start);
      out.end = mirrorV(d.end);
      out.side = mirrorV(d.side);
      out.roll = d.roll ? -d.roll : undefined;
      out.bendDir = d.bendDir ? -d.bendDir : d.bendDir;
      out.bendNodes = mirrorNodes(d.bendNodes);
    }
    return out;
  });
  if (newId.has(rig.headId)) rig.headId = newId.get(rig.headId)! + (flipped ? 'R' : 'L');
  return { renamed, removed: [...gone], flipped };
}

// ---------------------------------------------------------------------------
// saved rigs (skeleton only) in localStorage

const SAVED_KEY = 'creature-creator/rigs';

export function savedRigs(): RigState[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as RigState[];
  } catch {
    return [];
  }
}

export function saveRig(rig: RigState, name: string) {
  const list = savedRigs().filter((r) => r.name !== name);
  list.push({ ...structuredClone(rig), name, base: 'saved:' + name });
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked */
  }
}

export function deleteSavedRig(name: string) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(savedRigs().filter((r) => r.name !== name)));
  } catch {
    /* ignore */
  }
}
