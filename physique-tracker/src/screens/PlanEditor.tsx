import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Card, Field, NumInput, Sheet, Tier, useToast } from '../components/ui';
import { db } from '../db';
import { GROUP_LABEL, PLAN } from '../data/seed';
import { useExerciseMap, usePlan, useSettings } from '../hooks';
import { WEEKDAY_SHORT } from '../lib/dates';
import { groupOf, plannedSetsByGroup } from '../lib/planner';
import type { DayPlan, Exercise, PlannedExercise } from '../lib/types';
import { ExercisePicker } from './ExerciseLibrary';

interface PlanTemplate {
  name: string;
  savedAt: number;
  days: DayPlan[];
}

export function PlanScreen({ weekday, go }: { weekday?: number; go: (r: string) => void }) {
  const plan = usePlan();
  const exMap = useExerciseMap();
  const settings = useSettings();
  if (!plan || !exMap || !settings) return null;
  if (weekday) {
    const day = plan.find((d) => d.weekday === weekday);
    return day ? <DayEditor key={weekday} day={day} exMap={exMap} go={go} /> : null;
  }

  const volume = plannedSetsByGroup(plan, exMap);
  return (
    <>
      <header className="top">
        <div>
          <h1>Weekly plan</h1>
          <div className="sub">Changes apply to sessions you start from now on</div>
        </div>
        <button className="btn small" onClick={() => go('exercises')}>
          Exercises
        </button>
      </header>

      <Card>
        <ul className="list">
          {plan.map((d) => {
            const sets = d.exercises.reduce((s, e) => s + e.sets, 0);
            const core = d.exercises.filter((e) => e.tier === 'C').length;
            return (
              <li key={d.weekday} onClick={() => go(`plan/${d.weekday}`)} role="button" style={{ cursor: 'pointer' }}>
                <strong style={{ width: 36 }}>{WEEKDAY_SHORT[d.weekday]}</strong>
                <div className="grow">
                  <div>{d.name}</div>
                  <small>
                    {d.rest
                      ? 'Rest / flex'
                      : `${d.exercises.length} exercises (${core} core) · ${sets} sets${d.treadmillMin ? ` · ${d.treadmillMin} min treadmill` : ''}${d.isLegDay ? ' · leg day' : ''}`}
                  </small>
                </div>
                <span className="muted">›</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Planned weekly sets" right={<small>vs MEV–MAV</small>}>
        <ul className="list">
          {[...volume.entries()].map(([g, n]) => {
            const lm = settings.landmarks[g];
            const cls = n < lm.mev ? 'bad' : n > lm.mrv ? 'warn' : 'good';
            return (
              <li key={g}>
                <span className="grow">{GROUP_LABEL[g]}</span>
                <small className="muted mono">
                  {lm.mev}–{lm.mav}
                </small>
                <span className={`pill ${cls}`} style={{ minWidth: 40, justifyContent: 'center' }}>
                  {n}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="fineprint">Primary muscle only. Guideline for the cut: about 10-16 hard sets per muscle per week.</p>
      </Card>

      <Templates plan={plan} />
    </>
  );
}

function Templates({ plan }: { plan: DayPlan[] }) {
  const toast = useToast();
  const templates = useLiveQuery(async () => ((await db.kv.get('planTemplates'))?.value as PlanTemplate[]) ?? []);
  const [name, setName] = useState('');
  if (!templates) return null;

  async function save() {
    const next = [...templates!.filter((t) => t.name !== name.trim()), { name: name.trim(), savedAt: Date.now(), days: plan }];
    await db.kv.put({ key: 'planTemplates', value: next });
    setName('');
    toast('Template saved');
  }
  async function load(days: DayPlan[], label: string) {
    if (!confirm(`Replace the whole weekly plan with "${label}"? Logged sessions are not affected.`)) return;
    // Plan rows are keyed by weekday, so a put replaces every day (and syncs as edits, not deletes).
    await db.plan.bulkPut(days);
    toast(`Loaded ${label}`);
  }

  return (
    <Card title="Templates">
      <p className="fineprint" style={{ marginTop: 0 }}>
        Save the current week as a template (e.g. "Fat loss", "Lean gain", "Deload") and switch between them per phase.
      </p>
      <div className="row">
        <input className="txt" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={save}>
          Save
        </button>
      </div>
      <ul className="list">
        {templates.map((t) => (
          <li key={t.name}>
            <div className="grow">
              <div>{t.name}</div>
              <small>saved {new Date(t.savedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
            </div>
            <button className="btn small" onClick={() => load(t.days, t.name)}>
              Load
            </button>
            <button
              className="btn small ghost"
              aria-label={`Delete ${t.name}`}
              onClick={async () => confirm(`Delete template "${t.name}"?`) && db.kv.put({ key: 'planTemplates', value: templates.filter((x) => x.name !== t.name) })}
            >
              ✕
            </button>
          </li>
        ))}
        <li>
          <div className="grow">
            <div>Coach's default plan</div>
            <small>the plan from the handoff</small>
          </div>
          <button className="btn small" onClick={() => load(PLAN, "the coach's default plan")}>
            Load
          </button>
        </li>
      </ul>
    </Card>
  );
}

function DayEditor({ day, exMap, go }: { day: DayPlan; exMap: Map<string, Exercise>; go: (r: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<DayPlan>(day);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(day);
  const name = (id: string) => exMap.get(id)?.name ?? id;

  const setEx = (exercises: PlannedExercise[]) => setD({ ...d, exercises });
  const move = (i: number, by: number) => {
    const xs = [...d.exercises];
    const j = i + by;
    if (j < 0 || j >= xs.length) return;
    [xs[i], xs[j]] = [xs[j], xs[i]];
    setEx(xs);
  };

  async function save() {
    await db.plan.put(d);
    toast(`${WEEKDAY_SHORT[d.weekday]} plan saved`);
    go('plan');
  }

  return (
    <>
      <header className="top">
        <button className="btn small" onClick={() => (!dirty || confirm('Discard unsaved changes?')) && go('plan')}>
          ‹ Plan
        </button>
        <h1>{WEEKDAY_SHORT[d.weekday]}</h1>
        <button className="btn small primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </header>

      <Card>
        <Field label="Day name">
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        <div className="grid2" style={{ marginTop: 8, alignItems: 'end' }}>
          <Field label="Treadmill min (after lifting)">
            <NumInput value={d.treadmillMin} step={5} min={0} onChange={(v) => setD({ ...d, treadmillMin: v === '' ? 0 : v })} />
          </Field>
          <div className="stack">
            <label className="row">
              <input type="checkbox" checked={d.isLegDay} onChange={(e) => setD({ ...d, isLegDay: e.target.checked, treadmillMin: e.target.checked ? 0 : d.treadmillMin })} />
              Leg day
            </label>
            <label className="row">
              <input type="checkbox" checked={!!d.rest} onChange={(e) => setD({ ...d, rest: e.target.checked })} />
              Rest / flex day
            </label>
          </div>
        </div>
        {d.isLegDay && d.treadmillMin > 0 && <p className="pill warn">The plan says no treadmill after leg days.</p>}
        <p className="fineprint">Leg days drive the recovery guard (no leg sessions on consecutive days) and the treadmill make-up, which skips them.</p>
      </Card>

      {!d.rest && (
        <Card title="Exercises" right={<small>{d.exercises.reduce((s, e) => s + e.sets, 0)} sets</small>}>
          {d.exercises.length === 0 && <p className="muted">No exercises yet.</p>}
          <ul className="list">
            {d.exercises.map((pe, i) => (
              <li key={`${pe.exerciseId}-${i}`}>
                <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className="btn small ghost" style={{ minHeight: 26, padding: '0 6px' }} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ▲
                  </button>
                  <button className="btn small ghost" style={{ minHeight: 26, padding: '0 6px' }} disabled={i === d.exercises.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ▼
                  </button>
                </div>
                <div className="grow" onClick={() => setEditIdx(i)} role="button" style={{ cursor: 'pointer' }}>
                  <div>{name(pe.exerciseId)}</div>
                  <small>
                    {pe.sets} × {pe.repMin}-{pe.repMax} · {GROUP_LABEL[groupOf(exMap.get(pe.exerciseId))]}
                    {pe.altIds?.length ? ` · or ${pe.altIds.map(name).join(', ')}` : ''}
                  </small>
                  {pe.notes && <small style={{ display: 'block' }}>📝 {pe.notes}</small>}
                </div>
                <button className="btn small ghost" onClick={() => setEx(d.exercises.map((x, j) => (j === i ? { ...x, tier: x.tier === 'C' ? 'O' : 'C' } : x)))} aria-label="Toggle tier">
                  <Tier tier={pe.tier} />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
            + Add exercise
          </button>
          <p className="fineprint">Tap an exercise to edit it. Tap Core/Optional to toggle: only Core work is carried over after a missed day.</p>
        </Card>
      )}

      {dirty && (
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="btn primary grow" onClick={save}>
            Save {WEEKDAY_SHORT[d.weekday]}
          </button>
          <button className="btn" onClick={() => setD(day)}>
            Undo changes
          </button>
        </div>
      )}
      <button
        className="btn block ghost"
        onClick={() => {
          const def = PLAN.find((p) => p.weekday === d.weekday);
          if (def && confirm(`Reset ${WEEKDAY_SHORT[d.weekday]} to the coach's default? (Not saved until you tap Save.)`)) setD(def);
        }}
      >
        Reset this day to default
      </button>

      <ExercisePicker
        open={adding}
        onClose={() => setAdding(false)}
        exMap={exMap}
        onPick={(id) => {
          const ex = exMap.get(id);
          setEx([...d.exercises, { exerciseId: id, sets: 3, repMin: ex?.compound ? 8 : 10, repMax: ex?.compound ? 12 : 15, tier: 'O' }]);
          setAdding(false);
          setEditIdx(d.exercises.length);
        }}
      />
      {editIdx !== null && d.exercises[editIdx] && (
        <ExerciseEntryEditor
          pe={d.exercises[editIdx]}
          exMap={exMap}
          onClose={() => setEditIdx(null)}
          onChange={(pe) => setEx(d.exercises.map((x, j) => (j === editIdx ? pe : x)))}
          onDuplicate={() => {
            const xs = [...d.exercises];
            xs.splice(editIdx + 1, 0, { ...d.exercises[editIdx] });
            setEx(xs);
            setEditIdx(null);
          }}
          onDelete={() => {
            setEx(d.exercises.filter((_, j) => j !== editIdx));
            setEditIdx(null);
          }}
        />
      )}
    </>
  );
}

function ExerciseEntryEditor(props: {
  pe: PlannedExercise;
  exMap: Map<string, Exercise>;
  onClose: () => void;
  onChange: (pe: PlannedExercise) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { pe, exMap, onClose, onChange, onDuplicate, onDelete } = props;
  const [picker, setPicker] = useState<'swap' | 'alt' | null>(null);
  const name = (id: string) => exMap.get(id)?.name ?? id;
  const badRange = pe.repMin > pe.repMax;

  return (
    <Sheet open onClose={onClose} title={name(pe.exerciseId)}>
      <div className="grid3">
        <Field label="Sets">
          <IntInput value={pe.sets} min={1} max={10} onCommit={(v) => onChange({ ...pe, sets: v })} />
        </Field>
        <Field label="Reps min">
          <IntInput value={pe.repMin} min={1} max={50} onCommit={(v) => onChange({ ...pe, repMin: v })} />
        </Field>
        <Field label="Reps max">
          <IntInput value={pe.repMax} min={1} max={50} onCommit={(v) => onChange({ ...pe, repMax: v })} />
        </Field>
      </div>
      {badRange && <p className="pill bad">Min reps is above max reps.</p>}
      <div className="chips" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
        {(['C', 'O'] as const).map((t) => (
          <button key={t} className={`chip ${pe.tier === t ? 'on' : ''}`} onClick={() => onChange({ ...pe, tier: t })}>
            {t === 'C' ? 'Core (never skip, carried over)' : 'Optional (drop first)'}
          </button>
        ))}
      </div>
      <Field label="Notes (shown in the logger)">
        <textarea rows={2} value={pe.notes ?? ''} onChange={(e) => onChange({ ...pe, notes: e.target.value || undefined })} placeholder="e.g. seat height 4, pause at the bottom" />
      </Field>

      <h3 style={{ margin: '12px 0 4px' }}>Variants</h3>
      <p className="fineprint" style={{ marginTop: 0 }}>
        Interchangeable versions offered first under Swap. Each is logged separately, so loads never mix (e.g. Smith vs DB press).
      </p>
      <ul className="list">
        {(pe.altIds ?? []).map((id) => (
          <li key={id}>
            <span className="grow">{name(id)}</span>
            <button className="btn small" onClick={() => onChange({ ...pe, exerciseId: id, altIds: [pe.exerciseId, ...(pe.altIds ?? []).filter((x) => x !== id)] })}>
              Make main
            </button>
            <button className="btn small ghost" aria-label={`Remove ${name(id)}`} onClick={() => onChange({ ...pe, altIds: (pe.altIds ?? []).filter((x) => x !== id) })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="grid2" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => setPicker('alt')}>
          + Variant
        </button>
        <button className="btn" onClick={() => setPicker('swap')}>
          Replace exercise
        </button>
        <button className="btn" onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="btn danger" onClick={onDelete}>
          Remove
        </button>
      </div>
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={badRange} onClick={onClose}>
        Done
      </button>

      <ExercisePicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        exMap={exMap}
        group={groupOf(exMap.get(pe.exerciseId))}
        onPick={(id) => {
          if (picker === 'swap') onChange({ ...pe, exerciseId: id, altIds: (pe.altIds ?? []).filter((x) => x !== id) });
          else if (id !== pe.exerciseId && !(pe.altIds ?? []).includes(id)) onChange({ ...pe, altIds: [...(pe.altIds ?? []), id] });
          setPicker(null);
        }}
      />
    </Sheet>
  );
}

/** Whole-number input that can be cleared while typing; commits only values inside [min, max]. */
function IntInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<number | ''>(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <NumInput
      value={draft}
      min={min}
      onChange={(v) => {
        setDraft(v);
        if (v !== '' && Number.isInteger(v) && v >= min && v <= max) onCommit(v);
      }}
    />
  );
}
