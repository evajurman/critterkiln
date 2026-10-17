/**
 * Seamless joins by fillet: the parts' own meshes are joined into one with
 * an exact boolean union (manifold-3d), and only a band round each seam is
 * refined and moved onto the smooth blend of the parts (the same smooth-min
 * the grid skin in skin.ts is built from). Everywhere away from the joins is
 * each part exactly as drawn: thin points and tight bends included.
 *
 * Null when it can't be done (a part that isn't a closed mesh): the grid
 * skin is built instead.
 */
import * as THREE from 'three';
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bvhFor, exactDistance, sharedNormals } from './distance';
import { applyLumps, lumpFade } from './inflate';
import { buildSkin, paintSkin, type SkinOptions, type SkinPart } from './skin';

type Wasm = Awaited<ReturnType<typeof Module>>;
let wasm: Promise<Wasm> | null = null;
function manifold(): Promise<Wasm> {
  wasm ??= Module({ locateFile: () => wasmUrl }).then((w) => (w.setup(), w));
  return wasm;
}

/**
 * Join the parts the way `opts.method` asks: with fillets where that can be
 * done (not a skin over just some of its parts, nor low-poly, nor a part that
 * isn't a closed mesh), or else one skin off a grid.
 */
export async function buildJoin(parts: SkinPart[], opts: SkinOptions): Promise<THREE.BufferGeometry | null> {
  if (opts.method === 'fillet' && !opts.keep && !opts.lowPoly) {
    const geo = await filletSkin(parts, opts);
    if (geo || opts.shouldStop()) return geo;
  }
  return buildSkin(parts, opts);
}

export interface FilletOptions {
  colorBlend: number;
  lowPoly: boolean;
  /** clay lump strength to put back on (the parts are joined smooth), and the eyes it stays clear of */
  lumps?: number;
  eyes?: { x: number; y: number; z: number; r: number }[];
  /** which parts (by index) blend; leave out for every pair */
  linked?: (a: number, b: number) => boolean;
  shouldStop: () => boolean;
  progress?: (done: number) => void;
}

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

export async function filletSkin(parts: SkinPart[], opts: FilletOptions): Promise<THREE.BufferGeometry | null> {
  const blends = (a: number, b: number) => a !== b && (!opts.linked || opts.linked(a, b));
  let slice = performance.now();
  let done = 0;
  /** now and then: let the thread breathe, say how far along, and whether to stop */
  const breathe = async (f?: number): Promise<boolean> => {
    if (f !== undefined) done = f;
    if (performance.now() - slice < 12) return false;
    opts.progress?.(done);
    await yieldNow();
    slice = performance.now();
    return opts.shouldStop();
  };

  // 1. the exact union, each triangle remembering which part it came from
  const w = await manifold();
  const solids: InstanceType<Wasm['Manifold']>[] = [];
  const idOf = new Map<number, number>();
  const free = () => solids.forEach((m) => m.delete());
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const g = mergeVertices(stripped(p.geo).applyMatrix4(p.toSkin), 1e-5);
    const raw = new w.Manifold(new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(g.getAttribute('position').array), triVerts: Uint32Array.from(g.getIndex()!.array) }));
    g.dispose();
    if (raw.status() !== 'NoError' || raw.isEmpty()) {
      raw.delete();
      free();
      return null;
    }
    const m = raw.asOriginal();
    raw.delete();
    idOf.set(m.originalID(), i);
    solids.push(m);
  }
  if (await breathe(0.1)) return free(), null;
  const union = w.Manifold.union(solids);
  const mesh = union.getMesh();
  const np = mesh.numProp;
  const pos: number[] = [];
  for (let v = 0; v < mesh.vertProperties.length / np; v++) pos.push(mesh.vertProperties[v * np], mesh.vertProperties[v * np + 1], mesh.vertProperties[v * np + 2]);
  let tris = Array.from(mesh.triVerts);
  let owner: number[] = new Array(tris.length / 3).fill(-1);
  for (let r = 0; r < mesh.runOriginalID.length; r++) {
    const part = idOf.get(mesh.runOriginalID[r]) ?? -1;
    for (let t = mesh.runIndex[r] / 3; t < mesh.runIndex[r + 1] / 3; t++) owner[t] = part;
  }
  union.delete();
  free();
  if (await breathe(0.25)) return null;

  // 2. finer triangles in a band round the seams (where two parts that blend meet)
  let band = new Float64Array(0) as Float64Array<ArrayBufferLike>, reach = band;
  const ROUNDS = 2;
  for (let round = 0; round <= ROUNDS; round++) {
    ({ band, reach } = seamBand(pos, tris, owner, parts, blends));
    if (round === ROUNDS) break;
    const r = splitBand(pos, tris, owner, band, reach);
    if (!r) break;
    ({ tris, owner } = r);
    if (await breathe(0.25 + 0.1 * (round + 1))) return null;
  }

  // 3. the band onto the smooth blend: each vertex there settled (Newton steps) onto the parts' smooth union
  const reachMax = 3 * Math.max(...parts.map((p) => p.k));
  const field = blendField(parts, blends, reachMax);
  const p = new THREE.Vector3(), g = new THREE.Vector3();
  const n = pos.length / 3;
  for (let v = 0; v < n; v++) {
    if (band[v] < reach[v]) {
      p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      for (let it = 0; it < 4; it++) {
        const f = field(p, g);
        const g2 = g.lengthSq();
        if (!Number.isFinite(f) || g2 < 1e-8 || Math.abs(f) < 1e-5) break;
        p.addScaledVector(g, -f / g2);
      }
      pos[v * 3] = p.x;
      pos[v * 3 + 1] = p.y;
      pos[v * 3 + 2] = p.z;
    }
    if ((v & 255) === 0 && (await breathe(0.45 + (0.4 * v) / n))) return null;
  }

  // 4. a light smoothing over the band, fading out at its edge (the parts beyond stay as drawn)
  smoothBand(pos, tris, band, reach, 4);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(tris);
  geo.computeVertexNormals();
  if (opts.lumps) {
    // clay lumps back on, as the grid skin does, but not under the eyes
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const cap = new Float32Array(P.count).fill(Infinity);
    for (let i = 0; i < P.count; i++) for (const e of opts.eyes ?? []) cap[i] = Math.min(cap[i], opts.lumps * 4 * lumpFade(Math.hypot(P.getX(i) - e.x, P.getY(i) - e.y, P.getZ(i) - e.z), e.r));
    applyLumps(geo, opts.lumps, opts.eyes?.length ? cap : undefined);
    geo.computeVertexNormals();
  }
  if (await breathe(0.9)) return null;
  // 5. textures laid out in the rest pose, and colors (as the grid skin does)
  if (parts.every((pp) => pp.toRest)) setRest(geo, tris, owner, band, reach, parts, reachMax);
  geo.userData.painted = paintSkin(geo, parts, opts.colorBlend, opts.lowPoly);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Where each vertex sat in the rest pose (restPos / restNormal), so textures
 * are laid out there and bend with the pose. Away from the seams that's its
 * own part's, exactly as the part's own mesh lays it out; in a seam's band the
 * parts near it are blended, the nearest most (like skinning in reverse).
 */
