import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { LineChart } from '../components/Chart';
import { Card, Estimate, NumInput, Sheet, fmt } from '../components/ui';
import { db, saveSettings } from '../db';
import { ALL_GROUPS, GROUP_LABEL } from '../data/seed';
import { setsByGroup, useExerciseMap, usePhases, usePlan, useSettings, useSince, useToday, useTrend } from '../hooks';
import { addDays, fmtDate, range, weekDays, weekStart } from '../lib/dates';
import { E1RM_RELIABLE_MAX_REPS, adaptiveTdee, e1rm } from '../lib/formulas';
import { planFor, plannedSetsByGroup } from '../lib/planner';
import { currentPhase } from '../lib/rules';
import { LOWER, PULL, PUSH, UPPER, muscleHeat, ratio } from '../lib/progress';
import type { MuscleGroup, SetLog, Settings } from '../lib/types';

export function Insights() {
  const today = useToday();
  const exMap = useExerciseMap();
  const plan = usePlan();
  const settings = useSettings();
  const since = useSince();
  const trend = useTrend();
  const phases = usePhases();
  const from = addDays(weekStart(today), -7 * 11);
  const data = useLiveQuery(async () => {
    const [sets, tm, food, weighins, skips] = await Promise.all([
      db.sets.toArray(),
      db.treadmill.where('date').aboveOrEqual(from).toArray(),
      db.foodlog.where('date').aboveOrEqual(addDays(today, -60)).toArray(),
      db.weighins.where('date').aboveOrEqual(from).toArray(),
      db.skips.toArray(),
    ]);
    return { sets: sets.filter((s) => !s.isWarmup), tm, food, weighins, skips };
  }, [from]);
  const [exId, setExId] = useState<string>('');
  const [lmOpen, setLmOpen] = useState(false);

  if (!exMap || !plan || !settings || !data || !since || !trend || !phases) return null;
  const { sets } = data;
  const logged = [...new Set(sets.map((s) => s.exerciseId))];
  const sel = exId || logged[0] || '';
  const phase = currentPhase(phases, today);

  // Per-exercise series by session date.
  const byDate = new Map<string, SetLog[]>();
  for (const s of sets.filter((s) => s.exerciseId === sel)) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const dates = [...byDate.keys()].sort();
  const top = dates.map((d) => ({ x: d, y: Math.max(...byDate.get(d)!.map((s) => s.weight)) }));
  const est = dates.map((d) => ({ x: d, y: Math.max(...byDate.get(d)!.map((s) => e1rm(s.weight, s.reps))) }));
  const vol = dates.map((d) => ({ x: d, y: byDate.get(d)!.reduce((a, s) => a + s.weight * s.reps, 0) }));
  const highRep = sets.some((s) => s.exerciseId === sel && s.reps > E1RM_RELIABLE_MAX_REPS);

  // PR board.
  const prs = logged
    .map((id) => {
      const xs = sets.filter((s) => s.exerciseId === id);
      const best = xs.reduce((b, s) => (e1rm(s.weight, s.reps) > e1rm(b.weight, b.reps) ? s : b), xs[0]);
      return { id, best, maxW: Math.max(...xs.map((s) => s.weight)) };
    })
    .sort((a, b) => (exMap.get(a.id)?.name ?? '').localeCompare(exMap.get(b.id)?.name ?? ''));

  // Weekly sets per muscle this week.
  const wk = weekDays(today);
  const thisWeek = setsByGroup(sets.filter((s) => s.date >= wk[0] && s.date <= wk[6]), exMap);
  const planned = plannedSetsByGroup(plan, exMap);
  const zone = (g: MuscleGroup, n: number) => {
    const l = settings.landmarks[g];
    if (n < l.mev) return ['z-low', n < l.mv ? 'below MV' : 'below MEV'];
    if (n <= l.mav) return ['z-mav', 'productive'];
    if (n <= l.mrv) return ['z-mev', 'high'];
    return ['z-mrv', 'over MRV'];
  };

  // Consistency calendar and adherence.
  const trained = new Set(sets.map((s) => s.date));
  const calDays = range(from, addDays(weekStart(today), 6));
  const cls = (d: string) => {
    if (d > today) return 'f';
    if (trained.has(d)) return 't';
    const p = planFor(plan, d);
    if (p?.rest || d < since) return 'r';
    return 'm';
  };
  const last28 = range(addDays(today, -27), addDays(today, -1)).filter((d) => d >= since);
  const plannedDays = last28.filter((d) => !planFor(plan, d)?.rest);
  const workoutPct = plannedDays.length ? plannedDays.filter((d) => trained.has(d)).length / plannedDays.length : null;
  const weighPct = last28.length ? last28.filter((d) => data.weighins.some((w) => w.date === d)).length / last28.length : null;
  const kcalByDate = new Map<string, number>();
  const pByDate = new Map<string, number>();
  for (const f of data.food) {
    kcalByDate.set(f.date, (kcalByDate.get(f.date) ?? 0) + f.kcal);
    pByDate.set(f.date, (pByDate.get(f.date) ?? 0) + f.p);
  }
  const calPct =
    phase && last28.length
      ? last28.filter((d) => {
          const k = kcalByDate.get(d);
          return k !== undefined && Math.abs(k - phase.kcal) <= phase.kcal * 0.1 && (pByDate.get(d) ?? 0) >= phase.protein * 0.9;
        }).length / last28.length
      : null;
  const weeks = [1, 2, 3, 4].map((i) => weekDays(addDays(today, -7 * i))).filter((w) => w[6] >= since);
  const tmPct = weeks.length
    ? weeks.filter((w) => data.tm.filter((t) => t.date >= w[0] && t.date <= w[6]).reduce((s, t) => s + t.netKcal, 0) >= settings.treadmillWeeklyMin).length / weeks.length
    : null;
  // Week streak: consecutive completed weeks with at least 80% of planned sessions.
  let streak = 0;
  for (let i = 1; i < 52; i++) {
    const w = weekDays(addDays(today, -7 * i));
    if (w[6] < since) break;
    const pd = w.filter((d) => !planFor(plan, d)?.rest && d >= since);
    if (pd.length && pd.filter((d) => trained.has(d)).length / pd.length >= 0.8) streak++;
    else break;
  }
  const reasons = new Map<string, number>();
  for (const s of data.skips) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);

  const tdee = adaptiveTdee(kcalByDate, trend, addDays(today, -1), 14);

  // Strength retention: best e1RM in the first 2 weeks of the phase vs the last 2 weeks.
  const retention =
    phase && phase.start <= today
      ? logged
          .map((id) => {
            const xs = sets.filter((s) => s.exerciseId === id);
            const start = xs.filter((s) => s.date >= phase.start && s.date < addDays(phase.start, 14));
            const now = xs.filter((s) => s.date >= addDays(today, -14));
            if (!start.length || !now.length) return null;
            const a = Math.max(...start.map((s) => e1rm(s.weight, s.reps)));
            const b = Math.max(...now.map((s) => e1rm(s.weight, s.reps)));
            return { id, a, b, pct: (b / a - 1) * 100 };
          })
          .filter((x): x is NonNullable<typeof x> => !!x)
      : [];

  const heat = muscleHeat(sets, exMap, today, ALL_GROUPS.filter((g) => g !== 'abs'));

  const pctTxt = (p: number | null) => (p === null ? '–' : `${Math.round(p * 100)}%`);

  return (
    <>
      <header className="top">
        <h1>Insights</h1>
      </header>

      <Card title="Adherence · last 4 weeks">
        <div className="grid2">
          <div className="stat">
            <b>{pctTxt(workoutPct)}</b>
            <span>workouts</span>
          </div>
          <div className="stat">
            <b>{pctTxt(tmPct)}</b>
            <span>treadmill weeks on target</span>
          </div>
          <div className="stat">
            <b>{pctTxt(calPct)}</b>
            <span>days on kcal + protein</span>
          </div>
          <div className="stat">
            <b>{pctTxt(weighPct)}</b>
            <span>weigh-ins</span>
          </div>
        </div>
        <p className="fineprint">
          Streak: {streak} week(s) with 80%+ of sessions.
          {reasons.size > 0 && ` Skip reasons: ${[...reasons.entries()].map(([r, n]) => `${r} ${n}`).join(', ')}.`}
        </p>
      </Card>

      <Card title="Consistency" right={<small>12 weeks</small>}>
        <div className="cal" aria-label="Training calendar">
          {calDays.map((d) => (
            <div key={d} className={cls(d)} title={`${d}: ${{ t: 'trained', m: 'missed', r: 'rest', f: '' }[cls(d)]}`} />
          ))}
        </div>
        <div className="legend" style={{ marginTop: 6 }}>
          <span><i style={{ background: 'var(--accent)' }} />trained</span>
          <span><i style={{ background: 'rgba(248,113,113,.5)' }} />missed</span>
          <span><i style={{ background: 'var(--bg2)' }} />rest</span>
        </div>
      </Card>

      <Card title="Sets per muscle · this week" right={<button className="btn small" onClick={() => setLmOpen(true)}>Landmarks</button>}>
        <ul className="list">
          {ALL_GROUPS.map((g) => {
            const n = thisWeek.get(g) ?? 0;
            const [z, label] = zone(g, n);
            const l = settings.landmarks[g];
            return (
              <li key={g}>
                <span className="grow">{GROUP_LABEL[g]}</span>
                <small className="muted mono">
                  plan {planned.get(g) ?? 0} · MEV {l.mev} · MAV {l.mav}
                </small>
                <strong className="mono" style={{ width: 24, textAlign: 'right' }}>
                  {n}
                </strong>
                <span className={`zone ${z}`}>{label}</span>
              </li>
            );
          })}
        </ul>
        <p className="fineprint">Guideline for this cut: about 10-16 hard sets per muscle per week. Landmarks are rules of thumb; edit them to fit you.</p>
      </Card>

      <Card title="Muscle heatmap" right={<small>last 7 days</small>}>
        <div className="grid3">
          {heat.map((h) => {
            const l = settings.landmarks[h.group];
            const weekly = l.mav || 1;
            const level = Math.min(1, h.sets7 / weekly);
            const ago = h.lastTrained ? Math.round((new Date(today).getTime() - new Date(h.lastTrained).getTime()) / 86400000) : null;
            return (
              <div key={h.group} className="stat" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(level * 70)}%, var(--card2))` }}>
                <b style={{ fontSize: 16 }}>{h.sets7}</b>
                <span>{GROUP_LABEL[h.group].replace(' (all heads)', '')}</span>
                <span style={{ display: 'block' }}>{ago === null ? 'never' : ago === 0 ? 'today' : `${ago}d ago`}</span>
              </div>
            );
          })}
        </div>
        <p className="fineprint">Shading: working sets in the last 7 days relative to your MAV landmark.</p>
      </Card>

      <Card title="Balance" right={<small>last 7 days</small>}>
        <ul className="list">
          {(
            [
              ['Push : pull', ratio(heat, PUSH, PULL), 'chest + triceps vs back + biceps; aim near 1:1'],
              ['Upper : lower', ratio(heat, UPPER, LOWER), 'the plan is upper-heavy by design (aesthetics); about 3-4:1'],
              ['Quads : hamstrings', ratio(heat, ['quads'], ['hamstrings']), 'aim for 2:1 or closer'],
            ] as const
          ).map(([label, r, hint]) => (
            <li key={label}>
              <div className="grow">
                <div>{label}</div>
                <small>{hint}</small>
              </div>
              <small className="mono">
                {r.a} : {r.b}
              </small>
              <strong className="mono" style={{ width: 44, textAlign: 'right' }}>
                {r.r === null ? '–' : r.r.toFixed(1)}
              </strong>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Exercise progress"
        right={
          <select className="txt" value={sel} onChange={(e) => setExId(e.target.value)} style={{ maxWidth: 200, minHeight: 36 }} aria-label="Exercise">
            {logged.length === 0 && <option value="">No logs yet</option>}
            {logged.map((id) => (
              <option key={id} value={id}>
                {exMap.get(id)?.name}
              </option>
            ))}
          </select>
        }
      >
        <LineChart
          series={[
            { name: 'Top set', points: top, color: 'var(--accent)', dots: true },
            { name: 'e1RM', points: est, color: 'var(--accent2)', dots: true, dashed: true },
          ]}
          unit="kg"
          empty="Log a few sessions to see progress"
        />
        {highRep && <p className="fineprint">Some sets are above {E1RM_RELIABLE_MAX_REPS} reps; e1RM is less reliable there.</p>}
        {vol.length > 0 && <LineChart series={[{ name: 'Volume load', points: vol, color: 'var(--goal)', dots: true }]} height={120} unit="kg × reps" />}
      </Card>

      {retention.length > 0 && phase && (
        <Card title={`Strength retention · ${phase.name}`}>
          <ul className="list">
            {retention.map((r) => (
              <li key={r.id}>
                <span className="grow">{exMap.get(r.id)?.name}</span>
                <small className="mono">
                  {r.a.toFixed(1)} → {r.b.toFixed(1)}
                </small>
                <span className={`pill ${r.pct >= -2 ? 'good' : r.pct >= -5 ? 'warn' : 'bad'}`}>
                  {r.pct > 0 ? '+' : ''}
                  {r.pct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="PR board">
        {prs.length === 0 ? (
          <p className="muted">No sets logged yet.</p>
        ) : (
          <ul className="list">
            {prs.map((p) => (
              <li key={p.id}>
                <div className="grow">
                  <div>{exMap.get(p.id)?.name}</div>
                  <small>
                    best {fmt(p.best.weight)} × {p.best.reps} on {fmtDate(p.best.date)} · heaviest {fmt(p.maxW)} kg
                  </small>
                </div>
                <strong className="mono">{e1rm(p.best.weight, p.best.reps).toFixed(1)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={<>Expenditure <Estimate /></>}>
        {tdee ? (
          <>
            <div className="stat">
              <b>{Math.round(tdee.tdee)} kcal/day</b>
              <span>
                from {tdee.days} days of intake and trend weight · {Math.round(tdee.loggedPct * 100)}% logged · confidence {tdee.confidence}
              </span>
            </div>
            {phase && (
              <p className="fineprint">
                Current target {phase.kcal} kcal is a {Math.round(tdee.tdee - phase.kcal)} kcal/day deficit by this estimate. Suggested changes go in 100-150 kcal steps; see Coach.
              </p>
            )}
          </>
        ) : (
          <p className="muted">Needs 14 days with at least 80% of days food-logged plus weigh-ins. Start estimate: about 2,450-2,550 kcal (Mifflin-St Jeor × 1.5).</p>
        )}
      </Card>

      <LandmarkSheet open={lmOpen} onClose={() => setLmOpen(false)} settings={settings} />
    </>
  );
}

function LandmarkSheet({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: Settings }) {
  const [lm, setLm] = useState(settings.landmarks);
  return (
    <Sheet open={open} onClose={onClose} title="Volume landmarks (sets/week)">
      <div className="sets" style={{ gridTemplateColumns: '1fr repeat(4, 56px)' }}>
        <span className="hd" />
        {['MV', 'MEV', 'MAV', 'MRV'].map((h) => (
          <span key={h} className="hd">
            {h}
          </span>
        ))}
        {ALL_GROUPS.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            <span>{GROUP_LABEL[g]}</span>
            {(['mv', 'mev', 'mav', 'mrv'] as const).map((k) => (
              <NumInput key={k} value={lm[g][k]} onChange={(v) => setLm({ ...lm, [g]: { ...lm[g], [k]: v === '' ? 0 : v } })} ariaLabel={`${g} ${k}`} />
            ))}
          </div>
        ))}
      </div>
      <button
        className="btn primary block"
        style={{ marginTop: 12 }}
        onClick={async () => {
          await saveSettings({ landmarks: lm });
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}
