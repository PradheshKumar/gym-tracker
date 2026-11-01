// Supabase account + background sync. The app works fully offline without it;
// when configured and signed in, changes sync on edit, on reconnect, and every minute.
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { SYNC_TABLES, db, seedIfEmpty } from '../db';
import { pendingCount, syncOnce, type Remote, type RemoteRow } from './engine';
import { onLocalChange, resetSyncState } from './outbox';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigured = !!(URL_ && KEY);
export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export interface SyncState {
  status: 'off' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';
  email?: string;
  lastSync?: number;
  pending?: number;
  error?: string;
  /** Opened from a password-reset email: ask for a new password. */
  recovery?: boolean;
}

let state: SyncState = { status: cloudConfigured ? 'signed-out' : 'off' };
const subs = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

function remoteFor(client: SupabaseClient, user: User): Remote {
  return {
    async push(rows) {
      const { error } = await client.from('records').upsert(
        rows.map((r) => ({ ...r, user_id: user.id })),
        { onConflict: 'user_id,tbl,id' },
      );
      if (error) throw new Error(error.message);
    },
    async pull(after, limit) {
      const { data, error } = await client
        .from('records')
        .select('tbl,id,data,deleted,updated_at,rev')
        .gt('rev', after)
        .order('rev', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteRow[];
    },
  };
}

let user: User | null = null;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function syncNow(): Promise<void> {
  if (!supabase || !user) return;
  if (!navigator.onLine) {
    set({ status: 'offline', pending: await pendingCount(db) });
    return;
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    set({ status: 'syncing', error: undefined });
    try {
      do {
        again = false;
        await syncOnce(db, remoteFor(supabase!, user!));
      } while (again);
      set({ status: 'idle', lastSync: Date.now(), pending: await pendingCount(db) });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message, pending: await pendingCount(db).catch(() => undefined) });
    } finally {
      running = null;
    }
  })();
  return running;
}

function scheduleSync(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

const LAST_USER = 'sync.user';

/** A different account signing in on this device: replace local data with that account's. */
async function adoptUser(u: User): Promise<boolean> {
  const prev = localStorage.getItem(LAST_USER);
  if (prev && prev !== u.id) {
    const ok = confirm(
      `This device holds data from another account. Replace it with ${u.email}'s data? (Photos and videos stay on the device.)`,
    );
    if (!ok) {
      await supabase!.auth.signOut();
      return false;
    }
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
      for (const t of SYNC_TABLES) await db.table(t).clear();
    });
    await db.kv.delete('seeded');
    await seedIfEmpty();
    resetSyncState();
    localStorage.removeItem('sync.tombs');
  } else if (!prev) {
    // First sign-in on this device: upload everything already logged here.
    resetSyncState();
  }
  localStorage.setItem(LAST_USER, u.id);
  return true;
}

let started = false;
export function startCloud() {
  if (!supabase || started) return;
  started = true;
  supabase.auth.onAuthStateChange((event, session) => {
    // Supabase recommends deferring work out of this callback.
    setTimeout(async () => {
      const u = session?.user ?? null;
      if (!u) {
        user = null;
        set({ status: 'signed-out', email: undefined });
        return;
      }
      if (event === 'PASSWORD_RECOVERY') set({ recovery: true });
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY') {
        if (user?.id === u.id) return;
        if (!(await adoptUser(u))) return;
      }
      user = u;
      set({ email: u.email, status: 'idle' });
      scheduleSync(0);
    }, 0);
  });
  onLocalChange(() => scheduleSync(3000));
  window.addEventListener('online', () => scheduleSync(0));
  window.addEventListener('offline', () => set({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleSync(0));
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 60_000);
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUp(email: string, password: string): Promise<'confirm-email' | 'signed-in'> {
  const { data, error } = await supabase!.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
  });
  if (error) throw new Error(error.message);
  return data.session ? 'signed-in' : 'confirm-email';
}

/** Email a password-reset link that opens the app. */
export async function resetPassword(email: string) {
  const { error } = await supabase!.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${import.meta.env.BASE_URL}`,
  });
  if (error) throw new Error(error.message);
}

export async function updatePassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  set({ recovery: false });
}

export async function signOut() {
  await syncNow().catch(() => {});
  await supabase!.auth.signOut();
}

/** Re-download everything from the server (local unsent changes are kept). */
export async function fullResync() {
  resetSyncState();
  await syncNow();
}
