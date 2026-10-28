// ---------------------------------------------------------------------------
// Markings: patterns over the material (see src/markings.ts and the panel in
// src/markingPanel.ts), on the whole creature or one part.

import * as THREE from 'three';
import { markingsOf } from '../creature';
import { onMarkingTexture } from '../markings';
import { MarkingPanel, initMarkingTools } from '../markingPanel';
import { $ } from './dom';
import { canvas, scene, view } from './stage';
import { commit, creature, selected, state } from './state';
import { raycaster, setRay, updateSkeletonVisibility } from './controls';
import { drawState, spacePan } from './drawing';
import { renderScatterSource } from './scatterSource';
import { gizmo } from './gizmo';
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
  // on Everything (or with every part picked), new markings go over the whole creature; otherwise on the picked part
  partMarks.all = wholeFor('markings');
  partMarks.render();
}

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
    },
    toolsChanged: () => {
      updateSkeletonVisibility();
    },
    busy: () => spacePan || !!drawState,
  });
  // a picture loading or a font arriving redraws whatever shows it
  onMarkingTexture(() => invalidate());
  partMarks = new MarkingPanel(
    {
      unit: 'part',
      whole: 'creature',
      picked: () => (creature.bones.has(selected) ? selPartId() : null),
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
      scatterThing: (el, m, set) => renderScatterSource(el, m, set),
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
}
