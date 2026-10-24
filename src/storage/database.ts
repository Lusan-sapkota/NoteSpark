import * as DocumentPicker from 'expo-document-picker';
export const importNotesFromFile = async (): Promise<number> => {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    if (!result.assets || result.assets.length === 0 || !result.assets[0].uri) throw new Error('No file selected');
    const json = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
    return await importNotesFromJson(json);
  } catch (error) {
    throw error;
  }
};
import * as FileSystem from 'expo-file-system/legacy';

export const exportNotesToFile = async (): Promise<string> => {
  try {
    const json = await exportNotesAsJson();
    const fileName = `NoteSpark-Export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const fileUri = FileSystem.cacheDirectory + fileName;
    await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });
    const Share = require('react-native').Share;
    await Share.share({
      url: fileUri,
      title: 'NoteSpark Notes Backup',
      message: 'Your notes backup file. To save this file to Downloads or device storage, select a file manager or cloud storage app in the share list. If you do not see a file manager, please install one from the Play Store or App Store. If you have multiple file managers, try different ones. You can also save to Google Drive, Dropbox, or other cloud apps.'
    });
    return fileName;
  } catch (error) {
    throw error;
  }
};
export const importNotesFromJson = async (json: string): Promise<number> => {
  try {
    const notes = JSON.parse(json);
    if (!Array.isArray(notes)) throw new Error('Invalid notes format');
    let importedCount = 0;
    // All or nothing: a failure part-way rolls back the notes already added.
    await db.withTransactionAsync(async () => {
      for (const note of notes) {
        if (
          typeof note.title === 'string' &&
          typeof note.content === 'string' &&
          typeof note.isMarkdown === 'boolean'
        ) {
          await saveNote({
            title: note.title,
            content: note.content,
            isMarkdown: note.isMarkdown,
            createdAt: note.createdAt || new Date().toISOString(),
            updatedAt: note.updatedAt || new Date().toISOString(),
          });
          importedCount++;
        }
      }
    });
    return importedCount;
  } catch (error) {
    throw error;
  }
};
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

