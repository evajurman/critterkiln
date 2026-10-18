// ---------------------------------------------------------------------------
// The Markings panel, for anything that can be marked: a creature's parts
// (the Look tab) or a stuff item's pieces (the Stuff tab). A MarkTarget says
// where its markings live: on the whole (creature, item), where any one
// part or piece can turn them off, or on one part or piece. The panel lists
// the picked one's, edits them, and runs the tools that work in the view:
// the gizmo that moves, turns and stretches a pattern, and the paint brush.
// One panel's tools are out at a time (see host.takeOver).

import * as THREE from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  FONTS,
  MARKINGS,
  MAX_MARKINGS,
  STICKERS,
  defaultMarking,
  endLivePaint,
  livePaint,
  markingPlace,
  markingThumbnails,
  markingUses,
  pictureId,
  shownMarkings,
  type Marking,
  type PaintStroke,
} from './markings';

/** Something with markings: a creature (by part) or a stuff item (by piece). */
export interface MarkTarget {
  /** what its units and the whole are called ("part", "creature"; "piece", "thing") */
  unit: string;
  whole: string;
  /** the picked unit's id, if one is picked */
  picked(): string | null;
  /** every unit's id */
  units(): string[];
  /** the markings on the whole, and on a unit of its own */
  wholeMarkings(): Marking[] | undefined;
  ownMarkings(id: string): Marking[] | undefined;
  /** keep these (an empty list: none) */
  setWhole(list: Marking[]): void;
  setOwn(id: string, list: Marking[]): void;
  /** where its pictures are kept, by id */
  pictures(): Record<string, string> | undefined;
  setPictures(p: Record<string, string> | undefined): void;
  /** a unit's own color */
  colorOf(id: string): string;
  /** its markings changed: show them (and keep the change for undo, with `doCommit`) */
  changed(doCommit: boolean): void;
  /** the pattern space as it's shown in the scene now (as the picked unit sits), and the picked unit's middle in it */
  frame(): { toWorld: THREE.Matrix4; middle: THREE.Vector3 } | null;
  /** where a ray first meets it: the spot in the scene, and in the pattern space */
  surface(ray: THREE.Raycaster): { point: THREE.Vector3; at: THREE.Vector3 } | null;
}

/** What the panels need from the app. */
export interface MarkHost {
  gizmo: TransformControls;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  /** the camera the view is seen through */
  view(): THREE.Camera;
  /** a ray from the camera through this spot on the screen */
  rayAt(x: number, y: number): THREE.Raycaster;
  invalidate(): void;
  commit(): void;
  hint(text: string, ms?: number, warn?: boolean): void;
  hintOnce(text: string, ms?: number): void;
  /** the marking tools are coming out: put away whatever else holds the gizmo */
  takeOver(): void;
  /** the marking tools went in or out: show or hide the handles they'd be in the way of */
  toolsChanged(): void;
  /** the view's being panned, or something drawn (the brush leaves it alone) */
  busy(): boolean;
}

/** One of the markings the picked unit has: the whole's (`all`) or its own, its place in that list, and whether it's turned off on this unit. */
interface MarkRef {
  m: Marking;
  all: boolean;
  i: number;
  off: boolean;
}

type GizmoMode = 'translate' | 'rotate' | 'scale';

let host: MarkHost;
/** the panel whose tools are out (its gizmo or brush) */
let tools: MarkingPanel | null = null;
let gizmoOn = false;
/** the pattern space as shown in the scene (kept in step every frame) */
const frame = new THREE.Group();
frame.matrixAutoUpdate = false;
const proxy = new THREE.Object3D();
frame.add(proxy);
/** where the gizmo sits on the pattern: the picked unit's middle (a sticker: the sticker) */
const anchor = new THREE.Vector3();
let dragPending = false;

