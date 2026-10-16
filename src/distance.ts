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
    return (b[at] = d);
  }

  /**
   * Signed distance at local point `q` (blended between the grid points
   * round it), or Infinity when it's further than `maxD` from the surface,
   * like exactDistance. `maxD` should be well inside the band.
   */
  sample(q: THREE.Vector3, maxD: number): number {
    const fx = (q.x - this.ox) / this.s, fy = (q.y - this.oy) / this.s, fz = (q.z - this.oz) / this.s;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    // off the grid: further than the band, outside the part
    if (i < 0 || j < 0 || k < 0 || i >= this.nx - 1 || j >= this.ny - 1 || k >= this.nz - 1) return Infinity;
    const u = fx - i, v = fy - j, w = fz - k;
    const c000 = this.node(i, j, k), c100 = this.node(i + 1, j, k), c010 = this.node(i, j + 1, k), c110 = this.node(i + 1, j + 1, k);
    const c001 = this.node(i, j, k + 1), c101 = this.node(i + 1, j, k + 1), c011 = this.node(i, j + 1, k + 1), c111 = this.node(i + 1, j + 1, k + 1);
    const d =
      ((c000 * (1 - u) + c100 * u) * (1 - v) + (c010 * (1 - u) + c110 * u) * v) * (1 - w) +
      ((c001 * (1 - u) + c101 * u) * (1 - v) + (c011 * (1 - u) + c111 * u) * v) * w;
    return Math.abs(d) > maxD ? Infinity : d;
  }
}

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
