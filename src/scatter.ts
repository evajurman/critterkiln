// ---------------------------------------------------------------------------
// Scatter: copies of a thing over a part's surface (a marking of type
// 'scatter', see src/markings.ts). Where each copy goes is picked from the
// part's shape in the rest pose, so the copies ride the part as it's posed:
// spread evenly by area, kept apart, never buried inside another part, and
// only where the pattern it follows (worked out here the way the shader does
// it) or its paint would mark. The same seed always gives the same spots, so
// a pair of limbs get mirror images of each other.

import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { insideByRay } from './distance';
import { markingPlace, scatterPatternSize, type Marking, type ScatterMotion } from './markings';

// ---- the shader's noise (NOISE_GLSL), in plain numbers ----

const fract = (x: number) => x - Math.floor(x);
const h3 = [0, 0, 0];
function hash3(x: number, y: number, z: number): number[] {
  h3[0] = fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123);
  h3[1] = fract(Math.sin(x * 269.5 + y * 183.3 + z * 246.1) * 43758.5453123);
  h3[2] = fract(Math.sin(x * 113.5 + y * 271.9 + z * 124.6) * 43758.5453123);
  return h3;
}
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c)[0];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), ux), lerp(h(0, 1, 0), h(1, 1, 0), ux), uy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), ux), lerp(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz,
  );
}
function fbm(x: number, y: number, z: number): number {
  let s = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * noise(x, y, z);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 17.1;
    z = z * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.9375;
}
/** distance to the nearest scattered point */
function worley(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  let d1 = 8;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (let c = -1; c <= 1; c++) {
        const o = hash3(ix + a, iy + b, iz + c);
        const rx = a + o[0] - fx, ry = b + o[1] - fy, rz = c + o[2] - fz;
        d1 = Math.min(d1, rx * rx + ry * ry + rz * rz);
      }
  return Math.sqrt(d1);
}

/** How much the scatter's pattern marks spot `q` (in the pattern's own space, `n` the surface's direction there): 0..1. */
function field(m: Marking, q: THREE.Vector3, n: THREE.Vector3): number {
  const k = 1 / scatterPatternSize(m);
  const x = q.x * k, y = q.y * k, z = q.z * k;
  switch (m.where) {
    case 'spots':
      return 1 - worley(x, y, z) * 1.2 + (noise(x * 3, y * 3, z * 3) - 0.5) * 0.15;
    case 'stripes':
      return 0.5 + 0.5 * Math.sin(6.2832 * (y + (fbm(x * 0.5, y * 0.5, z * 0.5) - 0.5) * 1.6));
    case 'patches':
      return THREE.MathUtils.clamp((fbm(x * 0.8 + 3.7, y * 0.8 + 3.7, z * 0.8 + 3.7) - 0.5) * 2.5 + 0.5, 0, 1);
    case 'belly':
      // (the belly marking the other way up: the top and back)
      return 0.5 + 0.5 * n.y - (fbm(x, y, z) - 0.5) * 0.3;
    default:
      return 1;
  }
}

/** Whether spot `q` (the pattern's space) is painted: the last stroke over it says (a rubbing out takes it off). */
function paintedAt(m: Marking, q: THREE.Vector3): boolean {
  let on = false;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), ab = new THREE.Vector3(), aq = new THREE.Vector3();
  for (const s of m.strokes ?? []) {
    const r2 = s.r * s.r;
    let near = false;
    for (let i = 0; i < s.pts.length && !near; i += 3) {
      a.fromArray(s.pts, i);
      b.fromArray(s.pts, Math.min(i + 3, s.pts.length - 3));
      ab.subVectors(b, a);
      aq.subVectors(q, a);
      const t = THREE.MathUtils.clamp(aq.dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1);
      near = aq.addScaledVector(ab, -t).lengthSq() <= r2;
    }
    if (near) on = !s.erase;
  }
  return on;
}

/** Whether the scatter puts copies at this spot (in the rest pose). */
function wanted(m: Marking, toPattern: THREE.Matrix4, normalToPattern: THREE.Matrix3, rest: THREE.Vector3, restN: THREE.Vector3): boolean {
  if (!m.where || m.where === 'all') return true;
  const q = rest.clone().applyMatrix4(toPattern);
  if (m.where === 'paint') return paintedAt(m, q);
  return field(m, q, restN.clone().applyMatrix3(normalToPattern).normalize()) > m.threshold;
}

