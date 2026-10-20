import { renderTrophies, setTrophyHandlers } from '../achievements';
import { $ } from './dom';
import { togglePopover } from './popovers';

// trophies

function renderTrophyList() {
  if (!$('#trophy-pop').hidden) renderTrophies($('#trophy-list'), $('#trophy-count'));
}
function openTrophies() {
  if ($('#trophy-pop').hidden) togglePopover('#trophy-pop');
  renderTrophyList();
}

export function initTrophyPanel() {
  $('#trophy-btn').onclick = () => {
    if (togglePopover('#trophy-pop')) renderTrophyList();
  };
  $('#trophy-close').onclick = () => {
    if (!$('#trophy-pop').hidden) togglePopover('#trophy-pop');
  };
  setTrophyHandlers({ open: openTrophies, changed: renderTrophyList });
}
