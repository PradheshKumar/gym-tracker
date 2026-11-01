import { describe, expect, it } from 'vitest';
import {
  adaptiveTdee,
  e1rm,
  navyBodyFatMale,
  suggestProgression,
  treadmillNetKcal,
  treadmillNetKcalPerMin,
  trendWeights,
  weeklyRate,
} from './formulas';
import { addDays } from './dates';

describe('navy body fat', () => {
  it('US Navy formula: waist 90, neck 40, height 180 = 18.37%', () => {
    expect(navyBodyFatMale(90, 40, 180)).toBeCloseTo(18.37, 1);
  });
  it('returns null when waist <= neck', () => {
    expect(navyBodyFatMale(38, 38, 180)).toBeNull();
  });
  it('drops as waist drops', () => {
    expect(navyBodyFatMale(85, 40, 180)!).toBeLessThan(navyBodyFatMale(90, 40, 180)!);
  });
});

describe('treadmill (ACSM walking)', () => {
  it('67 kg, 5.5 km/h, 10% is about 8.6 net kcal/min', () => {
    expect(treadmillNetKcalPerMin(5.5, 10, 67)).toBeCloseTo(8.6, 1);
  });
  it('about 255 per 30 min and 345 per 40 min', () => {
    expect(Math.round(treadmillNetKcal(30, 5.5, 10, 67))).toBeGreaterThanOrEqual(255);
    expect(Math.round(treadmillNetKcal(30, 5.5, 10, 67))).toBeLessThanOrEqual(260);
    expect(treadmillNetKcal(40, 5.5, 10, 67)).toBeCloseTo(345, -1);
  });
  it('flat walking burns less than incline', () => {
    expect(treadmillNetKcalPerMin(5.5, 0, 67)).toBeLessThan(treadmillNetKcalPerMin(5.5, 10, 67));
  });
});

describe('e1RM (Epley)', () => {
  it('100 x 10 = 133.3', () => expect(e1rm(100, 10)).toBeCloseTo(133.33, 1));
  it('single rep is the weight', () => expect(e1rm(60, 1)).toBe(60));
  it('zero reps is zero', () => expect(e1rm(60, 0)).toBe(0));
});

describe('trend weight', () => {
  it('first point equals the first weigh-in', () => {
    const t = trendWeights([{ date: '2026-11-01', kg: 72.4 }], 0.1);
    expect(t[0].trend).toBe(72.4);
  });
  it('smooths toward new values with alpha', () => {
    const t = trendWeights(
      [
        { date: '2026-11-01', kg: 70 },
        { date: '2026-11-02', kg: 68 },
      ],
      0.1,
    );
    expect(t[1].trend).toBeCloseTo(69.8, 5);
  });
  it('carries forward across missing days', () => {
    const t = trendWeights(
      [
        { date: '2026-11-01', kg: 70 },
        { date: '2026-11-04', kg: 70 },
      ],
      0.1,
    );
    expect(t.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(t[2].trend).toBe(70);
    expect(t[2].weight).toBeUndefined();
  });
  it('weekly rate is negative on a steady loss', () => {
    const entries = Array.from({ length: 28 }, (_, i) => ({ date: addDays('2026-11-01', i), kg: 70 - i * 0.05 }));
    const t = trendWeights(entries, 0.15);
    const r = weeklyRate(t, '2026-11-28')!;
    expect(r).toBeLessThan(0);
    expect(r).toBeGreaterThan(-0.5);
  });
});

describe('adaptive TDEE', () => {
  it('stable weight means TDEE equals intake', () => {
    const entries = Array.from({ length: 14 }, (_, i) => ({ date: addDays('2026-11-01', i), kg: 68 }));
    const intake = new Map(entries.map((e) => [e.date, 2300]));
    const est = adaptiveTdee(intake, trendWeights(entries), '2026-11-14')!;
    expect(est.tdee).toBeCloseTo(2300, 0);
  });
  it('needs 80% of days logged', () => {
    const entries = Array.from({ length: 14 }, (_, i) => ({ date: addDays('2026-11-01', i), kg: 68 }));
    const intake = new Map(entries.slice(0, 10).map((e) => [e.date, 2300]));
    expect(adaptiveTdee(intake, trendWeights(entries), '2026-11-14')).toBeNull();
  });
});

describe('double progression', () => {
  it('suggests an increase when all sets hit the top of the range', () => {
    const p = suggestProgression(
      [
        { weight: 50, reps: 12, rir: 1, isWarmup: false },
        { weight: 50, reps: 12, rir: 1, isWarmup: false },
        { weight: 50, reps: 12, rir: 2, isWarmup: false },
      ],
      8,
      12,
      2.5,
    )!;
    expect(p.kind).toBe('increase');
    expect(p.weight).toBe(52.5);
    expect(p.reps).toBe(8);
  });
  it('chases one more rep otherwise, ignoring warm-ups', () => {
    const p = suggestProgression(
      [
        { weight: 25, reps: 10, isWarmup: true },
        { weight: 50, reps: 12, isWarmup: false },
        { weight: 50, reps: 10, isWarmup: false },
      ],
      8,
      12,
      2.5,
    )!;
    expect(p.kind).toBe('reps');
    expect(p.weight).toBe(50);
    expect(p.reps).toBe(11);
  });
  it('does not progress when the top-range sets were taken to failure (RIR 0)', () => {
    const p = suggestProgression([{ weight: 50, reps: 12, rir: 0, isWarmup: false }], 8, 12, 2.5)!;
    expect(p.kind).toBe('reps');
  });
});