const brush = { on: false, erase: false, size: 0.03, color: '#e04a4a' };
/** the stroke going on: the marking it's for, and its strokes with this one last */
let stroke: { m: Marking; strokes: PaintStroke[] } | null = null;
/** the brush's outline, under the pointer */
const ring = document.createElement('div');
ring.id = 'brush-ring';
ring.hidden = true;

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Set the panels up (once, at the start). */
export function initMarkingTools(h: MarkHost) {
  host = h;
  h.scene.add(frame);
  document.body.append(ring);
  const { canvas, gizmo } = h;
  gizmo.addEventListener('objectChange', () => {
    if (gizmo.object !== proxy || dragPending) return;
    dragPending = true;
    requestAnimationFrame(layFromGizmo);
  });
  gizmo.addEventListener('mouseUp', () => {
    if (gizmo.object !== proxy) return;
    // (the last move, which would otherwise land after the commit)
    layFromGizmo();
    tools?.render();
    h.commit();
  });
  // (before the view and the handles see the press: a stroke on it is the brush's)
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      const m = paintMarking();
      if (!m || e.button !== 0 || h.busy()) return;
      const hit = paintAt(m, e.clientX, e.clientY);
      if (!hit) return;
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
      const s: PaintStroke = { color: brush.color, r: round(brush.size), pts: hit.at.toArray().map(round) };
      if (brush.erase) s.erase = true;
      stroke = { m, strokes: [...(m.strokes ?? []), s] };
      livePaint(m, stroke.strokes, 0);
      h.invalidate();
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      const m = paintMarking();
      if (!m) return;
      const hit = paintAt(m, e.clientX, e.clientY);
      showRing(e.clientX, e.clientY, hit?.point ?? null);
      if (!stroke) return;
      e.stopImmediatePropagation();
      if (!hit) return;
      const s = stroke.strokes[stroke.strokes.length - 1];
      const n = s.pts.length;
      // a point every third of the brush's width or so
      if (new THREE.Vector3().fromArray(s.pts, n - 3).distanceTo(hit.at) < brush.size * 0.3) return;
      s.pts.push(...hit.at.toArray().map(round));
      livePaint(stroke.m, stroke.strokes, n - 3);
      h.invalidate();
    },
    { capture: true },
  );
  const endStroke = (e: PointerEvent) => {
    if (!stroke) return;
    e.stopImmediatePropagation();
    const { m, strokes } = stroke;
    stroke = null;
    endLivePaint(m);
    const p = tools;
    const r = p?.openRef();
    if (!p || !r) return;
    const list = p.list(r.all);
    const i = list.indexOf(m) >= 0 ? list.indexOf(m) : r.i;
    if (list[i]?.type !== 'paint') return;
    list[i] = { ...list[i], strokes };
    p.save(list, true, r.all);
    p.render();
  };
  canvas.addEventListener('pointerup', endStroke, { capture: true });
  canvas.addEventListener('pointercancel', endStroke, { capture: true });
  canvas.addEventListener('pointerleave', () => (ring.hidden = true));
}

/** Whether the gizmo is on a marking (the app's own gizmo handlers leave it be). */
export function markGizmoHeld(): boolean {
  return host.gizmo.object === proxy;
}

/** Whether a marking's gizmo or brush is out (the other tools' handles stay hidden meanwhile). */
export function markToolsOut(): boolean {
  return gizmoOn || brush.on;
}

/** Put the marking tools away (leaving a tab, switching creatures...). */
export function stopMarkTools() {
  const p = tools;
  if (!markToolsOut()) return;
  gizmoOn = false;
  brush.on = false;
  ring.hidden = true;
  if (host.gizmo.object === proxy) host.gizmo.detach();
  tools = null;
  host.invalidate();
  p?.render();
  host.toolsChanged();
}

/** Keep the gizmo on its pattern as the scene moves (call before drawing a frame). */
export function followMarkTools() {
  if (host.gizmo.object !== proxy || !tools) return;
  const f = tools.target.frame();
  if (!f) return;
  frame.matrix.copy(f.toWorld);
  frame.updateMatrixWorld(true);
}

