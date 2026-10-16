import type * as THREE from 'three';
import { distanceGrid } from './distance';

/**
 * Distance grids (see DistanceGrid) kept in the browser between visits. A
 * part's grid only depends on its shape, so it's saved by a hash of the shape
 * and whatever has been measured is there next time: opening a creature
 * again, or posing it somewhere new, measures nothing it measured before.
 * Kept to a budget, the least recently used going first. Anything that goes
 * wrong (no storage, private browsing, quota) just means measuring again.
 */

const DB = 'critterkiln-grids';
/** about how much may be kept, in bytes */
const BUDGET = 200e6;

let opened: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('grids');
        // what each one weighs and when it was last used, to keep to the budget without reading the grids
        req.result.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

const done = <T>(req: IDBRequest<T>) => new Promise<T | undefined>((r) => ((req.onsuccess = () => r(req.result)), (req.onerror = () => r(undefined))));

const hashes = new WeakMap<THREE.BufferGeometry, string>();
/** A hash of the shape itself (its points and triangles): the same shape hashes the same in every visit. */
function shapeHash(geo: THREE.BufferGeometry): string {
  let h = hashes.get(geo);
  if (h) return h;
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  const mix = (arr: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => {
    const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2);
    for (let i = 0; i < u.length; i++) {
      a = Math.imul(a ^ u[i], 0x01000193);
      b = Math.imul(b ^ u[i], 0x5bd1e995) ^ (b >>> 15);
    }
  };
  mix(geo.getAttribute('position').array as Float32Array);
  if (geo.index) mix(geo.index.array as Uint32Array | Uint16Array);
  h = (a >>> 0).toString(36) + (b >>> 0).toString(36) + ':' + geo.getAttribute('position').count;
  hashes.set(geo, h);
  return h;
}
const keyOf = (geo: THREE.BufferGeometry, s: number, band: number) => `${shapeHash(geo)}|${s.toFixed(6)}|${band.toFixed(6)}`;

/** what's been fetched this visit (no need to look again) */
const fetched = new Set<string>();

/** Fetch these shapes' saved grids (spacing `s`, out to `band`) into memory, where there are any. */
export async function loadGrids(geos: THREE.BufferGeometry[], s: number, band: number): Promise<void> {
  const d = await db();
  if (!d) return;
  await Promise.all(
    [...new Set(geos)].map(async (geo) => {
      const key = keyOf(geo, s, band);
      if (fetched.has(key)) return;
      fetched.add(key);
      try {
        const saved = await done(d.transaction('grids').objectStore('grids').get(key));
        if (!saved) return;
        distanceGrid(geo, s, band).load(saved as { keys: Int32Array; values: Float32Array });
        const tx = d.transaction('meta', 'readwrite');
        const meta = await done(tx.objectStore('meta').get(key));
        if (meta) tx.objectStore('meta').put({ ...(meta as object), used: Date.now() }, key);
      } catch {
        // measured again instead
      }
    }),
  );
}

/** Keep whatever these shapes' grids have measured since they were last kept. */
export async function saveGrids(geos: THREE.BufferGeometry[], s: number, band: number): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    for (const geo of new Set(geos)) {
      const grid = distanceGrid(geo, s, band);
      if (!grid.fresh) continue;
      grid.fresh = 0;
      const key = keyOf(geo, s, band);
      fetched.add(key);
      const dump = grid.dump();
      const tx = d.transaction(['grids', 'meta'], 'readwrite');
      tx.objectStore('grids').put(dump, key);
      tx.objectStore('meta').put({ used: Date.now(), bytes: dump.values.byteLength + dump.keys.byteLength }, key);
      await new Promise((r) => ((tx.oncomplete = r), (tx.onerror = tx.onabort = r)));
    }
    await prune(d);
  } catch {
    // not kept: measured again next time
  }
}

/** Down to the budget, least recently used first. */
async function prune(d: IDBDatabase) {
  const tx = d.transaction('meta');
  const store = tx.objectStore('meta');
  const [keys, metas] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
  if (!keys || !metas) return;
  const all = keys.map((k, i) => ({ key: k as string, ...(metas[i] as { used: number; bytes: number }) })).sort((a, b) => a.used - b.used);
  let total = all.reduce((n, m) => n + m.bytes, 0);
  if (total <= BUDGET) return;
  const del = d.transaction(['grids', 'meta'], 'readwrite');
  for (const m of all) {
    if (total <= BUDGET * 0.8) break;
    del.objectStore('grids').delete(m.key);
    del.objectStore('meta').delete(m.key);
    total -= m.bytes;
  }
}
