// ---------------------------------------------------------------------------
// Markings: patterns over the material (see src/markings.ts and the panel in
// src/markingPanel.ts), on the whole creature or one part. The same panel
// marks stuff pieces on the workbench (see pieceMarks).

import * as THREE from 'three';
import { markingsOf } from '../creature';
import { bounds } from '../inflate';
import { placeMatrix } from '../stuff';
import { onMarkingTexture } from '../markings';
import { MarkingPanel, initMarkingTools } from '../markingPanel';
import { $ } from './dom';
import { canvas, scene, view } from './stage';
import { mirror } from './floor';
import { commit, creature, mode, selected, state } from './state';
import { raycaster, setRay, updateSkeletonVisibility } from './controls';
import { drawState, spacePan } from './drawing';
import { bench, piece, refreshPieceGizmo, renderScatterThing, selectedPiece, shareThing, syncTwin, syncWorkbench, workbench } from './workbench';
import { wornPieces } from './attachPanel';
import { scopeOf } from './scope';
import { deselectAttachment, gizmo, selectedAttachment } from './attach';
import { stopPlacing } from './arrange';
import { partGlowFollow, wholeFor } from './partPanel';
import { hint, hintOnce } from './hints';
import { invalidate } from './loop';
import { rayAt } from './animateTab';

export function selPartId(): string {
  return creature.bones.get(selected)!.src;
}

/** The creature's markings, by part. */
let partMarks: MarkingPanel;

export function renderMarkings() {
  // worn pieces picked: Look marks them (on Everything, or with every piece picked, the whole thing)
  const w = wornPieces();
  if (w) {
    wornMarks.all = scopeOf('markings') === 'all' || w.pieces.length >= w.thing.pieces.length;
    wornMarks.render();
    return;
  }
  // on Everything (or with every part picked), new markings go over the whole creature; otherwise on the picked part
  partMarks.all = wholeFor('markings');
  partMarks.render();
}

/** A worn thing's markings, by piece, in Look (see wornPieces). */
let wornMarks: MarkingPanel;

/** The workbench thing's markings, by piece. */
export let pieceMarks: MarkingPanel;

/** What every part's material draws (scatters aside): only a change to it re-blends the joins. */
let paintedKey = '';
function paintedMarks(): string {
  return JSON.stringify(Object.keys(state.parts).map((id) => markingsOf(state, id)));
}

