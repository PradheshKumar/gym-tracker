import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { LineChart } from '../components/Chart';
import { Bar, Card, Estimate, Field, NumInput, fmt, useToast } from '../components/ui';
import { db } from '../db';
import { measId, navyBfId } from '../lib/ids';
import { MEASUREMENT_SITES } from '../data/seed';
import { useExerciseMap, usePhases, useSettings, useToday, useTrend } from '../hooks';
import { addDays, diffDays, fmtDate } from '../lib/dates';
import { navyBodyFatMale, rateOver, sevenDayAvgTrend, weeklyRate } from '../lib/formulas';
import { currentPhase } from '../lib/rules';
import type { DateKey, Goal, Measurement } from '../lib/types';

const TABS = [
  ['weight', 'Weight'],
  ['measure', 'Measurements'],
  ['goals', 'Goals'],
] as const;

export function Body({ tab = 'weight', go }: { tab?: string; go: (r: string) => void }) {
  return (
    <>
      <header className="top">
        <h1>Body</h1>
      </header>
      <div className="chips" style={{ marginBottom: 12 }}>
        {TABS.map(([id, label]) => (
          <button key={id} className={`chip ${tab === id ? 'on' : ''}`} onClick={() => go(`body/${id}`)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'measure' ? <Measurements /> : tab === 'goals' ? <Goals /> : <Weight />}
    </>
  );
}

function Weight() {
  const today = useToday();
  const trend = useTrend();
  const phases = usePhases();
  const weighins = useLiveQuery(() => db.weighins.orderBy('date').reverse().toArray());
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState<number | ''>('');
  const [range, setRange] = useState(90);
  if (!trend || !phases || !weighins) return null;
  const phase = currentPhase(phases, today);
  const cur = trend[trend.length - 1];
  const avg7 = sevenDayAvgTrend(trend, today);
  const rate = weeklyRate(trend, today);
  const rate14 = rateOver(trend, today, 14);
  const from = addDays(today, -range);
  const shown = trend.filter((p) => p.date >= from);
  const inBand = rate !== null && phase?.rateMin !== undefined && phase.rateMax !== undefined && rate >= phase.rateMin && rate <= phase.rateMax;

  return (
    <>
      <Card title="Log weight">
        <div className="row">
          <input className="txt" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} aria-label="Date" />
          <NumInput value={kg} onChange={setKg} step={0.1} placeholder="kg" ariaLabel="Weight kg" />
          <button
            className="btn primary"
            disabled={kg === '' || kg < 30}
            onClick={async () => {
              if (kg === '') return;
              await db.weighins.put({ date, kg, fasted: true });
              setKg('');
            }}
          >
            Save
          </button>
        </div>
        <p className="fineprint">Morning, fasted, after the toilet, before food or water. Daily noise of ±1 kg is normal; the trend is what matters.</p>
      </Card>

      <div className="grid3" style={{ marginBottom: 12 }}>
        <div className="stat">
          <b>{fmt(cur?.trend, 2)}</b>
          <span>trend kg</span>
        </div>
        <div className="stat">
          <b>{fmt(avg7, 2)}</b>
          <span>7-day avg</span>
        </div>
        <div className="stat">
          <b className={rate === null ? '' : inBand ? 'good' : ''} style={{ color: rate === null ? undefined : inBand ? 'var(--accent)' : 'var(--warn)' }}>
            {rate === null ? '–' : `${rate > 0 ? '+' : ''}${rate.toFixed(2)}`}
          </b>
          <span>kg/week{cur && rate !== null ? ` (${((rate / cur.trend) * 100).toFixed(1)}%)` : ''}</span>
        </div>
      </div>
      {phase?.rateMin !== undefined && (
        <p className="fineprint" style={{ marginTop: -4 }}>
          {phase.name} target: {Math.abs(phase.rateMax!).toFixed(2)}-{Math.abs(phase.rateMin).toFixed(2)} kg/week {phase.rateMax! < 0 ? 'loss' : 'gain'}.
          {rate14 !== null && ` 2-week rate: ${rate14.toFixed(2)} kg/week.`} Expect a 0.5-1 kg drop in week 1 from water and glycogen.
        </p>
      )}

      <Card
        title="Trend"
        right={
          <div className="chips">
            {[30, 90, 365].map((r) => (
              <button key={r} className={`chip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)} style={{ minHeight: 30 }}>
                {r === 365 ? '1y' : `${r}d`}
              </button>
            ))}
          </div>
        }
      >
        <LineChart
          series={[
            { name: 'Scale', points: shown.filter((p) => p.weight !== undefined).map((p) => ({ x: p.date, y: p.weight! })), color: 'var(--muted)', dots: true, line: false },
            { name: 'Trend', points: shown.map((p) => ({ x: p.date, y: p.trend })), color: 'var(--accent)' },
          ]}
          goals={phase?.targets.weightKg ? [{ y: phase.targets.weightKg, label: `${phase.name} target ${phase.targets.weightKg}` }] : []}
          markers={(phase?.milestones ?? []).filter((m) => m.date <= addDays(today, range)).map((m) => ({ x: m.date, y: m.weightKg, label: 'milestone' }))}
          unit="kg"
        />
        {phase?.milestones && (
          <p className="fineprint">
            Milestones: {phase.milestones.map((m) => `${fmtDate(m.date)} ${m.weightKg} kg / ${m.waistCm} cm`).join(' · ')}
          </p>
        )}
      </Card>

      <Card title="Entries">
        <ul className="list">
          {weighins.slice(0, 30).map((w) => (
            <li key={w.date}>
              <span className="grow">{fmtDate(w.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <strong className="mono">{w.kg} kg</strong>
              <button className="btn small ghost" onClick={() => confirm(`Delete weigh-in for ${w.date}?`) && db.weighins.delete(w.date)} aria-label="Delete">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Measurements() {
  const today = useToday();
  const settings = useSettings();
  const toast = useToast();
  const all = useLiveQuery(() => db.measurements.orderBy('date').toArray());
  const bf = useLiveQuery(() => db.bodyfat.orderBy('date').toArray());
  const weighins = useLiveQuery(() => db.weighins.toArray());
  const custom = useLiveQuery(async () => ((await db.kv.get('customSites'))?.value as string[]) ?? []);
  const [date, setDate] = useState(today);
  const [vals, setVals] = useState<Record<string, number | ''>>({});
  const [newSite, setNewSite] = useState('');
  if (!all || !bf || !settings || !weighins || !custom) return null;

  const sites = [...MEASUREMENT_SITES, ...custom];
  const latest = new Map<string, Measurement>();
  for (const m of all) latest.set(m.site, m);
  const lastDate = all.length ? all[all.length - 1].date : undefined;
  const due = lastDate ? addDays(lastDate, 14) : today;
  const neck = vals['neck'] !== undefined && vals['neck'] !== '' ? vals['neck'] : undefined;
  const waist = vals['waist (navel)'] !== undefined && vals['waist (navel)'] !== '' ? vals['waist (navel)'] : undefined;
  const preview = neck && waist ? navyBodyFatMale(waist, neck, settings.heightCm) : null;

  async function save() {
    const rows = Object.entries(vals).filter(([, v]) => v !== '' && v !== undefined) as [string, number][];
    if (!rows.length) return;
    await db.transaction('rw', db.measurements, db.bodyfat, async () => {
      // One value per site per date.
      const existing = await db.measurements.where('date').equals(date).toArray();
      // Deterministic ids (date + site) so the same measurement from two devices merges.
      await db.measurements.bulkDelete(existing.filter((e) => rows.some(([s]) => s === e.site) && e.id !== measId(date, e.site)).map((e) => e.id!));
      await db.measurements.bulkPut(rows.map(([site, cm]) => ({ id: measId(date, site), date, site, cm })));
      const n = rows.find(([s]) => s === 'neck')?.[1] ?? existing.find((e) => e.site === 'neck')?.cm;
      const w = rows.find(([s]) => s === 'waist (navel)')?.[1] ?? existing.find((e) => e.site === 'waist (navel)')?.cm;
      if (n && w) {
        const v = navyBodyFatMale(w, n, settings!.heightCm);
        if (v !== null) {
          const old = await db.bodyfat.where('date').equals(date).filter((b) => b.method === 'navy').toArray();
          await db.bodyfat.bulkDelete(old.filter((o) => o.id !== navyBfId(date)).map((o) => o.id!));
          await db.bodyfat.put({ id: navyBfId(date), date, method: 'navy', value: Math.round(v * 10) / 10 });
        }
      }
    });
    setVals({});
    toast('Measurements saved');
  }

  const navy = bf.filter((b) => b.method === 'navy');
  const other = bf.filter((b) => b.method !== 'navy');
  const weightOn = (d: DateKey) => {
    const near = weighins.filter((w) => Math.abs(diffDays(w.date, d)) <= 3).sort((a, b) => Math.abs(diffDays(a.date, d)) - Math.abs(diffDays(b.date, d)))[0];
    return near?.kg;
  };
  const lastBf = navy[navy.length - 1];
  const lastW = lastBf ? weightOn(lastBf.date) : undefined;
  const v = (s: string) => latest.get(s)?.cm;
  const ratio = (a?: number, b?: number) => (a && b ? (a / b).toFixed(2) : '–');
  const waistSeries = all.filter((m) => m.site === 'waist (navel)').map((m) => ({ x: m.date, y: m.cm }));

  return (
    <>
      <div className={`banner ${due <= today ? 'warn' : 'info'}`}>
        {due <= today ? 'Measurements are due today.' : `Next measurements: ${fmtDate(due, { weekday: 'short', day: 'numeric', month: 'short' })}`}
        <p>Every 2 weeks, fasted, same tape, relaxed unless noted. Waist at the navel is required for the Navy estimate.</p>
      </div>

      <Card title="Record">
        <input className="txt" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ marginBottom: 8 }} />
        <div className="grid2">
          {sites.map((s) => (
            <Field key={s} label={`${s}${s === 'waist (navel)' || s === 'neck' ? ' *' : ''} (cm)`}>
              <NumInput value={vals[s] ?? ''} onChange={(x) => setVals({ ...vals, [s]: x })} step={0.1} placeholder={v(s) ? String(v(s)) : ''} />
            </Field>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="txt" placeholder="Add custom site (e.g. lower abs)" value={newSite} onChange={(e) => setNewSite(e.target.value)} />
          <button
            className="btn"
            disabled={!newSite.trim() || sites.length >= 35}
            onClick={async () => {
              await db.kv.put({ key: 'customSites', value: [...custom, newSite.trim()] });
              setNewSite('');
            }}
          >
            Add
          </button>
        </div>
        {preview !== null && (
          <p>
            Navy estimate: <strong>{preview.toFixed(1)}%</strong> <Estimate>±3-4%</Estimate>
          </p>
        )}
        <button className="btn primary block" style={{ marginTop: 8 }} onClick={save}>
          Save measurements
        </button>
      </Card>

      <Card title={<>Body fat (US Navy) <Estimate>±3-4%</Estimate></>}>
        <LineChart
          series={[
            { name: 'Navy', points: navy.map((b) => ({ x: b.date, y: b.value })), color: 'var(--accent2)', dots: true },
            ...(other.length ? [{ name: 'Scale / DEXA', points: other.map((b) => ({ x: b.date, y: b.value })), color: 'var(--goal)', dots: true }] : []),
          ]}
          band={navy.map((b) => ({ x: b.date, lo: b.value - 3.5, hi: b.value + 3.5 }))}
          goals={[{ y: 12.5, label: 'Phase 2 ~12-13%' }]}
          unit="%"
        />
        {lastBf && lastW && (
          <div className="grid2" style={{ marginTop: 8 }}>
            <div className="stat">
              <b>{((lastW * lastBf.value) / 100).toFixed(1)} kg</b>
              <span>fat mass (indicative)</span>
            </div>
            <div className="stat">
              <b>{(lastW * (1 - lastBf.value / 100)).toFixed(1)} kg</b>
              <span>lean mass (indicative)</span>
            </div>
          </div>
        )}
        <p className="fineprint">The Navy method has real error. Waist and the weight trend are the main signals. Scale or DEXA readings stay a separate series.</p>
      </Card>

      <Card title="Waist">
        <LineChart series={[{ name: 'Waist', points: waistSeries, color: 'var(--accent)', dots: true }]} goals={[{ y: 78, label: 'target 78' }]} unit="cm" />
      </Card>

      <Card title="Ratios and symmetry" right={<small>indicative</small>}>
        <ul className="list">
          <li>
            <span className="grow">Shoulder : waist</span>
            <strong>{ratio(v('shoulders'), v('waist (navel)'))}</strong>
          </li>
          <li>
            <span className="grow">Chest : waist</span>
            <strong>{ratio(v('chest'), v('waist (navel)'))}</strong>
          </li>
          <li>
            <span className="grow">Arm L / R (flexed)</span>
            <strong>
              {fmt(v('upper arm L flexed'))} / {fmt(v('upper arm R flexed'))}
            </strong>
          </li>
          <li>
            <span className="grow">Calf L / R</span>
            <strong>
              {fmt(v('calf L'))} / {fmt(v('calf R'))}
            </strong>
          </li>
        </ul>
      </Card>

      <ImportOther />
    </>
  );
}

function ImportOther() {
  const today = useToday();
  const [date, setDate] = useState(today);
  const [val, setVal] = useState<number | ''>('');
  const [method, setMethod] = useState<'scale' | 'dexa'>('scale');
  return (
    <Card title="Other body-fat readings">
      <div className="row wrap">
        <input className="txt" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} aria-label="Date" />
        <select className="txt" value={method} onChange={(e) => setMethod(e.target.value as 'scale' | 'dexa')} style={{ maxWidth: 110 }} aria-label="Method">
          <option value="scale">Scale</option>
          <option value="dexa">DEXA</option>
        </select>
        <div style={{ width: 80 }}>
          <NumInput value={val} onChange={setVal} step={0.1} placeholder="%" />
        </div>
        <button className="btn" disabled={val === ''} onClick={async () => { if (val !== '') { await db.bodyfat.add({ date, method, value: val }); setVal(''); } }}>
          Add
        </button>
      </div>
    </Card>
  );
}

function Goals() {
  const today = useToday();
  const trend = useTrend();
  const exMap = useExerciseMap();
  const goals = useLiveQuery(() => db.goals.toArray());
  const waist = useLiveQuery(() => db.measurements.where('site').equals('waist (navel)').sortBy('date'));
  const bf = useLiveQuery(() => db.bodyfat.toArray());
  const lifts = useLiveQuery(() => db.sets.toArray());
  const [edit, setEdit] = useState<Goal | null>(null);
  if (!trend || !goals || !waist || !bf || !lifts || !exMap) return null;

  const rate = weeklyRate(trend, today);
  const navy = bf.filter((b) => b.method === 'navy').sort((a, b) => a.date.localeCompare(b.date));
  const current = (g: Goal): number | undefined => {
    if (g.metric === 'weight') return trend[trend.length - 1]?.trend;
    if (g.metric === 'waist') return waist[waist.length - 1]?.cm;
    if (g.metric === 'bodyFat') return navy[navy.length - 1]?.value;
    const top = lifts.filter((s) => s.exerciseId === g.exerciseId && !s.isWarmup).map((s) => s.weight);
    return top.length ? Math.max(...top) : undefined;
  };
  const projected = (g: Goal, cur?: number) => {
    if (g.metric !== 'weight' || cur === undefined || rate === null || rate === 0) return null;
    const weeks = (g.target - cur) / rate;
    if (weeks < 0 || weeks > 104) return null;
    return addDays(today, Math.round(weeks * 7));
  };

  return (
    <>
      {goals.map((g) => {
        const cur = current(g);
        const span = g.target - g.start;
        const pct = cur === undefined || span === 0 ? 0 : (cur - g.start) / span;
        const proj = projected(g, cur);
        return (
          <Card key={g.id} title={g.label} right={<button className="btn small ghost" onClick={() => setEdit(g)}>Edit</button>}>
            <div className="row between">
              <small>start {g.start}</small>
              <strong className="mono">{cur === undefined ? '–' : fmt(cur, 1)}</strong>
              <small>target {g.target}</small>
            </div>
            <Bar value={Math.max(0, pct)} max={1} color={pct >= 1 ? 'var(--accent)' : 'var(--accent2)'} />
            <small>
              {Math.round(Math.max(0, pct) * 100)}% of the way
              {proj && ` · at the current rate: ${fmtDate(proj, { day: 'numeric', month: 'short', year: 'numeric' })}`}
              {g.metric === 'lift' && cur === undefined && ' · log a set to start tracking'}
            </small>
          </Card>
        );
      })}
      <button className="btn block" onClick={() => setEdit({ metric: 'lift', exerciseId: 'lat-pulldown', start: 0, target: 0, label: 'New lift goal' })}>
        + Add lift goal
      </button>
      {edit && <GoalEditor goal={edit} exMap={exMap} onClose={() => setEdit(null)} />}
    </>
  );
}

function GoalEditor({ goal, exMap, onClose }: { goal: Goal; exMap: Map<string, { name: string }>; onClose: () => void }) {
  const [g, setG] = useState(goal);
  return (
    <Card title="Edit goal">
      <Field label="Label">
        <input value={g.label} onChange={(e) => setG({ ...g, label: e.target.value })} />
      </Field>
      {g.metric === 'lift' && (
        <Field label="Exercise">
          <select value={g.exerciseId} onChange={(e) => setG({ ...g, exerciseId: e.target.value })}>
            {[...exMap.entries()].map(([id, e]) => (
              <option key={id} value={id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid2">
        <Field label="Start">
          <NumInput value={g.start} onChange={(v) => setG({ ...g, start: v === '' ? 0 : v })} step={0.1} />
        </Field>
        <Field label="Target">
          <NumInput value={g.target} onChange={(v) => setG({ ...g, target: v === '' ? 0 : v })} step={0.1} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary grow" onClick={async () => { await db.goals.put(g); onClose(); }}>
          Save
        </button>
        {g.id && (
          <button className="btn danger" onClick={async () => { await db.goals.delete(g.id!); onClose(); }}>
            Delete
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
