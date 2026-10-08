// ---------------------------------------------------------------------------
// Trophies: little goals that nudge people toward corners of the app they
// haven't found yet. Unlocks and progress live in their own IndexedDB
// database (apart from My creations, so neither has to upgrade the other's),
// and each unlock is written in one transaction that first checks it isn't
// already there, so a trophy is only ever announced once, even with two tabs open.

import type { CreatureState } from './creature';
import type { Thing } from './stuff';

export type TrophyArea = 'shape' | 'look' | 'stuff' | 'scene' | 'files';

export interface Trophy {
  id: string;
  title: string;
  desc: string;
  /** Font Awesome icon name, without the fa- */
  icon: string;
  area: TrophyArea;
  /** how many it takes (shown as a progress bar) */
  goal?: number;
  /** shown as ??? until unlocked */
  secret?: boolean;
}

const AREAS: { id: TrophyArea; name: string }[] = [
  { id: 'shape', name: 'Shape' },
  { id: 'look', name: 'Look' },
  { id: 'stuff', name: 'Stuff' },
  { id: 'scene', name: 'Scene & photos' },
  { id: 'files', name: 'Keeping things' },
];

export const TROPHIES: Trophy[] = [
  // shape
  { id: 'alive', area: 'shape', icon: 'bolt', title: 'Inflation Station', desc: 'Draw your first body part.' },
  { id: 'body-plan', area: 'shape', icon: 'dna', title: 'Shape Shifter', desc: 'Switch to a different body plan.' },
  { id: 'named', area: 'shape', icon: 'tag', title: 'Hello, My Name Is', desc: 'Give a creature a name.' },
  { id: 'pose', area: 'shape', icon: 'person-running', title: 'Strike a Pose', desc: 'Bend a creature into a new pose.' },
  { id: 'wonky', area: 'shape', icon: 'scale-unbalanced', title: 'Wonky Is Beautiful', desc: 'Turn off symmetry while drawing.' },
  { id: 'limb', area: 'shape', icon: 'bone', title: 'Spare Parts', desc: 'Add a brand new limb to a skeleton.' },
  { id: 'split', area: 'shape', icon: 'code-fork', title: 'Double Jointed', desc: 'Split a bone in two.' },
  { id: 'limbs', area: 'shape', icon: 'spider', title: 'Too Many Limbs', desc: 'Build a creature with 16 or more parts.' },
  { id: 'rig-save', area: 'shape', icon: 'skull', title: 'Bone Collector', desc: 'Save a skeleton to reuse later.' },
  { id: 'cyclops', area: 'shape', icon: 'eye', title: 'Cyclops Chic', desc: 'Give a creature one big eye in the middle.' },
  { id: 'eyes', area: 'shape', icon: 'eyes', title: 'Eye See You', desc: 'Give one creature three or more sets of eyes.' },
  { id: 'float', area: 'shape', icon: 'cloud', title: 'Gravity Is Optional', desc: 'Lift a creature off the floor.' },
  // look
  { id: 'look', area: 'look', icon: 'palette', title: 'Fashion Week', desc: 'Visit the Look tab.' },
  { id: 'materials', area: 'look', icon: 'gem', title: 'Material World', desc: 'Try out every material.', goal: 10 },
  { id: 'paint-all', area: 'look', icon: 'fill-drip', title: 'Total Makeover', desc: 'Paint the whole creature one color in one go.' },
  { id: 'button-eyes', area: 'look', icon: 'circle-dot', title: 'Cute as a Button', desc: 'Give a creature button eyes.' },
  { id: 'blend', area: 'look', icon: 'blender', title: 'Smoothie Operator', desc: 'Blend two colors together where parts meet.' },
  { id: 'mixed', area: 'look', icon: 'shapes', title: 'Mixed Media', desc: 'Use three different materials on one creature.' },
  { id: 'rainbow', area: 'look', icon: 'rainbow', title: 'Taste the Rainbow', desc: 'Paint one creature in six different colors.' },
  { id: 'ghost', area: 'look', icon: 'ghost', title: 'Ghost Mode', desc: 'Make a part see-through.' },
  // stuff
  { id: 'stuff', area: 'stuff', icon: 'briefcase', title: 'Arts and Crafts', desc: 'Visit the Stuff tab.' },
  { id: 'piece', area: 'stuff', icon: 'scissors', title: 'Tinkerer', desc: 'Draw a piece of stuff on the workbench.' },
  { id: 'turned', area: 'stuff', icon: 'jar', title: 'Wheel Deal', desc: 'Make a turned piece.' },
  { id: 'attach', area: 'stuff', icon: 'hat-wizard', title: 'Accessorize!', desc: 'Put something you made onto a creature.' },
  // scene
  { id: 'buddies', area: 'scene', icon: 'user-group', title: 'Buddy System', desc: 'Have two creatures in one scene.' },
  { id: 'spin', area: 'scene', icon: 'arrows-rotate', title: 'You Spin Me Right Round', desc: 'Put a critter on the turntable.' },
  { id: 'backdrop', area: 'scene', icon: 'image', title: 'Change of Scenery', desc: 'Pick a new backdrop color.' },
  { id: 'dof', area: 'scene', icon: 'camera-retro', title: 'Lights, Camera, Blur', desc: 'Turn on depth of field.' },
  { id: 'photo', area: 'scene', icon: 'camera', title: 'Say Cheese!', desc: 'Take a photo of your scene.' },
  { id: 'clear-photo', area: 'scene', icon: 'border-none', title: 'Now You See Me', desc: 'Take a photo with a see-through background.' },
  // files
  { id: 'new', area: 'files', icon: 'wand-magic-sparkles', title: 'Clean Slate', desc: 'Start a new creation.' },
  { id: 'prolific', area: 'files', icon: 'images', title: 'Proud Parent', desc: 'Have 10 creations in My creations.', goal: 10 },
  { id: 'save', area: 'files', icon: 'floppy-disk', title: 'Message in a Bottle', desc: 'Save a .creature file.' },
  { id: 'glb', area: 'files', icon: 'cube', title: 'Going 3D', desc: 'Download a 3D model.' },
  { id: 'backup', area: 'files', icon: 'box-archive', title: 'Insurance Policy', desc: 'Back up all your creations.' },
  // secrets
  { id: 'undo', area: 'files', icon: 'rotate-left', title: 'Second Thoughts', desc: 'Undo 50 times.', goal: 50, secret: true },
  { id: 'night', area: 'scene', icon: 'moon', title: 'Night Owl', desc: 'Make something between 8pm and 2am.', secret: true },
  { id: 'early', area: 'scene', icon: 'sun', title: 'Early Bird', desc: 'Make something between 6am and 11am.', secret: true },
];