export function initMarkingsUi() {

  initMarkingTools({
    gizmo,
    scene,
    canvas,
    view: () => view,
    rayAt: (x, y) => {
      setRay(x, y);
      return raycaster;
    },
    invalidate: () => invalidate(),
    commit: () => commit(),
    hint: (text, ms, warn) => hint(text, ms, warn),
    hintOnce: (text, ms) => hintOnce(text, ms),
    takeOver: () => {
      stopPlacing();
      if (selectedAttachment) deselectAttachment();
    },
    toolsChanged: () => {
      updateSkeletonVisibility();
      if (mode === 'stuff') refreshPieceGizmo();
    },
    busy: () => spacePan || !!drawState,
  });
  // a picture loading or a font arriving redraws whatever shows it
  onMarkingTexture(() => invalidate());
  partMarks = new MarkingPanel(
    {
      unit: 'part',
      whole: 'creature',
      picked: () => (mode !== 'stuff' && !wornPieces() && creature.bones.has(selected) ? selPartId() : null),
      units: () => Object.keys(state.parts),
      wholeMarkings: () => state.markings,
      ownMarkings: (id) => state.parts[id]?.markings,
      setWhole: (list) => {
        if (list.length) state.markings = list;
        else delete state.markings;
      },
      setOwn: (id, list) => {
        const p = state.parts[id];
        if (!p) return;
        if (list.length) p.markings = list;
        else delete p.markings;
      },
      pictures: () => state.pictures,
      setPictures: (p) => {
        if (p) state.pictures = p;
        else delete state.pictures;
      },
      colorOf: (id) => state.parts[id]?.color ?? '#808080',
      changed: (doCommit) => {
        // glowing from the markings needs some markings
        for (const [id, p] of Object.entries(state.parts)) if (p.glowFollow === 'markings' && !markingsOf(state, id).length) delete p.glowFollow;
        creature.sync();
        // (a scatter's copies are their own: the skin stays as it is)
        const key = paintedMarks();
        if (key !== paintedKey) creature.markMergeDirty();
        paintedKey = key;
        if (doCommit) commit();
        partGlowFollow();
      },
      scatterThing: (el, m, set) => renderScatterThing(el, m, set),
      // markings are laid out in the rest pose: shown on the picked part as it's posed now
      frame: () => {
        const b = creature.bones.get(selected);
        if (!b) return null;
        creature.root.updateMatrixWorld(true);
        return { toWorld: b.pivot.matrixWorld.clone().multiply(b.restGroup.clone().invert()), middle: new THREE.Vector3(0, b.length / 2, 0).applyMatrix4(b.restGroup) };
      },
      surface: (ray) => {
        const hit = creature.surfaceAt(ray);
        if (!hit) return null;
        const b = hit.bone;
        return { point: hit.point, at: hit.point.clone().applyMatrix4(b.pivot.matrixWorld.clone().invert()).applyMatrix4(b.restGroup) };
      },
      // (the skeleton's two sides mirror across X, as pairs of parts do)
      mirror: (v) => v.setX(-v.x),
    },
    { list: $('#markings'), params: $('#marking-params') },
  );
  pieceMarks = new MarkingPanel(
    {
      unit: 'piece',
      whole: 'thing',
      picked: () => (mode === 'stuff' && piece() ? selectedPiece : null),
      units: () => workbench().pieces.map((p) => p.id),
      wholeMarkings: () => workbench().markings,
      ownMarkings: (id) => workbench().pieces.find((p) => p.id === id)?.markings,
      setWhole: (list) => {
        const wb = workbench();
        if (list.length) wb.markings = list;
        else delete wb.markings;
      },
      setOwn: (id, list) => {
        const p = workbench().pieces.find((q) => q.id === id);
        if (!p) return;
        if (list.length) p.markings = list;
        else delete p.markings;
        // (a mirrored piece's other side has them too)
        syncTwin(p);
      },
      pictures: () => workbench().pictures,
      setPictures: (p) => {
        const wb = workbench();
        if (p) wb.pictures = p;
        else delete wb.pictures;
      },
      colorOf: (id) => workbench().pieces.find((p) => p.id === id)?.color ?? '#808080',
      changed: (doCommit) => {
        syncWorkbench();
        invalidate();
        if (doCommit) commit();
      },
      // laid out in the thing's own space: the board's
      frame: () => {
        const p = piece();
        if (!p || !bench) return null;
        bench.updateMatrixWorld(true);
        const b = bounds(p.outline);
        return { toWorld: bench.matrixWorld.clone(), middle: new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, p.z).applyMatrix4(placeMatrix(p)) };
      },
      surface: (ray) => {
        if (!bench) return null;
        const hit = ray.intersectObject(bench, true)[0];
        if (!hit) return null;
        return { point: hit.point, at: hit.point.clone().applyMatrix4(bench.matrixWorld.clone().invert()) };
      },
      // across the centre line, as Mirror makes pieces
      mirror: (v) => v.setX(-v.x),
    },
    { list: $('#piece-markings'), params: $('#piece-marking-params') },
  );
  // the same, on a worn thing's pieces where it's worn: what's changed is changed everywhere it is
  const worn = () => wornPieces();
  const wornThing = () => worn()?.thing;
  const wornObj = () => {
    const w = worn();
    return w ? creature.attachmentObject(w.a.id) : null;
  };
  wornMarks = new MarkingPanel(
    {
      unit: 'piece',
      whole: 'thing',
      picked: () => (mode !== 'stuff' ? (worn()?.pieces[0].id ?? null) : null),
      units: () => wornThing()?.pieces.map((p) => p.id) ?? [],
      wholeMarkings: () => wornThing()?.markings,
      ownMarkings: (id) => wornThing()?.pieces.find((p) => p.id === id)?.markings,
      setWhole: (list) => {
        const t = wornThing();
        if (!t) return;
        if (list.length) t.markings = list;
        else delete t.markings;
      },
      setOwn: (id, list) => {
        const t = wornThing();
        const p = t?.pieces.find((q) => q.id === id);
        if (!t || !p) return;
        // (a mirrored piece's other side has them too)
        const twin = p.twin ? t.pieces.find((q) => q.id === p.twin) : undefined;
        for (const q of twin ? [p, twin] : [p]) {
          if (list.length) q.markings = structuredClone(list);
          else delete q.markings;
        }
      },
      pictures: () => wornThing()?.pictures,
      setPictures: (pics) => {
        const t = wornThing();
        if (!t) return;
        if (pics) t.pictures = pics;
        else delete t.pictures;
      },
      colorOf: (id) => wornThing()?.pieces.find((p) => p.id === id)?.color ?? '#808080',
      changed: (doCommit) => {
        creature.sync();
        invalidate();
        if (!doCommit) return;
        const t = wornThing();
        if (t) shareThing(t);
        commit();
      },
      // laid out in the thing's own space, as it's worn now
      frame: () => {
        const w = worn();
        const obj = wornObj();
        if (!w || !obj) return null;
        obj.updateMatrixWorld(true);
        const p = w.pieces[0];
        const b = bounds(p.outline);
        return { toWorld: obj.matrixWorld.clone(), middle: new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, p.z).applyMatrix4(placeMatrix(p)) };
      },
      surface: (ray) => {
        const obj = wornObj();
        if (!obj) return null;
        const hit = ray.intersectObject(obj, true)[0];
        if (!hit) return null;
        return { point: hit.point, at: hit.point.clone().applyMatrix4(obj.matrixWorld.clone().invert()) };
      },
      mirror: (v) => v.setX(-v.x),
    },
    { list: $('#markings'), params: $('#marking-params') },
  );
}
