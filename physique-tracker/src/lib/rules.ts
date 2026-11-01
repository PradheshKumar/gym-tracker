// Transparent coaching rules (handoff sections 4 and 8.9). Each suggestion carries its "why".
import { addDays, diffDays } from './dates';
import { e1rm, rateOver, type TrendPoint } from './formulas';
import type { DateKey, Phase, SetLog } from './types';

export interface Suggestion {
  rule: string;
  title: string;
  why: string;
  action?: { kind: 'kcal'; delta: number } | { kind: 'treadmill'; deltaMin: number } | { kind: 'deload' };
  severity: 'info' | 'warn';
}

export function currentPhase(phases: Phase[], date: DateKey): Phase | undefined {
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  return sorted.find((p) => p.start <= date && date <= p.end) ?? sorted.find((p) => p.start > date);
}

/**
 * Rate-of-loss check, run every 2 weeks during a cut.
 * Under 0.15 kg/week: cut ~150 kcal or add ~5 min per treadmill session. Over 0.5 kg/week: add ~150 kcal.
 */
export function rateOfLossRule(trend: TrendPoint[], today: DateKey, phase: Phase | undefined): Suggestion | null {
  if (!phase || phase.rateMax === undefined || phase.rateMax >= 0) return null;
  // Needs two full weeks of phase data.
  if (diffDays(phase.start, today) < 14) return null;
  const rate = rateOver(trend, today, 14);
  if (rate === null) return null;
  const loss = -rate;
  const fmt = loss.toFixed(2);
  if (loss < 0.15) {
    return {
      rule: 'rate-slow',
      title: 'Loss is slower than planned',
      why: `Trend weight changed ${fmt} kg/week over the last 2 weeks (target 0.2-0.35). Change one thing: cut about 150 kcal, or add about 5 min to each treadmill session.`,
      action: { kind: 'kcal', delta: -150 },
      severity: 'warn',
    };
  }
  if (loss > 0.5) {
    return {
      rule: 'rate-fast',
      title: 'Loss is faster than planned',
      why: `Trend weight dropped ${fmt} kg/week over the last 2 weeks (target 0.2-0.35). Add about 150 kcal to protect muscle and training.`,
      action: { kind: 'kcal', delta: 150 },
      severity: 'warn',
    };
  }
  return {
    rule: 'rate-ok',
    title: 'Rate of loss on track',
    why: `Trend weight changed ${fmt} kg/week over the last 2 weeks, inside the 0.15-0.5 band. No change.`,
    severity: 'info',
  };
}

/** Best e1RM per exercise per ISO week (keyed by Monday). */
export function weeklyBestE1rm(logs: SetLog[]): Map<string, Map<DateKey, number>> {
  const out = new Map<string, Map<DateKey, number>>();
  for (const s of logs) {
    if (s.isWarmup || s.reps <= 0) continue;
    const wk = mondayOf(s.date);
    const m = out.get(s.exerciseId) ?? new Map<DateKey, number>();
    m.set(wk, Math.max(m.get(wk) ?? 0, e1rm(s.weight, s.reps)));
    out.set(s.exerciseId, m);
  }
  return out;
}

