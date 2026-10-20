import { unlock } from '../achievements';
import { installScrollbars } from '../scrollbars';
import { initLayout } from '../layout';
import { installCursorPress } from '../cursorPress';
import { installTooltips } from '../tooltip';
import { $ } from './dom';
import { type Mode, redo, undo } from './state';
import { controls, updateSkeletonVisibility } from './controls';
import { newCreation } from './creations';
import { setMode, tintMode } from './panels';

/** Drops the top bar's button labels whenever they'd overflow it (narrow window or zoomed in). */
export function fitTopbar() {
  const bar = $('.topbar');
  bar.classList.remove('compact');
  // on a phone the tools scroll rather than overflow the bar
  const tools = $('.topbar .tools');
  bar.classList.toggle('compact', bar.scrollWidth > bar.clientWidth || tools.scrollWidth > tools.clientWidth);
}
/** The Shape / Look / Stuff switch has one pill that slides under whichever is picked. */
export function placeModePill() {
  const modes = $('.modes');
  const on = modes.querySelector<HTMLElement>('button.active');
  if (!on) return;
  modes.style.setProperty('--pill-x', `${on.offsetLeft}px`);
  modes.style.setProperty('--pill-w', `${on.offsetWidth}px`);
}

export function initTopbar() {
  // wire up static controls
  // (one listener for them all: tabs people make come and go)
  $('.modes').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (b) setMode(b.dataset.mode as Mode);
  });
  new ResizeObserver(fitTopbar).observe($('.topbar'));
  // labels dropping (compact) or the font loading change the widths
  new ResizeObserver(placeModePill).observe($('.modes'));
  document.fonts.ready.then(placeModePill);
  // only slide once it has found its first spot
  requestAnimationFrame(() => requestAnimationFrame(() => $('.modes').classList.add('slide')));
  document.fonts.ready.then(fitTopbar); // the icon font and the text font change the buttons' widths
  installScrollbars();
  installCursorPress();
  installTooltips();
  initLayout({
    onGizmos: updateSkeletonVisibility,
    // a tab made, renamed or deleted: the bar's widths changed (and maybe the open tab's color)
    onTabs: () => {
      fitTopbar();
      placeModePill();
      tintMode();
    },
    switchTo: (t) => setMode(t),
  });
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#spin').onclick = () => {
    controls.autoRotate = !controls.autoRotate;
    $('#spin').classList.toggle('on', controls.autoRotate);
    if (controls.autoRotate) unlock('spin');
  };
  $('#new').onclick = () => newCreation();
}
