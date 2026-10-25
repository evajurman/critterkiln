// ---------------------------------------------------------------------------
// Eye styles. Each eye is built in a frame where +Z points out of the face,
// +Y is "up" on the face, and the origin sits on the surface.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowMaterial, makeMaterial, makeOutlineMaterial, inkNormals, setTextureSpace, styleSettings, type StyleId, type StyleSettings } from './materials';
import type { V3 } from './rigs';
import type { EyeFinish, EyesState, EyeStyle } from './creature';
const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
const glossyWhite = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1 });
const glossyBlack = () => new THREE.MeshPhysicalMaterial({ color: 0x1b1720, roughness: 0.12, clearcoat: 1 });

/**
 * A sphere built at its real size (rather than a unit sphere scaled down), so
 * textured materials keep the same density and bump strength as the head.
 */
function realSphere(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = sphereGeo.clone().scale(sx, sy, sz);
  // low-poly materials read per-vertex color
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  return g;
}

const shapedSphereGeo = new THREE.SphereGeometry(1, 64, 40);

/**
 * A bead / dot squeezed into an expression: the lids cut it top and bottom
 * (each column keeps a round cross-section, so the cut eye stays a smooth
 * pebble with tapered corners), the crescent bends it into an arch or a cup,
 * and the tilt turns it, mirrored so both eyes lean toward or away from the nose.
 * `keepDepth` (0..1): how much of its depth a cut column keeps. A bead sits
 * sunk into the face, so it keeps all of it (cut thinner, it would sink under
 * the skin); a dot lies on it, and thins out with the cut.
 */
function shapedEye(sx: number, sy: number, sz: number, sgn: number, e: EyesState, keepDepth = 0): THREE.BufferGeometry {
  const top = e.lidTop ?? 1;
  const bottom = e.lidBottom ?? -1;
  const crescent = e.crescent ?? 0;
  const tilt = e.tilt ?? 0;
  if (top >= 1 && bottom <= -1 && !crescent && !tilt) return realSphere(sx, sy, sz);

  // the lids never quite meet
  const t = Math.min(1, Math.max(top, bottom + 0.08));
  const b = Math.max(-1, Math.min(bottom, t - 0.08));
  // how far across the cut eye reaches: where the circle still spans both lids
  const cut = Math.max(0, b, -t);
  const reach = Math.sqrt(1 - cut * cut);
  const bend = crescent * 0.7;
  // mirrored, so +tilt drops each eye's inner corner (local -X faces the nose on the left eye)
  const angle = (sgn || 1) * tilt * (Math.PI / 4);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  const g = shapedSphereGeo.clone();
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = Math.sqrt(Math.max(0, 1 - x * x));
    // squeezed across so the cut eye ends in a point rather than a collapsed sliver
    const nx = x * reach;
    const nh = Math.sqrt(Math.max(0, 1 - nx * nx));
    const lo = Math.max(b, -nh), hi = Math.min(t, nh);
    const mid = (lo + hi) / 2, half = Math.max(0, (hi - lo) / 2);
    // each column of the sphere becomes a circle spanning just the open part
    const k = h > 1e-6 ? half / h : 0;
    // the arch rises in the middle, kept centred on the eye
    const ny = mid + y * k + bend * (0.5 - x * x);
    const px = nx * sx, py = ny * sy;
    pos.setXYZ(i, px * cos - py * sin, px * sin + py * cos, z * (k + (1 - k) * keepDepth) * sz);
  }
  const merged = mergeVertices(g);
  g.dispose();
  merged.computeVertexNormals();
  // low-poly materials read per-vertex color
  merged.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(merged.getAttribute('position').count * 3).fill(1), 3));
  return merged;
}

/** Material for bead / dot / button eyes. */
function eyeMaterial(finish: EyeFinish, color: string, headStyle: StyleId, headSettings: StyleSettings): THREE.Material {
  switch (finish) {
    case 'gloss':
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
    case 'matte':
      return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    case 'glass':
      // a colored glass marble: strong tint so the color reads
      return makeMaterial('glass', color, { ...styleSettings('glass'), ...(headStyle === 'glass' ? headSettings : {}), tint: 0.85 });
    default:
      // glass: tinted strongly, or a dark eye color barely shows through clear glass
      return makeMaterial(headStyle, color, headStyle === 'glass' ? { ...headSettings, tint: Math.max(headSettings.tint, 0.85) } : headSettings);
  }
}

