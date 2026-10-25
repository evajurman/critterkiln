// ---------------------------------------------------------------------------
// The bar for a picked worn thing: mirroring, wrapping, copying, changing it
// where it is and taking it off; and picking its pieces, so Look's colors,
// materials and markings work on them as they do on parts.

import { type Attachment } from '../creature';
import { uid, type Piece, type Thing } from '../stuff';
import { guidedOn } from '../layout';
import { $, type PickHow } from './dom';
import { commit, creature, selected, state } from './state';
import { editStuff, renderCollection, stripThumb } from './workbench';
import { currentAttachment, deselectAttachment, gizmo, selectAttachment, selectedAttachment } from './attach';
import { closeTopPopovers } from './popovers';
import { hintOnce } from './hints';
import { renderUI, setMode } from './panels';

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
}

// ---- a worn thing's pieces, picked (from the Scene list, or Material) ----

/** Some pieces of the picked worn thing, picked in the Scene list, the main one first (unset: all of it). */
let wornPick: { id: string; pieces: string[] } | null = null;

/**
 * With a worn thing picked, what Look's colors, materials and markings work
 * on (as they would on parts): its picked pieces, or every piece. Null: no
 * worn thing is picked, and Look works on parts.
 */
export function wornPieces(): { a: Attachment; thing: Thing; pieces: Piece[] } | null {
  const a = currentAttachment();
  if (!a?.thing.pieces.length) return null;
  const some = wornPick?.id === a.id ? wornPick.pieces.flatMap((id) => a.thing.pieces.find((p) => p.id === id) ?? []) : [];
  return { a, thing: a.thing, pieces: some.length ? some : a.thing.pieces };
}

/** Back to all of the picked worn thing. */
export function clearWornPieces() {
  wornPick = null;
}

/** Pick a piece of the picked worn thing: just it, one more (or one less), or every piece from the main one to it. */
export function pickWornPiece(pieceId: string, how: PickHow = 'one') {
  const a = currentAttachment();
  if (!a) return;
  const ids = a.thing.pieces.map((p) => p.id);
  const now = wornPick?.id === a.id ? wornPick.pieces : [];
  let next: string[];
  if (how === 'one' || !now.length) next = [pieceId];
  else if (how === 'range') {
    const from = ids.indexOf(now[0]), to = ids.indexOf(pieceId);
    next = [now[0], ...ids.slice(Math.min(from, to), Math.max(from, to) + 1).filter((id) => id !== now[0])];
  } else if (!now.includes(pieceId)) next = [pieceId, ...now];
  else next = now.length > 1 ? now.filter((id) => id !== pieceId) : now;
  wornPick = { id: a.id, pieces: next };
  showLook();
  renderUI();
}

/** Every piece of the picked worn thing (and, with `show`, off to Look if its colors aren't showing). */
export function pickAllWornPieces(show = true) {
  if (!currentAttachment()?.thing.pieces.length) return;
  wornPick = null;
  if (show) showLook();
  renderUI();
}

/** Where colors and materials are: Look (in Guided, the Color step), unless they're showing already. */
function showLook() {
  if ($('#swatches').offsetParent) return;
  const id = selectedAttachment;
  const pick = wornPick;
  setMode(guidedOn() ? 'step-color' : 'look');
  // (a tab change can drop the pick: put it back)
  if (id && selectedAttachment !== id) selectAttachment(id);
  wornPick = pick;
  hintOnce('Its colors, materials and markings are here: a change goes on it everywhere it’s worn', 3200);
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
  $('#attach-pop-close').onclick = () => ($('#attach-pop').hidden = true);
  $('#rig-attach').onclick = () => {
    closeTopPopovers();
    $('#attach-pop').hidden = false;
    renderCollection();
  };
  // its colors and materials are Look's, as a part's are
  $('#attach-mat').onclick = () => pickAllWornPieces();
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
  $('#attach-edit').onclick = () => {
    if (selectedAttachment) editStuff({ kind: 'worn', id: selectedAttachment });
  };
  // a copy lands a little to one side of the original, so it can be seen and dragged off it
  $('#attach-copy').onclick = () => {
    const a = currentAttachment();
    if (!a) return;
    const [x, y, z] = a.position;
    const copy: Attachment = { ...structuredClone(a), id: uid() };
    copy.position = [x + 0.08, y + 0.08, z];
    state.attachments = [...(state.attachments ?? []), copy];
    creature.sync();
    commit();
    selectAttachment(copy.id);
  };
  $('#attach-done').onclick = () => deselectAttachment();
}
