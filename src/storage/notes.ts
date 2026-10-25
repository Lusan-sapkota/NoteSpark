// All note reads and writes. database.ts only opens the database and runs migrations.
import { db } from './database';
import { Note, NoteVersion } from '../types';
import { TaskLine, toggleTaskLine } from '../utils/tasks';

// Bumped after every write finishes, so screens can skip reloading when nothing changed. After, not before:
// a reload in between would read the old rows and then believe it was up to date.
let notesVersion = 0;
export const getNotesVersion = () => notesVersion;

export const changesNotes = <A extends unknown[], R>(write: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
  try {
    return await write(...args);
  } finally {
    notesVersion++;
  }
};

export const toNote = (item: any): Note => ({
  ...item,
  isMarkdown: Boolean(item.isMarkdown),
  isPinned: Boolean(item.isPinned),
  isArchived: Boolean(item.isArchived),
});

// Every note not in the bin, archived ones included; screens filter archived notes themselves.
export const getNotes = async (): Promise<Note[]> => {
  const rows = await db.getAllAsync('SELECT * FROM notes WHERE deletedAt IS NULL ORDER BY updatedAt DESC');
  return rows.map(toNote);
};

// Notes that contain a [[link]], for backlinks; SQL narrows it before the exact match in JS.
export const getNotesWithLinks = async (): Promise<Note[]> => {
  const rows = await db.getAllAsync("SELECT * FROM notes WHERE deletedAt IS NULL AND content LIKE '%[[%'");
  return rows.map(toNote);
};