/** W, E or R while a marking's gizmo is out: move, turn or stretch. Says whether it was. */
export function markGizmoMode(m: GizmoMode): boolean {
  if (!gizmoOn || !tools) return false;
  tools.startGizmo(m);
  return true;
}

/** The paint marking the brush paints on, if it's picked up. */
function paintMarking(): Marking | undefined {
  const m = brush.on ? tools?.openRef()?.m : undefined;
  return m?.type === 'paint' ? m : undefined;
}

/** Where the pointer is on the target, in the paint's own space (and in the scene), if it's on it. */
function paintAt(m: Marking, x: number, y: number): { at: THREE.Vector3; point: THREE.Vector3 } | null {
  const hit = tools?.target.surface(host.rayAt(x, y));
  if (!hit) return null;
  // (paint moved with the gizmo is painted where it now is)
  return { at: hit.at.applyMatrix4(markingPlace(m).invert()), point: hit.point };
}

/** The brush's outline round the pointer, as big as it paints there. */
function showRing(x: number, y: number, point: THREE.Vector3 | null) {
  const f = tools?.target.frame();
  if (!point || !f) {
    ring.hidden = true;
    return;
  }
  const view = host.view();
  const r = host.canvas.getBoundingClientRect();
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(view.quaternion).multiplyScalar(brush.size * f.toWorld.getMaxScaleOnAxis());
  const a = point.clone().project(view);
  const b = point.clone().add(across).project(view);
  const px = Math.max(3, Math.hypot(((b.x - a.x) * r.width) / 2, ((b.y - a.y) * r.height) / 2));
  ring.hidden = false;
  ring.classList.toggle('erase', brush.erase);
  Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, width: `${2 * px}px`, height: `${2 * px}px` });
}

/** Lay the open marking where the gizmo is. */
function layFromGizmo() {
  dragPending = false;
  const p = tools;
  const r = p?.openRef();
  if (!p || !r) return;
  const list = p.list(r.all);
  proxy.updateMatrix();
  const pos = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const stretch = new THREE.Vector3();
  proxy.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(anchor.clone().negate())).decompose(pos, turn, stretch);
  list[r.i] = {
    ...list[r.i],
    offset: pos.toArray().map(round) as [number, number, number],
    turn: turn.toArray().map(round) as [number, number, number, number],
    // (never squashed flat)
    stretch: stretch.toArray().map((v) => round(Math.max(0.05, v))) as [number, number, number],
  };
  p.save(list, false, r.all);
}

/** A picture at most 512 across, as a data URL (webp keeps see-through parts and is small; a browser that can't write it gives a png). */
async function shrinkPicture(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return c.toDataURL('image/webp', 0.9);
}

export class MarkingPanel {
  /** new markings go on the whole (or the picked unit) */
  all = true;
  /** which of the picked unit's markings (see refs) is open */
  open = 0;
  /** the kinds to add one from are showing */
  adding = false;

  constructor(
    readonly target: MarkTarget,
    private readonly els: { list: HTMLElement; params: HTMLElement },
  ) {}

  /** The picked unit's markings: the whole's, then its own. */
  refs(): MarkRef[] {
    const id = this.target.picked();
    if (id === null) return [];
    return [
      ...(this.target.wholeMarkings() ?? []).map((m, i) => ({ m, all: true, i, off: !!m.skip?.includes(id) })),
      ...(this.target.ownMarkings(id) ?? []).map((m, i) => ({ m, all: false, i, off: false })),
    ];
  }

  /** The open marking (none while picking a new one). */
  openRef(): MarkRef | undefined {
    if (this.adding) return undefined;
    return this.refs()[this.open];
  }

  /** A copy of the whole's markings, or the picked unit's own. */
  list(all: boolean): Marking[] {
    const id = this.target.picked();
    return [...((all ? this.target.wholeMarkings() : id !== null ? this.target.ownMarkings(id) : undefined) ?? [])];
  }

  /** How many markings a unit shows. */
  private count(id: string, except?: Marking): number {
    return shownMarkings(this.target.wholeMarkings(), this.target.ownMarkings(id), id).filter((m) => m !== except).length;
  }

