import * as THREE from 'three';
import { Creature } from '../creature';
import { uid, type Thing } from '../stuff';
import { type V3 } from '../rigs';
import { hint, partLabel, selectPart } from '../main';
import { $, fa, iconLabel } from './dom';
import { canvas } from './stage';
import { mirror } from './floor';
import { commit, creature, idle, state } from './state';
import { moveEyesTo, raycaster, round4, setRay, showEyes } from './controls';
import { stripThumb } from './workbench';
import { deselectAttachment, selectAttachment, selectedAttachment } from './attach';

// carrying eyes or stuff from a menu onto the creature: while it's over the
// creature it's really there (exactly where it would land), and letting go
// keeps it

let carry: {
  what: 'eyes' | Thing;
  ghost: HTMLElement;
  /** the eye pair (index) or attachment (id) standing in while over the creature */
  preview: number | string | null;
  /** the thing's extent in its own frame, to sit it on the surface */
  box?: THREE.Box3;
} | null = null;
/** when a carry ended: the click that follows it isn't a click */
let carriedAt = 0;

/** Press and drag `el` to carry what it stands for onto the creature; a plain click still works as before. */
export function carryFrom(el: HTMLElement, what: () => 'eyes' | Thing | null, ghost: () => string) {
  // the browser's own drag (of a thumbnail picture) would cancel the pointer and end the carry
  el.addEventListener('dragstart', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!carry) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const w = what();
        if (!w) return;
        const g = document.createElement('div');
        g.className = 'carry-ghost';
        g.innerHTML = ghost();
        document.body.append(g);
        carry = { what: w, ghost: g, preview: null };
        document.body.classList.add('carrying');
      }
      carryTo(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!carry) return;
      endCarry(ev.type === 'pointerup');
      carriedAt = performance.now();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  el.addEventListener(
    'click',
    (e) => {
      if (performance.now() - carriedAt > 300) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}

/** Where a carried thing's middle goes, and how it's turned, to sit on the surface at `hit` (in its part's frame). */
function sitOnSurface(hit: NonNullable<ReturnType<Creature['surfaceAt']>>, box: THREE.Box3): { position: V3; quaternion: [number, number, number, number] } {
  const rootQ = creature.root.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ);
  // upright, facing out from the surface (on top of something: facing the creature's front)
  const face = hit.normal.clone().addScaledVector(up, -hit.normal.dot(up));
  if (face.lengthSq() < 0.1) face.set(0, 0, 1).applyQuaternion(rootQ);
  face.normalize();
  const side = new THREE.Vector3().crossVectors(up, face);
  const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, face));
  // pushed out until it rests on the surface, just sunk in a little
  const out = hit.normal.clone().applyQuaternion(turn.clone().invert()).negate();
  let reach = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, out.x * x + out.y * y + out.z * z);
  const scale = creature.root.getWorldScale(new THREE.Vector3()).x;
  const at = hit.point.clone().addScaledVector(hit.normal, reach * scale * 0.85);
  const pivotQ = hit.bone.pivot.getWorldQuaternion(new THREE.Quaternion());
  const q = pivotQ.invert().multiply(turn);
  return { position: round4(hit.bone.pivot.worldToLocal(at)), quaternion: q.toArray().map((v) => Math.round(v * 1e5) / 1e5) as [number, number, number, number] };
}

/** The extent of something, in its own frame. */
function ownBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  const inv = obj.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  return box;
}

/** Take the stand-in off the creature (the pointer has left it). */
function dropPreview() {
  if (!carry || carry.preview === null) return;
  const p = carry.preview;
  if (typeof p === 'number') state.eyes.pairs.splice(p, 1);
  else state.attachments = (state.attachments ?? []).filter((a) => a.id !== p);
  carry.preview = null;
  creature.sync();
}