/** A small, quick random number source (the same seed, the same numbers). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A part's surface to scatter on: its geometry (in its own frame) and how that frame sits in the rest pose. */
export interface ScatterSurface {
  geo: THREE.BufferGeometry;
  /** own frame -> rest pose */
  toRest: THREE.Matrix4;
  /** which way is up (the creature's, at rest) in its own frame */
  up: THREE.Vector3;
}
/** Another part, that copies mustn't end up inside. */
export interface ScatterBlocker {
  geo: THREE.BufferGeometry;
  bvh: MeshBVH;
  /** rest pose -> its own frame */
  fromRest: THREE.Matrix4;
  /** its bounds, in the rest pose */
  sphere: THREE.Sphere;
}

/** One copy: where it sits in the part's frame, and where in its motion it starts. */
export interface ScatterCopy {
  matrix: THREE.Matrix4;
  phase: number;
}

/** most copies on one part */
const MAX_COPIES = 1500;

/** how many copies a square unit of surface gets, by the scatter's amount */
export function scatterDensity(m: Marking): number {
  return 2 + 500 * m.amount * m.amount;
}

/**
 * Where a scatter's copies go on one part. `extent`: how big the thing is as
 * drawn (across), for keeping copies apart; `key`: the part (two parts with
 * the same key get the same spots, so a mirrored pair matches).
 */
export function scatterCopies(m: Marking, surf: ScatterSurface, blockers: ScatterBlocker[], extent: number, key: string): ScatterCopy[] {
  const pos = surf.geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const nrm = surf.geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const index = surf.geo.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  // each triangle's share of the area, added up, to pick one by area
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const sums = new Float64Array(tris);
  let area = 0;
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, vi(t, 0));
    b.fromBufferAttribute(pos, vi(t, 1));
    c.fromBufferAttribute(pos, vi(t, 2));
    area += b.sub(a).cross(c.sub(a)).length() / 2;
    sums[t] = area;
  }
  if (area <= 0) return [];
  const want = Math.min(MAX_COPIES, Math.round(scatterDensity(m) * area));
  const rand = random(hashString(key) ^ (m.seed ?? 0));
  const scale = m.scale ?? 0.25;
  const gap = (m.spacing ?? 0.5) * extent * scale;
  // copies kept apart with a grid of cells as wide as the gap
  const cells = new Map<string, THREE.Vector3[]>();
  const cellOf = (p: THREE.Vector3) => [Math.floor(p.x / gap), Math.floor(p.y / gap), Math.floor(p.z / gap)];
  const crowded = (p: THREE.Vector3) => {
    if (gap <= 0) return false;
    const [x, y, z] = cellOf(p);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) for (const q of cells.get(`${x + i},${y + j},${z + k}`) ?? []) if (q.distanceToSquared(p) < gap * gap) return true;
    return false;
  };
  const toPattern = markingPlace(m).invert();
  const normalToPattern = new THREE.Matrix3().getNormalMatrix(toPattern);
  const restNormal = new THREE.Matrix3().getNormalMatrix(surf.toRest);
  const out: ScatterCopy[] = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const local = new THREE.Vector3();
  const tries = want * 8 + 50;
  for (let k = 0; k < tries && out.length < want; k++) {
    // a spot on a triangle picked by area (the rest of the numbers are drawn whether it's kept or not, so it's the same each time)
    const r = rand() * area, u = rand(), v = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand();
    let lo = 0, hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sums[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const s = Math.sqrt(u);
    const wa = 1 - s, wb = s * (1 - v), wc = s * v;
    a.fromBufferAttribute(pos, vi(lo, 0));
    b.fromBufferAttribute(pos, vi(lo, 1));
    c.fromBufferAttribute(pos, vi(lo, 2));
    p.set(0, 0, 0).addScaledVector(a, wa).addScaledVector(b, wb).addScaledVector(c, wc);
    if (nrm) {
      na.fromBufferAttribute(nrm, vi(lo, 0));
      nb.fromBufferAttribute(nrm, vi(lo, 1));
      nc.fromBufferAttribute(nrm, vi(lo, 2));
      n.set(0, 0, 0).addScaledVector(na, wa).addScaledVector(nb, wb).addScaledVector(nc, wc);
    } else n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const rest = p.clone().applyMatrix4(surf.toRest);
    if (!wanted(m, toPattern, normalToPattern, rest, n.clone().applyMatrix3(restNormal).normalize())) continue;
    // not inside another part (where they join, it would poke out of the other one)
    if (blockers.some((o) => o.sphere.containsPoint(rest) && insideByRay(o.geo, o.bvh, local.copy(rest).applyMatrix4(o.fromRest)))) continue;
    if (crowded(rest)) continue;
    const [x, y, z] = cellOf(rest);
    const cell = `${x},${y},${z}`;
    (cells.get(cell) ?? cells.set(cell, []).get(cell)!).push(rest);
    out.push({ matrix: placeCopy(m, p, n, surf.up, scale, extent, [r1, r2, r3, r4]), phase: r5 });
  }
  return out;
}

