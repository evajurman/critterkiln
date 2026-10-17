import * as THREE from 'three';
import { loadGrids, saveGrids } from './gridStore';
import { skinGrids, type SkinPart } from './skin';
import { buildJoin } from './filletSkin';
import type { SkinJob, SkinProgress, SkinReply } from './skinPool';

/**
 * Builds seamless skins off the page's own thread (see skinPool). Each worker
 * keeps the part shapes it's been sent, by id, so their distance grids (see
 * DistanceGrid) carry over from one build to the next as the creature is posed.
 */

const geos = new Map<string, THREE.BufferGeometry>();
const cancelled = new Set<number>();

function geometry(id: string, g: SkinJob['geos'][string] | undefined): THREE.BufferGeometry {
  let geo = geos.get(id);
  if (geo) {
    // most recently used last
    geos.delete(id);
    geos.set(id, geo);
    return geo;
  }
  if (!g) throw new Error(`skin worker: no shape ${id}`);
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  if (g.index) geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  geos.set(id, geo);
  // shapes from edits long gone: let them (and their grids) go
  while (geos.size > 96) geos.delete(geos.keys().next().value!);
  return geo;
}

self.onmessage = async (e: MessageEvent<SkinJob | { cancel: number }>) => {
  const msg = e.data;
  if ('cancel' in msg) {
    cancelled.add(msg.cancel);
    return;
  }
  const { id, opts } = msg;
  let lastSent = 0;
  try {
    const parts: SkinPart[] = msg.parts.map((p) => ({
      geo: geometry(p.geo, msg.geos[p.geo]),
      toSkin: new THREE.Matrix4().fromArray(p.toSkin),
      toRest: p.toRest ? new THREE.Matrix4().fromArray(p.toRest) : undefined,
      color: new THREE.Color(p.color[0], p.color[1], p.color[2]),
      glow: p.glow,
      k: p.k,
      facet: p.facet,
    }));
    const n = parts.length;
    const link = opts.linked;
    // the parts' distance grids, as far as they were measured on earlier visits
    const grids = skinGrids(parts, opts.h);
    const shapes = parts.map((p) => p.geo);
    await loadGrids(shapes, grids.s, grids.band);
    const geo = await buildJoin(parts, {
      h: opts.h,
      colorBlend: opts.colorBlend,
      lowPoly: opts.lowPoly,
      lumps: opts.lumps,
      eyes: opts.eyes,
      keep: opts.keep,
      method: opts.method,
      linked: link ? (a, b) => link[a * n + b] === 1 : undefined,
      shouldStop: () => cancelled.has(id),
      // how far along, now and then
      progress: (done) => {
        const now = performance.now();
        if (now - lastSent < 100) return;
        lastSent = now;
        self.postMessage({ id, progress: done } satisfies SkinProgress);
      },
    });
    cancelled.delete(id);
    if (!geo) {
      self.postMessage({ id, geo: null } satisfies SkinReply);
      return;
    }
    const attrs: Record<string, { array: Float32Array; itemSize: number }> = {};
    for (const [name, a] of Object.entries(geo.attributes)) attrs[name] = { array: (a as THREE.BufferAttribute).array as Float32Array, itemSize: a.itemSize };
    const index = geo.index ? Uint32Array.from(geo.index.array) : null;
    const fade = geo.userData.fade as SkinReply['fade'];
    const out: SkinReply = { id, geo: { attrs, index }, painted: !!geo.userData.painted, fade };
    const transfer: Transferable[] = Object.values(attrs).map((a) => a.array.buffer as ArrayBuffer);
    if (index) transfer.push(index.buffer);
    if (fade) transfer.push(fade.start.buffer, fade.part.buffer, fade.d.buffer);
    self.postMessage(out, { transfer: [...new Set(transfer)] });
    // keep what was measured for next time (after the skin's on its way)
    void saveGrids(shapes, grids.s, grids.band);
  } catch (err) {
    cancelled.delete(id);
    self.postMessage({ id, geo: null, error: String((err as Error)?.stack ?? err) } satisfies SkinReply);
  }
};
