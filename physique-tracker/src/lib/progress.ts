// Progress summaries: PR history, badges, muscle balance and period reports. Pure functions.
import { MUSCLE_GROUP } from '../data/seed';
import { addDays, weekDays } from './dates';
import { e1rm, type TrendPoint } from './formulas';
import type { DateKey, Exercise, MuscleGroup, SetLog } from './types';

/** Sets that beat every earlier working set of the same exercise on e1RM (first session never counts). */
export function prHistory(sets: SetLog[]): SetLog[] {
  const best = new Map<string, number>();
  const firstDate = new Map<string, DateKey>();
  const out: SetLog[] = [];
  for (const s of [...sets].filter((x) => !x.isWarmup).sort((a, b) => a.date.localeCompare(b.date) || a.completedAt - b.completedAt)) {
    const e = e1rm(s.weight, s.reps);
    if (!firstDate.has(s.exerciseId)) firstDate.set(s.exerciseId, s.date);
    const prev = best.get(s.exerciseId);
    if (prev !== undefined && e > prev + 0.01 && s.date !== firstDate.get(s.exerciseId)) out.push(s);
    best.set(s.exerciseId, Math.max(prev ?? 0, e));
  }
  return out;
}

export interface Badge {
  id: string;
  label: string;
  hint: string;
  earned: boolean;
}

export interface BadgeInput {
  sets: SetLog[];
  weighinDates: DateKey[];
  photoCount: number;
  trend: TrendPoint[];
  waist: { date: DateKey; cm: number }[];
  /** Completed weeks (Mondays) where the treadmill target was met. */
  treadmillWeeks: DateKey[];
  /** Completed weeks with at least 80% of planned sessions. */
  consistentWeeks: DateKey[];
  proteinDaysInARow: number;
}

function longestRun(dates: DateKey[], step: number): number {
  const set = new Set(dates);
  let best = 0;
  for (const d of set) {
    if (set.has(addDays(d, -step))) continue;
    let n = 1;
    while (set.has(addDays(d, step * n))) n++;
    best = Math.max(best, n);
  }
  return best;
}

export function badges(x: BadgeInput): Badge[] {
  const sessions = new Set(x.sets.filter((s) => !s.isWarmup).map((s) => s.date)).size;
  const prs = prHistory(x.sets).length;
  const start = x.trend[0]?.trend;
  const now = x.trend[x.trend.length - 1]?.trend;
  const lost = start !== undefined && now !== undefined ? start - now : 0;
  const waistDrop = x.waist.length > 1 ? x.waist[0].cm - x.waist[x.waist.length - 1].cm : 0;
  const b = (id: string, label: string, hint: string, earned: boolean): Badge => ({ id, label, hint, earned });
  return [
    b('first-session', 'First session', 'Log a workout', sessions >= 1),
    b('sessions-10', '10 sessions', 'Train 10 times', sessions >= 10),
    b('sessions-50', '50 sessions', 'Train 50 times', sessions >= 50),
    b('sessions-100', '100 sessions', 'Train 100 times', sessions >= 100),
    b('first-pr', 'First PR', 'Beat an earlier e1RM', prs >= 1),
    b('prs-10', '10 PRs', 'Ten personal records', prs >= 10),
    b('prs-50', '50 PRs', 'Fifty personal records', prs >= 50),
    b('streak-4', '4-week streak', '4 weeks in a row with 80%+ of sessions', longestRun(x.consistentWeeks, 7) >= 4),
    b('streak-12', '12-week streak', '12 consistent weeks in a row', longestRun(x.consistentWeeks, 7) >= 12),
    b('weigh-7', 'Week of weigh-ins', '7 mornings in a row', longestRun(x.weighinDates, 1) >= 7),
    b('weigh-30', '30 weigh-ins', 'Log 30 weigh-ins', x.weighinDates.length >= 30),
    b('treadmill-4', 'Cardio regular', 'Hit the treadmill target 4 weeks', x.treadmillWeeks.length >= 4),
    b('protein-7', 'Protein week', 'Hit protein 7 days in a row', x.proteinDaysInARow >= 7),
    b('photo-1', 'First photo', 'Take a progress photo', x.photoCount >= 1),
    b('lost-1', '-1 kg trend', 'Trend weight down 1 kg', lost >= 1),
    b('lost-3', '-3 kg trend', 'Trend weight down 3 kg', lost >= 3),
    b('waist-2', '-2 cm waist', 'Waist down 2 cm', waistDrop >= 2),
    b('waist-4', '-4 cm waist', 'Waist down 4 cm', waistDrop >= 4),
  ];
}

export const PUSH: MuscleGroup[] = ['chest', 'triceps'];
export const PULL: MuscleGroup[] = ['back', 'biceps'];
export const UPPER: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms'];
export const LOWER: MuscleGroup[] = ['quads', 'hamstrings', 'calves'];

export interface MuscleHeat {
  group: MuscleGroup;
  sets7: number;
  lastTrained?: DateKey;
}

/** Working sets per group over the 7 days ending today, and the last day each group was trained. */
export function muscleHeat(sets: SetLog[], exMap: Map<string, Exercise>, today: DateKey, groups: MuscleGroup[]): MuscleHeat[] {
  const from = addDays(today, -6);
  return groups.map((group) => {
    const mine = sets.filter((s) => !s.isWarmup && exMap.get(s.exerciseId) && MUSCLE_GROUP[exMap.get(s.exerciseId)!.primary] === group);
    const lastTrained = mine.reduce<DateKey | undefined>((m, s) => (!m || s.date > m ? s.date : m), undefined);
    return { group, sets7: mine.filter((s) => s.date >= from && s.date <= today).length, lastTrained };
  });
}

export function ratio(heat: MuscleHeat[], a: MuscleGroup[], b: MuscleGroup[]): { a: number; b: number; r: number | null } {
  const sum = (gs: MuscleGroup[]) => heat.filter((h) => gs.includes(h.group)).reduce((s, h) => s + h.sets7, 0);
  const x = sum(a);
  const y = sum(b);
  return { a: x, b: y, r: y ? x / y : null };
}

/** Calendar weeks (Mon-Sun) overlapping a period. */
export function periodWeeks(from: DateKey, to: DateKey): DateKey[][] {
  const out: DateKey[][] = [];
  for (let d = weekDays(from)[0]; d <= to; d = addDays(d, 7)) out.push(weekDays(d));
  return out;
}
