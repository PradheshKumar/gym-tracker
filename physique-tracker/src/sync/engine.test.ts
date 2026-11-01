import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, migrateLegacy, seedIfEmpty } from '../db';
import { pendingCount, syncOnce, type Remote, type RemoteRow } from './engine';
import { getTombs, resetSyncState } from './outbox';

/** In-memory stand-in for the Postgres table, with the same rules as supabase/schema.sql. */
class FakeServer {
  rows = new Map<string, RemoteRow>();
  rev = 0;
  remote(): Remote {
    return {
      push: async (rows) => {
        for (const r of rows) {
          const k = `${r.tbl}|${r.id}`;
          const old = this.rows.get(k);
          if (old && r.updated_at <= old.updated_at) continue; // stale write refused
          this.rows.set(k, { ...structuredClone(r), rev: ++this.rev });
        }
      },
      pull: async (after, limit) =>
        [...this.rows.values()]
          .filter((r) => r.rev > after)
          .sort((a, b) => a.rev - b.rev)
          .slice(0, limit)
          .map((r) => structuredClone(r)),
    };
  }
}

let n = 0;
async function device() {
  const d = new AppDB(`test-${++n}`);
  await seedIfEmpty(d);
  return d;
}

/** Each simulated device keeps its own cursor and tombstones. */
async function asDevice<T>(state: { cursor: string; tombs: string }, fn: () => Promise<T>): Promise<T> {
  localStorage.setItem('sync.cursor', state.cursor);
  localStorage.setItem('sync.tombs', state.tombs);
  const out = await fn();
  state.cursor = localStorage.getItem('sync.cursor') ?? '0';
  state.tombs = localStorage.getItem('sync.tombs') ?? '{}';
  return out;
}

const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

beforeEach(() => {
  mem.clear();
  resetSyncState();
});

describe('change tracking hooks', () => {
  it('gives new rows a uuid and an unsent stamp', async () => {
    const d = await device();
    const id = await d.foodlog.add({ date: '2026-11-02', name: 'x', kcal: 100, p: 1, c: 1, f: 1 });
    expect(typeof id).toBe('string');
    const row: any = await d.foodlog.get(id);
    expect(row.id).toBe(id);
    expect(row.updatedAt).toBeGreaterThan(0);
    expect(row._synced).toBeUndefined();
  });

  it('seed rows are not pending', async () => {
    const d = await device();
    expect(await pendingCount(d)).toBe(0);
  });

  it('editing a seed row makes it pending', async () => {
    const d = await device();
    await d.foods.update('food-banana', { kcal: 110 });
    expect(await pendingCount(d)).toBe(1);
  });

  it('deletes leave a tombstone', async () => {
    const d = await device();
    await d.foods.delete('food-banana');
    expect(Object.keys(getTombs())).toEqual(['foods|food-banana']);
  });

  it('never tracks photos/videos or device-only keys', async () => {
    const d = await device();
    await d.media.add({ date: '2026-11-02', type: 'photo', pose: 'front' });
    await d.kv.put({ key: 'seeded', value: true });
    expect(await pendingCount(d)).toBe(0);
  });
});

describe('sync', () => {
  it('moves a new record from device A to device B', async () => {
    const server = new FakeServer();
    const [a, b] = [await device(), await device()];
    const sa = { cursor: '0', tombs: '{}' };
    const sb = { cursor: '0', tombs: '{}' };
    const id = await a.sets.add({ sessionId: 's1', date: '2026-11-02', exerciseId: 'flat-smith', setNo: 1, weight: 60, reps: 8, isWarmup: false, completedAt: 1 });
    await asDevice(sa, () => syncOnce(a, server.remote()));
    expect(await pendingCount(a)).toBe(0);
    await asDevice(sb, () => syncOnce(b, server.remote()));
    expect((await b.sets.get(id))?.weight).toBe(60);
    expect(await asDevice(sb, () => pendingCount(b))).toBe(0);
  });

  it('last write wins on conflicting edits', async () => {
    const server = new FakeServer();
    const [a, b] = [await device(), await device()];
    const sa = { cursor: '0', tombs: '{}' };
    const sb = { cursor: '0', tombs: '{}' };
    await a.weighins.put({ date: '2026-11-02', kg: 68.4, fasted: true });
    await asDevice(sa, () => syncOnce(a, server.remote()));
    await asDevice(sb, () => syncOnce(b, server.remote()));
    await b.weighins.update('2026-11-02', { kg: 68.0 }); // older edit
    await new Promise((r) => setTimeout(r, 5));
    await a.weighins.update('2026-11-02', { kg: 67.9 }); // newer edit
    await asDevice(sa, () => syncOnce(a, server.remote()));
    await asDevice(sb, () => syncOnce(b, server.remote()));
    await asDevice(sa, () => syncOnce(a, server.remote()));
    expect((await a.weighins.get('2026-11-02'))?.kg).toBe(67.9);
    expect((await b.weighins.get('2026-11-02'))?.kg).toBe(67.9);
  });

  it('propagates deletes without echoing them back', async () => {
    const server = new FakeServer();
    const [a, b] = [await device(), await device()];
    const sa = { cursor: '0', tombs: '{}' };
    const sb = { cursor: '0', tombs: '{}' };
    const id = await a.foodlog.add({ date: '2026-11-02', name: 'Dosa', kcal: 170, p: 4, c: 28, f: 4.5 });
    await asDevice(sa, () => syncOnce(a, server.remote()));
    await asDevice(sb, () => syncOnce(b, server.remote()));
    expect(await b.foodlog.get(id)).toBeTruthy();
    await asDevice(sa, async () => {
      await a.foodlog.delete(id);
      await syncOnce(a, server.remote());
    });
    expect(sa.tombs).toBe('{}');
    await asDevice(sb, () => syncOnce(b, server.remote()));
    expect(await b.foodlog.get(id)).toBeUndefined();
    expect(sb.tombs).toBe('{}');
  });

  it('seed rows merge across devices instead of duplicating', async () => {
    const server = new FakeServer();
    const [a, b] = [await device(), await device()];
    const sa = { cursor: '0', tombs: '{}' };
    const sb = { cursor: '0', tombs: '{}' };
    await a.foods.update('food-banana', { kcal: 110 });
    await asDevice(sa, () => syncOnce(a, server.remote()));
    await asDevice(sb, () => syncOnce(b, server.remote()));
    expect(await b.foods.count()).toBe(await a.foods.count());
    expect((await b.foods.get('food-banana'))?.kcal).toBe(110);
  });

  it('keeps a local edit made after the server copy', async () => {
    const server = new FakeServer();
    const a = await device();
    const sa = { cursor: '0', tombs: '{}' };
    await a.checkins.put({ date: '2026-11-02', sleepH: 6, energy: 3, soreness: 3, mood: 3, hunger: 3 });
    await asDevice(sa, () => syncOnce(a, server.remote()));
    await new Promise((r) => setTimeout(r, 5));
    await a.checkins.update('2026-11-02', { sleepH: 8 });
    // Pull an older copy of the same row (cursor reset) before pushing again.
    sa.cursor = '0';
    await asDevice(sa, () => syncOnce(a, server.remote()));
    expect((await a.checkins.get('2026-11-02'))?.sleepH).toBe(8);
  });
});

