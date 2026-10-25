// ---------------------------------------------------------------------------
// The Markings panel, for anything that can be marked: a creature's parts
// (the Look tab) or a stuff item's pieces (while it's made). A MarkTarget says
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
  SCATTER_MOTIONS,
  SCATTER_WHERE,
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
import { is, keyLabel } from './shortcuts';

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
  /** a spot's mirror image across its middle, in the pattern space (paint can go on both sides at once) */
  mirror?(v: THREE.Vector3): THREE.Vector3;
  /**
   * It can be scattered over: draws what a scatter scatters into `el` (a
   * thing to pick, or one to draw), changing the marking with `set`.
   */
  scatterThing?(el: HTMLElement, m: Marking, set: (patch: Partial<Marking>) => void): void;
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

const brush = { on: false, erase: false, size: 0.03, color: '#e04a4a', mirror: false };
const MIN_BRUSH = 0.005;
const MAX_BRUSH = 0.12;
/** the stroke going on: the marking it's for, and its strokes with this one (and its mirror image, `live` of them) last */
let stroke: { m: Marking; strokes: PaintStroke[]; live: number } | null = null;
/** the brush being sized (see the brushSize key): round where, how many pixels a unit of size is there, and the size it had */
let sizing: { x: number; y: number; pxPerUnit: number; was: number } | null = null;
/** where the pointer last was over the view */
const pointerAt = { x: 0, y: 0 };
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
      if (sizing) {
        // a click keeps the size
        e.stopImmediatePropagation();
        endSizing(true);
        return;
      }
      const m = paintMarking();
      if (!m || e.button !== 0 || h.busy()) return;
      const hit = paintAt(m, e.clientX, e.clientY);
      if (!hit) return;
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
      const going = hit.both.map((at) => {
        const s: PaintStroke = { color: brush.color, r: round(brush.size), pts: at.toArray().map(round) };
        if (brush.erase) s.erase = true;
        return s;
      });
      stroke = { m, strokes: [...(m.strokes ?? []), ...going], live: going.length };
      livePaint(m, stroke.strokes, 0, stroke.live);
      h.invalidate();
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      pointerAt.x = e.clientX;
      pointerAt.y = e.clientY;
      if (sizing) {
        // the ring stays put, its edge under the pointer
        e.stopImmediatePropagation();
        const d = Math.hypot(e.clientX - sizing.x, e.clientY - sizing.y);
        brush.size = Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, d / sizing.pxPerUnit));
        placeRing(sizing.x, sizing.y, brush.size * sizing.pxPerUnit);
        return;
      }
      const m = paintMarking();
      if (!m) return;
      const hit = paintAt(m, e.clientX, e.clientY);
      showRing(e.clientX, e.clientY, hit?.point ?? null);
      if (!stroke) return;
      e.stopImmediatePropagation();
      if (!hit) return;
      const going = stroke.strokes.slice(-stroke.live);
      const n = going[0].pts.length;
      // a point every third of the brush's width or so
      if (new THREE.Vector3().fromArray(going[0].pts, n - 3).distanceTo(hit.both[0]) < brush.size * 0.3) return;
      going.forEach((s, i) => s.pts.push(...hit.both[i].toArray().map(round)));
      livePaint(stroke.m, stroke.strokes, n - 3, stroke.live);
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
    if (!paints(list[i])) return;
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
  sizing = null;
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

/** Whether the brush paints on this marking: paint, or a scatter laid where it's painted. */
const paints = (m: Marking | undefined) => m?.type === 'paint' || (m?.type === 'scatter' && m.where === 'paint');

/** The paint marking the brush paints on, if it's picked up. */
function paintMarking(): Marking | undefined {
  const m = brush.on ? tools?.openRef()?.m : undefined;
  return paints(m) ? m : undefined;
}

/**
 * Where the pointer is on the target, if it's on it: in the scene, and in
 * the paint's own space (with Mirror, its mirror image too: `both`).
 */
function paintAt(m: Marking, x: number, y: number): { both: THREE.Vector3[]; point: THREE.Vector3 } | null {
  const t = tools?.target;
  const hit = t?.surface(host.rayAt(x, y));
  if (!t || !hit) return null;
  // (paint moved with the gizmo is painted where it now is)
  const toPaint = markingPlace(m).invert();
  const both = [hit.at.clone().applyMatrix4(toPaint)];
  if (brush.mirror && t.mirror) both.push(t.mirror(hit.at.clone()).applyMatrix4(toPaint));
  return { both, point: hit.point };
}

