// ---------------------------------------------------------------------------
// Small DOM helpers shared by the editor: $ for one element, Font Awesome icons,
// and how a click picks things.

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * Font Awesome icon markup. Slab where it has the icon, classic regular otherwise; both
 * are the two-tone styles, whose fill only shows in the Color theme (style.css).
 */
export const fa = (name: string) => `<i class="fa-slab-duo fa-regular fa-${name}" aria-hidden="true"></i>`;
export const faClassic = (name: string) => `<i class="fa-duotone fa-regular fa-${name}" aria-hidden="true"></i>`;
/** Sets an element to an icon followed by text (added as a text node, so names need no escaping). */
export function iconLabel(el: HTMLElement, icon: string, text = '') {
  el.innerHTML = icon;
  if (text) el.append(` ${text}`);
}

/** How a click picks: just this, this one more (or one less: Ctrl or ⌘), or everything from the main pick to this (Shift). */
export type PickHow = 'one' | 'toggle' | 'range';
export function pickHow(e: MouseEvent): PickHow {
  return e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'one';
}
