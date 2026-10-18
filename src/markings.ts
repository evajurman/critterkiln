// ---------------------------------------------------------------------------
// Markings: patterns laid over any material (spots, stripes, cracks...), up
// to MAX_MARKINGS on a part, one over the other. Worked out in the shader from
// where each point sits in the creature's rest pose, in 3D, so a pattern runs
// on across parts, bends with the pose, and has no seams. Each recolors the
// surface after the material's own textures, keeping their detail (felt
// fibres, knit stitches show through), and can make it matte or shiny. How
// marked each point is goes in markMask, so the glow can come from just the
// markings. A seamless skin over parts marked differently draws all of their
// markings (up to MAX_LAYERS), each faded in and out across the joins by a
// per-point weight (markW, see paintMarks in skin.ts).

import * as THREE from 'three';
import { getStoneTex } from './materials';

export type MarkingType = 'spots' | 'speckles' | 'stripes' | 'patches' | 'cells' | 'cracks' | 'veins' | 'belly';

export interface Marking {
  type: MarkingType;
  /** how big the pattern is, as a multiple of its usual size */
  size: number;
  /** where the pattern is cut: higher leaves less of the surface marked */
  threshold: number;
  /** how ragged its edges are, 0 = clean */
  rough: number;
  /** how strongly it's painted on, 0..1 */
  amount: number;
  /** the part's own color made darker (up to 1) or lighter (down to -1), for the marking (not used with a color of its own) */
  darkness: number;
  /** its own color (unset: the part's, shaded by darkness) */
  color?: string;
  /** where it's marked the surface turns matte (down to -1) or shiny (up to 1); 0 = as the material is */
  finish: number;
}

/** markings one part can have */
export const MAX_MARKINGS = 3;
/** markings one surface can draw: parts that would need more between them don't blend */
export const MAX_LAYERS = 4;

export const MARKINGS: { type: MarkingType; name: string; title: string; base: Partial<Marking> }[] = [
  { type: 'spots', name: 'Spots', title: 'Round spots: ladybugs, leopards, toadstools', base: { threshold: 0.55, darkness: 0.85 } },
  { type: 'speckles', name: 'Speckles', title: 'Tiny dots of every size: freckles, eggs, granite', base: { threshold: 0.7, darkness: 0.6 } },
  { type: 'stripes', name: 'Stripes', title: 'Wavy bands: tigers, bees, sweaters', base: { threshold: 0.5, darkness: 0.8 } },
  { type: 'patches', name: 'Patches', title: 'Big soft blotches: cows, calico cats, camouflage, rust', base: { threshold: 0.55, darkness: 0.7 } },
  { type: 'cells', name: 'Cells', title: 'Patches split by lines: giraffes, turtle shells, dried mud', base: { threshold: 0.35, darkness: 0.6 } },
  { type: 'cracks', name: 'Cracks', title: 'A network of thin cracks: old stone, eggshells, lava', base: { threshold: 0.7, darkness: 0.88 } },
  { type: 'veins', name: 'Veins', title: 'Thin winding veins: marble, leaves', base: { threshold: 0.3, darkness: -0.75 } },
  { type: 'belly', name: 'Belly', title: 'Paler underneath, like most animals', base: { threshold: 0.5, darkness: -0.6 } },
];

/** the color a new marking starts in (untick it for the part's own color, made darker or lighter) */
export const MARKING_COLOR = '#808080';

export function defaultMarking(type: MarkingType): Marking {
  return { type, size: 1, threshold: 0.5, rough: 0, amount: 1, darkness: 0.8, finish: 0, color: MARKING_COLOR, ...MARKINGS.find((m) => m.type === type)!.base };
}

/** Changes whenever a marking would look different. */
export function markingKey(m: Marking): string {
  return JSON.stringify([m.type, m.size, m.threshold, m.rough, m.amount, m.darkness, m.color ?? '', m.finish]);
}
/** The same for a part's whole stack of markings (for mesh and grouping keys). */
export function markingsKey(list: Marking[] | undefined): string {
  return list?.length ? list.map(markingKey).join('+') : '';
}

/** each pattern's usual size, in the creature's own units (a critter stands about 1.5 tall) */
const BASE_SIZE: Record<MarkingType, number> = {
  spots: 0.14, speckles: 0.035, stripes: 0.2, patches: 0.45, cells: 0.16, cracks: 1.33, veins: 1.33, belly: 0.25,
};

/** patterns drawn from stone's own texture (its hand-made cracks and veins), projected on from three sides */
const TEXTURED: Partial<Record<MarkingType, () => THREE.Texture>> = {
  cracks: () => getStoneTex().bump,
  veins: () => getStoneTex().data,
};

