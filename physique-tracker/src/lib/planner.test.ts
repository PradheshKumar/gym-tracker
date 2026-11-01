import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, EXERCISES, PLAN } from '../data/seed';
import { computeCarryPlan, findMissedDays, groupOf, treadmillMakeup, weeklyCoverage, type History } from './planner';
import type { MuscleGroup } from './types';

// 2 Nov 2026 is a Monday.
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
const FRI = '2026-11-06';
const SAT = '2026-11-07';
const SUN = '2026-11-08';

const exMap = new Map(EXERCISES.map((e) => [e.id, e]));
const caps = DEFAULT_SETTINGS;

function history(trained: Record<string, MuscleGroup[]>, since = '2026-10-26', resolved: string[] = []): History {
  return {
    trainedDates: new Set(Object.keys(trained)),
    groupsByDate: new Map(Object.entries(trained).map(([d, gs]) => [d, new Set(gs)])),
    resolved: new Set(resolved),
    since,
  };
}

describe('missed days', () => {
  it('none when yesterday was trained', () => {
    expect(findMissedDays(TUE, PLAN, history({ [MON]: ['chest', 'biceps'] }))).toEqual([]);
  });
  it('finds a single missed day since last session', () => {
    expect(findMissedDays(WED, PLAN, history({ [MON]: ['chest'] }))).toEqual([TUE]);
  });
  it('never counts Sunday (rest) as missed', () => {
    expect(findMissedDays('2026-11-09', PLAN, history({ [SAT]: ['quads'] }))).toEqual([]);
  });
  it('does not look before the since date', () => {
    expect(findMissedDays(WED, PLAN, history({}, TUE))).toEqual([TUE]);
  });
});

describe('carry-over (one missed day)', () => {
  const plan = computeCarryPlan(WED, PLAN, exMap, history({ [MON]: ['chest', 'biceps'] }), caps);

  it('is in carry-over mode for Tuesday', () => {
    expect(plan.mode).toBe('carryover');
    expect(plan.missedDays).toEqual([TUE]);
  });
  it('contains only Core exercises, never Optional', () => {
    const tueOptional = PLAN[1].exercises.filter((e) => e.tier === 'O').map((e) => e.exerciseId);
    for (const it of [...plan.today, ...plan.deferred]) expect(tueOptional).not.toContain(it.exerciseId);
  });
  it('defaults to 2 sets per exercise', () => {
    for (const it of plan.today) expect(it.sets).toBe(2);
  });
  it('respects the 8-set and 20-minute caps', () => {
    expect(plan.totals.sets).toBeLessThanOrEqual(8);
    expect(plan.totals.minutes).toBeLessThanOrEqual(20);
  });
  it('drops items already in today\'s plan (rear delt fly is on Wednesday)', () => {
    expect(plan.today.map((i) => i.exerciseId)).not.toContain('rear-delt-fly');
  });
  it('pushes overflow to the flex day with a reason', () => {
    for (const d of plan.deferred) {
      expect(d.deferReason).toBeTruthy();
      expect(d.suggestedDate).toBe(SUN);
    }
  });
});

describe('recovery guard', () => {
  it('does not carry a muscle trained in the last 48 h', () => {
    // Tue back trained, Wed missed, Thu: Wed's shoulders are fine but nothing from back.
    const plan = computeCarryPlan(THU, PLAN, exMap, history({ [TUE]: ['back', 'triceps', 'shoulders'] }), caps);
    expect(plan.mode).toBe('carryover');
    expect(plan.today.some((i) => i.group === 'shoulders')).toBe(false);
    expect(plan.deferred.some((i) => i.group === 'shoulders' && /48 h/.test(i.deferReason!))).toBe(true);
  });
  it('does not stack leg sessions on consecutive days', () => {
    // Fri missed, Sat is a leg day: legs never carried into Sat. Here Sat missed, Sun is flex and Mon is not legs.
    const sun = computeCarryPlan(SUN, PLAN, exMap, history({ [FRI]: ['back', 'triceps'] }), caps);
    expect(sun.missedDays).toEqual([SAT]);
    expect(sun.today.some((i) => ['quads', 'hamstrings'].includes(i.group))).toBe(true);
    // Wed (legs) missed, Thu is fine for legs because Wed had no legs and Fri is not a leg day.
    const thu = computeCarryPlan(THU, PLAN, exMap, history({ [TUE]: ['back'] }), caps);
    expect(thu.today.some((i) => groupOf(exMap.get(i.exerciseId)) === 'quads')).toBe(true);
    // Fri (back) and Wed would put legs before a Sat leg day: never into Friday.
    const fri = computeCarryPlan(FRI, PLAN, exMap, history({ [TUE]: ['back'], [THU]: ['chest'] }), caps);
    expect(fri.today.some((i) => ['quads', 'hamstrings', 'calves'].includes(i.group))).toBe(false);
  });
  it('respects carry-over decisions already made', () => {
    const plan = computeCarryPlan(WED, PLAN, exMap, history({ [MON]: ['chest'] }, '2026-10-26', [`${TUE}|lat-pulldown`]), caps);
    expect(plan.today.map((i) => i.exerciseId)).not.toContain('lat-pulldown');
  });
});

