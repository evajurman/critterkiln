// ---------------------------------------------------------------------------
// The right-click menu: on a part, a piece or worn stuff in the view, what you
// can do to it (picking it first); on the tools, arranging them, and on a
// slider its number and its default. A right-drag still pans the view.

import { arrangeMenu, tabNamesMenu } from '../layout';
import { keyLabel, type ShortcutId } from '../shortcuts';
import { openContextMenu, SEP, type MenuEntry, type MenuItem } from '../contextMenu';
import { canvas, key } from './stage';
import { activate, creature, creatures, idle, mode, save, selected, setIdle, setSelected, world } from './state';
import { creatureLabel, pickOtherCreature, pickPart, pointer } from './controls';
import { frameAll, frameCreature, partToFloor } from './framing';
import { drawState, enterDraw } from './drawing';
import {
  clip,
  copyPicked,
  copyPiece,
  deletePiece,
  focusOnBoard,
  pasteClip,
  pickPiece,
  piece,
  pieceMode,
  renderStuffPanel,
  selectedPiece,
  setPieceMirror,
  setPieceMode,
  setSelectedPiece,
  twinOf,
} from './workbench';
import { deselectAttachment, gizmo } from './attach';
import { type PlaceMode, placing, setPlaceMode, startPlacing, stopPlacing } from './arrange';
import { removeAttachment, syncAttachBar } from './attachPanel';
import { pickAttachment, pickStuff } from './carry';
import { flashPart, selectPart } from './partPanel';
import { renderUI } from './panels';
import { pickingParent, removePart, rigLock, setMirror } from './rigEdit';
import { renderSettings, saveSettings, settings, syncSliderNumbers } from './settings';
import { pickingFocus } from './dof';
import { scopeMenu } from './scope';

/** A button's own action as a menu item: greyed when the button is, left out when it's hidden. */
function buttonItem(id: string, icon: string, label?: string): MenuItem | null {
  const b = document.querySelector<HTMLButtonElement>(id);
  if (!b || b.hidden || b.closest('[hidden]')) return null;
  return { label: label ?? (b.textContent ?? '').trim(), icon, disabled: b.disabled, title: b.title, run: () => b.click() };
}
const keyOf = (id: ShortcutId) => keyLabel(id) || undefined;
const ctxSlab = (n: string) => `fa-slab-duo fa-regular fa-${n}`;
const ctxDuo = (n: string) => `fa-duotone fa-regular fa-${n}`;

/** Move, Rotate and Scale, each doing `set` with its gizmo mode; `on` ticks the one in use. */
function gizmoItems(set: (m: 'translate' | 'rotate' | 'scale') => void, on: string | null, what = ''): MenuItem[] {
  return ([['translate', 'Move', 'move', 'arrows-up-down-left-right'], ['rotate', 'Rotate', 'rotate', 'arrows-rotate'], ['scale', 'Scale', 'scale', 'expand']] as const).map(
    ([m, label, key, icon]) => ({ label: label + what, icon: ctxDuo(icon), checked: on === m || undefined, key: keyOf(key), run: () => set(m) }),
  );
}

