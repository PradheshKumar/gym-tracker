import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../data/seed';
import { badges, muscleHeat, prHistory, ratio, PULL, PUSH } from './progress';
import { readinessScore, stallRule, expenditureRule } from './rules';
import { trendWeights } from './formulas';
import { addDays } from './dates';
import { PHASES } from '../data/seed';
import type { SetLog } from './types';

const set = (date: string, exerciseId: string, weight: number, reps: number, t = 0): SetLog => ({
  sessionId: date,
  date,
  exerciseId,
  setNo: 1,
  weight,
  reps,
  isWarmup: false,
  completedAt: t,
});

describe('PR history', () => {
  it('ignores the first session and counts later e1RM bests', () => {
    const prs = prHistory([
      set('2026-11-02', 'flat-smith', 60, 8),
      set('2026-11-02', 'flat-smith', 60, 9, 1),
      set('2026-11-05', 'flat-smith', 60, 10),
      set('2026-11-09', 'flat-smith', 60, 9),
    ]);
    expect(prs.map((p) => p.date)).toEqual(['2026-11-05']);
  });
});

describe('badges', () => {
  it('awards sessions, PRs, weigh-in run and weight loss', () => {
    const weighinDates = Array.from({ length: 7 }, (_, i) => addDays('2026-11-02', i));
    const trend = trendWeights(
      Array.from({ length: 60 }, (_, i) => ({ date: addDays('2026-11-02', i), kg: 69 - i * 0.04 })),
      0.3,
    );
    const b = badges({
      sets: [set('2026-11-02', 'flat-smith', 60, 8), set('2026-11-05', 'flat-smith', 62.5, 8)],
      weighinDates,
      photoCount: 0,
      trend,
      waist: [],
      treadmillWeeks: [],
      consistentWeeks: [],
      proteinDaysInARow: 0,
    });
    const earned = b.filter((x) => x.earned).map((x) => x.id);
    expect(earned).toEqual(expect.arrayContaining(['first-session', 'first-pr', 'weigh-7', 'lost-1']));
    expect(earned).not.toContain('photo-1');
  });
});

describe('muscle heat and balance', () => {
  const exMap = new Map(EXERCISES.map((e) => [e.id, e]));
  it('counts sets per group in the last 7 days and the push:pull ratio', () => {
    const heat = muscleHeat(
      [set('2026-11-02', 'flat-smith', 60, 8), set('2026-11-02', 'flat-smith', 60, 8), set('2026-11-03', 'lat-pulldown', 50, 10), set('2026-10-01', 'lat-pulldown', 50, 10)],
      exMap,
      '2026-11-08',
      ['chest', 'back'],
    );
    expect(heat.find((h) => h.group === 'chest')!.sets7).toBe(2);
    expect(heat.find((h) => h.group === 'back')!.sets7).toBe(1);
    expect(ratio(heat, PUSH, PULL).r).toBe(2);
  });
});

describe('v1.5 rules', () => {
  it('readiness: great night and fresh = high; poor sleep and sore = low', () => {
    expect(readinessScore({ sleepH: 8, energy: 5, soreness: 1, mood: 5 })).toBe(100);
    expect(readinessScore({ sleepH: 5, energy: 1, soreness: 5, mood: 1 })).toBe(0);
  });
  it('stall: flat trend for 3 weeks in the cut', () => {
    const cut = PHASES.find((p) => p.id === 'p2')!;
    const trend = trendWeights(Array.from({ length: 40 }, (_, i) => ({ date: addDays('2026-11-02', i), kg: 68 })));
    expect(stallRule(trend, '2026-12-10', cut, true)?.action).toEqual({ kind: 'treadmill', deltaMin: 5 });
    expect(stallRule(trend, '2026-12-10', cut, false)?.action).toBeUndefined();
  });
  it('expenditure: suggests at most 150 kcal per step, only with enough confidence', () => {
    const cut = PHASES.find((p) => p.id === 'p2')!; // 2150 kcal, plan is about -325
    expect(expenditureRule({ tdee: 2900, confidence: 'medium' }, cut)?.action).toEqual({ kind: 'kcal', delta: 150 });
    expect(expenditureRule({ tdee: 2475, confidence: 'high' }, cut)).toBeNull();
    expect(expenditureRule({ tdee: 2900, confidence: 'low' }, cut)).toBeNull();
  });
});
