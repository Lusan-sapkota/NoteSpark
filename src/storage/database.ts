// Update a note in the database
export const updateNote = async (note: {
  id: number;
  title: string;
  content: string;
  isMarkdown: boolean;
  createdAt?: string; // ignored
  updatedAt?: string; // will be set to now
}): Promise<void> => {
  if (note.id === undefined || note.id === null) {
    throw new Error('No noteId provided for edit');
  }
  try {
    const updatedAt = new Date().toISOString();
    await db.runAsync(
      'UPDATE notes SET title = ?, content = ?, isMarkdown = ?, updatedAt = ? WHERE id = ?',
      [note.title, note.content, note.isMarkdown ? 1 : 0, updatedAt, note.id]
    );
  } catch (error) {
    throw error;
  }
};
// Delete a note by ID
export const deleteNote = async (id: number): Promise<void> => {
  try {
    await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
  } catch (error) {
    throw error;
  }
};
import * as SQLite from 'expo-sqlite';

// Use async openDatabase for environments without SharedArrayBuffer
export const db = SQLite.openDatabaseSync('notespark.db');

// Initialize the database
export const initDatabase = (): Promise<void> => {
  // Step 1: Create table if not exists
  return db.execAsync(
    `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      isMarkdown INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`
  )
    // Step 2: Add columns if missing (migration)
    .then(() => Promise.all([
      db.execAsync('ALTER TABLE notes ADD COLUMN createdAt TEXT').catch(() => {}),
      db.execAsync('ALTER TABLE notes ADD COLUMN updatedAt TEXT').catch(() => {}),
    ]))
    // Step 3: Backfill missing dates
    .then(() => {
      const now = new Date().toISOString();
      return Promise.all([
        db.execAsync(`UPDATE notes SET createdAt = '${now}' WHERE createdAt IS NULL OR createdAt = ''`),
        db.execAsync(`UPDATE notes SET updatedAt = '${now}' WHERE updatedAt IS NULL OR updatedAt = ''`),
      ]);
    })
    .then(() => resolve())
    .catch((error: any) => reject(error));
};

function resolve(): void {}
function reject(error: any): void { throw error; }

// Fetch all notes from the database
export const getNotes = async (): Promise<any[]> => {
  try {
    const notes = await db.getAllAsync('SELECT * FROM notes');
    // notes is the array of notes
    return notes || [];
  } catch (error) {
    throw error;
  }
};

// Save a note to the database
export const saveNote = async (note: {
  title: string;
  content: string;
  isMarkdown: boolean;
  createdAt: string;
  updatedAt: string;
}): Promise<void> => {
  try {
    await db.runAsync(
      'INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [note.title, note.content, note.isMarkdown ? 1 : 0, note.createdAt, note.updatedAt]
    );
  } catch (error) {
    throw error;
  }
};

// Fetch a single note by ID
export const getNoteById = async (id: number): Promise<any | null> => {
  try {
    const result = await db.getAllAsync('SELECT * FROM notes WHERE id = ?', [id]);
    return result && result.length > 0 ? result[0] : null;
  } catch (error) {
    throw error;
  }
};

