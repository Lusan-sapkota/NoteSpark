import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
