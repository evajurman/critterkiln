import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { bvhFor, distanceGrid, exactDistance, insideByRay, sharedNormals, type DistanceGrid } from './distance';
import { applyLumps, lumpFade } from './inflate';

/**
 * Seamless skins: rebuild a group of merged parts as ONE continuous surface.
 *
 * The fast merge reshapes each part's own triangles at its joins, which can
 * leave hairline cracks where triangles straddle a join. Here we instead
 * sample the smooth union of every part's exact signed distance on a grid
 * (only near the surface) and extract a single mesh with surface nets, so
 * there is nothing to crack. It's slower, so it runs in small chunks when the
 * creature has been left alone for a moment, and is thrown away on any change.
 */

export interface SkinPart {
  /** the part's shape, in its own local space */
  geo: THREE.BufferGeometry;
  /** part local space -> skin space */
  toSkin: THREE.Matrix4;
  color: THREE.Color;
  /** 0..1: how much its color glows */
  glow?: number;
  /** fillet size where this part joins others */
  k: number;
  /** low-poly: this part's facet size */
  facet?: number;
  /** part local space -> the creature's rest pose, where textures are laid out */
  toRest?: THREE.Matrix4;
}

export interface SkinOptions {
  /** grid spacing (world units): smaller = more detail, slower */
  h: number;
  /** width of the color fade between differently colored parts; 0 = one color */
  colorBlend: number;
  lowPoly: boolean;
  /** clay lump strength to add back onto the finished skin (0 = none) */
  lumps?: number;
  /** eyes (centre and radius, in skin space): no lumps under them (see lumpFade) */
  eyes?: { x: number; y: number; z: number; r: number }[];
  /** polled between chunks: return true to abandon the build */
  shouldStop: () => boolean;
  /** told how far along the build is (0..1), between chunks */
  progress?: (done: number) => void;
  /**
   * Which parts (by index) flow into each other. Others in the group only
   * meet with a plain crease, however close they come (a tail curled up to
   * the head). Leave out to blend every pair.
   */
  linked?: (a: number, b: number) => boolean;
  /**
   * A skin over just some of its parts, by what each one is: 1 = shown by
   * this skin; 0 = shown by another skin, which this one blends into (the
   * whole fillet is this skin's: a peeled part); 2 = shown as its own mesh,
   * which fuses into this skin itself (the fillet is split down the middle).
   * Leave out to show every part.
   */
  keep?: number[];
}

interface Prepared {
  facet?: number;
  geo: THREE.BufferGeometry;
  bvh: ReturnType<typeof bvhFor>;
  /** the fine pass reads distances off this (see DistanceGrid) */
  grid: DistanceGrid;
  normals: THREE.BufferAttribute;
  fromSkin: THREE.Matrix4;
  box: THREE.Box3; // skin space, padded
  color: THREE.Color;
  k: number;
  index: number;
}

// Yield to the page between chunks via a message, not a timer: timers are
// clamped (and slowed to ~1/s in background tabs), messages aren't.
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
const yieldFrame = () =>
  new Promise<void>((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });

