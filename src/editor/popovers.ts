// ---------------------------------------------------------------------------
// The top bar's popovers (File, Creations, trophies...): one open at a time.

import { $ } from './dom';
import { closeShortcutSheet } from './settings';

// The top-bar menus share the same corner of the viewport, so only one is open at a time.
export const POPOVERS: [button: string, pop: string][] = [['#trophy-btn', '#trophy-pop'], ['#library-btn', '#library-pop'], ['#file-btn', '#file-pop'], ['#settings-btn', '#settings-pop']];
/** Open (or, if it's already open, close) one top-bar menu. Returns whether it's now open. */
export function togglePopover(pop: string): boolean {
  const open = $(pop).hidden !== false;
  for (const [b, p] of POPOVERS) {
    $(p).hidden = !(open && p === pop);
    $(b).classList.toggle('on', open && p === pop);
  }
  // one menu at a time: the Attach popups would sit under Creations or Trophies
  if (open) {
    closeAttachPops();
    closeShortcutSheet();
  }
  return open;
}
export function closeTopPopovers() {
  for (const [b, p] of POPOVERS) {
    $(p).hidden = true;
    $(b).classList.remove('on');
  }
}
export function closeAttachPops() {
  $('#attach-pop').hidden = true;
}
