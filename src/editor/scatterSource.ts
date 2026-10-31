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
import { commit, creatures, makeCreature, world } from './state';
import { creatureLabel } from './controls';
import { creatureId, setOffstage } from './riders';
import { editScattered } from './focus';
import { enterDraw } from './drawing';
import { renderUI } from './panels';
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
  return { ...offstageCreature(k.name, { base: 'custom', name: k.name, headId: bones[0].id, bones }, k.parts), kit: k.id };
}

/** Does any scatter scatter this creature? */
function scattered(id: string): boolean {
  return world.creatures.some((s) => [...(s.markings ?? []), ...Object.values(s.parts).flatMap((p) => p.markings ?? [])].some((m) => m.type === 'scatter' && m.source === id));
}

/** Scatter `id` instead: the copy of a kit scattered before goes, if nothing scatters it now (picking the kit again makes it again). */
function scatterThis(m: Marking, set: (patch: Partial<Marking>) => void, id: string) {
  const was = m.source;
  set({ source: id, thing: undefined });
  unlock('scatter');
  const i = was ? world.creatures.findIndex((s) => s.id === was) : -1;
  const s = world.creatures[i];
  if (s?.kit && s.offstage && i !== world.active && !scattered(s.id!) && !world.creatures.some((o) => o.rides?.on === s.id)) {
    creatures[i].dispose();
    creatures.splice(i, 1);
    world.creatures.splice(i, 1);
    if (world.active > i) world.active--;
    commit();
  }
  // (the scene list too: the creature scattered is there)
  renderUI();
}

/** Something new to scatter: one small part standing up from the surface, drawn straight away. */
function drawNew(m: Marking, set: (patch: Partial<Marking>) => void) {
  const rig: RigState = { base: 'custom', name: 'Thing', headId: 'thing', bones: [{ id: 'thing', name: 'Thing', start: [0, 0, 0], end: [0, 0, 0.3], side: [1, 0, 0], width: 0.12 }] };
  const s = offstageCreature('Thing', rig);
  addToScene(s);
  scatterThis(m, set, s.id!);
  editScattered(s.id!);
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
  card('Draw new', faClassic('pencil'), 'Draw something new to scatter: a spike, a scale, a flower. Every copy follows as you draw', false, () => drawNew(m, set)).classList.add('new-card');
  const current = m.source ? world.creatures.find((s) => s.id === m.source) : undefined;
  const kitIds = new Set<string>();
  for (const k of kits()) {
    kitIds.add(k.id);
    card(k.name, k.thumb ? `<img src="${k.thumb}" alt="" />` : fa('box'), `Scatter ${k.name} (a copy of it, kept off stage)`, current?.kit === k.id, () => {
      if (current?.kit === k.id) return;
      // the copy already out (another scatter's, or one let go of): not another one
      let s = world.creatures.find((o) => o.kit === k.id && o.offstage);
      if (!s) addToScene((s = kitCreature(k)));
      scatterThis(m, set, s.id!);
    });
  }
  // or a creature in the scene: little critters all over this one (a kit's copy is its card above)
  world.creatures.forEach((s, i) => {
    if (i === world.active || s.table || (s.kit && s.offstage && kitIds.has(s.kit))) return;
    const id = creatureId(s);
    const c = card(creatureLabel(i), fa('paw'), `Scatter copies of ${creatureLabel(i)}: change it, and they change too`, m.source === id, () => {
      if (m.source !== id) scatterThis(m, set, id);
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
  edit.title = 'Edit it: every copy follows (Done, or Esc, comes back)';
  edit.onclick = () => editScattered(m.source!);
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
