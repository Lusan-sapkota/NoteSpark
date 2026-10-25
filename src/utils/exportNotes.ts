import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';
import { Note } from '../types';

// The JSON backup format: the stored note fields, with isMarkdown as a boolean.
export const notesToJson = (notes: Note[]) =>
  JSON.stringify(notes.map(note => ({ ...note, isMarkdown: !!note.isMarkdown })), null, 2);

// Writes to the app cache (no storage permission needed), then the share sheet saves it wherever the person picks.
export const shareNotesAsJson = async (notes: Note[]): Promise<void> => {
  const uri = `${FileSystem.cacheDirectory}notespark-export-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(uri, notesToJson(notes), { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save or share your notes' });
};

// Markdown export: one file per note, named after the title, with dates and flags in front matter (Obsidian reads
// it). Plain-text notes get .txt. Images that point to files on this phone won't open elsewhere.
export const noteToMarkdown = (note: Note) => {
  const meta = [
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    ...(note.isPinned ? ['pinned: true'] : []),
    ...(note.isArchived ? ['archived: true'] : []),
  ];
  return `---\n${meta.join('\n')}\n---\n\n${note.content}\n`;
};

const fileBase = (title: string) =>
  title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled note';

const fileName = (note: Note, taken: Set<string>) => {
  const ext = note.isMarkdown ? 'md' : 'txt';
  let name = `${fileBase(note.title)}.${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${fileBase(note.title)} (${i}).${ext}`;
  taken.add(name.toLowerCase());
  return name;
};

export const shareNoteAsMarkdown = async (note: Note): Promise<void> => {
  const file = new File(Paths.cache, fileName(note, new Set()));
  await file.write(noteToMarkdown(note));
  await Sharing.shareAsync(file.uri, { mimeType: note.isMarkdown ? 'text/markdown' : 'text/plain', dialogTitle: 'Save or share this note' });
};

// All notes as Markdown files in one zip.
export const notesToZip = (notes: Note[]): Uint8Array => {
  const taken = new Set<string>();
  return zipSync(Object.fromEntries(notes.map(note => [fileName(note, taken), strToU8(noteToMarkdown(note))])));
};

export const shareNotesAsZip = async (notes: Note[]): Promise<void> => {
  const file = new File(Paths.cache, `notespark-markdown-${Date.now()}.zip`);
  await file.write(notesToZip(notes));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'Save or share your notes' });
};
