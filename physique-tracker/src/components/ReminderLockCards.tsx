import { useEffect, useState } from 'react';
import { checkPin, clearPin, lockEnabled, lockTimeoutMin, setLockTimeoutMin, setPin } from '../lock';
import type { ReminderConfig } from '../lib/reminders';
import { disablePush, enablePush, pushSupported, pushSubscribed } from '../push';
import { saveReminderConfig, useReminderConfig } from '../reminders';
import { useSyncState } from '../sync/cloud';
import { Card, Field, NumInput, useToast } from './ui';

type TimedKey = 'weighIn' | 'checkIn' | 'workout' | 'food';
type IntervalKey = 'measurements' | 'photos' | 'video';

export function RemindersCard() {
  const c = useReminderConfig();
  const toast = useToast();
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  if (!c) return null;
  const save = (patch: Partial<ReminderConfig>) => saveReminderConfig({ ...c, ...patch });
  const timed: [TimedKey, string][] = [
    ['weighIn', 'Morning weigh-in'],
    ['checkIn', 'Daily check-in'],
    ['workout', 'Workout (training days)'],
    ['food', 'Food log (if nothing logged)'],
  ];
  const interval: [IntervalKey, string][] = [
    ['measurements', 'Measurements every (days)'],
    ['photos', 'Progress photos every (days)'],
    ['video', 'Pose video every (days)'],
  ];
  return (
    <Card title="Reminders">
      <label className="row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
        Reminders on
      </label>
      {timed.map(([k, label]) => (
        <div key={k} className="row" style={{ marginBottom: 6 }}>
          <label className="row grow">
            <input type="checkbox" checked={c[k].on} onChange={(e) => save({ [k]: { ...c[k], on: e.target.checked } })} />
            {label}
          </label>
          <input className="txt" type="time" value={c[k].time} onChange={(e) => save({ [k]: { ...c[k], time: e.target.value } })} style={{ maxWidth: 120 }} aria-label={`${label} time`} />
        </div>
      ))}
      <div className="row" style={{ marginBottom: 6 }}>
        <label className="row grow">
          <input type="checkbox" checked={c.water.on} onChange={(e) => save({ water: { ...c.water, on: e.target.checked } })} />
          Water, when behind pace (every h)
        </label>
        <div style={{ width: 80 }}>
          <NumInput value={c.water.everyHours} onChange={(v) => v !== '' && v >= 1 && save({ water: { ...c.water, everyHours: v } })} />
        </div>
      </div>
      {interval.map(([k, label]) => (
        <div key={k} className="row" style={{ marginBottom: 6 }}>
          <label className="row grow">
            <input type="checkbox" checked={c[k].on} onChange={(e) => save({ [k]: { ...c[k], on: e.target.checked } })} />
            {label}
          </label>
          <div style={{ width: 80 }}>
            <NumInput value={c[k].everyDays} onChange={(v) => v !== '' && v >= 1 && save({ [k]: { ...c[k], everyDays: v } })} />
          </div>
        </div>
      ))}
      <div className="hr" />
      <BackgroundPush />
      {perm === 'granted' ? (
        <p className="fineprint" style={{ margin: 0 }}>
          Phone notifications are on for this device.
        </p>
      ) : perm === 'unsupported' ? (
        <p className="fineprint" style={{ margin: 0 }}>This browser does not support notifications; reminders show on the Today screen.</p>
      ) : (
        <button
          className="btn block"
          onClick={async () => {
            const p = await Notification.requestPermission();
            setPerm(p);
            if (p === 'granted') toast('Notifications on');
          }}
        >
          Allow phone notifications
        </button>
      )}
      <p className="fineprint">
        Due reminders always show on the Today screen. Background reminders come from your account every 5 minutes and arrive even when the app is closed; without them, phone notifications only fire while the app is open or recently used.
      </p>
    </Card>
  );
}

export function AppLockCard() {
  const toast = useToast();
  const [on, setOn] = useState(lockEnabled);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [cur, setCur] = useState('');
  const [timeout, setTimeoutMin] = useState<number | ''>(lockTimeoutMin());
  const valid = /^\d{4,8}$/.test(a) && a === b;
  return (
    <Card title="App lock">
      {on ? (
        <div className="stack">
          <p className="fineprint" style={{ margin: 0 }}>
            PIN lock is on for this device. It asks for the PIN when the app opens and after it has been in the background for:
          </p>
          <Field label="Minutes in background before locking">
            <NumInput
              value={timeout}
              onChange={(v) => {
                setTimeoutMin(v);
                if (v !== '' && v >= 0) setLockTimeoutMin(v);
              }}
            />
          </Field>
          <Field label="Current PIN (to turn off)">
            <input type="password" inputMode="numeric" autoComplete="off" value={cur} onChange={(e) => setCur(e.target.value)} />
          </Field>
          <button
            className="btn danger block"
            disabled={!cur}
            onClick={async () => {
              if (await checkPin(cur)) {
                clearPin();
                setOn(false);
                setCur('');
                toast('App lock off');
              } else toast('Wrong PIN');
            }}
          >
            Turn off app lock
          </button>
        </div>
      ) : (
        <div className="stack">
          <p className="fineprint" style={{ margin: 0 }}>
            Set a 4-8 digit PIN for this device. It is stored only here, as a salted hash, and is never synced.
          </p>
          <div className="grid2">
            <Field label="New PIN">
              <input type="password" inputMode="numeric" autoComplete="off" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Repeat PIN">
              <input type="password" inputMode="numeric" autoComplete="off" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <button
            className="btn block"
            disabled={!valid}
            onClick={async () => {
              await setPin(a);
              setA('');
              setB('');
              setOn(true);
              toast('App lock on');
            }}
          >
            Turn on app lock
          </button>
        </div>
      )}
    </Card>
  );
}

function BackgroundPush() {
  const sync = useSyncState();
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushSubscribed().then(setOn);
  }, []);
  if (!pushSupported()) return null;
  const signedIn = sync.status !== 'signed-out' && sync.status !== 'off';
  return (
    <div className="stack" style={{ marginBottom: 10 }}>
      <div className="row between">
        <strong>Background reminders</strong>
        <span className={`pill ${on ? 'good' : ''}`}>{on === null ? '…' : on ? 'On for this device' : 'Off'}</span>
      </div>
      {!signedIn && <small className="muted">Sign in to cloud sync first (top of Settings).</small>}
      <button
        className={`btn block ${on ? '' : 'primary'}`}
        disabled={busy || !signedIn || on === null}
        onClick={async () => {
          setBusy(true);
          try {
            if (on) {
              await disablePush();
              setOn(false);
              toast('Background reminders off');
            } else {
              await enablePush();
              setOn(true);
              toast('Background reminders on');
            }
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {on ? 'Turn off background reminders' : 'Turn on background reminders'}
      </button>
    </div>
  );
}
