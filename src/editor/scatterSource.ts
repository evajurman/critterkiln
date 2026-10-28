// ---------------------------------------------------------------------------
// What a Scatter marking scatters: another creature (one kept off stage, made
// for it, is the usual thing: a spike, a scale, a flower). Something from My
// stuff, or something drawn new, becomes such a creature.

import { defaultState, type CreatureState } from '../creature';
import { type Marking } from '../markings';
import { unlock } from '../achievements';
import { type RigState } from '../rigs';
import { uid } from '../stuff';
import { fa, faClassic } from './dom';
import { creatures, makeCreature, world } from './state';
import { creatureLabel } from './controls';
import { creatureId, editCreature, setOffstage } from './riders';
import { enterDraw } from './drawing';
import { kits, type Kit } from './kits';

/** A small creature of its own, kept off stage (only seen where it's scattered, and while it's edited). */
function offstageCreature(name: string, rig: RigState, parts?: CreatureState['parts']): CreatureState {
  const c = defaultState(rig, '#c9ccd6');
  if (parts) Object.assign(c.parts, structuredClone(parts));
  return { ...c, id: uid(), name, offstage: true, keepFloor: false, eyes: { ...c.eyes, enabled: false, pairs: [] } };
}

function addToScene(s: CreatureState) {
  world.creatures.push(s);
  creatureId(s);
  creatures.push(makeCreature(s));
}

/** Something from My stuff, as a creature to scatter (laid out as it sits: it stands on the surface like the kit does). */
function kitCreature(k: Kit): CreatureState {
  const bones = structuredClone(k.bones);
  delete bones[0].parent;
  return offstageCreature(k.name, { base: 'custom', name: k.name, headId: bones[0].id, bones }, k.parts);
}

/** Something new to scatter: one small part standing up from the surface, drawn straight away. */
function drawNew(set: (patch: Partial<Marking>) => void) {
  const rig: RigState = { base: 'custom', name: 'Thing', headId: 'thing', bones: [{ id: 'thing', name: 'Thing', start: [0, 0, 0], end: [0, 0, 0.3], side: [1, 0, 0], width: 0.12 }] };
  const s = offstageCreature('Thing', rig);
  addToScene(s);
  set({ source: s.id, thing: undefined });
  unlock('scatter');
  editCreature(s.id!);
  enterDraw({ kind: 'bone', boneId: 'thing' });
}

export function renderScatterSource(el: HTMLElement, m: Marking, set: (patch: Partial<Marking>) => void) {
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'sub-title';
  head.textContent = 'What';
  const list = document.createElement('div');
  list.className = 'thing-list scatter-things';
  const card = (name: string, inner: string, title: string, on: boolean, onclick: () => void) => {
    const c = document.createElement('button');
    c.className = 'thing-card pick' + (on ? ' current' : '');
    c.title = title;
    c.innerHTML = `<span class="thumb">${inner}</span><span class="thing-name"></span>`;
    c.querySelector('.thing-name')!.textContent = name;
    c.onclick = onclick;
    list.append(c);
    return c;
  };
  card('Draw new', faClassic('pencil'), 'Draw something new to scatter: a spike, a scale, a flower. Every copy follows as you draw', false, () => drawNew(set)).classList.add('new-card');
  for (const k of kits()) {
    card(k.name, k.thumb ? `<img src="${k.thumb}" alt="" />` : fa('box'), `Scatter ${k.name} (a copy of it, kept off stage)`, false, () => {
      const s = kitCreature(k);
      addToScene(s);
      set({ source: s.id, thing: undefined });
      unlock('scatter');
    });
  }
  // or a creature in the scene: little critters all over this one
  world.creatures.forEach((s, i) => {
    if (i === world.active) return;
    const id = creatureId(s);
    const c = card(creatureLabel(i), fa('paw'), `Scatter copies of ${creatureLabel(i)}: change it, and they change too`, m.source === id, () => {
      set({ source: id, thing: undefined });
      unlock('scatter');
    });
    const thumb = c.querySelector<HTMLElement>('.thumb')!;
    thumb.classList.add('creature-swatch');
    thumb.style.background = Object.values(s.parts)[0]?.color ?? '#ccc';
  });
  el.append(head, list);
  const source = m.source ? world.creatures.findIndex((s) => s.id === m.source) : -1;
  if (source < 0) return;
  const edit = document.createElement('button');
  edit.className = 'ghost scatter-edit';
  edit.innerHTML = `${fa('pencil')} Change ${creatureLabel(source)}`;
  edit.title = 'Edit it: every copy follows (click your critter to come back)';
  edit.onclick = () => editCreature(m.source!);
  el.append(edit);
  if (!world.creatures[source].offstage) {
    const off = document.createElement('button');
    off.className = 'link';
    off.textContent = 'Keep it off stage';
    off.title = 'Only seen scattered here (and while you edit it)';
    off.onclick = () => setOffstage(creatures[source], true);
    el.append(off);
  }
}
