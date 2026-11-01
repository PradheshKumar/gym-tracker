// Two-way sync between the on-device database and a remote record store.
// Model: one remote row per local record ({ tbl, id, data, deleted, updated_at, rev }).
// Conflicts resolve by last write wins on updated_at (client clock); the server refuses
// stale updates, and `rev` (a server sequence) is the pull cursor.
import { PK, SYNC_TABLES, isLocalOnly, recordId, type AppDB, type TableName } from '../db';
import { clearTombs, dropTombs, getCursor, getTombs, setCursor } from './outbox';

export interface RemoteRow {
  tbl: string;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  updated_at: number;
  rev: number;
}

export interface Remote {
  push(rows: Omit<RemoteRow, 'rev'>[]): Promise<void>;
  pull(afterRev: number, limit: number): Promise<RemoteRow[]>;
}

const PUSH_CHUNK = 500;
const PULL_PAGE = 1000;

const isDirty = (r: any) => typeof r.updatedAt === 'number' && r.updatedAt !== r._synced;
const keyFor = (table: TableName, id: string): string | number => (PK[table] === 'weekday' ? Number(id) : id);
const isSyncTable = (t: string): t is TableName => (SYNC_TABLES as readonly string[]).includes(t);

export async function pendingCount(db: AppDB): Promise<number> {
  let n = Object.keys(getTombs()).length;
  for (const t of SYNC_TABLES) n += (await db.table(t).toArray()).filter((r) => !isLocalOnly(t, r) && isDirty(r)).length;
  return n;
}

async function push(db: AppDB, remote: Remote): Promise<number> {
  const rows: (Omit<RemoteRow, 'rev'> & { table: TableName })[] = [];
  for (const t of SYNC_TABLES) {
    for (const r of await db.table(t).toArray()) {
      if (isLocalOnly(t, r) || !isDirty(r)) continue;
      const { _synced: _s, updatedAt, ...data } = r;
      rows.push({ table: t, tbl: t, id: recordId(t, r), data, deleted: false, updated_at: updatedAt });
    }
  }
  const tombs = getTombs();
  const tombRows = Object.entries(tombs).map(([k, ts]) => {
    const [tbl, id] = k.split('|');
    return { tbl, id, data: null, deleted: true, updated_at: ts };
  });

  const all = [...rows.map(({ table: _t, ...r }) => r), ...tombRows];
  for (let i = 0; i < all.length; i += PUSH_CHUNK) await remote.push(all.slice(i, i + PUSH_CHUNK));

  // Mark sent rows as synced, unless they changed again while we were pushing.
  if (rows.length) {
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
      for (const r of rows) {
        const tbl = db.table(r.table);
        const cur = await tbl.get(keyFor(r.table, r.id));
        if (cur && cur.updatedAt === r.updated_at) await tbl.put({ ...cur, _synced: r.updated_at, _remote: true });
      }
    });
  }
  clearTombs(tombs);
  return all.length;
}

async function pull(db: AppDB, remote: Remote): Promise<number> {
  let cursor = getCursor();
  let total = 0;
  for (;;) {
    const page = await remote.pull(cursor, PULL_PAGE);
    if (!page.length) break;
    const deletedKeys: string[] = [];
    const tombs = getTombs();
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
      for (const row of page) {
        if (!isSyncTable(row.tbl)) continue;
        const tbl = db.table(row.tbl);
        const key = keyFor(row.tbl, row.id);
        const local = await tbl.get(key);
        // Local copy (or local delete) is newer: keep it, it will be pushed.
        if (local && (local.updatedAt ?? 0) > row.updated_at) continue;
        const tomb = tombs[`${row.tbl}|${row.id}`];
        if (!local && tomb !== undefined && tomb >= row.updated_at) continue;
        if (row.deleted) {
          if (local) {
            await tbl.delete(key);
            deletedKeys.push(`${row.tbl}|${row.id}`);
          }
        } else if (row.data) {
          await tbl.put({ ...row.data, updatedAt: row.updated_at, _synced: row.updated_at, _remote: true });
        }
      }
    });
    // Our own delete hook queued tombstones for server-side deletes; they are not ours to send.
    dropTombs(deletedKeys);
    cursor = Math.max(cursor, ...page.map((r) => r.rev));
    setCursor(cursor);
    total += page.length;
    if (page.length < PULL_PAGE) break;
  }
  return total;
}

/** Push local changes, then pull everything the server has seen since the cursor. */
export async function syncOnce(db: AppDB, remote: Remote): Promise<{ pushed: number; pulled: number }> {
  const pushed = await push(db, remote);
  const pulled = await pull(db, remote);
  return { pushed, pulled };
}
