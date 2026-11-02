import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { startSession } from '../actions';
import { Bar, Card, Estimate, Ring } from '../components/ui';
import { db } from '../db';
import { FALLBACK_WEIGHT_KG, GROUP_LABEL } from '../data/seed';
import { setsByGroup, useCurrentWeight, useExerciseMap, usePhases, usePlan, useSettings, useSince, useToday } from '../hooks';
import { WEEKDAY_SHORT, addDays, fmtDate, weekDays } from '../lib/dates';
import { planFor, plannedSetsByGroup, treadmillMakeup, weeklyCoverage } from '../lib/planner';
import { useDietBreaks, useHighCarbDays } from '../hooks-food';
import { sumFood, targetsFor, weeklyBalance } from '../lib/nutrition';
import type { DateKey } from '../lib/types';

export function Week({ go }: { go: (r: string) => void }) {
  const today = useToday();
  const [offset, setOffset] = useState(0);
  const anchor = addDays(today, offset * 7);
  const days = weekDays(anchor);
  const plan = usePlan();
  const exMap = useExerciseMap();
  const settings = useSettings();
  const weight = useCurrentWeight() ?? FALLBACK_WEIGHT_KG;
  const since = useSince();
  const data = useLiveQuery(async () => {
    const [sets, sessions, tm, skips] = await Promise.all([
      db.sets.where('date').between(days[0], days[6], true, true).toArray(),
      db.sessions.where('date').between(days[0], days[6], true, true).toArray(),
      db.treadmill.where('date').between(days[0], days[6], true, true).toArray(),
      db.skips.where('date').between(days[0], days[6], true, true).toArray(),
    ]);
    return { sets, sessions, tm, skips };
  }, [days[0]]);

  if (!plan || !exMap || !settings || !data || !since) return null;
  const trained = new Set(data.sets.filter((s) => !s.isWarmup).map((s) => s.date));
  const byGroup = setsByGroup(data.sets, exMap);
  const plannedByGroup = plannedSetsByGroup(plan, exMap);
  const tmDone = data.tm.reduce((s, t) => s + t.netKcal, 0);
  const isCurrent = offset === 0;
  const tm = treadmillMakeup(isCurrent ? today : days[0], plan, tmDone, new Set(data.tm.map((t) => t.date)), weight, settings);
  const coverage = weeklyCoverage(isCurrent ? today : days[6], plan, exMap, byGroup, trained);
  const plannedDays = days.filter((d) => !planFor(plan, d)?.rest);
  const doneDays = plannedDays.filter((d) => trained.has(d));

  return (
    <>
      <header className="top">
        <button className="btn small" onClick={() => setOffset(offset - 1)} aria-label="Previous week">
          ‹
        </button>
        <div className="center">
          <h1>{isCurrent ? 'This week' : `Week of ${fmtDate(days[0])}`}</h1>
          <div className="sub">
            {fmtDate(days[0])} – {fmtDate(days[6])} · {doneDays.length}/{plannedDays.length} sessions
          </div>
        </div>
        <button className="btn small" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Next week">
          ›
        </button>
      </header>

      <Card title="Planned vs done">
        <ul className="list">
          {days.map((d) => {
            const p = planFor(plan, d)!;
            const n = data.sets.filter((s) => s.date === d && !s.isWarmup).length;
            const plannedSets = p.exercises.reduce((s, e) => s + e.sets, 0);
            const kcal = data.tm.filter((t) => t.date === d).reduce((s, t) => s + t.netKcal, 0);
            const skip = data.skips.find((s) => s.date === d && !s.exerciseId);
            const session = data.sessions.find((s) => s.date === d);
            const status = p.rest
              ? n > 0
                ? 'flex'
                : 'rest'
              : n > 0
                ? 'done'
                : d < since
                  ? 'not tracked'
                  : d < today
                  ? skip
                    ? `skipped (${skip.reason})`
                    : 'missed'
                  : d === today
                    ? 'today'
                    : 'upcoming';
            const cls = status === 'done' || status === 'flex' ? 'good' : status.startsWith('missed') || status.startsWith('skipped') ? 'bad' : '';
            return (
              <li key={d}>
                <strong style={{ width: 36 }}>{WEEKDAY_SHORT[p.weekday]}</strong>
                <div className="grow">
                  <div>{p.name}</div>
                  <small>
                    {p.rest ? '' : `${n}/${plannedSets} sets`}
                    {kcal > 0 && ` · treadmill ${kcal} kcal`}
                  </small>
                </div>
                <span className={`pill ${cls}`}>{status}</span>
                {session ? (
                  <button className="btn small" onClick={() => go(`session/${session.id}`)}>
                    Open
                  </button>
                ) : (
                  !p.rest &&
                  d < today &&
                  d >= since && (
                    <button
                      className="btn small"
                      onClick={async () => go(`session/${await startSession(d, p)}`)}
                      title="Backfill a session you did but did not log"
                    >
                      Backfill
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={<>Treadmill <Estimate /></>}>
        <div className="row">
          <Ring value={tmDone} max={settings.treadmillWeeklyMin} label={Math.round(tmDone)} sub="net kcal" size={96} />
          <div className="grow stack">
            <div>
              Target {settings.treadmillWeeklyMin.toLocaleString('en-IN')}-{settings.treadmillWeeklyMax.toLocaleString('en-IN')} · ceiling {settings.treadmillWeeklyCeiling.toLocaleString('en-IN')}
            </div>
            {tmDone > settings.treadmillWeeklyCeiling && <div className="pill warn">Over the weekly ceiling. Ease off.</div>}
            {isCurrent &&
              (tm.remainingKcal > 0 ? (
                tm.sessionsLeft.length ? (
                  <small>
                    {Math.round(tm.remainingKcal)} kcal to go: about <strong>{tm.minutesPerSession} min</strong> on each of{' '}
                    {tm.sessionsLeft.map((d) => WEEKDAY_SHORT[planFor(plan, d)!.weekday]).join(', ')}
                    {tm.capped && ' (capped at 60 min; you will fall a little short, which is fine)'}
                  </small>
                ) : (
                  <small>{Math.round(tm.remainingKcal)} kcal short, no treadmill days left. Let it go; do not cram.</small>
                )
              ) : (
                <small className="pill good">Weekly target met</small>
              ))}
          </div>
        </div>
      </Card>

      <WeekNutrition days={days} today={today} />

      <Card title="Weekly coverage">
        <ul className="list">
          {coverage.map((c) => (
            <li key={c.group}>
              <span aria-hidden style={{ width: 20 }}>
                {c.hit ? '✅' : '⬜'}
              </span>
              <div className="grow">
                <div>{GROUP_LABEL[c.group]}</div>
                {!c.hit && <small>{c.suggestion}</small>}
              </div>
              <small className="mono">{c.sets} sets</small>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Sets per muscle" right={<small>done / planned</small>}>
        <div className="stack">
          {[...plannedByGroup.entries()].map(([g, planned]) => {
            const done = byGroup.get(g) ?? 0;
            const lm = settings.landmarks[g];
            return (
              <div key={g}>
                <div className="row between">
                  <span>{GROUP_LABEL[g]}</span>
                  <small className="mono">
                    {done} / {planned}
                  </small>
                </div>
                <Bar value={done} max={Math.max(planned, lm.mrv)} marks={[lm.mev, lm.mav]} color={done >= Math.min(planned, lm.mev) ? 'var(--accent)' : 'var(--accent2)'} />
              </div>
            );
          })}
          <p className="fineprint">Marks show your MEV and MAV landmarks (edit in Insights). Guideline for this cut: 10-16 hard sets per muscle per week.</p>
        </div>
      </Card>
    </>
  );
}

/** Calories and protein per day this week vs target, and how to even out the rest of the week. */
function WeekNutrition({ days, today }: { days: DateKey[]; today: DateKey }) {
  const phases = usePhases();
  const settings = useSettings();
  const highCarb = useHighCarbDays();
  const breaks = useDietBreaks();
  const food = useLiveQuery(
    async () => ({
      log: await db.foodlog.where('date').between(days[0], days[6], true, true).toArray(),
      plan: await db.foodplan.where('date').between(days[0], days[6], true, true).toArray(),
    }),
    [days[0]],
  );
  if (!phases || !settings || !highCarb || !breaks || !food) return null;
  const rows = days.map((d) => {
    const t = targetsFor(d, phases, { highCarbDays: highCarb, dietBreaks: breaks, maintenanceKcal: settings.maintenanceKcal });
    const logged = food.log.filter((f) => f.date === d);
    const eaten = sumFood(logged);
    const planned = sumFood(food.plan.filter((f) => f.date === d && !f.loggedId));
    return { d, t, eaten: logged.length ? eaten : null, planned: planned.kcal };
  });
  const withTargets = rows.filter((r) => r.t);
  if (!withTargets.length) return null;
  const isCurrent = today >= days[0] && today <= days[6];
  const bal = weeklyBalance(
    withTargets.map((r) => ({ date: r.d, target: r.t!.kcal, eaten: r.eaten ? r.eaten.kcal : null })),
    isCurrent ? today : addDays(days[6], 1),
  );
  const logged = rows.filter((r) => r.eaten);
  const avgP = logged.length ? logged.reduce((s, r) => s + r.eaten!.p, 0) / logged.length : null;
  const pTarget = withTargets[0].t!.p;
  const eatenWeek = logged.reduce((s, r) => s + r.eaten!.kcal, 0);
  return (
    <Card title={<>Nutrition <Estimate /></>} right={<small className="mono">{Math.round(eatenWeek).toLocaleString('en-IN')} / {bal.weekTarget.toLocaleString('en-IN')} kcal</small>}>
      <div className="stack">
        {rows.map((r) => {
          if (!r.t) return null;
          const v = r.eaten?.kcal ?? 0;
          const sug = bal.suggestions.find((x) => x.date === r.d);
          const over = v > r.t.kcal * 1.05;
          return (
            <div key={r.d}>
              <div className="row between">
                <small style={{ fontWeight: r.d === today ? 700 : undefined }}>
                  {WEEKDAY_SHORT[days.indexOf(r.d) + 1]}
                  {r.t.label && <span className="pill warn" style={{ marginLeft: 6 }}>{r.t.label}</span>}
                </small>
                <small className="mono">
                  {r.eaten ? `${Math.round(v)} / ${r.t.kcal} · P ${Math.round(r.eaten.p)}g` : r.d < today ? 'not logged' : r.planned ? `planned ${Math.round(r.planned)}` : `target ${r.t.kcal}`}
                  {sug && bal.shiftPerDay !== 0 && r.d >= today && <> · aim <strong>{sug.suggested}</strong></>}
                </small>
              </div>
              <Bar value={v || r.planned} max={r.t.kcal} color={!r.eaten ? 'var(--line)' : over ? 'var(--warn)' : 'var(--accent2)'} />
            </div>
          );
        })}
        <div className="hr" />
        {isCurrent && bal.loggedDays > 0 ? (
          <p style={{ margin: 0 }}>
            {Math.abs(bal.diffSoFar) < 100 ? (
              <>On track so far ({bal.diffSoFar >= 0 ? '+' : ''}{Math.round(bal.diffSoFar)} kcal over {bal.loggedDays} logged day(s)).</>
            ) : (
              <>
                {bal.diffSoFar < 0 ? 'Under' : 'Over'} by <strong>{Math.abs(Math.round(bal.diffSoFar))} kcal</strong> over {bal.loggedDays} logged day(s). To even out the week, aim for about{' '}
                <strong>{bal.shiftPerDay > 0 ? '+' : ''}{bal.shiftPerDay} kcal/day</strong> for the {bal.suggestions.length} day(s) left
                {bal.capped && ' (capped at ±300/day; let the rest go)'}.
              </>
            )}
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Log food to see how the week balances.</p>
        )}
        <small>
          Avg protein {avgP === null ? '–' : `${Math.round(avgP)} g`} / {pTarget} g. Extra calories go to carbs; keep protein at target every day. Unlogged days are left out.
        </small>
      </div>
    </Card>
  );
}