/** How many pixels across one unit of brush size is at this spot in the scene. */
function pxPerUnit(point: THREE.Vector3): number {
  const f = tools?.target.frame();
  const view = host.view();
  const r = host.canvas.getBoundingClientRect();
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(view.quaternion).multiplyScalar(f ? f.toWorld.getMaxScaleOnAxis() : 1);
  const a = point.clone().project(view);
  const b = point.clone().add(across).project(view);
  return Math.hypot(((b.x - a.x) * r.width) / 2, ((b.y - a.y) * r.height) / 2);
}

function placeRing(x: number, y: number, px: number) {
  px = Math.max(3, px);
  ring.hidden = false;
  ring.classList.toggle('erase', brush.erase);
  Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, width: `${2 * px}px`, height: `${2 * px}px` });
}

/** The brush's outline round the pointer, as big as it paints there. */
function showRing(x: number, y: number, point: THREE.Vector3 | null) {
  if (!point) {
    ring.hidden = true;
    return;
  }
  placeRing(x, y, brush.size * pxPerUnit(point));
}

/** Start sizing the brush where the pointer is (over the target, or as if it were at the picked one's middle). */
function startSizing() {
  const t = tools?.target;
  const f = t?.frame();
  if (!t || !f) return;
  const hit = t.surface(host.rayAt(pointerAt.x, pointerAt.y));
  const point = hit?.point ?? f.middle.clone().applyMatrix4(f.toWorld);
  sizing = { x: pointerAt.x, y: pointerAt.y, pxPerUnit: Math.max(1e-3, pxPerUnit(point)), was: brush.size };
  placeRing(sizing.x, sizing.y, brush.size * sizing.pxPerUnit);
  host.hintOnce(`Move the pointer to size the brush; click to keep it (Esc: as it was)`, 3000);
}

function endSizing(keep: boolean) {
  if (!sizing) return;
  if (!keep) brush.size = sizing.was;
  sizing = null;
  ring.hidden = true;
  // (the slider shows the new size)
  tools?.render();
}

/**
 * Keys for the brush while it's picked up: Brush size, Mirror (both sides),
 * and Esc while sizing. Says whether it took the key (the app shouldn't act on it).
 */
