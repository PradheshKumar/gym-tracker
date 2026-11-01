// Device-local sync bookkeeping: delete tombstones, sync cursor, and a change signal.
// Kept outside IndexedDB so Dexie hooks can write it synchronously from any transaction.

const mem = new Map<string, string>();
const store = {
  get(k: string): string | null {
    try {
      return globalThis.localStorage ? localStorage.getItem(k) : mem.get(k) ?? null;
    } catch {
      return mem.get(k) ?? null;
    }
  },
  set(k: string, v: string) {
    try {
      if (globalThis.localStorage) localStorage.setItem(k, v);
      else mem.set(k, v);
    } catch {
      mem.set(k, v);
    }
  },
};

const TOMBS = 'sync.tombs';
const CURSOR = 'sync.cursor';

export type Tombs = Record<string, number>; // `${table}|${id}` -> deletedAt

export function getTombs(): Tombs {
  try {
    return JSON.parse(store.get(TOMBS) ?? '{}');
  } catch {
    return {};
  }
}

export function addTomb(table: string, id: string) {
  store.set(TOMBS, JSON.stringify({ ...getTombs(), [`${table}|${id}`]: Date.now() }));
}

/** Drop tombstones that the server has accepted (only if they were not re-deleted since). */
export function clearTombs(sent: Tombs) {
  const cur = getTombs();
  for (const [k, ts] of Object.entries(sent)) if (cur[k] === ts) delete cur[k];
  store.set(TOMBS, JSON.stringify(cur));
}

/** Forget tombstones for keys that the server itself deleted. */
export function dropTombs(keys: string[]) {
  const cur = getTombs();
  for (const k of keys) delete cur[k];
  store.set(TOMBS, JSON.stringify(cur));
}

export const getCursor = () => Number(store.get(CURSOR) ?? 0);
export const setCursor = (rev: number) => store.set(CURSOR, String(rev));
export const resetSyncState = () => {
  store.set(CURSOR, '0');
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function onLocalChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notifyChange() {
  for (const fn of listeners) fn();
}
