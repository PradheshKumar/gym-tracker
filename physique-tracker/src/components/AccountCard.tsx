import { useState } from 'react';
import { cloudConfigured, fullResync, resetPassword, signIn, signOut, signUp, syncNow, updatePassword, useSyncState } from '../sync/cloud';
import { Card, Field } from './ui';

const ago = (t?: number) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString('en-IN');
};

export function SyncBadge() {
  const s = useSyncState();
  if (s.status === 'off') return null;
  const map = {
    'signed-out': ['○', 'Not syncing'],
    idle: ['☁', s.pending ? `${s.pending} to sync` : 'Synced'],
    syncing: ['⟳', 'Syncing'],
    offline: ['☁', 'Offline'],
    error: ['!', 'Sync error'],
  } as const;
  const [ico, label] = map[s.status];
  const cls = s.status === 'error' ? 'bad' : s.status === 'idle' && !s.pending ? 'good' : s.status === 'signed-out' ? '' : 'warn';
  return (
    <a href="#/settings" className={`pill ${cls}`} title={s.error ?? label} style={{ textDecoration: 'none' }}>
      {ico} {label}
    </a>
  );
}

export function AccountCard() {
  const s = useSyncState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  if (!cloudConfigured) {
    return (
      <Card title="Cloud sync">
        <p className="fineprint" style={{ margin: 0 }}>
          Not set up in this build. Data stays on this device only. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sync across devices.
        </p>
      </Card>
    );
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMsg(undefined);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (s.status === 'signed-out') {
    return (
      <Card title="Cloud sync">
        <p className="fineprint" style={{ marginTop: 0 }}>
          Sign in to back up your logs and use them on any device. Everything still works offline; changes sync when you are online. Photos and videos stay on this device.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              if (mode === 'reset') {
                await resetPassword(email);
                setMsg('If that email has an account, a reset link is on its way. Open it on this device.');
              } else if (mode === 'in') await signIn(email, password);
              else if ((await signUp(email, password)) === 'confirm-email') setMsg('Check your email to confirm the account, then sign in here.');
            });
          }}
        >
          <Field label="Email">
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode !== 'reset' && (
          <Field label="Password" hint={mode === 'up' ? 'At least 6 characters.' : undefined}>
            <input
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          )}
          <button className="btn primary block" disabled={busy}>
            {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Email me a reset link'}
          </button>
          <button type="button" className="btn ghost block" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
          {mode === 'in' && (
            <button type="button" className="btn ghost block" onClick={() => setMode('reset')}>
              Forgot password?
            </button>
          )}
        </form>
        {msg && <p className="fineprint">{msg}</p>}
      </Card>
    );
  }

  if (s.recovery) {
    return (
      <Card title="Set a new password">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await updatePassword(password);
              setPassword('');
              setMsg('Password updated.');
            });
          }}
        >
          <Field label="New password" hint="At least 6 characters.">
            <input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn primary block" disabled={busy}>
            Save new password
          </button>
        </form>
        {msg && <p className="fineprint">{msg}</p>}
      </Card>
    );
  }

  return (
    <Card title="Cloud sync" right={<SyncBadge />}>
      <div className="stack">
        <div>
          Signed in as <strong>{s.email}</strong>
        </div>
        <small>
          Last sync {ago(s.lastSync)}
          {s.pending ? ` · ${s.pending} change(s) waiting` : ''}
          {s.status === 'offline' && ' · offline, will sync when back online'}
        </small>
        {s.status === 'error' && <p className="pill bad">{s.error}</p>}
        <div className="grid2">
          <button className="btn" disabled={busy || s.status === 'syncing'} onClick={() => run(syncNow)}>
            Sync now
          </button>
          <button className="btn" disabled={busy} onClick={() => run(signOut)}>
            Sign out
          </button>
        </div>
        <button className="btn ghost block" disabled={busy} onClick={() => run(fullResync)}>
          Re-download everything
        </button>
        <p className="fineprint" style={{ margin: 0 }}>
          Signing out keeps data on this device. Photos and videos are never uploaded.
        </p>
        {msg && <p className="fineprint">{msg}</p>}
      </div>
    </Card>
  );
}