const NOISE_GLSL = /* glsl */ `
vec3 mkHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float mkNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(mkHash3(i).x, mkHash3(i + vec3(1, 0, 0)).x, u.x), mix(mkHash3(i + vec3(0, 1, 0)).x, mkHash3(i + vec3(1, 1, 0)).x, u.x), u.y),
    mix(mix(mkHash3(i + vec3(0, 0, 1)).x, mkHash3(i + vec3(1, 0, 1)).x, u.x), mix(mkHash3(i + vec3(0, 1, 1)).x, mkHash3(i + vec3(1, 1, 1)).x, u.x), u.y),
    u.z);
}
float mkFbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * mkNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.9375;
}
// distance to the nearest and second nearest scattered point, and a random number for the nearest
vec3 mkWorley(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = mkHash3(i + g);
        vec3 r = g + o - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = o.z; }
        else if (d < d2) d2 = d;
      }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec4 mkTri(sampler2D t, vec3 p) {
  vec3 w = pow(abs(normalize(vMarkNormal)), vec3(4.0));
  w /= w.x + w.y + w.z;
  return texture2D(t, p.yz) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
`;

/** each pattern as a field: 1 where it's most marked, 0 where it's least (the threshold cuts it); TEX = its texture */
const FIELD: Record<MarkingType, string> = {
  spots: 'vec3 w = mkWorley(p); f = 1.0 - w.x * 1.2 + (mkNoise(p * 3.0) - 0.5) * 0.15;',
  speckles: 'vec3 w = mkWorley(p); f = 1.0 - w.x / (0.25 + 0.75 * w.z);',
  stripes: 'f = 0.5 + 0.5 * sin(6.2832 * (p.y + (mkFbm(p * 0.5) - 0.5) * 1.6));',
  // (noise bunches up around the middle: spread out, so the threshold goes from all to none)
  patches: 'f = clamp((mkFbm(p * 0.8 + 3.7) - 0.5) * 2.5 + 0.5, 0.0, 1.0);',
  cells: 'vec3 w = mkWorley(p + (vec3(mkNoise(p * 2.0), mkNoise(p * 2.0 + 5.2), mkNoise(p * 2.0 + 9.4)) - 0.5) * 0.35); f = clamp((w.y - w.x) * 2.2, 0.0, 1.0);',
  // each crack at its own level: a lower threshold shows more of them
  cracks: 'f = mkTri(TEX, p).g;',
  veins: 'f = mkTri(TEX, p).b;',
  belly: 'f = 0.5 - 0.5 * normalize(vMarkNormal).y + (mkFbm(p) - 0.5) * 0.3;',
};

/** One marking's turn in the shader: `i` its uniforms, `w` how much of it this point has. */
function layerGLSL(m: Marking, i: number, w: string): string {
  const u = (n: string) => `mk${i}${n}`;
  return /* glsl */ `{
    vec3 p = vMarkPos * ${u('Scale')};
    float f = 0.0;
    ${FIELD[m.type].replace(/TEX/g, u('Tex'))}
    // rough edges: finer noise frays the cut, so it creeps in rather than being painted on
    f += (mkNoise(p * 7.0 + 1.3) - 0.5) * ${u('Rough')} * 0.6;
    float soft = max(fwidth(f), 0.015);
    float m = smoothstep(${u('Thr')} - soft, ${u('Thr')} + soft, f) * ${u('Amt')} * ${w};
    vec3 c = mix(${u('Color')}, markBase, ${u('Own')});
    c = ${u('Dark')} >= 0.0 ? c * (1.0 - ${u('Dark')}) : mix(c, vec3(1.0), -${u('Dark')});
    diffuseColor.rgb = mix(diffuseColor.rgb, c * markDetail, m);
    markMask = max(markMask, m);
    #ifdef STANDARD
      // matte: rough and not metallic; shiny: polished
      float fin = ${u('Finish')};
      roughnessFactor = mix(roughnessFactor, fin < 0.0 ? 1.0 : 0.05, m * abs(fin));
      metalnessFactor *= 1.0 - m * max(-fin, 0.0);
    #endif
  }`;
}

/**
 * Lay `layers` over a material (any kind: standard, physical, toon...), one
 * after the other, keeping its own shader hooks. `perPoint`: the mesh carries
 * how much of each marking each point has (a 4-wide `markW` attribute: a skin
 * over parts marked differently). Call before the material's first render
 * (the shader is put together then).
 */
