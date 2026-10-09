import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import Delaunator from 'delaunator';
import { bvhFor, exactDistance, sharedNormals } from './distance';
import { bounds, buildInflatedGeometry, cleanOutline, getMeshDetail, type Vec2 } from './inflate';
import {
  castsShadow,
  inkNormals,
  makeFuzzShells,
  makeMaterial,
  makeOutlineMaterial,
  makeStrayHairs,
  setOpacity,
  styleSettings,
  type StyleId,
  type StyleSettings,
} from './materials';

/**
 * "Stuff": props made of drawn pieces (a sword, a shield, glasses...) that
 * can be attached to any body part. Coordinates are drawn on the XY plane;
 * the origin is the attach point and +Z faces out of the body.
 */
export interface Piece {
  id: string;
  outline: Vec2[];
  /** cut-outs; only used by flat pieces */
  holes: Vec2[][];
  /**
   * flat = a cut-out with rounded edges; puffy = inflated like a body part;
   * turned = the silhouette spun around the centre line (jars, cups, bottles)
   */
  kind: 'flat' | 'puffy' | 'turned';
  /** flat: depth in world units; puffy: inflation (1 = round); turned: wall thickness */
  thickness: number;
  /** turned: hollow shell rather than solid */
  hollow?: boolean;
  /** turned + hollow: leave the top open */
  open?: boolean;
  /** 1 = solid, lower = see-through */
  opacity?: number;
  /** 0..1: fuse into the pieces it touches with a smooth fillet (0 = hard join) */
  blendShape?: number;
  /** 0..1: fade its color into differently colored pieces it touches (0 = hard edge) */
  blendColor?: number;
  /** flat: how rounded the edges are, 0..1 */
  round: number;
  color: string;
  style: StyleId;
  /** layer offset along Z (in front of / behind other pieces) */
  z: number;
  /**
   * 3D: where this piece's drawing plane sits in the thing, tilted or lifted
   * off the board. Absent = flat on the board like it was drawn.
   */
  place?: PiecePlace;
}

export interface PiecePlace {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface Thing {
  id: string;
  name: string;
  pieces: Piece[];
  /** small preview image (data URL) for the collection */
  thumb?: string;
  /**
   * true = takes the material of whatever wears it (type and settings: the
   * body part it's attached to), instead of each piece's own
   */
  inherit?: boolean;
  /** true = uses its own material settings below instead of the creature's (when not inheriting) */
  ownMaterial?: boolean;
  /** false = felt fuzz grows and shrinks with the item's scale (default: it keeps its real length) */
  scaleMaterial?: boolean;
  materialSettings?: Partial<Record<StyleId, StyleSettings>>;
  /** curve the whole thing, -1..1 (0 = flat as drawn) */
  bend?: number;
  /** axis = curve away from the centre line (a shield's curve, wings); radial = a dome around the crosshair */
  bendMode?: BendMode;
}

export type BendMode = 'axis' | 'radial';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function newThing(): Thing {
  return { id: uid(), name: 'New thing', pieces: [] };
}

export function newPiece(outline: Vec2[], like?: Piece): Piece {
  return {
    id: uid(),
    outline,
    holes: [],
    kind: like?.kind ?? 'flat',
    thickness: like?.thickness ?? 0.04,
    round: like?.round ?? 0.6,
    color: like?.color ?? '#c9ccd6',
    style: like?.style ?? 'plastic',
    z: like?.z ?? 0,
  };
}

// ---------------------------------------------------------------------------
// geometry

const geoCache = new Map<string, THREE.BufferGeometry>();

function tidy(loop: Vec2[]): Vec2[] {
  const b = bounds(loop);
  return cleanOutline(loop, Math.max(b.w, b.h, 0.01) / 90);
}

/** A loop with extra points so no edge is longer than `step` (0 = as it is). */
function densify(loop: Vec2[], step: number, closed = true): Vec2[] {
  if (!(step > 0)) return loop;
  const out: Vec2[] = [];
  const n = closed ? loop.length : loop.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
    const cuts = Math.min(64, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let c = 0; c < cuts; c++) out.push([ax + ((bx - ax) * c) / cuts, ay + ((by - ay) * c) / cuts]);
  }
  if (!closed) out.push(loop[loop.length - 1]);
  return out;
}

/**
 * A piece's mesh. With a `step`, flat and turned pieces come out with points
 * about that far apart all over, fine enough to blend into their neighbours
 * (puffy pieces already are).
 */