const byId = new Map(TROPHIES.map((t) => [t.id, t]));

/** What's stored for one trophy. */
interface Rec {
  id: string;
  /** when it was unlocked */
  at?: number;
  /** count so far (trophies with a goal) */
  n?: number;
  /** distinct things seen so far, for "try every…" trophies */
  keys?: string[];
}

const DB_NAME = 'critterkiln-trophies';
const STORE = 'progress';

/** In-memory copy, read once at startup; IndexedDB stays the source of truth for unlocking. */
const cache = new Map<string, Rec>();

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

const loaded: Promise<void> = (async () => {
  try {
    const tx = (await db()).transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll() as IDBRequest<Rec[]>;
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    for (const r of req.result) cache.set(r.id, r);
  } catch {
    /* private window or storage blocked: trophies last for this visit only */
  }
})();

/**
 * Change one trophy's record. The read and the write share a transaction, so
 * two tabs can't both unlock the same trophy. Announces it if this change unlocked it.
 */
async function change(id: string, fn: (r: Rec) => Rec | null) {
  const trophy = byId.get(id);
  if (!trophy || cache.get(id)?.at) return;
  await loaded;
  const apply = (before: Rec | undefined) => ({ before, after: before?.at ? null : fn(structuredClone(before ?? { id })) });
  let res: { before?: Rec; after: Rec | null } = { after: null };
  try {
    const tx = (await db()).transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id) as IDBRequest<Rec | undefined>;
    get.onsuccess = () => {
      res = apply(get.result);
      if (res.after) store.put(res.after);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch {
    // no database: keep it in memory instead
    res = apply(cache.get(id));
  }
  const { before, after } = res;
  const rec = after ?? before;
  if (rec) cache.set(id, rec);
  if (after?.at && !before?.at) {
    toast(trophy);
    onChange?.();
  }
}

function finish(r: Rec, goal: number | undefined, n: number): Rec {
  r.n = n;
  if (n >= (goal ?? 1)) r.at = Date.now();
  return r;
}

/** Unlock a trophy (does nothing if it already is). */
export function unlock(id: string) {
  void change(id, (r) => ({ ...r, at: Date.now() }));
}

/** Count one more toward a trophy's goal. */
export function bump(id: string, by = 1) {
  void change(id, (r) => finish(r, byId.get(id)!.goal, (r.n ?? 0) + by));
}

/** Progress toward a goal that's measured, not counted (it never goes back down). */
export function reach(id: string, n: number) {
  if ((cache.get(id)?.n ?? 0) >= n) return;
  void change(id, (r) => (n > (r.n ?? 0) ? finish(r, byId.get(id)!.goal, n) : null));
}

/** Note one of the things a "try every…" trophy wants; it unlocks when it has them all. */
export function collect(id: string, key: string) {
  if (cache.get(id)?.keys?.includes(key)) return;
  void change(id, (r) => {
    if (r.keys?.includes(key)) return null;
    r.keys = [...(r.keys ?? []), key];
    return finish(r, byId.get(id)!.goal, r.keys.length);
  });
}

function unlocked(id: string) {
  return !!cache.get(id)?.at;
}

// ---- trophies that depend on what's in the scene

let sceneTimer = 0;
/** Look over the scene for trophies (after every change; cheap, and batched). */
export function checkScene(creatures: CreatureState[], workbench?: Thing) {
  clearTimeout(sceneTimer);
  sceneTimer = window.setTimeout(() => scanScene(creatures, workbench), 400);
}

function scanScene(creatures: CreatureState[], workbench?: Thing) {
  const when = (id: string, test: () => boolean) => {
    if (!unlocked(id) && test()) unlock(id);
  };
  when('buddies', () => creatures.length >= 2);
  const hour = new Date().getHours();
  when('night', () => hour >= 20 || hour < 2);
  when('early', () => hour >= 6 && hour < 11);
  // stuff on the workbench, or already worn
  const things = [...(workbench ? [workbench] : []), ...creatures.flatMap((s) => s.attachments?.map((a) => a.thing) ?? [])];
  when('turned', () => things.some((t) => t.pieces.some((p) => p.kind === 'turned')));
  for (const s of creatures) {
    const parts = Object.values(s.parts);
    when('alive', () => parts.some((p) => p.outline));
    when('named', () => !!s.name?.trim());
    when('pose', () => Object.values(s.pose).some((q) => Math.abs(q[3]) < 0.995));
    when('limbs', () => s.rig.bones.reduce((n, b) => n + (b.mirror ? 2 : 1), 0) >= 16);
    when('cyclops', () => s.eyes.enabled && s.eyes.pairs.some((e) => e.single));
    when('eyes', () => s.eyes.enabled && s.eyes.pairs.length >= 3);
    when('float', () => s.keepFloor === false);
    when('mixed', () => new Set(parts.map((p) => p.style ?? s.style)).size >= 3);
    when('rainbow', () => new Set(parts.map((p) => p.color.toLowerCase())).size >= 6);
    when('ghost', () => parts.some((p) => (p.opacity ?? 1) < 0.7));
    when('attach', () => !!s.attachments?.length);
    when('button-eyes', () => s.eyes.enabled && s.eyes.style === 'button');
    when('blend', () => !!s.mergeColors && new Set(parts.map((p) => p.color.toLowerCase())).size >= 2);
    // what a creature is already made of counts as tried (clay, to begin with)
    if (!unlocked('materials')) for (const style of new Set(parts.map((p) => p.style ?? s.style))) collect('materials', style);
  }
}

// ---- the toast

let toastBox: HTMLElement | null = null;
/** what clicking a toast does (opens the trophy list) */
let onToastClick: (() => void) | null = null;
/** called whenever something unlocks (to refresh an open list) */
let onChange: (() => void) | null = null;

export function setTrophyHandlers(h: { open: () => void; changed: () => void }) {
  onToastClick = h.open;
  onChange = h.changed;
}

const TOAST_MS = 5200;
/** at most this many on screen; the rest wait their turn */
const MAX_TOASTS = 3;
const waiting: Trophy[] = [];
let showing = 0;
let lastShown = 0;

/** Announce a trophy (several unlocked at once come in one after another). */
export function toast(t: Trophy) {
  waiting.push(t);
  nextToast();
}

function nextToast() {
  if (!waiting.length || showing >= MAX_TOASTS) return;
  // a little gap between arrivals, so they don't all fly in as one
  const wait = lastShown + 450 - performance.now();
  if (wait > 0) {
    setTimeout(nextToast, wait);
    return;
  }
  lastShown = performance.now();
  showing++;
  showToast(waiting.shift()!);
  nextToast();
}

/** The "trophy unlocked" card: flies in from the left, wobbles to a stop at the top right. */
function showToast(t: Trophy) {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('aria-live', 'polite');
    document.body.append(toastBox);
  }
  const el = document.createElement('button');
  el.className = 'toast';
  el.title = 'See all trophies';
  el.innerHTML = `
    <span class="toast-icon"><i class="fa-solid fa-${t.icon}" aria-hidden="true"></i></span>
    <span class="toast-text">
      <span class="toast-kicker"><i class="fa-solid fa-trophy" aria-hidden="true"></i> Trophy unlocked</span>
      <span class="toast-title"></span>
      <span class="toast-desc"></span>
    </span>`;
  el.querySelector('.toast-title')!.textContent = t.title;
  el.querySelector('.toast-desc')!.textContent = t.desc;
  let timer = 0;
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    el.remove();
    showing--;
    nextToast();
  };
  const leave = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    el.addEventListener('animationend', remove, { once: true });
    // in case animations are off
    setTimeout(remove, 600);
  };
  el.onclick = () => {
    leave();
    onToastClick?.();
  };
  // stays while it's being read
  el.onmouseenter = () => clearTimeout(timer);
  el.onmouseleave = () => (timer = window.setTimeout(leave, 1800));
  toastBox.append(el);
  timer = window.setTimeout(leave, TOAST_MS);
}

