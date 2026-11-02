import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, EXERCISES, FOODS, GOALS, PHASES, PLAN, PLANNED_DELOAD_WEEKS, PLANNED_DIET_BREAKS } from './data/seed';
import { todayKey } from './lib/dates';
import { navyBodyFatFemale, navyBodyFatMale } from './lib/formulas';
import { baselineMediaId, foodId, goalId, mealId, measId, navyBfId, uuid } from './lib/ids';
import type {
  BodyFat,
  CarryOver,
  CheckIn,
  DateKey,
  DayPlan,
  Exercise,
  Food,
  FoodLog,
  FoodPlanItem,
  Goal,
  Hydration,
  MealTemplate,
  Measurement,
  Media,
  Phase,
  RuleEvent,
  Session,
  SetLog,
  Settings,
  Skip,
  Steps,
  Treadmill,
  WeighIn,
} from './lib/types';
import { addTomb, notifyChange } from './sync/outbox';
import type { CustomReminder } from './lib/reminders';

interface KV {
  key: string;
  value: unknown;
}

export const TABLES = [
  'exercises',
  'plan',
  'sessions',
  'sets',
  'skips',
  'carryovers',
  'treadmill',
  'steps',
  'weighins',
  'measurements',
  'bodyfat',
  'media',
  'foodlog',
  'foods',
  'meals',
  'hydration',
  'checkins',
  'phases',
  'goals',
  'rules',
  'kv',
  'foodplan',
  'customReminders',
] as const;
export type TableName = (typeof TABLES)[number];

/** Primary key field per table. Every key is unique per user, so it doubles as the cloud record id. */
export const PK: Record<TableName, string> = {
  exercises: 'id',
  plan: 'weekday',
  sessions: 'id',
  sets: 'id',
  skips: 'id',
  carryovers: 'id',
  treadmill: 'id',
  steps: 'date',
  weighins: 'date',
  measurements: 'id',
  bodyfat: 'id',
  media: 'id',
  foodlog: 'id',
  foods: 'id',
  meals: 'id',
  hydration: 'date',
  checkins: 'date',
  phases: 'id',
  goals: 'id',
  rules: 'id',
  kv: 'key',
  foodplan: 'id',
  customReminders: 'id',
};

/** Photos and videos never leave the device. */
export const SYNC_TABLES = TABLES.filter((t) => t !== 'media');
/** kv keys that describe this device only. */
export const LOCAL_KV = new Set(['seeded', 'migrated']);

export const isLocalOnly = (table: string, obj: any) => table === 'media' || (table === 'kv' && LOCAL_KV.has(obj?.key));
export const recordId = (table: TableName, row: any) => String(row[PK[table]]);

export class AppDB extends Dexie {
  exercises!: Table<Exercise, string>;
  plan!: Table<DayPlan, number>;
  sessions!: Table<Session, string>;
  sets!: Table<SetLog, string>;
  skips!: Table<Skip, string>;
  carryovers!: Table<CarryOver, string>;
  treadmill!: Table<Treadmill, string>;
  steps!: Table<Steps, string>;
  weighins!: Table<WeighIn, string>;
  measurements!: Table<Measurement, string>;
  bodyfat!: Table<BodyFat, string>;
  media!: Table<Media, string>;
  foodlog!: Table<FoodLog, string>;
  foods!: Table<Food, string>;
  meals!: Table<MealTemplate, string>;
  hydration!: Table<Hydration, string>;
  checkins!: Table<CheckIn, string>;
  phases!: Table<Phase, string>;
  goals!: Table<Goal, string>;
  rules!: Table<RuleEvent, string>;
  kv!: Table<KV, string>;
  foodplan!: Table<FoodPlanItem, string>;
  customReminders!: Table<CustomReminder, string>;

  constructor(name = 'gym-tracker') {
    super(name);
    this.version(1).stores({
      exercises: 'id',
      plan: 'weekday',
      sessions: 'id, date, status',
      sets: 'id, sessionId, date, exerciseId',
      skips: 'id, date',
      carryovers: 'id, sourceDate, targetDate, rescheduledTo',
      treadmill: 'id, date',
      steps: 'date',
      weighins: 'date',
      measurements: 'id, date, site',
      bodyfat: 'id, date',
      media: 'id, date, pose',
      foodlog: 'id, date',
      foods: 'id, name',
      meals: 'id',
      hydration: 'date',
      checkins: 'date',
      phases: 'id, order',
      goals: 'id',
      rules: 'id, date, rule',
      kv: 'key',
    });
    this.version(2).stores({ foodplan: 'id, date' });
    this.version(3).stores({ customReminders: 'id' });
    for (const name of TABLES) installHooks(this, name);
  }
}

