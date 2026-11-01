import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDERS, dueReminders, notYetNotified, type ReminderState } from './reminders';

const base: ReminderState = {
  today: '2026-11-02',
  minutes: 8 * 60,
  isTrainingDay: true,
  weighedIn: false,
  trainedOrSkipped: false,
  checkedIn: false,
  foodLogged: false,
  waterMl: 0,
  waterTargetMl: 3000,
  lastMeasurement: '2026-11-01',
  lastPhoto: '2026-11-01',
  lastVideo: '2026-11-01',
};
const ids = (s: Partial<ReminderState>) => dueReminders(DEFAULT_REMINDERS, { ...base, ...s }).map((d) => d.id);

describe('reminders', () => {
  it('fires timed reminders only after their time and only if not done', () => {
    expect(ids({ minutes: 7 * 60 })).toEqual([]);
    expect(ids({})).toEqual(['weigh-in']);
    expect(ids({ weighedIn: true })).toEqual([]);
    expect(ids({ minutes: 19 * 60, weighedIn: true, checkedIn: true })).toEqual(['workout']);
    expect(ids({ minutes: 19 * 60, weighedIn: true, checkedIn: true, isTrainingDay: false })).toEqual([]);
  });
  it('interval reminders follow the last entry', () => {
    expect(ids({ weighedIn: true, today: '2026-11-15' })).toEqual(['measurements', 'photos']);
    expect(ids({ weighedIn: true, lastVideo: undefined })).toContain('video');
  });
  it('can be switched off entirely', () => {
    expect(dueReminders({ ...DEFAULT_REMINDERS, enabled: false }, base)).toEqual([]);
  });
  it('notifies each reminder once per day', () => {
    const due = dueReminders(DEFAULT_REMINDERS, base);
    expect(notYetNotified(due, { 'weigh-in': '2026-11-02' }, '2026-11-02')).toEqual([]);
    expect(notYetNotified(due, { 'weigh-in': '2026-11-01' }, '2026-11-02')).toHaveLength(1);
  });
});