export function pieceGeometry(p: Piece, step = 0): THREE.BufferGeometry {
  if (p.kind === 'puffy') step = 0;
  const key = JSON.stringify([step, p.outline, p.holes, p.kind, p.thickness, p.round, p.z, p.hollow, p.open, p.style === 'lowpoly', p.style === 'clay' || p.style === 'stone', p.kind === 'puffy' ? getMeshDetail() : 1]);
  const hit = geoCache.get(key);
  if (hit) return hit;
  if (geoCache.size > 120) geoCache.clear();

  let g: THREE.BufferGeometry;
  if (p.kind === 'puffy') {
    g = buildInflatedGeometry(p.outline, { thickness: p.thickness, lowPoly: p.style === 'lowpoly', lumps: p.style === 'clay' || p.style === 'stone' ? 1 : 0, holes: p.holes });
  } else if (p.kind === 'turned') {
    g = turnedGeometry(p, step);
    if (p.style === 'lowpoly') {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
  } else {
    const shape = new THREE.Shape(densify(tidy(p.outline), step).map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of p.holes) shape.holes.push(new THREE.Path(densify(tidy(h), step).map(([x, y]) => new THREE.Vector2(x, y))));
    const depth = Math.max(0.003, p.thickness);
    const bevel = Math.min(depth * 0.45, 0.03) * p.round;
    const core = Math.max(0.001, depth - 2 * bevel);
    const ex = new THREE.ExtrudeGeometry(shape, {
      depth: core,
      bevelEnabled: bevel > 0.0005,
      bevelThickness: bevel,
      bevelSize: bevel * 0.85,
      bevelOffset: -bevel * 0.85, // keep the drawn silhouette size
      bevelSegments: 4,
      curveSegments: 1,
      steps: 1,
    });
    ex.translate(0, 0, -core / 2);
    // smooth shading across the bevel, crisp where the edges are sharp
    g = toCreasedNormals(ex, Math.PI / 3.2);
    ex.dispose();
    // its faces are group 0: remeshed if the thing gets bent
    g.userData.flatCaps = true;
    if (step > 0) {
      // the sides are already that fine: the faces get an even mesh to match
      const fine = remeshCaps(g, step);
      g.dispose();
      g = fine;
    }
    if (p.style === 'lowpoly') {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
  }
  g.translate(0, 0, p.z);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

/** Who's wearing (or showing) a thing: their material, for items that inherit it. */
export interface Wearer {
  /** the material of the body part it's on */
  style: StyleId;
  settingsFor: (s: StyleId) => StyleSettings;
}

/** The material a piece is actually shown in, and with which settings. */
export function pieceLook(thing: Thing, p: Piece, wearer: Wearer): { style: StyleId; k: StyleSettings } {
  if (thing.inherit) return { style: wearer.style, k: wearer.settingsFor(wearer.style) };
  const k = thing.ownMaterial ? styleSettings(p.style, thing.materialSettings?.[p.style]) : wearer.settingsFor(p.style);
  return { style: p.style, k };
}

/**
 * Build the meshes for a thing. Pieces are tagged with userData.pieceId.
 * `unit` is how much the thing will be scaled up, so felt fuzz and toon ink
 * keep their real size.
 */
export function buildThing(thing: Thing, wearer: Wearer, unit = 1): THREE.Group {
  const group = new THREE.Group();
  const looks = thing.pieces.map((raw) => {
    const { style, k } = pieceLook(thing, raw, wearer);
    // low-poly and clay shape the mesh itself
    return { p: style === raw.style ? raw : { ...raw, style }, style, k };
  });
  const shapes = blendedGeometries(looks.map((l) => l.p), thingBend(thing));
  looks.forEach(({ p, style, k }, i) => {
    const { geo, painted } = shapes[i];
    const mesh = new THREE.Mesh(geo, makeMaterial(style, p.color, k));
    // soft (VSM) shadows draw receivers into the shadow map too: a glass jar
    // would block the light from whatever's inside it
    mesh.castShadow = mesh.receiveShadow = castsShadow(style);
    mesh.userData.pieceId = p.id;
    if (style === 'toon' && k.ink > 0) {
      // flat and turned pieces have hard edges: an outline along smoothed
      // normals stays in one piece. Ink width is in world units, like the body's.
      const ink = new THREE.Mesh(inkNormals(geo), makeOutlineMaterial(k.ink / unit, true, k, unit));
      ink.raycast = () => {};
      mesh.add(ink);
    }
    if (style === 'felt') {

      for (const shell of makeFuzzShells(geo, p.color, k, 8, unit)) mesh.add(shell);
      if (k.hairs > 0) mesh.add(makeStrayHairs(geo, p.color, 7, k.hairs * 0.6, false, unit, k.fuzz));
    }
    if (painted) {
      // colors come from the blend baked into the geometry: white * vertex color
      // (body and fuzz shells; stray hairs keep their own per-hair colors)
      for (const o of [mesh, ...mesh.children]) {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (!(o instanceof THREE.Mesh) || !m || !('color' in m) || m.userData?.ink) continue;
        m.vertexColors = true;
        m.color.setRGB(1, 1, 1);
        m.needsUpdate = true;
      }
    }
    setOpacity(mesh, p.opacity ?? 1);
    if (p.place) {
      mesh.position.set(...p.place.position);
      mesh.quaternion.set(...p.place.quaternion);
    }
    group.add(mesh);
  });
  return group;
}

// ---------------------------------------------------------------------------
// bending the whole thing: drawn flat, then wrapped onto a cylinder whose axis
// runs along the centre line (axis), or onto a sphere around the crosshair
// (radial). Positive bends curve the edges back (-Z), like a shield.

interface ThingBend {
  mode: BendMode;
  /** signed radius of the curve; its centre sits at z = -r */
  r: number;
  /** how far the farthest drawn point is from the centre line (or crosshair) */
  reach: number;
}

function thingBend(thing: Thing): ThingBend | null {
  const amount = thing.bend ?? 0;
  if (Math.abs(amount) < 0.005 || !thing.pieces.length) return null;
  const mode = thing.bendMode ?? 'axis';
  // at full bend the farthest edge has turned a quarter circle
  let reach = 0;
  for (const p of thing.pieces) if (!p.place) for (const [x, y] of p.outline) reach = Math.max(reach, mode === 'axis' ? Math.abs(x) : Math.hypot(x, y));
  if (reach < 1e-4) return null;
  return { mode, r: reach / (amount * (Math.PI / 2)), reach };
}

/**
 * Bending needs a mesh fine enough to follow the curve. A flat cut-out's two
 * faces are long slivers fanned between its outline points: bent, each stays a
 * flat plane and the curve comes out lumpy and stretched. They're rebuilt as an
 * even mesh (about 7 degrees of the curve apart); anything else with edges
 * that long has them cut down. Already-fine meshes (puffy pieces) are left alone.
 */
function refineForBend(src: THREE.BufferGeometry, bd: ThingBend): THREE.BufferGeometry {
  return refine(src, Math.min(Math.max(Math.abs(bd.r) * 0.12, bd.reach / 40), bd.reach / 4));
}

/** A mesh with points no further than about `step` apart (see refineForBend). */
function refine(src: THREE.BufferGeometry, step: number): THREE.BufferGeometry {
  if (src.userData.flatCaps) src = remeshCaps(src, step);
  // an even mesh's edges run a little over its spacing
  const max = step * 2;
  const pos = src.getAttribute('position');
  const index = src.getIndex();
  const v = (k: number, out: THREE.Vector3) => out.fromBufferAttribute(pos, index ? index.getX(k) : k);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const count = index ? index.count : pos.count;
  let long = false;
  for (let k = 0; k < count && !long; k += 3) {
    v(k, a), v(k + 1, b), v(k + 2, c);
    long = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > max;
  }
  if (!long) return src;
  // each pass splits a triangle's longest edge once: enough passes to bring a
  // sliver as long as the whole piece down to size
  return new TessellateModifier(max, 48).modify(src);
}

/**
 * Rebuild a flat cut-out's front and back faces (group 0 of an extrusion) as an
 * even triangle mesh with `step` spacing, keeping the outline points so they
 * still meet the sides. Holes come along: a triangle is kept only inside the
 * original faces.
 */
function remeshCaps(src: THREE.BufferGeometry, step: number): THREE.BufferGeometry {
  const capGroup = src.groups.find((g) => g.materialIndex === 0);
  if (!capGroup || src.getIndex()) return src;
  const pos = src.getAttribute('position');
  const nor = src.getAttribute('normal');
  const col = src.getAttribute('color');
  const out = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };

  for (const front of [true, false]) {
    // the original triangles of this face, flat at one depth
    const tris: number[][] = [];
    let z = 0;
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i += 3) {
      if (nor.getZ(i) > 0 !== front) continue;
      z = pos.getZ(i);
      tris.push([0, 1, 2].flatMap((k) => [pos.getX(i + k), pos.getY(i + k)]));
    }
    if (!tris.length) continue;
    const ccw = (t: number[]) => (t[2] - t[0]) * (t[5] - t[1]) - (t[3] - t[1]) * (t[4] - t[0]) > 0;
    const wantCcw = ccw(tris[0]);
    // inside the face: in one of its triangles (a hair of slack for points on the outline)
    const eps = step * 1e-4;
    const inTri = (t: number[], x: number, y: number) => {
      const s = ccw(t) ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        const ax = t[k * 2], ay = t[k * 2 + 1], bx = t[((k + 1) % 3) * 2], by = t[((k + 1) % 3) * 2 + 1];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        if ((s * ((bx - ax) * (y - ay) - (by - ay) * (x - ax))) / l < -eps) return false;
      }
      return true;
    };
    const inside = (x: number, y: number) => tris.some((t) => inTri(t, x, y));

    // the outline points, once each
    const pts: Vec2[] = [];
    const seen = new Set<string>();
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const key = `${t[k * 2].toFixed(5)},${t[k * 2 + 1].toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pts.push([t[k * 2], t[k * 2 + 1]]);
      }
    }
    const nb = pts.length;
    // a hex lattice inside, kept clear of the outline
    const bb = bounds(pts);
    const rowH = (step * Math.sqrt(3)) / 2;
    const clear2 = (step * 0.5) ** 2;
    for (let row = 0, y = bb.minY + rowH / 2; y < bb.maxY; y += rowH, row++) {
      for (let x = bb.minX + (row % 2 ? step : step / 2); x < bb.maxX; x += step) {
        if (!inside(x, y)) continue;
        let near = false;
        for (let i = 0; i < nb && !near; i++) near = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2 < clear2;
        if (!near) pts.push([x, y]);
      }
    }

    const tiny = (Math.max(bb.w, bb.h) * 1e-5) ** 2;
    const del = new Delaunator(pts.flat());
    const t = del.triangles;
    for (let k = 0; k < t.length; k += 3) {
      let a = t[k], b = t[k + 1], c = t[k + 2];
      const [ax, ay] = pts[a], [bx, by] = pts[b], [cx, cy] = pts[c];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(cross) < tiny) continue;
      // centre and edge midpoints all inside: drops triangles across notches and holes
      if (!inside((ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
      if (!inside((ax + bx) / 2, (ay + by) / 2) || !inside((bx + cx) / 2, (by + cy) / 2) || !inside((cx + ax) / 2, (cy + ay) / 2)) continue;
      if (cross > 0 !== wantCcw) [b, c] = [c, b];
      for (const v of [a, b, c]) {
        out.pos.push(pts[v][0], pts[v][1], z);
        out.nor.push(0, 0, front ? 1 : -1);
        out.uv.push(pts[v][0], pts[v][1]);
      }
    }
  }

  // the new faces, then the extrusion's sides as they were
  const sideStart = capGroup.start + capGroup.count;
  const sides = pos.count - sideStart;
  const n = out.pos.length / 3;
  const g = new THREE.BufferGeometry();
  const join = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, first: number[]) => {
    const size = attr.itemSize;
    const arr = new Float32Array((n + sides) * size);
    arr.set(first);
    for (let i = 0; i < sides; i++) for (let c = 0; c < size; c++) arr[(n + i) * size + c] = attr.getComponent(sideStart + i, c);
    return new THREE.BufferAttribute(arr, size);
  };
  g.setAttribute('position', join(pos, out.pos));
  g.setAttribute('normal', join(nor, out.nor));
  const uv = src.getAttribute('uv');
  if (uv) g.setAttribute('uv', join(uv, out.uv));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((n + sides) * 3).fill(1), 3));
  g.addGroup(0, n, 0);
  g.addGroup(n, sides, 1);
  return g;
}

const bentCache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

function bentGeometry(src: THREE.BufferGeometry, bd: ThingBend): THREE.BufferGeometry {
  const key = `${bd.mode}:${bd.r.toFixed(5)}`;
  let per = bentCache.get(src);
  const hit = per?.get(key);
  if (hit) return hit;
  const refined = refineForBend(src, bd);
  const g = refined === src ? src.clone() : refined;
  // a clone shares the source's userData: its faces aren't flat any more, and
  // its ink and shared normals get worked out again for the curved shape
  g.userData = {};
  g.deleteAttribute('inkNormal');
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const r0 = bd.r;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // unit direction away from the centre (line or point) in the drawing plane
    let ux = 1, uy = 0, d = x;
    if (bd.mode === 'radial') {
      d = Math.hypot(x, y);
      if (d > 1e-9) {
        ux = x / d;
        uy = y / d;
      }
    }
    const phi = d / r0;
    const c = Math.cos(phi), sn = Math.sin(phi);
    const rr = r0 + z;
    // along the curve: the drawing distance becomes arc length on a circle of radius r
    const along = rr * sn;
    if (bd.mode === 'axis') pos.setXYZ(i, along, y, rr * c - r0);
    else pos.setXYZ(i, ux * along, uy * along, rr * c - r0);
    if (nor) {
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      const nu = nx * ux + ny * uy;
      const nu2 = nu * c + nz * sn;
      nor.setXYZ(i, nx + (nu2 - nu) * ux, ny + (nu2 - nu) * uy, -nu * sn + nz * c);
    }
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  if (!per) bentCache.set(src, (per = new Map()));
  if (per.size > 8) per.clear();
  per.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------
// blending pieces: like the creature's merged parts (see Creature.fuse), each
// piece's surface is pulled onto the smooth union with the pieces it touches,
// and its color fades into theirs from the seam where the two meet.

/** fillet size at a Blend shape of 1 (thing units) */
const SHAPE_MAX = 0.15;
/** width of the color fade at a Blend color of 1, either side of the seam */
const COLOR_MAX = 0.3;

interface BlendLink {
  other: number;
  /** fillet size (0 = shape left alone) */
  k: number;
  /** color fade width (0 = no tint) */
  fade: number;
}

const placeMatrix = (p: Piece) =>
  p.place
    ? new THREE.Matrix4().compose(new THREE.Vector3(...p.place.position), new THREE.Quaternion(...p.place.quaternion), new THREE.Vector3(1, 1, 1))
    : new THREE.Matrix4();

/** Each piece's geometry in its own space, fused and painted where it blends with its neighbours. */
function blendedGeometries(pieces: Piece[], bend: ThingBend | null): { geo: THREE.BufferGeometry; painted: boolean }[] {
  const shaped = (p: Piece, g: THREE.BufferGeometry) => (bend && !p.place ? bentGeometry(g, bend) : g);
  const raw = pieces.map((p) => pieceGeometry(p));
  let base = pieces.map((p, i) => shaped(p, raw[i]));
  if (!pieces.some((p) => (p.blendShape ?? 0) > 0 || (p.blendColor ?? 0) > 0)) return base.map((geo) => ({ geo, painted: false }));

  const mats = pieces.map(placeMatrix);
  const boxes = base.map((g, i) => {
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!.clone().applyMatrix4(mats[i]);
  });
  const extent = (b: THREE.Box3) => b.getSize(new THREE.Vector3());
  const links: BlendLink[][] = pieces.map(() => []);
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      // a piece blends with whatever it touches, whether or not that one asks to
      const s = Math.max(a.blendShape ?? 0, b.blendShape ?? 0);
      const c = a.color.toLowerCase() === b.color.toLowerCase() ? 0 : Math.max(a.blendColor ?? 0, b.blendColor ?? 0);
      if (s < 0.005 && c < 0.005) continue;
      // keep fillets in proportion: a thin plate shouldn't get a big blob
      const ea = extent(boxes[i]), eb = extent(boxes[j]);
      const thin = Math.min(ea.x, ea.y, ea.z, eb.x, eb.y, eb.z);
      const k = s < 0.005 ? 0 : Math.max(0.003, Math.min(s * SHAPE_MAX, thin));
      const fade = c < 0.005 ? 0 : c * COLOR_MAX;
      if (!boxes[i].clone().expandByScalar(Math.max(k, 0.005)).intersectsBox(boxes[j])) continue;
      links[i].push({ other: j, k, fade });
      links[j].push({ other: i, k, fade });
    }
  }

  // fine enough meshes to carry a fillet and a fade (flat faces are bare slivers)
  base = base.map((g, i) => {
    if (!links[i].length || pieces[i].kind === 'puffy') return g;
    const size = extent(boxes[i]);
    const finest = Math.max(size.x, size.y, size.z) / 60;
    const want = Math.min(...links[i].map((l) => Math.min(l.k > 0 ? l.k / 2 : Infinity, l.fade > 0 ? l.fade / 3 : Infinity)));
    // a few sizes only, so dragging a slider reuses them
    const step = 2 ** (Math.round(Math.log2(Math.max(finest, Math.min(want, finest * 4))) * 3) / 3);
    return shaped(pieces[i], pieceGeometry(pieces[i], step));
  });
  for (const g of base) if (!g.boundingBox) g.computeBoundingBox();

  return pieces.map((p, i) => {
    if (!links[i].length) return { geo: base[i], painted: false };
    const nbrs = links[i].map((l) => ({
      geo: base[l.other],
      // from this piece's space into the neighbour's
      toO: mats[l.other].clone().invert().multiply(mats[i]),
      k: l.k,
      fade: l.fade,
      color: new THREE.Color(pieces[l.other].color),
    }));
    return fusePiece(base[i], new THREE.Color(p.color), nbrs);
  });
}

interface BlendNeighbour {
  geo: THREE.BufferGeometry;
  toO: THREE.Matrix4;
  k: number;
  fade: number;
  color: THREE.Color;
}

type Field = { f: Float32Array; g: Float32Array };
const fieldCache = new WeakMap<THREE.BufferGeometry, Map<string, Field>>();

/**
 * Signed distance from each of this piece's points to a neighbour's surface
 * (Infinity past `maxD`), with the outward direction in this piece's space.
 */
function distanceField(base: THREE.BufferGeometry, o: BlendNeighbour, maxD: number): Field {
  const key = [o.geo.uuid, maxD, ...o.toO.elements.map((v) => v.toFixed(6))].join(',');
  let per = fieldCache.get(base);
  const hit = per?.get(key);
  if (hit) return hit;
  const p0 = base.getAttribute('position');
  const fld: Field = { f: new Float32Array(p0.count).fill(Infinity), g: new Float32Array(p0.count * 3) };
  const box = o.geo.boundingBox!.clone().expandByScalar(maxD);
  const bvh = bvhFor(o.geo);
  const normals = sharedNormals(o.geo);
  const back = new THREE.Matrix3().setFromMatrix4(o.toO.clone().invert());
  const q = new THREE.Vector3(), grad = new THREE.Vector3();
  for (let i = 0; i < p0.count; i++) {
    q.fromBufferAttribute(p0, i).applyMatrix4(o.toO);
    if (!box.containsPoint(q)) continue;
    const f = exactDistance(o.geo, bvh, normals, q, maxD, grad);
    fld.f[i] = f;
    if (f < Infinity) grad.applyMatrix3(back).normalize().toArray(fld.g, i * 3);
  }
  if (!per) fieldCache.set(base, (per = new Map()));
  if (per.size > 16) per.clear();
  per.set(key, fld);
  return fld;
}

/**
 * Where this piece's surface crosses into a neighbour: points along the
 * edges whose ends sit either side of its surface.
 */
function seamPoints(base: THREE.BufferGeometry, f: Float32Array): number[] {
  const pos = base.getAttribute('position');
  const index = base.getIndex();
  const count = index ? index.count : pos.count;
  const at = (k: number) => (index ? index.getX(k) : k);
  const out: number[] = [];
  for (let t = 0; t < count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = at(t + e), b = at(t + ((e + 1) % 3));
      const fa = f[a], fb = f[b];
      if (!(fa < Infinity && fb < Infinity) || fa < 0 === fb < 0) continue;
      const s = fa / (fa - fb);
      for (let c = 0; c < 3; c++) out.push(pos.getComponent(a, c) + (pos.getComponent(b, c) - pos.getComponent(a, c)) * s);
    }
  }
  return out;
}

/** Distance from each point to the nearest seam point, up to `maxD` (Infinity beyond). */
function seamDistance(base: THREE.BufferGeometry, seam: number[], maxD: number): Float32Array {
  const pos = base.getAttribute('position');
  const out = new Float32Array(pos.count).fill(Infinity);
  if (!seam.length) return out;
  // a grid of maxD-sized cells: only the neighbouring cells can be close enough
  const cell = (v: number) => Math.floor(v / maxD);
  const grid = new Map<string, number[]>();
  for (let s = 0; s < seam.length; s += 3) {
    const key = `${cell(seam[s])},${cell(seam[s + 1])},${cell(seam[s + 2])}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(s);
  }
  const max2 = maxD * maxD;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = cell(x), cy = cell(y), cz = cell(z);
    let best = max2;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (list) for (const s of list) best = Math.min(best, (seam[s] - x) ** 2 + (seam[s + 1] - y) ** 2 + (seam[s + 2] - z) ** 2);
        }
    if (best < max2) out[i] = Math.sqrt(best);
  }
  return out;
}

