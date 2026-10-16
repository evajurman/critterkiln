import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Exact signed distances to a part's real surface, shared by the fast merge
// (reshaping each part at its joins) and the seamless skin rebuild.

/**
 * Low-poly meshes are non-indexed: each triangle has its own copy of a corner
 * with its own flat normal. Anything that moves vertices along their normal
 * would push those copies apart and tear the seams, so average the normals of
 * every copy sitting at the same position. Indexed meshes already share them.
 */
export function sharedNormals(geo: THREE.BufferGeometry): THREE.BufferAttribute {
  const own = geo.getAttribute('normal') as THREE.BufferAttribute;
  if (geo.index) return own;
  const cached = geo.userData.sharedNormals as THREE.BufferAttribute | undefined;
  if (cached) return cached;
  const pos = geo.getAttribute('position');
  const keyOf = (i: number) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = keyOf(i);
    keys.push(key);
    const acc = sums.get(key) ?? [0, 0, 0];
    acc[0] += own.getX(i);
    acc[1] += own.getY(i);
    acc[2] += own.getZ(i);
    sums.set(key, acc);
  }
  const out = new Float32Array(pos.count * 3);
  keys.forEach((key, i) => {
    const [x, y, z] = sums.get(key)!;
    const l = Math.hypot(x, y, z) || 1;
    out.set([x / l, y / l, z / l], i * 3);
  });
  const attr = new THREE.BufferAttribute(out, 3);
  geo.userData.sharedNormals = attr;
  return attr;
}

const bvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH>();
/** A bounding-volume hierarchy over a part's surface, built once per geometry. */
export function bvhFor(geo: THREE.BufferGeometry): MeshBVH {
  let bvh = bvhCache.get(geo);
  if (!bvh) {
    // indirect: leave the geometry's own triangle order untouched
    bvh = new MeshBVH(geo, { indirect: true });
    bvhCache.set(geo, bvh);
  }
  return bvh;
}

const hitInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

/**
 * A part's signed distance sampled on a grid in its own space, for the
 * seamless skin: posing only moves a part, never reshapes it, so once a grid
 * point is measured it holds for every pose. Points are measured (exactly)
 * the first time they're needed, kept in small blocks, so only the shell
 * round the part's surface is ever filled in. Values beyond `band` are
 * clamped to it.
 */