/** Build the skin geometry (in skin space), or null if abandoned. */
export async function buildSkin(parts: SkinPart[], opts: SkinOptions): Promise<THREE.BufferGeometry | null> {
  const h = opts.h;
  const kMax = Math.max(...parts.map((p) => p.k));
  // distances further than this don't matter for the surface
  const band = h * 4 * Math.sqrt(3) + kMax;
  // the fine pass looks no further than a join plus a couple of cells (see reachP); the grid goes a little beyond
  const gridBand = kMax + 4.5 * h;

  const prepared: Prepared[] = parts.map((p, index) => {
    p.geo.computeBoundingBox();
    const box = p.geo.boundingBox!.clone().applyMatrix4(p.toSkin).expandByScalar(band);
    return {
      geo: p.geo,
      bvh: bvhFor(p.geo),
      grid: distanceGrid(p.geo, h, gridBand),
      normals: sharedNormals(p.geo),
      fromSkin: p.toSkin.clone().invert(),
      box,
      color: p.color,
      k: p.k,
      facet: p.facet,
      index,
    };
  });

  // Only linked pairs blend: the union of each linked pair's smooth-min, and
  // a plain min with everything else. (Without links, every part smooth-mins
  // into the running total, as it always has.)
  const n = prepared.length;
  const link = opts.linked ? new Uint8Array(n * n) : null;
  if (link) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) link[a * n + b] = a !== b && opts.linked!(a, b) ? 1 : 0;
  const ids = new Int32Array(n);
  const ds = new Float64Array(n);
  const gs = new Float64Array(3 * n);
  /** combine ds[0..m) (parts ids[0..m)); with `out`, also its gradient from gs */
  const combine = (m: number, out?: THREE.Vector3): number => {
    let f = Infinity;
    for (let a = 0; a < m; a++) {
      if (ds[a] >= f) continue;
      f = ds[a];
      out?.set(gs[3 * a], gs[3 * a + 1], gs[3 * a + 2]);
    }
    for (let a = 0; a < m; a++) {
      for (let b = a + 1; b < m; b++) {
        if (!link![ids[a] * n + ids[b]]) continue;
        const da = ds[a], db = ds[b];
        const k = Math.min(prepared[ids[a]].k, prepared[ids[b]].k);
        if (Math.abs(da - db) >= k) continue; // no fillet here: just the min, counted above
        const t = 0.5 + (0.5 * (db - da)) / k;
        const v = db * (1 - t) + da * t - k * t * (1 - t);
        if (v >= f) continue;
        f = v;
        if (out) for (let c = 0; c < 3; c++) out.setComponent(c, t * gs[3 * a + c] + (1 - t) * gs[3 * b + c]);
      }
    }
    return f;
  };

  const q = new THREE.Vector3();
  const grad = new THREE.Vector3();
  const pt = new THREE.Vector3();

  /** Signed distance to one part; `exact` resolves far points too (for inside/outside). */
  const partDistance = (pp: Prepared, p: THREE.Vector3, exact: boolean): number => {
    if (!pp.box.containsPoint(p)) return Infinity;
    q.copy(p).applyMatrix4(pp.fromSkin);
    const d = exactDistance(pp.geo, pp.bvh, pp.normals, q, band, grad);
    if (Number.isFinite(d) || !exact) return d;
    // far from this part: all we need is which side of it we're on
    return insideByRay(pp.geo, pp.bvh, q) ? -band : band;
  };

  /** The blended field: polynomial smooth-min of every part's distance. NaN = far from everything. */
  const field = (p: THREE.Vector3, exact: boolean): number => {
    if (link) {
      let m = 0;
      for (const pp of prepared) {
        const d = partDistance(pp, p, exact);
        if (!Number.isFinite(d)) continue;
        ids[m] = pp.index;
        ds[m++] = d;
      }
      return m ? combine(m) : NaN;
    }
    let f = Infinity;
    let any = false;
    for (const pp of prepared) {
      const d = partDistance(pp, p, exact);
      if (!Number.isFinite(d)) continue;
      any = true;
      if (!Number.isFinite(f)) {
        f = d;
        continue;
      }
      const k = pp.k;
      const t = Math.min(1, Math.max(0, 0.5 + (0.5 * (d - f)) / k));
      f = d * (1 - t) + f * t - k * t * (1 - t);
    }
    return any ? f : NaN;
  };

  // grid over everything, padded so the surface never touches the edge
  const bounds = new THREE.Box3();
  for (const pp of prepared) bounds.union(pp.box);
  const origin = bounds.min.clone();
  const size = bounds.getSize(new THREE.Vector3());
  const nx = Math.ceil(size.x / h) + 1, ny = Math.ceil(size.y / h) + 1, nz = Math.ceil(size.z / h) + 1;

  // The grid is sparse: it's cut into C^3-cell blocks and only blocks the
  // surface passes near are ever stored, so thin parts (a fine grid) on a big
  // creature cost surface area, not volume.
  const C = 4;
  const bx = Math.ceil((nx - 1) / C), by = Math.ceil((ny - 1) / C), bz = Math.ceil((nz - 1) / C);
  const cx = bx + 1, cy = by + 1, cz = bz + 1;
  if (cx * cy * cz > 6e6) return null; // absurdly large: don't try

  let slice = performance.now();
  let tick = 0;
  const breathe = async (): Promise<boolean> => {
    if ((++tick & 63) !== 0 && performance.now() - slice < 8) return false;
    if (performance.now() - slice < 8) return false;
    opts.progress?.(done);
    await yieldFrame();
    slice = performance.now();
    return opts.shouldStop();
  };

  // How far along, for showing progress: each step gets its share of the
  // work (as the last few builds took), counting only the steps this skin will take.
  const shares: Record<Step, number> = { ...stepShares };
  if (opts.lowPoly) shares.subdivide = 0;
  if (!opts.keep) shares.keep = 0;
  if (!opts.lumps) shares.lumps = 0;
  if (!parts.every((p) => p.toRest)) shares.rest = 0;
  const steps = {} as Record<Step, [number, number]>;
  let sum = 0;
  for (const v of Object.values(shares)) sum += v;
  let from = 0;
  for (const [k, v] of Object.entries(shares) as [Step, number][]) (steps[k] = [from / sum, v / sum]), (from += v);
  let done = 0;
  /** when each step started, to learn the shares from */
  const began: [Step, number][] = [];
  const reached = (step: Step, f: number) => {
    if (began[began.length - 1]?.[0] !== step) began.push([step, performance.now()]);
    done = steps[step][0] + steps[step][1] * Math.min(1, Math.max(0, f));
  };

  // node (i, j, k) is stored in block (i/C, j/C, k/C); cells likewise
  const blockKey = (i: number, j: number, k: number) => ((i / C) | 0) + cx * (((j / C) | 0) + cy * ((k / C) | 0));
  const local = (i: number, j: number, k: number) => (i % C) + C * ((j % C) + C * (k % C));
  const nodes = new Map<number, Float32Array>();
  const getNode = (i: number, j: number, k: number): number => {
    const b = nodes.get(blockKey(i, j, k));
    return b ? b[local(i, j, k)] : NaN;
  };
  const setNode = (i: number, j: number, k: number, v: number) => {
    const key = blockKey(i, j, k);
    let b = nodes.get(key);
    if (!b) nodes.set(key, (b = new Float32Array(C * C * C).fill(NaN)));
    b[local(i, j, k)] = v;
  };
  const cells = new Map<number, Int32Array>();
  const getCell = (i: number, j: number, k: number): number => cells.get(blockKey(i, j, k))?.[local(i, j, k)] ?? -1;
  const setCell = (i: number, j: number, k: number, v: number) => {
    const key = blockKey(i, j, k);
    let b = cells.get(key);
    if (!b) cells.set(key, (b = new Int32Array(C * C * C).fill(-1)));
    b[local(i, j, k)] = v;
  };

  // The grid samples the shape grown by half a cell: a point thinner than a
  // cell (a horn's tip) would otherwise fall between the samples and be cut
  // off. Step 4b shrinks every vertex back onto the true surface, which pulls
  // the grown tip back in to a sharp point.
  const grown = 0.5 * h;

  // 1. coarse pass: find the blocks the surface can pass through
  const coarse = new Float32Array(cx * cy * cz);
  const reach = C * h * Math.sqrt(3) * 1.05;
  for (let k = 0; k < cz; k++) {
    reached('coarse', k / cz);
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        pt.set(origin.x + Math.min(i * C, nx - 1) * h, origin.y + Math.min(j * C, ny - 1) * h, origin.z + Math.min(k * C, nz - 1) * h);
        coarse[i + cx * (j + cy * k)] = field(pt, false) - grown;
        if (await breathe()) return null;
      }
    }
  }

  // 2. fine pass inside blocks near the surface. Per block, first work out
  // which parts matter: parts far from the block are dropped, and a block
  // buried deep inside some part is skipped outright (it's hidden anyway).
  const halfDiag = (C * h * Math.sqrt(3)) / 2;
  const center = new THREE.Vector3();
  const rel: Prepared[] = [];
  const relSide: number[] = [];
  /** the part is out of reach from every node in the block: its distance there is just ±reach */
  const relFar: boolean[] = [];
  const active: number[] = [];
  /** smooth union at `p` over just the parts near this block (`rel`), off their grids or measured exactly */
  const nodeField = (p: THREE.Vector3, exact: boolean): number => {
    let f = Infinity;
    for (let r = 0; r < rel.length; r++) {
      const pp = rel[r];
      q.copy(p).applyMatrix4(pp.fromSkin);
      // only distances within the join size (plus a couple of cells) shape the surface
      const reachP = pp.k + 2.5 * h;
      let d = relFar[r] ? Infinity : exact ? exactDistance(pp.geo, pp.bvh, pp.normals, q, reachP, grad) : pp.grid.sample(q, reachP);
      // beyond reach from this node: same side as the block centre
      if (!Number.isFinite(d)) d = relSide[r] * reachP;
      if (link) {
        ids[r] = pp.index;
        ds[r] = d;
        continue;
      }
      if (!Number.isFinite(f)) {
        f = d;
        continue;
      }
      const t = Math.min(1, Math.max(0, 0.5 + (0.5 * (d - f)) / pp.k));
      f = d * (1 - t) + f * t - pp.k * t * (1 - t);
    }
    return link ? combine(rel.length) : f;
  };
  for (let bk = 0; bk < bz; bk++) {
    for (let bj = 0; bj < by; bj++) {
      reached('fine', (bk * by + bj) / (bz * by));
      for (let bi = 0; bi < bx; bi++) {
        let near = false;
        for (let c = 0; c < 8 && !near; c++) {
          const v = coarse[bi + (c & 1) + cx * (bj + ((c >> 1) & 1) + cy * (bk + ((c >> 2) & 1)))];
          if (!Number.isNaN(v) && Math.abs(v) < reach) near = true;
        }
        if (!near) continue;
        active.push(bi, bj, bk);

        center.set(origin.x + (bi + 0.5) * C * h, origin.y + (bj + 0.5) * C * h, origin.z + (bk + 0.5) * C * h);
        rel.length = 0;
        relSide.length = 0;
        relFar.length = 0;
        let buried = false;
        for (const pp of prepared) {
          if (!pp.box.containsPoint(center) && pp.box.distanceToPoint(center) > halfDiag) continue;
          q.copy(center).applyMatrix4(pp.fromSkin);
          const d = exactDistance(pp.geo, pp.bvh, pp.normals, q, band + halfDiag, grad);
          if (Number.isFinite(d)) {
            rel.push(pp);
            relSide.push(d < 0 ? -1 : 1);
            relFar.push(Math.abs(d) - halfDiag > pp.k + 2.5 * h);
          } else if (insideByRay(pp.geo, pp.bvh, q)) {
            buried = true;
            break;
          }
        }

        for (let k = bk * C; k <= Math.min((bk + 1) * C, nz - 1); k++) {
          for (let j = bj * C; j <= Math.min((bj + 1) * C, ny - 1); j++) {
            for (let i = bi * C; i <= Math.min((bi + 1) * C, nx - 1); i++) {
              if (!Number.isNaN(getNode(i, j, k))) continue;
              if (buried || !rel.length) {
                setNode(i, j, k, buried ? -band : band);
                continue;
              }
              pt.set(origin.x + i * h, origin.y + j * h, origin.z + k * h);
              // First off the parts' distance grids. Those are out by less than
              // a cell, and only the points next to the surface (the ends of
              // the cell edges it crosses) shape it: those are measured again
              // exactly, so sharp tips finer than the grid stay as sharp.
              let f = nodeField(pt, false);
              if (Math.abs(f - grown) < 2.5 * h) f = nodeField(pt, true);
              setNode(i, j, k, f - grown);
            }
          }
        }
        if (await breathe()) return null;
      }
    }
  }

  // a block's (C+1)^3 corner nodes, copied out of the sparse store
  const S = C + 1;
  const scratch = new Float32Array(S * S * S);
  const loadBlock = (bi: number, bj: number, bk: number) => {
    for (let k = 0; k < S; k++) {
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const gi = bi * C + i, gj = bj * C + j, gk = bk * C + k;
          scratch[i + S * (j + S * k)] = gi < nx && gj < ny && gk < nz ? getNode(gi, gj, gk) : NaN;
        }
      }
    }
  };
  const at = (li: number, lj: number, lk: number) => scratch[li + S * (lj + S * lk)];

  // 3. surface nets: one vertex per cell the surface crosses, at the mean of its edge crossings
  const positions: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x
    [0, 2], [1, 3], [4, 6], [5, 7], // y
    [0, 4], [1, 5], [2, 6], [3, 7], // z
  ];
  for (let a = 0; a < active.length; a += 3) {
    reached('nets', (0.5 * a) / active.length);
    const bi = active[a], bj = active[a + 1], bk = active[a + 2];
    loadBlock(bi, bj, bk);
    for (let lk = 0; lk < C; lk++) {
      for (let lj = 0; lj < C; lj++) {
        for (let li = 0; li < C; li++) {
          const i = bi * C + li, j = bj * C + lj, k = bk * C + lk;
          if (i >= nx - 1 || j >= ny - 1 || k >= nz - 1) continue;
          let inside = 0, known = true;
          for (let c = 0; c < 8; c++) {
            const v = at(li + (c & 1), lj + ((c >> 1) & 1), lk + ((c >> 2) & 1));
            if (Number.isNaN(v)) {
              known = false;
              break;
            }
            corner[c] = v;
            if (v < 0) inside++;
          }
          if (!known || inside === 0 || inside === 8) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [ea, eb] of EDGES) {
            const va = corner[ea], vb = corner[eb];
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            sx += (ea & 1) + (((eb & 1) - (ea & 1)) * t);
            sy += ((ea >> 1) & 1) + ((((eb >> 1) & 1) - ((ea >> 1) & 1)) * t);
            sz += ((ea >> 2) & 1) + ((((eb >> 2) & 1) - ((ea >> 2) & 1)) * t);
            n++;
          }
          setCell(i, j, k, positions.length / 3);
          positions.push(origin.x + (i + sx / n) * h, origin.y + (j + sy / n) * h, origin.z + (k + sz / n) * h);
        }
      }
    }
    if (await breathe()) return null;
  }

  // one quad per grid edge the surface crosses, joining the four cells around it
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let a = 0; a < active.length; a += 3) {
    reached('nets', 0.5 + (0.5 * a) / active.length);
    const bi = active[a], bj = active[a + 1], bk = active[a + 2];
    loadBlock(bi, bj, bk);
    for (let lk = 0; lk < C; lk++) {
      for (let lj = 0; lj < C; lj++) {
        for (let li = 0; li < C; li++) {
          const i = bi * C + li, j = bj * C + lj, k = bk * C + lk;
          if (i < 1 || j < 1 || k < 1 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) continue;
          const v0 = at(li, lj, lk);
          if (Number.isNaN(v0)) continue;
          const neg = v0 < 0;
          const vx = at(li + 1, lj, lk);
          if (!Number.isNaN(vx) && vx < 0 !== neg) {
            quad(getCell(i, j - 1, k - 1), getCell(i, j, k - 1), getCell(i, j, k), getCell(i, j - 1, k), !neg);
          }
          const vy = at(li, lj + 1, lk);
          if (!Number.isNaN(vy) && vy < 0 !== neg) {
            quad(getCell(i - 1, j, k - 1), getCell(i - 1, j, k), getCell(i, j, k), getCell(i, j, k - 1), !neg);
          }
          const vz = at(li, lj, lk + 1);
          if (!Number.isNaN(vz) && vz < 0 !== neg) {
            quad(getCell(i - 1, j - 1, k), getCell(i, j - 1, k), getCell(i, j, k), getCell(i - 1, j, k), !neg);
          }
        }
      }
    }
    if (await breathe()) return null;
  }
  if (!index.length) return null;
  const kept = dropSpecks(index, positions.length / 3);
  if (!kept.length) return null;
  index.length = 0;
  for (const t of kept) index.push(t);

  // 4. gentle Taubin smoothing to soften the grid (without shrinking)
  const count = positions.length / 3;
  const nbrs: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    nbrs[a].push(b, c);
    nbrs[b].push(a, c);
    nbrs[c].push(a, b);
  }
  const pos = new Float32Array(positions);
  const tmp = new Float32Array(pos.length);
  const pass = (lambda: number) => {
    for (let v = 0; v < count; v++) {
      const ns = nbrs[v];
      if (!ns.length) {
        tmp.set(pos.subarray(v * 3, v * 3 + 3), v * 3);
        continue;
      }
      let ax = 0, ay = 0, az = 0;
      for (const n of ns) {
        ax += pos[n * 3];
        ay += pos[n * 3 + 1];
        az += pos[n * 3 + 2];
      }
      const m = 1 / ns.length;
      tmp[v * 3] = pos[v * 3] + lambda * (ax * m - pos[v * 3]);
      tmp[v * 3 + 1] = pos[v * 3 + 1] + lambda * (ay * m - pos[v * 3 + 1]);
      tmp[v * 3 + 2] = pos[v * 3 + 2] + lambda * (az * m - pos[v * 3 + 2]);
    }
    pos.set(tmp);
  };
  for (let it = 0; it < 3; it++) {
    pass(0.5);
    pass(-0.53);
  }

  // 4b. the grid can't follow anything finer than a cell (a horn's sharp tip
  // turns into a lumpy nub, and smoothing rounds it further), so pull every
  // vertex back onto the true blended surface: away from the joins that's
  // each part's own shape, sharp points and all.
  const lin = prepared.map((pp) => new THREE.Matrix3().setFromMatrix4(pp.fromSkin).transpose());
  const g = new THREE.Vector3(), gp = new THREE.Vector3();
  /** the blended field at `p`, its gradient into `out` (as `field`, with the smooth-min's gradient) */
  const fieldGrad = (p: THREE.Vector3, out: THREE.Vector3): number => {
    let f = Infinity;
    let m = 0;
    for (let i = 0; i < prepared.length; i++) {
      const pp = prepared[i];
      if (!pp.box.containsPoint(p)) continue;
      q.copy(p).applyMatrix4(pp.fromSkin);
      const d = exactDistance(pp.geo, pp.bvh, pp.normals, q, band, gp);
      if (!Number.isFinite(d)) continue;
      // a local-space gradient back into skin space
      gp.applyMatrix3(lin[i]);
      if (link) {
        ids[m] = i;
        ds[m] = d;
        gs[3 * m] = gp.x;
        gs[3 * m + 1] = gp.y;
        gs[3 * m + 2] = gp.z;
        m++;
        continue;
      }
      if (!Number.isFinite(f)) {
        f = d;
        out.copy(gp);
        continue;
      }
      const t = Math.min(1, Math.max(0, 0.5 + (0.5 * (d - f)) / pp.k));
      f = d * (1 - t) + f * t - pp.k * t * (1 - t);
      out.multiplyScalar(t).addScaledVector(gp, 1 - t);
    }
    if (link) return m ? combine(m, out) : Infinity;
    return f;
  };
  /** move `p` onto the surface (f = 0) by a few Newton steps, never more than a couple of cells each */
  const settle = (p: THREE.Vector3) => {
    for (let it = 0; it < 3; it++) {
      const f = fieldGrad(p, g);
      const g2 = g.lengthSq();
      if (!Number.isFinite(f) || g2 < 1e-8 || Math.abs(f) < h * 1e-3) break;
      const step = Math.max(-2 * h, Math.min(2 * h, f / Math.sqrt(g2)));
      p.addScaledVector(g, -step / Math.sqrt(g2));
    }
  };
  /**
   * Settling can fold the skin where it creases (an armpit): neighbours slide
   * down either side of the crease past each other, turning triangles over
   * into dark flecks (that lumps then tear open). Ease the corners of any
   * triangle that turned over back toward where they were (`was`, where none
   * had), halving the move until it lies flat again. A triangle turned
   * further than `turn` (as a cosine) counts as folded.
   */
  const unfold = (now: number[] | Float32Array, was: ArrayLike<number>, tris: number[], turn = 0.25) => {
    const back = new Uint8Array(now.length / 3);
    const turned = (p: ArrayLike<number>, a: number, b: number, c: number, out: THREE.Vector3) => {
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
      return out.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    };
    for (let round = 0; round < 8; round++) {
      back.fill(0);
      let any = false;
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        turned(now, a, b, c, g);
        turned(was, a, b, c, gp);
        if (g.dot(gp) > turn * g.length() * gp.length()) continue;
        back[a] = back[b] = back[c] = 1;
        any = true;
      }
      if (!any) return;
      // the last round puts them right back, which can't be folded
      const f = round === 7 ? 1 : 0.5;
      for (let v = 0; v < back.length; v++) {
        if (!back[v]) continue;
        for (let i = v * 3; i < v * 3 + 3; i++) now[i] += (was[i] - now[i]) * f;
      }
    }
  };
  /** whether `p` is in a crease between two parts that don't blend (only with links) */
  const unblended = (p: THREE.Vector3): boolean => {
    if (!link) return false;
    let a = -1, b = -1, da = Infinity, db = Infinity;
    for (let i = 0; i < n; i++) {
      const pp = prepared[i];
      if (!pp.box.containsPoint(p)) continue;
      q.copy(p).applyMatrix4(pp.fromSkin);
      const d = exactDistance(pp.geo, pp.bvh, pp.normals, q, 3 * h, gp);
      if (!Number.isFinite(d)) continue;
      if (d < da) (b = a, db = da, a = i, da = d);
      else if (d < db) (b = i, db = d);
    }
    return b >= 0 && db < 2 * h && !link[a * n + b];
  };
  const unsettled = pos.slice();
  for (let v = 0; v < count; v++) {
    reached('settle', v / count);
    settle(pt.fromArray(pos, v * 3));
    pt.toArray(pos, v * 3);
    if ((v & 1023) === 0 && (await breathe())) return null;
  }
  unfold(pos, unsettled, index);

  /** how thick the mesh is under each vertex: straight in along its normal to the far side */
  const thicknessOf = async (mesh: THREE.BufferGeometry): Promise<Float32Array | null> => {
    const bvh = new MeshBVH(mesh);
    const P = mesh.getAttribute('position') as THREE.BufferAttribute;
    const N = mesh.getAttribute('normal') as THREE.BufferAttribute;
    const out = new Float32Array(P.count);
    const inward = new THREE.Ray();
    for (let v = 0; v < P.count; v++) {
      inward.direction.fromBufferAttribute(N, v).negate();
      // start just inside so the ray doesn't hit the vertex's own triangles
      inward.origin.fromBufferAttribute(P, v).addScaledVector(inward.direction, h * 1e-3);
      const hit = bvh.raycastFirst(inward, THREE.DoubleSide);
      out[v] = hit ? hit.distance : Infinity;
      if ((v & 4095) === 0 && (await breathe())) return null;
    }
    return out;
  };

  // 4d. where the skin is thin for its grid (a horn's point, a claw) there are
  // only a few vertices round it, so it looks faceted and lumpy: split the
  // edges there and settle the new points on the surface, twice at most.
  // (Low-poly is re-faceted anyway.)
  let verts: ArrayLike<number> = pos;
  let tris = index;
  if (!opts.lowPoly) {
    const grow = Array.from(pos);
    // edge key: both ends, smaller first
    const key = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    for (let round = 0; round < 2; round++) {
      reached('subdivide', round / 2);
      const g0 = new THREE.BufferGeometry();
      g0.setAttribute('position', new THREE.Float32BufferAttribute(grow, 3));
      g0.setIndex(tris);
      g0.computeVertexNormals();
      const thick = await thicknessOf(g0);
      g0.dispose();
      if (!thick) return null;
      const split = new Map<number, number>();
      const len = (a: number, b: number) => Math.hypot(grow[a * 3] - grow[b * 3], grow[a * 3 + 1] - grow[b * 3 + 1], grow[a * 3 + 2] - grow[b * 3 + 2]);
      // about ten edges round anything thin; never finer than a sixth of a cell
      for (let t = 0; t < tris.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
          if (len(a, b) > Math.max(0.3 * Math.min(thick[a], thick[b]), h / 6)) split.set(key(a, b), -1);
        }
      }
      if (!split.size) break;
      // a triangle with two edges split has its third split too, so it can go into four
      for (let grew = true; grew; ) {
        grew = false;
        for (let t = 0; t < tris.length; t += 3) {
          const ks = [key(tris[t], tris[t + 1]), key(tris[t + 1], tris[t + 2]), key(tris[t + 2], tris[t])];
          const n = ks.filter((k) => split.has(k)).length;
          if (n === 2) {
            for (const k of ks) split.set(k, -1);
            grew = true;
          }
        }
      }
      let made = 0;
      // where the new points were before settling: halfway along their edges, lying flat
      const flat = grow.slice();
      for (const k of split.keys()) {
        const a = Math.floor(k / 4194304), b = k % 4194304;
        pt.set((grow[a * 3] + grow[b * 3]) / 2, (grow[a * 3 + 1] + grow[b * 3 + 1]) / 2, (grow[a * 3 + 2] + grow[b * 3 + 2]) / 2);
        flat.push(pt.x, pt.y, pt.z);
        // on a thin point the edge cuts inside, and its midpoint settles out
        // onto the surface. One that's outside is in a crease (an arm close by
        // the body) too fine for the grid, where settling just crumples it: it
        // stays flat. Unless the crease is where two parts that don't blend
        // meet: flat, it would fill the crease in like a fillet.
        if (fieldGrad(pt, g) < 0 || unblended(pt)) settle(pt);
        split.set(k, grow.length / 3);
        grow.push(pt.x, pt.y, pt.z);
        if ((++made & 1023) === 0 && (await breathe())) return null;
      }
      const next: number[] = [];
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        const ab = split.get(key(a, b)) ?? -1, bc = split.get(key(b, c)) ?? -1, ca = split.get(key(c, a)) ?? -1;
        if (ab >= 0 && bc >= 0 && ca >= 0) next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
        else if (ab >= 0) next.push(a, ab, c, ab, b, c);
        else if (bc >= 0) next.push(b, bc, a, bc, c, a);
        else if (ca >= 0) next.push(c, ca, b, ca, a, b);
        else next.push(a, b, c);
      }
      unfold(grow, flat, next);
      tris = next;
    }
    verts = grow;
  }

  // a peeled skin stops where its blend into the other parts flattens out
  // onto their own surface: there it meets the skin that shows them. Next
  // to a part shown as its own mesh, it stops halfway across the join.
  if (opts.keep) {
    const keep = opts.keep;
    const kept: number[] = [];
    const c = new THREE.Vector3();
    for (let t = 0; t < tris.length; t += 3) {
      reached('keep', t / tris.length);
      c.set(0, 0, 0);
      for (let e = 0; e < 3; e++) c.x += verts[tris[t + e] * 3], c.y += verts[tris[t + e] * 3 + 1], c.z += verts[tris[t + e] * 3 + 2];
      c.divideScalar(3);
      let dk = Infinity, ik = -1, db = Infinity, ib = -1, de = Infinity;
      for (let i = 0; i < n; i++) {
        const pp = prepared[i];
        if (!pp.box.containsPoint(c)) continue;
        q.copy(c).applyMatrix4(pp.fromSkin);
        const d = exactDistance(pp.geo, pp.bvh, pp.normals, q, band, gp);
        if (!Number.isFinite(d)) continue;
        if (keep[i] === 1) {
          if (d < dk) (dk = d, ik = i);
        } else if (keep[i] === 0) {
          if (d < db) (db = d, ib = i);
        } else de = Math.min(de, d);
      }
      if (ik < 0 || de < dk) continue;
      if (ib < 0 || dk - db < Math.min(prepared[ik].k, prepared[ib].k)) kept.push(tris[t], tris[t + 1], tris[t + 2]);
      if ((t & 4095) === 0 && (await breathe())) return null;
    }
    if (!kept.length) return null;
    tris = kept;
  }

  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(tris);
  geo.computeVertexNormals();
  if (opts.lumps) {
    reached('lumps', 0);
    // lumps are as big all over, which a thin point can't take (they'd make
    // it bulge and kink): cap them at a fraction of how thick the skin is there
    const thick = await thicknessOf(geo);
    if (!thick) return null;
    // the very end of a point looks in along its whole length, so it goes by
    // its neighbours too (or it'd be lumped sideways into a little barb)
    const cap = thick.map((t) => 0.05 * t);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const m = 0.05 * Math.min(thick[a], thick[b], thick[c]);
      if (m < cap[a]) cap[a] = m;
      if (m < cap[b]) cap[b] = m;
      if (m < cap[c]) cap[c] = m;
    }
    // eyes sit on the smooth shape: lumps fade out under them
    if (opts.eyes?.length) {
      const P0 = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < P0.count; i++) {
        const x = P0.getX(i), y = P0.getY(i), z = P0.getZ(i);
        for (const e of opts.eyes) cap[i] *= lumpFade(Math.hypot(x - e.x, y - e.y, z - e.z), e.r);
      }
    }
    // pushed every which way, a tight crease's sides can fold over too
    // (lumps are gentle slopes: no face should turn more than ~45 degrees)
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const smooth = (P.array as Float32Array).slice();
    applyLumps(geo, opts.lumps, cap);
    unfold(P.array as Float32Array, smooth, tris, 0.7);
    geo.computeVertexNormals();
  }

  if (opts.lowPoly) {
    // each part's own facet size, where the skin passes through it (the finer one at joins)
    const fallback = Math.max(h * 3, ...prepared.map((pp) => pp.facet ?? 0));
    const sizeAt = (p: THREE.Vector3) => {
      let s = Infinity;
      for (const pp of prepared) if (pp.facet && pp.box.containsPoint(p)) s = Math.min(s, pp.facet);
      return Number.isFinite(s) ? s : fallback;
    };
    geo = facetize(geo, sizeAt);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
  }
  if (await breathe()) return null;

  // 5. where each vertex sat in the rest pose, so textures are laid out there
  // (and bend with the pose) rather than being projected onto today's pose.
  // Near a joint the parts' answers are blended, like skinning in reverse.
  if (parts.every((p) => p.toRest)) {
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const N = geo.getAttribute('normal') as THREE.BufferAttribute;
    const toRest = parts.map((p) => p.toRest!.clone().multiply(p.toSkin.clone().invert()));
    const turn = toRest.map((m) => new THREE.Matrix3().setFromMatrix4(m));
    const blendW = Math.max(kMax, 2 * h);
    const rp = new Float32Array(P.count * 3), rn = new Float32Array(P.count * 3);
    const ds = new Float32Array(prepared.length);
    const acc = new THREE.Vector3(), accN = new THREE.Vector3(), tmp = new THREE.Vector3(), nv = new THREE.Vector3();
    // measured once, out as far as painting the colors will want too (see fadeDistances)
    const fade = await fadeDistances(geo, parts, 0, Math.max(band, fadeReach(opts.colorBlend > 0 ? 2 * opts.colorBlend : 0.1)), (f) => (reached('rest', 0.9 * f), breathe()));
    if (!fade) return null;
    for (let v = 0; v < P.count; v++) {
      pt.fromBufferAttribute(P, v);
      nv.fromBufferAttribute(N, v);
      let dmin = Infinity, nearest = 0;
      ds.fill(Infinity);
      for (let e = fade.start[v]; e < fade.start[v + 1]; e++) {
        const i = fade.part[e];
        if (fade.d[e] >= band) continue;
        ds[i] = fade.d[e];
        if (ds[i] < dmin) {
          dmin = ds[i];
          nearest = i;
        }
      }
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      let wsum = 0;
      for (let i = 0; i < prepared.length; i++) {
        if (!Number.isFinite(ds[i])) continue;
        const w = Math.max(0, 1 - (ds[i] - dmin) / blendW) ** 2;
        if (w <= 0) continue;
        acc.addScaledVector(tmp.copy(pt).applyMatrix4(toRest[i]), w);
        accN.addScaledVector(tmp.copy(nv).applyMatrix3(turn[i]), w);
        wsum += w;
      }
      if (wsum <= 0) {
        acc.copy(pt).applyMatrix4(toRest[nearest]);
        accN.copy(nv).applyMatrix3(turn[nearest]);
        wsum = 1;
      }
      acc.divideScalar(wsum);
      accN.normalize();
      rp.set([acc.x, acc.y, acc.z], v * 3);
      rn.set([accN.x, accN.y, accN.z], v * 3);
    }
    geo.setAttribute('restPos', new THREE.BufferAttribute(rp, 3));
    geo.setAttribute('restNormal', new THREE.BufferAttribute(rn, 3));
  }
  geo.userData.painted = paintSkin(geo, parts, opts.colorBlend, opts.lowPoly);
  learnShares(began, sum);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