  /** Make these the whole's markings (`all`), or the picked unit's own. */
  save(list: Marking[], doCommit: boolean, all: boolean) {
    const t = this.target;
    const id = t.picked();
    if (all) t.setWhole(list);
    else if (id !== null) t.setOwn(id, list);
    // pictures no marking shows any more go
    const pics = t.pictures();
    if (pics) {
      const shown = new Set([...(t.wholeMarkings() ?? []), ...t.units().flatMap((u) => t.ownMarkings(u) ?? [])].map((m) => m.picture));
      const kept = Object.fromEntries(Object.entries(pics).filter(([k]) => shown.has(k)));
      t.setPictures(Object.keys(kept).length ? kept : undefined);
    }
    t.changed(doCommit);
  }

  /** Why a marking can't go on (the whole, or the picked unit), if it can't: a unit already shows as many as it can. */
  private noRoomFor(all: boolean, except?: Marking): string | null {
    const t = this.target;
    const picked = t.picked();
    const ids = all ? t.units() : picked !== null ? [picked] : [];
    const full = ids.find((id) => this.count(id, except) >= MAX_MARKINGS);
    if (full === undefined) return null;
    return full === picked ? `This ${t.unit} already shows ${MAX_MARKINGS} markings` : `A ${t.unit} already shows ${MAX_MARKINGS} markings (take one off it first)`;
  }

  /** Turn one of the whole's markings off on the picked unit, or back on. */
  private toggleHere(r: MarkRef) {
    const id = this.target.picked();
    if (id === null) return;
    if (r.off) {
      const why = this.noRoomFor(false);
      if (why) return host.hint(why, 2600, true);
    }
    const list = this.list(true);
    const skip = (r.m.skip ?? []).filter((x) => x !== id);
    if (!r.off) skip.push(id);
    list[r.i] = { ...r.m, skip };
    if (!skip.length) delete list[r.i].skip;
    this.save(list, true, true);
    this.render();
  }

  /** Move a marking to the whole, or keep it to just the picked unit. */
  private move(r: MarkRef) {
    const { skip: _skip, ...m } = r.m;
    if (r.all) {
      // just this one: off the rest
      const list = this.list(true);
      list.splice(r.i, 1);
      this.save(list, false, true);
      this.save([...this.list(false), m], true, false);
      this.open = this.refs().length - 1;
    } else {
      const why = this.noRoomFor(true, r.m);
      if (why) return host.hint(why, 2600, true);
      const own = this.list(false);
      own.splice(r.i, 1);
      this.save(own, false, false);
      const list = [...this.list(true), m];
      this.save(list, true, true);
      this.open = list.length - 1;
    }
    this.render();
  }