export class DistanceGrid {
  private readonly blocks = new Map<number, Float32Array>();
  private readonly ox: number;
  private readonly oy: number;
  private readonly oz: number;
  /** nodes along each axis, and blocks along x and y */
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly bx: number;
  private readonly by: number;
  private readonly p = new THREE.Vector3();
  private readonly g = new THREE.Vector3();
  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly bvh: MeshBVH,
    private readonly normals: THREE.BufferAttribute,
    readonly s: number,
    readonly band: number,
  ) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox!.clone().expandByScalar(band + 2 * s);
    this.ox = box.min.x;
    this.oy = box.min.y;
    this.oz = box.min.z;
    this.nx = Math.ceil((box.max.x - box.min.x) / s) + 1;
    this.ny = Math.ceil((box.max.y - box.min.y) / s) + 1;
    this.nz = Math.ceil((box.max.z - box.min.z) / s) + 1;
    this.bx = (this.nx >> 3) + 1;
    this.by = (this.ny >> 3) + 1;
  }

  /** grid points measured since the grid was made or last saved (see gridStore) */
  fresh = 0;

  /** node (i, j, k), measured now if it hasn't been */
  private node(i: number, j: number, k: number): number {
    const key = (i >> 3) + this.bx * ((j >> 3) + this.by * (k >> 3));
    let b = this.blocks.get(key);
    if (!b) this.blocks.set(key, (b = new Float32Array(512).fill(NaN)));
    const at = (i & 7) + 8 * ((j & 7) + 8 * (k & 7));
    const v = b[at];
    if (v === v) return v;
    this.p.set(this.ox + i * this.s, this.oy + j * this.s, this.oz + k * this.s);
    let d = exactDistance(this.geo, this.bvh, this.normals, this.p, this.band, this.g);
    if (!Number.isFinite(d)) d = insideByRay(this.geo, this.bvh, this.p) ? -this.band : this.band;
    this.fresh++;
    return (b[at] = d);
  }

  /** Everything measured so far, to keep (block keys, and their 512 values each). */
  dump(): { keys: Int32Array; values: Float32Array } {
    const keys = new Int32Array(this.blocks.size), values = new Float32Array(this.blocks.size * 512);
    let n = 0;
    for (const [key, b] of this.blocks) (keys[n] = key), values.set(b, 512 * n++);
    return { keys, values };
  }

  /** Take back what a dump of the same shape held (points measured since are kept). */
  load(d: { keys: Int32Array; values: Float32Array }) {
    for (let n = 0; n < d.keys.length; n++) {
      const saved = d.values.subarray(512 * n, 512 * n + 512);
      const b = this.blocks.get(d.keys[n]);
      if (!b) this.blocks.set(d.keys[n], saved.slice());
      else for (let a = 0; a < 512; a++) if (b[a] !== b[a]) b[a] = saved[a];
    }
  }

  /** the 8 grid points round cell (i, j, k), into `c` (x fastest); from one block when they all lie in it */
  private readonly c = new Float64Array(8);
  private corners(i: number, j: number, k: number) {
    const c = this.c;
    if ((i & 7) < 7 && (j & 7) < 7 && (k & 7) < 7) {
      const b = this.blocks.get((i >> 3) + this.bx * ((j >> 3) + this.by * (k >> 3)));
      if (b) {
        const at = (i & 7) + 8 * ((j & 7) + 8 * (k & 7));
        c[0] = b[at], c[1] = b[at + 1], c[2] = b[at + 8], c[3] = b[at + 9];
        c[4] = b[at + 64], c[5] = b[at + 65], c[6] = b[at + 72], c[7] = b[at + 73];
        // all measured already: the usual case once a part has been skinned before
        if (c[0] === c[0] && c[1] === c[1] && c[2] === c[2] && c[3] === c[3] && c[4] === c[4] && c[5] === c[5] && c[6] === c[6] && c[7] === c[7]) return;
      }
    }
    for (let n = 0; n < 8; n++) c[n] = this.node(i + (n & 1), j + ((n >> 1) & 1), k + ((n >> 2) & 1));
  }

  /**
   * Signed distance at local point `q` (blended between the grid points
   * round it), or Infinity when it's further than `maxD` from the surface,
   * like exactDistance. `maxD` should be inside the band. With `grad`, also
   * its gradient (the way out, not normalised). With `side`, a point beyond
   * `maxD` (or off the grid) gives the band, signed by which side of the part
   * it's on, instead of Infinity.
   */
  sample(q: THREE.Vector3, maxD: number, grad?: THREE.Vector3, side = false): number {
    const fx = (q.x - this.ox) / this.s, fy = (q.y - this.oy) / this.s, fz = (q.z - this.oz) / this.s;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    // off the grid: further than the band, outside the part
    if (i < 0 || j < 0 || k < 0 || i >= this.nx - 1 || j >= this.ny - 1 || k >= this.nz - 1) {
      grad?.set(0, 0, 0);
      return side ? this.band : Infinity;
    }
    const u = fx - i, v = fy - j, w = fz - k;
    this.corners(i, j, k);
    const c = this.c;
    const x00 = c[0] + (c[1] - c[0]) * u, x10 = c[2] + (c[3] - c[2]) * u, x01 = c[4] + (c[5] - c[4]) * u, x11 = c[6] + (c[7] - c[6]) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    const d = y0 + (y1 - y0) * w;
    if (grad) {
      const gx = ((c[1] - c[0]) * (1 - v) + (c[3] - c[2]) * v) * (1 - w) + ((c[5] - c[4]) * (1 - v) + (c[7] - c[6]) * v) * w;
      grad.set(gx / this.s, ((x10 - x00) * (1 - w) + (x11 - x01) * w) / this.s, (y1 - y0) / this.s);
    }
    if (Math.abs(d) <= maxD) return d;
    return side ? (d < 0 ? -this.band : this.band) : Infinity;
  }

  /**
   * As sample (with its gradient), but blended smoothly (Catmull-Rom) from
   * the 4x4x4 points round it rather than straight between the nearest 8.
   * Straight blending rounds a curved part a little smaller than it is (most
   * on thin points); this doesn't. For placing the skin's points exactly.
   */
  private readonly cw = new Float64Array(12);
  sampleSmooth(q: THREE.Vector3, maxD: number, grad: THREE.Vector3): number {
    const fx = (q.x - this.ox) / this.s, fy = (q.y - this.oy) / this.s, fz = (q.z - this.oz) / this.s;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 1 || j < 1 || k < 1 || i >= this.nx - 2 || j >= this.ny - 2 || k >= this.nz - 2) return this.sample(q, maxD, grad);
    // weights (and their slopes) along each axis
    const w = this.cw;
    const weights = (t: number, o: number) => {
      const t2 = t * t, t3 = t2 * t;
      w[o] = (-t3 + 2 * t2 - t) / 2;
      w[o + 1] = (3 * t3 - 5 * t2 + 2) / 2;
      w[o + 2] = (-3 * t3 + 4 * t2 + t) / 2;
      w[o + 3] = (t3 - t2) / 2;
    };
    const slopes = (t: number, o: number) => {
      const t2 = t * t;
      ds[o] = (-3 * t2 + 4 * t - 1) / 2;
      ds[o + 1] = (9 * t2 - 10 * t) / 2;
      ds[o + 2] = (-9 * t2 + 8 * t + 1) / 2;
      ds[o + 3] = (3 * t2 - 2 * t) / 2;
    };
    const ds = smoothSlopes;
    weights(fx - i, 0), weights(fy - j, 4), weights(fz - k, 8);
    slopes(fx - i, 0), slopes(fy - j, 4), slopes(fz - k, 8);
    // the 4 points along each axis lie in at most 2 blocks: look each block up once
    const bi = smoothBlock, li = smoothLocal;
    for (let a = 0; a < 4; a++) {
      bi[a] = (i - 1 + a) >> 3;
      li[a] = (i - 1 + a) & 7;
      bi[4 + a] = (j - 1 + a) >> 3;
      li[4 + a] = (j - 1 + a) & 7;
      bi[8 + a] = (k - 1 + a) >> 3;
      li[8 + a] = (k - 1 + a) & 7;
    }
    let d = 0, gx = 0, gy = 0, gz = 0;
    let lastKey = -1, block: Float32Array | undefined;
    for (let c = 0; c < 4; c++) {
      for (let b = 0; b < 4; b++) {
        for (let a = 0; a < 4; a++) {
          const key = bi[a] + this.bx * (bi[4 + b] + this.by * bi[8 + c]);
          if (key !== lastKey) (block = this.blocks.get(key)), (lastKey = key);
          let v = block ? block[li[a] + 8 * (li[4 + b] + 8 * li[8 + c])] : NaN;
          // not measured yet: now (which may make the block)
          if (v !== v) (v = this.node(i - 1 + a, j - 1 + b, k - 1 + c)), (lastKey = -1);
          d += v * w[a] * w[4 + b] * w[8 + c];
          gx += v * ds[a] * w[4 + b] * w[8 + c];
          gy += v * w[a] * ds[4 + b] * w[8 + c];
          gz += v * w[a] * w[4 + b] * ds[8 + c];
        }
      }
    }
    grad.set(gx / this.s, gy / this.s, gz / this.s);
    return Math.abs(d) <= maxD ? d : Infinity;
  }
}
const smoothSlopes = new Float64Array(12);
const smoothBlock = new Int32Array(12), smoothLocal = new Int32Array(12);