// ---- the list

export function renderTrophies(list: HTMLElement, count: HTMLElement) {
  const done = TROPHIES.filter((t) => unlocked(t.id)).length;
  count.textContent = `${done} / ${TROPHIES.length}`;
  list.innerHTML = '';
  for (const area of AREAS) {
    const ts = TROPHIES.filter((t) => t.area === area.id && (!t.secret || unlocked(t.id)));
    if (!ts.length) continue;
    const h = document.createElement('div');
    h.className = 'pop-sub trophy-area';
    h.textContent = area.name;
    list.append(h);
    for (const t of ts) list.append(card(t));
  }
  const secrets = TROPHIES.filter((t) => t.secret && !unlocked(t.id));
  if (secrets.length) {
    const h = document.createElement('div');
    h.className = 'pop-sub trophy-area';
    h.textContent = 'Secrets';
    list.append(h);
    for (const t of secrets) list.append(card(t));
  }
}

function card(t: Trophy): HTMLElement {
  const rec = cache.get(t.id);
  const got = !!rec?.at;
  const hidden = t.secret && !got;
  const el = document.createElement('div');
  el.className = 'trophy' + (got ? ' got' : '');
  el.innerHTML = `
    <span class="trophy-icon"><i class="fa-solid fa-${hidden ? 'question' : t.icon}" aria-hidden="true"></i></span>
    <span class="trophy-text">
      <span class="trophy-title"></span>
      <span class="trophy-desc muted small"></span>
    </span>`;
  el.querySelector('.trophy-title')!.textContent = hidden ? '???' : t.title;
  el.querySelector('.trophy-desc')!.textContent = hidden ? 'A secret. Keep poking around.' : t.desc;
  const text = el.querySelector('.trophy-text')!;
  if (got) {
    const when = document.createElement('span');
    when.className = 'trophy-when muted small';
    when.textContent = `Unlocked ${new Date(rec.at!).toLocaleDateString()}`;
    text.append(when);
  } else if (t.goal && !hidden) {
    const n = Math.min(rec?.n ?? 0, t.goal);
    const bar = document.createElement('span');
    bar.className = 'trophy-bar';
    bar.innerHTML = `<span style="width:${(100 * n) / t.goal}%"></span>`;
    const label = document.createElement('span');
    label.className = 'trophy-n muted small';
    label.textContent = `${n} / ${t.goal}`;
    text.append(bar, label);
  }
  return el;
}
