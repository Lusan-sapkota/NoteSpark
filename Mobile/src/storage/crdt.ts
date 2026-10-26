// The sync side of the phone's storage: a profile's notes as Yjs updates in crdt_updates (see docs/architecture/sync.md).
// Off until the person turns sync on for the profile; then every note change is also written as an update, and
// updates from other devices are written back into the notes table, which stays what every screen reads.
// Not in the desktop's callable modules (Desktop/src/main/storage.ts): nothing here is reachable from a browser.
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { type NoteState, catalogUpdate, compact, noteFromUpdates, noteUpdate, readCatalog, shouldCompact } from '@notespark/sync';

type DB = SQLite.SQLiteDatabase;
type Txn = Pick<DB, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'>;

// A v4 uuid made by SQLite itself, so every INSERT, the backfill and the undo paths use one generator.
// (No trigger: sqlcipher_export copies triggers differently on the phone and the desktop.)
export const UUID_SQL = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

const CATALOG = 'catalog';

export const initCrdt = async (db: DB): Promise<void> => {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS crdt_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      docId TEXT NOT NULL,
      "update" BLOB NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crdt_updates_doc ON crdt_updates (docId, id);
    CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), clientId INTEGER NOT NULL);`
  );
};

// Per connection; a row exists only while sync is on for this profile. clientId is this device's Yjs id here.
const states = new WeakMap<DB, { clientId: number } | null>();

const syncState = async (db: DB) => {
  if (!states.has(db)) states.set(db, await db.getFirstAsync<{ clientId: number }>('SELECT clientId FROM sync_state WHERE id = 1').catch(() => null));
  return states.get(db)!;
};

export const isSyncOn = async (db: DB) => !!(await syncState(db));

// Turning sync on seeds a doc for every note (bin included) from what the notes table holds now.
export const enableSync = async (db: DB): Promise<void> => {
  if (await syncState(db)) return;
  const clientId = new DataView(Crypto.getRandomBytes(4).buffer).getUint32(0);
  await db.runAsync('INSERT INTO sync_state (id, clientId) VALUES (1, ?)', [clientId]);
  states.set(db, { clientId });
  await reconcile(db);
};

export const disableSync = async (db: DB): Promise<void> => {
  await db.execAsync('DELETE FROM crdt_updates; DELETE FROM sync_state');
  states.set(db, null);
};

const loadUpdates = async (db: DB | Txn, docId: string) =>
  (await db.getAllAsync<{ update: Uint8Array }>('SELECT "update" FROM crdt_updates WHERE docId = ? ORDER BY id', [docId])).map(r => r.update);

const append = async (db: DB, docId: string, update: Uint8Array) => {
  await db.runAsync('INSERT INTO crdt_updates (docId, "update", createdAt) VALUES (?, ?, ?)', [docId, update, new Date().toISOString()]);
  const stats = (await db.getFirstAsync<{ n: number; bytes: number }>('SELECT count(*) AS n, coalesce(sum(length("update")), 0) AS bytes FROM crdt_updates WHERE docId = ?', [docId]))!;
  if (!shouldCompact(stats.n, stats.bytes)) return;
  await db.withExclusiveTransactionAsync(async txn => {
    const rows = await txn.getAllAsync<{ id: number; update: Uint8Array }>('SELECT id, "update" FROM crdt_updates WHERE docId = ? ORDER BY id', [docId]);
    await txn.runAsync('DELETE FROM crdt_updates WHERE docId = ?', [docId]);
    await txn.runAsync('INSERT INTO crdt_updates (docId, "update", createdAt) VALUES (?, ?, ?)', [docId, compact(rows.map(r => r.update)), new Date().toISOString()]);
  });
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

// After a local write: the notes table is the truth, so the docs take on what the rows say now (only the difference).
export const captureNotes = async (db: DB, ids: number[]): Promise<void> => {
  const state = await syncState(db);
  if (!state || ids.length === 0) return;
  const catalog = await loadUpdates(db, CATALOG);
  const { erased, known } = readCatalog(catalog);
  const live: string[] = [];
  for (const id of ids) {
    const row = await db.getFirstAsync<any>('SELECT * FROM notes WHERE id = ?', [id]);
    if (!row?.uuid || erased.has(row.uuid)) continue;
    const update = noteUpdate(await loadUpdates(db, row.uuid), state.clientId, stateOf(row));
    if (update) await append(db, row.uuid, update);
    if (!known.has(row.uuid)) live.push(row.uuid);
  }
  const update = live.length ? catalogUpdate(catalog, state.clientId, { live }) : null;
  if (update) await append(db, CATALOG, update);
};

export const uuidsWhere = async (db: DB | Txn, where: string, params: unknown[] = []): Promise<string[]> =>
  (await db.getAllAsync<{ uuid: string }>(`SELECT uuid FROM notes WHERE uuid IS NOT NULL AND ${where}`, params as any)).map(r => r.uuid);

export const eraseNotes = async (db: DB, uuids: string[]): Promise<void> => {
  const state = await syncState(db);
  if (!state || uuids.length === 0) return;
  const update = catalogUpdate(await loadUpdates(db, CATALOG), state.clientId, { erased: uuids });
  if (update) await append(db, CATALOG, update);
  for (const uuid of uuids) await db.runAsync('DELETE FROM crdt_updates WHERE docId = ?', [uuid]);
};

// Catches whatever the targeted calls above missed (a crash between a row and its update, a new device): every note
// is diffed against its doc, and a doc whose note is gone gets a tombstone.
// ponytail: loads every doc, so it runs when sync is turned on and once per connection, not per save.
export const reconcile = async (db: DB): Promise<void> => {
  if (!(await syncState(db))) return;
  const ids = (await db.getAllAsync<{ id: number }>('SELECT id FROM notes')).map(r => r.id);
  for (let i = 0; i < ids.length; i += 100) await captureNotes(db, ids.slice(i, i + 100));
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

export interface Delta {
  doc: string;
  bytes: Uint8Array;
}

// Updates from another device: stored, then the notes table is brought in step. A note erased elsewhere is erased here.
// Callers wrap this in changesNotes (notes.ts) so screens reload.
export const applyRemote = async (db: DB, deltas: Delta[]): Promise<void> => {
  if (!(await syncState(db))) throw new Error('Sync is off for this profile');
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
  }
  for (const uuid of touched) {
    if (uuid === CATALOG || erased.has(uuid)) continue;
    const n = noteFromUpdates(await loadUpdates(db, uuid));
    await db.runAsync(
      `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, isPinned, isArchived, deletedAt, uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET title = excluded.title, content = excluded.content, isMarkdown = excluded.isMarkdown,
         updatedAt = excluded.updatedAt, isPinned = excluded.isPinned, isArchived = excluded.isArchived, deletedAt = excluded.deletedAt`,
      [n.title, n.content, n.isMarkdown ? 1 : 0, n.createdAt, n.updatedAt, n.isPinned ? 1 : 0, n.isArchived ? 1 : 0, n.deletedAt, uuid]
    );
  }
};