const gridCache = new WeakMap<THREE.BufferGeometry, DistanceGrid[]>();
/** A part's distance grid with this spacing, at least this wide (made once, then reused for every pose). */
export function distanceGrid(geo: THREE.BufferGeometry, s: number, band: number): DistanceGrid {
  let list = gridCache.get(geo);
  if (!list) gridCache.set(geo, (list = []));
  const found = list.find((g) => Math.abs(g.s - s) < 1e-9 && g.band >= band && g.band < band * 1.5);
  if (found) return found;
  const grid = new DistanceGrid(geo, bvhFor(geo), sharedNormals(geo), s, band);
  list.push(grid);
  // a couple at most (the grid spacing follows the thinnest part in its group)
  if (list.length > 2) list.shift();
  return grid;
}

// one ray: if the first surface it meets faces away from us, we're inside
// (an odd direction, so it doesn't run along a part's grid of vertices)
const probe = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.577, 0.577, 0.577));
const fa = new THREE.Vector3(), fb = new THREE.Vector3(), fc = new THREE.Vector3(), fn = new THREE.Vector3();
/** Whether local point `q` is inside the part, by which way the first surface a ray meets is facing. */
export function insideByRay(geo: THREE.BufferGeometry, bvh: MeshBVH, q: THREE.Vector3): boolean {
  probe.origin.copy(q);
  const hit = bvh.raycastFirst(probe, THREE.DoubleSide);
  if (!hit?.face) return false;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  fa.fromBufferAttribute(pos, hit.face.a);
  fb.fromBufferAttribute(pos, hit.face.b);
  fc.fromBufferAttribute(pos, hit.face.c);
  fn.subVectors(fb, fa).cross(fc.sub(fa));
  return fn.dot(probe.direction) > 0;
}
const triA = new THREE.Vector3(), triB = new THREE.Vector3(), triC = new THREE.Vector3();
const bary = new THREE.Vector3(), nrm = new THREE.Vector3(), away = new THREE.Vector3();