describe('legacy migration', () => {
  it('moves v1 numeric-id data to string ids and fixes references', async () => {
    const legacy = new Dexie('legacy-v1');
    legacy.version(1).stores({ sessions: '++id, date', sets: '++id, sessionId', foods: '++id', meals: '++id', weighins: 'date', kv: 'key' });
    await legacy.open();
    const sid = await legacy.table('sessions').add({ date: '2026-11-02', weekday: 1, kind: 'planned', startedAt: 1, status: 'done', items: [] });
    await legacy.table('sets').add({ sessionId: sid, date: '2026-11-02', exerciseId: 'flat-smith', setNo: 1, weight: 60, reps: 9, isWarmup: false, completedAt: 1 });
    const fid = await legacy.table('foods').add({ name: 'Oats', serving: '40 g', kcal: 150, p: 5, c: 27, f: 3 });
    await legacy.table('meals').add({ name: 'Brekkie', items: [{ foodId: fid, qty: 2 }] });
    await legacy.table('weighins').put({ date: '2026-11-02', kg: 68.3, fasted: true });
    await legacy.table('kv').put({ key: 'seeded', value: true });
    legacy.close();

    const d = new AppDB(`migrate-${++n}`);
    expect(await migrateLegacy(d, 'legacy-v1')).toBe(true);
    const [session] = await d.sessions.toArray();
    const [set] = await d.sets.toArray();
    expect(typeof session.id).toBe('string');
    expect(set.sessionId).toBe(session.id);
    const meal = (await d.meals.toArray())[0];
    expect(meal.items[0].foodId).toBe('food-oats');
    expect((await d.weighins.get('2026-11-02'))?.kg).toBe(68.3);
    expect(await pendingCount(d)).toBeGreaterThan(0); // migrated data is uploaded on first sync
    expect(await migrateLegacy(d, 'legacy-v1')).toBe(false); // only once
  });

  it('seeding never overwrites existing rows', async () => {
    const d = new AppDB(`seed-${++n}`);
    await d.foods.put({ id: 'food-banana', name: 'Banana', serving: '1', kcal: 99, p: 1, c: 1, f: 0 });
    await seedIfEmpty(d);
    expect((await d.foods.get('food-banana'))?.kcal).toBe(99);
    expect(await d.exercises.count()).toBeGreaterThan(30);
  });
});

describe('first-run setup', () => {
  it('stores the baseline and creates goals from it', async () => {
    const { completeSetup, needsSetup, upgradeStoredData } = await import('../db');
    const d = await device();
    expect(await needsSetup(d)).toBe(true);
    await completeSetup({ sex: 'male', heightCm: 175, birthYear: 1995, weightKg: 75, neckCm: 39, waistCm: 85 }, d);
    expect(await needsSetup(d)).toBe(false);
    expect((await d.bodyfat.toArray())[0].value).toBe(16.2);
    expect((await d.goals.get('goal-weight'))?.start).toBe(75);
    await upgradeStoredData(d);
    const s: any = (await d.kv.get('settings'))?.value;
    expect([s.foodBudgetMinInr, s.foodBudgetInr, s.heightCm]).toEqual([200, 300, 175]);
  });
});
