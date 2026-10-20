import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { $, faClassic, iconLabel } from './dom';
import { renderer, scene } from './stage';
import { composer } from './post';
import { creatures, state, world } from './state';
import { hint } from './hints';
import { invalidate } from './loop';
import { animKey, animPlaying, animSecs, animT, animViz, renderAnim, setAnimKey, setAnimPlaying, setAnimT, showAnimAt } from './animateTab';

// ---- rendering one loop out as a GIF ----
//
// Not a live recording: each frame is posed, then waits for its joins to finish
// fusing (and, with Seamless, for the seamless skin to be built) before it's
// drawn, so nothing is caught half-blended. Exactly 25 frames a second (GIF
// times frames in hundredths), a whole number of frames per loop.
// TODO(anim): Seamless can take ~30 s a frame on a big creature (a coarser skin just for renders?); transparent background; a size option; WebM/MP4 out too; frames are
// held in memory, so very long loops at a big size could run out.

const GIF_FPS = 25;
/** the longest side of the GIF, in pixels */
const GIF_MAX = 640;
/** how far a pixel's color (summed over red, green and blue) can move before the GIF changes it */
const GIF_STICKY = 9;
export let animRendering: { cancel: boolean } | null = null;
let gifSeamless = false;

const frameWait = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** Fuse every join the pose moved, all the way (and build seamless skins, if asked). */
async function finishJoins(seamless: boolean) {
  for (const c of creatures) {
    c.setDragging(false);
    for (let n = 0; n < 2000 && (c.updateMerge() || c.mergePending); n++) if (!c.mergePending) break;
  }
  if (!seamless) return;
  for (const c of creatures) {
    if (c.skinState === 'none') await c.settle();
    while (c.skinState === 'building') await frameWait();
    // dress the new skin in the current look
    c.updateMerge();
  }
}

function setRenderButton(text: string, busy: boolean) {
  const btn = $('#anim-render');
  iconLabel(btn, faClassic(busy ? 'xmark' : 'file-image'), text);
  btn.classList.toggle('recording', busy);
}

export function initAnimGif() {
  $('#anim-render').onclick = async () => {
    if (animRendering) {
      animRendering.cancel = true;
      return;
    }
    const job = (animRendering = { cancel: false });
    const wasPlaying = animPlaying, wasT = animT;
    setAnimPlaying(false);
    animViz.visible = false;
    renderAnim();
    const frames = Math.max(2, Math.round(animSecs() * GIF_FPS));
    const src = renderer.domElement;
    const k = Math.min(1, GIF_MAX / Math.max(src.width, src.height));
    const w = Math.round(src.width * k), h = Math.round(src.height * k);
    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
    const shots: Uint8ClampedArray[] = [];
    try {
      const started = performance.now();
      for (let i = 0; i < frames && !job.cancel; i++) {
        // how long the rest will take, going by the frames so far (Seamless can be minutes)
        const left = i ? ((performance.now() - started) / i) * (frames - i) / 1000 : 0;
        const eta = left > 90 ? `, about ${Math.round(left / 60)} min left` : left > 5 ? `, about ${Math.round(left)} s left` : '';
        setRenderButton(`Frame ${i + 1} of ${frames}${eta} (click to stop)`, true);
        showAnimAt(i / frames);
        await finishJoins(gifSeamless);
        // draw it now and copy it straight off (the canvas clears after it's shown)
        scene.updateMatrixWorld();
        renderer.shadowMap.needsUpdate = true;
        composer.render();
        ctx.drawImage(src, 0, 0, w, h);
        shots.push(ctx.getImageData(0, 0, w, h).data);
        await frameWait();
      }
      if (!job.cancel) {
        setRenderButton('Making the GIF…', true);
        await frameWait();
        // one palette for every frame (sampled across all of them), so colors don't shimmer
        const step = Math.max(1, Math.floor((shots.length * w * h) / 400_000));
        // each frame is sampled on its own, so size it per frame (rounding up each time)
        const sample = new Uint8ClampedArray(shots.length * Math.ceil((w * h) / step) * 4);
        let o = 0;
        for (const s of shots) for (let p = 0; p < w * h; p += step) sample.set(s.subarray(p * 4, p * 4 + 4), (o++) * 4);
        const palette = quantize(sample.subarray(0, o * 4), 256);
        const gif = GIFEncoder();
        // Sticky colors: a pixel keeps last frame's color unless it's really changed
        // since that color was picked. Soft shadows shift a hair as the pose moves,
        // and with only a few dark colors to go round, a whole shadow would
        // otherwise flicker between two of them.
        const anchor = new Uint8ClampedArray(w * h * 4);
        let last: Uint8Array | null = null;
        for (const s of shots) {
          const index = applyPalette(s, palette);
          if (last) {
            for (let p = 0, q = 0; p < w * h; p++, q += 4) {
              const d = Math.abs(s[q] - anchor[q]) + Math.abs(s[q + 1] - anchor[q + 1]) + Math.abs(s[q + 2] - anchor[q + 2]);
              if (d <= GIF_STICKY) index[p] = last[p];
              else anchor.set(s.subarray(q, q + 4), q);
            }
          } else anchor.set(s);
          gif.writeFrame(index, w, h, { palette, delay: 1000 / GIF_FPS });
          last = index;
        }
        gif.finish();
        const url = URL.createObjectURL(new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(world.name || state.name || 'critter').trim()}-loop.gif`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        hint(`GIF saved: ${frames} frames`, 2400);
      }
    } catch (err) {
      console.error(err);
      hint('Couldn’t make the GIF', 3000, true);
    } finally {
      animRendering = null;
      setRenderButton('Render GIF', false);
      setAnimT(wasT);
      setAnimPlaying(wasPlaying);
      setAnimKey('');
      renderAnim();
      invalidate();
    }
  };
  for (const b of $('#anim-gif-joins').querySelectorAll<HTMLButtonElement>('button')) {
    b.onclick = () => {
      gifSeamless = b.dataset.joins === 'seamless';
      for (const o of $('#anim-gif-joins').querySelectorAll('button')) o.classList.toggle('active', o === b);
    };
  }
  setRenderButton('Render GIF', false);
}
