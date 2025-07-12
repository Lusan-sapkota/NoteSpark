import { db } from './database';
import { Note } from '../types';

// Get all notes
export const getNotes = async (): Promise<Note[]> => {
  const rows = await db.getAllAsync('SELECT * FROM notes ORDER BY updatedAt DESC');
  return rows.map((item: any) => ({
    ...item,
    isMarkdown: Boolean(item.isMarkdown)
  }));
};

// Get a single note by ID
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

// Save a new note
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

// Update an existing note
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

// Delete a note
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

// Export all notes as JSON
export const exportNotesAsJson = async (): Promise<string> => {
  const notes = await getNotes();
  return JSON.stringify(notes, null, 2);
};

// Import notes from JSON
export const importNotesFromJson = async (jsonData: string): Promise<void> => {
  const notes = JSON.parse(jsonData) as Note[];
  if (!Array.isArray(notes)) {
    throw new Error('Invalid JSON format: expected an array of notes');
  }
  await db.runAsync('DELETE FROM notes');
  for (const note of notes) {
    await db.runAsync(
      `INSERT INTO notes (id, title, content, isMarkdown, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.title,
        note.content,
        note.isMarkdown ? 1 : 0,
        note.createdAt,
        note.updatedAt
      ]
    );
  }
};