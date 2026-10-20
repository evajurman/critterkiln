// ---------------------------------------------------------------------------
// On a phone the panel is a sheet under the viewport: drag its grip to resize
// it, tap to fold it away.

import { $ } from './dom';

const SHEET_KEY = 'creature-creator/sheet';

export function initSheet() {
  {
    const app = $('#app');
    const grip = $<HTMLButtonElement>('#sheet-grip');
    const MIN_VIEW = 140; // always leave this much of the viewport
    let open = 0.42; // share of the window the open sheet takes
    let folded = false;
    try {
      const s = JSON.parse(localStorage.getItem(SHEET_KEY) ?? '{}');
      if (typeof s.open === 'number') open = s.open;
      folded = !!s.folded;
    } catch {}
    const apply = () => {
      const max = Math.max(0, app.clientHeight - 48 - grip.offsetHeight - MIN_VIEW);
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
      drag = { y: e.clientY, px: $('.panel').offsetHeight, moved: false };
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