/** An eye's material, glowing in its color as much as the eyes are set to. */
function eyeGlow(m: THREE.Material, color: string, e: EyesState): THREE.Material {
  glowMaterial(m, color, e.glow ?? 0, { follow: e.glowFollow });
  return m;
}

/** Pupil size as a scale on the default, 0.5x .. 1.5x. */
function pupilScale(e: EyesState): number {
  return 0.5 + (e.pupil ?? 0.5);
}

/** A pupil's width and height against round, for Cat eye: narrowed to a slit, a touch taller. */
function catShape(e: EyesState): [number, number] {
  const c = e.cat ?? 0;
  return [1 - 0.78 * c, 1 + 0.25 * c];
}

/**
 * `sgn` is which side the eye is on: 1 the creature's left (+X), -1 its right,
 * 0 a single eye in the middle (which has no other eye to cross with).
 */
export function buildEye(style: EyeStyle, r: number, sgn: number, headStyle: StyleId, headSettings: StyleSettings, e: EyesState): THREE.Object3D {
  const g = new THREE.Group();
  // crossing turns each pupil toward the middle (-X on the left eye, +X on the right)
  const crossX = -sgn * (e.cross ?? 0);
  const finish = e.finish ?? 'body';
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, scale: V3) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    g.add(m);
    return m;
  };

  switch (style) {
    case 'googly': {
      const shine = e.shine ?? 1;
      const white = glossyWhite();
      if (e.eyeballColor) white.color.set(e.eyeballColor);
      white.roughness = 0.75 - 0.6 * shine;
      white.clearcoat = shine;
      const black = glossyBlack();
      if (e.pupilColor) black.color.set(e.pupilColor);
      black.roughness = 0.7 - 0.58 * shine;
      black.clearcoat = shine;
      add(sphereGeo, white, [0, 0, -r * 0.35], [r, r, r]);
      // the pupil rolls round the eyeball's centre to look about
      const roll = new THREE.Group();
      roll.position.set(0, 0, -r * 0.35);
      const across = THREE.MathUtils.clamp((e.lookX ?? 0) + crossX, -1.5, 1.5);
      roll.rotation.set(-(e.lookY ?? 0) * 0.7, across * 0.7, 0, 'YXZ');
      g.add(roll);
      const k = pupilScale(e);
      const pupil = new THREE.Mesh(sphereGeo, black);
      pupil.position.set(0, 0, r * 0.82);
      const [cw, ch] = catShape(e);
      pupil.scale.set(r * 0.55 * k * cw, r * 0.6 * k * ch, r * 0.3);
      roll.add(pupil);
      // the catchlight is a reflection: it stays put, and fades out on a matte eye
      if (shine > 0.05) {
        const glint = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: shine < 1, opacity: Math.min(1, shine * 1.2) });
        add(sphereGeo, glint, [r * 0.2, r * 0.25, r * 0.67], [r * 0.14, r * 0.14, r * 0.14]);
      }
      break;
    }
    case 'flat': {
      // craft-store sticker eye: white disc, a loose pupil that has fallen to the bottom, clear dome
      const R = r * 1.15;
      const disc = new THREE.CylinderGeometry(1, 1, 1, 40);
      disc.rotateX(Math.PI / 2);
      add(disc, new THREE.MeshStandardMaterial({ color: e.eyeballColor ?? 0xffffff, roughness: 0.55 }), [0, 0, R * 0.06], [R, R, R * 0.12]);
      const pr = Math.min(0.85, 0.58 * pupilScale(e));
      // how far the pupil can roll before it reaches the rim
      const travel = Math.max(0, 0.94 - pr);
      // left alone, it has fallen to the bottom, each side jiggled a little differently
      const loose = Math.max(-travel, Math.min(travel, (sgn || 1) * 0.13 + 0.05));
      const px = (e.lookX !== undefined ? e.lookX * travel : loose) + crossX * travel;
      const py = (e.lookY ?? -1) * travel;
      // kept inside the disc when pushed into a corner (the loose one is as it always was)
      const placed = e.lookX !== undefined || e.lookY !== undefined || !!e.cross;
      const d = Math.hypot(px, py), k = placed && d > travel && d > 0 ? travel / d : 1;
      const [cw, ch] = catShape(e);
      add(disc, new THREE.MeshStandardMaterial({ color: e.pupilColor ?? 0x151216, roughness: 0.4 }), [px * k * R, py * k * R, R * 0.14], [R * pr * cw, R * pr * ch, R * 0.04]);
      const dome = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateX(Math.PI / 2);
      add(
        dome,
        new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.1, clearcoat: 1, depthWrite: false }),
        [0, 0, R * 0.1],
        [R * 1.02, R * 1.02, R * 0.38],
      );
      break;
    }
    case 'bead': {
      // a bead, by default in the creature's own material
      add(shapedEye(r * 0.8, r * 0.8, r * 0.8, sgn, e, 1), eyeGlow(eyeMaterial(finish, e.color ?? '#1d1a22', headStyle, headSettings), e.color ?? '#1d1a22', e), [0, 0, -r * 0.3], [1, 1, 1]);
      break;
    }
    case 'dot': {
      // a flat disc of dark wool/clay pressed onto the face
      add(shapedEye(r * 0.95, r * 0.95, r * 0.28, sgn, e), eyeGlow(eyeMaterial(finish, e.color ?? '#2a2730', headStyle, headSettings), e.color ?? '#2a2730', e), [0, 0, 0], [1, 1, 1]);
      break;
    }
    case 'button': {
      const R = r * 1.05;
      // buttons are glossy plastic unless a finish is chosen
      const mat = eyeGlow(
        finish === 'body'
          ? new THREE.MeshPhysicalMaterial({ color: e.color ?? 0x2a2230, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 })
          : eyeMaterial(finish, e.color ?? '#2a2230', headStyle, headSettings),
        e.color ?? '#2a2230',
        e,
      );
      const body = new THREE.CylinderGeometry(1, 0.94, 1, 40);
      body.rotateX(Math.PI / 2);
      add(body, mat, [0, 0, R * 0.1], [R, R, R * 0.2]);
      add(new THREE.TorusGeometry(1, 0.12, 12, 40), mat, [0, 0, R * 0.2], [R * 0.86, R * 0.86, R * 0.8]);
      const hole = new THREE.CylinderGeometry(1, 1, 1, 12);
      hole.rotateX(Math.PI / 2);
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x0b090d });
      const thread = new THREE.MeshStandardMaterial({ color: 0xf1e7d6, roughness: 0.9 });
      const o = R * 0.26;
      for (const [hx, hy] of [[-o, o], [o, o], [-o, -o], [o, -o]]) add(hole, holeMat, [hx, hy, R * 0.2], [R * 0.1, R * 0.1, R * 0.02]);
      const box = new THREE.BoxGeometry(1, 1, 1);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const t = add(box, thread, [0, 0, R * 0.23], [o * 2 * Math.SQRT2 + R * 0.12, R * 0.06, R * 0.04]);
        t.rotation.z = a;
        // too fine to ink: the outline would swallow it
        t.userData.noInk = true;
      }
      break;
    }
  }
  // a toon head can draw its eyes in the same ink as itself
  if (e.ink && (style === 'bead' || style === 'dot' || style === 'button') && headStyle === 'toon' && headSettings.ink > 0) inkEye(g, headSettings);
  return g;
}

