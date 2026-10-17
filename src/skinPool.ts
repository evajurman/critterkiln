import * as THREE from 'three';
import { type SkinOptions, type SkinPart } from './skin';
import { buildJoin } from './filletSkin';

/**
 * Seamless skins built on worker threads (see skinWorker): the page stays
 * smooth while they build, and a creature's separate skins build side by
 * side. Each skin goes to the same worker every time (by its `lane`), where
 * its parts' distance grids are still warm from the last build. Without
 * workers, skins are built here as before.
 */

export interface SkinJob {
  id: number;
  parts: { geo: string; toSkin: number[]; toRest?: number[]; color: [number, number, number]; glow?: number; k: number; facet?: number }[];
  /** the parts' shapes, by id (a worker keeps the ones it has already been sent) */
  geos: Record<string, { position: Float32Array; normal: Float32Array; index: Uint32Array | Uint16Array | null }>;
  opts: Omit<SkinOptions, 'shouldStop' | 'linked'> & { linked?: Uint8Array };
}

export interface SkinReply {
  id: number;
  geo: { attrs: Record<string, { array: Float32Array; itemSize: number }>; index: Uint32Array | null } | null;
  painted?: boolean;
  fade?: { reach: number; start: Int32Array; part: Uint16Array; d: Float32Array };
  error?: string;
}

/** a build's progress so far (0..1), sent now and then while it runs */
export interface SkinProgress {
  id: number;
  progress: number;
}

interface Lane {
  worker: Worker;
  /** shapes this worker has been sent (it keeps them; see skinWorker) */
  sent: WeakSet<THREE.BufferGeometry>;
  waiting: Map<number, (r: SkinReply) => void>;
  progress: Map<number, (done: number) => void>;
}

let lanes: Lane[] | null = null;
let nextId = 1;

function pool(): Lane[] {
  if (lanes) return lanes;
  lanes = [];
  if (typeof Worker === 'undefined') return lanes;
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  try {
    for (let i = 0; i < n; i++) {
      const worker = new Worker(new URL('./skinWorker.ts', import.meta.url), { type: 'module' });
      const lane: Lane = { worker, sent: new WeakSet(), waiting: new Map(), progress: new Map() };
      worker.onmessage = (e: MessageEvent<SkinReply | SkinProgress>) => {
        const msg = e.data;
        if ('progress' in msg) {
          lane.progress.get(msg.id)?.(msg.progress);
          return;
        }
        const done = lane.waiting.get(msg.id);
        lane.waiting.delete(msg.id);
        lane.progress.delete(msg.id);
        done?.(msg);
      };
      lanes.push(lane);
    }
  } catch {
    for (const l of lanes) l.worker.terminate();
    lanes = [];
  }
  return lanes;
}

/** Which worker a skin with this `lane` builds on (skins on the same one build one after another). */
export function laneOf(key: string): number {
  const l = laneFor(key);
  return l ? lanes!.indexOf(l) : 0;
}

function laneFor(key: string): Lane | undefined {
  const ls = pool();
  if (!ls.length) return undefined;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ls[Math.abs(hash) % ls.length];
}

/** Build a skin (see buildSkin) on the worker for `lane`, or here if there are no workers. */
export async function buildSkinOff(parts: SkinPart[], opts: SkinOptions, lane: string): Promise<THREE.BufferGeometry | null> {
  const l = laneFor(lane);
  if (!l) return buildJoin(parts, opts);
  let reply = await send(l, parts, opts);
  if (reply.error?.includes('no shape')) {
    // the worker let some shapes go meanwhile: send them all again
    l.sent = new WeakSet();
    reply = await send(l, parts, opts);
  }
  if (reply.error) console.warn('seamless skin worker:', reply.error);
  if (!reply.geo) return null;
  const geo = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(reply.geo.attrs)) geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize));
  if (reply.geo.index) geo.setIndex(new THREE.BufferAttribute(reply.geo.index, 1));
  geo.userData.painted = reply.painted;
  // each vertex's distances to the parts, so a color change repaints without measuring again
  if (reply.fade) geo.userData.fade = reply.fade;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function send(l: Lane, parts: SkinPart[], opts: SkinOptions): Promise<SkinReply> {
  const id = nextId++;
  const geos: SkinJob['geos'] = {};
  for (const p of parts) {
    if (l.sent.has(p.geo) || geos[p.geo.uuid]) continue;
    if (!p.geo.getAttribute('normal')) p.geo.computeVertexNormals();
    geos[p.geo.uuid] = {
      position: (p.geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array,
      normal: (p.geo.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array,
      index: (p.geo.index?.array as Uint32Array | Uint16Array | undefined) ?? null,
    };
  }
  const n = parts.length;
  let linked: Uint8Array | undefined;
  if (opts.linked) {
    linked = new Uint8Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) linked[a * n + b] = a !== b && opts.linked(a, b) ? 1 : 0;
  }
  const job: SkinJob = {
    id,
    parts: parts.map((p) => ({
      geo: p.geo.uuid,
      toSkin: p.toSkin.toArray(),
      toRest: p.toRest?.toArray(),
      color: [p.color.r, p.color.g, p.color.b],
      glow: p.glow,
      k: p.k,
      facet: p.facet,
    })),
    geos,
    opts: { h: opts.h, colorBlend: opts.colorBlend, lowPoly: opts.lowPoly, lumps: opts.lumps, eyes: opts.eyes, keep: opts.keep, method: opts.method, linked },
  };
  return new Promise<SkinReply>((resolve) => {
    l.waiting.set(id, resolve);
    if (opts.progress) l.progress.set(id, opts.progress);
    l.worker.postMessage(job);
    for (const p of parts) l.sent.add(p.geo);
    // abandoned here: tell the worker to stop too
    const watch = setInterval(() => {
      if (!l.waiting.has(id)) clearInterval(watch);
      else if (opts.shouldStop()) {
        clearInterval(watch);
        l.worker.postMessage({ cancel: id });
      }
    }, 50);
  });
}
