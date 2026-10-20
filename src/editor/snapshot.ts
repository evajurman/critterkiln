// ---------------------------------------------------------------------------
// Pictures and exports: a screenshot (with a transparent background if asked)
// and the glTF export.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { unlock } from '../achievements';
import { safeFileName } from '../stuff';
import { $ } from './dom';
import { canvas, hemi, scene, shadowMat } from './stage';
import { neutralTone, refreshFloorColors, tintForBackdrop } from './floor';
import { composer } from './post';
import { creature, creatures } from './state';
import { handlesVisible } from './controls';
import { gizmo } from './attach';
import { sceneFileName } from './files';
import { hint } from './hints';
import { invalidate } from './loop';
import { animViz } from './animateTab';

/** Render one clean frame without handles or guides, then restore. */
export function withCleanScene<T>(fn: () => T): T {
  const skel = handlesVisible();
  const helper = gizmo.getHelper();
  const gizmoShown = helper.visible;
  // the Animate tab's drawn motion path and its handles
  const pathShown = animViz.visible;
  creature.setSkeletonVisible(false);
  creature.flash(null, 0);
  helper.visible = false;
  animViz.visible = false;
  try {
    return fn();
  } finally {
    creature.setSkeletonVisible(skel);
    helper.visible = gizmoShown;
    animViz.visible = pathShown;
  }
}

/** The frame just rendered, as pixels. */
function grabFrame(): ImageData {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * A photo with no backdrop. The scene is rendered over black and over grey:
 * whatever changed between the two is see-through by that much, so soft edges,
 * fuzz and floor shadows keep their partial transparency. The sums are done in
 * linear light (blending happens there, not in the picture's sRGB), and the
 * grey is mid-range, where tone mapping is close to a straight line.
 */
function transparentShot(): string {
  const background = scene.background;
  // shadows are normally tinted toward the backdrop; with no backdrop, keep them neutral
  const shadowColor = shadowMat.color.clone();
  const groundColor = hemi.groundColor.clone();
  tintForBackdrop(new THREE.Color('#ffffff'));
  const render = (c: THREE.Color) => {
    scene.background = c;
    refreshFloorColors();
    composer.render();
    return grabFrame();
  };
  const GREY = 0.5;
  const greyOut = neutralTone([GREY, GREY, GREY])[0];
  const toLinear = Array.from({ length: 256 }, (_, v) => {
    const s = v / 255;
    return s < 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  try {
    const black = render(new THREE.Color(0, 0, 0));
    const grey = render(new THREE.Color(GREY, GREY, GREY));
    const b = black.data;
    const g = grey.data;
    const c = new THREE.Color();
    for (let i = 0; i < b.length; i += 4) {
      const lb = [toLinear[b[i]], toLinear[b[i + 1]], toLinear[b[i + 2]]];
      const lg = [toLinear[g[i]], toLinear[g[i + 1]], toLinear[g[i + 2]]];
      const seen = Math.max(lg[0] - lb[0], lg[1] - lb[1], lg[2] - lb[2]) / greyOut;
      const a = Math.min(1, Math.max(0, 1 - seen));
      // over black, color = alpha * own color: undo that
      if (a > 0) c.setRGB(lb[0] / a, lb[1] / a, lb[2] / a).convertLinearToSRGB();
      b[i] = Math.min(255, Math.round(c.r * 255));
      b[i + 1] = Math.min(255, Math.round(c.g * 255));
      b[i + 2] = Math.min(255, Math.round(c.b * 255));
      b[i + 3] = Math.round(a * 255);
    }
    const out = document.createElement('canvas');
    out.width = black.width;
    out.height = black.height;
    out.getContext('2d')!.putImageData(black, 0, 0);
    return out.toDataURL('image/png');
  } finally {
    scene.background = background;
    shadowMat.color.copy(shadowColor);
    hemi.groundColor.copy(groundColor);
    refreshFloorColors();
    invalidate();
  }
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

export function initSnapshot() {
  $('#shot').onclick = () => {
    const clear = $<HTMLInputElement>('#shot-clear').checked;
    const url = withCleanScene(() => {
      if (clear) return transparentShot();
      composer.render();
      return canvas.toDataURL('image/png');
    });
    // named after who's in the scene
    const name = sceneFileName();
    download(url, `${safeFileName(name, 'creature')}.png`);
    unlock('photo');
    if (clear) unlock('clear-photo');
  };
  $('#export').onclick = () => {
    unlock('glb');
    const inks: THREE.Object3D[] = [];
    const roots = creatures.map((c) => c.root);
    for (const root of roots) {
      root.traverse((o) => {
        // ink hulls and felt fuzz are render-only effects; they don't belong in the model file
        const ink = o instanceof THREE.Mesh && (o.material as THREE.Material).userData?.ink;
        if ((ink || o.userData.fx) && o.visible) inks.push(o);
      });
    }
    withCleanScene(() => {
      inks.forEach((o) => (o.visible = false));
      new GLTFExporter().parse(
        // every creature in the scene, each at its placement
        roots,
        (result) => {
          inks.forEach((o) => (o.visible = true));
          const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          download(url, 'creature.glb');
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        },
        (err) => {
          inks.forEach((o) => (o.visible = true));
          console.error(err);
          hint('Export failed, sorry!', 2500, true);
        },
        { binary: true, onlyVisible: true },
      );
    });
  };
}