export const getNoteById = async (id: number): Promise<Note | null> => {
  try {
    const items = await db.getAllAsync('SELECT * FROM notes WHERE id = ? AND deletedAt IS NULL', [id]);
    if (items && items.length > 0) {
      const item = items[0] as any;
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        isMarkdown: Boolean(item.isMarkdown),
        isPinned: Boolean(item.isPinned),
        isArchived: Boolean(item.isArchived),
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

export const saveNote = changesNotes(async (note: Omit<Note, 'id' | 'isPinned' | 'isArchived'>): Promise<number> => {
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    [note.title, note.content, note.isMarkdown ? 1 : 0, now, now]
  );
  if (result.lastInsertRowId) {
    return result.lastInsertRowId;
  } else {
    throw new Error('Failed to insert note');
  }
});

const VERSIONS_KEPT = 20;

// Keeps the stored text as a version before it's overwritten; only the newest VERSIONS_KEPT stay.
const saveVersion = async (note: Pick<Note, 'id' | 'title' | 'content' | 'isMarkdown'>, now: string) => {
  const old = await db.getFirstAsync<{ title: string; content: string; isMarkdown: number }>(
    'SELECT title, content, isMarkdown FROM notes WHERE id = ?', [note.id]
  );
  if (!old || (old.title === note.title && old.content === note.content && !!old.isMarkdown === note.isMarkdown)) return;
  await db.runAsync(
    'INSERT INTO note_versions (noteId, title, content, isMarkdown, savedAt) VALUES (?, ?, ?, ?, ?)',
    [note.id, old.title, old.content, old.isMarkdown, now]
  );
  await db.runAsync(
    `DELETE FROM note_versions WHERE noteId = ? AND id NOT IN
      (SELECT id FROM note_versions WHERE noteId = ? ORDER BY savedAt DESC, id DESC LIMIT ?)`,
    [note.id, note.id, VERSIONS_KEPT]
  );
};

export const getNoteVersions = async (noteId: number): Promise<NoteVersion[]> => {
  const rows = await db.getAllAsync<any>('SELECT * FROM note_versions WHERE noteId = ? ORDER BY savedAt DESC, id DESC', [noteId]);
  return rows.map(r => ({ ...r, isMarkdown: Boolean(r.isMarkdown) }));
};

// `keepVersion: false` for small automatic edits (ticking a task) that shouldn't fill the history.
export const updateNote = changesNotes(async (
  note: Pick<Note, 'id' | 'title' | 'content' | 'isMarkdown'>,
  { keepVersion = true } = {},
): Promise<void> => {
  const now = new Date().toISOString();
  if (keepVersion) await saveVersion(note, now);
  const result = await db.runAsync(
    `UPDATE notes SET title = ?, content = ?, isMarkdown = ?, updatedAt = ? WHERE id = ?`,
    [note.title, note.content, note.isMarkdown ? 1 : 0, now, note.id]
  );
  if (result.changes > 0) {
    return;
  } else {
    throw new Error('Note not found or no changes made');
  }
});

export const moveNoteToBin = changesNotes(async (id: number): Promise<void> => {
  await db.runAsync('UPDATE notes SET deletedAt = ? WHERE id = ?', [new Date().toISOString(), id]);
});

export const restoreNote = changesNotes(async (id: number): Promise<void> => {
  await db.runAsync('UPDATE notes SET deletedAt = NULL WHERE id = ?', [id]);
});

export const getBinNotes = async (): Promise<Note[]> => {
  const rows = await db.getAllAsync('SELECT * FROM notes WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC');
  return rows.map(toNote);
};

export const emptyBin = changesNotes(async (): Promise<void> => {
  await db.runAsync('DELETE FROM notes WHERE deletedAt IS NOT NULL');
});

// Erases the note for good; the app moves notes to the bin first.
export const deleteNote = changesNotes(async (id: number): Promise<void> => {
  const result = await db.runAsync(
    'DELETE FROM notes WHERE id = ?',
    [id]
  );
  if (result.changes > 0) {
    return;
  } else {
    throw new Error('Note not found');
  }
});

// Pinning isn't an edit, so updatedAt stays as it is.
export const setNotePinned = changesNotes(async (id: number, pinned: boolean): Promise<void> => {
  await db.runAsync('UPDATE notes SET isPinned = ? WHERE id = ?', [pinned ? 1 : 0, id]);
});

// Archiving unpins the note (like Keep), so the archive has no pinned group. Not an edit: updatedAt stays.
export const setNoteArchived = changesNotes(async (id: number, archived: boolean): Promise<void> => {
  await db.runAsync(
    `UPDATE notes SET isArchived = ?, isPinned = CASE WHEN ? THEN 0 ELSE isPinned END WHERE id = ?`,
    [archived ? 1 : 0, archived ? 1 : 0, id]
  );
});

export const toggleTaskInNote = async (noteId: number, task: Pick<TaskLine, 'line' | 'raw'>): Promise<string | null> => {
  const note = await getNoteById(noteId);
  const result = note && toggleTaskLine(note.content, task);
  if (!note || !result) return null;
  await updateNote({ ...note, content: result.content }, { keepVersion: false });
  return result.raw;
};

// Returns the deletion time, which marks this batch for restoreBatch.
export const moveAllNotesToBin = changesNotes(async (): Promise<string> => {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE notes SET deletedAt = ? WHERE deletedAt IS NULL', [now]);
  return now;
});

export const restoreBatch = changesNotes(async (deletedAt: string): Promise<void> => {
  await db.runAsync('UPDATE notes SET deletedAt = NULL WHERE deletedAt = ?', [deletedAt]);
});

// Erases every note outside the bin; the bin is untouched.
export const deleteAllNotesForever = changesNotes(async (): Promise<void> => {
  await db.runAsync('DELETE FROM notes WHERE deletedAt IS NULL');
});

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
export const importNotes = changesNotes(async (notes: any[], mode: ImportMode): Promise<{ imported: number; skipped: number }> => {
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
      const existing = await txn.getAllAsync<{ title: string; content: string }>('SELECT title, content FROM notes WHERE deletedAt IS NULL');
      existing.forEach(note => seen.add(noteKey(note)));
    }
    for (const note of valid) {
      if (mode === 'merge') {
        const key = noteKey(note);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      await txn.runAsync(
        `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, isPinned, isArchived) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          note.title,
          note.content,
          note.isMarkdown ? 1 : 0,
          note.createdAt || new Date().toISOString(),
          note.updatedAt || new Date().toISOString(),
          note.isPinned ? 1 : 0, // older backups have no isPinned: unpinned
          note.isArchived ? 1 : 0,
        ]
      );
      imported++;
    }
  });
  return { imported, skipped: valid.length - imported };
});