function mondayOf(d: DateKey): DateKey {
  const wd = new Date(d + 'T00:00:00').getDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

/**
 * Strength warning: a lift down more than 5% versus its best in the 4 weeks before,
 * in each of the last 2 logged weeks.
 */
export function strengthRule(
  logs: SetLog[],
  today: DateKey,
  names: Map<string, string>,
  threshold = 0.05,
): Suggestion | null {
  const thisWeek = mondayOf(today);
  const w1 = addDays(thisWeek, -7);
  const w2 = addDays(thisWeek, -14);
  const down: string[] = [];
  for (const [id, weeks] of weeklyBestE1rm(logs)) {
    const a = weeks.get(w1);
    const b = weeks.get(w2);
    if (a === undefined || b === undefined) continue;
    let ref = 0;
    for (let i = 3; i <= 6; i++) ref = Math.max(ref, weeks.get(addDays(thisWeek, -7 * i)) ?? 0);
    if (!ref) continue;
    if (a < ref * (1 - threshold) && b < ref * (1 - threshold)) {
      down.push(`${names.get(id) ?? id} (${Math.round((1 - Math.max(a, b) / ref) * 100)}% down)`);
    }
  }
  if (!down.length) return null;
  return {
    rule: 'strength-drop',
    title: 'Strength is slipping',
    why: `Down more than ${threshold * 100}% for 2 weeks running: ${down.join(', ')}. Eat a bit more (about +150 kcal) and/or take a deload week (about 50% volume, 60-70% load).`,
    action: { kind: 'deload' },
    severity: 'warn',
  };
}

export function readinessFlags(checkIns: { sleepH: number; energy: number; mood: number }[]): Suggestion | null {
  const recent = checkIns.slice(-5);
  if (recent.length < 3) return null;
  const poorSleep = recent.filter((c) => c.sleepH < 6).length;
  const low = recent.filter((c) => c.energy <= 2 || c.mood <= 2).length;
  if (poorSleep >= 3 || low >= 3) {
    return {
      rule: 'fatigue',
      title: 'Fatigue flags',
      why: `In the last ${recent.length} check-ins: ${poorSleep} nights under 6 h, ${low} days with low energy or mood. Consider more food and/or a deload. See a clinician for anything concerning.`,
      action: { kind: 'deload' },
      severity: 'warn',
    };
  }
  return null;
}

// ---------- v1.5 rules ----------

/** 0-100 from one check-in: sleep (8 h = full marks), energy, mood, and soreness (inverted). */
export function readinessScore(c: { sleepH: number; energy: number; soreness: number; mood: number }): number {
  const sleep = Math.max(0, Math.min(1, (c.sleepH - 5) / 3));
  const scale = (v: number) => (v - 1) / 4;
  const parts = [sleep, scale(c.energy), scale(c.mood), 1 - scale(c.soreness)];
  return Math.round((parts.reduce((s, x) => s + x, 0) / parts.length) * 100);
}

/** Low readiness on 3 of the last 5 check-ins suggests a deload. */
export function readinessRule(checkIns: { sleepH: number; energy: number; soreness: number; mood: number }[]): Suggestion | null {
  const recent = checkIns.slice(-5);
  if (recent.length < 3) return null;
  const scores = recent.map(readinessScore);
  const low = scores.filter((s) => s < 45).length;
  if (low < 3) return null;
  return {
    rule: 'readiness-low',
    title: 'Readiness has been low',
    why: `Readiness was under 45 on ${low} of your last ${recent.length} check-ins (${scores.join(', ')}). A deload week (about 50% volume, 60-70% loads) usually helps; eat at least at target.`,
    action: { kind: 'deload' },
    severity: 'warn',
  };
}

/**
 * Stall handler: trend weight flat for 3 weeks during a cut. Suggest exactly one change;
 * the treadmill lever is offered here because the rate-of-loss rule already offers the calorie one.
 */
export function stallRule(trend: TrendPoint[], today: DateKey, phase: Phase | undefined, treadmillOnTarget: boolean): Suggestion | null {
  if (!phase || phase.rateMax === undefined || phase.rateMax >= 0) return null;
  if (diffDays(phase.start, today) < 21) return null;
  const rate = rateOver(trend, today, 21);
  if (rate === null || Math.abs(rate) >= 0.05) return null;
  return treadmillOnTarget
    ? {
        rule: 'stall',
        title: 'Weight trend has stalled for 3 weeks',
        why: `Trend weight moved ${rate.toFixed(2)} kg/week over 3 weeks. You are hitting the treadmill target, so add 5 minutes to each session (or 1-2% incline). Change one thing, then re-check in 2 weeks.`,
        action: { kind: 'treadmill', deltaMin: 5 },
        severity: 'warn',
      }
    : {
        rule: 'stall',
        title: 'Weight trend has stalled for 3 weeks',
        why: `Trend weight moved ${rate.toFixed(2)} kg/week over 3 weeks, and the weekly treadmill target was missed. Hit the treadmill target first before cutting calories.`,
        severity: 'warn',
      };
}

/**
 * Adaptive expenditure suggestion: keep the planned surplus/deficit against the measured TDEE,
 * changing intake in 100-150 kcal steps.
 */
export function expenditureRule(tdee: { tdee: number; confidence: 'low' | 'medium' | 'high' } | null, phase: Phase | undefined): Suggestion | null {
  if (!tdee || !phase || tdee.confidence === 'low') return null;
  const plannedDelta = phase.rateMax !== undefined && phase.rateMax < 0 ? -325 : phase.rateMin !== undefined && phase.rateMin > 0 ? 200 : 0;
  const ideal = tdee.tdee + plannedDelta;
  const gap = ideal - phase.kcal;
  if (Math.abs(gap) < 100) return null;
  const step = Math.sign(gap) * Math.min(150, Math.round(Math.abs(gap) / 50) * 50);
  return {
    rule: 'tdee',
    title: `Measured expenditure suggests ${step > 0 ? 'more' : 'less'} food`,
    why: `From your logged intake and trend weight, expenditure is about ${Math.round(tdee.tdee)} kcal/day (${tdee.confidence} confidence). For this phase's plan (${plannedDelta >= 0 ? '+' : ''}${plannedDelta} kcal) intake would be about ${Math.round(ideal)}; you are at ${phase.kcal}. Move ${step > 0 ? '+' : ''}${step} kcal now and re-check in 2 weeks.`,
    action: { kind: 'kcal', delta: step },
    severity: 'warn',
  };
}

/** Planned or accepted deload weeks, keyed by their Monday. */
export const isDeloadWeek = (weekMonday: DateKey, deloadWeeks: DateKey[]) => deloadWeeks.includes(weekMonday);
