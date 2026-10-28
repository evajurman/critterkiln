// ---------------------------------------------------------------------------
// bendy bones: the bone's local frame (X = side, Y = along the bone, Z = out
// of the drawing) is curved into a circular arc that still runs from the
// bone's start to its tip, bowing out toward a direction around the bone:
// 0 = +X (sideways in the drawing plane), pi/2 = +Z. Or, with two or more
// bend points, curved smoothly through them (rigs.ts bendCurve).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bounds, getMeshDetail, type Solid, type Vec2 } from './inflate';
import { MAX_BEND, bendCurve, onCurve, type BendCurve, type ExpandedBone, type V3 } from './rigs';
import { partPieceGeometry, type PartPieceExtras } from './stuff';
import { SIDE_TURN } from './creature';
export interface Bend {
  len: number;
  /** total turn, radians (0 = straight) */
  theta: number;
  /** direction around the bone, radians */
  dir: number;
  /** bend points (as fractions of the length, in this bone's own frame) and the curve through them, instead of the arc */
  nodes?: V3[];
  /** how round the curve is at each bend point (see bendCurve) */
  round?: number[];
  curve?: BendCurve;
}

/** Curved at all (an arc or through bend points)? */
export function isBent(bd: Bend | undefined): boolean {
  return !!bd && (!!bd.theta || !!bd.curve);
}

const curveCache = new Map<string, BendCurve>();
/** The same bend at another length (bend points scale with the bone). */
export function bendAtLen(bd: Bend, len: number): Bend {
  if (!bd.nodes) return { ...bd, len };
  const key = `${len.toFixed(5)}:${JSON.stringify(bd.nodes)}:${bd.round ?? ''}`;
  let curve = curveCache.get(key);
  if (!curve) {
    if (curveCache.size > 400) curveCache.clear();
    curve = bendCurve(bd.nodes, len, bd.round);
    curveCache.set(key, curve);
  }
  return { len, theta: 0, dir: 0, nodes: bd.nodes, round: bd.round, curve };
}

/** A bone's bend. A right twin's frame is its left twin's mirrored through local Z, so its direction (and bend points) mirror too. */
export function bendOf(def: ExpandedBone, len: number): Bend {
  const flip = def.sideSign === -1 ? -1 : 1;
  const nodes = def.bendy && def.bendNodes?.length ? def.bendNodes : undefined;
  if (nodes) {
    return bendAtLen({ len, theta: 0, dir: 0, nodes: nodes.map(([x, y, z]) => [x, y, z * flip] as V3), round: def.bendRound }, len);
  }
  const theta = def.bendy ? (def.bend ?? 0) * Math.PI : 0;
  const dir = (def.bendDir ?? 0) * flip;
  return { len, theta, dir };
}

export function bendKey(bd: Bend): string {
  if (bd.curve) return `|curve:${bd.len.toFixed(4)}:${JSON.stringify(bd.nodes)}:${bd.round ?? ''}`;
  return bd.theta ? `|bend:${bd.len.toFixed(4)}:${bd.theta.toFixed(4)}:${bd.dir.toFixed(4)}` : '';
}

/**
 * The in-plane bend: (u, y) with u along the bend direction. The arc's ends stay
 * on the bone's start and tip; it leaves the start turned theta/2 toward +u and
 * reaches the tip turned theta/2 the other way. Returns the turn angle there too.
 */
function planarBend(len: number, theta: number, u: number, y: number): [number, number, number] {
  const s = Math.min(len, Math.max(0, y));
  const over = y - s; // past either end the bone carries on straight along its tangent
  let cu = 0, cy = s, phi = 0;
  if (Math.abs(theta) > 1e-5) {
    const half = theta / 2;
    const r = len / (2 * Math.sin(half));
    const a = theta * (s / len) - half; // angle round the arc's centre, from the bulge
    phi = -a;
    cu = r * (Math.cos(a) - Math.cos(half));
    cy = len / 2 + r * Math.sin(a);
  }
  const c = Math.cos(phi), sn = Math.sin(phi);
  // the offset (u, over) turns with the curve: +u -> (cos, -sin), +Y -> (sin, cos)
  return [cu + c * u + sn * over, cy - sn * u + c * over, phi];
}