/**
 * Signed distance from local point `q` to a part's actual surface (negative
 * inside), with the outward direction written into `grad`. Returns Infinity
 * when the surface is further than `maxD` (nothing to blend there).
 * `signed` false: just how far, never negative, and no gradient (which side
 * a point is on can take a ray to settle).
 */
export function exactDistance(
  geo: THREE.BufferGeometry,
  bvh: MeshBVH,
  normals: THREE.BufferAttribute,
  q: THREE.Vector3,
  maxD: number,
  grad: THREE.Vector3,
  signed = true,
): number {
  const hit = bvh.closestPointToPoint(q, hitInfo, 0, maxD);
  if (!hit) return Infinity;
  if (!signed) return hit.distance;
  const tri = hit.faceIndex; // already the real triangle, even in indirect mode
  const index = geo.index;
  const i0 = index ? index.getX(tri * 3) : tri * 3;
  const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
  const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  triA.fromBufferAttribute(pos, i0);
  triB.fromBufferAttribute(pos, i1);
  triC.fromBufferAttribute(pos, i2);
  // the smooth (interpolated) normal at the closest point decides inside vs outside
  THREE.Triangle.getBarycoord(hit.point, triA, triB, triC, bary);
  nrm
    .set(0, 0, 0)
    .addScaledVector(triA.fromBufferAttribute(normals, i0), bary.x)
    .addScaledVector(triB.fromBufferAttribute(normals, i1), bary.y)
    .addScaledVector(triC.fromBufferAttribute(normals, i2), bary.z)
    .normalize();
  away.subVectors(q, hit.point);
  const dist = away.length();
  const facing = away.dot(nrm);
  // The smoothed normal can point the wrong way where the closest point is a
  // sharp tip or edge (a thin curl's point: the normals round it are averaged
  // into one facing sideways), and then empty space far from the part reads
  // as deep inside it; the seamless skin turns that into floating blocks.
  // A closest point on a corner or an edge is shared by several triangles, so
  // no one normal speaks for it. Then, or when the facing is unclear or
  // disagrees with the triangle's own, count it the slow, sure way with a ray.
  fn.subVectors(triB.fromBufferAttribute(pos, i1), triA.fromBufferAttribute(pos, i0)).cross(triC.fromBufferAttribute(pos, i2).sub(triA));
  const onRim = Math.min(bary.x, bary.y, bary.z) < 1e-4;
  const doubt = dist > 1e-6 && (onRim || Math.abs(facing) < 0.5 * dist || facing >= 0 !== away.dot(fn) >= 0);
  const sign = doubt ? (insideByRay(geo, bvh, q) ? -1 : 1) : facing >= 0 ? 1 : -1;
  if (dist > 1e-6) grad.copy(away).divideScalar(dist).multiplyScalar(sign);
  else grad.copy(nrm);
  return sign * dist;
}