/**
 * Give each piece of an eye its own patch of a textured material: the
 * texture is laid out shifted and turned by an amount picked from `seed`,
 * the same every time, so the eye keeps its look between rebuilds.
 */
export function varyEyeTexture(g: THREE.Object3D, seed: number) {
  let s = seed || 1;
  // xorshift: a few repeatable random numbers 0..1
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2));
    const shift = new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(10);
    // (the materials are the eye's own, made fresh for it)
    setTextureSpace(o, new THREE.Matrix4().compose(shift, turn, new THREE.Vector3(1, 1, 1)));
  });
}

/**
 * Ink hulls round each solid piece of an eye. A piece's size is baked into its
 * hull's shape, so the line is as wide as the body's, however the piece is squashed.
 * Glints, holes and the clear dome (basic or see-through materials) go without.
 */
function inkEye(g: THREE.Object3D, k: StyleSettings) {
  const meshes: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.noInk) meshes.push(o);
  });
  for (const m of meshes) {
    const mat = m.material as THREE.Material;
    if (mat instanceof THREE.MeshBasicMaterial || mat.transparent) continue;
    const geo = inkNormals(m.geometry.clone().scale(m.scale.x, m.scale.y, m.scale.z));
    const ink = new THREE.Mesh(geo, makeOutlineMaterial(k.ink, true, k));
    ink.position.copy(m.position);
    ink.quaternion.copy(m.quaternion);
    m.parent!.add(ink);
  }
}