/** Where the straight-bone point (x, y, z) goes once bent, plus the turn angle there (an arc's). */
export function bendPoint(bd: Bend, x: number, y: number, z: number): [number, number, number, number] {
  if (bd.curve) {
    const { p } = onCurve(bd.curve, bd.len, x, y, z);
    return [p[0], p[1], p[2], 0];
  }
  if (!bd.theta) return [x, y, z, 0];
  const c = Math.cos(bd.dir), s = Math.sin(bd.dir);
  const u = c * x + s * z; // along the bend direction
  const w = -s * x + c * z; // across it (unchanged by the bend)
  const [u2, y2, phi] = planarBend(bd.len, bd.theta, u, y);
  return [c * u2 - s * w, y2, s * u2 + c * w, phi];
}

/** A bone's frame at `s` along it (straight-bone height): the centre line there, and its side, along and out directions. */
function bendFrame(bd: Bend, s: number) {
  const at = (x: number, y: number, z: number) => new THREE.Vector3(...bendPoint(bd, x, y, z).slice(0, 3));
  const p = at(0, s, 0);
  const x = at(1, s, 0).sub(p).normalize();
  const z = at(0, s, 1).sub(p).normalize();
  return { p, x, t: new THREE.Vector3().crossVectors(z, x).normalize(), z };
}

/**
 * Carry a point (and a facing) in a part's frame from one shape of its bone
 * to another: the same spot on it, `kLen` times as far along and `kWidth`
 * times as far out from its middle, however either one's bent. For things
 * stuck on a part (its eyes) while the part's stretched or grown.
 */
export function carryOnBend(from: Bend, to: Bend, kWidth: number, p: THREE.Vector3, n?: THREE.Vector3): { p: THREE.Vector3; n?: THREE.Vector3 } {
  const kLen = to.len / Math.max(from.len, 1e-6);
  // the nearest spot on the centre line (a little past either end, for the caps)
  const dist = (s: number) => new THREE.Vector3(...bendPoint(from, 0, s, 0).slice(0, 3)).distanceToSquared(p);
  const steps = 64, lo = -0.5 * from.len, span = 2 * from.len;
  let s = lo, best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const y = lo + (span * i) / steps;
    const d = dist(y);
    if (d < best) (best = d), (s = y);
  }
  let a = s - span / steps, b = s + span / steps;
  for (let i = 0; i < 24; i++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (dist(m1) < dist(m2)) b = m2;
    else a = m1;
  }
  s = (a + b) / 2;
  const f = bendFrame(from, s);
  const d = p.clone().sub(f.p);
  const x = d.dot(f.x), z = d.dot(f.z);
  s += d.dot(f.t);
  const g = bendFrame(to, s * kLen);
  const out = new THREE.Vector3(...bendPoint(to, x * kWidth, s * kLen, z * kWidth).slice(0, 3));
  if (!n) return { p: out };
  // a facing tilts the other way to the stretch (a surface's normal)
  const nn = g.x.multiplyScalar(n.dot(f.x) / kWidth).add(g.t.multiplyScalar(n.dot(f.t) / kLen)).add(g.z.multiplyScalar(n.dot(f.z) / kWidth));
  return { p: out, n: nn.normalize() };
}

/** Turn a direction vector (x, y, z) by the bend's local turn angle `phi`. */
function bendVector(bd: Bend, phi: number, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(bd.dir), s = Math.sin(bd.dir);
  const u = c * x + s * z;
  const w = -s * x + c * z;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const u2 = cp * u + sp * y;
  const y2 = -sp * u + cp * y;
  return [c * u2 - s * w, y2, s * u2 + c * w];
}

