
export const exportNotesAsJson = async (): Promise<string> => {
  try {
    const notes = await getNotes();
    return JSON.stringify(notes, null, 2);
  } catch (error) {
    throw error;
  }
};
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
export const deleteNote = async (id: number): Promise<void> => {
  try {
    await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
  } catch (error) {
    throw error;
  }
};
import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('notespark.db');

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
  )
    .then(() => Promise.all([
      db.execAsync('ALTER TABLE notes ADD COLUMN createdAt TEXT').catch(() => {}),
      db.execAsync('ALTER TABLE notes ADD COLUMN updatedAt TEXT').catch(() => {}),
    ]))
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

export const getNotes = async (): Promise<any[]> => {
  try {
    const notes = await db.getAllAsync('SELECT * FROM notes');
    return notes || [];
  } catch (error) {
    throw error;
  }
};

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

export const getNoteById = async (id: number): Promise<any | null> => {
  try {
    const result = await db.getAllAsync('SELECT * FROM notes WHERE id = ?', [id]);
    return result && result.length > 0 ? result[0] : null;
  } catch (error) {
    throw error;
  }
};