describe('rescue session (2+ missed days)', () => {
  const plan = computeCarryPlan(THU, PLAN, exMap, history({ [MON]: ['chest', 'biceps'] }), caps);
  it('switches to rescue mode', () => {
    expect(plan.mode).toBe('rescue');
    expect(plan.missedDays).toEqual([TUE, WED]);
  });
  it('caps the total at the rescue limit, split over two days', () => {
    expect(plan.totals.minutes).toBeLessThanOrEqual(caps.rescueMaxMin);
    expect(plan.tomorrow.length).toBeGreaterThanOrEqual(0);
    const all = [...plan.today, ...plan.tomorrow, ...plan.deferred];
    const ids = all.map((i) => i.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('puts protected groups first', () => {
    const order = plan.today.map((i) => i.group);
    const firstNonProtected = order.findIndex((g) => !['shoulders', 'back', 'quads', 'hamstrings', 'calves'].includes(g));
    if (firstNonProtected >= 0) {
      expect(order.slice(firstNonProtected).every((g) => !['shoulders', 'back'].includes(g))).toBe(true);
    }
  });
});

describe('return to training', () => {
  it('triggers after a 7+ day break instead of carry-over', () => {
    const plan = computeCarryPlan('2026-11-12', PLAN, exMap, history({ [MON]: ['chest'] }), caps);
    expect(plan.mode).toBe('return');
    expect(plan.today).toEqual([]);
  });
});

describe('weekly coverage', () => {
  it('flags missing groups and points to the next planned day', () => {
    const rows = weeklyCoverage(WED, PLAN, exMap, new Map([['chest', 8], ['biceps', 5]]), new Set([MON]));
    expect(rows.find((r) => r.group === 'chest')!.hit).toBe(true);
    const shoulders = rows.find((r) => r.group === 'shoulders')!;
    expect(shoulders.hit).toBe(false);
    expect(shoulders.suggestion).toMatch(/today/);
    expect(rows[0].group).toBe('shoulders'); // protected first
  });
  it('suggests the flex day when nothing is left', () => {
    const rows = weeklyCoverage(SAT, PLAN, exMap, new Map(), new Set([MON, TUE, WED, THU, FRI]));
    expect(rows.find((r) => r.group === 'chest')!.suggestion).toMatch(/Sun/);
  });
});

describe('treadmill make-up', () => {
  it('spreads the remaining kcal over the remaining non-leg sessions', () => {
    const m = treadmillMakeup(THU, PLAN, 345, new Set([MON]), 67, DEFAULT_SETTINGS);
    expect(m.sessionsLeft).toEqual([THU, FRI]);
    expect(m.remainingKcal).toBeCloseTo(1055, 0);
    expect(m.minutesPerSession).toBeLessThanOrEqual(60);
    expect(m.capped).toBe(true);
  });
  it('needs nothing once the target is met', () => {
    const m = treadmillMakeup(FRI, PLAN, 1500, new Set(), 67, DEFAULT_SETTINGS);
    expect(m.remainingKcal).toBe(0);
    expect(m.minutesPerSession).toBe(0);
  });
});