const fusedCache = new Map<string, { geo: THREE.BufferGeometry; painted: boolean }>();

/**
 * Fuse a piece's surface into its neighbours (smooth-min fillet) and paint a
 * color fade that meets 50/50 at the seam. Fades are measured from where the
 * surfaces cross rather than how close they are, so a piece layered over
 * another only fades near its edge, not all over.
 */
function fusePiece(base: THREE.BufferGeometry, own: THREE.Color, nbrs: BlendNeighbour[]): { geo: THREE.BufferGeometry; painted: boolean } {
  const key = [base.uuid, own.getHex(), ...nbrs.flatMap((o) => [o.geo.uuid, o.k, o.fade, o.color.getHex(), ...o.toO.elements.map((v) => v.toFixed(6))])].join(';');
  const hit = fusedCache.get(key);
  if (hit) return hit;

  const p0 = base.getAttribute('position') as THREE.BufferAttribute;
  const nOwn = base.getAttribute('normal') as THREE.BufferAttribute;
  // shared-corner normals so split (creased, low-poly) points all move the same way
  const n0 = sharedNormals(base);
  // far enough out to find where the surfaces cross, even on a coarse mesh
  const fields = nbrs.map((o) => distanceField(base, o, Math.max(o.k, 0.08)));

  const g = base.clone();
  g.userData = {};
  g.deleteAttribute('inkNormal');
  const p1 = g.getAttribute('position') as THREE.BufferAttribute;
  const n1 = g.getAttribute('normal') as THREE.BufferAttribute;

  // colors first, from the unmoved surface
  const fades = nbrs.map((o, j) => (o.fade > 0 ? seamDistance(base, seamPoints(base, fields[j].f), o.fade) : null));
  const painted = fades.some((d) => d?.some((v) => v < Infinity));
  if (painted) {
    // low-poly keeps its per-facet shading variation underneath the tint
    const jitter = base.getAttribute('color') as THREE.BufferAttribute | undefined;
    const c1 = new THREE.BufferAttribute(new Float32Array(p0.count * 3), 3);
    const col = new THREE.Color();
    for (let i = 0; i < p0.count; i++) {
      col.copy(own);
      nbrs.forEach((o, j) => {
        const s = fades[j]?.[i] ?? Infinity;
        if (s >= o.fade) return;
        // 50/50 at the seam, fading to our own color `fade` away from it
        const t = 1 - s / o.fade;
        col.lerp(o.color, 0.5 * t * t * (3 - 2 * t));
      });
      const jv = jitter ? jitter.getX(i) : 1;
      c1.setXYZ(i, col.r * jv, col.g * jv, col.b * jv);
    }
    g.setAttribute('color', c1);
  }

  if (nbrs.some((o) => o.k > 0)) {
    const pw = new THREE.Vector3(), nw = new THREE.Vector3(), gw = new THREE.Vector3(), gsum = new THREE.Vector3();
    for (let i = 0; i < p0.count; i++) {
      // running smooth-min of (this surface = 0, each neighbour's distance)
      let d = 0, kk = 0;
      gsum.fromBufferAttribute(n0, i);
      for (let j = 0; j < nbrs.length; j++) {
        const k = nbrs[j].k;
        const f = fields[j].f[i];
        if (!(k > 0) || f >= k) continue;
        gw.fromArray(fields[j].g, i * 3);
        const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (f - d)) / k));
        d = f * (1 - h) + d * h - k * h * (1 - h);
        gsum.multiplyScalar(h).addScaledVector(gw, 1 - h);
        kk = Math.max(kk, k);
      }
      if (!kk) continue;
      // Deep inside a neighbour: leave it hidden. In the blend band: one
      // Newton step onto the fused surface.
      const w = 1 - Math.min(1, Math.max(0, (-d - 0.3 * kk) / (0.5 * kk)));
      const g2 = Math.max(gsum.lengthSq(), 0.05);
      const step = Math.max(-kk, Math.min(kk * 1.5, (-d / g2) * w));
      pw.fromBufferAttribute(p0, i).addScaledVector(gsum, step);
      nw.fromBufferAttribute(nOwn, i).lerp(gsum.normalize(), w).normalize();
      p1.setXYZ(i, pw.x, pw.y, pw.z);
      n1.setXYZ(i, nw.x, nw.y, nw.z);
    }
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const res = { geo: g, painted };
  // still-shown meshes just upload theirs again if they're dropped here
  if (fusedCache.size > 60) {
    for (const v of fusedCache.values()) v.geo.dispose();
    fusedCache.clear();
  }
  fusedCache.set(key, res);
  return res;
}

