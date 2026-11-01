import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Bar, Card, Estimate, Field, NumInput, Ring, Sheet, fmt, useToast } from '../components/ui';
import { db } from '../db';
import { usePhases, useSettings, useToday } from '../hooks';
import { addDays, fmtDate, isoWeekday, range } from '../lib/dates';
import { useDayTargets, useHighCarbDays } from '../hooks-food';
import { MEAL_SLOTS, type DateKey, type Food as FoodT, type FoodLog } from '../lib/types';
import { FoodPlan, togglePlannedEaten } from './FoodPlan';

export function Food() {
  const today = useToday();
  const [tab, setTab] = useState<'log' | 'plan'>(() => (sessionStorage.getItem('foodTab') === 'plan' ? 'plan' : 'log'));
  const pick = (t: 'log' | 'plan') => {
    setTab(t);
    try {
      sessionStorage.setItem('foodTab', t);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <>
      <div className="chips" style={{ margin: '8px 0 4px' }} role="tablist">
        <button role="tab" aria-selected={tab === 'log'} className={`chip ${tab === 'log' ? 'on' : ''}`} onClick={() => pick('log')}>
          Log
        </button>
        <button role="tab" aria-selected={tab === 'plan'} className={`chip ${tab === 'plan' ? 'on' : ''}`} onClick={() => pick('plan')}>
          Plan ahead
        </button>
      </div>
      {tab === 'plan' ? <FoodPlan today={today} /> : <FoodLogView today={today} />}
    </>
  );
}

function FoodLogView({ today }: { today: DateKey }) {
  const [date, setDate] = useState(today);
  const phases = usePhases();
  const settings = useSettings();
  const toast = useToast();
  const log = useLiveQuery(() => db.foodlog.where('date').equals(date).toArray(), [date]);
  const foods = useLiveQuery(() => db.foods.orderBy('name').toArray());
  const meals = useLiveQuery(() => db.meals.toArray());
  const water = useLiveQuery(() => db.hydration.get(date), [date]);
  const week = useLiveQuery(() => db.foodlog.where('date').between(addDays(today, -6), today, true, true).toArray(), [today]);
  const highCarb = useHighCarbDays();
  const target = useDayTargets(date);
  const planned = useLiveQuery(() => db.foodplan.where('date').equals(date).toArray(), [date]);
  const [quick, setQuick] = useState({ name: '', kcal: '' as number | '', p: '' as number | '', c: '' as number | '', f: '' as number | '' });
  const [pickOpen, setPickOpen] = useState(false);
  const [newFood, setNewFood] = useState<FoodT | null>(null);

  if (!phases || !log || !foods || !meals || !week || !settings || !highCarb || !target || !planned) return null;
  const phase = target.phase!;
  const isHighCarb = highCarb.includes(date);
  const sum = (rows: FoodLog[]) =>
    rows.reduce((s, r) => ({ kcal: s.kcal + r.kcal, p: s.p + r.p, c: s.c + r.c, f: s.f + r.f, fiber: s.fiber + (r.fiber ?? 0), cost: s.cost + (r.costInr ?? 0) }), { kcal: 0, p: 0, c: 0, f: 0, fiber: 0, cost: 0 });
  const t = sum(log);

  // Weekly adherence: logged days within ±10% of kcal and at least 90% of protein.
  const days = range(addDays(today, -6), today);
  const perDay = days.map((d) => sum(week.filter((r) => r.date === d)));
  const logged = perDay.filter((d) => d.kcal > 0);
  const avgKcal = logged.length ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : 0;
  const avgP = logged.length ? logged.reduce((s, d) => s + d.p, 0) / logged.length : 0;
  const onTarget = logged.filter((d) => Math.abs(d.kcal - phase.kcal) <= phase.kcal * 0.1 && d.p >= phase.protein * 0.9).length;

  async function addFood(f: FoodT, qty = 1) {
    await db.foodlog.add({
      date,
      name: qty === 1 ? f.name : `${f.name} ×${qty}`,
      kcal: Math.round(f.kcal * qty),
      p: Math.round(f.p * qty * 10) / 10,
      c: Math.round(f.c * qty * 10) / 10,
      f: Math.round(f.f * qty * 10) / 10,
      fiber: f.fiber ? Math.round(f.fiber * qty * 10) / 10 : undefined,
      costInr: f.costInr ? f.costInr * qty : undefined,
    });
  }

  async function addMeal(id: string) {
    const m = meals!.find((x) => x.id === id);
    if (!m) return;
    for (const it of m.items) {
      const f = foods!.find((x) => x.id === it.foodId);
      if (f) await addFood(f, it.qty);
    }
    toast(`${m.name} added`);
  }

  return (
    <>
      <header className="top">
        <button className="btn small" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          ‹
        </button>
        <div className="center">
          <h1>{date === today ? 'Today' : fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}</h1>
          <div className="sub">
            {phase.name} targets <Estimate />
            {target.label && <span className="pill warn" style={{ marginLeft: 6 }}>{target.label}</span>}
          </div>
        </div>
        <button className="btn small" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
          ›
        </button>
      </header>

      <Card>
        <div className="rings">
          <div>
            <Ring value={t.kcal} max={target.kcal} label={Math.round(t.kcal)} sub={`/ ${target.kcal}`} color="var(--accent2)" size={96} />
            kcal · {Math.max(0, Math.round(target.kcal - t.kcal))} left
          </div>
          <div>
            <Ring value={t.p} max={target.p} label={`${Math.round(t.p)}g`} sub={`/ ${target.p}g`} size={96} />
            protein
          </div>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {(
            [
              ['Carbs', t.c, target.c, 'g'],
              ['Fat', t.f, target.f, 'g'],
              ['Fiber', t.fiber, target.fiber, 'g'],
            ] as const
          ).map(([label, v, max, u]) => (
            <div key={label}>
              <div className="row between">
                <small>{label}</small>
                <small className="mono">
                  {Math.round(v)} / {max}
                  {u}
                </small>
              </div>
              <Bar value={v} max={max} color={label === 'Fat' && v < 50 && t.kcal > target.kcal * 0.8 ? 'var(--warn)' : 'var(--accent2)'} />
            </div>
          ))}
        </div>
        <div className="row between" style={{ marginTop: 12 }}>
          <span>
            💧 {((water?.ml ?? 0) / 1000).toFixed(2)} / {phase.waterL} L
          </span>
          <div className="row">
            <button className="btn small" onClick={() => db.hydration.put({ date, ml: Math.max(0, (water?.ml ?? 0) - 250) })}>
              −
            </button>
            <button className="btn small" onClick={() => db.hydration.put({ date, ml: (water?.ml ?? 0) + 250 })}>
              +250 ml
            </button>
          </div>
        </div>
        <div className="row between" style={{ marginTop: 8 }}>
          <small>
            Spend ₹{Math.round(t.cost)} · budget ₹{settings.foodBudgetMinInr}–{settings.foodBudgetInr}
          </small>
          <label className="row" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={isHighCarb}
              onChange={async (e) =>
                db.kv.put({ key: 'highCarbDays', value: e.target.checked ? [...highCarb, date] : highCarb.filter((d) => d !== date) })
              }
            />
            High-carb day (~{phase.kcal + 300})
          </label>
        </div>
      </Card>

      {planned.length > 0 && (
        <Card title="Planned for this day" right={<small className="mono">{planned.filter((p) => p.loggedId).length}/{planned.length} eaten</small>}>
          <ul className="list">
            {planned.map((p) => (
              <li key={p.id}>
                <button className={`check ${p.loggedId ? 'done' : ''}`} style={{ minHeight: 36, width: 40 }} onClick={() => togglePlannedEaten(p)} aria-label={p.loggedId ? `Un-log ${p.name}` : `Log ${p.name} as eaten`}>
                  ✓
                </button>
                <div className="grow">
                  <div>{p.name}</div>
                  <small>
                    {MEAL_SLOTS.find((s) => s.id === p.slot)?.label} · {p.kcal} kcal · P {p.p}
                  </small>
                </div>
              </li>
            ))}
          </ul>
          {planned.some((p) => !p.loggedId) && (
            <button
              className="btn block"
              style={{ marginTop: 8 }}
              onClick={async () => {
                for (const p of planned.filter((x) => !x.loggedId)) await togglePlannedEaten(p);
                toast('Plan logged');
              }}
            >
              Log all remaining as eaten
            </button>
          )}
        </Card>
      )}

      <Card title="Add">
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <button className="btn primary grow" onClick={() => setPickOpen(true)}>
            Saved foods
          </button>
          <select className="txt grow" value="" onChange={(e) => e.target.value && addMeal(e.target.value)} aria-label="Add meal template">
            <option value="">Meal template…</option>
            {meals.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <details>
          <summary className="muted">Quick add (kcal and macros)</summary>
          <Field label="Name">
            <input value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} placeholder="e.g. canteen thali" />
          </Field>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 6 }}>
            {(['kcal', 'p', 'c', 'f'] as const).map((k) => (
              <Field key={k} label={k === 'kcal' ? 'kcal' : `${k.toUpperCase()} g`}>
                <NumInput value={quick[k]} onChange={(v) => setQuick({ ...quick, [k]: v })} />
              </Field>
            ))}
          </div>
          <button
            className="btn block"
            style={{ marginTop: 8 }}
            disabled={quick.kcal === ''}
            onClick={async () => {
              await db.foodlog.add({ date, name: quick.name || 'Quick add', kcal: Number(quick.kcal), p: Number(quick.p || 0), c: Number(quick.c || 0), f: Number(quick.f || 0) });
              setQuick({ name: '', kcal: '', p: '', c: '', f: '' });
            }}
          >
            Add
          </button>
        </details>
      </Card>

      <Card title="Logged">
        {log.length === 0 ? (
          <p className="muted">Nothing logged.</p>
        ) : (
          <ul className="list">
            {log.map((r) => (
              <li key={r.id}>
                <div className="grow">
                  <div>{r.name}</div>
                  <small>
                    P {fmt(r.p)} · C {fmt(r.c)} · F {fmt(r.f)}
                  </small>
                </div>
                <strong className="mono">{r.kcal}</strong>
                <button className="btn small ghost" onClick={() => db.foodlog.delete(r.id!)} aria-label="Remove">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Last 7 days">
        <div className="grid3">
          <div className="stat">
            <b>{Math.round(avgKcal)}</b>
            <span>avg kcal (logged days)</span>
          </div>
          <div className="stat">
            <b>{Math.round(avgP)} g</b>
            <span>avg protein</span>
          </div>
          <div className="stat">
            <b>
              {onTarget}/{logged.length || 0}
            </b>
            <span>days on target</span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8, alignItems: 'flex-end', height: 60, gap: 4 }}>
          {perDay.map((d, i) => (
            <div key={i} className="grow center" title={`${days[i]}: ${Math.round(d.kcal)} kcal`}>
              <div style={{ height: Math.min(50, (d.kcal / phase.kcal) * 40), background: d.kcal ? 'var(--accent2)' : 'var(--line)', borderRadius: 4, minHeight: 3 }} />
              <small>{['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'][isoWeekday(days[i])]}</small>
            </div>
          ))}
        </div>
        <p className="fineprint">
          Logged {logged.length} of 7 days. On target = within 10% of {phase.kcal} kcal and at least 90% of {phase.protein} g protein. Diet break planned 14-20 Dec at about maintenance.
        </p>
      </Card>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Saved foods">
        <FoodPicker
          foods={foods}
          onAdd={async (f, q) => {
            await addFood(f, q);
            toast(`${f.name} added`);
          }}
          onNew={() => setNewFood({ name: '', serving: '1 serving', kcal: 0, p: 0, c: 0, f: 0 })}
        />
      </Sheet>
      <Sheet open={!!newFood} onClose={() => setNewFood(null)} title="New saved food">
        {newFood && (
          <>
            <Field label="Name">
              <input value={newFood.name} onChange={(e) => setNewFood({ ...newFood, name: e.target.value })} />
            </Field>
            <Field label="Serving">
              <input value={newFood.serving} onChange={(e) => setNewFood({ ...newFood, serving: e.target.value })} />
            </Field>
            <div className="grid3" style={{ marginTop: 6 }}>
              {(['kcal', 'p', 'c', 'f', 'fiber', 'costInr'] as const).map((k) => (
                <Field key={k} label={k === 'costInr' ? '₹' : k}>
                  <NumInput value={newFood[k] ?? ''} onChange={(v) => setNewFood({ ...newFood, [k]: v === '' ? undefined : v })} />
                </Field>
              ))}
            </div>
            <button
              className="btn primary block"
              style={{ marginTop: 8 }}
              disabled={!newFood.name}
              onClick={async () => {
                await db.foods.add({ ...newFood, kcal: newFood.kcal || 0 });
                setNewFood(null);
              }}
            >
              Save food
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

export function FoodPicker({ foods, onAdd, onNew }: { foods: FoodT[]; onAdd: (f: FoodT, qty: number) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const list = useMemo(() => foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())), [foods, q]);
  return (
    <>
      <div className="row">
        <input className="txt" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={onNew}>
          New
        </button>
      </div>
      <ul className="list">
        {list.map((f) => (
          <li key={f.id}>
            <div className="grow">
              <div>{f.name}</div>
              <small>
                {f.serving} · {f.kcal} kcal · P {f.p}
              </small>
            </div>
            <select value={qty[f.id!] ?? 1} onChange={(e) => setQty({ ...qty, [f.id!]: Number(e.target.value) })} className="txt" style={{ width: 70, minHeight: 36 }} aria-label="Quantity">
              {[0.5, 1, 1.5, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  ×{n}
                </option>
              ))}
            </select>
            <button className="btn small primary" onClick={() => onAdd(f, qty[f.id!] ?? 1)} aria-label={`Add ${f.name}`}>
              +
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