/**
 * Change tracking for sync. Local writes stamp `updatedAt` (and so become unsent);
 * writes coming from the server carry `_remote: true` and keep the server's stamp.
 * Deletes leave a tombstone in the outbox.
 */
function installHooks(db: Dexie, name: TableName) {
  const t = db.table(name);
  t.hook('creating', function (_pk, obj: any) {
    if (PK[name] === 'id' && (obj.id === undefined || obj.id === null)) obj.id = uuid();
    if (obj._remote) {
      delete obj._remote;
      return;
    }
    if (isLocalOnly(name, obj)) return;
    obj.updatedAt = Date.now();
    delete obj._synced;
    notifyChange();
  });
  t.hook('updating', function (mods: any, _pk, obj: any) {
    if (mods._remote) return { _remote: undefined };
    if (isLocalOnly(name, obj)) return undefined;
    notifyChange();
    return { updatedAt: Date.now() };
  });
  t.hook('deleting', function (pk, obj: any) {
    if (isLocalOnly(name, obj)) return;
    addTomb(name, String(pk));
    notifyChange();
  });
}

export const db = new AppDB();

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await db.kv.put({ key: 'settings', value: { ...cur, ...patch } });
}

/** Seed rows are stamped 0 so any real edit, on any device, wins over them. */
const seedRow = <T,>(row: T): T => ({ ...row, _remote: true, updatedAt: 0, _synced: 0 }) as T;

/** Insert seed rows, never overwriting a row that already exists (e.g. migrated or synced data). */
async function seedTable(t: Table<any, any>, rows: any[]) {
  const pk = t.schema.primKey.keyPath as string;
  const existing = await t.bulkGet(rows.map((r) => r[pk]));
  const fresh = rows.filter((_, i) => !existing[i]);
  if (fresh.length) await t.bulkAdd(fresh);
}

export async function seedIfEmpty(target: AppDB = db) {
  if (await target.kv.get('seeded')) return;
  const meal = (name: string, items: [string, number][]) =>
    seedRow({ id: mealId(name), name, items: items.map(([f, qty]) => ({ foodId: foodId(f), qty })) });
  await target.transaction('rw', target.tables, async () => {
    await seedTable(target.exercises, EXERCISES.map(seedRow));
    await seedTable(target.plan, PLAN.map(seedRow));
    await seedTable(target.phases, PHASES.map(seedRow));
    await seedTable(target.foods, FOODS.map((f) => seedRow({ ...f, id: foodId(f.name) })));
    await seedTable(target.goals, GOALS.map((g) => seedRow({ ...g, id: goalId(g.metric, g.exerciseId) })));
    await seedTable(target.meals, [
      meal('Oats breakfast', [['Oats', 1], ['Toned milk', 1], ['Banana', 1]]),
      meal('Post-workout shake', [['Whey protein', 1], ['Banana', 1]]),
      meal('Dal-chawal plate', [['Rice, cooked', 1], ['Dal, cooked', 1], ['Curd (dahi)', 1]]),
      meal('Soya + roti', [['Soya chunks (dry)', 1], ['Chapati', 3], ['Veg sabzi', 1]]),
    ]);
    await seedTable(target.kv, [
      seedRow({ key: 'settings', value: DEFAULT_SETTINGS }),
      seedRow({ key: 'dietBreaks', value: PLANNED_DIET_BREAKS }),
      seedRow({ key: 'deloadWeeks', value: PLANNED_DELOAD_WEEKS }),
    ]);
    await target.kv.put({ key: 'seeded', value: true });
  });
}

export async function getSince(): Promise<DateKey> {
  return ((await db.kv.get('since'))?.value as DateKey) ?? todayKey();
}

/** First run needs your baseline unless this device already has (or has synced) weigh-ins. */
export async function needsSetup(target: AppDB = db): Promise<boolean> {
  if (await target.kv.get('onboarded')) return false;
  return (await target.weighins.count()) === 0;
}