/** Curve a part's geometry (and its merge spheres) to follow its bent bone. */
export function bendGeometry(src: THREE.BufferGeometry, bd: Bend): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  if (bd.curve) {
    for (let i = 0; i < pos.count; i++) {
      const f = onCurve(bd.curve, bd.len, pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, f.p[0], f.p[1], f.p[2]);
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      nor.setXYZ(i, f.x[0] * nx + f.t[0] * ny + f.z[0] * nz, f.x[1] * nx + f.t[1] * ny + f.z[1] * nz, f.x[2] * nx + f.t[2] * ny + f.z[2] * nz);
    }
  } else for (let i = 0; i < pos.count; i++) {
    const [x, y, z, phi] = bendPoint(bd, pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, x, y, z);
    const [nx, ny, nz] = bendVector(bd, phi, nor.getX(i), nor.getY(i), nor.getZ(i));
    nor.setXYZ(i, nx, ny, nz);
  }
  const solid = src.userData.solid as Solid | undefined;
  if (solid) {
    const sp = Float32Array.from(solid.spheres);
    const zs = new Float32Array(sp.length / 3);
    for (let i = 0; i < sp.length; i += 3) {
      const [x, y, z] = bendPoint(bd, sp[i], sp[i + 1], solid.zs ? solid.zs[i / 3] : 0);
      sp[i] = x;
      sp[i + 1] = y;
      zs[i / 3] = z;
    }
    g.userData = { ...src.userData, solid: { ...solid, spheres: sp, zs }, sharedNormals: undefined };
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A shape drawn from the side: its puffed-up geometry (and merge spheres) turned into the bone's YZ plane. */
export function turnSideways(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  g.applyMatrix4(SIDE_TURN);
  const solid = src.userData.solid as Solid | undefined;
  g.userData = { ...src.userData, sharedNormals: undefined };
  if (solid) {
    // (x, y) in the drawing -> (0, y, -x) on the bone
    const n = solid.spheres.length / 3;
    const sp = Float32Array.from(solid.spheres);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      zs[i] = -sp[i * 3];
      sp[i * 3] = 0;
    }
    g.userData.solid = { ...solid, spheres: sp, zs, sideways: new Uint8Array(n).fill(1) } satisfies Solid;
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Drop zero-area triangles (a turned part's ends close up at the centre line
 * in rings of them): they have no direction, which throws off inside/outside
 * for the seamless skin. Non-indexed geometry only.
 */
function withoutSlivers(src: THREE.BufferGeometry): THREE.BufferGeometry {
  if (src.index) return src;
  const pos = src.getAttribute('position');
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) keep.push(i);
  }
  if (keep.length * 3 === pos.count) return src;
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const size = attr.itemSize;
    const arr = new Float32Array(keep.length * 3 * size);
    keep.forEach((i, k) => {
      for (let v = 0; v < 3; v++) for (let j = 0; j < size; j++) arr[(k * 3 + v) * size + j] = attr.getComponent(i + v, j);
    });
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  g.userData = { ...src.userData };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  src.dispose();
  return g;
}

/**
 * A flat or turned part's geometry. Its merge "spheres" only say how thick it
 * is (joins are sized by that): half a flat part's depth, a turned part's
 * widest radius.
 */
export function pieceKindGeometry(kind: 'flat' | 'turned', outline: Vec2[], thickness: number, lowPoly: boolean, more: PartPieceExtras = {}): THREE.BufferGeometry {
  const b = bounds(outline);
  const size = Math.max(b.w, b.h, 1e-3);
  // a flat part's depth goes with its width (thickness 1: about a third as deep as it is wide)
  const depth = Math.max(0.004, 0.3 * thickness * b.w);
  const step = Math.max(0.002, size / 48) / Math.sqrt(getMeshDetail());
  const g = withoutSlivers(partPieceGeometry(kind, outline, depth, lowPoly, step, more));
  const r = kind === 'flat' ? depth / 2 : Math.max(Math.abs(b.minX), Math.abs(b.maxX));
  g.userData = { ...g.userData, solid: { spheres: new Float32Array([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, r]), thickness: 1 } satisfies Solid };
  return g;
}

/** Several shapes of one part as one geometry (they just overlap), with all their merge spheres. */
export function joinShapes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(geos) ?? geos[0].clone();
  const solids = geos.map((x) => x.userData.solid as Solid | undefined).filter((x): x is Solid => !!x);
  const counts = solids.map((x) => x.spheres.length / 3);
  const spheres = new Float32Array(counts.reduce((a, c) => a + c, 0) * 3);
  const zs = new Float32Array(spheres.length / 3);
  const sideways = new Uint8Array(spheres.length / 3);
  let at = 0;
  solids.forEach((x, j) => {
    spheres.set(x.spheres, at * 3);
    if (x.zs) zs.set(x.zs, at);
    if (x.sideways) sideways.set(x.sideways, at);
    at += counts[j];
  });
  const facets = geos.map((x) => x.userData.facet as number | undefined).filter((x): x is number => x !== undefined);
  g.userData = {
    solid: { spheres, thickness: solids[0]?.thickness ?? 1, zs, sideways } satisfies Solid,
    ...(facets.length ? { facet: Math.min(...facets) } : {}),
  };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * A child's local transform after its parent bone is bent: it rides along the
 * arc but keeps pointing the same way, so bending one part never swings the
 * rest of the skeleton (the ends don't move, so limbs there stay put).
 */
export function bendChild(bd: Bend, local: THREE.Matrix4): THREE.Matrix4 {
  if (!isBent(bd)) return local;
  const p = new THREE.Vector3().setFromMatrixPosition(local);
  const s = Math.min(bd.len, Math.max(0, p.y));
  const [x, y, z] = bendPoint(bd, 0, s, 0);
  return new THREE.Matrix4().makeTranslation(x, y - s, z).multiply(local);
}

/** Points along a (possibly bent) bone, for the skeleton line. */
export function bonePoints(bd: Bend): THREE.Vector3[] {
  const n = bd.curve ? 48 : bd.theta ? 16 : 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const [x, y, z] = bendPoint(bd, 0, (bd.len * i) / n, 0);
    return new THREE.Vector3(x, y, z);
  });
}

