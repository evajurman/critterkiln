// ---------------------------------------------------------------------------
// The hint bubble at the bottom of the view.

import { $ } from './dom';
import { touchScreen } from './controls';
import { drawHint, drawState } from './drawing';

/** How much longer than asked a timed hint stays up, so there's time to read it. */
const HINT_EXTRA_MS = 4500;
const hintEl = $('#hint');
const hintRing = hintEl.querySelector<SVGCircleElement>('.hint-ring .fill')!;
function closeHint() {
  if (drawState) drawHint();
  else hintEl.classList.remove('show');
}

/** Guidance shown since the page loaded: each tip is shown once a session (a reload brings them back). */
const hintsShown = new Set<string>();
/** A how-to tip, shown only the first time it comes up. Feedback on what was just done uses hint(). */
export function hintOnce(text: string, ms = 2000) {
  if (hintsShown.has(text)) return;
  hintsShown.add(text);
  hint(text, ms);
}

/** A message at the bottom of the view; `ms` 0 keeps it up until replaced (drawing instructions). */
export function hint(text: string, ms = 2000, warn = false) {
  // fingers tap
  if (touchScreen()) text = text.replace(/([Cc])lick(ing|ed)?/g, (_, c: string, end = '') => (c === 'C' ? 'T' : 't') + 'ap' + (end && 'p' + end));
  hintEl.querySelector('.hint-text')!.textContent = text;
  hintEl.classList.toggle('show', !!text);
  hintEl.classList.toggle('warn', warn);
  const timed = !!text && ms > 0;
  hintEl.classList.toggle('timed', timed);
  // restart the ring for this message
  hintRing.style.animation = 'none';
  void hintRing.getBoundingClientRect();
  hintRing.style.animation = '';
  if (timed) hintEl.style.setProperty('--hint-ms', `${ms + HINT_EXTRA_MS}ms`);
}

export function initHints() {
  // the ring filling up is the timer: hovering pauses it (CSS), so the hint
  // stays while it's being read; the x closes it
  hintRing.addEventListener('animationend', () => closeHint());
  hintEl.querySelector<HTMLButtonElement>('.hint-close')!.onclick = () => {
    hintEl.classList.remove('show');
  };
}
