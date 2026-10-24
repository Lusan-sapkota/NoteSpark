// All note reads and writes. database.ts only opens the database and runs migrations.
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

export const updateNote = async (note: Pick<Note, 'id' | 'title' | 'content' | 'isMarkdown'>): Promise<void> => {
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

export const clearAllNotes = async (): Promise<void> => {
  await db.runAsync('DELETE FROM notes');
};

export const exportNotesAsJson = async (): Promise<string> => {
  const notes = await getNotes();
  return JSON.stringify(notes, null, 2);
};

export type ImportMode = 'merge' | 'append' | 'replace';

const isImportable = (note: any) =>
  typeof note?.title === 'string' &&
  typeof note?.content === 'string' &&
  (typeof note?.isMarkdown === 'boolean' || typeof note?.isMarkdown === 'number');

// A duplicate is a note with the same title and text.
const noteKey = (note: { title: string; content: string }) => `${note.title}\u0000${note.content}`;

// merge: add notes that aren't already here; append: add everything; replace: delete all, then add.
// Validates first, then writes in one transaction, so a failure part-way leaves the existing notes untouched.
export const importNotes = async (notes: any[], mode: ImportMode): Promise<{ imported: number; skipped: number }> => {
  const valid = notes.filter(isImportable);
  if (valid.length === 0) {
    throw new Error('No valid notes found in import data.');
  }
  let imported = 0;
  await db.withExclusiveTransactionAsync(async txn => {
    if (mode === 'replace') {
      await txn.runAsync('DELETE FROM notes');
    }
    const seen = new Set<string>();
    if (mode === 'merge') {
      const existing = await txn.getAllAsync<{ title: string; content: string }>('SELECT title, content FROM notes');
      existing.forEach(note => seen.add(noteKey(note)));
    }
    for (const note of valid) {
      if (mode === 'merge') {
        const key = noteKey(note);
        if (seen.has(key)) continue;
        seen.add(key);
      }
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
      imported++;
    }
  });
  return { imported, skipped: valid.length - imported };
};
