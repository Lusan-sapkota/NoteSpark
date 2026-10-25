import * as SQLite from 'expo-sqlite';

// Each profile has its own database file; the first profile keeps the original one.
export const dbName = (profileId: string) => (profileId === 'default' ? 'notespark.db' : `notespark-${profileId}.db`);

// The active profile's database. A live binding: importers see the new one after openProfileDatabase.
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
  const now = new Date().toISOString();
  await db.runAsync("UPDATE notes SET createdAt = ? WHERE createdAt IS NULL OR createdAt = ''", [now]);
  await db.runAsync("UPDATE notes SET updatedAt = ? WHERE updatedAt IS NULL OR updatedAt = ''", [now]);
};