/**
 * Radius of the drawn silhouette at height y: the farthest crossing from the
 * centre line on either side, so a half-drawn or whole outline both work.
 */
function radiusAt(outline: Vec2[], y: number): number | null {
  let best: number | null = null;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if (yi > y === yj > y) continue;
    const x = xi + ((y - yi) / (yj - yi)) * (xj - xi);
    best = Math.max(best ?? 0, Math.abs(x));
  }
  return best;
}

/** Spin the silhouette's profile around the Y axis (the drawing's centre line). */
function turnedGeometry(p: Piece, step = 0): THREE.BufferGeometry {
  let pts = turnedProfile(p);
  if (pts.length < 3) return new THREE.BufferGeometry();
  let around = 64;
  if (step > 0) {
    pts = densify(pts.map((v) => [v.x, v.y] as Vec2), step, false).map(([x, y]) => new THREE.Vector2(x, y));
    around = Math.min(256, Math.max(64, Math.ceil((2 * Math.PI * Math.max(...pts.map((v) => v.x))) / step)));
  }
  const g = new THREE.LatheGeometry(pts, around);
  // smooth round shading but keep the rim and base edges crisp
  const out = toCreasedNormals(g, Math.PI / 4);
  g.dispose();
  return out;
}

/** The (radius, height) polyline that gets spun around the Y axis. */
export function turnedProfile(p: Piece): THREE.Vector2[] {
  const b = bounds(p.outline);
  const steps = 96;
  const y0 = b.minY, y1 = b.maxY;

  // The outer profile as a radius per height. Being single-valued in y, it
  // can't fold back on itself however wobbly the drawing is.
  const ys: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i <= steps; i++) {
    // pull the sample heights slightly inside so the scanline always hits the outline
    const y = y0 + (y1 - y0) * (0.002 + (0.996 * i) / steps);
    const r = radiusAt(p.outline, y);
    if (r === null || r < 1e-4) continue;
    ys.push(y);
    rs.push(r);
  }
  if (rs.length < 3) return [];

  // Smooth away hand wobble: a small median first (kills spikes), then a few
  // gentle averaging passes. Ends are kept so the base and rim stay put.
  const med = rs.map((_, i) => {
    const w = rs.slice(Math.max(0, i - 2), i + 3).sort((a, c) => a - c);
    return w[w.length >> 1];
  });
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < med.length - 1; i++) med[i] = med[i] * 0.5 + (med[i - 1] + med[i + 1]) * 0.25;
  }
  const n = med.length;
  const bottom = ys[0], top = ys[n - 1];
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, bottom)];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(med[i], ys[i]));

  const wall = Math.max(0.002, Math.min(p.thickness, (top - bottom) * 0.4));
  if (!p.hollow) {
    pts.push(new THREE.Vector2(0, top));
  } else {
    // Inner wall = the outer radius eroded by a disc of radius `wall`: an even
    // wall thickness that never self-intersects (unlike pushing points along
    // their normals, which folds wherever the drawing wobbles).
    const floorY = bottom + wall;
    const ceilY = p.open ? top : top - wall;
    const innerAt = (y: number) => {
      let r = Infinity;
      for (let j = 0; j < n; j++) {
        const dy = ys[j] - y;
        if (Math.abs(dy) >= wall) continue;
        r = Math.min(r, med[j] - Math.sqrt(wall * wall - dy * dy));
      }
      return Math.max(0.0005, Number.isFinite(r) ? r : 0.0005);
    };
    // inner profile from the ceiling (or rim) down to a flat floor
    const inner: THREE.Vector2[] = [new THREE.Vector2(innerAt(ceilY), ceilY)];
    for (let i = n - 1; i >= 0; i--) {
      if (ys[i] >= ceilY || ys[i] <= floorY) continue;
      inner.push(new THREE.Vector2(innerAt(ys[i]), ys[i]));
    }
    inner.push(new THREE.Vector2(innerAt(floorY), floorY));
    if (p.open) {
      // flat rim across the top of the wall, then down the inside
      pts.push(...inner);
    } else {
      // sealed: close the top, then a flat ceiling and down the cavity
      pts.push(new THREE.Vector2(0, top), new THREE.Vector2(0, ceilY), ...inner);
    }
    pts.push(new THREE.Vector2(0, floorY));
  }
  return pts;
}

