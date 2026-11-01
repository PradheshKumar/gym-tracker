// Supabase Edge Function body (Deno). Combined with src/lib/reminders.ts by
// scripts/build-push-function.mjs into supabase/functions/send-reminders/index.ts.
// Runs every 15 minutes (pg_cron): for each user with a push subscription, works out which
// reminders are due in their time zone and sends each one at most once a day.

const SUBJECT = 'https://pradheshkumar.github.io/gym-tracker/';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, Deno.env.get('VAPID_PRIVATE_KEY')!);

interface Sub {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  tz: string;
}

function localNow(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const today = `${g('year')}-${g('month')}-${g('day')}`;
  const wd = new Date(today + 'T00:00:00Z').getUTCDay();
  return { today, minutes: Number(g('hour')) * 60 + Number(g('minute')), weekday: wd === 0 ? 7 : wd };
}

async function userState(uid: string, tz: string) {
  const { today, minutes, weekday } = localNow(tz);
  const base = () => db.from('records').select('id, data').eq('user_id', uid).eq('deleted', false);
  const one = async (tbl: string, id: string) => (await base().eq('tbl', tbl).eq('id', id).maybeSingle()).data?.data as any;
  const any = async (q: any) => ((await q.limit(1)).data ?? []).length > 0;

  const [configRow, media, weigh, check, water, plan, phases, sets, daySkips, food, waist] = await Promise.all([
    one('kv', 'reminders'),
    one('kv', 'mediaSummary'),
    one('weighins', today),
    one('checkins', today),
    one('hydration', today),
    one('plan', String(weekday)),
    base().eq('tbl', 'phases'),
    any(base().eq('tbl', 'sets').eq('data->>date', today)),
    any(base().eq('tbl', 'skips').eq('data->>date', today).is('data->>exerciseId', null)),
    any(base().eq('tbl', 'foodlog').eq('data->>date', today)),
    base().eq('tbl', 'measurements').eq('data->>site', 'waist (navel)').order('data->>date', { ascending: false }).limit(1),
  ]);

  const allPhases = ((phases.data ?? []) as { data: any }[]).map((r) => r.data).sort((a, b) => a.order - b.order);
  const phase = allPhases.find((p) => p.start <= today && today <= p.end) ?? allPhases.find((p) => p.start > today);
  const config: ReminderConfig = { ...DEFAULT_REMINDERS, ...(configRow?.value ?? {}) };
  const state: ReminderState = {
    today,
    minutes,
    isTrainingDay: !!plan && !plan.rest,
    weighedIn: !!weigh,
    trainedOrSkipped: sets || daySkips,
    checkedIn: !!check,
    foodLogged: food,
    waterMl: water?.ml ?? 0,
    waterTargetMl: (phase?.waterL ?? 3) * 1000,
    lastMeasurement: (waist.data?.[0] as any)?.data?.date,
    lastPhoto: media?.value?.lastPhoto,
    lastVideo: media?.value?.lastVideo,
  };
  return { today, due: dueReminders(config, state) };
}

Deno.serve(async () => {
  const { data, error } = await db.from('push_subscriptions').select('*');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const byUser = new Map<string, Sub[]>();
  for (const s of (data ?? []) as Sub[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let sent = 0;
  for (const [uid, subs] of byUser) {
    const { today, due } = await userState(uid, subs[0].tz || 'Asia/Kolkata');
    if (!due.length) continue;
    const { data: log } = await db.from('push_log').select('reminder').eq('user_id', uid).eq('day', today);
    const done = new Set((log ?? []).map((r: { reminder: string }) => r.reminder));
    for (const d of due.filter((x) => !done.has(x.id))) {
      const payload = JSON.stringify({ title: d.title, body: d.body, tag: d.id, route: d.route });
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // The browser dropped this subscription: forget it.
          if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
      await db.from('push_log').upsert({ user_id: uid, day: today, reminder: d.id }, { ignoreDuplicates: true });
    }
  }
  return new Response(JSON.stringify({ users: byUser.size, sent }), { headers: { 'Content-Type': 'application/json' } });
});
