// Reminder rules. Pure: given the config and what has been logged, which reminders are due now.
// No imports on purpose: this exact file is also bundled into the Supabase push function
// (supabase/functions/send-reminders), so the app and the server agree on what is due.

type DateKey = string; // YYYY-MM-DD

const diffDays = (a: DateKey, b: DateKey) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export interface ReminderConfig {
  enabled: boolean;
  weighIn: { on: boolean; time: string };
  workout: { on: boolean; time: string };
  checkIn: { on: boolean; time: string };
  food: { on: boolean; time: string };
  water: { on: boolean; everyHours: number };
  measurements: { on: boolean; everyDays: number };
  photos: { on: boolean; everyDays: number };
  video: { on: boolean; everyDays: number };
}

export const DEFAULT_REMINDERS: ReminderConfig = {
  enabled: true,
  weighIn: { on: true, time: '07:30' },
  workout: { on: true, time: '18:00' },
  checkIn: { on: true, time: '09:00' },
  food: { on: true, time: '21:00' },
  water: { on: false, everyHours: 3 },
  measurements: { on: true, everyDays: 14 },
  photos: { on: true, everyDays: 14 },
  video: { on: true, everyDays: 28 },
};

export interface ReminderState {
  today: DateKey;
  /** Minutes since local midnight. */
  minutes: number;
  isTrainingDay: boolean;
  weighedIn: boolean;
  trainedOrSkipped: boolean;
  checkedIn: boolean;
  foodLogged: boolean;
  waterMl: number;
  waterTargetMl: number;
  lastMeasurement?: DateKey;
  lastPhoto?: DateKey;
  lastVideo?: DateKey;
}

export interface Due {
  id: string;
  title: string;
  body: string;
  route: string;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

const overdue = (last: DateKey | undefined, today: DateKey, every: number) => !last || diffDays(last, today) >= every;

export function dueReminders(c: ReminderConfig, s: ReminderState): Due[] {
  if (!c.enabled) return [];
  const out: Due[] = [];
  const after = (t: string) => s.minutes >= toMin(t);
  if (c.weighIn.on && after(c.weighIn.time) && !s.weighedIn)
    out.push({ id: 'weigh-in', title: 'Morning weigh-in', body: 'Fasted, after the toilet, before food or water.', route: 'today' });
  if (c.checkIn.on && after(c.checkIn.time) && !s.checkedIn)
    out.push({ id: 'check-in', title: '20-second check-in', body: 'Sleep, energy, soreness, mood, hunger.', route: 'today' });
  if (c.workout.on && s.isTrainingDay && after(c.workout.time) && !s.trainedOrSkipped)
    out.push({ id: 'workout', title: 'Workout today', body: "Today's session is not logged yet.", route: 'today' });
  if (c.food.on && after(c.food.time) && !s.foodLogged)
    out.push({ id: 'food', title: 'Log your food', body: 'Nothing logged today yet.', route: 'food' });
  if (c.water.on && s.minutes >= 9 * 60 && s.minutes <= 21 * 60) {
    // Expected intake rises linearly from 09:00 to 21:00.
    const expected = (s.waterTargetMl * (s.minutes - 9 * 60)) / (12 * 60);
    if (s.waterMl < expected - 500) out.push({ id: `water-${Math.floor(s.minutes / (c.water.everyHours * 60))}`, title: 'Water', body: `${(s.waterMl / 1000).toFixed(1)} L so far today.`, route: 'food' });
  }
  if (c.measurements.on && after('08:00') && overdue(s.lastMeasurement, s.today, c.measurements.everyDays))
    out.push({ id: 'measurements', title: 'Measurement day', body: 'Neck and waist at the navel, fasted.', route: 'body/measure' });
  if (c.photos.on && after('08:00') && overdue(s.lastPhoto, s.today, c.photos.everyDays))
    out.push({ id: 'photos', title: 'Photo day', body: 'Front, side and back with the ghost camera.', route: 'media' });
  if (c.video.on && after('08:00') && overdue(s.lastVideo, s.today, c.video.everyDays))
    out.push({ id: 'video', title: 'Pose video', body: 'Monthly pose video.', route: 'media' });
  return out;
}

/** Notification bookkeeping: each reminder id fires at most once per day. */
export function notYetNotified(due: Due[], sent: Record<string, DateKey>, today: DateKey): Due[] {
  return due.filter((d) => sent[d.id] !== today);
}

