// Calculation specs from the handoff, section 9. Every output here is an estimate.
import { addDays, diffDays } from './dates';
import type { DateKey } from './types';

/** US Navy body fat %, metric, male. */
export function navyBodyFatMale(waistCm: number, neckCm: number, heightCm: number): number | null {
  if (waistCm <= neckCm || heightCm <= 0) return null;
  return 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
}

/** US Navy body fat %, metric, female (needs hips). */
export function navyBodyFatFemale(waistCm: number, neckCm: number, hipCm: number, heightCm: number): number | null {
  if (waistCm + hipCm <= neckCm) return null;
  return 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
}

/** ACSM walking equation. Valid for walking up to about 6 km/h. */
export function treadmillVO2(speedKmh: number, inclinePct: number): number {
  const speed = (speedKmh * 1000) / 60; // m/min
  const grade = inclinePct / 100;
  return 0.1 * speed + 1.8 * speed * grade + 3.5;
}

export function treadmillNetKcalPerMin(speedKmh: number, inclinePct: number, weightKg: number): number {
  return ((treadmillVO2(speedKmh, inclinePct) - 3.5) * weightKg * 5) / 1000;
}

export function treadmillGrossKcalPerMin(speedKmh: number, inclinePct: number, weightKg: number): number {
  return (treadmillVO2(speedKmh, inclinePct) * weightKg * 5) / 1000;
}

export function treadmillNetKcal(minutes: number, speedKmh: number, inclinePct: number, weightKg: number): number {
  return minutes * treadmillNetKcalPerMin(speedKmh, inclinePct, weightKg);
}

/** Epley estimated 1RM. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}
export const E1RM_RELIABLE_MAX_REPS = 12;

export const NET_KCAL_PER_1000_STEPS = 27.5; // midpoint of 25-30 at ~67 kg
export function stepsNetKcal(steps: number, weightKg = 67): number {
  return (steps / 1000) * NET_KCAL_PER_1000_STEPS * (weightKg / 67);
}

/** Mifflin-St Jeor BMR. */
export function mifflinBmr(weightKg: number, heightCm: number, age: number, sex: 'male' | 'female'): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

export interface TrendPoint {
  date: DateKey;
  weight?: number; // scale weight if logged
  trend: number;
}

/**
 * Exponentially smoothed trend weight. Missing days carry the previous trend forward,
 * so a gap never drags the trend toward zero.
 */
export function trendWeights(entries: { date: DateKey; kg: number }[], alpha = 0.1, until?: DateKey): TrendPoint[] {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((e) => [e.date, e.kg]));
  const end = until && until > sorted[sorted.length - 1].date ? until : sorted[sorted.length - 1].date;
  const out: TrendPoint[] = [];
  let trend = sorted[0].kg;
  for (let d = sorted[0].date; d <= end; d = addDays(d, 1)) {
    const w = byDate.get(d);
    if (w !== undefined) trend = trend + alpha * (w - trend);
    out.push({ date: d, weight: w, trend });
  }
  return out;
}

/** Mean of trend over the 7 days ending at `date` (inclusive). */
export function sevenDayAvgTrend(points: TrendPoint[], date: DateKey): number | null {
  const window = points.filter((p) => p.date <= date && diffDays(p.date, date) < 7);
  if (!window.length) return null;
  return window.reduce((s, p) => s + p.trend, 0) / window.length;
}

/** Weekly rate = change in 7-day average trend versus one week earlier, kg/week. */
export function weeklyRate(points: TrendPoint[], date: DateKey): number | null {
  const now = sevenDayAvgTrend(points, date);
  const prevDate = addDays(date, -7);
  if (!points.length || points[0].date > prevDate) return null;
  const prev = sevenDayAvgTrend(points, prevDate);
  if (now === null || prev === null) return null;
  return now - prev;
}

/** Rate over `days` days using trend, expressed as kg/week. */
export function rateOver(points: TrendPoint[], date: DateKey, days: number): number | null {
  const now = points.find((p) => p.date === date);
  const then = points.find((p) => p.date === addDays(date, -days));
  if (!now || !then) return null;
  return ((now.trend - then.trend) / days) * 7;
}

export interface TdeeEstimate {
  tdee: number;
  days: number;
  loggedPct: number;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Simple adaptive expenditure: TDEE = avg intake - trend change/day * 7700.
 * Needs at least 14 days with at least 80% of days logged.
 */
export function adaptiveTdee(
  intakeByDate: Map<DateKey, number>,
  trend: TrendPoint[],
  end: DateKey,
  days = 14,
): TdeeEstimate | null {
  const start = addDays(end, -(days - 1));
  const startT = trend.find((p) => p.date === start);
  const endT = trend.find((p) => p.date === end);
  if (!startT || !endT) return null;
  let total = 0;
  let logged = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const v = intakeByDate.get(d);
    if (v !== undefined && v > 0) {
      total += v;
      logged++;
    }
  }
  const loggedPct = logged / days;
  if (loggedPct < 0.8) return null;
  const avgIntake = total / logged;
  const changePerDay = (endT.trend - startT.trend) / (days - 1);
  const tdee = avgIntake - changePerDay * 7700;
  const confidence = days >= 28 && loggedPct >= 0.9 ? 'high' : loggedPct >= 0.9 ? 'medium' : 'low';
  return { tdee, days, loggedPct, confidence };
}

export interface SetLike {
  weight: number;
  reps: number;
  rir?: number;
  isWarmup: boolean;
}

export interface Progression {
  kind: 'increase' | 'reps';
  weight: number;
  reps: number;
  reason: string;
}

/**
 * Double progression: if every working set hit the top of the range (at RIR >= 1 when logged),
 * add the increment and drop back to the bottom; otherwise chase one more rep.
 */
export function suggestProgression(
  lastSets: SetLike[],
  repMin: number,
  repMax: number,
  increment: number,
): Progression | null {
  const work = lastSets.filter((s) => !s.isWarmup);
  if (!work.length) return null;
  const top = Math.max(...work.map((s) => s.weight));
  const atTop = work.filter((s) => s.weight === top);
  const allHitTop = atTop.length >= 1 && work.every((s) => s.reps >= repMax && (s.rir === undefined || s.rir >= 1));
  if (allHitTop) {
    return {
      kind: 'increase',
      weight: top + increment,
      reps: repMin,
      reason: `All ${work.length} working sets hit ${repMax} reps last time. Add ${increment} kg and restart at ${repMin}.`,
    };
  }
  const minReps = Math.min(...atTop.map((s) => s.reps));
  const target = Math.min(repMax, Math.max(repMin, minReps + 1));
  return {
    kind: 'reps',
    weight: top,
    reps: target,
    reason: `Keep ${top} kg and aim for ${target} reps on every set (top of range is ${repMax}).`,
  };
}

/** Suggested warm-up ramp: 50% and 75% of working weight, rounded to the increment. */
export function warmupSets(workWeight: number, increment = 2.5): { weight: number; reps: number }[] {
  const r = (w: number) => Math.round(w / increment) * increment;
  return [
    { weight: r(workWeight * 0.5), reps: 10 },
    { weight: r(workWeight * 0.75), reps: 5 },
  ];
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
