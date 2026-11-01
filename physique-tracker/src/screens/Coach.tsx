import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Bar, Card, Field, NumInput, Sheet, useToast } from '../components/ui';
import { db, saveSettings } from '../db';
import { useDietBreaks } from '../hooks-food';
import { useExerciseMap, usePhases, useSettings, useToday, useTrend } from '../hooks';
import { addDays, diffDays, fmtDate, weekDays, weekStart } from '../lib/dates';
import { adaptiveTdee } from '../lib/formulas';
import type { DateRange } from '../lib/nutrition';
import { currentPhase, expenditureRule, rateOfLossRule, readinessFlags, readinessRule, stallRule, strengthRule, type Suggestion } from '../lib/rules';
import type { DateKey, Phase } from '../lib/types';

export function Coach({ go }: { go: (r: string) => void }) {
  const today = useToday();
  const phases = usePhases();
  const trend = useTrend();
  const exMap = useExerciseMap();
  const toast = useToast();
  const sets = useLiveQuery(() => db.sets.where('date').aboveOrEqual(addDays(today, -60)).toArray(), [today]);
  const checkins = useLiveQuery(() => db.checkins.where('date').aboveOrEqual(addDays(today, -7)).sortBy('date'), [today]);
  const events = useLiveQuery(() => db.rules.orderBy('date').reverse().limit(20).toArray());
  const checks = useLiveQuery(async () => ((await db.kv.get('exitChecks'))?.value as Record<string, boolean>) ?? {});
  const [edit, setEdit] = useState<Phase | null>(null);
  const settings = useSettings();
  const dietBreaks = useDietBreaks();
  const deloadWeeks = useLiveQuery(async () => ((await db.kv.get('deloadWeeks'))?.value as DateKey[]) ?? []);
  const fuel = useLiveQuery(async () => {
    const from = addDays(today, -28);
    const [food, tm] = await Promise.all([db.foodlog.where('date').aboveOrEqual(from).toArray(), db.treadmill.where('date').aboveOrEqual(from).toArray()]);
    return { food, tm };
  }, [today]);

  if (!phases || !trend || !exMap || !sets || !checkins || !events || !checks || !settings || !dietBreaks || !deloadWeeks || !fuel) return null;
  const phase = currentPhase(phases, today);
  const next = phase ? phases.find((p) => p.order === phase.order + 1) : undefined;
  const names = new Map([...exMap].map(([id, e]) => [id, e.name]));
  const intake = new Map<DateKey, number>();
  for (const f of fuel.food) intake.set(f.date, (intake.get(f.date) ?? 0) + f.kcal);
  const tdee = adaptiveTdee(intake, trend, addDays(today, -1), 21) ?? adaptiveTdee(intake, trend, addDays(today, -1), 14);
  // Treadmill on target in each of the last 3 full weeks.
  const tmOnTarget = [1, 2, 3].every((i) => {
    const w = weekDays(addDays(today, -7 * i));
    return fuel.tm.filter((t) => t.date >= w[0] && t.date <= w[6]).reduce((s, t) => s + t.netKcal, 0) >= settings.treadmillWeeklyMin;
  });
  const suggestions = [
    rateOfLossRule(trend, today, phase),
    stallRule(trend, today, phase, tmOnTarget),
    expenditureRule(tdee, phase),
    strengthRule(sets, today, names),
    readinessRule(checkins),
    readinessFlags(checkins),
  ].filter(
    (s): s is Suggestion => !!s,
  );
  const decidedRecently = (rule: string) => events.some((e) => e.rule === rule && diffDays(e.date, today) < 14);

  async function decide(s: Suggestion, accepted: boolean) {
    await db.rules.add({ date: today, rule: s.rule, suggestion: s.why, status: accepted ? 'accepted' : 'declined' });
    if (accepted && s.action?.kind === 'kcal' && phase) {
      // Change carbs only, so protein and fat floors stay intact.
      await db.phases.update(phase.id, { kcal: phase.kcal + s.action.delta, carbs: Math.round(phase.carbs + s.action.delta / 4) });
      toast(`Target now ${phase.kcal + s.action.delta} kcal`);
    }
    if (accepted && s.action?.kind === 'treadmill') {
      const minutes = Math.min(settings!.treadmillSessionCapMin, settings!.treadmillPreset.minutes + s.action.deltaMin);
      await saveSettings({ treadmillPreset: { ...settings!.treadmillPreset, minutes } });
      toast(`Treadmill sessions now ${minutes} min`);
    }
    if (accepted && s.action?.kind === 'deload') {
      const next = addDays(weekStart(today), 7);
      if (!deloadWeeks!.includes(next)) await db.kv.put({ key: 'deloadWeeks', value: [...deloadWeeks!, next].sort() });
      toast(`Deload planned for the week of ${fmtDate(next)}`);
    }
  }

  const started = phase && phase.start <= today;
  const total = phase ? diffDays(phase.start, phase.end) + 1 : 1;
  const elapsed = phase ? Math.max(0, Math.min(total, diffDays(phase.start, today) + 1)) : 0;
  const left = phase ? diffDays(today, phase.end) : 0;
  const nearEnd = started && left <= 14;
  // Reverse diet: +100 kcal/week from the cut target to the next phase's maintenance-ish target.
  const reverse = phase && next && phase.rateMax !== undefined && phase.rateMax < 0 ? Array.from({ length: Math.max(0, Math.ceil((next.kcal - 200 - phase.kcal) / 100)) }, (_, i) => ({ week: i + 1, kcal: phase.kcal + (i + 1) * 100 })) : [];

  return (
    <>
      <header className="top">
        <h1>Coach</h1>
        <button className="btn small" onClick={() => go('today')}>
          Today
        </button>
      </header>

      {phase && (
        <Card title={`Phase ${phase.order}: ${phase.name}`} right={<button className="btn small" onClick={() => setEdit(phase)}>Edit</button>}>
          <p style={{ marginTop: 0 }}>{phase.aim}</p>
          <div className="row between">
            <small>{fmtDate(phase.start, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
            <small>{started ? `${left} days left` : `starts in ${diffDays(today, phase.start)} days`}</small>
            <small>{fmtDate(phase.end, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
          </div>
          <Bar value={elapsed} max={total} />
          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="stat">
              <b>{phase.kcal}</b>
              <span>kcal/day (est.)</span>
            </div>
            <div className="stat">
              <b>
                {phase.protein}/{phase.carbs}/{phase.fat}
              </b>
              <span>P / C / F g</span>
            </div>
          </div>
          {(phase.targets.weightKg || phase.targets.waistCm) && (
            <p className="fineprint">
              End targets: {phase.targets.weightKg && `${phase.targets.weightKg} kg`} {phase.targets.bodyFatPct && `· ~${phase.targets.bodyFatPct}% BF`}{' '}
              {phase.targets.waistCm && `· waist ${phase.targets.waistCm} cm`} {phase.targets.leanKg && `· lean ≥ ${phase.targets.leanKg} kg`}
            </p>
          )}
          {nearEnd && next && (
            <div className="banner info" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>
                Next: {next.name} from {fmtDate(next.start, { weekday: 'short', day: 'numeric', month: 'short' })}
              </strong>
              <p>
                {next.aim} Targets switch automatically to {next.kcal} kcal, {next.protein} g protein, {next.fat} g fat.
              </p>
            </div>
          )}
          {phase.id === 'p2' && (
            <p className="fineprint">
              Planned: optional high-carb day weekly (~2,450 kcal); 5-7 day maintenance break 14-20 Dec 2026 (good deload week). Optional creatine 3-5 g/day from week 1.
            </p>
          )}
        </Card>
      )}

      <Card title="Coaching checks">
        {suggestions.length === 0 ? (
          <p className="muted">
            Nothing to act on. Rate-of-loss checks need 2 weeks of phase data; strength checks need a few weeks of logs.
          </p>
        ) : (
          suggestions.map((s) => (
            <div key={s.rule} className={`banner ${s.severity === 'warn' ? 'warn' : 'good'}`}>
              <strong>{s.title}</strong>
              <p>
                <em>Why: </em>
                {s.why}
              </p>
              {s.severity === 'warn' &&
                (decidedRecently(s.rule) ? (
                  <small>Decided in the last 2 weeks. Change one thing at a time.</small>
                ) : (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn small primary" onClick={() => decide(s, true)}>
                      {s.action?.kind === 'kcal' ? `Apply ${s.action.delta > 0 ? '+' : ''}${s.action.delta} kcal` : 'Accept'}
                    </button>
                    <button className="btn small" onClick={() => decide(s, false)}>
                      Decline
                    </button>
                  </div>
                ))}
            </div>
          ))
        )}
        <p className="fineprint">
          Rules: check every 2 weeks. Loss under 0.15 kg/week → −150 kcal or +5 min treadmill per session. Over 0.5 → +150 kcal. Lifts down 5-10% for 2+ weeks, poor sleep, low mood or constant fatigue → eat more and/or deload. One change at a time.
        </p>
      </Card>

      {phase?.exitChecklist && (
        <Card title={nearEnd ? 'Exit checklist · phase ending soon' : 'Exit checklist'}>
          <ul className="list">
            {phase.exitChecklist.map((c) => {
              const key = `${phase.id}:${c}`;
              return (
                <li key={c}>
                  <label className="row grow">
                    <input type="checkbox" checked={!!checks[key]} onChange={(e) => db.kv.put({ key: 'exitChecks', value: { ...checks, [key]: e.target.checked } })} />
                    {c}
                  </label>
                </li>
              );
            })}
          </ul>
          {reverse.length > 0 && (
            <p className="fineprint">
              Reverse diet into {next!.name}: {reverse.map((r) => `wk ${r.week}: ${r.kcal}`).join(' → ')} kcal, then hold maintenance for 2 weeks.
            </p>
          )}
        </Card>
      )}

      <BreaksCard today={today} dietBreaks={dietBreaks} deloadWeeks={deloadWeeks} maintenance={settings.maintenanceKcal} />

      <Card title="12-month roadmap">
        <ul className="list">
          {phases.map((p) => (
            <li key={p.id} onClick={() => setEdit(p)} role="button" style={{ cursor: 'pointer' }}>
              <span className={`pill ${p.id === phase?.id ? 'good' : ''}`}>{p.order}</span>
              <div className="grow">
                <div>{p.name}</div>
                <small>
                  {fmtDate(p.start, { day: 'numeric', month: 'short', year: '2-digit' })} – {fmtDate(p.end, { day: 'numeric', month: 'short', year: '2-digit' })} · {p.kcal} kcal
                </small>
              </div>
              <small className="muted">edit</small>
            </li>
          ))}
        </ul>
        <p className="fineprint">End-state (approx.): 67-69 kg, 11-13% BF (Navy), waist 76-78 cm, lean mass 60-61 kg. Recalibrate along the way.</p>
      </Card>

      {events.length > 0 && (
        <Card title="Decision log">
          <ul className="list">
            {events.map((e) => (
              <li key={e.id}>
                <small style={{ width: 54 }}>{fmtDate(e.date)}</small>
                <span className="grow" style={{ fontSize: 13 }}>
                  {e.rule}
                </span>
                <span className={`pill ${e.status === 'accepted' ? 'good' : ''}`}>{e.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {edit && <PhaseEditor phase={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PhaseEditor({ phase, onClose }: { phase: Phase; onClose: () => void }) {
  const [p, setP] = useState(phase);
  const num = (k: keyof Phase) => (
    <Field label={String(k)}>
      <NumInput value={p[k] as number} onChange={(v) => setP({ ...p, [k]: v === '' ? 0 : v })} />
    </Field>
  );
  return (
    <Sheet open onClose={onClose} title={`Edit ${phase.name}`}>
      <div className="grid2">
        <Field label="Start">
          <input type="date" value={p.start} onChange={(e) => setP({ ...p, start: e.target.value })} />
        </Field>
        <Field label="End">
          <input type="date" value={p.end} onChange={(e) => setP({ ...p, end: e.target.value })} />
        </Field>
        {num('kcal')}
        {num('protein')}
        {num('carbs')}
        {num('fat')}
        {num('fiber')}
        {num('waterL')}
        <Field label="Target weight kg">
          <NumInput value={p.targets.weightKg ?? ''} onChange={(v) => setP({ ...p, targets: { ...p.targets, weightKg: v === '' ? undefined : v } })} step={0.1} />
        </Field>
        <Field label="Target waist cm">
          <NumInput value={p.targets.waistCm ?? ''} onChange={(v) => setP({ ...p, targets: { ...p.targets, waistCm: v === '' ? undefined : v } })} step={0.5} />
        </Field>
      </div>
      {p.fat < 50 && <p className="pill warn">Fat below 50 g: the plan says never go under 50 g.</p>}
      <p className="fineprint">Shifting dates here does not move other phases. Adjust neighbours too if they overlap.</p>
      <button
        className="btn primary block"
        onClick={async () => {
          await db.phases.put(p);
          onClose();
        }}
      >
        Save phase
      </button>
    </Sheet>
  );
}

function BreaksCard({ today, dietBreaks, deloadWeeks, maintenance }: { today: DateKey; dietBreaks: DateRange[]; deloadWeeks: DateKey[]; maintenance: number }) {
  const [start, setStart] = useState(addDays(today, 7));
  const [end, setEnd] = useState(addDays(today, 13));
  const [deloadDate, setDeloadDate] = useState(addDays(weekStart(today), 7));
  const upcoming = (r: DateRange) => r.end >= today;
  return (
    <Card title="Diet breaks and deloads">
      <p className="fineprint" style={{ marginTop: 0 }}>
        Diet break days use maintenance calories (about {maintenance} kcal, extra from carbs). Deload weeks start sessions with about half the sets at ~65% loads.
      </p>
      <h3>Diet breaks</h3>
      <ul className="list">
        {dietBreaks.filter(upcoming).map((r) => (
          <li key={r.start}>
            <span className="grow">
              {fmtDate(r.start, { day: 'numeric', month: 'short' })} – {fmtDate(r.end, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button className="btn small ghost" aria-label="Remove diet break" onClick={() => db.kv.put({ key: 'dietBreaks', value: dietBreaks.filter((x) => x !== r) })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <input className="txt" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} style={{ maxWidth: 150 }} aria-label="Diet break start" />
        <input className="txt" type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} style={{ maxWidth: 150 }} aria-label="Diet break end" />
        <button className="btn small" disabled={end < start} onClick={() => db.kv.put({ key: 'dietBreaks', value: [...dietBreaks, { start, end }].sort((a, b) => a.start.localeCompare(b.start)) })}>
          Add
        </button>
      </div>
      <h3 style={{ marginTop: 12 }}>Deload weeks</h3>
      <ul className="list">
        {deloadWeeks.filter((w) => addDays(w, 6) >= today).map((w) => (
          <li key={w}>
            <span className="grow">Week of {fmtDate(w, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <button className="btn small ghost" aria-label="Remove deload week" onClick={() => db.kv.put({ key: 'deloadWeeks', value: deloadWeeks.filter((x) => x !== w) })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="txt" type="date" value={deloadDate} onChange={(e) => e.target.value && setDeloadDate(e.target.value)} style={{ maxWidth: 150 }} aria-label="Deload week" />
        <button
          className="btn small"
          onClick={() => {
            const w = weekStart(deloadDate);
            if (!deloadWeeks.includes(w)) db.kv.put({ key: 'deloadWeeks', value: [...deloadWeeks, w].sort() });
          }}
        >
          Add week
        </button>
      </div>
    </Card>
  );
}
