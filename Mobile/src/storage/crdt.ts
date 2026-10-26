// Sync side of the storage: notes as Yjs updates in crdt_updates (docs/architecture/sync-architecture.md).
// Row and updates are written in one transaction (`transact`). Not exposed to the desktop renderer.
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { type NoteState, catalogUpdate, compact, noteCapture, noteWithStateVector, readCatalog, shouldCompact } from '@notespark/sync';

type DB = SQLite.SQLiteDatabase;

// A v4 uuid made by SQLite itself, so every INSERT, the backfill and the undo paths use one generator.
// (No trigger: sqlcipher_export copies triggers differently on the phone and the desktop.)
export const UUID_SQL = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

const CATALOG = 'catalog';

export const initCrdt = async (db: DB): Promise<void> => {
  // sync_state.clientId is unused (F2); crdt_materialized: doc state each row was last written from (F1).
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS crdt_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      docId TEXT NOT NULL,
      "update" BLOB NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crdt_updates_doc ON crdt_updates (docId, id);
    CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), clientId INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS crdt_materialized (docId TEXT PRIMARY KEY, stateVector BLOB NOT NULL);`
  );
};

// New random Yjs client id every process start, never stored (F2).
let processClientId: number | null = null;
const clientId = () => (processClientId ??= new DataView(Crypto.getRandomBytes(4).buffer).getUint32(0));

// Per connection; a row exists only while sync is on for this profile.
const states = new WeakMap<DB, boolean>();

const syncOn = async (db: DB) => {
  if (!states.has(db)) states.set(db, !!(await db.getFirstAsync('SELECT id FROM sync_state WHERE id = 1').catch(() => null)));
  return states.get(db)!;
};

export const isSyncOn = syncOn;

const loadUpdates = async (db: DB, docId: string) =>
  (await db.getAllAsync<{ update: Uint8Array }>('SELECT "update" FROM crdt_updates WHERE docId = ? ORDER BY id', [docId])).map(r => r.update);

const setMarker = (db: DB, docId: string, stateVector: Uint8Array) =>
  db.runAsync('INSERT INTO crdt_materialized (docId, stateVector) VALUES (?, ?) ON CONFLICT(docId) DO UPDATE SET stateVector = excluded.stateVector', [docId, stateVector]);

const append = async (db: DB, docId: string, update: Uint8Array) => {
  await db.runAsync('INSERT INTO crdt_updates (docId, "update", createdAt) VALUES (?, ?, ?)', [docId, update, new Date().toISOString()]);
  const stats = (await db.getFirstAsync<{ n: number; bytes: number }>('SELECT count(*) AS n, coalesce(sum(length("update")), 0) AS bytes FROM crdt_updates WHERE docId = ?', [docId]))!;
  if (!shouldCompact(stats.n, stats.bytes)) return;
  const rows = await loadUpdates(db, docId);
  await db.runAsync('DELETE FROM crdt_updates WHERE docId = ?', [docId]);
  await db.runAsync('INSERT INTO crdt_updates (docId, "update", createdAt) VALUES (?, ?, ?)', [docId, compact(rows), new Date().toISOString()]);
};

const stateOf = (row: any): NoteState => ({
  title: row.title,
  content: row.content,
  isMarkdown: !!row.isMarkdown,
  isPinned: !!row.isPinned,
  isArchived: !!row.isArchived,
  deletedAt: row.deletedAt ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface SyncWrites {
  capture(ids: number[]): Promise<void>;
  erase(uuids: string[]): Promise<void>;
}

const capture = async (db: DB, ids: number[]): Promise<void> => {
  const catalog = await loadUpdates(db, CATALOG);
  const { erased, known } = readCatalog(catalog);
  const live: string[] = [];
  for (const id of ids) {
    const row = await db.getFirstAsync<any>('SELECT * FROM notes WHERE id = ?', [id]);
    if (!row?.uuid || erased.has(row.uuid)) continue;
    const { update, stateVector } = noteCapture(await loadUpdates(db, row.uuid), clientId(), stateOf(row));
    if (update) await append(db, row.uuid, update);
    await setMarker(db, row.uuid, stateVector);
    if (!known.has(row.uuid)) live.push(row.uuid);
  }
  const update = live.length ? catalogUpdate(catalog, clientId(), { live }) : null;
  if (update) await append(db, CATALOG, update);
};

const erase = async (db: DB, uuids: string[]): Promise<void> => {
  if (uuids.length === 0) return;
  const update = catalogUpdate(await loadUpdates(db, CATALOG), clientId(), { erased: uuids });
  if (update) await append(db, CATALOG, update);
  for (const uuid of uuids) {
    await db.runAsync('DELETE FROM crdt_updates WHERE docId = ?', [uuid]);
    await db.runAsync('DELETE FROM crdt_materialized WHERE docId = ?', [uuid]);
  }
};

const chains = new WeakMap<DB, Promise<unknown>>();

// One transaction per connection at a time (no nesting). Not withExclusiveTransactionAsync: no SQLCipher key there.
// ponytail: a foreign statement between BEGIN and COMMIT joins the transaction.
export const transact = <T>(db: DB, work: (sync: SyncWrites) => Promise<T>): Promise<T> => {
  const run = async () => {
    const on = await syncOn(db);
    const sync: SyncWrites = { capture: ids => (on && ids.length ? capture(db, ids) : Promise.resolve()), erase: uuids => (on ? erase(db, uuids) : Promise.resolve()) };
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const result = await work(sync);
      await db.execAsync('COMMIT');
      return result;
    } catch (error) {
      await db.execAsync('ROLLBACK').catch(() => {});
      throw error;
    }
  };
  const next = (chains.get(db) ?? Promise.resolve()).then(run);
  chains.set(db, next.catch(() => {}));
  return next;
};

// Turning sync on seeds a doc for every note (bin included) from what the notes table holds now.
export const enableSync = async (db: DB): Promise<void> => {
  if (await syncOn(db)) return;
  await db.runAsync('INSERT INTO sync_state (id, clientId) VALUES (1, 0)');
  states.set(db, true);
  await reconcile(db);
};

export const disableSync = async (db: DB): Promise<void> => {
  await transact(db, async () => {
    await db.execAsync('DELETE FROM crdt_updates; DELETE FROM crdt_materialized; DELETE FROM sync_state');
  });
  states.set(db, false);
};

export const captureNotes = (db: DB, ids: number[]): Promise<void> => transact(db, sync => sync.capture(ids));

export const uuidsWhere = async (db: DB, where: string, params: unknown[] = []): Promise<string[]> =>
  (await db.getAllAsync<{ uuid: string }>(`SELECT uuid FROM notes WHERE uuid IS NOT NULL AND ${where}`, params as any)).map(r => r.uuid);

export const eraseNotes = (db: DB, uuids: string[]): Promise<void> => transact(db, sync => sync.erase(uuids));

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// Safety net. A doc ahead of its row (marker differs) rebuilds the row instead of being overwritten.
// ponytail: loads every doc; runs when sync is turned on and once per connection.
export const reconcile = async (db: DB): Promise<void> => {
  if (!(await syncOn(db))) return;
  const ids = (await db.getAllAsync<{ id: number }>('SELECT id FROM notes')).map(r => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    await transact(db, async sync => {
      const aheadOfRow: number[] = [];
      for (const id of ids.slice(i, i + 100)) {
        const row = await db.getFirstAsync<{ uuid: string | null }>('SELECT uuid FROM notes WHERE id = ?', [id]);
        if (!row?.uuid) continue;
        const marker = await db.getFirstAsync<{ stateVector: Uint8Array }>('SELECT stateVector FROM crdt_materialized WHERE docId = ?', [row.uuid]);
        if (marker && !sameBytes(marker.stateVector, noteWithStateVector(await loadUpdates(db, row.uuid)).stateVector)) await materialize(db, row.uuid);
        else aheadOfRow.push(id);
      }
      await sync.capture(aheadOfRow);
    });
  }
  const orphans = await db.getAllAsync<{ docId: string }>(
    `SELECT DISTINCT docId FROM crdt_updates WHERE docId != ? AND docId NOT IN (SELECT uuid FROM notes WHERE uuid IS NOT NULL)`, [CATALOG]
  );
  await eraseNotes(db, orphans.map(o => o.docId));
};

const reconciled = new WeakSet<DB>();
export const reconcileOnce = async (db: DB) => {
  if (reconciled.has(db)) return;
  reconciled.add(db);
  await reconcile(db);
};

const materialize = async (db: DB, uuid: string): Promise<void> => {
  const { note: n, stateVector } = noteWithStateVector(await loadUpdates(db, uuid));
  await db.runAsync(
    `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, isPinned, isArchived, deletedAt, uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET title = excluded.title, content = excluded.content, isMarkdown = excluded.isMarkdown,
       updatedAt = excluded.updatedAt, isPinned = excluded.isPinned, isArchived = excluded.isArchived, deletedAt = excluded.deletedAt`,
    [n.title, n.content, n.isMarkdown ? 1 : 0, n.createdAt, n.updatedAt, n.isPinned ? 1 : 0, n.isArchived ? 1 : 0, n.deletedAt, uuid]
  );
  await setMarker(db, uuid, stateVector);
};

export interface Delta {
  doc: string;
  bytes: Uint8Array;
}

// Updates from another device in one transaction. Callers wrap this in changesNotes (notes.ts).
export const applyRemote = async (db: DB, deltas: Delta[]): Promise<void> => {
  if (!(await syncOn(db))) throw new Error('Sync is off for this profile');
  await transact(db, async () => {
    const touched = new Set<string>();
    for (const { doc, bytes } of deltas) {
      await append(db, doc, bytes);
      touched.add(doc);
    }
    const { erased } = readCatalog(await loadUpdates(db, CATALOG));
    for (const uuid of erased) {
      const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM notes WHERE uuid = ?', [uuid]);
      if (row) {
        await db.runAsync('DELETE FROM notes WHERE id = ?', [row.id]);
        await db.runAsync('DELETE FROM note_versions WHERE noteId = ?', [row.id]);
      }
      await db.runAsync('DELETE FROM crdt_updates WHERE docId = ?', [uuid]);
      await db.runAsync('DELETE FROM crdt_materialized WHERE docId = ?', [uuid]);
    }
    for (const uuid of touched) if (uuid !== CATALOG && !erased.has(uuid)) await materialize(db, uuid);
  });
};
