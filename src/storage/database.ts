import * as SQLite from 'expo-sqlite';

export const dbName = (profileId: string) => (profileId === 'default' ? 'notespark.db' : `notespark-${profileId}.db`);

// Live binding: importers see the new connection after openProfileDatabase.
export let db = SQLite.openDatabaseSync(dbName('default'));
let openName = dbName('default');

export const openProfileDatabase = async (profileId: string): Promise<void> => {
  const name = dbName(profileId);
  const next = name === openName ? db : SQLite.openDatabaseSync(name);
  await initDatabase(next);
  if (next === db) return;
  const previous = db;
  db = next;
  openName = name;
  await previous.closeAsync().catch(() => {});
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
  const now = new Date().toISOString();
  await db.runAsync('DELETE FROM notes WHERE deletedAt IS NOT NULL AND deletedAt < ?', [
    new Date(Date.now() - BIN_DAYS * 86400000).toISOString(),
  ]);
  await db.runAsync("UPDATE notes SET createdAt = ? WHERE createdAt IS NULL OR createdAt = ''", [now]);
  await db.runAsync("UPDATE notes SET updatedAt = ? WHERE updatedAt IS NULL OR updatedAt = ''", [now]);
  await initSearchIndex(db);
};

// sqlite-vec is missing in Expo Go; search by meaning is hidden there.
const initSearchIndex = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  const vec = SQLite.bundledExtensions['sqlite-vec'];
  if (!vec) return;
  try {
    await db.loadExtensionAsync(vec.libPath, vec.entryPoint);
    await db.execAsync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS note_vectors USING vec0(embedding float[384] distance_metric=cosine);
       CREATE TABLE IF NOT EXISTS note_vector_state (noteId INTEGER PRIMARY KEY, updatedAt TEXT NOT NULL);`
    );
  } catch (error) {
    console.warn('Search by meaning is unavailable:', error);
  }
};
