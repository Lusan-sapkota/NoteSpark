// Exports become browser downloads, so they work the same in the desktop window (it asks where to save) and the web view.
import { fileName, noteToMarkdown, notesToJson, Note } from '@notespark/core';

const download = (name: string, type: string, data: string) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const shareNotesAsJson = async (notes: Note[]) => download(`notespark-export-${Date.now()}.json`, 'application/json', notesToJson(notes));
export const shareNoteAsMarkdown = async (note: Note) =>
  download(fileName(note, new Set()), note.isMarkdown ? 'text/markdown' : 'text/plain', noteToMarkdown(note));
// ponytail: zip needs fflate, a dependency to approve; added with the import and export screen in phase 3.
export const shareNotesAsZip = async (_notes: Note[]): Promise<void> => { throw new Error('Zip export is not available on desktop yet'); };