function carryTo(x: number, y: number) {
  if (!carry) return;
  carry.ghost.style.transform = `translate(${x}px, ${y}px)`;
  // only over the 3D view itself (not a menu on top of it)
  setRay(x, y);
  const hit = document.elementFromPoint(x, y) === canvas && !idle ? creature.surfaceAt(raycaster) : null;
  carry.ghost.classList.toggle('landing', !!hit);
  if (!hit) return dropPreview();
  if (carry.what === 'eyes') {
    if (carry.preview === null) {
      state.eyes.pairs.push({ size: 0.5, spacing: 0.5, height: 0.55 });
      carry.preview = state.eyes.pairs.length - 1;
    }
    const pair = state.eyes.pairs[carry.preview as number];
    // a limb (one of a mirrored pair, or a stalk) gets a single eye; the head gets a pair
    const b = hit.bone;
    const single = b.def.baseId !== state.rig.headId && (b.def.sideSign !== 0 || b.length > 1.6 * b.def.width);
    if (!!pair.single !== single) pair.single = single || undefined;
    moveEyesTo(carry.preview as number, 1, x, y);
    return;
  }
  const thing = carry.what;
  const id = carry.preview;
  let a = state.attachments?.find((x) => x.id === id);
  if (!a || a.bone !== hit.bone.def.id) {
    // a different part: start over on it, so it rides that part
    dropPreview();
    a = { id: uid(), bone: hit.bone.def.id, thing: stripThumb(thing), position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], mirror: !!creature.twinOf(hit.bone) };
    state.attachments = [...(state.attachments ?? []), a];
    carry.preview = a.id;
    creature.sync();
    const obj = creature.attachmentObject(a.id);
    if (!carry.box && obj) carry.box = ownBox(obj);
  }
  Object.assign(a, sitOnSurface(hit, carry.box ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())));
  creature.sync();
}

function endCarry(drop: boolean) {
  if (!carry) return;
  const c = carry;
  if (!drop) dropPreview();
  carry = null;
  c.ghost.remove();
  document.body.classList.remove('carrying');
  if (c.preview === null) {
    if (drop) hint(c.what === 'eyes' ? 'Drop the eyes onto your critter' : 'Drop it onto your critter to put it on', 1800);
    return;
  }
  commit();
  if (typeof c.preview === 'number') {
    showEyes(c.preview);
    hint('Drag the eyes to move them', 1800);
  } else {
    $('#attach-pop').hidden = true;
    pickStuff(c.preview);
  }
}

/** Everything the creature is wearing, under Parts: picking one goes to Look with it selected, as clicking it would. */
export function renderCreatureStuff() {
  const el = $('#creature-stuff');
  el.innerHTML = '';
  const all = state.attachments ?? [];
  $('#creature-stuff-sec').hidden = !all.length;
  for (const a of all) {
    const btn = document.createElement('button');
    iconLabel(btn, fa('paperclip'), a.thing.name);
    const src = creature.bones.get(a.bone)?.src;
    if (src) btn.title = `On the ${partLabel(src).toLowerCase()}`;
    btn.classList.toggle('active', a.id === selectedAttachment);
    btn.onclick = () => (a.id === selectedAttachment ? deselectAttachment() : pickStuff(a.id));
    el.append(btn);
  }
}

/** Pick a piece of stuff in Shape or Look, with the part it's on picked too (that part's handles stay hidden meanwhile). */
export function pickStuff(id: string) {
  const a = state.attachments?.find((x) => x.id === id);
  if (a && creature.bones.has(a.bone)) selectPart(a.bone, false);
  selectAttachment(id);
}

export function pickAttachment(x: number, y: number): string | null {
  setRay(x, y);
  const hit = raycaster.intersectObjects(creature.attachmentMeshes(), false)[0];
  return hit ? (hit.object.userData.attachmentId as string) : null;
}

export function initCarry() {
  carryFrom($('#eyes-add'), () => 'eyes', () => fa('eye'));
}