type Step = 'coarse' | 'fine' | 'nets' | 'settle' | 'subdivide' | 'keep' | 'lumps' | 'rest';
/** each step's share of a skin's build time (out of about 100), to start with as measured on a test creature */
const stepShares: Record<Step, number> = { coarse: 4, fine: 36, nets: 6, settle: 19, subdivide: 10, keep: 2, lumps: 5, rest: 18 };

/**
 * After a build, move each step's share part way towards what it really
 * took this time (`began`: when each step started), so the next build's
 * progress runs evenly on this computer, for these creatures. `sum`: the
 * shares of the steps it took, together.
 */
function learnShares(began: [Step, number][], sum: number) {
  const end = performance.now();
  const total = end - began[0]?.[1];
  if (!(total > 50)) return;
  began.forEach(([step, t], i) => {
    const took = (began[i + 1]?.[1] ?? end) - t;
    stepShares[step] += 0.4 * ((took / total) * sum - stepShares[step]);
  });
}

/**
 * Low-poly look for a smooth skin: merge the vertices in each cell of a grid
 * (cell = the local facet size) into one, and drop the triangles that
 * collapse. Vertices facing different ways never merge, so thin parts (a
 * wing's two sides) keep their thickness. The grid is turned off the axes so
 * the facets don't line up in rows.
 */
