import * as Crypto from 'expo-crypto';
import { deleteAsync, getInfoAsync, moveAsync } from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

export const dbName = (profileId: string) => (profileId === 'default' ? 'notespark.db' : `notespark-${profileId}.db`);

// Live binding: importers see the new connection after openProfileDatabase. The first connection is opened
// unkeyed and untouched; `dbReady` turns true once a profile has really been opened (keyed if it needs it).
export let db = SQLite.openDatabaseSync(dbName('default'));
let openName = dbName('default');
let dbReady = false;

export const isProfileDatabaseOpen = (profileId: string) => dbName(profileId) === openName;

export const openProfileDatabase = async (profileId: string): Promise<void> => {
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
};

// Protected profiles are encrypted with SQLCipher (expo-sqlite `useSQLCipher`). Each has a random 256-bit key in
// SecureStore (Android Keystore, not restored by Android backup); the PIN or fingerprint only guards opening it.
const keyName = (id: string) => `profileKey_${id}`;
// Saved before a key change swaps files and cleared after, so an interrupted change can still be opened.
const pendingKeyName = (id: string) => `profileKeyPending_${id}`;

const fileUri = (name: string) => `file://${SQLite.defaultDatabaseDirectory}/${name}`;

const commitKey = async (id: string, key: string | null) => {
  if (key) await SecureStore.setItemAsync(keyName(id), key);
  else await SecureStore.deleteItemAsync(keyName(id));
  await SecureStore.deleteItemAsync(pendingKeyName(id));
};

export const forgetProfileKey = (id: string) => commitKey(id, null);

// Reading anything fails with "file is not a database" when the key is wrong.
const unlock = async (conn: SQLite.SQLiteDatabase, key: string | null) => {
  if (key) await conn.execAsync(`PRAGMA key = "x'${key}'"`);
  await conn.getFirstAsync('SELECT count(*) FROM sqlite_master');
};

// A key change stopped after moving the original aside: put it back. Stopped after the new file was in place:
// drop the leftover.
const recoverSwap = async (name: string) => {
  if (!(await getInfoAsync(fileUri(`${name}.old`))).exists) return;
  if ((await getInfoAsync(fileUri(name))).exists) await deleteAsync(fileUri(`${name}.old`), { idempotent: true });
  else await moveAsync({ from: fileUri(`${name}.old`), to: fileUri(name) });
};

// Opens a profile's database with its key. During an unfinished key change it tries the pending key too and
// keeps whichever opens the file.
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

export const isProfileEncrypted = async (id: string) => !!(await SecureStore.getItemAsync(keyName(id)));

// Encrypts (or decrypts) a profile's database. Copies it into a new file with sqlcipher_export, then swaps the
// files, so a failure before the swap leaves the original untouched. Returns false when nothing changed,
// including builds without SQLCipher (Expo Go, older dev builds), where profiles stay unencrypted.
export const setProfileEncryption = async (profileId: string, encrypt: boolean): Promise<boolean> => {
  if ((await isProfileEncrypted(profileId)) === encrypt) return false;
  const name = dbName(profileId);
  const newKey = encrypt ? Array.from(Crypto.getRandomBytes(32), b => b.toString(16).padStart(2, '0')).join('') : null;
  const wasOpen = isProfileDatabaseOpen(profileId);
  if (wasOpen) await db.closeAsync().catch(() => {});
  try {
    const conn = await openProfileConnection(profileId, { useNewConnection: true });
    try {
      if (!(await conn.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version'))?.cipher_version) return false;
      // The search index is a sqlite-vec virtual table, which sqlcipher_export can't copy; the next sync rebuilds it.
      await loadSearchExtension(conn);
      await conn.execAsync('DROP TABLE IF EXISTS note_vectors; DROP TABLE IF EXISTS note_vector_state;');
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
      db = await openProfileConnection(profileId);
      dbReady = true;
      await initDatabase(db);
    }
  }
};

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
  const now = new Date().toISOString();
  await db.runAsync('DELETE FROM notes WHERE deletedAt IS NOT NULL AND deletedAt < ?', [
    new Date(Date.now() - BIN_DAYS * 86400000).toISOString(),
  ]);
  // Earlier versions of each note, newest kept (see saveVersion in notes.ts). Rows of erased notes go here.
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
  await db.runAsync("UPDATE notes SET createdAt = ? WHERE createdAt IS NULL OR createdAt = ''", [now]);
  await db.runAsync("UPDATE notes SET updatedAt = ? WHERE updatedAt IS NULL OR updatedAt = ''", [now]);
  await initSearchIndex(db);
};

// sqlite-vec is missing in Expo Go; search by meaning is hidden there. Returns whether it loaded.
const loadSearchExtension = async (db: SQLite.SQLiteDatabase): Promise<boolean> => {
  const vec = SQLite.bundledExtensions['sqlite-vec'];
  if (!vec) return false;
  await db.loadExtensionAsync(vec.libPath, vec.entryPoint);
  return true;
};

const initSearchIndex = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  try {
    if (!(await loadSearchExtension(db))) return;
    await db.execAsync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS note_vectors USING vec0(embedding float[384] distance_metric=cosine);
       CREATE TABLE IF NOT EXISTS note_vector_state (noteId INTEGER PRIMARY KEY, updatedAt TEXT NOT NULL);`
    );
  } catch (error) {
    console.warn('Search by meaning is unavailable:', error);
  }
};
