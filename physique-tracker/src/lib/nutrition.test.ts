import { describe, expect, it } from 'vitest';
import { weeklyBalance } from './nutrition';

const week = (eaten: (number | null)[]) =>
  eaten.map((e, i) => ({ date: `2026-11-0${i + 2}`, target: 2150, eaten: e }));

describe('weekly calorie balance', () => {
  it('spreads an earlier shortfall over today and the remaining days', () => {
    // Mon -400, Tue -200 vs 2150; today is Wed: 5 days left (Wed-Sun).
    const b = weeklyBalance(week([1750, 1950, null, null, null, null, null]), '2026-11-04');
    expect(b.diffSoFar).toBe(-600);
    expect(b.loggedDays).toBe(2);
    expect(b.shiftPerDay).toBe(120);
    expect(b.suggestions).toHaveLength(5);
    expect(b.suggestions[0].suggested).toBe(2270);
  });
  it('asks for less after eating over', () => {
    const b = weeklyBalance(week([2650, null, null, null, null, null, null]), '2026-11-03');
    expect(b.shiftPerDay).toBe(-80);
  });
  it('caps the daily shift', () => {
    const b = weeklyBalance(week([1150, 1150, 1150, 1150, 1150, 1150, null]), '2026-11-08');
    expect(b.shiftPerDay).toBe(300);
    expect(b.capped).toBe(true);
  });
  it('ignores unlogged days instead of counting them as zero', () => {
    const b = weeklyBalance(week([null, 2150, null, null, null, null, null]), '2026-11-04');
    expect(b.diffSoFar).toBe(0);
    expect(b.loggedDays).toBe(1);
  });
});
