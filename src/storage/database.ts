import * as SQLite from 'expo-sqlite';

// Open the database
export const db = SQLite.openDatabaseSync('notespark.db');

// Initialize the database
export const initDatabase = (): Promise<void> => {
  return db.execAsync(
    `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      isMarkdown INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`
  ).then(() => resolve()).catch((error: any) => reject(error));
};

function resolve(): void {
  // No-op: used to fulfill the Promise<void> contract after successful DB init
}
function reject(error: any): void {
  // Forward the error to the Promise rejection
  throw error;
}