/** Where a bone's middle sits (the bend handle). */
function bendMid(bd: Bend): THREE.Vector3 {
  const [x, y, z] = bendPoint(bd, 0, bd.len / 2, 0);
  return new THREE.Vector3(x, y, z);
}

/**
 * A bend grip: a bend point in use (solid; `node` says which, none for an
 * arc's middle), or one waiting in a gap between them (dotted; `gap` says
 * which: 0 from the start to the first point, and so on to the tip).
 */
export interface BendGrip {
  at: THREE.Vector3;
  used: boolean;
  node?: number;
  gap?: number;
}
/** too short a gap (in the bone's units) gets no grip of its own: it'd be too fiddly to tell apart */
const MIN_GAP = 0.06;

/** Where the bend grips sit: a straight bone's middle (waiting), an arc's middle, or each bend point, with waiting ones in the gaps between. */
export function bendGrips(bd: Bend): BendGrip[] {
  const pt = (y: number) => {
    const [x, py, z] = bendPoint(bd, 0, y, 0);
    return new THREE.Vector3(x, py, z);
  };
  if (!bd.nodes) {
    if (!bd.theta) return [{ at: pt(bd.len / 2), used: false }];
    const arcLen = bd.len * (Math.abs(bd.theta) / 2 / Math.sin(Math.abs(bd.theta) / 2));
    const out: BendGrip[] = [{ at: pt(bd.len / 2), used: true }];
    if (arcLen / 2 >= MIN_GAP) out.push({ at: pt(bd.len / 4), used: false, gap: 0 }, { at: pt((bd.len * 3) / 4), used: false, gap: 1 });
    return out;
  }
  const c = bd.curve!;
  // how far along the curve each point sits (it passes through them), as a fraction
  const along = (v: THREE.Vector3) => {
    let best = 0, d = Infinity;
    for (let i = 0; i <= c.k; i++) {
      const e = (c.pts[i * 3] - v.x) ** 2 + (c.pts[i * 3 + 1] - v.y) ** 2 + (c.pts[i * 3 + 2] - v.z) ** 2;
      if (e < d) (d = e), (best = i);
    }
    return best / c.k;
  };
  const used = bd.nodes.map(([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(bd.len));
  const out: BendGrip[] = used.map((at, i) => ({ at, used: true, node: i }));
  const fs = [0, ...used.map(along), 1];
  for (let g = 0; g + 1 < fs.length; g++) {
    if ((fs[g + 1] - fs[g]) * c.length < 2 * MIN_GAP) continue;
    out.push({ at: pt(((fs[g] + fs[g + 1]) / 2) * bd.len), used: false, gap: g });
  }
  return out;
}

/**
 * The bend that puts a bone's middle at local point `p`: direction from where
 * it sits around the bone, amount from how far it's pulled off the straight line.
 */
export function bendFromMid(len: number, p: THREE.Vector3): { bend: number; dir: number } {
  const off = Math.hypot(p.x, p.z);
  const dir = Math.atan2(p.z, p.x);
  // an arc through both ends bulges (len / 2) * tan(theta / 4) at its middle
  const theta = 4 * Math.atan((2 * off) / len);
  return { bend: Math.min(MAX_BEND, theta / Math.PI), dir };
}

/** Rest-pose world frame of a bone: X = drawing side, Y = along the bone, origin at its start. */
export function restFrame(def: ExpandedBone) {
  const start = new THREE.Vector3(...def.start);
  const dir = new THREE.Vector3(...def.end).sub(start);
  const length = Math.max(dir.length(), 1e-3);
  dir.normalize();
  const side = new THREE.Vector3(...def.side);
  side.addScaledVector(dir, -side.dot(dir));
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0).addScaledVector(dir, -dir.x);
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize();
  // roll: turn the drawing about the bone. A right twin is its left twin's
  // mirror image, so it turns the other way
  if (def.roll) side.applyAxisAngle(dir, def.roll * (def.sideSign === -1 ? -1 : 1));
  const normal = new THREE.Vector3().crossVectors(side, dir).normalize();
  return { length, world: new THREE.Matrix4().makeBasis(side, dir, normal).setPosition(start) };
}
