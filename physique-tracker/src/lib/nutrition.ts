// Daily nutrition targets for a given date: phase targets, adjusted for high-carb days and diet breaks.
import { currentPhase } from './rules';
import type { DateKey, Phase } from './types';

export interface DateRange {
  start: DateKey;
  end: DateKey;
}

export interface DayTargets {
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber: number;
  waterL: number;
  phase?: Phase;
  label?: 'High-carb day' | 'Diet break';
}

export const HIGH_CARB_EXTRA_KCAL = 300;

export const inRange = (d: DateKey, ranges: DateRange[]) => ranges.some((r) => r.start <= d && d <= r.end);

export function targetsFor(
  date: DateKey,
  phases: Phase[],
  opts: { highCarbDays: DateKey[]; dietBreaks: DateRange[]; maintenanceKcal: number },
): DayTargets | null {
  const phase = currentPhase(phases, date);
  if (!phase) return null;
  const base: DayTargets = { kcal: phase.kcal, p: phase.protein, c: phase.carbs, f: phase.fat, fiber: phase.fiber, waterL: phase.waterL, phase };
  // Extra calories come from carbs so protein and fat stay put.
  if (inRange(date, opts.dietBreaks) && opts.maintenanceKcal > phase.kcal) {
    const extra = opts.maintenanceKcal - phase.kcal;
    return { ...base, kcal: opts.maintenanceKcal, c: Math.round(phase.carbs + extra / 4), label: 'Diet break' };
  }
  if (opts.highCarbDays.includes(date)) {
    return { ...base, kcal: phase.kcal + HIGH_CARB_EXTRA_KCAL, c: Math.round(phase.carbs + HIGH_CARB_EXTRA_KCAL / 4), label: 'High-carb day' };
  }
  return base;
}

export interface Totals {
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber: number;
  cost: number;
}

export function sumFood(rows: { kcal: number; p: number; c: number; f: number; fiber?: number; costInr?: number }[]): Totals {
  return rows.reduce<Totals>(
    (s, r) => ({ kcal: s.kcal + r.kcal, p: s.p + r.p, c: s.c + r.c, f: s.f + r.f, fiber: s.fiber + (r.fiber ?? 0), cost: s.cost + (r.costInr ?? 0) }),
    { kcal: 0, p: 0, c: 0, f: 0, fiber: 0, cost: 0 },
  );
}

/** Food-plan copy targets: every date from `from` to `to` whose weekday is in `weekdays` (1 = Mon). */
export function datesBetween(from: DateKey, to: DateKey, weekdays: number[]): DateKey[] {
  const out: DateKey[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end && out.length < 400) {
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    if (weekdays.includes(wd)) {
      const p = (n: number) => String(n).padStart(2, '0');
      out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
