// ---------------------------------------------------------------------------
// Markings: patterns laid over any material (spots, stripes, cracks...), up
// to MAX_MARKINGS on a part, one over the other: the whole creature's (each
// can be turned off on some parts), then the part's own. Worked out in the shader from
// where each point sits in the creature's rest pose, in 3D, so a pattern runs
// on across parts, bends with the pose, and has no seams. Each recolors the
// surface after the material's own textures, keeping their detail (felt
// fibres, knit stitches show through), and can make it matte or shiny. How
// marked each point is goes in markMask, so the glow can come from just the
// markings. A seamless skin over parts marked differently draws all of their
// markings (up to MAX_LAYERS), each faded in and out across the joins by a
// per-point weight (markW, see paintMarks in skin.ts).
//
// Pictures and text are stuck on like stickers: projected from the front of
// the marking's own frame (placed with the gizmo). Paint is brush strokes kept
// as 3D points in the pattern's space, baked into a small 3D texture around
// them, so it survives the part being reshaped and runs across joins.

import * as THREE from 'three';
import { getStoneTex } from './materials';

export type MarkingType = 'spots' | 'speckles' | 'stripes' | 'patches' | 'cells' | 'cracks' | 'veins' | 'belly' | 'picture' | 'text' | 'paint';

/** One stroke of paint: points along it (x, y, z one after the other, in the pattern's space) painted round to radius r. */
export interface PaintStroke {
  color: string;
  r: number;
  /** rubs paint out instead */
  erase?: boolean;
  pts: number[];
}

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
  /** where the pattern's moved to, in the creature's rest pose (unset: where it falls) */
  offset?: [number, number, number];
  /** how it's turned (a quaternion) */
  turn?: [number, number, number, number];
  /** how it's stretched along each of its own axes */
  stretch?: [number, number, number];
  /** a picture: its id among the creature's pictures (see setPictures) */
  picture?: string;
  /** text: the words (a new line for each \n) */
  text?: string;
  /** text: its typeface (one of FONTS' css) */
  font?: string;
  /** paint: the strokes, the last on top */
  strokes?: PaintStroke[];
  /** paint: which paint this is (each has a canvas of its own) */
  id?: string;
  /** on the whole creature: the parts it's turned off on */
  skip?: string[];
}

/** markings one part can show (the whole creature's and its own) */
export const MAX_MARKINGS = 4;
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
  { type: 'picture', name: 'Picture', title: 'A picture of your own, stuck on like a sticker', base: {} },
  { type: 'text', name: 'Text', title: 'Words written on: names, numbers, labels', base: { color: '#ffffff' } },
  { type: 'paint', name: 'Paint', title: 'Paint on it with a brush', base: {} },
];

/**
 * The markings one part (or stuff piece) shows: the whole creature's (or
 * item's), but those turned off on it, then its own, the last on top.
 */
export function shownMarkings(whole: Marking[] | undefined, own: Marking[] | undefined, id: string): Marking[] {
  const all = (whole ?? []).filter((m) => !m.skip?.includes(id));
  return all.length ? [...all, ...(own ?? [])] : (own ?? []);
}

/** stuck on from one side (placed with the gizmo), rather than a pattern all over */
export const STICKERS: MarkingType[] = ['picture', 'text'];
/** what each kind of marking has settings for */
export function markingUses(t: MarkingType) {
  const pattern = !STICKERS.includes(t) && t !== 'paint';
  return { size: t !== 'paint', threshold: pattern, rough: pattern || t === 'paint', color: pattern || t === 'text' };
}

/** typefaces for text */
export const FONTS: { name: string; css: string }[] = [
  { name: 'Bubbly', css: "'DynaPuff', system-ui, sans-serif" },
  { name: 'Rounded', css: "'Nunito', system-ui, sans-serif" },
  { name: 'Bookish', css: 'Georgia, serif' },
  { name: 'Typewriter', css: "'Courier New', monospace" },
  { name: 'Poster', css: "Impact, 'Arial Black', sans-serif" },
];

/** the color a new marking starts in (untick it for the part's own color, made darker or lighter) */
export const MARKING_COLOR = '#808080';

