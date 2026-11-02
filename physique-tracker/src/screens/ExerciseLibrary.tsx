import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Card, Field, NumInput, Sheet, useToast } from '../components/ui';
import { db } from '../db';
import { ALL_GROUPS, GROUP_LABEL, MUSCLE_GROUP, MUSCLE_LABEL } from '../data/seed';
import { useExerciseMap, usePlan } from '../hooks';
import { groupOf } from '../lib/planner';
import type { Exercise, Muscle, MuscleGroup } from '../lib/types';

const MUSCLES = Object.keys(MUSCLE_LABEL) as Muscle[];

export function ExerciseLibrary({ go }: { go: (r: string) => void }) {
  const exMap = useExerciseMap();
  const plan = usePlan();
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const s of await db.sets.toArray()) if (!s.isWarmup) m.set(s.exerciseId, (m.get(s.exerciseId) ?? 0) + 1);
    return m;
  });
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<MuscleGroup | 'all'>('all');
  const [edit, setEdit] = useState<Exercise | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!exMap || !plan || !counts) return null;

  const inPlan = new Set(plan.flatMap((d) => d.exercises.flatMap((e) => [e.exerciseId, ...(e.altIds ?? [])])));
  const list = [...exMap.values()]
    .filter((e) => (showArchived ? e.archived : !e.archived) && (group === 'all' || groupOf(e) === group) && e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <header className="top">
        <button className="btn small" onClick={() => go('plan')}>
          ‹ Plan
        </button>
        <h1>Exercises</h1>
        <button className="btn small primary" onClick={() => setEdit(blank())}>
          + New
        </button>
      </header>
      <input className="txt" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="chips" style={{ marginBottom: 12 }}>
        {(['all', ...ALL_GROUPS] as const).map((g) => (
          <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>
            {g === 'all' ? 'All' : GROUP_LABEL[g].replace(' (all heads)', '')}
          </button>
        ))}
      </div>
      <label className="row" style={{ marginBottom: 8, fontSize: 13 }}>
        <input type="checkbox" checked={showArchived} onChange={(x) => setShowArchived(x.target.checked)} />
        Show hidden exercises
      </label>
      <Card>
        {list.length === 0 && <p className="muted">{showArchived ? 'No hidden exercises.' : 'No exercises match.'}</p>}
        <ul className="list">
          {list.map((e) => (
            <li key={e.id} onClick={() => setEdit(e)} role="button" style={{ cursor: 'pointer' }}>
              <div className="grow">
                <div>
                  {e.name} {e.custom && <span className="pill">custom</span>}
                </div>
                <small>
                  {MUSCLE_LABEL[e.primary]} · {e.equipment} · {e.compound ? 'compound' : 'isolation'}
                  {counts.get(e.id) ? ` · ${counts.get(e.id)} sets logged` : ''}
                </small>
              </div>
              {inPlan.has(e.id) && <span className="pill good">in plan</span>}
            </li>
          ))}
        </ul>
      </Card>
      {edit && (
        <ExerciseForm ex={edit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}

function blank(): Exercise {
  return { id: '', name: '', equipment: '', primary: 'chest', compound: false, increment: 2.5, custom: true };
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

/** Create or edit an exercise. Unused custom exercises can be deleted; ones with history can be hidden. */
export function ExerciseForm({ ex, onClose, onSaved }: { ex: Exercise; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast();
  const [e, setE] = useState<Exercise>(ex);
  const isNew = !ex.id;
  const usage = useLiveQuery(
    async () =>
      ex.id
        ? {
            sets: await db.sets.where('exerciseId').equals(ex.id).count(),
            inPlan: (await db.plan.toArray()).some((d) => d.exercises.some((pe) => pe.exerciseId === ex.id || pe.altIds?.includes(ex.id))),
          }
        : { sets: 0, inPlan: false },
    [ex.id],
  );
  const ok = e.name.trim().length > 1 && e.increment > 0;

  async function save() {
    const id = e.id || `custom-${slug(e.name)}-${Date.now().toString(36)}`;
    const secondary = e.secondary?.filter((m) => m !== e.primary);
    await db.exercises.put({ ...e, id, name: e.name.trim(), secondary: secondary?.length ? secondary : undefined });
    toast(isNew ? `${e.name.trim()} added` : 'Exercise saved');
    onSaved?.(id);
    onClose();
  }

  const toggleSecondary = (m: Muscle) => {
    const cur = e.secondary ?? [];
    setE({ ...e, secondary: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] });
  };

  return (
    <Sheet open onClose={onClose} title={isNew ? 'New exercise' : e.name}>
      <Field label="Name">
        <input value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} placeholder="e.g. Pec deck (single arm)" />
      </Field>
      <div className="grid2" style={{ marginTop: 6 }}>
        <Field label="Equipment">
          <input value={e.equipment} onChange={(x) => setE({ ...e, equipment: x.target.value })} placeholder="Cable, machine…" />
        </Field>
        <Field label="Load step (kg)" hint="used by the progression engine">
          <NumInput value={e.increment} step={0.25} onChange={(v) => setE({ ...e, increment: v === '' ? 0 : v })} />
        </Field>
      </div>
      <Field label={`Target muscle · counts toward ${GROUP_LABEL[MUSCLE_GROUP[e.primary]]}`}>
        <select value={e.primary} onChange={(x) => setE({ ...e, primary: x.target.value as Muscle })}>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>
              {MUSCLE_LABEL[m]}
            </option>
          ))}
        </select>
      </Field>
      <div className="field" style={{ marginTop: 6 }}>
        <span>Secondary muscles (info only)</span>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {MUSCLES.filter((m) => m !== e.primary).map((m) => (
            <button key={m} className={`chip ${(e.secondary ?? []).includes(m) ? 'on' : ''}`} style={{ minHeight: 32 }} onClick={() => toggleSecondary(m)}>
              {MUSCLE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <label className="row" style={{ margin: '8px 0' }}>
        <input type="checkbox" checked={e.compound} onChange={(x) => setE({ ...e, compound: x.target.checked })} />
        Compound (longer rest, counts as ~3.5 min/set in carry-over caps)
      </label>
      <Field label="Form cues and notes">
        <textarea rows={3} value={e.cues ?? ''} onChange={(x) => setE({ ...e, cues: x.target.value || undefined })} placeholder="Setup, range of motion, what to feel" />
      </Field>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary grow" disabled={!ok} onClick={save}>
          Save
        </button>
        {!isNew && usage && !usage.inPlan && e.custom && usage.sets === 0 && (
          <button
            className="btn danger"
            onClick={async () => {
              if (confirm(`Delete ${e.name}?`)) {
                await db.exercises.delete(e.id);
                toast('Exercise deleted');
                onClose();
              }
            }}
          >
            Delete
          </button>
        )}
        {!isNew && usage && !usage.inPlan && (usage.sets > 0 || !e.custom || ex.archived) && (
          <button
            className="btn"
            onClick={async () => {
              await db.exercises.update(e.id, { archived: !ex.archived });
              toast(ex.archived ? 'Exercise restored' : 'Exercise hidden');
              onClose();
            }}
          >
            {ex.archived ? 'Restore' : 'Hide'}
          </button>
        )}
      </div>
      {!isNew && usage?.inPlan && <p className="fineprint">It is in your weekly plan; remove it from the plan to delete or hide it.</p>}
      {!isNew && usage && !usage.inPlan && usage.sets > 0 && !ex.archived && (
        <p className="fineprint">It has {usage.sets} logged set(s), so it can be hidden (history kept) but not deleted.</p>
      )}
    </Sheet>
  );
}

/** Searchable exercise chooser. Plan variants first, then the same muscle group, then the rest. */
export function ExercisePicker({
  open,
  onClose,
  exMap,
  onPick,
  preferIds = [],
  group,
}: {
  open: boolean;
  onClose: () => void;
  exMap: Map<string, Exercise>;
  onPick: (id: string) => void;
  preferIds?: string[];
  group?: MuscleGroup;
}) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const list = useMemo(() => {
    const all = [...exMap.values()].filter((e) => !e.archived && e.name.toLowerCase().includes(q.toLowerCase()));
    const rank = (e: Exercise) => (preferIds.includes(e.id) ? 0 : group && groupOf(e) === group ? 1 : 2);
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [exMap, q, preferIds, group]);
  if (creating) {
    return <ExerciseForm ex={{ ...blank(), name: q }} onClose={() => setCreating(false)} onSaved={(id) => onPick(id)} />;
  }
  if (editing) return <ExerciseForm ex={editing} onClose={() => setEditing(null)} />;
  return (
    <Sheet open={open} onClose={onClose} title="Choose exercise">
      <div className="row">
        <input className="txt" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => setCreating(true)}>
          New
        </button>
      </div>
      <ul className="list">
        {list.map((e) => (
          <li key={e.id} onClick={() => onPick(e.id)} role="button" style={{ cursor: 'pointer' }}>
            <div className="grow">
              <div>{e.name}</div>
              <small>
                {MUSCLE_LABEL[e.primary]} · {e.equipment}
              </small>
            </div>
            {preferIds.includes(e.id) ? <span className="pill good">plan variant</span> : group && groupOf(e) === group ? <span className="pill">same muscle</span> : null}
            <button
              className="btn small ghost"
              onClick={(x) => {
                x.stopPropagation();
                setEditing(e);
              }}
              aria-label={`Edit ${e.name}`}
            >
              ✎
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