function setRest(geo: THREE.BufferGeometry, tris: number[], owner: number[], band: ArrayLike<number>, reach: ArrayLike<number>, parts: SkinPart[], reachMax: number) {
  const P = geo.getAttribute('position') as THREE.BufferAttribute;
  const N = geo.getAttribute('normal') as THREE.BufferAttribute;
  const home = new Int32Array(P.count).fill(-1);
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) if (home[tris[t + e]] < 0) home[tris[t + e]] = owner[t / 3];
  const toRest = parts.map((pp) => pp.toRest!.clone().multiply(pp.toSkin.clone().invert()));
  const turn = toRest.map((m) => new THREE.Matrix3().setFromMatrix4(m));
  const fromSkin = parts.map((pp) => pp.toSkin.clone().invert());
  const boxes = parts.map((pp) => pp.geo.boundingBox!.clone().applyMatrix4(pp.toSkin).expandByScalar(reachMax));
  const rp = new Float32Array(P.count * 3), rn = new Float32Array(P.count * 3);
  const p = new THREE.Vector3(), nv = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), tmp = new THREE.Vector3(), q = new THREE.Vector3(), g = new THREE.Vector3();
  const ds = new Float64Array(parts.length);
  for (let v = 0; v < P.count; v++) {
    p.fromBufferAttribute(P, v);
    nv.fromBufferAttribute(N, v);
    const own = Math.max(0, home[v]);
    if (!(band[v] < reach[v])) {
      acc.copy(p).applyMatrix4(toRest[own]);
      accN.copy(nv).applyMatrix3(turn[own]).normalize();
    } else {
      let dmin = Infinity;
      for (let i = 0; i < parts.length; i++) {
        ds[i] = Infinity;
        if (!boxes[i].containsPoint(p)) continue;
        q.copy(p).applyMatrix4(fromSkin[i]);
        const pp = parts[i];
        ds[i] = exactDistance(pp.geo, bvhFor(pp.geo), sharedNormals(pp.geo), q, reachMax, g, false);
        dmin = Math.min(dmin, ds[i]);
      }
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      let wsum = 0;
      for (let i = 0; i < parts.length; i++) {
        if (!Number.isFinite(ds[i])) continue;
        // fading out by the band's edge, so it meets the parts' own layout there
        const w = Math.max(0, 1 - (ds[i] - dmin) / reach[v]) ** 2 * (1 - band[v] / reach[v]) + (i === own ? band[v] / reach[v] : 0);
        if (w <= 0) continue;
        acc.addScaledVector(tmp.copy(p).applyMatrix4(toRest[i]), w);
        accN.addScaledVector(tmp.copy(nv).applyMatrix3(turn[i]), w);
        wsum += w;
      }
      if (wsum > 0) acc.divideScalar(wsum);
      else acc.copy(p).applyMatrix4(toRest[own]), accN.copy(nv).applyMatrix3(turn[own]);
      accN.normalize();
    }
    rp.set([acc.x, acc.y, acc.z], v * 3);
    rn.set([accN.x, accN.y, accN.z], v * 3);
  }
  geo.setAttribute('restPos', new THREE.BufferAttribute(rp, 3));
  geo.setAttribute('restNormal', new THREE.BufferAttribute(rn, 3));
}