export function defaultMarking(type: MarkingType): Marking {
  const m: Marking = { type, size: 1, threshold: 0.5, rough: 0, amount: 1, darkness: 0.8, finish: 0, color: MARKING_COLOR, ...MARKINGS.find((m) => m.type === type)!.base };
  if (type === 'text') Object.assign(m, { text: 'Hello', font: FONTS[0].css });
  if (type === 'paint') Object.assign(m, { id: Math.random().toString(36).slice(2, 10), strokes: [] });
  return m;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
/** (strokes are replaced, never changed, so each list is hashed once) */
const strokeHashes = new WeakMap<PaintStroke[], string>();
function strokesKey(list: PaintStroke[] | undefined): string {
  if (!list?.length) return '';
  let h = strokeHashes.get(list);
  if (!h) strokeHashes.set(list, (h = hash(JSON.stringify(list)) + '.' + list.length));
  return h;
}

/** Changes whenever a marking would look different. */
export function markingKey(m: Marking): string {
  return JSON.stringify([m.type, m.size, m.threshold, m.rough, m.amount, m.darkness, m.color ?? '', m.finish, m.offset ?? 0, m.turn ?? 0, m.stretch ?? 0, m.picture ?? '', m.text ?? '', m.font ?? '', m.id ?? '', strokesKey(m.strokes)]);
}

/** Where a marking's pattern is laid, moved, turned and stretched, in the rest pose (the gizmo's handle on it). */
export function markingPlace(m: Marking): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(m.offset ?? [0, 0, 0])),
    new THREE.Quaternion(...(m.turn ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(m.stretch ?? [1, 1, 1])),
  );
}
/** The same for a part's whole stack of markings (for mesh and grouping keys). */
export function markingsKey(list: Marking[] | undefined): string {
  return list?.length ? list.map(markingKey).join('+') : '';
}

/** each pattern's usual size, in the creature's own units (a critter stands about 1.5 tall) */
const BASE_SIZE: Record<MarkingType, number> = {
  spots: 0.14, speckles: 0.035, stripes: 0.2, patches: 0.45, cells: 0.16, cracks: 1.33, veins: 1.33, belly: 0.25,
  // a sticker's height
  picture: 0.3, text: 0.15, paint: 1,
};

// ---------------------------------------------------------------------------
// The textures pictures, text and paint are drawn from. Each is shared by
// every material showing it (uniforms and all), so a picture that finishes
// loading, or paint being laid on, shows everywhere at once.

let textureReady = () => {};
/** Called when a texture changes by itself (a picture loaded, a font arrived): redraw. */
export function onMarkingTexture(fn: () => void) {
  textureReady = fn;
}

interface Sticker {
  tex: THREE.Texture;
  /** width over height */
  aspect: THREE.IUniform<number>;
}

/** every picture seen, by id (the creatures keep theirs in state.pictures) */
const pictureSrc = new Map<string, string>();
const pictureTex = new Map<string, Sticker>();

/** Make a creature's pictures available to its markings. */
export function setPictures(p: Record<string, string> | undefined) {
  for (const [id, src] of Object.entries(p ?? {})) pictureSrc.set(id, src);
}
/** The id a picture goes by (the same picture always gets the same one). */
export function pictureId(src: string): string {
  const id = 'p' + hash(src) + src.length.toString(36);
  pictureSrc.set(id, src);
  return id;
}

function pictureSticker(id: string | undefined): Sticker {
  const key = id ?? '';
  let e = pictureTex.get(key);
  if (e) return e;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  e = { tex, aspect: { value: 1 } };
  pictureTex.set(key, e);
  const src = id && pictureSrc.get(id);
  if (src) {
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
      e!.aspect.value = img.width / Math.max(1, img.height);
      textureReady();
    };
    img.src = src;
  }
  return e;
}

