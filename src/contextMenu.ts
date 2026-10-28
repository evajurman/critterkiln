// ---------------------------------------------------------------------------
// The right-click menu: one list of choices at the pointer, with submenus
// that open to the side. Whatever was right-clicked builds its own items
// (a part or a piece in the view, a section of tools, a slider); this only
// shows them, keeps them on screen, and works from the keyboard too.

export interface MenuItem {
  label: string;
  /** a Font Awesome class list */
  icon?: string;
  /** the key that does the same, shown on the right */
  key?: string;
  /** a tick beside it, for an on/off choice */
  checked?: boolean;
  disabled?: boolean;
  /** shown greyed, when it can't be done here */
  title?: string;
  /** a line of small print under it: what choosing it means */
  note?: string;
  danger?: boolean;
  run?: () => void;
  sub?: MenuItem[];
}
/** a line between groups */
export const SEP = 'sep' as const;
export type MenuEntry = MenuItem | typeof SEP | null | false | undefined;

let root: HTMLElement | null = null;

const fa = (i: string) => `<i class="${i}" aria-hidden="true"></i>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function contextMenuOpen(): boolean {
  return !!root;
}

export function closeContextMenu() {
  root?.remove();
  root = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeContextMenu);
  window.removeEventListener('resize', closeContextMenu);
}

/** Open the menu at (x, y), with a title over it; empty entries (null, false) are left out. */
export function openContextMenu(x: number, y: number, title: string, entries: MenuEntry[]) {
  closeContextMenu();
  const items = tidy(entries);
  if (!items.length) return;
  root = el('div', 'ctx-menu-wrap');
  document.body.append(root);
  const menu = list(items, title);
  root.append(menu);
  place(menu, x, y);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('resize', closeContextMenu);
}

/** Separators only between items: none at either end, none doubled. */
function tidy(entries: MenuEntry[]): (MenuItem | typeof SEP)[] {
  const out: (MenuItem | typeof SEP)[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === SEP && (!out.length || out[out.length - 1] === SEP)) continue;
    out.push(e);
  }
  while (out[out.length - 1] === SEP) out.pop();
  return out;
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function list(items: (MenuItem | typeof SEP)[], title?: string): HTMLElement {
  const menu = el('div', 'ctx-menu');
  menu.setAttribute('role', 'menu');
  if (title) menu.append(el('div', 'ctx-title', esc(title)));
  for (const it of items) {
    if (it === SEP) {
      menu.append(el('div', 'ctx-sep'));
      continue;
    }
    const b = el(
      'button',
      'ctx-item' + (it.danger ? ' danger' : '') + (it.sub ? ' has-sub' : ''),
      `<span class="ctx-ic">${it.checked ? fa('fa-solid fa-check') : it.checked === undefined && it.icon ? fa(it.icon) : ''}</span>` +
        `<span class="ctx-label">${esc(it.label)}${it.note ? `<small class="ctx-note">${esc(it.note)}</small>` : ''}</span>` +
        (it.key ? `<kbd class="ctx-key">${esc(it.key)}</kbd>` : '') +
        (it.sub ? `<span class="ctx-more">${fa('fa-solid fa-chevron-right')}</span>` : ''),
    ) as HTMLButtonElement;
    b.setAttribute('role', it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
    if (it.checked !== undefined) b.setAttribute('aria-checked', String(it.checked));
    b.disabled = !!it.disabled;
    if (it.title) b.title = it.title;
    if (it.sub) {
      b.setAttribute('aria-haspopup', 'menu');
      const open = () => openSub(b, it.sub!);
      b.addEventListener('pointerenter', open);
      b.onclick = open;
    } else {
      // hovering a plain item closes a submenu open beside this menu
      b.addEventListener('pointerenter', () => closeSubsAfter(menu));
      b.onclick = () => {
        closeContextMenu();
        it.run?.();
      };
    }
    b.addEventListener('pointerenter', () => b.focus({ preventScroll: true }));
    menu.append(b);
  }
  return menu;
}

/** Close every submenu opened from `menu` or deeper. */
function closeSubsAfter(menu: HTMLElement) {
  if (!root) return;
  const all = [...root.children] as HTMLElement[];
  for (const m of all.slice(all.indexOf(menu) + 1)) m.remove();
  menu.querySelectorAll('.ctx-item.open').forEach((b) => b.classList.remove('open'));
}

function openSub(from: HTMLElement, items: MenuItem[]) {
  const menu = from.parentElement as HTMLElement;
  if (from.classList.contains('open')) return;
  closeSubsAfter(menu);
  from.classList.add('open');
  const sub = list(tidy(items));
  root!.append(sub);
  // beside the item, flipped to the other side when there's no room
  const r = from.getBoundingClientRect();
  const w = sub.offsetWidth;
  const right = r.right + 2;
  const x = right + w < innerWidth - 8 ? right : Math.max(8, r.left - w - 2);
  place(sub, x, r.top - 5, true);
}

/** Put a menu at (x, y), moved back on screen if it would hang off it. */
function place(m: HTMLElement, x: number, y: number, exact = false) {
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  const left = exact ? x : x + w < innerWidth - 8 ? x : Math.max(8, x - w);
  const top = y + h < innerHeight - 8 ? y : Math.max(8, innerHeight - h - 8);
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
}

function outside(e: PointerEvent) {
  if (!(e.target as HTMLElement).closest('.ctx-menu-wrap')) closeContextMenu();
}

function onKey(e: KeyboardEvent) {
  if (!root) return;
  const focused = document.activeElement as HTMLElement | null;
  const menu = focused?.closest<HTMLElement>('.ctx-menu') ?? (root.lastElementChild as HTMLElement);
  const items = [...menu.querySelectorAll<HTMLButtonElement>('.ctx-item:not(:disabled)')];
  const i = items.indexOf(focused as HTMLButtonElement);
  const go = (j: number) => items[(j + items.length) % items.length]?.focus();
  if (e.key === 'Escape') {
    // a submenu closes first, back to the item it came from
    const menus = [...root.children] as HTMLElement[];
    if (menus.length > 1 && menu !== menus[0]) {
      const parent = menus[menus.indexOf(menu) - 1];
      const from = parent.querySelector<HTMLElement>('.ctx-item.open');
      closeSubsAfter(parent);
      from?.focus();
    } else closeContextMenu();
  } else if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1);
  else if (e.key === 'ArrowRight' && focused?.classList.contains('has-sub')) {
    focused.click();
    (root.lastElementChild as HTMLElement).querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
  } else if (e.key === 'ArrowLeft') {
    const menus = [...root.children] as HTMLElement[];
    const at = menus.indexOf(menu);
    if (at > 0) {
      const from = menus[at - 1].querySelector<HTMLElement>('.ctx-item.open');
      closeSubsAfter(menus[at - 1]);
      from?.focus();
    }
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (i >= 0) items[i].click();
    if (focused?.classList.contains('has-sub')) (root?.lastElementChild as HTMLElement | null)?.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
  } else return;
  e.preventDefault();
  e.stopPropagation();
}