export function disposeThing(group: THREE.Object3D) {
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
    if (o instanceof THREE.LineSegments) o.geometry.dispose();
  });
}

// ---------------------------------------------------------------------------
// collection (browser storage)

const LIB_KEY = 'creature-creator/stuff';

export function collection(): Thing[] {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) ?? '[]') as Thing[];
  } catch {
    return [];
  }
}

function writeCollection(list: Thing[]): boolean {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Empty My stuff. */
export function clearCollection() {
  writeCollection([]);
}

/** Add or replace (by id). Returns false if browser storage is full. */
export function putThing(thing: Thing): boolean {
  // replaced where it is, so the collection keeps its order
  const list = collection();
  const i = list.findIndex((t) => t.id === thing.id);
  if (i >= 0) list[i] = structuredClone(thing);
  else list.push(structuredClone(thing));
  return writeCollection(list);
}

export function removeThing(id: string) {
  writeCollection(collection().filter((t) => t.id !== id));
}

// ---------------------------------------------------------------------------
// files: JSON with a small header so the app can tell what it's opening

// the app's old name; kept (like the creature-creator/ storage keys) so existing saves still open
export const FILE_FORMAT = 'creature-creator';
/** 2: a .creature file holds a whole bundle (creatures, stuff, body plans, backdrop) */
export const FILE_VERSION = 2;

export type FileKind = 'creature' | 'scene' | 'stuff' | 'collection' | 'library';

export interface FileEnvelope<T = unknown> {
  format: typeof FILE_FORMAT;
  kind: FileKind;
  version: number;
  savedAt: string;
  data: T;
}

export function envelope<T>(kind: FileKind, data: T): FileEnvelope<T> {
  return { format: FILE_FORMAT, kind, version: FILE_VERSION, savedAt: new Date().toISOString(), data };
}

export function parseEnvelope(text: string): FileEnvelope {
  const obj = JSON.parse(text) as Partial<FileEnvelope>;
  if (obj.format !== FILE_FORMAT || !obj.kind || obj.data === undefined) {
    throw new Error("This doesn't look like a CritterKiln file.");
  }
  if ((obj.version ?? 1) > FILE_VERSION) throw new Error('This file was made by a newer version of CritterKiln.');
  return obj as FileEnvelope;
}

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFileName(name: string, fallback: string): string {
  const s = name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 60);
  return s || fallback;
}
