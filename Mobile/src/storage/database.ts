import * as Crypto from 'expo-crypto';
import { deleteAsync, getInfoAsync, moveAsync } from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { UUID_SQL, initCrdt, reconcileOnce, transact, uuidsWhere } from './crdt';

export const dbName = (profileId: string) => (profileId === 'default' ? 'notespark.db' : `notespark-${profileId}.db`);

// Live binding, swapped by openProfileDatabase. The import-time placeholder stays unused until a profile opens.
export let db = SQLite.openDatabaseSync(':memory:');
let openName = '';
let dbReady = false;

export const isDatabaseReady = () => dbReady;

let lockChain: Promise<void> = Promise.resolve();

// Serializes connection swaps, encryption changes, deletions and background reads across profiles.
export const withDatabaseLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = lockChain.then(fn);
  lockChain = next.then(
    () => {},
    () => {}
  );
  return next;
};

export const isProfileDatabaseOpen = (profileId: string) => dbName(profileId) === openName;

export const closeProfileDatabase = async (profileId: string): Promise<void> => {
  if (!isProfileDatabaseOpen(profileId)) return;
  dbReady = false;
  openName = '';
  await db.closeAsync().catch(() => {});
};

export const openProfileDatabase = (profileId: string): Promise<void> =>
  withDatabaseLock(async () => {
    const name = dbName(profileId);
    if (name === openName && dbReady) {
      await initDatabase(db);
      return;
    }
    const next = await openProfileConnection(profileId);
    await initDatabase(next);
    const previous = db;
    db = next;
    openName = name;
    dbReady = true;
    if (previous !== next) await previous.closeAsync().catch(() => {});
  });

// Protected profiles are SQLCipher-encrypted with a random key in SecureStore; the PIN only guards the UI.
const keyName = (id: string) => `profileKey_${id}`;
// Saved before a key change swaps files and cleared after, so an interrupted change can still be opened.
const pendingKeyName = (id: string) => `profileKeyPending_${id}`;

const fileUri = (name: string) => `file://${SQLite.defaultDatabaseDirectory}/${name}`;

const commitKey = async (id: string, key: string | null) => {
  if (key) await SecureStore.setItemAsync(keyName(id), key);
  else await SecureStore.deleteItemAsync(keyName(id));
  await SecureStore.deleteItemAsync(pendingKeyName(id));
};

export const getProfileKey = (id: string) => SecureStore.getItemAsync(keyName(id));

export const restoreProfileKey = (id: string, key: string) => commitKey(id, key);

export const forgetProfileKey = (id: string) => commitKey(id, null);

// Reading anything fails with "file is not a database" when the key is wrong.
const unlock = async (conn: SQLite.SQLiteDatabase, key: string | null) => {
  if (key) await conn.execAsync(`PRAGMA key = "x'${key}'"`);
  await conn.getFirstAsync('SELECT count(*) FROM sqlite_master');
};

// Finishes or undoes a key change that stopped mid-swap.
const recoverSwap = async (name: string) => {
  if (!(await getInfoAsync(fileUri(`${name}.old`))).exists) return;
  if ((await getInfoAsync(fileUri(name))).exists) await deleteAsync(fileUri(`${name}.old`), { idempotent: true });
  else await moveAsync({ from: fileUri(`${name}.old`), to: fileUri(name) });
};

// Opens a profile's database with its key; after an interrupted key change, tries the pending key too.
export const openProfileConnection = async (profileId: string, options?: SQLite.SQLiteOpenOptions): Promise<SQLite.SQLiteDatabase> => {
  const name = dbName(profileId);
  await recoverSwap(name);
  const [key, pending] = await Promise.all([SecureStore.getItemAsync(keyName(profileId)), SecureStore.getItemAsync(pendingKeyName(profileId))]);
  const candidates = pending === null ? [key] : [key, pending || null];
  let failure: unknown;
  for (const candidate of candidates) {
    const conn = await SQLite.openDatabaseAsync(name, options);
    try {
      await unlock(conn, candidate);
      if (pending !== null) await commitKey(profileId, candidate);
      return conn;
    } catch (error) {
      failure = error;
      await conn.closeAsync().catch(() => {});
    }
  }
  throw failure;
};

export const deleteProfileDatabase = (profileId: string): Promise<void> =>
  withDatabaseLock(async () => {
    const name = dbName(profileId);
    await closeProfileDatabase(profileId);
    if ((await getInfoAsync(fileUri(name))).exists) await SQLite.deleteDatabaseAsync(name);
    await deleteAsync(fileUri(`${name}.old`), { idempotent: true });
    await deleteAsync(fileUri(`${name}.new`), { idempotent: true });
  });

export const isProfileEncrypted = async (id: string) => !!(await SecureStore.getItemAsync(keyName(id)));