function facetize(src: THREE.BufferGeometry, sizeAt: (p: THREE.Vector3) => number): THREE.BufferGeometry {
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nor = src.getAttribute('normal') as THREE.BufferAttribute;
  const index = src.getIndex()!;
  const turn = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0.7, 0.4).normalize(), 0.61);
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const clusters = new Map<string, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  const remap = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    p.fromBufferAttribute(pos, v);
    const s = sizeAt(p);
    q.copy(p).applyMatrix4(turn);
    const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const facing = ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5;
    const key = `${s.toFixed(5)}|${Math.floor(q.x / s)}|${Math.floor(q.y / s)}|${Math.floor(q.z / s)}|${facing}`;
    let c = clusters.get(key);
    if (c === undefined) {
      c = counts.length;
      clusters.set(key, c);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[c * 3] += p.x;
    sums[c * 3 + 1] += p.y;
    sums[c * 3 + 2] += p.z;
    counts[c]++;
    remap[v] = c;
  }
  // Each cell's corner is its real surface vertex nearest the cell's average:
  // an average of points on a curved surface sits inside it, which would
  // shrink the creature a little everywhere.
  const out = new Float32Array(counts.length * 3);
  const best = new Float64Array(counts.length).fill(Infinity);
  for (let v = 0; v < pos.count; v++) {
    const c = remap[v];
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const d = (x - sums[c * 3] / counts[c]) ** 2 + (y - sums[c * 3 + 1] / counts[c]) ** 2 + (z - sums[c * 3 + 2] / counts[c]) ** 2;
    if (d >= best[c]) continue;
    best[c] = d;
    out[c * 3] = x;
    out[c * 3 + 1] = y;
    out[c * 3 + 2] = z;
  }
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = remap[index.getX(t)], b = remap[index.getX(t + 1)], c = remap[index.getX(t + 2)];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setIndex(tris);
  return g;
}

