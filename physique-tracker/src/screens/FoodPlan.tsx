import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Bar, Card, Field, NumInput, Sheet, useToast } from '../components/ui';
import { db } from '../db';
import { useDayTargets } from '../hooks-food';
import { useSettings } from '../hooks';
import { addDays, fmtDate, isoWeekday, WEEKDAY_SHORT } from '../lib/dates';
import { datesBetween, sumFood } from '../lib/nutrition';
import { MEAL_SLOTS, type DateKey, type Food, type FoodPlanItem, type MealSlot } from '../lib/types';
import { FoodPicker } from './Food';

const scaled = (f: Food, qty: number) => ({
  name: qty === 1 ? f.name : `${f.name} ×${qty}`,
  kcal: Math.round(f.kcal * qty),
  p: Math.round(f.p * qty * 10) / 10,
  c: Math.round(f.c * qty * 10) / 10,
  f: Math.round(f.f * qty * 10) / 10,
  fiber: f.fiber ? Math.round(f.fiber * qty * 10) / 10 : undefined,
  costInr: f.costInr ? f.costInr * qty : undefined,
});

/** Log a planned item as eaten (or undo it). */
export async function togglePlannedEaten(item: FoodPlanItem) {
  if (item.loggedId) {
    await db.foodlog.delete(item.loggedId);
    await db.foodplan.update(item.id!, { loggedId: undefined });
    return;
  }
  const { id: _id, slot: _s, loggedId: _l, date, ...food } = item;
  const loggedId = await db.foodlog.add({ ...food, date });
  await db.foodplan.update(item.id!, { loggedId });
}