export function applyMarkings(mat: THREE.Material, layers: Marking[] | undefined, perPoint = false) {
  const list = (layers ?? []).slice(0, MAX_LAYERS);
  if (!list.length || mat.userData.ink) return;
  const uniforms: Record<string, THREE.IUniform> = {};
  list.forEach((m, i) => {
    Object.assign(uniforms, {
      [`mk${i}Scale`]: { value: 1 / (BASE_SIZE[m.type] * Math.max(0.05, m.size)) },
      [`mk${i}Thr`]: { value: m.threshold },
      [`mk${i}Rough`]: { value: m.rough ?? 0 },
      [`mk${i}Amt`]: { value: m.amount },
      [`mk${i}Dark`]: { value: m.color ? 0 : m.darkness },
      [`mk${i}Color`]: { value: new THREE.Color(m.color ?? '#ffffff') },
      [`mk${i}Own`]: { value: m.color ? 0 : 1 },
      [`mk${i}Finish`]: { value: m.finish ?? 0 },
      ...(TEXTURED[m.type] ? { [`mk${i}Tex`]: { value: TEXTURED[m.type]!() } } : {}),
    });
  });
  const before = mat.onBeforeCompile;
  const key = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : () => before.toString();
  mat.onBeforeCompile = (shader, renderer) => {
    before.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (perPoint) {
      shader.vertexShader = 'attribute vec4 markW;\nvarying vec4 vMarkW;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarkW = markW;');
    }
    // triplanar materials already carry the rest-pose position; the rest get their own
    const shared = shader.vertexShader.includes('varying vec3 vTriPos');
    if (!shared) {
      shader.uniforms.markRest = { value: (mat.userData.triRest as THREE.Matrix4 | undefined) ?? new THREE.Matrix4() };
      shader.vertexShader =
        `varying vec3 vMarkPos;
         varying vec3 vMarkNormal;
         uniform mat4 markRest;
         #ifdef TRI_REST_ATTR
           attribute vec3 restPos;
           attribute vec3 restNormal;
         #endif
        ` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef TRI_REST_ATTR
             vMarkPos = restPos;
             vMarkNormal = restNormal;
           #else
             vMarkPos = (markRest * vec4(position, 1.0)).xyz;
             vMarkNormal = mat3(markRest) * normal;
           #endif`,
        );
    }
    const decls = list
      .map((m, i) => `uniform float mk${i}Scale, mk${i}Thr, mk${i}Rough, mk${i}Amt, mk${i}Dark, mk${i}Own, mk${i}Finish;\nuniform vec3 mk${i}Color;\n` + (TEXTURED[m.type] ? `uniform sampler2D mk${i}Tex;\n` : ''))
      .join('');
    const pars =
      (perPoint ? 'varying vec4 vMarkW;\n' : '') +
      (shared ? '#define vMarkPos vTriPos\n#define vMarkNormal vTriNormal\n' : 'varying vec3 vMarkPos;\nvarying vec3 vMarkNormal;\n') +
      decls +
      NOISE_GLSL;
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', pars + '\nvoid main() {').replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `{
        // the color before any texture, so the texture's detail carries on over the markings
        vec3 markBase = diffuse;
        #ifdef USE_COLOR
          markBase *= vColor.rgb;
        #endif
        vec3 markDetail = clamp(diffuseColor.rgb / max(markBase, vec3(1e-3)), 0.0, 2.0);
        ${list.map((m, i) => layerGLSL(m, i, perPoint ? `vMarkW.${'xyzw'[i]}` : '1.0')).join('\n')}
      }
      #include <emissivemap_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => key() + '|mark-' + list.map((m) => m.type).join('-') + (perPoint ? '-w' : '');
}

// ---------------------------------------------------------------------------
// Settings from before markings: the patterns that were inside materials
// become a part's markings, so old creations look as they did.

/** the old defaults (a stone creature had cracks unless they were turned off) */
const LEGACY: Record<string, Record<string, number>> = {
  stone: { veins: 0, cracks: 0.3 },
  metal: { patina: 0, tone: 0 },
  felt: { patches: 0, patchHue: 0, patchShade: -0.75 },
  knit: { stripes: 0 },
};
const LEGACY_KEYS = Object.values(LEGACY).flatMap((o) => Object.keys(o));

interface LegacyPart {
  color: string;
  style?: string;
  markings?: Marking[];
  /** (a try at markings that had just the one) */
  marking?: Marking & { type: string };
  glowFollow?: string;
}
interface LegacyCreature {
  style: string;
  parts: Record<string, LegacyPart>;
  materialSettings?: Record<string, Record<string, number> | undefined>;
  markingsV?: number;
}

/** A marking in the part's own color (made darker or lighter), as old ones were unless they had a color. */
function ownColor(m: Marking): Marking {
  delete m.color;
  return m;
}

