// Device-only PIN lock. The PIN is stored as a salted SHA-256 hash in this browser and never synced.
import { useEffect, useState, type ReactNode } from 'react';

const KEY = 'lock.pin';
const TIMEOUT = 'lock.timeoutMin';

interface Stored {
  salt: string;
  hash: string;
}

function read(): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

async function digest(salt: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const lockEnabled = () => !!read();
export const lockTimeoutMin = () => Number(localStorage.getItem(TIMEOUT) ?? 5);
export const setLockTimeoutMin = (m: number) => localStorage.setItem(TIMEOUT, String(m));

export async function setPin(pin: string) {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await digest(salt, pin) }));
}

export async function checkPin(pin: string): Promise<boolean> {
  const s = read();
  return !s || (await digest(s.salt, pin)) === s.hash;
}

export const clearPin = () => localStorage.removeItem(KEY);

/** Locks on open and after the app has been in the background longer than the timeout. */
export function LockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(lockEnabled);
  useEffect(() => {
    let hiddenAt = 0;
    const on = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (lockEnabled() && hiddenAt && Date.now() - hiddenAt > lockTimeoutMin() * 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  if (!locked) return <>{children}</>;
  return <LockScreen onUnlock={() => setLocked(false)} />;
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPinInput] = useState('');
  const [error, setError] = useState(false);
  async function press(k: string) {
    setError(false);
    const next = k === '⌫' ? pin.slice(0, -1) : (pin + k).slice(0, 8);
    setPinInput(next);
    if (next.length >= 4 && (await checkPin(next))) onUnlock();
    else if (next.length === 8) {
      setError(true);
      setPinInput('');
    }
  }
  return (
    <main className="app lock" aria-label="App locked">
      <h1 className="center" style={{ marginTop: 48 }}>
        Enter PIN
      </h1>
      <div className="center" style={{ fontSize: 28, letterSpacing: 10, margin: '20px 0', minHeight: 40 }} aria-live="polite">
        {'•'.repeat(pin.length)}
      </div>
      {error && <p className="center pill bad">Wrong PIN</p>}
      <div className="grid3" style={{ maxWidth: 280, margin: '0 auto' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k ? (
            <button key={i} className="btn" style={{ minHeight: 64, fontSize: 22 }} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k}>
              {k}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
      <p className="fineprint center" style={{ marginTop: 24 }}>
        Forgot it? Clearing this site's data in Chrome removes the lock (and unsynced local data). Synced data comes back after you sign in.
      </p>
    </main>
  );
}