export interface SetupInput {
  heightCm: number;
  birthYear: number;
  sex: 'male' | 'female';
  weightKg: number;
  neckCm: number;
  waistCm: number;
  hipCm?: number;
}

/** Store the first-run baseline: profile, weigh-in, measurements, Navy body fat and starting goals. */
export async function completeSetup(input: SetupInput, target: AppDB = db) {
  const date = todayKey();
  const bf =
    input.sex === 'male'
      ? navyBodyFatMale(input.waistCm, input.neckCm, input.heightCm)
      : input.hipCm
        ? navyBodyFatFemale(input.waistCm, input.neckCm, input.hipCm, input.heightCm)
        : null;
  const cut = PHASES.find((p) => p.id === 'p2')?.targets ?? {};
  const cur = { ...DEFAULT_SETTINGS, ...(((await target.kv.get('settings'))?.value as object) ?? {}) };
  await target.transaction('rw', target.tables, async () => {
    await target.kv.put({ key: 'settings', value: { ...cur, heightCm: input.heightCm, birthYear: input.birthYear, sex: input.sex } });
    await target.kv.put({ key: 'since', value: date });
    await target.weighins.put({ date, kg: input.weightKg, fasted: true });
    const sites: [string, number | undefined][] = [['neck', input.neckCm], ['waist (navel)', input.waistCm], ['hips', input.hipCm]];
    for (const [site, cm] of sites) if (cm) await target.measurements.put({ id: measId(date, site), date, site, cm });
    if (bf !== null) await target.bodyfat.put({ id: navyBfId(date), date, method: 'navy', value: Math.round(bf * 10) / 10 });
    await target.goals.bulkPut([
      { id: goalId('weight'), metric: 'weight', start: input.weightKg, target: cut.weightKg ?? Math.round((input.weightKg - 3) * 10) / 10, label: 'Trend weight (Phase 2)' },
      { id: goalId('waist'), metric: 'waist', start: input.waistCm, target: cut.waistCm ?? input.waistCm - 4, label: 'Waist at navel' },
      ...(bf !== null ? [{ id: goalId('bodyFat'), metric: 'bodyFat' as const, start: Math.round(bf * 10) / 10, target: cut.bodyFatPct ?? Math.round(bf - 3), label: 'Body fat (Navy)' }] : []),
    ]);
    await target.kv.put({ key: 'onboarded', value: date });
  });
}

/** One-off fixes to stored data when defaults change between releases (idempotent). */
export async function upgradeStoredData(target: AppDB = db) {
  // Planned Phase 2 diet break and deload (14-20 Dec 2026), for installs from before they existed.
  if (!(await target.kv.get('dietBreaks'))) await seedTable(target.kv, [seedRow({ key: 'dietBreaks', value: PLANNED_DIET_BREAKS })]);
  if (!(await target.kv.get('deloadWeeks'))) await seedTable(target.kv, [seedRow({ key: 'deloadWeeks', value: PLANNED_DELOAD_WEEKS })]);
  const row = await target.kv.get('settings');
  const v = row?.value as Partial<Settings> | undefined;
  if (v && v.foodBudgetMinInr === undefined) {
    await target.kv.put({ key: 'settings', value: { ...v, foodBudgetMinInr: 200, foodBudgetInr: Math.max(v.foodBudgetInr ?? 0, 300) } });
  }
}

// ---------- Legacy (v1, numeric ids) data ----------

/**
 * Convert data from the first version of the app (auto-increment numeric ids) to string ids,
 * fixing the two references between tables (sets -> sessions, meals -> foods).
 * Seed-like rows get the same deterministic ids that fresh installs use.
 */
