import { useRef, useState } from 'react';
import { AccountCard } from '../components/AccountCard';
import { AppLockCard, RemindersCard } from '../components/ReminderLockCards';
import { Card, Field, NumInput, useToast } from '../components/ui';
import { TABLES, download, exportAll, exportCsv, importAll, saveSettings, type TableName } from '../db';
import { useSettings } from '../hooks';
import { todayKey } from '../lib/dates';
import type { Settings } from '../lib/types';

export function SettingsScreen() {
  const s = useSettings();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvTable, setCsvTable] = useState<TableName>('sets');
  const [theme, setTheme] = useState(localStorage.getItem('theme') ?? 'dark');
  if (!s) return null;

  const num = (k: keyof Settings, label: string, step = 1, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumInput value={s[k] as number} step={step} onChange={(v) => v !== '' && saveSettings({ [k]: v })} />
    </Field>
  );

  return (
    <>
      <header className="top">
        <h1>Settings</h1>
      </header>

      <AccountCard />

      <Card title="Backup and export">
        <p className="fineprint" style={{ marginTop: 0 }}>
          Everything lives on this device only. Back up regularly: clearing browser data deletes it.
        </p>
        <div className="grid2">
          <button className="btn" onClick={async () => download(`physique-backup-${todayKey()}.json`, await exportAll(false))}>
            Backup (no media)
          </button>
          <button className="btn" onClick={async () => download(`physique-full-backup-${todayKey()}.json`, await exportAll(true))}>
            Full backup
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select className="txt" value={csvTable} onChange={(e) => setCsvTable(e.target.value as TableName)} aria-label="Table">
            {TABLES.filter((t) => t !== 'kv').map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="btn" onClick={async () => download(`${csvTable}-${todayKey()}.csv`, await exportCsv(csvTable), 'text/csv')}>
            CSV
          </button>
        </div>
        <button className="btn block warn" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>
          Restore from backup…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (!confirm('Restoring replaces ALL data on this device with the backup. Continue?')) return;
            try {
              await importAll(await f.text());
              toast('Backup restored');
            } catch (err) {
              toast(`Restore failed: ${(err as Error).message}`);
            }
          }}
        />
      </Card>

      <RemindersCard />

      <AppLockCard />

      <Card title="Profile">
        <div className="grid2">
          {num('heightCm', 'Height cm', 0.5)}
          {num('birthYear', 'Birth year')}
          {num('trendAlpha', 'Trend smoothing α', 0.01, '0.1-0.15; higher reacts faster')}
          {num('maintenanceKcal', 'Maintenance kcal (diet breaks)', 50)}
          {num('foodBudgetMinInr', 'Food budget min ₹/day', 10)}
          {num('foodBudgetInr', 'Food budget max ₹/day', 10)}
        </div>
      </Card>

      <Card title="Training">
        <div className="grid2">
          {num('restCompoundSec', 'Rest, compounds (s)', 15)}
          {num('restIsolationSec', 'Rest, isolation (s)', 15)}
          {num('carryMaxSets', 'Carry-over max sets')}
          {num('carryMaxMin', 'Carry-over max min')}
          {num('carrySetsPerExercise', 'Carry-over sets each')}
          {num('rescueMaxMin', 'Rescue max min', 5)}
        </div>
        <label className="row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={s.keepAwake} onChange={(e) => saveSettings({ keepAwake: e.target.checked })} />
          Keep screen awake during workouts
        </label>
      </Card>

      <Card title="Treadmill">
        <div className="grid3">
          <Field label="Preset min">
            <NumInput value={s.treadmillPreset.minutes} step={5} onChange={(v) => v !== '' && saveSettings({ treadmillPreset: { ...s.treadmillPreset, minutes: v } })} />
          </Field>
          <Field label="km/h">
            <NumInput value={s.treadmillPreset.speedKmh} step={0.1} onChange={(v) => v !== '' && saveSettings({ treadmillPreset: { ...s.treadmillPreset, speedKmh: v } })} />
          </Field>
          <Field label="Incline %">
            <NumInput value={s.treadmillPreset.inclinePct} step={0.5} onChange={(v) => v !== '' && saveSettings({ treadmillPreset: { ...s.treadmillPreset, inclinePct: v } })} />
          </Field>
        </div>
        <div className="grid2" style={{ marginTop: 8 }}>
          {num('treadmillWeeklyMin', 'Weekly target min kcal', 50)}
          {num('treadmillWeeklyMax', 'Weekly target max kcal', 50)}
          {num('treadmillWeeklyCeiling', 'Weekly ceiling kcal', 50)}
          {num('treadmillSessionCapMin', 'Max min per session', 5)}
        </div>
      </Card>

      <Card title="Appearance">
        <div className="chips">
          {['dark', 'light'].map((t) => (
            <button
              key={t}
              className={`chip ${theme === t ? 'on' : ''}`}
              onClick={() => {
                localStorage.setItem('theme', t);
                document.documentElement.dataset.theme = t;
                setTheme(t);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      <Card title="About these numbers">
        <ul className="fineprint" style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            Calories burned, maintenance calories and body-fat figures are <strong>estimates</strong> from standard formulas (Mifflin-St Jeor, ACSM walking equation, US Navy method) and have real error. Weight trend and waist are the main signals.
          </li>
          <li>
            The plan is general fitness coaching guidance from an AI coach, <strong>not medical advice</strong>. Stop and see a clinician for pain, dizziness, or anything concerning.
          </li>
          <li>Exercise-science numbers (volume guideline, deload size, landmarks) are common rules of thumb and vary by person. Edit them to fit you.</li>
          <li>Photos and videos stay on this device and are never uploaded.</li>
        </ul>
      </Card>
    </>
  );
}
