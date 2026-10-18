// Our own tooltips instead of the browser's: every `title` in the app, in index.html or set
// from code later, is moved to data-tooltip the moment it appears (so the browser never
// shows its own), and shown in one bubble (.ck-tooltip in style.css) on hover or keyboard focus.
// Screen readers still get it: as the name of an icon-only button, else as its description.
const DELAY = 450;
/** moving from one tooltip to the next soon after, it shows straight away */
const WARM = 60;
const WARM_MS = 500;
const GAP = 8;
const EDGE = 8;

/** An element's tooltip text, whether or not it's been moved off `title` yet. */
export function tipOf(el: HTMLElement): string {
  return el.getAttribute('title') ?? el.dataset.tooltip ?? '';
}

function adopt(el: Element) {
  const t = el.getAttribute('title');
  if (t === null || !(el instanceof HTMLElement)) return;
  el.removeAttribute('title');
  if (!t) {
    delete el.dataset.tooltip;
    el.removeAttribute('aria-description');
    return;
  }
  el.dataset.tooltip = t;
  // a button that's just an icon is named by its tooltip; anything else is described by it
  if (el.dataset.tooltipNames !== undefined || (!el.hasAttribute('aria-label') && !el.textContent?.trim())) {
    el.dataset.tooltipNames = '';
    el.setAttribute('aria-label', t);
  } else el.setAttribute('aria-description', t);
  if (el === shown) fill(t);
}

let bubble: HTMLDivElement;
let shown: HTMLElement | null = null;
let timer = 0;
let lastHide = 0;
/** pressed: no tooltip on it until the pointer leaves */
let quiet: HTMLElement | null = null;

/** "Undo (Ctrl+Z)": the key on the end as a <kbd> */
const KEY = /\s\(((?:(?:Ctrl|Shift|Alt|⌘)\+)*(?:[A-Z0-9↵]|Backspace|Delete|Enter|Esc|Space|Tab|F\d{1,2}))\)$/;
function fill(t: string) {
  const m = t.match(KEY);
  bubble.textContent = m ? t.slice(0, m.index) : t;
  if (m) {
    const k = document.createElement('kbd');
    k.textContent = m[1];
    bubble.append(' ', k);
  }
}

function place(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  // under it, or over it when there's no room below
  const below = r.bottom + GAP + b.height <= vh - EDGE || r.top - GAP - b.height < EDGE;
  const top = below ? r.bottom + GAP : r.top - GAP - b.height;
  const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - b.width / 2), vw - EDGE - b.width);
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
  bubble.style.setProperty('--arrow', `${Math.round(r.left + r.width / 2 - left)}px`);
  bubble.classList.toggle('above', !below);
}

function show(el: HTMLElement) {
  const t = el.dataset.tooltip;
  if (!t || !el.isConnected) return;
  shown = el;
  fill(t);
  place(el);
  bubble.classList.add('show');
}

function hide() {
  clearTimeout(timer);
  if (!shown) return;
  shown = null;
  lastHide = performance.now();
  bubble.classList.remove('show');
}

function want(el: HTMLElement | null) {
  if (el === shown) return;
  const warm = !!shown || performance.now() - lastHide < WARM_MS;
  hide();
  if (!el) return;
  timer = window.setTimeout(() => show(el), warm ? WARM : DELAY);
}

const tipped = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-tooltip]') : null);

export function installTooltips() {
  bubble = document.createElement('div');
  bubble.className = 'ck-tooltip';
  bubble.setAttribute('role', 'tooltip');
  document.body.append(bubble);

  document.querySelectorAll('[title]').forEach(adopt);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') adopt(m.target as Element);
      else
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          adopt(n);
          n.querySelectorAll('[title]').forEach(adopt);
        });
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  // hover (not touch: a tap is a click there, and there's no hover to end it)
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = tipped(e.target);
    if (el !== quiet) quiet = null;
    want(el && el !== quiet ? el : null);
  }, true);
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) want(null);
  }, true);
  // the thing it's on was taken away, or redrawn, under the pointer
  document.addEventListener('pointermove', () => {
    if (shown && !shown.isConnected) hide();
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    quiet = tipped(e.target);
    hide();
  }, true);
  window.addEventListener('wheel', hide, { passive: true, capture: true });
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('blur', hide);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') hide();
  }, true);
  // keyboard focus shows it too
  document.addEventListener('focusin', (e) => {
    const el = e.target instanceof HTMLElement && e.target.matches(':focus-visible') ? tipped(e.target) : null;
    if (el) want(el);
  });
  document.addEventListener('focusout', () => hide());
}
