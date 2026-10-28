// ---------------------------------------------------------------------------
// The top bar and the mode rail: the tab switch, fitting the bar's buttons,
// the layout, and undo, redo, spin and new.

import { unlock } from '../achievements';
import { installScrollbars } from '../scrollbars';
import { guidedOn, guidedTab, initLayout, setGuided } from '../layout';
import { installCursorPress } from '../cursorPress';
import { installTooltips } from '../tooltip';
import { $ } from './dom';
import { type Mode, redo, undo } from './state';
import { controls, updateSkeletonVisibility } from './controls';
import { newCreation } from './creations';
import { setMode, tintMode } from './panels';
import { growThingHere } from './rigEdit';
import { renderScope } from './scope';

/** Drops the top bar's button labels whenever they'd overflow it (narrow window or zoomed in). */
export function fitTopbar() {
  const bar = $('.topbar');
  bar.classList.remove('compact');
  // on a phone the tools scroll rather than overflow the bar
  const tools = $('.topbar .tools');
  bar.classList.toggle('compact', bar.scrollWidth > bar.clientWidth || tools.scrollWidth > tools.clientWidth);
}

export function initTopbar() {
  // wire up static controls
  // (one listener for them all: tabs people make come and go)
  $('.modes').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (b) setMode(b.dataset.mode as Mode);
  });
  new ResizeObserver(fitTopbar).observe($('.topbar'));
  document.fonts.ready.then(fitTopbar); // the icon font and the text font change the buttons' widths
  installScrollbars();
  installCursorPress();
  installTooltips();
  initLayout({
    onGizmos: updateSkeletonVisibility,
    // a tab made, renamed or deleted: maybe the open tab's color changed
    onTabs: tintMode,
    switchTo: (t) => setMode(t),
    // what each section changes (part or everything): its title's chip, and the toggle up top
    onSections: renderScope,
    // Dress up's Add a thing
    addThing: () => growThingHere(),
  });
  // Guided or Free: each opens where it was left
  $('#guided-seg').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-guided]');
    if (!b || (b.dataset.guided === 'on') === guidedOn()) return;
    setGuided(b.dataset.guided === 'on');
    setMode(guidedTab());
  });
  // (setMode marks it from then on)
  $('#app').classList.toggle('guided', guidedOn());
  document.querySelectorAll<HTMLButtonElement>('#guided-seg button').forEach((b) => b.classList.toggle('active', (b.dataset.guided === 'on') === guidedOn()));
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#spin').onclick = () => {
    controls.autoRotate = !controls.autoRotate;
    $('#spin').classList.toggle('on', controls.autoRotate);
    if (controls.autoRotate) unlock('spin');
  };
  $('#new').onclick = () => newCreation();
}
