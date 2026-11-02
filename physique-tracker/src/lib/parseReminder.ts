// Turn a typed or spoken sentence into a reminder: what, when, and once vs daily.
// "Remind me to order paneer at 6 pm" -> { text: 'Order paneer', time: '18:00', repeat: 'once', date: today }
import { addDays } from './dates';
import type { DateKey } from './types';

export interface ParsedReminder {
  text: string;
  time?: string;
  repeat: 'once' | 'daily';
  date: DateKey;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, an: 1, a: 1 };

/** `now` is the local time as minutes since midnight (injected for tests). */
export function parseReminder(input: string, today: DateKey, now: number): ParsedReminder {
  let s = ` ${input.trim()} `;
  let time: string | undefined;
  let repeat: 'once' | 'daily' = 'once';
  let date = today;
  let dayHint: 'morning' | 'afternoon' | 'evening' | 'night' | undefined;
  const take = (re: RegExp) => {
    const m = s.match(re);
    if (m) s = s.replace(re, ' ');
    return m;
  };

  const part = s.match(/\b(morning|afternoon|evening|night|tonight)\b/i)?.[1]?.toLowerCase();
  if (part) dayHint = part === 'tonight' ? 'night' : (part as typeof dayHint);
  if (take(/\b(every ?day|daily|each day|every (morning|night|evening|afternoon))\b/i)) repeat = 'daily';
  if (take(/\btomorrow\b/i)) date = addDays(today, 1);
  take(/\b(tonight|in the (morning|afternoon|evening)|at night|this (morning|afternoon|evening))\b/i);

  // "in 30 minutes", "in 2 hours", "in half an hour"
  const rel = take(/\bin (\d+|\w+)(?: and a half)? (minute|min|hour|hr)s?\b/i) ?? take(/\bin (half) an (hour)\b/i);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : WORD_NUM[rel[1].toLowerCase()] ?? 0;
    const mins = Math.round(/^h/i.test(rel[2]) ? n * 60 + (/and a half/i.test(rel[0]) ? 30 : 0) : n);
    let t = now + mins;
    if (t >= 24 * 60) {
      date = addDays(date, Math.floor(t / (24 * 60)));
      t %= 24 * 60;
    }
    time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
  }

  // "at 6", "at 6:30 pm", "at 18:00", "6 pm", "6.30am"
  const abs = !time && (take(/\b(?:at|by|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\W)/i) ?? take(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W)/i));
  if (abs) {
    let h = Number(abs[1]);
    const m = Number(abs[2] ?? 0);
    const ap = abs[3]?.toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h < 12) {
      // No am/pm: use the part of day if given, else the next time this clock time comes round.
      if (dayHint === 'afternoon' || dayHint === 'evening' || dayHint === 'night') h += 12;
      else if (!dayHint && repeat === 'once' && date === today && h * 60 + m <= now && (h + 12) * 60 + m > now) h += 12;
    }
    if (h < 24 && m < 60) time = `${pad(h)}:${pad(m)}`;
  }
  if (!time && dayHint) time = { morning: '08:00', afternoon: '14:00', evening: '18:00', night: '21:30' }[dayHint];
  // A one-off time that has already passed today means tomorrow.
  if (time && repeat === 'once' && date === today) {
    const [h, m] = time.split(':').map(Number);
    if (h * 60 + m <= now) date = addDays(today, 1);
  }

  let text = s
    .replace(/^\s*(please\s+)?(remind me|reminder|set a reminder|remember)\s*(to|that|about|for)?\s*/i, ' ')
    .replace(/\b(morning|afternoon|evening|night)\b/gi, ' ')
    .replace(/\s+(to|at|on|for)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/^(to|that)\s+/i, '');
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { text, time, repeat, date };
}