/** Just positions (and an index): what the union needs. */
function stripped(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  return g;
}

/**
 * The smooth union of the parts' exact signed distances: a plain min, and a
 * polynomial smooth-min for each pair that blends (as skin.ts's field), with
 * its gradient.
 */
function blendField(parts: SkinPart[], blends: (a: number, b: number) => boolean, reachMax: number) {
  const fromSkin = parts.map((pp) => pp.toSkin.clone().invert());
  const lin = parts.map((pp) => new THREE.Matrix3().setFromMatrix4(pp.toSkin));
  const boxes = parts.map((pp) => {
    if (!pp.geo.boundingBox) pp.geo.computeBoundingBox();
    return pp.geo.boundingBox!.clone().applyMatrix4(pp.toSkin).expandByScalar(reachMax);
  });
  const ds = new Float64Array(parts.length);
  const gs = parts.map(() => new THREE.Vector3());
  const q = new THREE.Vector3(), tg = new THREE.Vector3();
  return (p: THREE.Vector3, grad: THREE.Vector3): number => {
    for (let i = 0; i < parts.length; i++) {
      if (!boxes[i].containsPoint(p)) {
        ds[i] = Infinity;
        continue;
      }
      q.copy(p).applyMatrix4(fromSkin[i]);
      const pp = parts[i];
      ds[i] = exactDistance(pp.geo, bvhFor(pp.geo), sharedNormals(pp.geo), q, reachMax, tg);
      gs[i].copy(tg).applyMatrix3(lin[i]).normalize();
    }
    let f = Infinity;
    for (let i = 0; i < parts.length; i++) if (ds[i] < f) (f = ds[i]), grad.copy(gs[i]);
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (!Number.isFinite(ds[i]) || !Number.isFinite(ds[j]) || !blends(i, j)) continue;
        const k = Math.min(parts[i].k, parts[j].k);
        if (Math.abs(ds[i] - ds[j]) >= k) continue;
        const t = 0.5 + (0.5 * (ds[j] - ds[i])) / k;
        const v = ds[j] * (1 - t) + ds[i] * t - k * t * (1 - t);
        if (v < f) (f = v), grad.copy(gs[i]).multiplyScalar(t).addScaledVector(gs[j], 1 - t);
      }
    }
    return f;
  };
}

/**
 * How far along the surface each vertex is from the nearest seam between two
 * parts that blend, and how wide that seam's fillet is (the smaller part's).
 */
function seamBand(pos: number[], tris: number[], owner: number[], parts: SkinPart[], blends: (a: number, b: number) => boolean) {
  const n = pos.length / 3;
  const on = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) on[tris[t + e]].add(owner[t / 3]);
  const band = new Float64Array(n).fill(Infinity);
  const reach = new Float64Array(n).fill(1e-6);
  const queue = new MinHeap();
  for (let v = 0; v < n; v++) {
    const ps = [...on[v]].filter((x) => x >= 0);
    let r = 0;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (blends(ps[i], ps[j])) r = Math.max(r, Math.min(parts[ps[i]].k, parts[ps[j]].k));
    if (r > 0) {
      band[v] = 0;
      reach[v] = r;
      queue.push(0, v);
    }
  }
  const nbrs = neighbours(n, tris);
  // Dijkstra along the edges, carrying each seam's reach
  while (queue.size) {
    const [d, v] = queue.pop();
    if (d > band[v] || d > reach[v]) continue;
    for (const u of nbrs[v]) {
      const nd = d + Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]);
      if (nd < band[u]) {
        band[u] = nd;
        reach[u] = reach[v];
        queue.push(nd, u);
      }
    }
  }
  return { band, reach };
}

