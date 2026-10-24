export const clearAllNotes = async (): Promise<void> => {
  await db.runAsync('DELETE FROM notes');
};
import { db } from './database';
import { Note } from '../types';

export const getNotes = async (): Promise<Note[]> => {
  const rows = await db.getAllAsync('SELECT * FROM notes ORDER BY updatedAt DESC');
  return rows.map((item: any) => ({
    ...item,
    isMarkdown: Boolean(item.isMarkdown)
  }));
};

export const getNoteById = async (id: number): Promise<Note | null> => {
  try {
    const items = await db.getAllAsync('SELECT * FROM notes WHERE id = ?', [id]);
    if (items && items.length > 0) {
      const item = items[0] as any;
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        isMarkdown: Boolean(item.isMarkdown),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };
    } else {
      return null;
    }
  } catch (error) {
    console.error('getNoteById error:', error);
    throw error;
  }
};

export const saveNote = async (note: Omit<Note, 'id'>): Promise<number> => {
  const now = new Date().toISOString();
  const result: any = await db.runAsync(
    `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    [note.title, note.content, note.isMarkdown ? 1 : 0, now, now]
  );
  if (result.insertId) {
    return result.insertId;
  } else {
    throw new Error('Failed to insert note');
  }
};

export const updateNote = async (note: Note): Promise<void> => {
  const now = new Date().toISOString();
  const result: any = await db.runAsync(
    `UPDATE notes SET title = ?, content = ?, isMarkdown = ?, updatedAt = ? WHERE id = ?`,
    [note.title, note.content, note.isMarkdown ? 1 : 0, now, note.id]
  );
  if (result.rowsAffected > 0) {
    return;
  } else {
    throw new Error('Note not found or no changes made');
  }
};

export const deleteNote = async (id: number): Promise<void> => {
  const result: any = await db.runAsync(
    'DELETE FROM notes WHERE id = ?',
    [id]
  );
  if (result.rowsAffected > 0) {
    return;
  } else {
    throw new Error('Note not found');
  }
};

export const exportNotesAsJson = async (): Promise<string> => {
  const notes = await getNotes();
  return JSON.stringify(notes, null, 2);
};

export const importNotesFromJson = async (jsonData: string): Promise<void> => {
  const notes = JSON.parse(jsonData);
  if (!Array.isArray(notes)) {
    throw new Error('Invalid JSON format: expected an array of notes');
  }
  // Validate before touching the database, so a bad backup never deletes anything.
  const valid = notes.filter(note =>
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    (typeof note.isMarkdown === 'boolean' || typeof note.isMarkdown === 'number')
  );
  if (valid.length === 0) {
    throw new Error('No valid notes found in import data.');
  }
  // One transaction: if any insert fails, the delete rolls back and the existing notes stay.
  await db.withExclusiveTransactionAsync(async txn => {
    await txn.runAsync('DELETE FROM notes');
    for (const note of valid) {
      await txn.runAsync(
        `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
        [
          note.title,
          note.content,
          note.isMarkdown ? 1 : 0,
          note.createdAt || new Date().toISOString(),
          note.updatedAt || new Date().toISOString()
        ]
      );
    }
  });
};
