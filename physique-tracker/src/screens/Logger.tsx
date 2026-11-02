import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { detectPR } from '../actions';
import { TreadmillSheet } from '../components/TreadmillSheet';
import { Card, NumInput, Sheet, Tier, fmt, useToast } from '../components/ui';
import { db } from '../db';
import { GROUP_LABEL, SEED_WEIGHTS } from '../data/seed';
import { useExerciseMap, usePlan, useSettings } from '../hooks';
import { fmtDate } from '../lib/dates';
import { e1rm, suggestProgression, warmupSets } from '../lib/formulas';
import { groupOf } from '../lib/planner';
import type { Exercise, Session, SessionItem, SetLog, SkipReason } from '../lib/types';
import { ExerciseForm, ExercisePicker } from './ExerciseLibrary';
import { ReasonSheet } from './Today';

export function Logger({ id, go }: { id: string; go: (r: string) => void }) {
  const session = useLiveQuery(() => db.sessions.get(id), [id]);
  const sets = useLiveQuery(() => db.sets.where('sessionId').equals(id).toArray(), [id]);
  const exMap = useExerciseMap();
  const plan = usePlan();
  const settings = useSettings();
  const [rest, setRest] = useState<{ endAt: number; total: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tmOpen, setTmOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const prCount = useRef(0);

  useWakeLock(!!settings?.keepAwake && session?.status === 'active');

  if (!session || !sets || !exMap || !plan || !settings) return null;
  const day = plan.find((d) => d.weekday === session.weekday);

  async function updateItem(idx: number, patch: Partial<SessionItem> | null) {
    const items = [...session!.items];
    if (patch === null) items.splice(idx, 1);
    else items[idx] = { ...items[idx], ...patch };
    await db.sessions.update(id, { items });
  }

  async function finish() {
    const s = await buildSummary(session!, exMap!);
    await db.sessions.update(id, { status: 'done', endedAt: session!.endedAt ?? Date.now() });
    setSummary(s);
  }

  const working = sets.filter((s) => !s.isWarmup).length;
  const planned = session.items.filter((i) => !i.skipped).reduce((s, i) => s + i.sets, 0);

  return (
    <>
      <header className="top">
        <div>
          <h1>{day?.name ?? 'Workout'}</h1>
          <div className="sub">
            {fmtDate(session.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {working}/{planned} sets
            {session.status === 'active' && <> · <Elapsed from={session.startedAt} /></>}
            {session.returnMode && ' · return mode (~75% loads)'}
            {session.deload && ' · deload (half sets, ~65% loads)'}
          </div>
        </div>
        <button className="btn small" onClick={() => go('today')}>
          Back
        </button>
      </header>

      {session.items.map((item, idx) => (
        <ExerciseBlock
          key={`${item.exerciseId}-${idx}`}
          session={session}
          item={item}
          ex={exMap.get(item.exerciseId)}
          sets={sets.filter((s) => s.exerciseId === item.exerciseId)}
          alts={day?.exercises.find((e) => e.exerciseId === item.exerciseId || e.exerciseId === item.substitutedFrom || e.altIds?.includes(item.exerciseId))}
          exMap={exMap}
          onRest={(sec) => setRest({ endAt: Date.now() + sec * 1000, total: sec })}
          restFor={(ex) => (ex?.compound ? settings.restCompoundSec : settings.restIsolationSec)}
          onUpdate={(p) => updateItem(idx, p)}
          onPR={() => prCount.current++}
        />
      ))}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn grow" onClick={() => setAddOpen(true)}>
          + Exercise
        </button>
        {day && !day.isLegDay && (
          <button className="btn grow" onClick={() => setTmOpen(true)}>
            + Treadmill
          </button>
        )}
      </div>

      <Card title="Session notes">
        <textarea
          className="txt"
          style={{ width: '100%', minHeight: 60, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}
          defaultValue={session.notes}
          onBlur={(e) => db.sessions.update(id, { notes: e.target.value })}
          placeholder="How did it feel? Any pain?"
        />
      </Card>

      <button className="btn primary block" style={{ marginBottom: 24 }} onClick={finish}>
        {session.status === 'done' ? 'Show summary' : 'Finish workout'}
      </button>

      {rest && <RestTimer rest={rest} onChange={setRest} />}

      <ExercisePicker
        open={addOpen}
        onClose={() => setAddOpen(false)}
        exMap={exMap}
        onPick={async (exId) => {
          await db.sessions.update(id, { items: [...session.items, { exerciseId: exId, sets: 3, repMin: 8, repMax: 12, tier: 'O', source: 'added' }] });
          setAddOpen(false);
        }}
      />
      <TreadmillSheet open={tmOpen} onClose={() => setTmOpen(false)} date={session.date} />
      <Sheet open={!!summary} onClose={() => go('today')} title="Session summary">
        {summary && (
          <>
            <div className="grid2">
              <div className="stat">
                <b>{summary.minutes} min</b>
                <span>duration</span>
              </div>
              <div className="stat">
                <b>{summary.sets}</b>
                <span>working sets</span>
              </div>
              <div className="stat">
                <b>{Math.round(summary.tonnage).toLocaleString('en-IN')} kg</b>
                <span>tonnage</span>
              </div>
              <div className="stat">
                <b>{summary.treadmill} kcal</b>
                <span>treadmill (net, est.)</span>
              </div>
            </div>
            {summary.prs.length > 0 && (
              <>
                <h3 style={{ margin: '12px 0 4px' }}>🏆 PRs</h3>
                <ul className="list">
                  {summary.prs.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => go('today')}>
              Done
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

function ExerciseBlock(props: {
  session: Session;
  item: SessionItem;
  ex?: Exercise;
  sets: SetLog[];
  alts?: { exerciseId: string; altIds?: string[] };
  exMap: Map<string, Exercise>;
  onRest: (sec: number) => void;
  restFor: (ex?: Exercise) => number;
  onUpdate: (p: Partial<SessionItem> | null) => void;
  onPR: () => void;
}) {
  const { session, item, ex, sets, alts, exMap, onRest, restFor, onUpdate, onPR } = props;
  const toast = useToast();
  const [skipOpen, setSkipOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [editEx, setEditEx] = useState(false);
  const [extra, setExtra] = useState(0);
  const [warmDrafts, setWarmDrafts] = useState<{ weight: number; reps: number }[]>([]);
  const prev = useLiveQuery(async () => {
    const all = await db.sets.where('exerciseId').equals(item.exerciseId).toArray();
    const before = all.filter((s) => s.sessionId !== session.id && s.date <= session.date);
    const lastDate = before.reduce((m, s) => (s.date > m ? s.date : m), '');
    return { all: all.filter((s) => s.sessionId !== session.id), last: before.filter((s) => s.date === lastDate).sort((a, b) => a.setNo - b.setNo), lastDate };
  }, [item.exerciseId, session.id]);

  const sorted = [...sets].sort((a, b) => a.setNo - b.setNo);
  const doneWork = sorted.filter((s) => !s.isWarmup);
  const inc = ex?.increment ?? 2.5;
  const prog = prev && prev.last.length ? suggestProgression(prev.last, item.repMin, item.repMax, inc) : null;
  let baseWeight = prog?.weight ?? SEED_WEIGHTS[item.exerciseId] ?? 0;
  const loadFactor = session.returnMode ? 0.75 : session.deload ? 0.65 : 1;
  if (loadFactor < 1 && baseWeight) baseWeight = Math.round((baseWeight * loadFactor) / inc) * inc;
  const baseReps = prog?.reps ?? item.repMin;
  const lastDone = doneWork[doneWork.length - 1];
  const pending = Math.max(0, item.sets - doneWork.length) + extra;
  const nextNo = (sorted[sorted.length - 1]?.setNo ?? 0) + 1;

  async function complete(weight: number, reps: number, rir: number | undefined, isWarmup: boolean, setNo: number) {
    const s: SetLog = { sessionId: session.id!, date: session.date, exerciseId: item.exerciseId, setNo, weight, reps, rir, isWarmup, completedAt: Date.now() };
    // PRs are measured against earlier sessions only, so warming into a weight mid-session is not a "PR".
    const history = prev?.all ?? [];
    await db.sets.add(s);
    if (isWarmup) {
      setWarmDrafts((d) => d.slice(1));
      onRest(60);
      return;
    }
    if (extra > 0 && doneWork.length >= item.sets) setExtra((e) => e - 1);
    const pr = detectPR(s, history);
    if (pr.kinds.length) {
      toast(`PR! ${ex?.name}: ${pr.kinds.join(', ')}`, 'pr');
      navigator.vibrate?.([60, 40, 60, 40, 120]);
      onPR();
    }
    onRest(restFor(ex));
  }

  if (item.skipped) {
    return (
      <Card className="ex skipped">
        <div className="row between">
          <div>
            <div className="ex-name">{ex?.name}</div>
            <div className="ex-meta">Skipped · {item.skipped}</div>
          </div>
          <button className="btn small" onClick={() => onUpdate({ skipped: undefined })}>
            Undo
          </button>
        </div>
      </Card>
    );
  }

  const altList = alts ? [alts.exerciseId, ...(alts.altIds ?? [])].filter((x) => x !== item.exerciseId) : [];

  return (
    <Card className="ex">
      <div className="row between">
        <details className="grow">
          <summary>
            <div className="ex-name">{ex?.name ?? item.exerciseId}</div>
            <div className="ex-meta row wrap">
              <Tier tier={item.tier} />
              <span>
                {item.sets} × {item.repMin}-{item.repMax}
              </span>
              <span>· {GROUP_LABEL[groupOf(ex)]}</span>
              {item.source === 'carryover' && <span className="pill warn">carry-over</span>}
              {item.substitutedFrom && <span className="pill">swapped</span>}
            </div>
          </summary>
          <p className="fineprint">
            {ex?.equipment}. {ex?.cues ?? ''} RIR 1-2 on working sets, 2 s lowering. Rest {Math.round(restFor(ex) / 60 * 10) / 10} min.
          </p>
          {ex && (
            <button className="btn small ghost" onClick={() => setEditEx(true)}>
              ✎ Edit exercise
            </button>
          )}
        </details>
      </div>

      {item.notes && <div className="hint">📝 {item.notes}</div>}
      {prev && prev.last.length > 0 && (
        <div className="ex-meta" style={{ marginTop: 6 }}>
          Last ({fmtDate(prev.lastDate)}): {prev.last.filter((s) => !s.isWarmup).map((s) => `${fmt(s.weight)}×${s.reps}`).join(', ')}
        </div>
      )}
      {prog ? (
        <div className={`hint ${prog.kind === 'increase' ? 'up' : ''}`}>
          {prog.kind === 'increase' ? `↑ Increase to ${fmt(prog.weight)} kg × ${prog.reps}` : `Target ${fmt(prog.weight)} kg × ${prog.reps}`}
          <div className="fineprint">{prog.reason}</div>
        </div>
      ) : SEED_WEIGHTS[item.exerciseId] ? (
        <div className="hint">Seed {SEED_WEIGHTS[item.exerciseId]} kg from before the break: confirm on set 1.</div>
      ) : null}

      <div className="sets" style={{ marginTop: 8 }}>
        <span className="hd">Set</span>
        <span className="hd">kg</span>
        <span className="hd">reps</span>
        <span className="hd">RIR</span>
        <span className="hd" />
        {sorted.map((s, i) => (
          <DoneRow key={s.id} s={s} label={s.isWarmup ? 'W' : String(sorted.slice(0, i + 1).filter((x) => !x.isWarmup).length)} />
        ))}
        {warmDrafts.map((w, i) => (
          <DraftRow
            key={`w${i}-${nextNo}`}
            label="W"
            warm
            weight={w.weight}
            reps={w.reps}
            onDone={(wt, r, rir) => complete(wt, r, rir, true, nextNo)}
          />
        ))}
        {Array.from({ length: pending }, (_, i) => (
          <DraftRow
            key={`p${i}-${nextNo}`}
            label={String(doneWork.length + i + 1)}
            weight={lastDone?.weight ?? baseWeight}
            reps={lastDone?.reps ?? baseReps}
            onDone={(wt, r, rir) => complete(wt, r, rir, false, nextNo + warmDrafts.length)}
            active={i === 0}
          />
        ))}
      </div>

      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => setExtra((e) => e + 1)}>
          + Set
        </button>
        {doneWork.length === 0 && baseWeight > 0 && warmDrafts.length === 0 && (
          <button className="btn small" onClick={() => setWarmDrafts(warmupSets(baseWeight, inc))}>
            + Warm-ups
          </button>
        )}
        <button className="btn small" onClick={() => setSubOpen(true)}>
          Swap
        </button>
        <button className="btn small" onClick={() => setSkipOpen(true)}>
          Skip
        </button>
        {item.source === 'added' && doneWork.length === 0 && (
          <button className="btn small danger" onClick={() => onUpdate(null)}>
            Remove
          </button>
        )}
      </div>

      <ReasonSheet
        open={skipOpen}
        onClose={() => setSkipOpen(false)}
        title={`Skip ${ex?.name}`}
        onPick={async (r: SkipReason) => {
          await db.skips.add({ date: session.date, exerciseId: item.exerciseId, reason: r });
          onUpdate({ skipped: r });
          setSkipOpen(false);
        }}
      />
      {editEx && ex && <ExerciseForm ex={ex} onClose={() => setEditEx(false)} />}
      <ExercisePicker
        open={subOpen}
        onClose={() => setSubOpen(false)}
        exMap={exMap}
        preferIds={altList}
        group={groupOf(ex)}
        onPick={(exId) => {
          onUpdate({ exerciseId: exId, substitutedFrom: item.substitutedFrom ?? item.exerciseId });
          setSubOpen(false);
        }}
      />
    </Card>
  );
}

const RIR = ['', '0', '1', '2', '3', '4'];

function DraftRow({ label, weight, reps, onDone, warm, active }: { label: string; weight: number; reps: number; onDone: (w: number, r: number, rir?: number) => void; warm?: boolean; active?: boolean }) {
  const [w, setW] = useState<number | ''>(weight || '');
  const [r, setR] = useState<number | ''>(reps);
  const [rir, setRir] = useState(warm ? '' : '2');
  // Follow updated defaults (e.g. the previous set changed) until the user edits this row.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      setW(weight || '');
      setR(reps);
    }
  }, [weight, reps]);
  const ok = w !== '' && r !== '' && r > 0;
  return (
    <>
      <span className={`setno ${warm ? 'w' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: active || warm ? 1 : 0.6 }}>
        {label}
      </span>
      <NumInput value={w} onChange={(v) => { touched.current = true; setW(v); }} step={0.5} ariaLabel={`Set ${label} weight`} />
      <NumInput value={r} onChange={(v) => { touched.current = true; setR(v); }} ariaLabel={`Set ${label} reps`} />
      <select value={rir} onChange={(e) => setRir(e.target.value)} aria-label={`Set ${label} RIR`}>
        {RIR.map((x) => (
          <option key={x} value={x}>
            {x === '' ? '–' : x}
          </option>
        ))}
      </select>
      <button className="check" disabled={!ok} onClick={() => ok && onDone(w, r, rir === '' ? undefined : Number(rir))} aria-label={`Complete set ${label}`}>
        ✓
      </button>
    </>
  );
}

function DoneRow({ s, label }: { s: SetLog; label: string }) {
  const upd = (patch: Partial<SetLog>) => db.sets.update(s.id!, patch);
  return (
    <div className="done-row" style={{ display: 'contents' }}>
      <button className={`setno ${s.isWarmup ? 'w' : ''}`} onClick={() => upd({ isWarmup: !s.isWarmup })} title="Toggle warm-up">
        {label}
      </button>
      <NumInput value={s.weight} onChange={(v) => v !== '' && upd({ weight: v })} step={0.5} ariaLabel="weight" />
      <NumInput value={s.reps} onChange={(v) => v !== '' && upd({ reps: v })} ariaLabel="reps" />
      <select value={s.rir ?? ''} onChange={(e) => upd({ rir: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="RIR">
        {RIR.map((x) => (
          <option key={x} value={x}>
            {x === '' ? '–' : x}
          </option>
        ))}
      </select>
      <button className="check done" onClick={() => db.sets.delete(s.id!)} aria-label="Undo set">
        ✓
      </button>
    </div>
  );
}

const REST_TAG = 'rest-timer';
const fmtSec = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

async function restNotification(title: string, body: string, alert: boolean) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return;
  await reg.showNotification(title, {
    tag: REST_TAG,
    body,
    silent: !alert,
    renotify: alert,
    requireInteraction: !alert,
    icon: `${import.meta.env.BASE_URL}icon.svg`,
    data: { route: location.hash.replace(/^#\/?/, '') || 'today' },
    ...(alert ? { vibrate: [300, 120, 300] } : { actions: [{ action: 'rest-add', title: '+15 s' }, { action: 'rest-skip', title: 'Skip rest' }] }),
  } as unknown as NotificationOptions);
}

async function clearRestNotification() {
  const reg = await navigator.serviceWorker?.getRegistration();
  (await reg?.getNotifications({ tag: REST_TAG }))?.forEach((n) => n.close());
}

/**
 * Rest countdown. While the app is in the background it keeps a silent notification updated
 * (with +15 s / Skip buttons) and alerts when rest is over.
 */
function RestTimer({ rest, onChange }: { rest: { endAt: number; total: number }; onChange: (r: { endAt: number; total: number } | null) => void }) {
  const [now, setNow] = useState(Date.now());
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const fired = useRef(false);
  const alerted = useRef(false);
  const lastPost = useRef(0);
  useEffect(() => {
    fired.current = false;
    alerted.current = false;
    lastPost.current = 0;
  }, [rest.endAt]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.round((rest.endAt - now) / 1000);
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      navigator.vibrate?.([250, 120, 250]);
      beep();
      if (document.hidden) {
        alerted.current = true;
        restNotification('Rest over: next set', `Rested ${fmtSec(Math.round(rest.total))}. Tap to open the workout.`, true);
      }
    }
    if (left < -30) onChange(null);
  }, [left, onChange, rest.total]);
  // Live countdown in the notification shade while backgrounded (every ~5 s; Android throttles background timers).
  useEffect(() => {
    if (left <= 0 || !document.hidden || Date.now() - lastPost.current < 4500) return;
    lastPost.current = Date.now();
    const ready = new Date(rest.endAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    restNotification(`Rest ${fmtSec(left)}`, `Next set at ${ready}`, false);
  }, [left, rest.endAt]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && clearRestNotification();
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'rest') return;
      if (e.data.action === 'rest-add') onChange({ ...rest, endAt: rest.endAt + 15000 });
      if (e.data.action === 'rest-skip') onChange(null);
    };
    document.addEventListener('visibilitychange', onVis);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      navigator.serviceWorker?.removeEventListener('message', onMsg);
    };
  }, [rest, onChange]);
  // Leaving the timer clears the countdown notification (a "rest over" alert stays until seen).
  useEffect(() => () => void (alerted.current || clearRestNotification()), []);
  const abs = Math.abs(left);
  return (
    <div className={`rest ${left <= 0 ? 'over' : ''}`} role="timer" aria-live="off">
      <span>{left <= 0 ? 'Go!' : 'Rest'}</span>
      <b>
        {left < 0 ? '+' : ''}
        {fmtSec(abs)}
      </b>
      {perm === 'default' && (
        <button onClick={async () => setPerm(await Notification.requestPermission())} aria-label="Show the rest timer in notifications" title="Show the timer outside the app">
          🔔
        </button>
      )}
      <button onClick={() => onChange({ ...rest, endAt: rest.endAt - 15000 })}>−15</button>
      <button onClick={() => onChange({ ...rest, endAt: rest.endAt + 15000 })}>+15</button>
      <button onClick={() => onChange(null)} aria-label="Dismiss timer">
        ✕
      </button>
    </div>
  );
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* audio not available */
  }
}

function Elapsed({ from }: { from: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((now - from) / 60000))} min</>;
}

function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* denied or unsupported */
      }
    };
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

interface Summary {
  minutes: number;
  sets: number;
  tonnage: number;
  treadmill: number;
  prs: string[];
}

async function buildSummary(session: Session, exMap: Map<string, Exercise>): Promise<Summary> {
  const sets = (await db.sets.where('sessionId').equals(session.id!).toArray()).filter((s) => !s.isWarmup);
  const tm = await db.treadmill.where('date').equals(session.date).toArray();
  const prs: string[] = [];
  for (const exId of new Set(sets.map((s) => s.exerciseId))) {
    const before = (await db.sets.where('exerciseId').equals(exId).toArray()).filter((s) => !s.isWarmup && s.sessionId !== session.id && s.date <= session.date);
    if (!before.length) continue;
    const best = Math.max(...before.map((s) => e1rm(s.weight, s.reps)));
    const now = Math.max(...sets.filter((s) => s.exerciseId === exId).map((s) => e1rm(s.weight, s.reps)));
    if (now > best + 0.01) prs.push(`${exMap.get(exId)?.name}: e1RM ${now.toFixed(1)} kg (was ${best.toFixed(1)})`);
  }
  const end = session.endedAt ?? Date.now();
  return {
    minutes: Math.round((end - session.startedAt) / 60000),
    sets: sets.length,
    tonnage: sets.reduce((s, x) => s + x.weight * x.reps, 0),
    treadmill: tm.reduce((s, t) => s + t.netKcal, 0),
    prs,
  };
}