/** The markings an old material's settings drew. */
function legacyMarkings(style: string, k: Record<string, number>, color: string): Marking[] {
  const out: Marking[] = [];
  if (style === 'stone' && k.veins > 0) {
    const c = new THREE.Color(color);
    const pale = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 <= 0.35;
    out.push(ownColor({ ...defaultMarking('veins'), amount: k.veins, darkness: pale ? -0.75 : 0.7 }));
  }
  if (style === 'stone' && k.cracks > 0) out.push(ownColor({ ...defaultMarking('cracks'), threshold: 1 - k.cracks }));
  if (style === 'metal' && k.patina > 0) {
    // rusty brown through to verdigris, in ragged blotches that dull the metal
    const tone = new THREE.Color('#4a200d').lerp(new THREE.Color('#3f7f6c'), k.tone ?? 0);
    out.push({ ...defaultMarking('patches'), threshold: 1 - k.patina * 0.8, rough: 0.5, finish: -1, darkness: 0, color: '#' + tone.getHexString() });
  }
  if (style === 'felt' && k.patches > 0) {
    const c = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL((hsl.h + (k.patchHue ?? 0) + 1) % 1, hsl.s, hsl.l);
    // its shade goes into the color (a picked color isn't shaded)
    const shade = -(k.patchShade ?? -0.75) * 0.8;
    if (shade > 0) c.multiplyScalar(1 - shade);
    else c.lerp(new THREE.Color(1, 1, 1), -shade);
    out.push({ ...defaultMarking('patches'), threshold: 1 - k.patches * 0.6, rough: 0.4, color: '#' + c.getHexString(), darkness: 0 });
  }
  if (style === 'knit' && k.stripes > 0) out.push(ownColor({ ...defaultMarking('stripes'), darkness: -0.55 * k.stripes }));
  return out;
}

/**
 * Bring a creature saved before markings up to date (once): each part gets
 * the markings its material used to draw, the old settings go, and a glow
 * that came from the texture's bright or dark parts comes from the material
 * or the markings instead.
 */
export function migrateMarkings(s: LegacyCreature) {
  for (const p of Object.values(s.parts)) {
    // a part with a single marking (as markings first were): it's the first of a stack now
    if (p.marking) {
      const m = p.marking;
      const was = m.type as string;
      if (was === 'patina') Object.assign(m, { type: 'patches', rough: 0.5, finish: -1 });
      const filled = { ...defaultMarking(m.type), ...m };
      p.markings = [m.color ? filled : ownColor(filled)];
      delete p.marking;
    }
  }
  if (s.markingsV) return;
  s.markingsV = 1;
  for (const p of Object.values(s.parts)) {
    const style = p.style ?? s.style;
    if (!p.markings?.length && LEGACY[style]) {
      const list = legacyMarkings(style, { ...LEGACY[style], ...s.materialSettings?.[style] }, p.color);
      if (list.length) p.markings = list;
    }
    if (p.glowFollow === 'bright') p.glowFollow = 'material';
    else if (p.glowFollow === 'dark') p.glowFollow = p.markings?.length ? 'markings' : 'material';
  }
  for (const k of Object.values(s.materialSettings ?? {})) for (const key of LEGACY_KEYS) if (k) delete k[key];
}

// ---------------------------------------------------------------------------
// A picture of each marking for the picker: a ball with it on, drawn once
// with the real shader in a small renderer of its own.

let thumbs: Map<MarkingType, string> | null = null;
/** small enough that a few of each fit on the ball (and cracks and veins at their busiest) */
const THUMB: Partial<Record<MarkingType, Partial<Marking>>> = {
  spots: { size: 0.6 }, stripes: { size: 0.6 }, patches: { size: 0.5 }, cells: { size: 0.6 }, belly: { size: 0.6 },
  speckles: { size: 1.4 }, cracks: { size: 1, threshold: 0.15 }, veins: { size: 0.8, threshold: 0.2 },
};

export function markingThumbnails(): Map<MarkingType, string> {
  if (thumbs) return thumbs;
  thumbs = new Map();
  const size = 96;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return thumbs;
  }
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8090, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-1, 1.5, 2);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-0.27, 0.27, 0.27, -0.27, 0.1, 10);
  camera.position.set(0, 0, 3);
  const geo = new THREE.SphereGeometry(0.25, 48, 32);
  for (const { type } of MARKINGS) {
    // a mid tone, so markings lighter and darker than the part both show
    const mat = new THREE.MeshStandardMaterial({ color: '#d08a4c', roughness: 0.55 });
    applyMarkings(mat, [{ ...defaultMarking(type), ...THUMB[type] }]);
    const ball = new THREE.Mesh(geo, mat);
    scene.add(ball);
    renderer.render(scene, camera);
    thumbs.set(type, renderer.domElement.toDataURL());
    scene.remove(ball);
    mat.dispose();
  }
  geo.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return thumbs;
}