/**
 * Remove tiny disconnected pieces (a few stray triangles where the field
 * was ambiguous), keeping every real piece of the surface.
 */
function dropSpecks(index: number[], vertexCount: number): number[] {
  const parent = new Int32Array(vertexCount).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(index[t]), b = find(index[t + 1]), c = find(index[t + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const tris = new Map<number, number>();
  for (let t = 0; t < index.length; t += 3) {
    const r = find(index[t]);
    tris.set(r, (tris.get(r) ?? 0) + 1);
  }
  const largest = Math.max(...tris.values());
  const minTris = Math.max(24, largest * 0.01);
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    if ((tris.get(find(index[t])) ?? 0) >= minTris) out.push(index[t], index[t + 1], index[t + 2]);
  }
  return out;
}

interface FadeDistances {
  /** how far out they were measured */
  reach: number;
  /** vertex v's entries are start[v] .. start[v + 1] */
  start: Int32Array;
  part: Uint16Array;
  d: Float32Array;
}

/** How far out fadeDistances measures for a fade of `need`: a bit wider, up to the fade slider's top. */
const fadeReach = (need: number) => Math.max(need, Math.min(0.8, 2 * need));

/**
 * Each skin vertex's distance to every part near it, remembered on the skin
 * (measured a bit wider than needed), so moving the color-fade slider only
 * redoes the colors, not the distance queries. Distances are unsigned: a skin
 * vertex is on or outside every part, give or take a lump. With `breathe`
 * (while building a skin), it yields now and then, and null means abandoned.
 */
function fadeDistances(geo: THREE.BufferGeometry, parts: SkinPart[], need: number): FadeDistances;
function fadeDistances(geo: THREE.BufferGeometry, parts: SkinPart[], need: number, reach: number, breathe: (done: number) => Promise<boolean>): Promise<FadeDistances | null>;
function fadeDistances(geo: THREE.BufferGeometry, parts: SkinPart[], need: number, reach?: number, breathe?: (done: number) => Promise<boolean>): FadeDistances | Promise<FadeDistances | null> {
  const cached = geo.userData.fade as FadeDistances | undefined;
  if (!breathe) {
    if (cached && cached.reach >= need) return cached;
    const gen = measureFade(geo, parts, fadeReach(need));
    for (let r = gen.next(); ; r = gen.next()) if (r.done) return r.value;
  }
  return (async () => {
    const gen = measureFade(geo, parts, reach!);
    for (let r = gen.next(); ; r = gen.next()) {
      if (r.done) return r.value;
      if (await breathe(r.value)) return null;
    }
  })();
}

/** fadeDistances' measuring, pausing every so often (yielding how far along it is). */
function* measureFade(geo: THREE.BufferGeometry, parts: SkinPart[], reach: number): Generator<number, FadeDistances> {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const prepared = parts.map((p) => ({
    p,
    bvh: bvhFor(p.geo),
    normals: sharedNormals(p.geo),
    fromSkin: p.toSkin.clone().invert(),
    box: p.geo.boundingBox!.clone().applyMatrix4(p.toSkin).expandByScalar(reach),
  }));
  const start = new Int32Array(pos.count + 1);
  const part: number[] = [];
  const dist: number[] = [];
  const pt = new THREE.Vector3(), q = new THREE.Vector3(), grad = new THREE.Vector3();
  for (let v = 0; v < pos.count; v++) {
    start[v] = part.length;
    pt.fromBufferAttribute(pos, v);
    for (let i = 0; i < prepared.length; i++) {
      const pp = prepared[i];
      if (!pp.box.containsPoint(pt)) continue;
      q.copy(pt).applyMatrix4(pp.fromSkin);
      const d = exactDistance(pp.p.geo, pp.bvh, pp.normals, q, reach, grad, false);
      if (!Number.isFinite(d)) continue;
      part.push(i);
      dist.push(d);
    }
    if ((v & 1023) === 1023) yield v / pos.count;
  }
  start[pos.count] = part.length;
  const out = { reach, start, part: Uint16Array.from(part), d: Float32Array.from(dist) };
  geo.userData.fade = out;
  return out;
}

/**
 * (Re)color a skin: blended part colors near the seams (when blending and
 * the colors differ) and per-facet shading for low-poly. Returns whether
 * colors were baked in (the material should then be white). Cheap next to a
 * rebuild, so a color-only change repaints the existing skin.
 */
export function paintSkin(geo: THREE.BufferGeometry, parts: SkinPart[], colorBlend: number, lowPoly: boolean): boolean {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  paintGlow(geo, parts, colorBlend);
  const blend = colorBlend > 0 && parts.some((p) => !p.color.equals(parts[0].color));
  if (!blend && !lowPoly) {
    if (geo.getAttribute('color')) geo.deleteAttribute('color');
    return false;
  }
  const colors = new Float32Array(n * 3).fill(1);

  if (blend) {
    const kc = colorBlend;
    const fade = fadeDistances(geo, parts, 2 * kc);
    const c = new THREE.Color();
    for (let v = 0; v < n; v++) {
      let wsum = 0;
      c.setRGB(0, 0, 0);
      let nearest = 0, nearestD = Infinity;
      for (let e = fade.start[v]; e < fade.start[v + 1]; e++) {
        const d = fade.d[e];
        if (d >= 2 * kc) continue;
        const pc = parts[fade.part[e]].color;
        if (d < nearestD) {
          nearestD = d;
          nearest = fade.part[e];
        }
        // 50/50 where two parts are equally close, each part's own color away from the seam
        const w = 1 / (Math.max(d, 0) + 0.25 * kc) ** 2;
        c.r += pc.r * w;
        c.g += pc.g * w;
        c.b += pc.b * w;
        wsum += w;
      }
      if (wsum > 0) c.multiplyScalar(1 / wsum);
      else c.copy(parts[nearest].color);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
  }

  if (lowPoly) {
    // per-facet shade variation, multiplied into any blended color
    for (let f = 0; f < n; f += 3) {
      const k = 0.9 + ((((Math.sin(f * 12.9898) * 43758.5453) % 1) + 1) % 1) * 0.14;
      for (let j = 0; j < 9 && f * 3 + j < colors.length; j++) colors[f * 3 + j] *= k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return blend;
}

/**
 * Where a skin's parts glow differently, how much each point glows (a `glow`
 * attribute): faded across the seams like the colors when they blend, else
 * each point glowing as the part it's on. Removed when they all glow alike.
 */
function paintGlow(geo: THREE.BufferGeometry, parts: SkinPart[], colorBlend: number) {
  const glow = (p: SkinPart) => p.glow ?? 0;
  if (parts.every((p) => glow(p) === glow(parts[0]))) {
    if (geo.getAttribute('glow')) geo.deleteAttribute('glow');
    return;
  }
  const n = geo.getAttribute('position').count;
  const out = new Float32Array(n);
  const kc = colorBlend;
  // with no fade, just near enough to tell which part a point is on (fillets included)
  const fade = fadeDistances(geo, parts, kc > 0 ? 2 * kc : 0.1);
  for (let v = 0; v < n; v++) {
    let wsum = 0, g = 0;
    let nearest = 0, nearestD = Infinity;
    for (let e = fade.start[v]; e < fade.start[v + 1]; e++) {
      const d = fade.d[e];
      if (d < nearestD) {
        nearestD = d;
        nearest = fade.part[e];
      }
      if (kc <= 0 || d >= 2 * kc) continue;
      const w = 1 / (Math.max(d, 0) + 0.25 * kc) ** 2;
      g += glow(parts[fade.part[e]]) * w;
      wsum += w;
    }
    out[v] = wsum > 0 ? g / wsum : glow(parts[nearest]);
  }
  geo.setAttribute('glow', new THREE.BufferAttribute(out, 1));
}
