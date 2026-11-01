import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { addCarryToOpenSession, sessionForDate, startSession } from '../actions';
import { TreadmillSheet } from '../components/TreadmillSheet';
import { Card, Estimate, Field, NumInput, Ring, Scale, Sheet, Tier, fmt, useToast } from '../components/ui';
import { db } from '../db';
import { useDayTargets } from '../hooks-food';
import { useDueReminders } from '../reminders';
import { FALLBACK_WEIGHT_KG, GROUP_LABEL, SEED_WEIGHTS } from '../data/seed';
import { useCurrentWeight, useExerciseMap, useHistory, usePhases, usePlan, useSettings, useToday, useTrend } from '../hooks';
import { WEEKDAY_SHORT, addDays, diffDays, fmtDate, isoWeekday, weekDays, weekStart } from '../lib/dates';
import { computeCarryPlan, planFor, treadmillMakeup, type CarryItem } from '../lib/planner';
import { currentPhase, rateOfLossRule, readinessScore } from '../lib/rules';
import { stepsNetKcal } from '../lib/formulas';
import { SKIP_REASONS, type CheckIn, type DateKey, type SkipReason } from '../lib/types';

export function Today({ go, weekday }: { go: (r: string) => void; weekday?: number }) {
  const today = useToday();
  const plan = usePlan();
  const exMap = useExerciseMap();
  const settings = useSettings();
  const phases = usePhases();
  const history = useHistory(today);
  const weight = useCurrentWeight();
  const trend = useTrend();
  const toast = useToast();
  const todayWd = isoWeekday(today);
  const selWd = weekday ?? todayWd;
  const viewingToday = selWd === todayWd;
  // Date the selected weekday falls on in the current week (for "open another day's plan").
  const selDate = weekDays(today)[selWd - 1];

  const session = useLiveQuery(() => sessionForDate(today), [today]);
  const daySkip = useLiveQuery(() => db.skips.where('date').equals(today).filter((s) => !s.exerciseId).first(), [today]);
  const weighIn = useLiveQuery(() => db.weighins.get(today), [today]);
  const checkIn = useLiveQuery(() => db.checkins.get(today), [today]);
  const food = useLiveQuery(() => db.foodlog.where('date').equals(today).toArray(), [today]);
  const dayTargets = useDayTargets(today);
  const deloadWeeks = useLiveQuery(async () => ((await db.kv.get('deloadWeeks'))?.value as DateKey[]) ?? []);
  const plannedFood = useLiveQuery(() => db.foodplan.where('date').equals(today).toArray(), [today]);
  const weekTm = useLiveQuery(() => db.treadmill.where('date').between(weekDays(today)[0], weekDays(today)[6], true, true).toArray(), [today]);
  const lastTop = useLiveQuery(async () => {
    const m = new Map<string, { weight: number; reps: number }>();
    const sets = await db.sets.orderBy('id').toArray();
    for (const s of sets) if (!s.isWarmup) m.set(s.exerciseId, { weight: s.weight, reps: s.reps });
    return m;
  });
  const decided = useLiveQuery(() => db.carryovers.where('targetDate').equals(today).toArray(), [today]);
  const rescheduled = useLiveQuery(() => db.carryovers.where('rescheduledTo').equals(today).filter((c) => c.status === 'rescheduled').toArray(), [today]);
  const ruleEvents = useLiveQuery(() => db.rules.where('date').aboveOrEqual(addDays(today, -14)).toArray(), [today]);

  const [tmOpen, setTmOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);

  if (!plan || !exMap || !settings || !phases || !history) return null;
  const day = plan.find((d) => d.weekday === selWd)!;
  const carry = computeCarryPlan(today, plan, exMap, history, settings);
  const phase = currentPhase(phases, today);
  const w = weight ?? FALLBACK_WEIGHT_KG;

  const tmDone = (weekTm ?? []).reduce((s, t) => s + t.netKcal, 0);
  const tm = treadmillMakeup(today, plan, tmDone, new Set((weekTm ?? []).map((t) => t.date)), w, settings);
  const tmToday = (weekTm ?? []).filter((t) => t.date === today).reduce((s, t) => s + t.netKcal, 0);
  const todayPlan = planFor(plan, today)!;
  const suggestedMin = todayPlan.treadmillMin > 0 && !todayPlan.isLegDay ? Math.max(todayPlan.treadmillMin, tm.minutesPerSession) : 0;

  const kcal = (food ?? []).reduce((s, f) => s + f.kcal, 0);
  const protein = (food ?? []).reduce((s, f) => s + f.p, 0);
  const firstEver = history.trainedDates.size === 0;
  const rule = trend && rateOfLossRule(trend, today, phase);
  const showRule = rule && rule.severity === 'warn' && !(ruleEvents ?? []).some((r) => r.rule === rule.rule);

  async function start(returnMode = false) {
    const id = await startSession(today, day, { returnMode });
    go(`session/${id}`);
  }

  async function skipDay(reason: SkipReason) {
    await db.skips.add({ date: today, weekday: selWd, reason });
    setSkipOpen(false);
    toast('Day skipped. Core work will be offered as carry-over tomorrow.');
  }

  return (
    <>
      <header className="top">
        <div>
          <h1>{fmtDate(today, { weekday: 'long', day: 'numeric', month: 'short' })}</h1>
          <div className="sub">
            {phase && (phase.start > today ? `${phase.name} starts in ${diffDays(today, phase.start)} day(s)` : `${phase.name} · week ${Math.floor(diffDays(phase.start, today) / 7) + 1} of ${Math.ceil((diffDays(phase.start, phase.end) + 1) / 7)}`)}
          </div>
        </div>
        <button className="btn small" onClick={() => go('coach')}>
          Phase
        </button>
      </header>

      {viewingToday && deloadWeeks?.includes(weekStart(today)) && (
        <div className="banner info">
          <strong>Deload week</strong>
          <p>Sessions you start this week use about half the sets at ~65% of your loads. Keep treadmill easy; recovery is the goal.</p>
        </div>
      )}
      {carry.mode === 'return' && viewingToday && (
        <div className="banner info">
          <strong>Welcome back: {carry.daysSinceLast} days since your last session</strong>
          <p>Start at about 70-80% of your last weights and about 2 sets per exercise. Build back over 1-2 weeks.</p>
          {!session && (
            <button className="btn small primary" style={{ marginTop: 8 }} onClick={() => start(true)}>
              Start return session
            </button>
          )}
        </div>
      )}
      {firstEver && viewingToday && (
        <div className="banner info">
          <strong>First logged session</strong>
          <p>Prefilled weights are your pre-break numbers. The break and trip may have lowered them: confirm in your first sets.</p>
        </div>
      )}
      {showRule && rule && (
        <div className="banner warn" onClick={() => go('coach')} role="button">
          <strong>{rule.title}</strong>
          <p>{rule.why}</p>
        </div>
      )}

      {viewingToday && <DueCard go={go} />}

      <div className="chips days" style={{ marginBottom: 12 }} role="tablist" aria-label="Day">
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
          <button
            key={wd}
            role="tab"
            aria-selected={wd === selWd}
            className={`chip ${wd === selWd ? 'on' : ''} ${wd === todayWd ? 'today' : ''}`}
            onClick={() => go(wd === todayWd ? 'today' : `today/${wd}`)}
          >
            {WEEKDAY_SHORT[wd]}
          </button>
        ))}
      </div>

      <Card
        title={
          <>
            {day.name}
            {!viewingToday && <span className="pill">{fmtDate(selDate, { weekday: 'short' })} plan</span>}
          </>
        }
        right={day.isLegDay ? <span className="pill">Leg day</span> : day.treadmillMin ? <span className="pill">+ {day.treadmillMin} min treadmill</span> : null}
      >
        {day.rest ? (
          <>
            <p className="muted">Rest. Optional easy walk if you feel recovered. Sunday is the flex day for anything deferred.</p>
            {viewingToday && (
              <button className="btn block" onClick={() => (session?.id ? go(`session/${session.id}`) : start(false))}>
                {session ? 'Open flex session' : 'Start flex session (accepted carry-over)'}
              </button>
            )}
          </>
        ) : (
          <ul className="list">
            {day.exercises.map((pe) => {
              const ex = exMap.get(pe.exerciseId);
              const last = lastTop?.get(pe.exerciseId);
              const seed = SEED_WEIGHTS[pe.exerciseId];
              return (
                <li key={pe.exerciseId}>
                  <div className="grow">
                    <div>{ex?.name}</div>
                    <small>
                      {pe.sets} × {pe.repMin}-{pe.repMax}
                      {last ? ` · last ${fmt(last.weight)} kg × ${last.reps}` : seed ? ` · seed ${seed} kg (confirm)` : ''}
                    </small>
                  </div>
                  <Tier tier={pe.tier} />
                </li>
              );
            })}
          </ul>
        )}
        {viewingToday && !day.rest && (
          <div className="row" style={{ marginTop: 12 }}>
            {daySkip ? (
              <>
                <span className="pill warn grow">Skipped: {daySkip.reason}</span>
                <button className="btn small" onClick={() => db.skips.delete(daySkip.id!)}>
                  Undo
                </button>
              </>
            ) : (
              <>
                <button className="btn primary grow" onClick={() => (session?.id ? go(`session/${session.id}`) : start(false))}>
                  {session ? (session.status === 'done' ? 'Review session' : 'Continue workout') : 'Start workout'}
                </button>
                {!session && (
                  <button className="btn" onClick={() => setSkipOpen(true)}>
                    Skip
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <button className="btn small ghost block" style={{ marginTop: 8 }} onClick={() => go(`plan/${day.weekday}`)}>
          Edit {WEEKDAY_SHORT[day.weekday]} plan
        </button>
        {!viewingToday && !day.rest && (
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => start(false)}>
            Do this plan today instead
          </button>
        )}
      </Card>

      {viewingToday && (carry.mode === 'carryover' || carry.mode === 'rescue' || (rescheduled ?? []).length > 0) && (
        <CarryBlock
          today={today}
          mode={carry.mode}
          items={carry.today}
          tomorrow={carry.tomorrow}
          deferred={carry.deferred}
          missed={carry.missedDays}
          rescheduled={(rescheduled ?? []).map((r) => ({ id: r.id!, exerciseId: r.exerciseId, sets: r.sets, sourceDate: r.sourceDate }))}
          decided={decided ?? []}
          names={(id) => exMap.get(id)?.name ?? id}
        />
      )}

      {viewingToday && (
        <Card title="Treadmill" right={<button className="btn small" onClick={() => setTmOpen(true)}>Log</button>}>
          <div className="row">
            <Ring value={tmDone} max={settings.treadmillWeeklyMin} label={Math.round(tmDone)} sub={`/ ${settings.treadmillWeeklyMin}`} />
            <div className="grow stack">
              <div>
                {suggestedMin ? (
                  <>
                    Today: <strong>{suggestedMin} min</strong> at {settings.treadmillPreset.speedKmh} km/h, {settings.treadmillPreset.inclinePct}% after lifting
                  </>
                ) : todayPlan.isLegDay ? (
                  'No treadmill after leg day. Walk a few minutes to warm up.'
                ) : (
                  'No treadmill planned today.'
                )}
              </div>
              <small>
                Week: {Math.round(tmDone)} net kcal <Estimate />
                {tm.remainingKcal <= 0
                  ? ' · weekly target met'
                  : tm.sessionsLeft.length
                    ? ` · ${Math.round(tm.remainingKcal)} to go over ${tm.sessionsLeft.length} session(s)${tm.capped ? ' (capped at 60 min each; target not reachable this week)' : ''}`
                    : ' · no treadmill days left this week. Let it go; do not cram.'}
                {tmToday > 0 && ` · today ${tmToday}`}
              </small>
            </div>
          </div>
          <StepsRow date={today} weightKg={w} />
        </Card>
      )}

      {viewingToday && phase && (
        <Card title="Nutrition" right={<button className="btn small" onClick={() => go('food')}>Log food</button>}>
          <div className="rings">
            <div>
              <Ring value={kcal} max={dayTargets?.kcal ?? phase.kcal} label={Math.round(kcal)} sub={`/ ${dayTargets?.kcal ?? phase.kcal}`} color="var(--accent2)" />
              kcal
            </div>
            <div>
              <Ring value={protein} max={phase.protein} label={`${Math.round(protein)}g`} sub={`/ ${phase.protein}g`} />
              protein
            </div>
          </div>
          {(dayTargets?.label || (plannedFood ?? []).length > 0) && (
            <p className="fineprint" style={{ marginBottom: 0 }}>
              {dayTargets?.label && <span className="pill warn" style={{ marginRight: 6 }}>{dayTargets.label}</span>}
              {(plannedFood ?? []).length > 0 &&
                `Planned today: ${Math.round((plannedFood ?? []).reduce((s, p) => s + p.kcal, 0))} kcal, ${(plannedFood ?? []).filter((p) => p.loggedId).length}/${(plannedFood ?? []).length} eaten`}
            </p>
          )}
        </Card>
      )}

      {viewingToday && !weighIn && <WeighInCard date={today} />}
      {viewingToday && weighIn && (
        <div className="banner good">
          Weighed in: <strong>{weighIn.kg} kg</strong> · trend {fmt(weight, 2)} kg
        </div>
      )}
      {viewingToday && <CheckInCard date={today} existing={checkIn} />}

      <TreadmillSheet open={tmOpen} onClose={() => setTmOpen(false)} date={today} minutes={suggestedMin || undefined} />
      <ReasonSheet open={skipOpen} onClose={() => setSkipOpen(false)} title="Skip today" onPick={skipDay} />
    </>
  );
}

export function ReasonSheet({ open, onClose, title, onPick }: { open: boolean; onClose: () => void; title: string; onPick: (r: SkipReason) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="muted" style={{ marginTop: 0 }}>
        Why? Reasons feed the adherence view.
      </p>
      <div className="grid2">
        {SKIP_REASONS.map((r) => (
          <button key={r} className="btn" onClick={() => onPick(r)}>
            {r}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function CarryBlock(props: {
  today: DateKey;
  mode: string;
  items: CarryItem[];
  tomorrow: CarryItem[];
  deferred: CarryItem[];
  missed: DateKey[];
  rescheduled: { id: string; exerciseId: string; sets: number; sourceDate: DateKey }[];
  decided: { exerciseId: string; status: string; sourceDate: DateKey }[];
  names: (id: string) => string;
}) {
  const { today, mode, items, tomorrow, deferred, missed, rescheduled, decided, names } = props;
  const [skipFor, setSkipFor] = useState<CarryItem | null>(null);
  const toast = useToast();
  const accepted = decided.filter((d) => d.status === 'accepted');
  const total = items.length + rescheduled.length;
  const isRescue = mode === 'rescue';

  async function accept(it: { sourceDate: DateKey; exerciseId: string; sets: number; repMin?: number; repMax?: number }) {
    await db.carryovers.add({ sourceDate: it.sourceDate, targetDate: today, exerciseId: it.exerciseId, sets: it.sets, status: 'accepted' });
    await addCarryToOpenSession(today, {
      exerciseId: it.exerciseId,
      sets: it.sets,
      repMin: it.repMin ?? 8,
      repMax: it.repMax ?? 12,
      tier: 'C',
      source: 'carryover',
      sourceDate: it.sourceDate,
    });
  }
  async function acceptRescheduled(id: string) {
    const r = await db.carryovers.get(id);
    if (!r) return;
    await db.carryovers.update(id, { status: 'accepted', targetDate: today });
    await addCarryToOpenSession(today, { exerciseId: r.exerciseId, sets: r.sets, repMin: 8, repMax: 12, tier: 'C', source: 'carryover', sourceDate: r.sourceDate });
  }
  async function skip(it: CarryItem, reason: SkipReason) {
    await db.carryovers.add({ sourceDate: it.sourceDate, targetDate: today, exerciseId: it.exerciseId, sets: it.sets, status: 'skipped', reason });
    await db.skips.add({ date: today, exerciseId: it.exerciseId, reason });
    setSkipFor(null);
  }
  async function reschedule(it: CarryItem, to: DateKey) {
    await db.carryovers.add({ sourceDate: it.sourceDate, targetDate: today, exerciseId: it.exerciseId, sets: it.sets, status: 'rescheduled', rescheduledTo: to });
    toast(`Moved to ${fmtDate(to, { weekday: 'short', day: 'numeric', month: 'short' })}`);
  }
  async function acceptAll() {
    for (const it of items) await accept(it);
    for (const r of rescheduled) await acceptRescheduled(r.id);
  }

  const Row = ({ it, later }: { it: CarryItem; later?: DateKey }) => (
    <li>
      <div className="grow">
        <div>{names(it.exerciseId)}</div>
        <small>
          {it.sets} sets · from {fmtDate(it.sourceDate, { weekday: 'short' })} · {GROUP_LABEL[it.group]}
        </small>
      </div>
      {later ? (
        <button className="btn small" onClick={() => reschedule(it, later)}>
          Plan {fmtDate(later, { weekday: 'short' })}
        </button>
      ) : (
        <>
          <button className="btn small primary" onClick={() => accept(it)} aria-label={`Accept ${names(it.exerciseId)}`}>
            ✓
          </button>
          <button className="btn small" onClick={() => setSkipFor(it)} aria-label={`Skip ${names(it.exerciseId)}`}>
            Skip
          </button>
          <button className="btn small" onClick={() => reschedule(it, it.suggestedDate ?? addDays(today, 1))} aria-label="Reschedule">
            ⇥
          </button>
        </>
      )}
    </li>
  );

  return (
    <Card className="carry">
      <details>
        <summary className="row between">
          <h2>
            {isRescue ? 'Rescue session' : 'Carry-over'} <span className="pill warn">{total}</span>
            {accepted.length > 0 && <span className="pill good">{accepted.length} added</span>}
          </h2>
          <span className="muted">▾</span>
        </summary>
        <p className="fineprint">
          Missed {missed.map((d) => fmtDate(d, { weekday: 'short' })).join(', ')}. Core exercises only, 2 sets each.
          {isRescue ? ' Split over today and tomorrow, capped at about 90 min total.' : ' Capped at about 8 sets and 20 min.'} ✓ add · Skip · ⇥ move to the flex day.
        </p>
        {total > 0 ? (
          <>
            <ul className="list">
              {rescheduled.map((r) => (
                <li key={r.id}>
                  <div className="grow">
                    <div>{names(r.exerciseId)}</div>
                    <small>{r.sets} sets · rescheduled to today</small>
                  </div>
                  <button className="btn small primary" onClick={() => acceptRescheduled(r.id)}>
                    ✓
                  </button>
                </li>
              ))}
              {items.map((it) => (
                <Row key={it.exerciseId} it={it} />
              ))}
            </ul>
            <button className="btn block" style={{ marginTop: 8 }} onClick={acceptAll}>
              Add all to today
            </button>
          </>
        ) : (
          <p className="muted">Nothing left to add today.</p>
        )}
        {tomorrow.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Part 2 · tomorrow</h3>
            <ul className="list">
              {tomorrow.map((it) => (
                <Row key={it.exerciseId} it={it} later={addDays(today, 1)} />
              ))}
            </ul>
          </>
        )}
        {deferred.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Not today</h3>
            <ul className="list">
              {deferred.map((it) => (
                <li key={it.exerciseId}>
                  <div className="grow">
                    <div className="muted">{names(it.exerciseId)}</div>
                    <small>
                      {it.deferReason}
                      {it.suggestedDate && ` → ${fmtDate(it.suggestedDate, { weekday: 'short' })}`}
                    </small>
                  </div>
                  {it.suggestedDate && (
                    <button className="btn small" onClick={() => reschedule(it, it.suggestedDate!)}>
                      Plan
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
      <ReasonSheet open={!!skipFor} onClose={() => setSkipFor(null)} title="Skip carry-over" onPick={(r) => skipFor && skip(skipFor, r)} />
    </Card>
  );
}

function WeighInCard({ date }: { date: DateKey }) {
  const [kg, setKg] = useState<number | ''>('');
  const last = useLiveQuery(() => db.weighins.orderBy('date').last());
  return (
    <Card title="Morning weigh-in" right={<small>fasted, after the toilet</small>}>
      <div className="row">
        <NumInput value={kg} onChange={setKg} step={0.1} placeholder={last ? String(last.kg) : 'kg'} ariaLabel="Weight in kg" />
        <button
          className="btn primary"
          disabled={kg === '' || kg < 30}
          onClick={() => kg !== '' && db.weighins.put({ date, kg, fasted: true })}
        >
          Save
        </button>
      </div>
    </Card>
  );
}

function CheckInCard({ date, existing }: { date: DateKey; existing?: CheckIn }) {
  const [c, setC] = useState<CheckIn>({ date, sleepH: 7, energy: 3, soreness: 3, mood: 3, hunger: 3 });
  const [open, setOpen] = useState(false);
  if (existing && !open) {
    return (
      <div className="banner good row between" onClick={() => { setC(existing); setOpen(true); }} role="button">
        <span>
          Readiness <strong>{readinessScore(existing)}</strong> · sleep {existing.sleepH} h · energy {existing.energy} · mood {existing.mood}
        </span>
        <small>edit</small>
      </div>
    );
  }
  return (
    <Card title="20-second check-in">
      <Field label="Sleep (hours)">
        <NumInput value={c.sleepH} onChange={(v) => setC({ ...c, sleepH: v === '' ? 0 : v })} step={0.5} />
      </Field>
      <Scale label="Energy" value={c.energy} onChange={(v) => setC({ ...c, energy: v })} />
      <Scale label="Soreness" value={c.soreness} onChange={(v) => setC({ ...c, soreness: v })} />
      <Scale label="Mood" value={c.mood} onChange={(v) => setC({ ...c, mood: v })} />
      <Scale label="Hunger" value={c.hunger} onChange={(v) => setC({ ...c, hunger: v })} />
      <button
        className="btn primary block"
        style={{ marginTop: 8 }}
        onClick={async () => {
          await db.checkins.put(c);
          setOpen(false);
        }}
      >
        Save check-in
      </button>
    </Card>
  );
}

function StepsRow({ date, weightKg }: { date: DateKey; weightKg: number }) {
  const row = useLiveQuery(() => db.steps.get(date), [date]);
  const [v, setV] = useState<number | ''>('');
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <span className="muted" style={{ whiteSpace: 'nowrap' }}>Steps</span>
      <NumInput value={v} onChange={setV} step={500} placeholder={row ? String(row.steps) : 'optional'} ariaLabel="Steps today" />
      <button
        className="btn small"
        disabled={v === '' || v < 0}
        onClick={async () => {
          if (v === '') return;
          await db.steps.put({ date, steps: v });
          setV('');
        }}
      >
        Save
      </button>
      {row && <small className="muted mono">≈{Math.round(stepsNetKcal(row.steps, weightKg))} kcal</small>}
    </div>
  );
}

/** Due reminders that have no card of their own on this screen. */
function DueCard({ go }: { go: (r: string) => void }) {
  const due = useDueReminders()?.filter((d) => !['weigh-in', 'check-in', 'workout'].includes(d.id));
  if (!due?.length) return null;
  return (
    <div className="banner info">
      <strong>Due</strong>
      <ul className="list">
        {due.map((d) => (
          <li key={d.id} onClick={() => go(d.route)} role="button" style={{ cursor: 'pointer', padding: '6px 0' }}>
            <div className="grow">
              <div>{d.title}</div>
              <small>{d.body}</small>
            </div>
            <span className="muted">›</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