/** Split the band's edges longer than a quarter of its fillet (null: none were). New points are added to `pos`. */
function splitBand(pos: number[], tris: number[], owner: number[], band: ArrayLike<number>, reach: ArrayLike<number>) {
  const key = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  const mid = new Map<number, number>();
  const len = (a: number, b: number) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
      const r = Math.min(reach[a], reach[b]);
      if (Math.min(band[a], band[b]) < r && len(a, b) > r / 4) mid.set(key(a, b), -1);
    }
  }
  if (!mid.size) return null;
  for (const k of mid.keys()) {
    const a = Math.floor(k / 4194304), b = k % 4194304;
    mid.set(k, pos.length / 3);
    pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
  }
  const next: number[] = [], nextOwner: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2], o = owner[t / 3];
    const ab = mid.get(key(a, b)) ?? -1, bc = mid.get(key(b, c)) ?? -1, ca = mid.get(key(c, a)) ?? -1;
    const n = (ab >= 0 ? 1 : 0) + (bc >= 0 ? 1 : 0) + (ca >= 0 ? 1 : 0);
    const push = (...v: number[]) => {
      for (let i = 0; i < v.length; i += 3) (next.push(v[i], v[i + 1], v[i + 2]), nextOwner.push(o));
    };
    if (n === 3) push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    else if (n === 2) {
      // the two cut edges split, the rest fanned
      if (ab < 0) push(c, ca, bc, ca, a, b, ca, b, bc);
      else if (bc < 0) push(a, ab, ca, ab, b, c, ab, c, ca);
      else push(b, bc, ab, bc, c, a, bc, a, ab);
    } else if (ab >= 0) push(a, ab, c, ab, b, c);
    else if (bc >= 0) push(b, bc, a, bc, c, a);
    else if (ca >= 0) push(c, ca, b, ca, a, b);
    else push(a, b, c);
  }
  return { tris: next, owner: nextOwner };
}

/** Taubin smoothing in the band, weighted down to nothing at its edge. */
function smoothBand(pos: number[], tris: number[], band: ArrayLike<number>, reach: ArrayLike<number>, iterations: number) {
  const n = pos.length / 3;
  const nbrs = neighbours(n, tris);
  const weight = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = Math.max(0, 1 - band[v] / reach[v]);
    weight[v] = x * x * (3 - 2 * x);
  }
  const tmp = new Float64Array(n * 3);
  const pass = (lambda: number) => {
    for (let v = 0; v < n; v++) {
      const wv = weight[v] * lambda;
      if (!wv || !nbrs[v].length) {
        tmp[v * 3] = pos[v * 3];
        tmp[v * 3 + 1] = pos[v * 3 + 1];
        tmp[v * 3 + 2] = pos[v * 3 + 2];
        continue;
      }
      let ax = 0, ay = 0, az = 0;
      for (const u of nbrs[v]) (ax += pos[u * 3]), (ay += pos[u * 3 + 1]), (az += pos[u * 3 + 2]);
      const m = 1 / nbrs[v].length;
      tmp[v * 3] = pos[v * 3] + wv * (ax * m - pos[v * 3]);
      tmp[v * 3 + 1] = pos[v * 3 + 1] + wv * (ay * m - pos[v * 3 + 1]);
      tmp[v * 3 + 2] = pos[v * 3 + 2] + wv * (az * m - pos[v * 3 + 2]);
    }
    for (let i = 0; i < tmp.length; i++) pos[i] = tmp[i];
  };
  for (let it = 0; it < iterations; it++) {
    pass(0.6);
    pass(-0.63);
  }
}

function neighbours(n: number, tris: number[]): number[][] {
  const nbrs: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
      nbrs[a].push(b);
      nbrs[b].push(a);
    }
  }
  return nbrs;
}

class MinHeap {
  private d: number[] = [];
  private v: number[] = [];
  get size() {
    return this.d.length;
  }
  push(d: number, v: number) {
    const D = this.d, V = this.v;
    D.push(d);
    V.push(v);
    let i = D.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (D[p] <= D[i]) break;
      [D[p], D[i]] = [D[i], D[p]];
      [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const D = this.d, V = this.v;
    const top: [number, number] = [D[0], V[0]];
    const ld = D.pop()!, lv = V.pop()!;
    if (D.length) {
      D[0] = ld;
      V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < D.length && D[l] < D[m]) m = l;
        if (r < D.length && D[r] < D[m]) m = r;
        if (m === i) break;
        [D[m], D[i]] = [D[i], D[m]];
        [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return top;
  }
}
