import type { DateKey } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(k: DateKey): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): DateKey {
  return toKey(new Date());
}

export function addDays(k: DateKey, n: number): DateKey {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86400000);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(k: DateKey): number {
  const d = fromKey(k).getDay();
  return d === 0 ? 7 : d;
}

export function weekStart(k: DateKey): DateKey {
  return addDays(k, 1 - isoWeekday(k));
}

export function weekDays(k: DateKey): DateKey[] {
  const s = weekStart(k);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export function range(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtDate(k: DateKey, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return fromKey(k).toLocaleDateString('en-IN', opts);
}
