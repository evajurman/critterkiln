// ---------------------------------------------------------------------------
// Small DOM helpers shared by the editor: $ for one element, and Font Awesome icons.

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
