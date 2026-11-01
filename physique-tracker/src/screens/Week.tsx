import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { startSession } from '../actions';
import { Bar, Card, Estimate, Ring } from '../components/ui';
import { db } from '../db';
import { FALLBACK_WEIGHT_KG, GROUP_LABEL } from '../data/seed';
import { setsByGroup, useCurrentWeight, useExerciseMap, usePlan, useSettings, useSince, useToday } from '../hooks';
import { WEEKDAY_SHORT, addDays, fmtDate, weekDays } from '../lib/dates';
import { planFor, plannedSetsByGroup, treadmillMakeup, weeklyCoverage } from '../lib/planner';

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
