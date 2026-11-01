// Shared write operations used by several screens.
import { db } from './db';
import { isoWeekday, weekStart } from './lib/dates';
import { e1rm } from './lib/formulas';
import type { DateKey, DayPlan, SessionItem, SetLog } from './lib/types';

export async function sessionForDate(date: DateKey) {
  return (await db.sessions.where('date').equals(date).toArray()).sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Start (or reopen) the session for `date`, following `day`'s plan plus accepted carry-over items. */
export async function startSession(date: DateKey, day: DayPlan, opts: { returnMode?: boolean } = {}): Promise<string> {
  const existing = await sessionForDate(date);
  if (existing?.id && existing.weekday === day.weekday) return existing.id;
  const deloadWeeks = ((await db.kv.get('deloadWeeks'))?.value as DateKey[]) ?? [];
  const deload = !opts.returnMode && deloadWeeks.includes(weekStart(date));
  const items: SessionItem[] = day.exercises.map((pe) => ({
    exerciseId: pe.exerciseId,
    sets: opts.returnMode ? Math.min(2, pe.sets) : deload ? Math.ceil(pe.sets / 2) : pe.sets,
    repMin: pe.repMin,
    repMax: pe.repMax,
    tier: pe.tier,
    source: 'plan',
    notes: pe.notes,
  }));
  const carried = await acceptedCarryFor(date);
  return db.sessions.add({
    date,
    weekday: day.weekday,
    kind: isoWeekday(date) === day.weekday ? 'planned' : 'custom',
    startedAt: Date.now(),
    status: 'active',
    returnMode: opts.returnMode,
    deload,
    items: [...items, ...carried.filter((c) => !items.some((i) => i.exerciseId === c.exerciseId))],
  });
}

async function acceptedCarryFor(date: DateKey): Promise<SessionItem[]> {
  const rows = await db.carryovers.where('targetDate').equals(date).toArray();
  const plan = await db.plan.toArray();
  return rows
    .filter((r) => r.status === 'accepted')
    .map((r) => {
      const pe = plan.flatMap((d) => d.exercises).find((e) => e.exerciseId === r.exerciseId);
      return {
        exerciseId: r.exerciseId,
        sets: r.sets,
        repMin: pe?.repMin ?? 8,
        repMax: pe?.repMax ?? 12,
        tier: 'C' as const,
        source: 'carryover' as const,
        sourceDate: r.sourceDate,
      };
    });
}

/** Add an accepted carry-over item to today's open session, if there is one. */
export async function addCarryToOpenSession(date: DateKey, item: SessionItem) {
  const s = await sessionForDate(date);
  if (!s?.id || s.items.some((i) => i.exerciseId === item.exerciseId)) return;
  await db.sessions.update(s.id, { items: [...s.items, item] });
}

export interface PRResult {
  kinds: string[];
}

/** Compare a just-completed set with all earlier working sets for the exercise. */
export function detectPR(set: Pick<SetLog, 'weight' | 'reps' | 'isWarmup'>, history: SetLog[]): PRResult {
  if (set.isWarmup || !history.length) return { kinds: [] };
  const work = history.filter((h) => !h.isWarmup);
  if (!work.length) return { kinds: [] };
  const kinds: string[] = [];
  const maxW = Math.max(...work.map((h) => h.weight));
  const maxE = Math.max(...work.map((h) => e1rm(h.weight, h.reps)));
  const maxV = Math.max(...work.map((h) => h.weight * h.reps));
  const repsAtW = Math.max(0, ...work.filter((h) => h.weight >= set.weight).map((h) => h.reps));
  if (set.weight > maxW) kinds.push(`weight ${set.weight} kg`);
  if (e1rm(set.weight, set.reps) > maxE + 0.01) kinds.push(`e1RM ${e1rm(set.weight, set.reps).toFixed(1)} kg`);
  if (set.weight <= maxW && set.reps > repsAtW) kinds.push(`${set.reps} reps at ${set.weight} kg`);
  if (set.weight * set.reps > maxV && !kinds.length) kinds.push(`set volume ${Math.round(set.weight * set.reps)} kg`);
  return { kinds };
}