/** Plan meals for any date ahead of time; copy a day's plan to other dates. */
export function FoodPlan({ today }: { today: DateKey }) {
  const [date, setDate] = useState(addDays(today, 1));
  const toast = useToast();
  const settings = useSettings();
  const targets = useDayTargets(date);
  const items = useLiveQuery(() => db.foodplan.where('date').equals(date).toArray(), [date]);
  const strip = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const stripTotals = useLiveQuery(async () => {
    const rows = await db.foodplan.where('date').between(strip[0], strip[13], true, true).toArray();
    const m = new Map<DateKey, number>();
    for (const r of rows) m.set(r.date, (m.get(r.date) ?? 0) + r.kcal);
    return m;
  }, [today]);
  const foods = useLiveQuery(() => db.foods.orderBy('name').toArray());
  const meals = useLiveQuery(() => db.meals.toArray());
  const [addSlot, setAddSlot] = useState<MealSlot | null>(null);
  const [quickSlot, setQuickSlot] = useState<MealSlot | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  if (!items || !foods || !meals || !settings || targets === undefined || !stripTotals) return null;
  const t = sumFood(items);

  async function addFood(slot: MealSlot, f: Food, qty: number) {
    await db.foodplan.add({ date, slot, ...scaled(f, qty) });
  }
  async function addMeal(slot: MealSlot, mealId: string) {
    const m = meals!.find((x) => x.id === mealId);
    if (!m) return;
    for (const it of m.items) {
      const f = foods!.find((x) => x.id === it.foodId);
      if (f) await addFood(slot, f, it.qty);
    }
    toast(`${m.name} planned`);
  }

  return (
    <>
      <div className="chips" style={{ marginBottom: 8 }} aria-label="Plan date">
        {strip.map((d) => (
          <button key={d} className={`chip ${d === date ? 'on' : ''}`} onClick={() => setDate(d)} style={{ flexDirection: 'column', minHeight: 50, gap: 0 }}>
            <span style={{ fontSize: 11 }}>{d === today ? 'Today' : WEEKDAY_SHORT[isoWeekday(d)]}</span>
            <span>{Number(d.slice(8))}</span>
            {stripTotals.get(d) ? <span className="dot" style={{ background: d === date ? 'currentColor' : 'var(--accent)' }} /> : null}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted">Any date:</span>
        <input className="txt" type="date" value={date} min={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Plan date" />
      </div>

      <Card
        title={fmtDate(date, { weekday: 'long', day: 'numeric', month: 'short' })}
        right={targets?.label ? <span className="pill warn">{targets.label}</span> : undefined}
      >
        {targets ? (
          <div className="stack">
            {(
              [
                ['kcal', t.kcal, targets.kcal, ''],
                ['Protein', t.p, targets.p, 'g'],
                ['Carbs', t.c, targets.c, 'g'],
                ['Fat', t.f, targets.f, 'g'],
              ] as const
            ).map(([label, v, max, u]) => (
              <div key={label}>
                <div className="row between">
                  <small>{label}</small>
                  <small className="mono" style={{ color: label === 'kcal' && v > max * 1.05 ? 'var(--warn)' : undefined }}>
                    {Math.round(v)} / {max}
                    {u}
                  </small>
                </div>
                <Bar value={v} max={max} color="var(--accent2)" />
              </div>
            ))}
            <small>
              Planned spend ₹{Math.round(t.cost)} · budget ₹{settings.foodBudgetMinInr}–{settings.foodBudgetInr}
              {t.cost > settings.foodBudgetInr && <span className="pill warn" style={{ marginLeft: 6 }}>over budget</span>}
            </small>
          </div>
        ) : (
          <p className="muted">No phase covers this date.</p>
        )}
      </Card>

      {MEAL_SLOTS.map((s) => {
        const rows = items.filter((i) => i.slot === s.id);
        const st = sumFood(rows);
        return (
          <Card key={s.id} title={s.label} right={rows.length ? <small className="mono">{Math.round(st.kcal)} kcal · P {Math.round(st.p)}</small> : undefined}>
            {rows.length > 0 && (
              <ul className="list">
                {rows.map((r) => (
                  <li key={r.id}>
                    {date <= today && (
                      <button
                        className={`check ${r.loggedId ? 'done' : ''}`}
                        style={{ minHeight: 36, width: 40 }}
                        onClick={() => togglePlannedEaten(r)}
                        aria-label={r.loggedId ? `Un-log ${r.name}` : `Log ${r.name} as eaten`}
                      >
                        ✓
                      </button>
                    )}
                    <div className="grow">
                      <div>{r.name}</div>
                      <small>
                        {r.kcal} kcal · P {r.p} · C {r.c} · F {r.f}
                      </small>
                    </div>
                    <button className="btn small ghost" onClick={() => db.foodplan.delete(r.id!)} aria-label={`Remove ${r.name}`}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row wrap" style={{ marginTop: rows.length ? 8 : 0 }}>
              <button className="btn small" onClick={() => setAddSlot(s.id)}>
                + Food
              </button>
              <select className="txt" style={{ minHeight: 36, maxWidth: 170 }} value="" onChange={(e) => e.target.value && addMeal(s.id, e.target.value)} aria-label={`Add meal template to ${s.label}`}>
                <option value="">+ Meal template…</option>
                {meals.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn small ghost" onClick={() => setQuickSlot(s.id)}>
                Quick add
              </button>
            </div>
          </Card>
        );
      })}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn grow" disabled={!items.length} onClick={() => setCopyOpen(true)}>
          Copy this day to…
        </button>
        <button
          className="btn danger"
          disabled={!items.length}
          onClick={async () => confirm(`Clear the plan for ${fmtDate(date)}?`) && db.foodplan.bulkDelete(items.map((i) => i.id!))}
        >
          Clear
        </button>
      </div>

      <Sheet open={!!addSlot} onClose={() => setAddSlot(null)} title={`Plan ${MEAL_SLOTS.find((s) => s.id === addSlot)?.label ?? ''}`}>
        <FoodPicker
          foods={foods}
          onAdd={async (f, q) => {
            await addFood(addSlot!, f, q);
            toast(`${f.name} planned`);
          }}
          onNew={() => toast('Add new foods from the Log tab')}
        />
      </Sheet>
      <QuickAdd slot={quickSlot} onClose={() => setQuickSlot(null)} onAdd={(row) => db.foodplan.add({ date, slot: quickSlot!, ...row })} />
      <CopySheet open={copyOpen} onClose={() => setCopyOpen(false)} from={date} items={items} today={today} />
    </>
  );
}

function QuickAdd({ slot, onClose, onAdd }: { slot: MealSlot | null; onClose: () => void; onAdd: (r: { name: string; kcal: number; p: number; c: number; f: number }) => Promise<unknown> }) {
  const [q, setQ] = useState({ name: '', kcal: '' as number | '', p: '' as number | '', c: '' as number | '', f: '' as number | '' });
  return (
    <Sheet open={!!slot} onClose={onClose} title="Quick add to plan">
      <Field label="Name">
        <input value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} placeholder="e.g. canteen thali" />
      </Field>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 6 }}>
        {(['kcal', 'p', 'c', 'f'] as const).map((k) => (
          <Field key={k} label={k === 'kcal' ? 'kcal' : `${k.toUpperCase()} g`}>
            <NumInput value={q[k]} onChange={(v) => setQ({ ...q, [k]: v })} />
          </Field>
        ))}
      </div>
      <button
        className="btn primary block"
        style={{ marginTop: 8 }}
        disabled={q.kcal === ''}
        onClick={async () => {
          await onAdd({ name: q.name || 'Quick add', kcal: Number(q.kcal), p: Number(q.p || 0), c: Number(q.c || 0), f: Number(q.f || 0) });
          setQ({ name: '', kcal: '', p: '', c: '', f: '' });
          onClose();
        }}
      >
        Add
      </button>
    </Sheet>
  );
}

function CopySheet({ open, onClose, from, items, today }: { open: boolean; onClose: () => void; from: DateKey; items: FoodPlanItem[]; today: DateKey }) {
  const toast = useToast();
  const [start, setStart] = useState(addDays(from, 1));
  const [end, setEnd] = useState(addDays(from, 7));
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [replace, setReplace] = useState(true);
  const targets = datesBetween(start, end, days).filter((d) => d !== from);

  async function copy() {
    await db.transaction('rw', db.foodplan, async () => {
      for (const d of targets) {
        if (replace) {
          const old = await db.foodplan.where('date').equals(d).toArray();
          await db.foodplan.bulkDelete(old.filter((o) => !o.loggedId).map((o) => o.id!));
        }
        await db.foodplan.bulkAdd(items.map(({ id: _i, loggedId: _l, ...r }) => ({ ...r, date: d })));
      }
    });
    toast(`Copied to ${targets.length} day(s)`);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Copy ${fmtDate(from)}'s plan`}>
      <div className="grid2">
        <Field label="From">
          <input type="date" value={start} min={today} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="chips" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
          <button key={wd} className={`chip ${days.includes(wd) ? 'on' : ''}`} onClick={() => setDays((cur) => (cur.includes(wd) ? cur.filter((x) => x !== wd) : [...cur, wd]))}>
            {WEEKDAY_SHORT[wd]}
          </button>
        ))}
      </div>
      <label className="row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Replace what is already planned on those dates (eaten items are kept)
      </label>
      <p className="fineprint">
        {targets.length ? `${targets.length} date(s): ${targets.slice(0, 6).map((d) => fmtDate(d)).join(', ')}${targets.length > 6 ? '…' : ''}` : 'No dates selected.'}
      </p>
      <button className="btn primary block" disabled={!targets.length} onClick={copy}>
        Copy {items.length} item(s)
      </button>
    </Sheet>
  );
}