const textTex = new Map<string, Sticker>();
function textSticker(text: string, font: string): Sticker {
  const key = font + '|' + text;
  let e = textTex.get(key);
  if (e) return e;
  const canvas = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(canvas);
  e = { tex, aspect: { value: 1 } };
  const draw = () => {
    const px = 128;
    const lines = text.split('\n');
    const ctx = canvas.getContext('2d')!;
    const css = `700 ${px}px ${font}`;
    ctx.font = css;
    const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    // a little room round the words, so their edges aren't cut
    canvas.width = Math.ceil(w + px * 0.3);
    canvas.height = Math.ceil(lines.length * px * 1.15 + px * 0.2);
    ctx.font = css;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, px * 0.1 + px * 1.15 * (i + 0.5)));
    e!.aspect.value = canvas.width / canvas.height;
    tex.dispose();
    tex.needsUpdate = true;
  };
  draw();
  // drawn again once the typeface has arrived
  document.fonts?.load(`700 128px ${font}`, text).then(() => {
    draw();
    textureReady();
  }, () => {});
  if (textTex.size > 24) {
    const [old, o] = textTex.entries().next().value!;
    o.tex.dispose();
    textTex.delete(old);
  }
  textTex.set(key, e);
  return e;
}

/** the most cells a paint's canvas has along its longest side */
const PAINT_RES = 96;

/**
 * Paint, baked: a 3D grid of colors (and how much paint) around the strokes,
 * finer the smaller the painted area. In the shader the spot `q` (in the
 * pattern's space) is at (q - min) * scale + off in the texture.
 */
interface PaintCanvas {
  tex: THREE.Data3DTexture;
  min: THREE.Vector3;
  scale: THREE.Vector3;
  off: THREE.Vector3;
  /** the grid itself: cell size, how many cells */
  cell: number;
  dims: [number, number, number];
  data: Uint8Array;
}
const paintCanvases = new Map<string, PaintCanvas>();
const paintKey = (m: Marking) => (m.id ?? '') + ':' + strokesKey(m.strokes);

function paintCanvas(m: Marking): PaintCanvas {
  const key = paintKey(m);
  let c = paintCanvases.get(key);
  if (c) {
    // (most recently used last)
    paintCanvases.delete(key);
  } else {
    c = {
      tex: new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1),
      min: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      off: new THREE.Vector3(),
      cell: 1,
      dims: [1, 1, 1],
      data: new Uint8Array(4),
    };
    c.tex.format = THREE.RGBAFormat;
    c.tex.minFilter = c.tex.magFilter = THREE.LinearFilter;
    c.tex.unpackAlignment = 1;
    bakePaint(c, m.strokes ?? [], 0);
    // a few kept: undo and redo come back to them (one put aside is uploaded again if it's still drawn)
    while (paintCanvases.size >= 8) {
      const [old, o] = paintCanvases.entries().next().value!;
      o.tex.dispose();
      paintCanvases.delete(old);
    }
  }
  paintCanvases.set(key, c);
  return c;
}

/** Lay every stroke on a fresh grid around them all, with `pad` (a share of their size) to spare for more. */
function bakePaint(c: PaintCanvas, strokes: PaintStroke[], pad: number) {
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of strokes) {
    if (s.erase) continue;
    for (let i = 0; i < s.pts.length; i += 3) {
      lo.min(new THREE.Vector3(s.pts[i] - s.r, s.pts[i + 1] - s.r, s.pts[i + 2] - s.r));
      hi.max(new THREE.Vector3(s.pts[i] + s.r, s.pts[i + 1] + s.r, s.pts[i + 2] + s.r));
    }
  }
  if (lo.x > hi.x) lo.set(0, 0, 0), hi.set(0.01, 0.01, 0.01);
  const ext = hi.clone().sub(lo);
  const grow = Math.max(ext.x, ext.y, ext.z) * pad;
  lo.subScalar(grow);
  hi.addScalar(grow);
  ext.subVectors(hi, lo);
  // two empty cells all round, so the edges fade to nothing
  const cell = Math.max(ext.x, ext.y, ext.z, 1e-3) / (PAINT_RES - 5);
  lo.subScalar(2 * cell);
  const dims = [ext.x, ext.y, ext.z].map((e) => Math.min(PAINT_RES, Math.ceil(e / cell) + 5)) as [number, number, number];
  c.cell = cell;
  c.dims = dims;
  c.data = new Uint8Array(dims[0] * dims[1] * dims[2] * 4);
  c.min.copy(lo);
  c.scale.set(1 / (cell * dims[0]), 1 / (cell * dims[1]), 1 / (cell * dims[2]));
  c.off.set(0.5 / dims[0], 0.5 / dims[1], 0.5 / dims[2]);
  for (const s of strokes) for (let i = 0; i < s.pts.length; i += 3) stampPaint(c, s, Math.max(0, i - 3), i);
  // a new size: put the texture up again from scratch (every material holds this same one)
  c.tex.dispose();
  c.tex.image = { data: c.data, width: dims[0], height: dims[1], depth: dims[2] };
  c.tex.needsUpdate = true;
}

