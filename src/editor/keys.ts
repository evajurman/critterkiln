// ---------------------------------------------------------------------------
// The keyboard: one handler for every shortcut (see src/shortcuts.ts).

import { markGizmoMode, markToolKey } from '../markingPanel';
import { customTabs } from '../layout';
import { captureShortcut, is } from '../shortcuts';
import { $ } from './dom';
import { creature, idle, mode, redo, undo } from './state';
import { focusOnBone, frameAll, frameCreature } from './framing';
import { drawState, enterDraw, exitDraw, finishDraw, setDrawSide, setDrawTool, setSpacePan, toggleSymmetry } from './drawing';
import { board, copyPicked, finishStuff, deletePiece, selectAllPieces, focusOnBoard, focusOnPlane, pasteClip, piece, piecePivot, setPieceMirror, setPieceMode } from './workbench';
import { gizmo, selectedAttachment } from './attach';
import { placing, setPlaceMode } from './arrange';
import { removeAttachment, syncAttachBar } from './attachPanel';
import { setMode } from './panels';
import { pickingRide, stopPickingRide } from './riders';
import { patterning, stopPattern } from './pattern';
import { selectAllParts } from './partPanel';
import { pickingParent, removePart, rigLock, setMirror, setPickingParent } from './rigEdit';
import { closeShortcutSheet, shortcutsChanged, toggleShortcutSheet } from './settings';

export function initKeys() {
  // the shortcut sheet waiting for a new key takes the press before anything else sees it
  window.addEventListener('keydown', (e) => captureShortcut(e, $('#keys-list'), shortcutsChanged), true);
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented && !$('#keys-pop').hidden) return;
    const tag = (e.target as HTMLElement).tagName;
    // typing in a text or number box
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && ['text', 'number', 'search'].includes((e.target as HTMLInputElement).type))) return;
    // the paint brush's own keys come first while it's picked up (Brush size, Mirror)
    if (markToolKey(e)) {
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (is(e, 'undo')) {
      e.preventDefault();
      undo();
    } else if (is(e, 'redo')) {
      e.preventDefault();
      redo();
    } else if (k === 'escape' && !$('#keys-pop').hidden) {
      closeShortcutSheet();
    } else if (is(e, 'help')) {
      toggleShortcutSheet();
    } else if (k === 'escape' && pickingParent) {
      setPickingParent(false);
    } else if (k === 'escape' && pickingRide) {
      stopPickingRide();
    } else if (k === 'escape' && patterning()) {
      stopPattern();
    } else if (k === 'escape' && drawState) {
      exitDraw();
    } else if (k === 'escape' && mode === 'stuff') {
      finishStuff();
    } else if (k === 'enter' && drawState) {
      e.preventDefault();
      finishDraw();
    } else if (drawState && (is(e, 'draw') || is(e, 'erase') || is(e, 'move') || is(e, 'scale') || is(e, 'rotate'))) {
      setDrawTool(is(e, 'draw') ? 'draw' : is(e, 'erase') ? 'erase' : is(e, 'move') ? 'move' : is(e, 'scale') ? 'scale' : 'rotate');
    } else if (is(e, 'mirror') && drawState) {
      toggleSymmetry();
    } else if (is(e, 'side') && drawState) {
      setDrawSide(!drawState.side);
    } else if (e.code === 'Space' && (drawState || !(e.target as HTMLElement).closest('button, select, textarea, input, label'))) {
      // (a focused button still clicks with Space)
      e.preventDefault();
      setSpacePan(true);
    } else if (is(e, 'frame') && drawState) {
      // back to a straight-on view of the drawing
      if (drawState.target.kind === 'bone') {
        const b = creature.bones.get(drawState.target.boneId);
        if (b) focusOnBone(b, drawState.side);
      } else if (drawState.frame !== board) focusOnPlane(drawState.frame);
      else focusOnBoard();
    } else if (is(e, 'draw') && mode === 'stuff') enterDraw({ kind: 'piece' });
    else if (is(e, 'draw') && !idle) enterDraw();
    else if (is(e, 'animate')) setMode('animate');
    else if (is(e, 'mirror') && mode === 'stuff') {
      if (piece()) setPieceMirror(!piece()!.twin);
    } else if (is(e, 'mirror')) setMirror(!rigLock);
    else if (is(e, 'delete') && !drawState) {
      // picked stuff goes first: its part is picked too, and mustn't go with it
      if (selectedAttachment) {
        e.preventDefault();
        removeAttachment();
      } else if (mode === 'stuff' && piece()) {
        e.preventDefault();
        deletePiece(piece()!.id);
      } else if (mode !== 'stuff' && !idle && !placing) {
        e.preventDefault();
        removePart();
      }
    } else if (is(e, 'copy') && !document.getSelection()?.toString()) {
      if (copyPicked()) e.preventDefault();
    } else if (is(e, 'paste')) {
      if (pasteClip()) e.preventDefault();
    } else if (is(e, 'selectAll') && !drawState) {
      e.preventDefault();
      if (mode === 'stuff') selectAllPieces();
      else selectAllParts();
    } else if (is(e, 'move') || is(e, 'rotate') || is(e, 'scale')) {
      const m = is(e, 'move') ? 'translate' : is(e, 'rotate') ? 'rotate' : 'scale';
      if (mode === 'stuff' && piecePivot) setPieceMode(m);
      else if (selectedAttachment) {
        gizmo.setMode(m);
        syncAttachBar();
      } else if (placing) setPlaceMode(m);
      else markGizmoMode(m);
    } else if (is(e, 'shape')) setMode('shape');
    else if (is(e, 'look')) setMode('look');
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && k >= '5' && k <= '9' && customTabs()[+k - 5]) setMode(customTabs()[+k - 5].id);
    else if (is(e, 'frame')) {
      if (mode === 'stuff') focusOnBoard();
      else frameCreature();
    } else if (is(e, 'frameAll')) frameAll();
  });
}