// Copies the file with sqlcipher_export, then swaps it in, so a failure leaves the original intact.
// Returns false when nothing changed, including builds without SQLCipher (Expo Go).
export const setProfileEncryption = (profileId: string, encrypt: boolean): Promise<boolean> =>
  withDatabaseLock(async () => {
    if ((await isProfileEncrypted(profileId)) === encrypt) return false;
    const name = dbName(profileId);
    const newKey = encrypt ? Array.from(Crypto.getRandomBytes(32), b => b.toString(16).padStart(2, '0')).join('') : null;
    const wasOpen = isProfileDatabaseOpen(profileId) && dbReady;
    await closeProfileDatabase(profileId);
    try {
      const conn = await openProfileConnection(profileId, { useNewConnection: true });
      try {
        if (!(await conn.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version'))?.cipher_version) return false;
        // The search index is a sqlite-vec virtual table, which sqlcipher_export can't copy; the next sync rebuilds it.
        await loadSearchExtension(conn);
        await conn.execAsync(DROP_SEARCH_INDEX);
        await deleteAsync(fileUri(`${name}.new`), { idempotent: true });
        const path = `${SQLite.defaultDatabaseDirectory}/${name}.new`.replace(/'/g, "''");
        await conn.execAsync(
          `ATTACH DATABASE '${path}' AS converted KEY ${newKey ? `"x'${newKey}'"` : "''"};
           SELECT sqlcipher_export('converted');
           DETACH DATABASE converted;`
        );
      } finally {
        await conn.closeAsync();
      }
      await SecureStore.setItemAsync(pendingKeyName(profileId), newKey ?? '');
      await moveAsync({ from: fileUri(name), to: fileUri(`${name}.old`) });
      await moveAsync({ from: fileUri(`${name}.new`), to: fileUri(name) });
      await deleteAsync(fileUri(`${name}.old`), { idempotent: true });
      await deleteAsync(fileUri(`${name}-journal`), { idempotent: true });
      await commitKey(profileId, newKey);
      return true;
    } finally {
      if (wasOpen) {
        // A new connection: a cached one could still point at the file that was just replaced.
        const next = await openProfileConnection(profileId, { useNewConnection: true });
        await initDatabase(next);
        db = next;
        openName = name;
        dbReady = true;
      }
    }
  });

// Notes in the bin are erased this many days after deletion, when the database next opens.
export const BIN_DAYS = 30;

// Creates the notes table and upgrades older installs. Each ALTER fails harmlessly when the column exists.
export const initDatabase = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      isMarkdown INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      isPinned INTEGER NOT NULL DEFAULT 0
    )`
  );
  await db.execAsync('ALTER TABLE notes ADD COLUMN createdAt TEXT').catch(() => {});
  await db.execAsync('ALTER TABLE notes ADD COLUMN updatedAt TEXT').catch(() => {});
  await db.execAsync('ALTER TABLE notes ADD COLUMN isPinned INTEGER NOT NULL DEFAULT 0').catch(() => {});
  await db.execAsync('ALTER TABLE notes ADD COLUMN deletedAt TEXT').catch(() => {});
  await db.execAsync('ALTER TABLE notes ADD COLUMN isArchived INTEGER NOT NULL DEFAULT 0').catch(() => {});
  // The global id sync uses; backfilled once, then set by every INSERT (UUID_SQL) and never changed.
  await db.execAsync('ALTER TABLE notes ADD COLUMN uuid TEXT').catch(() => {});
  await db.execAsync(`UPDATE notes SET uuid = ${UUID_SQL} WHERE uuid IS NULL OR uuid = ''`);
  await db.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS notes_uuid ON notes (uuid)');
  await initCrdt(db);
  const now = new Date().toISOString();
  const cutoff = [new Date(Date.now() - BIN_DAYS * 86400000).toISOString()];
  await transact(db, async sync => {
    const purged = await uuidsWhere(db, 'deletedAt IS NOT NULL AND deletedAt < ?', cutoff);
    await db.runAsync('DELETE FROM notes WHERE deletedAt IS NOT NULL AND deletedAt < ?', cutoff);
    await sync.erase(purged);
  });
  // Earlier versions of each note (see saveVersion in notes.ts).
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS note_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      isMarkdown INTEGER NOT NULL,
      savedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS note_versions_note ON note_versions (noteId, savedAt);`
  );
  await db.runAsync('DELETE FROM note_versions WHERE noteId NOT IN (SELECT id FROM notes)');
  // The profile's scratchpad: one row, plain text (see getScratchpad in notes.ts).
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS scratchpad (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL, updatedAt TEXT NOT NULL)`
  );
  await db.runAsync("UPDATE notes SET createdAt = ? WHERE createdAt IS NULL OR createdAt = ''", [now]);
  await db.runAsync("UPDATE notes SET updatedAt = ? WHERE updatedAt IS NULL OR updatedAt = ''", [now]);
  await reconcileOnce(db);
  await initSearchIndex(db);
};

// sqlite-vec is missing in Expo Go; search by meaning is hidden there. Returns whether it loaded.
const loadSearchExtension = async (db: SQLite.SQLiteDatabase): Promise<boolean> => {
  const vec = SQLite.bundledExtensions['sqlite-vec'];
  if (!vec) return false;
  await db.loadExtensionAsync(vec.libPath, vec.entryPoint);
  return true;
};

// Search index: one vector per chunk of a note (chunk_vectors rowid = note_chunks.id), and the updatedAt each
// note was indexed at. note_vectors / note_vector_state held one vector per note before 2026-10-25.
const DROP_SEARCH_INDEX = `DROP TABLE IF EXISTS note_vectors; DROP TABLE IF EXISTS note_vector_state;
  DROP TABLE IF EXISTS chunk_vectors; DROP TABLE IF EXISTS note_chunks; DROP TABLE IF EXISTS chunk_state;`;

const initSearchIndex = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  try {
    if (!(await loadSearchExtension(db))) return;
    await db.execAsync(
      `DROP TABLE IF EXISTS note_vectors; DROP TABLE IF EXISTS note_vector_state;
       CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(embedding float[384] distance_metric=cosine);
       CREATE TABLE IF NOT EXISTS note_chunks (id INTEGER PRIMARY KEY, noteId INTEGER NOT NULL);
       CREATE INDEX IF NOT EXISTS note_chunks_note ON note_chunks (noteId);
       CREATE TABLE IF NOT EXISTS chunk_state (noteId INTEGER PRIMARY KEY, updatedAt TEXT NOT NULL);`
    );
  } catch (error) {
    console.warn('Search by meaning is unavailable:', error);
  }
};
