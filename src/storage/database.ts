import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('notespark.db');

// Creates the notes table and upgrades older installs. Each ALTER fails harmlessly when the column exists.
export const initDatabase = async (): Promise<void> => {
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