/** Paint (or rub out) along a stroke from its point a to point b (indices into pts); false if that's off the grid. */
function stampPaint(c: PaintCanvas, s: PaintStroke, a: number, b: number): boolean {
  const A = new THREE.Vector3().fromArray(s.pts, a);
  const B = new THREE.Vector3().fromArray(s.pts, b);
  const { cell, dims, data, min } = c;
  const reach = s.r + cell;
  const from = A.clone().min(B).subScalar(reach).sub(min).divideScalar(cell).floor();
  const to = A.clone().max(B).addScalar(reach).sub(min).divideScalar(cell).ceil();
  const fits = from.x >= 0 && from.y >= 0 && from.z >= 0 && to.x < dims[0] && to.y < dims[1] && to.z < dims[2];
  if (!fits && !s.erase) return false;
  const col = new THREE.Color(s.color);
  const ab = B.clone().sub(A);
  const len2 = Math.max(ab.lengthSq(), 1e-12);
  const p = new THREE.Vector3();
  for (let z = Math.max(0, from.z); z <= Math.min(dims[2] - 1, to.z); z++)
    for (let y = Math.max(0, from.y); y <= Math.min(dims[1] - 1, to.y); y++)
      for (let x = Math.max(0, from.x); x <= Math.min(dims[0] - 1, to.x); x++) {
        p.set(x, y, z).multiplyScalar(cell).add(min);
        const t = Math.min(1, Math.max(0, p.clone().sub(A).dot(ab) / len2));
        const d = p.distanceTo(A.clone().addScaledVector(ab, t));
        // how much of the cell the brush covers: soft over one cell's width
        const cov = Math.min(1, Math.max(0, (s.r - d) / cell + 0.5));
        if (cov <= 0) continue;
        const i = ((z * dims[1] + y) * dims[0] + x) * 4;
        if (s.erase) {
          data[i + 3] = Math.min(data[i + 3], Math.round((1 - cov) * 255));
          continue;
        }
        const k = data[i + 3] ? cov : 1;
        data[i] = Math.round(data[i] + (col.r * 255 - data[i]) * k);
        data[i + 1] = Math.round(data[i + 1] + (col.g * 255 - data[i + 1]) * k);
        data[i + 2] = Math.round(data[i + 2] + (col.b * 255 - data[i + 2]) * k);
        data[i + 3] = Math.max(data[i + 3], Math.round(cov * 255));
      }
  return true;
}

/**
 * Show a stroke being painted, before it's part of the marking: `strokes`
 * is the marking's own with the ones in progress (`live` of them: a stroke
 * and its mirror image) last, which have just gone on from point `from` (an
 * index into their pts). The marking's canvas is painted on as it's shown;
 * call endLivePaint once the strokes are kept.
 */
