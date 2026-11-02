import { describe, expect, it } from 'vitest';
import { parseReminder } from './parseReminder';
import { customDue } from './reminders';

const TODAY = '2026-11-02';
const at = (h: number, m = 0) => h * 60 + m;

describe('parseReminder', () => {
  it('reads "remind me to … at 6 pm"', () => {
    expect(parseReminder('Remind me to order paneer at 6 pm', TODAY, at(10))).toEqual({ text: 'Order paneer', time: '18:00', repeat: 'once', date: TODAY });
  });
  it('reads daily reminders', () => {
    expect(parseReminder('mix oats and milk for overnight oats every night at 10', TODAY, at(10))).toEqual({
      text: 'Mix oats and milk for overnight oats',
      time: '22:00',
      repeat: 'daily',
      date: TODAY,
    });
    expect(parseReminder('daily 7:30am take creatine', TODAY, at(10)).repeat).toBe('daily');
    expect(parseReminder('daily 7:30am take creatine', TODAY, at(10)).time).toBe('07:30');
  });
  it('handles tomorrow and relative times', () => {
    expect(parseReminder('buy eggs tomorrow at 9', TODAY, at(10))).toMatchObject({ text: 'Buy eggs', time: '09:00', date: '2026-11-03' });
    expect(parseReminder('remind me in 30 minutes to start the treadmill', TODAY, at(18, 50))).toMatchObject({ text: 'Start the treadmill', time: '19:20', date: TODAY });
    expect(parseReminder('in 2 hours drink water', TODAY, at(23))).toMatchObject({ time: '01:00', date: '2026-11-03' });
  });
  it('picks the next occurrence when am/pm is missing', () => {
    expect(parseReminder('call gym at 6', TODAY, at(10)).time).toBe('18:00');
    expect(parseReminder('call gym at 6', TODAY, at(5)).time).toBe('06:00');
  });
  it('a one-off time already passed today means tomorrow', () => {
    expect(parseReminder('stretch at 8 am', TODAY, at(10)).date).toBe('2026-11-03');
  });
  it('uses a part of the day when no time is given', () => {
    expect(parseReminder('soak chana tonight', TODAY, at(10))).toMatchObject({ text: 'Soak chana', time: '21:30' });
  });
  it('leaves time empty when nothing is said about it', () => {
    expect(parseReminder('order paneer', TODAY, at(10)).time).toBeUndefined();
  });
});

describe('customDue', () => {
  const list = [
    { id: 'a', text: 'Order paneer', time: '18:00', repeat: 'once' as const, date: TODAY },
    { id: 'b', text: 'Overnight oats', time: '22:00', repeat: 'daily' as const },
    { id: 'c', text: 'Done', time: '08:00', repeat: 'once' as const, date: TODAY, done: true },
    { id: 'd', text: 'Ticked today', time: '08:00', repeat: 'daily' as const, lastDone: TODAY },
    { id: 'e', text: 'Missed yesterday', time: '09:00', repeat: 'once' as const, date: '2026-11-01' },
  ];
  it('fires once reminders on their day after their time, daily ones every day', () => {
    expect(customDue(list, TODAY, at(17)).map((d) => d.id)).toEqual(['custom-e']);
    expect(customDue(list, TODAY, at(22, 5)).map((d) => d.id)).toEqual(['custom-a', 'custom-b', 'custom-e']);
  });
});
