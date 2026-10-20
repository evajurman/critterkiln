import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { FUR_LAYER, setGlowMaskOut } from '../materials';
import { camera, fill, hemi, key, QUALITY, quality, renderer, rim, scene, view } from './stage';

// Post-processing: MSAA scene render, ground-truth ambient occlusion for the
// creases where parts meet and contact shadows on the floor, then tone mapping.
export let composer: EffectComposer;

// Felt fuzz and ambient occlusion: AO darkens whatever pixels it lands on,
// and the fuzz halo sticks out past the body's edge over the floor's contact
// shadow, so it would come out with dark smudges along the silhouette. With AO
// on, the fuzz (shells and stray hairs, flagged `fx`) is hidden for the scene
// and AO passes and drawn afterwards, on top, by furPass.
let furHidden: THREE.Object3D[] = [];
function hideFur() {
  scene.traverseVisible((o) => {
    if (o.userData.fx) furHidden.push(o);
  });
  for (const o of furHidden) o.visible = false;
}
function showFur() {
  for (const o of furHidden) o.visible = true;
  furHidden = [];
}

// Handles and gizmos (drawn with depthTest off, to show through the body)
// would end up under the fuzz too, so with the fur pass on they're held back
// as well and drawn last, over the fuzz.
const OVERLAY_LAYER = 2;
let overlayHidden: THREE.Object3D[] = [];
function hideOverlays() {
  scene.traverseVisible((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (m && (Array.isArray(m) ? m : [m]).some((x) => !x.depthTest)) overlayHidden.push(o);
  });
  for (const o of overlayHidden) o.visible = false;
}

export let scenePass: RenderPass;
let scenePassRender: RenderPass['render'];
export let gtao: GTAOPass;
// The AO is worked out from a depth image with no anti-aliasing, then
// multiplied onto the smoothed picture. An outline's edge pixels are part
// floor (or whatever's behind) in the picture but all part in the AO, and a
// part has no AO right at its edge, so they kept the floor's colour with none
// of its shade: a light, stepped line round everything, glaring on a bright
// backdrop. Where a pixel is clearly lighter than a neighbour (an edge), it
// takes half that neighbour's shade, about what a half-and-half pixel needs.
// Smooth AO, away from edges, is left exactly as it was.
export const aoTexel = new THREE.Vector2(1, 1);

/**
 * Draws the fuzz over the AO'd image. The image's own depth was lost when AO
 * wrote it out, so AO's depth (the scene without fuzz) is copied in first:
 * fuzz behind the body stays hidden.
 */
class FurPass extends Pass {
  private depthCopy = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragDepth = texture2D(tDepth, vUv).x; }',
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      colorWrite: false,
    }),
  );

  constructor() {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const fur = furHidden;
    const overlays = overlayHidden;
    overlayHidden = [];
    showFur();
    for (const o of overlays) o.visible = true;
    if (!fur.length && !overlays.length) return;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    (this.depthCopy.material as THREE.ShaderMaterial).uniforms.tDepth.value = gtao.depthTexture;
    this.depthCopy.render(renderer);
    // only the fuzz: no backdrop (it would paint over everything), lights kept
    const background = scene.background;
    scene.background = null;
    const mask = view.layers.mask;
    if (fur.length) {
      view.layers.set(FUR_LAYER);
      renderer.render(scene, view);
    }
    // then the handles, on top of it all
    if (overlays.length) {
      for (const o of overlays) o.layers.enable(OVERLAY_LAYER);
      view.layers.set(OVERLAY_LAYER);
      renderer.render(scene, view);
      for (const o of overlays) o.layers.disable(OVERLAY_LAYER);
    }
    view.layers.mask = mask;
    scene.background = background;
    renderer.autoClear = autoClear;
  }
}
let furPass: FurPass;

/**
 * Glowing colors (materials.ts glowMaterial) get a soft halo: the scene is
 * drawn again, small, with each glowing thing putting out just its glow (in
 * its own material, so the halo follows its texture too) and everything else
 * black (so it still hides what's behind it), and that is blurred over the
 * picture. Fuzz, see-through things and handles don't hide the glow.
 * Skipped while nothing in view glows.
 */
