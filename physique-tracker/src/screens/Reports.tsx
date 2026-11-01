import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Card, Estimate, fmt } from '../components/ui';
import { db } from '../db';
import { useExerciseMap, usePhases, usePlan, useSettings, useSince, useToday, useTrend } from '../hooks';
import { addDays, fmtDate, fromKey, range, toKey, weekDays } from '../lib/dates';
import { e1rm } from '../lib/formulas';
import { planFor } from '../lib/planner';
import { badges, periodWeeks, prHistory } from '../lib/progress';
import { currentPhase } from '../lib/rules';
import type { DateKey } from '../lib/types';

type Period = 'week' | 'month' | 'year';

function bounds(period: Period, offset: number, today: DateKey, since: DateKey): [DateKey, DateKey, string] {
  if (period === 'week') {
    const w = weekDays(addDays(today, offset * 7));
    return [w[0], w[6], `Week of ${fmtDate(w[0])}`];
  }
  if (period === 'month') {
    const d = fromKey(today);
    const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return [toKey(first), toKey(last), first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })];
  }
  // Year in review: the 12 months starting from when tracking began.
  const start = addDays(since, offset * 365);
  return [start, addDays(start, 364), `Year in review · ${fmtDate(start, { month: 'short', year: 'numeric' })}`];
}

