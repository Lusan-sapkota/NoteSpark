import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { fileName, isNoteFile, markdownToNote, noteToMarkdown, notesToJson, Note } from '@notespark/core';

// Writes to the app cache (no storage permission needed), then the share sheet saves it wherever the person picks.
export const shareNotesAsJson = async (notes: Note[]): Promise<void> => {
  const uri = `${FileSystem.cacheDirectory}notespark-export-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(uri, notesToJson(notes), { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save or share your notes' });
};

export const shareNoteAsMarkdown = async (note: Note): Promise<void> => {
  const file = new File(Paths.cache, fileName(note, new Set()));
  await file.write(noteToMarkdown(note));
  await Sharing.shareAsync(file.uri, { mimeType: note.isMarkdown ? 'text/markdown' : 'text/plain', dialogTitle: 'Save or share this note' });
};

export const notesToZip = (notes: Note[]): Uint8Array => {
  const taken = new Set<string>();
  return zipSync(Object.fromEntries(notes.map(note => [fileName(note, taken), strToU8(noteToMarkdown(note))])));
};

export const shareNotesAsZip = async (notes: Note[]): Promise<void> => {
  const file = new File(Paths.cache, `notespark-markdown-${Date.now()}.zip`);
  await file.write(notesToZip(notes));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'Save or share your notes' });
};

// Notes from one picked file: a NoteSpark .json backup, a .md or .txt note, or a .zip of those.
// Throws when the file is none of these.
// The picker's content:// addresses open with the File class; the legacy API is the fallback for file:// paths.
const readFile = async (uri: string, as: 'text' | 'bytes'): Promise<string | Uint8Array> => {
  try {
    const file = new File(uri);
    return as === 'text' ? await file.text() : await file.bytes();
  } catch {
    const encoding = as === 'text' ? FileSystem.EncodingType.UTF8 : FileSystem.EncodingType.Base64;
    const data = await FileSystem.readAsStringAsync(uri, { encoding });
    return as === 'text' ? data : Uint8Array.from(atob(data), c => c.charCodeAt(0));
  }
};

export const notesFromFile = async (uri: string, name: string): Promise<any[]> => {
  const text = async () => (await readFile(uri, 'text')) as string;
  if (/\.json$/i.test(name)) {
    const parsed = JSON.parse(await text());
    if (!Array.isArray(parsed)) throw new Error('Not a NoteSpark backup');
    return parsed;
  }
  if (isNoteFile(name)) return [markdownToNote(name, await text())];
  if (/\.zip$/i.test(name)) {
    const entries = unzipSync((await readFile(uri, 'bytes')) as Uint8Array, { filter: f => isNoteFile(f.name) });
    return Object.entries(entries).map(([path, data]) => markdownToNote(path, strFromU8(data)));
  }
  throw new Error('Unsupported file');
};