export function livePaint(m: Marking, strokes: PaintStroke[], from: number, live = 1) {
  const c = paintCanvas(m);
  const going = strokes.slice(-live);
  const fits = from >= 0 && going.every((s) => stampPaint(c, s, from, Math.max(from, s.pts.length - 3)));
  if (fits) c.tex.needsUpdate = true;
  else bakePaint(c, strokes, 0.5);
  textureReady();
}
/** The stroke's been kept (or dropped): the canvas painted on live no longer shows the marking as it was. */
export function endLivePaint(m: Marking) {
  const key = paintKey(m);
  paintCanvases.get(key)?.tex.dispose();
  paintCanvases.delete(key);
}

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
vec4 mkTri(sampler2D t, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= w.x + w.y + w.z;
  return texture2D(t, p.yz) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
`;

/** each pattern as a field: 1 where it's most marked, 0 where it's least (the threshold cuts it); TEX = its texture, mn = the surface's direction in the pattern's own space */
const FIELD: Partial<Record<MarkingType, string>> = {
  spots: 'vec3 w = mkWorley(p); f = 1.0 - w.x * 1.2 + (mkNoise(p * 3.0) - 0.5) * 0.15;',
  speckles: 'vec3 w = mkWorley(p); f = 1.0 - w.x / (0.25 + 0.75 * w.z);',
  stripes: 'f = 0.5 + 0.5 * sin(6.2832 * (p.y + (mkFbm(p * 0.5) - 0.5) * 1.6));',
  // (noise bunches up around the middle: spread out, so the threshold goes from all to none)
  patches: 'f = clamp((mkFbm(p * 0.8 + 3.7) - 0.5) * 2.5 + 0.5, 0.0, 1.0);',
  cells: 'vec3 w = mkWorley(p + (vec3(mkNoise(p * 2.0), mkNoise(p * 2.0 + 5.2), mkNoise(p * 2.0 + 9.4)) - 0.5) * 0.35); f = clamp((w.y - w.x) * 2.2, 0.0, 1.0);',
  // each crack at its own level: a lower threshold shows more of them
  cracks: 'f = mkTri(TEX, p, mn).g;',
  veins: 'f = mkTri(TEX, p, mn).b;',
  belly: 'f = 0.5 - 0.5 * mn.y + (mkFbm(p) - 0.5) * 0.3;',
};

/** One marking's turn in the shader: `i` its uniforms, `w` how much of it this point has. */
function layerGLSL(m: Marking, i: number, w: string): string {
  const u = (n: string) => `mk${i}${n}`;
  const shade = `mix(${u('Color')}, markBase, ${u('Own')});
    c = ${u('Dark')} >= 0.0 ? c * (1.0 - ${u('Dark')}) : mix(c, vec3(1.0), -${u('Dark')});`;
  let own: string;
  if (STICKERS.includes(m.type)) {
    own = `
    vec2 uv = vec2(p.x / ${u('Aspect')}, p.y) + 0.5;
    vec4 t = texture2D(${u('Tex')}, uv);
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    // only on the side it faces, and not through onto parts far behind
    float m = t.a * inside * smoothstep(0.0, 0.3, mn.z) * (1.0 - smoothstep(0.4, 0.6, abs(q.z))) * ${u('Amt')} * ${w};
    vec3 c = ${m.type === 'picture' ? 't.rgb;' : shade}`;
  } else if (m.type === 'paint') {
    own = `
    vec4 t = texture(${u('Tex')}, (q - ${u('PMin')}) * ${u('PScale')} + ${u('POff')});
    float f = t.a + (mkNoise(q * 60.0 + 1.3) - 0.5) * ${u('Rough')} * 0.6;
    float soft = max(fwidth(f), 0.02);
    float m = smoothstep(0.5 - soft, 0.5 + soft, f) * ${u('Amt')} * ${w};
    vec3 c = t.rgb;`;
  } else {
    own = `
    float f = 0.0;
    ${FIELD[m.type]!.replace(/TEX/g, u('Tex'))}
    // rough edges: finer noise frays the cut, so it creeps in rather than being painted on
    f += (mkNoise(p * 7.0 + 1.3) - 0.5) * ${u('Rough')} * 0.6;
    float soft = max(fwidth(f), 0.015);
    float m = smoothstep(${u('Thr')} - soft, ${u('Thr')} + soft, f) * ${u('Amt')} * ${w};
    vec3 c = ${shade}`;
  }
  return /* glsl */ `{
    // into the pattern's own space (moved, turned, stretched: see markingPlace)
    vec3 q = (${u('Xf')} * vec4(vMarkPos, 1.0)).xyz;
    vec3 p = q * ${u('Scale')};
    vec3 mn = normalize(${u('XfN')} * vMarkNormal);
    ${own}
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
    const xf = markingPlace(m).invert();
    Object.assign(uniforms, {
      [`mk${i}Xf`]: { value: xf },
      [`mk${i}XfN`]: { value: new THREE.Matrix3().getNormalMatrix(xf) },
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
    if (STICKERS.includes(m.type)) {
      const st = m.type === 'picture' ? pictureSticker(m.picture) : textSticker(m.text ?? '', m.font ?? FONTS[0].css);
      uniforms[`mk${i}Tex`] = { value: st.tex };
      uniforms[`mk${i}Aspect`] = st.aspect;
    } else if (m.type === 'paint') {
      const c = paintCanvas(m);
      Object.assign(uniforms, { [`mk${i}Tex`]: { value: c.tex }, [`mk${i}PMin`]: { value: c.min }, [`mk${i}PScale`]: { value: c.scale }, [`mk${i}POff`]: { value: c.off } });
    }
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
      .map((m, i) => `uniform float mk${i}Scale, mk${i}Thr, mk${i}Rough, mk${i}Amt, mk${i}Dark, mk${i}Own, mk${i}Finish;\nuniform vec3 mk${i}Color;\nuniform mat4 mk${i}Xf;\nuniform mat3 mk${i}XfN;\n` +
          (TEXTURED[m.type] ? `uniform sampler2D mk${i}Tex;\n` : '') +
          (STICKERS.includes(m.type) ? `uniform sampler2D mk${i}Tex;\nuniform float mk${i}Aspect;\n` : '') +
          (m.type === 'paint' ? `uniform highp sampler3D mk${i}Tex;\nuniform vec3 mk${i}PMin, mk${i}PScale, mk${i}POff;\n` : ''),
      )
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
  markings?: Marking[];
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
  if (!s.markingsV) {
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
  if ((s.markingsV ?? 0) < 2) {
    // "Everything" used to give every part a copy: the markings every part has in common belong to the creature now
    const parts = Object.values(s.parts);
    const lists = parts.map((p) => p.markings ?? []);
    let n = 0;
    while (parts.length > 1 && n < lists[0].length && lists.every((l) => l[n] && markingKey(l[n]) === markingKey(lists[0][n]))) n++;
    if (n) {
      s.markings = [...(s.markings ?? []), ...lists[0].slice(0, n)];
      for (const p of parts) {
        p.markings = p.markings!.slice(n);
        if (!p.markings.length) delete p.markings;
      }
    }
  }
  s.markingsV = 2;
}

// ---------------------------------------------------------------------------
// A picture of each marking for the picker: a ball with it on, drawn once
// with the real shader in a small renderer of its own.

let thumbs: Map<MarkingType, string> | null = null;
/** small enough that a few of each fit on the ball (and cracks and veins at their busiest) */
const THUMB: Partial<Record<MarkingType, Partial<Marking>>> = {
  spots: { size: 0.6 }, stripes: { size: 0.6 }, patches: { size: 0.5 }, cells: { size: 0.6 }, belly: { size: 0.6 },
  speckles: { size: 1.4 }, cracks: { size: 1, threshold: 0.15 }, veins: { size: 0.8, threshold: 0.2 },
  picture: { picture: 'demo', size: 1.3 }, text: { text: 'Aa', size: 1.9 },
  paint: { strokes: [demoStroke('#ffffff', 0.05), demoStroke('#3f6fd8', -0.06)] },
};

/** A wavy stroke across the front of the picker's ball (it's 0.25 round), `y` up or down. */
function demoStroke(color: string, y: number): PaintStroke {
  const pts: number[] = [];
  for (let x = -0.17; x <= 0.17; x += 0.01) {
    const py = y + Math.sin(x * 22) * 0.025;
    pts.push(x, py, Math.sqrt(Math.max(0, 0.0625 - x * x - py * py)));
  }
  return { color, r: 0.022, pts };
}

/** The picker's sample picture: a smiling face. */
function demoPicture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd23f';
  g.strokeStyle = '#3b2a1a';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#3b2a1a';
  for (const x of [44, 84]) {
    g.beginPath();
    g.arc(x, 52, 8, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(64, 70, 28, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  return c;
}

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
  const demo = new THREE.CanvasTexture(demoPicture());
  demo.colorSpace = THREE.SRGBColorSpace;
  pictureTex.set('demo', { tex: demo, aspect: { value: 1 } });
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
