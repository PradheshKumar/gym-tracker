// Runs the reminder rules: in-app list for the Today screen, and system notifications on this device.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db';
import { useDayTargets } from './hooks-food';
import { usePlan, useToday } from './hooks';
import { DEFAULT_REMINDERS, dueReminders, notYetNotified, type Due, type ReminderConfig } from './lib/reminders';
import { planFor } from './lib/planner';
import { pushActiveHere } from './push';

export const useReminderConfig = () =>
  useLiveQuery(async () => ({ ...DEFAULT_REMINDERS, ...(((await db.kv.get('reminders'))?.value as Partial<ReminderConfig>) ?? {}) }));

export const saveReminderConfig = (c: ReminderConfig) => db.kv.put({ key: 'reminders', value: c });

function useMinutes() {
  const now = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [m, setM] = useState(now);
  useEffect(() => {
    const t = setInterval(() => setM(now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return m;
}

export function useDueReminders(): Due[] | undefined {
  const today = useToday();
  const minutes = useMinutes();
  const config = useReminderConfig();
  const plan = usePlan();
  const targets = useDayTargets(today);
  const state = useLiveQuery(async () => {
    const [weigh, sets, skips, check, food, water, waist, media] = await Promise.all([
      db.weighins.get(today),
      db.sets.where('date').equals(today).count(),
      db.skips.where('date').equals(today).filter((s) => !s.exerciseId).count(),
      db.checkins.get(today),
      db.foodlog.where('date').equals(today).count(),
      db.hydration.get(today),
      db.measurements.where('site').equals('waist (navel)').sortBy('date'),
      db.media.filter((m) => !!m.blob).toArray(),
    ]);
    const last = (type: 'photo' | 'video') =>
      media.filter((m) => m.type === type).reduce<string | undefined>((d, m) => (!d || m.date > d ? m.date : d), undefined);
    return {
      weighedIn: !!weigh,
      trainedOrSkipped: sets > 0 || skips > 0,
      checkedIn: !!check,
      foodLogged: food > 0,
      waterMl: water?.ml ?? 0,
      lastMeasurement: waist[waist.length - 1]?.date,
      lastPhoto: last('photo'),
      lastVideo: last('video'),
    };
  }, [today]);
  if (!config || !plan || !state || targets === undefined) return undefined;
  const p = planFor(plan, today);
  return dueReminders(config, {
    ...state,
    today,
    minutes,
    isTrainingDay: !!p && !p.rest,
    waterTargetMl: (targets?.waterL ?? 3) * 1000,
  });
}

const SENT = 'reminders.sent';

/**
 * Shows each due reminder once a day as a system notification, if this device allowed notifications.
 * Also keeps a small summary of photo/video dates in synced storage: media never leave the device,
 * so the push function needs this to know when photo day is due.
 */
export function ReminderNotifier() {
  const due = useDueReminders();
  const today = useToday();
  const mediaSummary = useLiveQuery(async () => {
    const media = await db.media.filter((m) => !!m.blob).toArray();
    const last = (type: 'photo' | 'video') =>
      media.filter((m) => m.type === type).reduce<string | undefined>((d, m) => (!d || m.date > d ? m.date : d), undefined);
    return { lastPhoto: last('photo'), lastVideo: last('video') };
  });
  useEffect(() => {
    if (!mediaSummary) return;
    db.kv.get('mediaSummary').then((row) => {
      const cur = row?.value as { lastPhoto?: string; lastVideo?: string } | undefined;
      if (cur?.lastPhoto !== mediaSummary.lastPhoto || cur?.lastVideo !== mediaSummary.lastVideo) db.kv.put({ key: 'mediaSummary', value: mediaSummary });
    });
  }, [mediaSummary]);
  useEffect(() => {
    // With background push on, the server sends these; avoid double alerts.
    if (!due?.length || pushActiveHere() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let sent: Record<string, string> = {};
    try {
      sent = JSON.parse(localStorage.getItem(SENT) ?? '{}');
    } catch {
      /* ignore */
    }
    const fresh = notYetNotified(due, sent, today);
    if (!fresh.length) return;
    (async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      for (const d of fresh) {
        const opts = { body: d.body, tag: d.id, icon: `${import.meta.env.BASE_URL}icon.svg`, data: { route: d.route } };
        if (reg) await reg.showNotification(d.title, opts);
        else new Notification(d.title, opts);
        sent[d.id] = today;
      }
      try {
        localStorage.setItem(SENT, JSON.stringify(sent));
      } catch {
        /* ignore */
      }
    })();
  }, [due, today]);
  return null;
}