export function markToolKey(e: KeyboardEvent): boolean {
  if (sizing) {
    if (e.key === 'Escape' || is(e, 'brushSize') || e.key === 'Enter') {
      endSizing(e.key !== 'Escape');
      return true;
    }
    return false;
  }
  if (!paintMarking() || stroke) return false;
  if (is(e, 'brushSize')) {
    startSizing();
    return true;
  }
  if (is(e, 'mirror') && tools?.target.mirror) {
    brush.mirror = !brush.mirror;
    host.hint(brush.mirror ? 'Mirror on: paint goes on both sides' : 'Mirror off', 1600);
    tools.render();
    return true;
  }
  return false;
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
  /** the row (see refs) whose kinds to change it to are showing */
  swapping: number | null = null;

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
    // (scatters aren't drawn by the material: they don't use up its markings)
    return shownMarkings(this.target.wholeMarkings(), this.target.ownMarkings(id), id).filter((m) => m !== except && m.type !== 'scatter').length;
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
  private noRoomFor(all: boolean, except?: Marking, type?: Marking['type']): string | null {
    if (type === 'scatter') return null;
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

  /** Make a marking another kind, keeping its settings (and where it's been moved to). */
  private retype(r: MarkRef, type: Marking['type']) {
    const list = this.list(r.all);
    const old = list[r.i];
    if (!old || old.type === type) return;
    // (how strongly a pattern's cut and what's been painted, written or picked are the old kind's own)
    const { size, rough, amount, darkness, color, finish, relief, offset, turn, stretch, skip } = old;
    const keep: Partial<Marking> = { size, rough, amount, darkness, color, finish, relief, offset, turn, stretch, skip };
    const m: Marking = { ...defaultMarking(type), ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) };
    // a scatter keeps what it scattered, should it come back
    if (type === 'scatter' && old.thing) m.thing = old.thing;
    // a sticker made from a pattern goes where it's being looked at
    if (STICKERS.includes(type) && !STICKERS.includes(old.type)) this.faceView(m);
    list[r.i] = m;
    this.swapping = null;
    this.save(list, true, r.all);
    this.open = this.refs().findIndex((x) => x.m === m);
    this.render();
    if (type === 'picture') this.pickPicture({ ...r, m });
    if (STICKERS.includes(type)) this.startGizmo('translate');
    if (type === 'paint') this.startBrush(false);
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
  startBrush(erase: boolean) {
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
    if (!m || !f || (brush.on && !paints(m)) || (!brush.on && !gizmoOn)) {
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
    if (this.swapping !== null && this.swapping >= refs.length) this.swapping = null;
    const pics = markingThumbnails();
    const pic = (k: Marking['type']) => (pics.has(k) ? `<img src="${pics.get(k)}" alt="" />` : '<span class="mark-none"></span>');
    const name = (k: Marking['type']) => MARKINGS.find((x) => x.type === k)!.name;
    const Whole = `Whole ${t.whole}`;
    // the whole's first, then the unit's own: the first at the bottom
    refs.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'mark-row' + (i === this.open && !this.adding ? ' active' : '') + (r.off ? ' off' : '');
      const swap = document.createElement('button');
      swap.className = 'mark-swap' + (this.swapping === i ? ' on' : '');
      swap.title = 'Make it a different kind of marking';
      swap.innerHTML = pic(r.m.type);
      swap.onclick = () => {
        this.open = i;
        this.adding = false;
        this.swapping = this.swapping === i ? null : i;
        this.render();
      };
      const open = document.createElement('button');
      open.className = 'mark-pick';
      open.title = 'Change this marking';
      open.innerHTML = `<span>${name(r.m.type)}<small>${r.all ? (r.off ? `${Whole} · off here` : Whole) : `This ${t.unit}`}</small></span>`;
      open.onclick = () => {
        this.open = i;
        this.adding = false;
        this.swapping = null;
        this.render();
      };
      row.append(swap, open);
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
      if (this.swapping === i) el.append(this.kinds(r.m.type, (k) => this.retype(r, k)));
    });
    const add = document.createElement('button');
    add.className = 'ghost mark-add' + (this.adding ? ' on' : '');
    add.innerHTML = `<i class="fa-duotone fa-regular fa-plus" aria-hidden="true"></i> Add marking ${this.all ? `to the whole ${t.whole}` : `to this ${t.unit}`}`;
    const why = this.noRoomFor(this.all);
    // (a scatter always fits)
    add.disabled = !!why && !this.target.scatterThing;
    add.title = why ?? (this.all ? `Lay a pattern over every ${t.unit} (it can be taken off any one of them after)` : `Lay a pattern over just this ${t.unit}`);
    add.onclick = () => {
      this.adding = !this.adding;
      this.swapping = null;
      this.render();
    };
    el.append(add);
    if (this.adding) {
      el.append(
        this.kinds(undefined, (type) => {
          const full = this.noRoomFor(this.all, undefined, type);
          if (full) return host.hint(full, 2600, true);
          const m = defaultMarking(type);
          if (STICKERS.includes(type)) this.faceView(m);
          const all = this.all;
          const list = [...this.list(all), m];
          this.adding = false;
          this.save(list, true, all);
          this.open = this.refs().findIndex((r) => r.m === m);
          this.render();
          if (type === 'picture') this.pickPicture({ m, all, i: list.length - 1, off: false });
          if (STICKERS.includes(type)) this.startGizmo('translate');
          if (type === 'paint') this.startBrush(false);
        }),
      );
    }
    this.renderParams(this.adding ? undefined : refs[this.open]);
  }

  /** A picture of each kind of marking to pick one from (the one it is now, if any, marked). */
  private kinds(now: Marking['type'] | undefined, pick: (type: Marking['type']) => void): HTMLElement {
    const pics = markingThumbnails();
    const kinds = document.createElement('div');
    kinds.className = 'mark-kinds';
    for (const k of MARKINGS) {
      if (k.type === 'scatter' && !this.target.scatterThing) continue;
      const btn = document.createElement('button');
      btn.title = k.title;
      if (k.type === now) btn.className = 'active';
      btn.innerHTML = `${pics.has(k.type) ? `<img src="${pics.get(k.type)}" alt="" />` : '<span class="mark-none"></span>'}<span>${k.name}</span>`;
      btn.onclick = () => pick(k.type);
      kinds.append(btn);
    }
    return kinds;
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
      const keep: Partial<Marking> = { picture: m.picture, text: m.text, font: m.font, strokes: m.strokes, id: m.id, skip: m.skip, thing: m.thing, where: m.where, seed: m.seed };
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
    const slider = (key: 'size' | 'threshold' | 'rough' | 'amount' | 'darkness' | 'finish' | 'relief', label: string, min: number, max: number, ends: [string, string]) => {
      const flip = key === 'threshold';
      const row = document.createElement('label');
      row.className = 'slider';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '0.01';
      input.value = String(flip ? 1 - m[key] : (m[key] ?? 0));
      const d = defaultMarking(m.type)[key] ?? 0;
      input.dataset.default = String(flip ? 1 - d : d);
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
    if (m.type === 'scatter') {
      this.scatterParams(el, r, m, list, change);
      return;
    }
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
    slider('relief', 'Relief', -1, 1, ['pressed in', 'raised']);
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
    this.placeRow(el, m, list, all);
    this.whereRow(el, r);
    this.syncTools();
  }

  /** Where the pattern lies: a gizmo in the view moves, turns and stretches it. */
  private placeRow(el: HTMLElement, m: Marking, list: Marking[], all: boolean) {
    const t = this.target;
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
  }

  /** Where it lives: moved to the whole, or kept to just this unit. */
  private whereRow(el: HTMLElement, r: MarkRef) {
    const t = this.target;
    const all = r.all;
    const where = document.createElement('div');
    where.className = 'mark-where';
    const move = document.createElement('button');
    move.className = 'link';
    move.textContent = all ? `Keep to just this ${t.unit}` : `Put on the whole ${t.whole}`;
    move.title = all ? `Take it off every other ${t.unit}` : `Show it on every ${t.unit} (it can be taken off any one of them after)`;
    move.onclick = () => this.move(r);
    where.append(all ? `On the whole ${t.whole}` : `On this ${t.unit}`, move);
    el.append(where);
  }

  /** A scatter's settings: what's scattered, where, how many, how big, which way and how they move. */
  private scatterParams(el: HTMLElement, r: MarkRef, m: Marking, list: Marking[], change: (patch: Partial<Marking>) => void) {
    const all = r.all;
    const t = this.target;
    const sub = (text: string) => {
      const d = document.createElement('div');
      d.className = 'sub-title';
      d.textContent = text;
      el.append(d);
    };
    const pick = document.createElement('div');
    pick.className = 'scatter-thing';
    el.append(pick);
    t.scatterThing?.(pick, m, (patch) => {
      Object.assign(m, patch);
      this.save(list, true, all);
      this.render();
    });
    const slider = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, ends: [string, string], def: number, step = 0.01, title = '') => {
      const row = document.createElement('label');
      row.className = 'slider';
      if (title) row.title = title;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(get());
      input.dataset.default = String(def);
      input.oninput = () => set(parseFloat(input.value));
      input.onchange = () => host.commit();
      const name = document.createElement('span');
      name.textContent = label;
      const e = document.createElement('span');
      e.className = 'ends';
      e.innerHTML = `<em>${ends[0]}</em><em>${ends[1]}</em>`;
      row.append(name, input, e);
      el.append(row);
    };
    const seg = <T extends string>(items: { id: T; label: string; title: string }[], now: T, set: (v: T) => void) => {
      const s = document.createElement('div');
      s.className = 'seg scatter-seg';
      for (const it of items) {
        const b = document.createElement('button');
        b.className = it.id === now ? 'active' : '';
        b.innerHTML = it.label;
        b.title = it.title;
        b.onclick = () => set(it.id);
        s.append(b);
      }
      el.append(s);
    };
    const keep = () => {
      this.save(list, true, all);
      this.render();
    };
    sub('Where');
    const where = m.where ?? 'all';
    seg(SCATTER_WHERE.map((w) => ({ id: w.where, label: w.name, title: w.title })), where, (w) => {
      m.where = w;
      if (w === 'paint') m.strokes ??= [];
      keep();
      if (w === 'paint') this.startBrush(false);
      else if (brush.on && tools === this) stopMarkTools();
    });
    if (where === 'paint') this.paintTools(el, m, list, all);
    else if (where !== 'all') {
      slider('Size', () => m.size, (v) => change({ size: v }), 0.2, 3, ['small', 'big'], 1, 0.01, 'How big the patches they gather in are');
      slider('Threshold', () => 1 - m.threshold, (v) => change({ threshold: 1 - v }), 0, 1, ['less', 'more'], 0.55, 0.01, 'How much of it they cover');
    }
    sub('How many and how big');
    slider('Amount', () => m.amount, (v) => change({ amount: v }), 0, 1, ['few', 'lots'], 0.35);
    slider('Size', () => m.scale ?? 0.25, (v) => change({ scale: v }), 0.03, 1, ['tiny', 'as drawn'], 0.25, 0.005, 'How big each copy is, against the thing as it was drawn');
    slider('Variety', () => m.vary ?? 0.3, (v) => change({ vary: v }), 0, 1, ['alike', 'mixed'], 0.3);
    slider('Spacing', () => m.spacing ?? 0.5, (v) => change({ spacing: v }), 0, 1.5, ['close', 'apart'], 0.5);
    sub('Which way');
    seg(
      [
        { id: 'stand', label: '<i class="fa-duotone fa-regular fa-arrow-up" aria-hidden="true"></i> Stand up', title: 'The way it was drawn up points out of the surface: spikes, grass, flowers' },
        { id: 'lie', label: '<i class="fa-duotone fa-regular fa-layer-group" aria-hidden="true"></i> Lie flat', title: 'Lying on the surface, its front facing out: scales, badges, sequins' },
      ],
      m.lie ? 'lie' : 'stand',
      (v) => {
        if (v === 'lie') m.lie = true;
        else delete m.lie;
        keep();
      },
    );
    slider('Upright', () => m.upright ?? 0, (v) => change({ upright: v }), 0, 1, ['out', 'up'], 0, 0.01, 'Out of the surface, or up towards the sky (grass grows up)');
    slider('Turn', () => m.spin ?? 1, (v) => change({ spin: v }), 0, 1, ['alike', 'any way'], 1, 0.01, 'Each turned round at random');
    slider('Lean', () => m.lean ?? 0, (v) => change({ lean: v }), 0, 1, ['straight', 'tipped'], 0.15);
    slider('Sink in', () => m.sink ?? 0, (v) => change({ sink: v }), 0, 1, ['on top', 'deep'], 0.1);
    sub('Motion');
    const kind = m.motion?.kind ?? 'none';
    seg(
      [{ id: 'none', label: 'Still', title: 'They keep still (they still ride along as it is posed)' }, ...SCATTER_MOTIONS.map((k) => ({ id: k.kind as string, label: `<i class="fa-duotone fa-regular fa-${k.icon}" aria-hidden="true"></i> ${k.name}`, title: k.title }))],
      kind as string,
      (v) => {
        if (v === 'none') delete m.motion;
        else m.motion = { size: m.motion?.size ?? 0.5, speed: m.motion?.speed ?? 1, kind: v as NonNullable<Marking['motion']>['kind'] };
        keep();
      },
    );
    if (m.motion) {
      const mo = m.motion;
      slider('How much', () => mo.size, (v) => change({ motion: { ...mo, size: (mo.size = v) } }), 0.05, 1, ['a little', 'lots'], 0.5);
      slider('Speed', () => mo.speed, (v) => change({ motion: { ...mo, speed: (mo.speed = Math.round(v)) } }), 1, 6, ['slow', 'fast'], 1, 1, 'Times each one goes back and forth in one loop of the Animate tab');
    }
    const foot = document.createElement('div');
    foot.className = 'mark-place';
    const shuffle = document.createElement('button');
    shuffle.className = 'link';
    shuffle.innerHTML = '<i class="fa-duotone fa-regular fa-shuffle" aria-hidden="true"></i> Shuffle';
    shuffle.title = 'Scatter them again, somewhere else';
    shuffle.onclick = () => {
      m.seed = Math.floor(Math.random() * 1e6);
      keep();
    };
    foot.append(shuffle);
    el.append(foot);
    // a pattern (or paint) can be moved about: the copies follow it
    if (where !== 'all') this.placeRow(el, m, list, all);
    this.whereRow(el, r);
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
    input.min = String(MIN_BRUSH);
    input.max = String(MAX_BRUSH);
    input.step = '0.001';
    input.value = String(brush.size);
    input.oninput = () => (brush.size = parseFloat(input.value));
    const name = document.createElement('span');
    name.textContent = 'Brush size';
    const key = keyLabel('brushSize');
    if (key) size.title = `Or press ${key} while painting, move the pointer, and click`;
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
    if (this.target.mirror) {
      // paint both sides at once
      const sym = document.createElement('label');
      sym.className = 'check mark-mirror';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = brush.mirror;
      box.onchange = () => (brush.mirror = box.checked);
      const key = keyLabel('mirror');
      sym.title = `Each stroke goes on the other side of the ${this.target.whole} too${key ? ` (${key})` : ''}`;
      sym.append(box, ' Mirror: paint both sides');
      el.append(sym);
    }
  }
}