export function upgradeLegacyData(data: Record<string, any[]>): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  const used = new Set<string>();
  const unique = (id: string) => {
    let k = id;
    for (let i = 2; used.has(k); i++) k = `${id}-${i}`;
    used.add(k);
    return k;
  };
  const remap = (rows: any[] = [], idFor: (r: any) => string = () => uuid()) => {
    const map = new Map<unknown, string>();
    const next = rows.map((r) => {
      const id = unique(idFor(r));
      map.set(r.id, id);
      return { ...r, id };
    });
    return { rows: next, map };
  };
  const sessions = remap(data.sessions);
  const foods = remap(data.foods, (f) => foodId(f.name));
  out.sessions = sessions.rows;
  out.foods = foods.rows;
  out.sets = remap(data.sets).rows.map((s) => ({ ...s, sessionId: sessions.map.get(s.sessionId) ?? String(s.sessionId) }));
  out.meals = remap(data.meals, (m) => mealId(m.name)).rows.map((m) => ({
    ...m,
    items: (m.items ?? []).map((it: any) => ({ ...it, foodId: foods.map.get(it.foodId) ?? String(it.foodId) })),
  }));
  out.measurements = remap(data.measurements, (m) => measId(m.date, m.site)).rows;
  out.bodyfat = remap(data.bodyfat, (b) => (b.method === 'navy' ? navyBfId(b.date) : uuid())).rows;
  out.goals = remap(data.goals, (g) => goalId(g.metric, g.exerciseId)).rows;
  out.media = remap(data.media, (m) => (m.baseline ? baselineMediaId(m.date) : uuid())).rows;
  for (const t of ['skips', 'carryovers', 'treadmill', 'foodlog', 'rules']) out[t] = remap(data[t]).rows;
  for (const t of ['exercises', 'plan', 'steps', 'weighins', 'hydration', 'checkins', 'phases', 'kv']) out[t] = data[t] ?? [];
  return out;
}

/** Move data from the v1 on-device database ('physique-tracker') into this one, once. */
export async function migrateLegacy(target: AppDB = db, legacyName = 'physique-tracker'): Promise<boolean> {
  if (await target.kv.get('migrated')) return false;
  if (!(await Dexie.exists(legacyName))) {
    await target.kv.put({ key: 'migrated', value: 'none' });
    return false;
  }
  const old = new Dexie(legacyName);
  await old.open();
  const raw: Record<string, any[]> = {};
  for (const t of old.tables) raw[t.name] = await t.toArray();
  old.close();
  const data = upgradeLegacyData(raw);
  await target.transaction('rw', target.tables, async () => {
    for (const t of TABLES) {
      const rows = (data[t] ?? []).map(({ updatedAt: _u, _synced: _s, ...r }: any) => r);
      if (rows.length) await target.table(t).bulkPut(rows);
    }
    await target.kv.put({ key: 'migrated', value: new Date().toISOString() });
  });
  return true;
}

// ---------- Backup ----------

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

async function dataUrlToBlob(u: string): Promise<Blob> {
  return (await fetch(u)).blob();
}

const stripSync = ({ _synced: _s, ...r }: any) => r;

/** Full backup as JSON. Media blobs are included as data URLs only when asked (files can be large). */
export async function exportAll(includeMedia: boolean): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = (await db.table(t).toArray()).filter((r: any) => !(t === 'kv' && LOCAL_KV.has(r.key))).map(stripSync);
    if (t === 'media') {
      out[t] = await Promise.all(
        rows.map(async (m: Media) => {
          const { blob, ...rest } = m;
          return includeMedia && blob ? { ...rest, blobData: await blobToDataUrl(blob) } : rest;
        }),
      );
    } else out[t] = rows;
  }
  return JSON.stringify({ app: 'physique-tracker', version: 2, exportedAt: new Date().toISOString(), data: out });
}

/** Restore a backup. Restored rows count as fresh local changes, so they sync up afterwards. */
export async function importAll(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'physique-tracker' || !parsed.data) throw new Error('Not a Physique Tracker backup file');
  const data = parsed.version === 1 ? upgradeLegacyData(parsed.data) : (parsed.data as Record<string, any[]>);
  const media = await Promise.all(
    (data.media ?? []).map(async ({ blobData, ...m }: any) => (blobData ? { ...m, blob: await dataUrlToBlob(blobData) } : m)),
  );
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      const rows = (t === 'media' ? media : data[t] ?? []).map(({ updatedAt: _u, _synced: _s, ...r }: any) => r);
      if (rows.length) await db.table(t).bulkPut(rows);
    }
    await db.kv.put({ key: 'seeded', value: true });
  });
}

export async function exportCsv(table: TableName): Promise<string> {
  const rows = (await db.table(table).toArray()).map((r: any) => {
    const { blob: _b, _synced: _s, ...rest } = r;
    return rest;
  });
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function download(name: string, content: string | Blob, type = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