/** A copy at `p` (the part's frame) on a surface facing `n`: turned, leaning, sized and sunk in as the scatter says. */
function placeCopy(m: Marking, p: THREE.Vector3, n: THREE.Vector3, up: THREE.Vector3, scale: number, extent: number, [r1, r2, r3, r4]: number[]): THREE.Matrix4 {
  // which way it stands: out of the surface, or up
  const out = n.clone().lerp(up, m.upright ?? 0);
  if (out.lengthSq() < 1e-8) out.copy(n);
  out.normalize();
  // something across it to turn from
  const across = new THREE.Vector3().crossVectors(Math.abs(out.dot(up)) < 0.95 ? up : new THREE.Vector3(1, 0, 0), out).normalize();
  across.applyAxisAngle(out, (r1 - 0.5) * Math.PI * 2 * (m.spin ?? 1));
  // a lean: tipped a little to one side
  const lean = (m.lean ?? 0) * 0.7 * r2;
  if (lean > 0) {
    const tipAxis = across.clone().applyAxisAngle(out, r3 * Math.PI * 2);
    out.applyAxisAngle(tipAxis, lean);
    across.applyAxisAngle(tipAxis, lean);
  }
  // standing: its drawing's up (Y) out; lying: its face (Z) out
  const basis = new THREE.Matrix4();
  if (m.lie) basis.makeBasis(across, new THREE.Vector3().crossVectors(out, across), out);
  else basis.makeBasis(across, out, new THREE.Vector3().crossVectors(across, out));
  const size = scale * (1 + (r4 * 2 - 1) * (m.vary ?? 0) * 0.7);
  const at = p.clone().addScaledVector(n, -(m.sink ?? 0) * extent * size * 0.4);
  return basis.setPosition(at).multiply(new THREE.Matrix4().makeScale(size, size, size));
}

const TAU = Math.PI * 2;

/**
 * A copy's move (in its own frame, about where it stands) at `t` seconds, on
 * a loop `loop` seconds long: whole times round per loop, so a recorded loop closes.
 */
export function copyMove(m: Marking, phase: number, t: number, loop: number, out: THREE.Matrix4): THREE.Matrix4 {
  const mo = m.motion;
  if (!mo) return out.identity();
  const p = fract((t / loop) * Math.max(1, Math.round(mo.speed)) + phase);
  const wave = Math.sin(TAU * p);
  const size = mo.size;
  // which of its own axes points out of the surface
  const lie = !!m.lie;
  const kind: ScatterMotion = mo.kind;
  switch (kind) {
    case 'sway': {
      // rocking from its base, a little figure of eight
      const a = size * 0.5 * wave, b = size * 0.25 * Math.sin(TAU * p + 1.3);
      return lie ? out.makeRotationX(a).multiply(new THREE.Matrix4().makeRotationY(b)) : out.makeRotationZ(a).multiply(new THREE.Matrix4().makeRotationX(b));
    }
    case 'bob': {
      const d = size * 0.25 * wave;
      return lie ? out.makeTranslation(0, 0, d) : out.makeTranslation(0, d, 0);
    }
    case 'spin':
      return lie ? out.makeRotationZ(TAU * p) : out.makeRotationY(TAU * p);
    case 'pulse': {
      const k = 1 + size * 0.35 * wave;
      return out.makeScale(k, k, k);
    }
  }
}