class GlowPass extends Pass {
  private mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0, 0);
  private over = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // the picture with the halo added (its alpha, a transparent photo's, as it was)
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform sampler2D tBloom; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb + texture2D(tBloom, vUv).rgb, c.a); }',
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  /** stands in for anything that hides the glow behind it, per side */
  private black = new Map<THREE.Side, THREE.MeshBasicMaterial>();
  /** draws nothing at all */
  private skip = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  constructor() {
    super();
    this.needsSwap = false;
    // mostly the finest blurs: a halo that hugs what glows, not a haze over the whole picture
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1, 0.4, 0.1, 0.02, 0];
  }

  setSize(w: number, h: number) {
    this.mask.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.bloom.setSize(w, h);
  }

  private blackMat(side: THREE.Side) {
    let m = this.black.get(side);
    if (!m) this.black.set(side, (m = new THREE.MeshBasicMaterial({ color: 0x000000, side })));
    return m;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.needsSwap = false;
    const swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    const hidden: THREE.Object3D[] = [];
    let glowing = false;
    scene.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) hidden.push(o);
        return;
      }
      // a mirror draws the whole scene again
      if ((o as THREE.Mesh & { isReflector?: boolean }).isReflector) return void hidden.push(o);
      const m = mesh.material;
      let use: THREE.Material = this.skip;
      if (!Array.isArray(m) && m.visible && !o.userData.fx) {
        if (m.userData.glow) {
          // drawn as it is, putting out only its glow (glowMaskOut)
          glowing = true;
          return;
        }
        if (m.depthTest && m.depthWrite && m.colorWrite && !m.transparent && !(m as THREE.MeshPhysicalMaterial).transmission) use = this.blackMat(m.side);
      }
      swaps.push([mesh, m]);
      mesh.material = use;
    });
    if (glowing) {
      for (const o of hidden) o.visible = false;
      const background = scene.background, fog = scene.fog;
      const shadows = renderer.shadowMap.autoUpdate;
      const clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      scene.background = null;
      scene.fog = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.mask);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      setGlowMaskOut(true);
      renderer.render(scene, view);
      setGlowMaskOut(false);
      renderer.setClearColor(clear, clearAlpha);
      renderer.shadowMap.autoUpdate = shadows;
      scene.background = background;
      scene.fog = fog;
      for (const o of hidden) o.visible = true;
    }
    for (const [mesh, m] of swaps) mesh.material = m;
    if (!glowing) return;
    // blurred into the bloom's own targets (it also adds itself onto the mask, which is just thrown away)
    this.bloom.render(renderer, this.mask, this.mask, 0, false);
    // into the other buffer, not drawn over this one: drawing into the
    // (multisampled) picture again would undo the ambient occlusion laid on it
    const u = (this.over.material as THREE.ShaderMaterial).uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.over.render(renderer);
    this.needsSwap = true;
  }
}
let glowPass: GlowPass;
// optional macro-photo depth of field, focused on whatever the camera orbits
export let bokeh: BokehPass;
export function setAO(on: boolean) {
  gtao.enabled = on;
  // without AO the fuzz is simply drawn with everything else
  furPass.enabled = on;
}

export function initPost() {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: QUALITY[quality].samples }));
  scenePass = new RenderPass(scene, view);
  scenePassRender = scenePass.render.bind(scenePass);
  scenePass.render = (...args: Parameters<RenderPass['render']>) => {
    if (furPass.enabled) {
      hideFur();
      hideOverlays();
    }
    scenePassRender(...args);
  };
  composer.addPass(scenePass);
  gtao = new GTAOPass(scene, camera, 1, 1);
  // Stock GTAO counts anything within `thickness` in camera depth as an
  // occluder, cut off sharply. Looking down, the floor behind a leg's edge
  // comes within that depth partway up the leg, so the shade switched on there
  // and moved as the camera did. Here an occluder fades out by its real distance
  // instead: the same from every angle, and soft at the limit.
  gtao.gtaoMaterial.fragmentShader = gtao.gtaoMaterial.fragmentShader
    .replaceAll('if (abs(viewDelta.z) < thickness) {', '{ float occW = 1. - smoothstep(0.5 * thickness, thickness, length(viewDelta));')
    .replace(/(cosHorizons\.[xy] \+= max\(0\., \(sampleCosHorizon - cosHorizons\.[xy]\) \* mix\(1\., 2\. \/ float\(j \+ 2\), distanceFallOff\))\);/g, '$1 * occW);');
  gtao.gtaoMaterial.needsUpdate = true;
  gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1.6, thickness: 0.6, scale: 1.3, samples: QUALITY[quality].aoSamples });
  gtao.enabled = QUALITY[quality].ao;
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 1.0;
  gtao.blendMaterial.uniforms.texel = { value: aoTexel };
  gtao.blendMaterial.fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec4 ao = texture2D(tDiffuse, vUv);
    float darkest = min(
      min(texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).r, texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).r),
      min(texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).r, texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).r));
    float edge = smoothstep(0.06, 0.2, ao.r - darkest);
    ao.rgb = vec3(mix(ao.r, darkest, 0.5 * edge));
    gl_FragColor = vec4(mix(vec3(1.0), ao.rgb, intensity), ao.a);
  }`;
  gtao.blendMaterial.needsUpdate = true;
  composer.addPass(gtao);
  furPass = new FurPass();
  composer.addPass(furPass);
  glowPass = new GlowPass();
  composer.addPass(glowPass);
  // lights have to share the fuzz's layer to light it
  for (const l of [hemi, key, fill, rim]) l.layers.enable(FUR_LAYER);
  bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0.004, maxblur: 0.012 });
  bokeh.enabled = false;
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  setAO(gtao.enabled);
}