  /** Lay a sticker on the picked unit where the view meets it (in its middle), facing the way it's being looked at. */
  private faceView(m: Marking) {
    const f = this.target.frame();
    if (!f) return;
    const view = host.view();
    const toPattern = f.toWorld.clone().invert();
    let mid = f.middle.clone();
    // on its surface, not deep inside a fat part (a sticker only reaches so far in and out)
    const from = view.getWorldPosition(new THREE.Vector3());
    const ray = new THREE.Raycaster(from, mid.clone().applyMatrix4(f.toWorld).sub(from).normalize());
    const hit = this.target.surface(ray);
    if (hit) mid = hit.at;
    const eye = from.applyMatrix4(toPattern);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(view.quaternion).transformDirection(toPattern);
    // (its front, +Z, towards the eye)
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, mid, up));
    m.offset = mid.toArray().map(round) as [number, number, number];
    m.turn = turn.toArray().map(round) as [number, number, number, number];
  }

  /** Ask for a picture from the computer for this marking (made small enough to keep). */
  private pickPicture(r: MarkRef) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let src: string;
      try {
        src = await shrinkPicture(file);
      } catch {
        host.hint('That picture couldn’t be opened', 2600, true);
        return;
      }
      const list = this.list(r.all);
      const i = list.indexOf(r.m) >= 0 ? list.indexOf(r.m) : r.i;
      if (list[i]?.type !== 'picture') return;
      const id = pictureId(src);
      this.target.setPictures({ ...this.target.pictures(), [id]: src });
      list[i] = { ...list[i], picture: id };
      this.save(list, true, r.all);
      this.render();
    };
    input.click();
  }

  /** Bring out the gizmo on the open marking, moving, turning or stretching it. */
  startGizmo(m: GizmoMode) {
    if (tools && tools !== this) stopMarkTools();
    host.takeOver();
    tools = this;
    brush.on = false;
    ring.hidden = true;
    gizmoOn = true;
    host.gizmo.setMode(m);
    host.gizmo.setSpace('local');
    host.gizmo.showX = host.gizmo.showY = host.gizmo.showZ = true;
    this.render();
    host.toolsChanged();
  }

  /** Pick up the brush (or the eraser) for the open paint marking. */
  private startBrush(erase: boolean) {
    if (tools && tools !== this) stopMarkTools();
    if (gizmoOn) {
      gizmoOn = false;
      if (host.gizmo.object === proxy) host.gizmo.detach();
    }
    host.takeOver();
    tools = this;
    brush.on = true;
    brush.erase = erase;
    this.render();
    host.toolsChanged();
    host.hintOnce(erase ? `Drag over the ${this.target.whole} to rub paint out` : `Drag over the ${this.target.whole} to paint (drag off it to turn the view)`, 3000);
  }

  /** Put the gizmo on the open marking (or the tools away, with nothing to use them on). */
  private syncTools() {
    if (tools !== this) return;
    const m = this.openRef()?.m;
    const f = m && this.target.frame();
    if (!m || !f || (brush.on && m.type !== 'paint') || (!brush.on && !gizmoOn)) {
      if (markToolsOut()) stopMarkTools();
      return;
    }
    if (!gizmoOn) return;
    frame.matrix.copy(f.toWorld);
    frame.updateMatrixWorld(true);
    // (on a sticker the gizmo is the sticker; on a pattern it sits on the unit)
    if (STICKERS.includes(m.type)) anchor.set(0, 0, 0);
    else anchor.copy(f.middle);
    if (!host.gizmo.dragging) {
      markingPlace(m).multiply(new THREE.Matrix4().makeTranslation(anchor)).decompose(proxy.position, proxy.quaternion, proxy.scale);
      proxy.updateMatrixWorld(true);
    }
    if (host.gizmo.object !== proxy) host.gizmo.attach(proxy);
    host.invalidate();
  }

  /** Draw the list of the picked unit's markings (and the open one's settings). */
  render() {
    const t = this.target;
    const el = this.els.list;
    el.innerHTML = '';
    if (t.picked() === null) {
      this.renderParams(undefined);
      return;
    }
    const refs = this.refs();
    this.open = Math.min(this.open, Math.max(0, refs.length - 1));
    const pics = markingThumbnails();
    const pic = (k: Marking['type']) => (pics.has(k) ? `<img src="${pics.get(k)}" alt="" />` : '<span class="mark-none"></span>');
    const name = (k: Marking['type']) => MARKINGS.find((x) => x.type === k)!.name;
    const Whole = `Whole ${t.whole}`;
    // the whole's first, then the unit's own: the first at the bottom
    refs.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'mark-row' + (i === this.open && !this.adding ? ' active' : '') + (r.off ? ' off' : '');
      const open = document.createElement('button');
      open.className = 'mark-pick';
      open.title = 'Change this marking';
      open.innerHTML = `${pic(r.m.type)}<span>${name(r.m.type)}<small>${r.all ? (r.off ? `${Whole} · off here` : Whole) : `This ${t.unit}`}</small></span>`;
      open.onclick = () => {
        this.open = i;
        this.adding = false;
        this.render();
      };
      row.append(open);
      if (r.all) {
        // the whole's: on or off on this unit
        const here = document.createElement('button');
        here.className = 'piece-icon';
        here.innerHTML = `<i class="fa-duotone fa-regular fa-${r.off ? 'eye-slash' : 'eye'}" aria-hidden="true"></i>`;
        here.title = r.off ? `Show it on this ${t.unit} again` : `Take it off just this ${t.unit}`;
        here.onclick = () => this.toggleHere(r);
        row.append(here);
      }
      const del = document.createElement('button');
      del.className = 'piece-icon';
      del.innerHTML = '<i class="fa-slab-duo fa-regular fa-trash" aria-hidden="true"></i>';
      del.title = r.all ? `Take this marking off the whole ${t.whole}` : 'Take this marking off';
      del.onclick = () => {
        const list = this.list(r.all);
        list.splice(r.i, 1);
        this.save(list, true, r.all);
        this.open = Math.max(0, Math.min(this.open, this.refs().length - 1));
        this.render();
      };
      row.append(del);
      el.append(row);
    });
    const add = document.createElement('button');
    add.className = 'ghost mark-add' + (this.adding ? ' on' : '');
    add.innerHTML = `<i class="fa-duotone fa-regular fa-plus" aria-hidden="true"></i> Add marking ${this.all ? `to the whole ${t.whole}` : `to this ${t.unit}`}`;
    const why = this.noRoomFor(this.all);
    add.disabled = !!why;
    add.title = why ?? (this.all ? `Lay a pattern over every ${t.unit} (it can be taken off any one of them after)` : `Lay a pattern over just this ${t.unit}`);
    add.onclick = () => {
      this.adding = !this.adding;
      this.render();
    };
    el.append(add);
    if (this.adding) {
      const kinds = document.createElement('div');
      kinds.className = 'mark-kinds';
      for (const k of MARKINGS) {
        const btn = document.createElement('button');
        btn.title = k.title;
        btn.innerHTML = `${pic(k.type)}<span>${k.name}</span>`;
        btn.onclick = () => {
          const m = defaultMarking(k.type);
          if (STICKERS.includes(k.type)) this.faceView(m);
          const all = this.all;
          const list = [...this.list(all), m];
          this.adding = false;
          this.save(list, true, all);
          this.open = this.refs().findIndex((r) => r.m === m);
          this.render();
          if (k.type === 'picture') this.pickPicture({ m, all, i: list.length - 1, off: false });
          if (STICKERS.includes(k.type)) this.startGizmo('translate');
          if (k.type === 'paint') this.startBrush(false);
        };
        kinds.append(btn);
      }
      el.append(kinds);
    }
    this.renderParams(this.adding ? undefined : refs[this.open]);
  }

  /** The open marking's settings. */
  private renderParams(r: MarkRef | undefined) {
    const t = this.target;
    const el = this.els.params;
    el.innerHTML = '';
    el.hidden = !r;
    if (!r) return this.syncTools();
    const all = r.all;
    const list = this.list(all);
    const m = list[r.i];
    const head = document.createElement('div');
    head.className = 'style-params-head';
    head.innerHTML = `<span>${MARKINGS.find((k) => k.type === m.type)!.name} settings</span>`;
    const reset = document.createElement('button');
    reset.className = 'link';
    reset.textContent = 'Reset';
    reset.onclick = () => {
      // (what's been painted, written or picked stays, and a sticker where it is)
      const keep: Partial<Marking> = { picture: m.picture, text: m.text, font: m.font, strokes: m.strokes, id: m.id, skip: m.skip };
      if (STICKERS.includes(m.type)) Object.assign(keep, { offset: m.offset, turn: m.turn, stretch: m.stretch });
      list[list.indexOf(m)] = { ...defaultMarking(m.type), ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) };
      this.save(list, true, all);
      this.render();
    };
    head.append(reset);
    el.append(head);
    let pending = false;
    const change = (patch: Partial<Marking>) => {
      Object.assign(m, patch);
      if (patch.color === undefined && 'color' in patch) delete m.color;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        this.save(list, false, all);
      });
    };
    // (the threshold reads the other way round on its slider: further right marks more)
    const slider = (key: 'size' | 'threshold' | 'rough' | 'amount' | 'darkness' | 'finish', label: string, min: number, max: number, ends: [string, string]) => {
      const flip = key === 'threshold';
      const row = document.createElement('label');
      row.className = 'slider';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '0.01';
      input.value = String(flip ? 1 - m[key] : m[key]);
      input.oninput = () => change({ [key]: flip ? 1 - parseFloat(input.value) : parseFloat(input.value) });
      input.onchange = () => host.commit();
      const name = document.createElement('span');
      name.textContent = label;
      const e = document.createElement('span');
      e.className = 'ends';
      e.innerHTML = `<em>${ends[0]}</em><em>${ends[1]}</em>`;
      row.append(name, input, e);
      el.append(row);
    };
    const uses = markingUses(m.type);
    if (m.type === 'picture') {
      const choose = document.createElement('button');
      choose.className = 'ghost mark-choose';
      choose.innerHTML = `<i class="fa-duotone fa-regular fa-image" aria-hidden="true"></i> ${m.picture ? 'Change picture' : 'Choose a picture'}`;
      choose.title = 'A picture from your computer (best with a see-through background)';
      choose.onclick = () => this.pickPicture(r);
      el.append(choose);
    }
    if (m.type === 'text') {
      const words = document.createElement('textarea');
      words.className = 'mark-text';
      words.rows = 2;
      words.value = m.text ?? '';
      words.placeholder = 'Type something';
      words.oninput = () => change({ text: words.value });
      words.onchange = () => host.commit();
      const font = document.createElement('select');
      font.className = 'mark-font';
      for (const f of FONTS) {
        const o = new Option(f.name, f.css);
        o.style.fontFamily = f.css;
        font.append(o);
      }
      font.value = m.font ?? FONTS[0].css;
      font.style.fontFamily = font.value;
      font.onchange = () => {
        font.style.fontFamily = font.value;
        change({ font: font.value });
        host.commit();
      };
      el.append(words, font);
    }
    if (m.type === 'paint') this.paintTools(el, m, list, all);
    if (uses.size) slider('size', 'Size', 0.2, 3, ['small', 'big']);
    if (uses.threshold) slider('threshold', 'Threshold', 0, 1, ['less', 'more']);
    if (uses.rough) slider('rough', 'Rough edges', 0, 1, ['clean', 'ragged']);
    slider('amount', 'Amount', 0, 1, ['faint', 'strong']);
    // its color: the unit's own made darker or lighter, or one picked (as it is)
    if (uses.color && !m.color) slider('darkness', 'Darkness', -1, 1, ['lighter', 'darker']);
    slider('finish', 'Finish', -1, 1, ['matte', 'shiny']);
    const row = document.createElement('div');
    row.hidden = !uses.color;
    row.className = 'mark-color';
    const own = document.createElement('label');
    own.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !m.color;
    own.append(box, ` ${t.unit[0].toUpperCase() + t.unit.slice(1)}’s own color`);
    const color = document.createElement('input');
    color.type = 'color';
    color.value = m.color ?? t.colorOf(t.picked()!);
    color.disabled = !m.color;
    color.title = 'The marking’s color';
    box.onchange = () => {
      change({ color: box.checked ? undefined : color.value });
      host.commit();
      // Darkness only goes with the unit's own color
      this.renderParams(r);
    };
    color.oninput = () => change({ color: color.value });
    color.onchange = () => host.commit();
    row.append(own, color);
    el.append(row);
    // where the pattern lies: a gizmo in the view moves, turns and stretches it
    const place = document.createElement('div');
    place.className = 'mark-place';
    const seg = document.createElement('div');
    seg.className = 'seg';
    const modes: [GizmoMode, string, string, string][] = [
      ['translate', 'fa-duotone fa-regular fa-arrows-up-down-left-right', 'Move', 'Slide the pattern over the surface (W)'],
      ['rotate', 'fa-duotone fa-regular fa-rotate', 'Turn', 'Turn the pattern: stripes run another way (E)'],
      ['scale', 'fa-slab-duo fa-regular fa-expand', 'Stretch', 'Stretch the pattern along one way, or drag the middle to size it all (R)'],
    ];
    for (const [gm, icon, label, title] of modes) {
      const b = document.createElement('button');
      const on = tools === this && gizmoOn && host.gizmo.mode === gm;
      b.className = on ? 'active' : '';
      b.innerHTML = `<i class="${icon}" aria-hidden="true"></i> ${label}`;
      b.title = title;
      b.onclick = () => (on ? stopMarkTools() : this.startGizmo(gm));
      seg.append(b);
    }
    const back = document.createElement('button');
    back.className = 'link';
    const sticker = STICKERS.includes(m.type);
    back.textContent = sticker ? 'Face me' : 'Put back';
    back.title = sticker ? `Put it back on the middle of this ${t.unit}, facing you` : 'Undo moving, turning and stretching this pattern';
    back.hidden = !sticker && !m.offset && !m.turn && !m.stretch;
    back.onclick = () => {
      delete m.offset;
      delete m.turn;
      delete m.stretch;
      if (sticker) this.faceView(m);
      this.save(list, true, all);
      this.render();
    };
    place.append(seg, back);
    el.append(place);
    // where it lives: moved to the whole, or kept to just this unit
    const where = document.createElement('div');
    where.className = 'mark-where';
    const move = document.createElement('button');
    move.className = 'link';
    move.textContent = all ? `Keep to just this ${t.unit}` : `Put on the whole ${t.whole}`;
    move.title = all ? `Take it off every other ${t.unit}` : `Show it on every ${t.unit} (it can be taken off any one of them after)`;
    move.onclick = () => this.move(r);
    where.append(all ? `On the whole ${t.whole}` : `On this ${t.unit}`, move);
    el.append(where);
    this.syncTools();
  }

  /** The brush's buttons and settings, in a paint marking's settings. */
  private paintTools(el: HTMLElement, m: Marking, list: Marking[], all: boolean) {
    const seg = document.createElement('div');
    seg.className = 'seg mark-brush';
    const kinds: [boolean, string, string, string][] = [
      [false, 'fa-paintbrush', 'Paint', `Paint on the ${this.target.whole}: drag over it`],
      [true, 'fa-eraser', 'Rub out', 'Rub paint off: drag over it'],
    ];
    for (const [erase, icon, label, title] of kinds) {
      const b = document.createElement('button');
      const on = tools === this && brush.on && brush.erase === erase;
      b.className = on ? 'active' : '';
      b.innerHTML = `<i class="fa-duotone fa-regular ${icon}" aria-hidden="true"></i> ${label}`;
      b.title = title;
      b.onclick = () => (on ? stopMarkTools() : this.startBrush(erase));
      seg.append(b);
    }
    el.append(seg);
    const size = document.createElement('label');
    size.className = 'slider';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0.005';
    input.max = '0.12';
    input.step = '0.001';
    input.value = String(brush.size);
    input.oninput = () => (brush.size = parseFloat(input.value));
    const name = document.createElement('span');
    name.textContent = 'Brush size';
    const ends = document.createElement('span');
    ends.className = 'ends';
    ends.innerHTML = '<em>fine</em><em>broad</em>';
    size.append(name, input, ends);
    el.append(size);
    const row = document.createElement('div');
    row.className = 'mark-color';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = brush.color;
    color.title = 'The brush’s color';
    color.oninput = () => (brush.color = color.value);
    const clear = document.createElement('button');
    clear.className = 'link';
    clear.textContent = 'Clear paint';
    clear.title = 'Take all of this paint off';
    clear.hidden = !m.strokes?.length;
    clear.onclick = () => {
      list[list.indexOf(m)] = { ...m, strokes: [] };
      this.save(list, true, all);
      this.render();
    };
    row.append('Brush color', color, clear);
    el.append(row);
  }
}