export function Reports() {
  const today = useToday();
  const since = useSince();
  const plan = usePlan();
  const exMap = useExerciseMap();
  const phases = usePhases();
  const trend = useTrend();
  const settings = useSettings();
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);
  const data = useLiveQuery(async () => {
    const [sets, tm, food, waist, photos, steps, skips, weighins] = await Promise.all([
      db.sets.toArray(),
      db.treadmill.toArray(),
      db.foodlog.toArray(),
      db.measurements.where('site').equals('waist (navel)').sortBy('date'),
      db.media.filter((m) => m.type === 'photo' && !!m.blob).count(),
      db.steps.toArray(),
      db.skips.toArray(),
      db.weighins.toArray(),
    ]);
    return { sets: sets.filter((s) => !s.isWarmup), tm, food, waist, photos, steps, skips, weighins };
  });

  if (!since || !plan || !exMap || !phases || !trend || !settings || !data) return null;
  const [from, to, title] = bounds(period, offset, today, since);
  const end = to < today ? to : today;
  const inP = (d: DateKey) => d >= from && d <= end;

  const sets = data.sets.filter((s) => inP(s.date));
  const trained = new Set(sets.map((s) => s.date));
  const plannedDays = range(from, end).filter((d) => d >= since && !planFor(plan, d)?.rest);
  const prs = prHistory(data.sets).filter((s) => inP(s.date));
  const tonnage = sets.reduce((s, x) => s + x.weight * x.reps, 0);
  const tmKcal = data.tm.filter((t) => inP(t.date)).reduce((s, t) => s + t.netKcal, 0);
  const steps = data.steps.filter((s) => inP(s.date)).reduce((s, x) => s + x.steps, 0);
  const tStart = trend.find((p) => p.date === from) ?? trend.find((p) => p.date >= from);
  const tEnd = [...trend].reverse().find((p) => p.date <= end);
  const dWeight = tStart && tEnd && tEnd.date > tStart.date ? tEnd.trend - tStart.trend : null;
  const waistIn = data.waist.filter((w) => inP(w.date));
  const dWaist = waistIn.length > 1 ? waistIn[waistIn.length - 1].cm - waistIn[0].cm : null;
  const byDay = new Map<DateKey, { kcal: number; p: number }>();
  for (const f of data.food.filter((f) => inP(f.date))) {
    const v = byDay.get(f.date) ?? { kcal: 0, p: 0 };
    byDay.set(f.date, { kcal: v.kcal + f.kcal, p: v.p + f.p });
  }
  const days = [...byDay.values()];
  const avgKcal = days.length ? days.reduce((s, d) => s + d.kcal, 0) / days.length : null;
  const avgP = days.length ? days.reduce((s, d) => s + d.p, 0) / days.length : null;
  const phase = currentPhase(phases, end);
  const proteinDays = phase ? [...byDay.entries()].filter(([, v]) => v.p >= phase.protein * 0.9).length : 0;
  const skips = data.skips.filter((s) => inP(s.date));

  // Biggest e1RM gains: best in period vs best before it.
  const gains = [...new Set(sets.map((s) => s.exerciseId))]
    .map((id) => {
      const before = data.sets.filter((s) => s.exerciseId === id && s.date < from);
      const during = sets.filter((s) => s.exerciseId === id);
      if (!before.length) return null;
      const a = Math.max(...before.map((s) => e1rm(s.weight, s.reps)));
      const b = Math.max(...during.map((s) => e1rm(s.weight, s.reps)));
      return { id, a, b, d: b - a };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.d > 0)
    .sort((x, y) => y.d - x.d)
    .slice(0, 5);

  // Inputs for badges (all-time).
  const weeksAll = periodWeeks(since, addDays(today, -7));
  const allTrained = new Set(data.sets.map((s) => s.date));
  const consistentWeeks = weeksAll
    .filter((w) => {
      const pd = w.filter((d) => d >= since && !planFor(plan, d)?.rest);
      return pd.length > 0 && pd.filter((d) => allTrained.has(d)).length / pd.length >= 0.8;
    })
    .map((w) => w[0]);
  const treadmillWeeks = weeksAll
    .filter((w) => data.tm.filter((t) => t.date >= w[0] && t.date <= w[6]).reduce((s, t) => s + t.netKcal, 0) >= settings.treadmillWeeklyMin)
    .map((w) => w[0]);
  const proteinByDate = new Map<DateKey, number>();
  for (const f of data.food) proteinByDate.set(f.date, (proteinByDate.get(f.date) ?? 0) + f.p);
  let run = 0;
  let bestRun = 0;
  for (const d of range(since, today)) {
    const ph = currentPhase(phases, d);
    run = ph && (proteinByDate.get(d) ?? 0) >= ph.protein * 0.9 ? run + 1 : 0;
    bestRun = Math.max(bestRun, run);
  }
  const allBadges = badges({
    sets: data.sets,
    weighinDates: data.weighins.map((w) => w.date),
    photoCount: data.photos,
    trend,
    waist: data.waist,
    treadmillWeeks,
    consistentWeeks,
    proteinDaysInARow: bestRun,
  });

  const wins: string[] = [];
  if (plannedDays.length && trained.size / plannedDays.length >= 0.8) wins.push(`Trained ${trained.size} of ${plannedDays.length} planned days`);
  if (prs.length) wins.push(`${prs.length} personal record${prs.length > 1 ? 's' : ''}`);
  if (dWeight !== null && phase?.rateMax !== undefined && phase.rateMax < 0 && dWeight < 0) wins.push(`Trend weight down ${Math.abs(dWeight).toFixed(1)} kg`);
  if (dWaist !== null && dWaist < 0) wins.push(`Waist down ${Math.abs(dWaist).toFixed(1)} cm`);
  if (proteinDays >= Math.max(3, days.length * 0.8) && days.length) wins.push(`Protein target hit on ${proteinDays} logged days`);
  if (period === 'week' && tmKcal >= settings.treadmillWeeklyMin) wins.push('Treadmill target met');

  return (
    <>
      <header className="top no-print">
        <button className="btn small" onClick={() => setOffset(offset - 1)} aria-label="Previous period">
          ‹
        </button>
        <div className="center">
          <h1>{title}</h1>
          <div className="sub">
            {fmtDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – {fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <button className="btn small" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Next period">
          ›
        </button>
      </header>
      <h1 className="print-only">
        {title} · {fmtDate(from)} – {fmtDate(to)}
      </h1>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <div className="chips grow">
          {(['week', 'month', 'year'] as const).map((p) => (
            <button
              key={p}
              className={`chip ${period === p ? 'on' : ''}`}
              onClick={() => {
                setPeriod(p);
                setOffset(0);
              }}
            >
              {p === 'year' ? 'Year in review' : p === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        <button className="btn small" onClick={() => window.print()}>
          Save PDF
        </button>
      </div>

      {wins.length > 0 && (
        <Card title="Wins">
          <ul className="list">
            {wins.map((w) => (
              <li key={w}>🏅 {w}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Training">
        <div className="grid3">
          <div className="stat">
            <b>
              {trained.size}/{plannedDays.length}
            </b>
            <span>sessions</span>
          </div>
          <div className="stat">
            <b>{sets.length}</b>
            <span>working sets</span>
          </div>
          <div className="stat">
            <b>{Math.round(tonnage / 1000)} t</b>
            <span>tonnage</span>
          </div>
          <div className="stat">
            <b>{prs.length}</b>
            <span>PRs</span>
          </div>
          <div className="stat">
            <b>{Math.round(tmKcal).toLocaleString('en-IN')}</b>
            <span>treadmill kcal (est.)</span>
          </div>
          <div className="stat">
            <b>{steps ? steps.toLocaleString('en-IN') : '–'}</b>
            <span>steps logged</span>
          </div>
        </div>
        {gains.length > 0 && (
          <>
            <h3 style={{ margin: '12px 0 4px' }}>Biggest strength gains (e1RM)</h3>
            <ul className="list">
              {gains.map((g) => (
                <li key={g.id}>
                  <span className="grow">{exMap.get(g.id)?.name}</span>
                  <small className="mono">
                    {g.a.toFixed(1)} → {g.b.toFixed(1)}
                  </small>
                  <span className="pill good">+{g.d.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {skips.length > 0 && (
          <p className="fineprint">
            Skips: {Object.entries(skips.reduce<Record<string, number>>((m, s) => ({ ...m, [s.reason]: (m[s.reason] ?? 0) + 1 }), {}))
              .map(([r, n]) => `${r} ${n}`)
              .join(', ')}
          </p>
        )}
      </Card>

      <Card title="Body">
        <div className="grid3">
          <div className="stat">
            <b>{tEnd ? fmt(tEnd.trend, 1) : '–'}</b>
            <span>trend kg</span>
          </div>
          <div className="stat">
            <b>{dWeight === null ? '–' : `${dWeight > 0 ? '+' : ''}${dWeight.toFixed(1)}`}</b>
            <span>kg change</span>
          </div>
          <div className="stat">
            <b>{dWaist === null ? '–' : `${dWaist > 0 ? '+' : ''}${dWaist.toFixed(1)}`}</b>
            <span>waist cm</span>
          </div>
        </div>
      </Card>

      <Card title={<>Nutrition <Estimate /></>}>
        <div className="grid3">
          <div className="stat">
            <b>{avgKcal === null ? '–' : Math.round(avgKcal)}</b>
            <span>avg kcal (logged days)</span>
          </div>
          <div className="stat">
            <b>{avgP === null ? '–' : `${Math.round(avgP)} g`}</b>
            <span>avg protein</span>
          </div>
          <div className="stat">
            <b>{days.length}</b>
            <span>days logged</span>
          </div>
        </div>
      </Card>

      <Card title="Badges" right={<small>{allBadges.filter((b) => b.earned).length}/{allBadges.length}</small>}>
        <div className="grid3">
          {allBadges.map((b) => (
            <div key={b.id} className="stat" style={{ opacity: b.earned ? 1 : 0.4 }} title={b.hint}>
              <b style={{ fontSize: 15 }}>{b.earned ? '🏆' : '🔒'}</b>
              <span style={{ display: 'block', color: 'var(--text)' }}>{b.label}</span>
              <span>{b.hint}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
