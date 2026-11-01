import { useEffect, useState } from 'react';
import { db } from '../db';
import { FALLBACK_WEIGHT_KG } from '../data/seed';
import { useCurrentWeight, useSettings } from '../hooks';
import { treadmillNetKcal, treadmillGrossKcalPerMin } from '../lib/formulas';
import type { DateKey } from '../lib/types';
import { Estimate, Field, NumInput, Sheet, useToast } from './ui';

export function TreadmillSheet({ open, onClose, date, minutes }: { open: boolean; onClose: () => void; date: DateKey; minutes?: number }) {
  const s = useSettings();
  const weight = useCurrentWeight() ?? FALLBACK_WEIGHT_KG;
  const toast = useToast();
  const [min, setMin] = useState<number | ''>(40);
  const [speed, setSpeed] = useState<number | ''>(5.5);
  const [incline, setIncline] = useState<number | ''>(10);
  const [machine, setMachine] = useState<number | ''>('');

  useEffect(() => {
    if (!open || !s) return;
    setMin(minutes || s.treadmillPreset.minutes);
    setSpeed(s.treadmillPreset.speedKmh);
    setIncline(s.treadmillPreset.inclinePct);
    setMachine('');
  }, [open, s, minutes]);

  const ok = min !== '' && speed !== '' && incline !== '' && min > 0;
  const net = ok ? treadmillNetKcal(min, speed, incline, weight) : 0;
  const gross = ok ? treadmillGrossKcalPerMin(speed, incline, weight) * min : 0;
  const diffPct = machine !== '' && machine > 0 && net > 0 ? ((machine - net) / net) * 100 : null;

  async function save() {
    if (!ok) return;
    await db.treadmill.add({
      date,
      minutes: min,
      speedKmh: speed,
      inclinePct: incline,
      weightKg: Math.round(weight * 10) / 10,
      machineKcal: machine === '' ? undefined : machine,
      netKcal: Math.round(net),
    });
    toast(`Treadmill logged: ${Math.round(net)} net kcal`);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log treadmill">
      <div className="chips" style={{ marginBottom: 10 }} aria-label="Presets">
        {[30, 40, 45, 50, 60].map((m) => (
          <button
            key={m}
            className={`chip ${min === m && speed === s?.treadmillPreset.speedKmh && incline === s?.treadmillPreset.inclinePct ? 'on' : ''}`}
            onClick={() => {
              setMin(m);
              setSpeed(s?.treadmillPreset.speedKmh ?? 5.5);
              setIncline(s?.treadmillPreset.inclinePct ?? 10);
            }}
          >
            {m} min
          </button>
        ))}
      </div>
      <div className="grid3">
        <Field label="Minutes">
          <NumInput value={min} onChange={setMin} step={5} />
        </Field>
        <Field label="Speed km/h">
          <NumInput value={speed} onChange={setSpeed} step={0.1} />
        </Field>
        <Field label="Incline %">
          <NumInput value={incline} onChange={setIncline} step={0.5} />
        </Field>
      </div>
      <div className="stat" style={{ margin: '12px 0' }}>
        <b>
          {Math.round(net)} kcal net <Estimate />
        </b>
        <span>
          ACSM walking equation at {weight.toFixed(1)} kg (gross {Math.round(gross)}). Valid for walking up to about 6 km/h; ±15-20%.
          {speed !== '' && speed > 6.5 && ' Above walking speed this underestimates.'}
        </span>
      </div>
      <Field label="Machine-shown kcal (optional)" hint={diffPct !== null ? `Machine shows ${diffPct > 0 ? '+' : ''}${Math.round(diffPct)}% vs net estimate. Machines usually overstate by 15-30% (they count gross).` : 'Only for comparison. The app always uses its own net estimate.'}>
        <NumInput value={machine} onChange={setMachine} />
      </Field>
      <p className="fineprint">Do not eat back burned calories.</p>
      <button className="btn primary block" disabled={!ok} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}
