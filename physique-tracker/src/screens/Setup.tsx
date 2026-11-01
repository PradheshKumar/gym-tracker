import { useState } from 'react';
import { AccountCard } from '../components/AccountCard';
import { Card, Estimate, Field, NumInput, useToast } from '../components/ui';
import { completeSetup } from '../db';
import { navyBodyFatFemale, navyBodyFatMale } from '../lib/formulas';
import { cloudConfigured } from '../sync/cloud';

/** First run: your own baseline instead of numbers baked into the code. */
export function Setup() {
  const toast = useToast();
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [v, setV] = useState<Record<string, number | ''>>({ heightCm: '', birthYear: '', weightKg: '', neckCm: '', waistCm: '', hipCm: '' });
  const [busy, setBusy] = useState(false);
  const n = (k: string) => (v[k] === '' ? undefined : (v[k] as number));
  const ok = !!(n('heightCm') && n('birthYear') && n('weightKg') && n('neckCm') && n('waistCm') && (sex === 'male' || n('hipCm')));
  const bf = ok
    ? sex === 'male'
      ? navyBodyFatMale(n('waistCm')!, n('neckCm')!, n('heightCm')!)
      : navyBodyFatFemale(n('waistCm')!, n('neckCm')!, n('hipCm')!, n('heightCm')!)
    : null;
  const field = (k: string, label: string, step = 0.1, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumInput value={v[k]} step={step} onChange={(x) => setV({ ...v, [k]: x })} />
    </Field>
  );

  return (
    <>
      <header className="top">
        <div>
          <h1>Welcome</h1>
          <div className="sub">Set your starting point. It stays on this device (and your account, if you sign in).</div>
        </div>
      </header>

      {cloudConfigured && (
        <>
          <p className="fineprint">Already using the app on another device? Sign in and your data comes back; this screen then goes away.</p>
          <AccountCard />
        </>
      )}

      <Card title="Your baseline">
        <div className="chips" style={{ marginBottom: 10 }}>
          {(['male', 'female'] as const).map((s) => (
            <button key={s} className={`chip ${sex === s ? 'on' : ''}`} onClick={() => setSex(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="grid2">
          {field('heightCm', 'Height (cm)', 0.5)}
          {field('birthYear', 'Birth year', 1)}
          {field('weightKg', 'Weight (kg)', 0.1, 'Morning, fasted')}
          {field('neckCm', 'Neck (cm)')}
          {field('waistCm', 'Waist at navel (cm)')}
          {sex === 'female' && field('hipCm', 'Hips (cm)')}
        </div>
        {bf !== null && (
          <p>
            Navy body fat: <strong>{bf.toFixed(1)}%</strong> <Estimate>±3-4%</Estimate>
          </p>
        )}
        <button
          className="btn primary block"
          style={{ marginTop: 8 }}
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            await completeSetup({
              sex,
              heightCm: n('heightCm')!,
              birthYear: n('birthYear')!,
              weightKg: n('weightKg')!,
              neckCm: n('neckCm')!,
              waistCm: n('waistCm')!,
              hipCm: n('hipCm'),
            });
            toast('Baseline saved');
          }}
        >
          Start
        </button>
        <p className="fineprint">Goals are created from these numbers and the Phase 2 targets; edit any of them later in Body → Goals and Coach.</p>
      </Card>
    </>
  );
}
