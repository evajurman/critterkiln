// ---------------------------------------------------------------------------
// The bar for a picked worn thing: its color, glow and material, mirroring,
// wrapping, copying and taking it off.

import { type Attachment } from '../creature';
import { uid, type Piece, type Thing } from '../stuff';
import { $, pickHow } from './dom';
import { mirror } from './floor';
import { commit, creature, selected, state } from './state';
import { renderCollection, stripThumb } from './workbench';
import { currentAttachment, deselectAttachment, gizmo, selectAttachment, selectedAttachment } from './attach';
import { closeTopPopovers } from './popovers';
import { glowFollowSeg, glowSlider, sceneColorRow, SWATCHES } from './widgets';
import { renderThingMaterial } from './partPanel';
import { hintOnce } from './hints';

export function syncAttachBar() {
  const a = currentAttachment();
  if (!a) return;
  document.querySelectorAll<HTMLButtonElement>('#attach-bar [data-gizmo]').forEach((b) => b.classList.toggle('on', b.dataset.gizmo === gizmo.mode));
  const bone = creature.bones.get(a.bone);
  $('#attach-mirror-label').hidden = !bone || !creature.mirrorBoneOf(bone);
  $<HTMLInputElement>('#attach-mirror').checked = a.mirror;
  $('#attach-mirror-label').classList.toggle('on', a.mirror);
  $<HTMLInputElement>('#attach-wrap').checked = !!a.wrap;
  $('#attach-wrap-label').classList.toggle('on', !!a.wrap);
  $('#attach-name').textContent = a.thing.name;
  if (!$('#attach-mat-pop').hidden) renderAttachMaterial();
}

/** The pieces of the picked stuff its colors go on (picked in its Stuff material popover): the main one first */
let attachPieceIds: string[] = [];
function attachPieces(): Piece[] {
  const pieces = currentAttachment()?.thing.pieces ?? [];
  const picked = attachPieceIds.flatMap((id) => pieces.find((p) => p.id === id) ?? []);
  return picked.length ? picked : pieces.slice(0, 1);
}
function attachPiece(): Piece | undefined {
  return attachPieces()[0];
}
/** Change the picked stuff's color or glow, on every picked piece of it */
function updateAttachColor(fn: (p: Piece) => void, doCommit = true) {
  const pieces = attachPieces();
  if (!pieces.length) return;
  for (const q of pieces) fn(q);
  creature.sync();
  if (doCommit) {
    commit();
    renderAttachMaterial();
  }
}
let attachGlowFollow: () => void;
let attachSceneColors: () => void;

function renderAttachMaterial() {
  const a = currentAttachment();
  if (!a) return;
  const p = attachPiece()!;
  const several = a.thing.pieces.length > 1;
  // which pieces: a button per piece, in its color (Ctrl picks one more, Shift everything between), and All
  const picked = attachPieces();
  const pieces = $('#attach-pieces');
  pieces.hidden = !several;
  const all = document.createElement('button');
  all.className = 'piece-pick';
  all.classList.toggle('active', picked.length === a.thing.pieces.length);
  all.textContent = 'All';
  all.title = 'Pick every piece';
  all.onclick = () => {
    attachPieceIds = [p.id, ...a.thing.pieces.filter((q) => q !== p).map((q) => q.id)];
    renderAttachMaterial();
  };
  pieces.replaceChildren(
    ...a.thing.pieces.map((q, i) => {
      const b = document.createElement('button');
      b.className = 'piece-pick';
      b.classList.toggle('active', picked.includes(q));
      b.innerHTML = `<i style="background:${q.color}"></i>`;
      b.append(` ${i + 1}`);
      b.title = `Piece ${i + 1} · Ctrl-click to pick one more · Shift-click to pick everything between`;
      b.onclick = (e) => {
        const ids = picked.map((o) => o.id);
        const how = pickHow(e);
        // Ctrl: one more piece picked (or one less), as the main one; Shift: every piece from the main one to this one
        if (how === 'one') attachPieceIds = [q.id];
        else if (how === 'range') {
          const from = a.thing.pieces.indexOf(p);
          attachPieceIds = [p.id, ...a.thing.pieces.slice(Math.min(from, i), Math.max(from, i) + 1).filter((o) => o !== p).map((o) => o.id)];
        } else if (!ids.includes(q.id)) attachPieceIds = [q.id, ...ids];
        else if (ids.length > 1) attachPieceIds = ids.filter((id) => id !== q.id);
        renderAttachMaterial();
      };
      return b;
    }),
    all,
  );
  const sw = $('#attach-swatches');
  sw.replaceChildren(
    ...SWATCHES.map((c) => {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c.toLowerCase() === p.color.toLowerCase());
      b.onclick = () => updateAttachColor((q) => (q.color = c));
      return b;
    }),
  );
  $<HTMLInputElement>('#attach-color').value = p.color;
  $<HTMLInputElement>('#attach-glow').value = String(p.glow ?? 0);
  attachGlowFollow();
  attachSceneColors();
  const part = state.parts[creature.bones.get(a.bone)?.src ?? ''];
  renderThingMaterial(a.thing, [...new Set(a.thing.pieces.map((p) => p.style))], $('#attach-mat-body'), part?.style ?? state.style);
}

