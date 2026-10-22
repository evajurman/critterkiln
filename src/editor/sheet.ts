// ---------------------------------------------------------------------------
// On a phone: the panel is a sheet under the viewport (drag its grip and it
// snaps to a third, half or most of the screen; tap to fold it away), the top
// bar is a menu, what's picked, and undo, and what's picked opens the parts list.

import { $ } from './dom';

/** How much of the window the open sheet can snap to */
const SNAPS = [0.22, 0.32, 0.45];

/** The top bar's name for what's picked (the inspector's name for it), in the part's color. */
export function setPickPill(name: string, color: string | null) {
  $('#pick-name').textContent = name;
  $('#pick-dot').style.background = color ?? 'transparent';
  $('#pick-dot').hidden = !color;
}

function initPhoneBar() {
  const app = $('#app');
  const bar = $('.topbar');
  const menu = $<HTMLButtonElement>('#phone-menu');
  const pill = $<HTMLButtonElement>('#pick-pill');
  const setMenu = (on: boolean) => {
    bar.classList.toggle('menu-open', on);
    menu.setAttribute('aria-expanded', String(on));
  };
  const setParts = (on: boolean) => {
    app.classList.toggle('parts-open', on);
    pill.setAttribute('aria-expanded', String(on));
  };
  menu.onclick = () => {
    setParts(false);
    setMenu(!bar.classList.contains('menu-open'));
  };
  pill.onclick = () => {
    setMenu(false);
    setParts(!app.classList.contains('parts-open'));
  };
  // the menu closes once something in it is picked; either closes on a tap anywhere else
  bar.querySelector('.tools')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('#undo')) setMenu(false);
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('#phone-menu, .topbar .tools, .topbar .guided-seg')) setMenu(false);
    if (!t.closest('#pick-pill, .outliner')) setParts(false);
  });
}

const SHEET_KEY = 'creature-creator/sheet';

export function initSheet() {
  initPhoneBar();
  {
    const app = $('#app');
    const grip = $<HTMLButtonElement>('#sheet-grip');
    const MIN_VIEW = 140; // always leave this much of the viewport
    /** the most of the room between the top bar and the bottom bar the sheet takes: the view keeps the rest */
    const MOST = 0.5;
    let open = 0.32; // share of the window the open sheet takes
    let folded = false;
    try {
      const s = JSON.parse(localStorage.getItem(SHEET_KEY) ?? '{}');
      if (typeof s.open === 'number') open = s.open;
      folded = !!s.folded;
    } catch {}
    const apply = () => {
      const room = app.clientHeight - $('.topbar').offsetHeight - $('.rail').offsetHeight - grip.offsetHeight;
      const max = Math.max(0, Math.min(room - MIN_VIEW, room * MOST));
      const px = folded ? 0 : Math.min(max, Math.max(80, open * app.clientHeight));
      app.style.setProperty('--sheet', `${Math.round(px)}px`);
    };
    const store = () => {
      try {
        localStorage.setItem(SHEET_KEY, JSON.stringify({ open, folded }));
      } catch {}
    };
    let drag: { y: number; px: number; moved: boolean } | null = null;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, px: $('.side-wrap').offsetHeight, moved: false };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const px = drag.px + dy;
      // drag it most of the way down and it folds away
      folded = px < 60;
      if (!folded) open = px / app.clientHeight;
      apply();
    });
    grip.addEventListener('pointerup', () => {
      if (drag && !drag.moved) folded = !folded;
      // let go: to the nearest of its heights
      else if (drag && !folded) open = SNAPS.reduce((a, b) => (Math.abs(b - open) < Math.abs(a - open) ? b : a));
      drag = null;
      apply();
      store();
    });
    grip.addEventListener('pointercancel', () => (drag = null));
    // picking a mode means wanting to see its panel
    $('.modes').addEventListener('click', (e) => {
      if (!folded || !(e.target as HTMLElement).closest('button[data-mode]')) return;
      folded = false;
      apply();
      store();
    });
    new ResizeObserver(apply).observe(app);
  }
}