function viewMenu(x: number, y: number) {
  if (mode === 'stuff') {
    const id = pickPiece(x, y);
    if (id) {
      setSelectedPiece(id);
      flashPart();
      renderStuffPanel();
    }
    const p = id ? piece() : undefined;
    if (!p) {
      return openContextMenu(x, y, 'Workbench', [
        { label: 'Draw a piece', icon: ctxSlab('pencil'), key: keyOf('draw'), run: () => enterDraw({ kind: 'piece' }) },
        clip?.kind === 'piece' && { label: 'Paste', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
        SEP,
        { label: 'Frame the workbench', icon: ctxDuo('crosshairs'), key: keyOf('frame'), run: focusOnBoard },
      ]);
    }
    return openContextMenu(x, y, 'Piece', [
      { label: 'Copy', icon: ctxDuo('copy'), key: keyOf('copy'), run: () => copyPicked() },
      clip?.kind === 'piece' && { label: 'Paste', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
      { label: 'Duplicate', icon: ctxDuo('clone'), run: () => copyPiece(p.id) },
      { label: 'Delete', icon: ctxSlab('trash'), key: keyOf('delete'), danger: true, run: () => deletePiece(p.id) },
      SEP,
      { label: 'Redraw', icon: ctxSlab('pencil'), run: () => enterDraw({ kind: 'piece', redraw: p.id }) },
      { label: 'Mirror', icon: ctxSlab('arrow-right-arrow-left'), key: keyOf('mirror'), checked: !!twinOf(p), run: () => setPieceMirror(!twinOf(p)) },
      SEP,
      ...gizmoItems(setPieceMode, pieceMode),
      SEP,
      { label: 'Frame the workbench', icon: ctxDuo('crosshairs'), key: keyOf('frame'), run: focusOnBoard },
    ]);
  }

  // the same picking as a click: another creature, worn stuff, then a part
  const other = pickOtherCreature(x, y);
  if (other) {
    setIdle(false);
    activate(other.index);
    if (other.boneId && creature.bones.has(other.boneId)) setSelected(other.boneId);
    creature.select(selected);
    save();
    renderUI();
  }
  const att = other ? null : pickAttachment(x, y);
  if (att) {
    pickStuff(att);
    return openContextMenu(x, y, 'Worn stuff', [
      ...gizmoItems((m) => {
        gizmo.setMode(m);
        syncAttachBar();
      }, gizmo.mode),
      SEP,
      { label: 'Take it off', icon: ctxSlab('trash'), key: keyOf('delete'), danger: true, run: removeAttachment },
    ]);
  }
  const id = other?.boneId ?? pickPart(x, y);
  if (id && creature.bones.has(id)) {
    deselectAttachment();
    if (placing) stopPlacing();
    selectPart(id, false);
  }
  const place = (m: PlaceMode) => {
    if (!placing) startPlacing();
    setPlaceMode(m);
  };
  const frame: MenuEntry[] = [
    { label: 'Frame this creature', icon: ctxDuo('crosshairs'), key: keyOf('frame'), run: () => frameCreature() },
    creatures.length > 1 && { label: 'Frame everyone', icon: ctxDuo('users'), key: keyOf('frameAll'), run: frameAll },
  ];
  if (!id) {
    return openContextMenu(x, y, creatureLabel(world.active), [
      clip?.kind === 'part' && !idle && { label: 'Paste', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
      { label: 'Arrange creature', icon: ctxDuo('arrows-up-down-left-right'), sub: gizmoItems(place, placing ? gizmo.mode : null) },
      buttonItem('#drop-floor', ctxSlab('arrow-down-to-line'), 'Creature to floor'),
      SEP,
      ...frame,
    ]);
  }
  const b = creature.bones.get(id)!;
  const name = b.def.name?.trim() || 'Part';
  const root = !b.parent;
  return openContextMenu(x, y, name, [
    { label: 'Copy', icon: ctxDuo('copy'), key: keyOf('copy'), disabled: root, title: root ? 'The first part holds everything else' : undefined, run: () => copyPicked() },
    clip?.kind === 'part' && { label: 'Paste onto this part', icon: ctxDuo('paste'), key: keyOf('paste'), run: () => pasteClip() },
    { label: 'Delete', icon: ctxSlab('trash'), key: keyOf('delete'), danger: true, disabled: root, title: root ? 'The first part holds everything else' : undefined, run: removePart },
    SEP,
    { label: 'Draw shape', icon: ctxSlab('pencil'), key: keyOf('draw'), run: () => enterDraw({ kind: 'bone', boneId: id }) },
    buttonItem('#reset-shape', ctxDuo('rotate-left')),
    {
      label: 'Grow',
      icon: ctxDuo('seedling'),
      sub: [
        buttonItem('#rig-bone', ctxDuo('bone')),
        buttonItem('#rig-extend', ctxDuo('arrow-up-right')),
        buttonItem('#rig-split', ctxSlab('scissors')),
        buttonItem('#rig-detach', ctxDuo('link-slash')),
        buttonItem('#rig-mirror', ctxSlab('arrow-right-arrow-left')),
      ].filter((i): i is MenuItem => !!i),
    },
    { label: 'Mirror both sides', icon: ctxSlab('arrow-right-arrow-left'), key: keyOf('mirror'), checked: rigLock, run: () => setMirror(!rigLock) },
    SEP,
    { label: 'Arrange creature', icon: ctxDuo('arrows-up-down-left-right'), sub: gizmoItems(place, placing ? gizmo.mode : null) },
    buttonItem('#reset-pose', ctxDuo('person')),
    !root && { label: 'Part to floor', icon: ctxSlab('arrow-down-to-line'), title: 'Move it straight down until its lowest point touches the floor', run: () => partToFloor(id) },
    buttonItem('#drop-floor', ctxSlab('arrow-down-to-line'), 'Creature to floor'),
    SEP,
    ...frame,
  ]);
}

export function initViewMenu() {
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // a right-drag panned the view; and nothing to offer while drawing or picking a parent
    // (and a long press on a phone picks a part instead)
    if (pointer.moved || pointer.held || drawState || pickingParent || pickingFocus || gizmo.dragging) return;
    viewMenu(e.clientX, e.clientY);
  });
  /** On a slider: its default back, and the number boxes; on a tool: arranging it. */
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t === canvas || t.closest('.ctx-menu-wrap')) return;
    if (t.closest('.modes button[data-mode]')) {
      e.preventDefault();
      return openContextMenu(e.clientX, e.clientY, 'Tabs', tabNamesMenu());
    }
    // text boxes keep the browser's own menu (cut, copy, paste)
    if (t.closest('textarea, input:not([type=range]):not([type=checkbox]):not([type=radio])')) return;
    const range = (t as HTMLInputElement).type === 'range' ? (t as HTMLInputElement) : t.closest('.slider, .bar-slider')?.querySelector<HTMLInputElement>('input[type=range]');
    const arrange = arrangeMenu(t);
    const scope = range ? [] : scopeMenu(t);
    if (!range && !arrange && !scope.length) return;
    e.preventDefault();
    const def = range?.dataset.default;
    const label = range?.closest('.slider')?.querySelector(':scope > span')?.textContent?.trim();
    const title = label ?? t.closest<HTMLElement>('.ck-sec')?.querySelector('.ck-title')?.firstChild?.textContent?.trim() ?? 'Tools';
    openContextMenu(e.clientX, e.clientY, title, [
      range && def !== undefined && {
        label: 'Reset to default',
        icon: ctxDuo('rotate-left'),
        disabled: range.disabled || parseFloat(range.value) === parseFloat(def),
        run: () => {
          range.value = def;
          range.dispatchEvent(new Event('input', { bubbles: true }));
          range.dispatchEvent(new Event('change', { bubbles: true }));
          if (settings.numbers) syncSliderNumbers();
        },
      },
      range && {
        label: 'Show numbers',
        checked: settings.numbers,
        run: () => {
          settings.numbers = !settings.numbers;
          saveSettings();
          renderSettings();
        },
      },
      ...scope,
      SEP,
      arrange,
    ]);
  });
}