export function attachThing(t: Thing) {
  const bone = creature.bones.get(selected);
  if (!bone) return;
  const a: Attachment = {
    id: uid(),
    bone: selected,
    thing: stripThumb(t),
    position: creature.attachPoint(selected),
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
    mirror: !!creature.twinOf(bone),
  };
  state.attachments = [...(state.attachments ?? []), a];
  creature.sync();
  commit();
  $('#attach-pop').hidden = true;
  selectAttachment(a.id);
  hintOnce('Drag the arrows to place it; switch to rotate or scale in the top bar', 3000);
}
export function removeAttachment() {
  state.attachments = (state.attachments ?? []).filter((a) => a.id !== selectedAttachment);
  deselectAttachment();
  creature.sync();
  commit();
}

export function initAttachPanel() {
  attachGlowFollow = glowFollowSeg('#attach-glow-follow', attachPiece, (f) =>
    updateAttachColor((q) => {
      if (f) q.glowFollow = f;
      else delete q.glowFollow;
    }),
  );
  attachSceneColors = sceneColorRow($('#attach-scene-colors'), () => attachPiece()?.color, (c) => updateAttachColor((q) => (q.color = c)));
  glowSlider(
    '#attach-glow',
    (v) => {
      updateAttachColor((p) => {
        if (v > 0) p.glow = v;
        else delete p.glow;
      }, false);
      attachGlowFollow();
    },
    () => commit(),
  );
  $<HTMLInputElement>('#attach-color').oninput = (e) => updateAttachColor((p) => (p.color = (e.target as HTMLInputElement).value), false);
  $<HTMLInputElement>('#attach-color').onchange = () => {
    commit();
    renderAttachMaterial();
  };
  $('#attach-pop-close').onclick = () => ($('#attach-pop').hidden = true);
  $('#rig-attach').onclick = () => {
    closeTopPopovers();
    $('#attach-pop').hidden = false;
    renderCollection();
  };
  $('#attach-mat').onclick = () => {
    const pop = $('#attach-mat-pop');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      closeTopPopovers();
      renderAttachMaterial();
    }
  };
  $('#attach-mat-close').onclick = () => ($('#attach-mat-pop').hidden = true);
  document.querySelectorAll<HTMLButtonElement>('#attach-bar [data-gizmo]').forEach((b) => {
    b.onclick = () => {
      gizmo.setMode(b.dataset.gizmo as 'translate' | 'rotate' | 'scale');
      syncAttachBar();
    };
  });
  $<HTMLInputElement>('#attach-mirror').onchange = (e) => {
    const a = currentAttachment();
    if (!a) return;
    a.mirror = (e.target as HTMLInputElement).checked;
    creature.sync();
    commit();
    selectAttachment(a.id);
  };
  $<HTMLInputElement>('#attach-wrap').onchange = (e) => {
    const a = currentAttachment();
    if (!a) return;
    a.wrap = (e.target as HTMLInputElement).checked || undefined;
    creature.sync();
    commit();
    selectAttachment(a.id);
  };
  $('#attach-remove').onclick = removeAttachment;
  // a copy lands a little to one side of the original, so it can be seen and dragged off it
  $('#attach-copy').onclick = () => {
    const a = currentAttachment();
    if (!a) return;
    const [x, y, z] = a.position;
    const copy: Attachment = { ...structuredClone(a), id: uid(), position: [x + 0.08, y + 0.08, z] };
    state.attachments = [...(state.attachments ?? []), copy];
    creature.sync();
    commit();
    selectAttachment(copy.id);
  };
  $('#attach-done').onclick = () => deselectAttachment();
}
