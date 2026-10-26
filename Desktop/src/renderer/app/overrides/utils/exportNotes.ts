// Exports are browser downloads, so they work in the window and the web view; formats come from @notespark/core.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { fileName, isNoteFile, markdownToNote, noteToMarkdown, notesToJson, Note } from '@notespark/core';

const download = (name: string, type: string, data: BlobPart) => {
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

export const notesToZip = (notes: Note[]): Uint8Array => {
  const taken = new Set<string>();
  return zipSync(Object.fromEntries(notes.map(note => [fileName(note, taken), strToU8(noteToMarkdown(note))])));
};
export const shareNotesAsZip = async (notes: Note[]) => download(`notespark-markdown-${Date.now()}.zip`, 'application/zip', notesToZip(notes) as BlobPart);

// Notes from one picked file: a NoteSpark .json backup, a .md or .txt note, or a .zip of those. `uri` is a blob address.
export const notesFromFile = async (uri: string, name: string): Promise<any[]> => {
  const response = await fetch(uri);
  if (/\.json$/i.test(name)) {
    const parsed = JSON.parse(await response.text());
    if (!Array.isArray(parsed)) throw new Error('Not a NoteSpark backup');
    return parsed;
  }
  if (isNoteFile(name)) return [markdownToNote(name, await response.text())];
  if (/\.zip$/i.test(name)) {
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()), { filter: f => isNoteFile(f.name) });
    return Object.entries(entries).map(([path, data]) => markdownToNote(path, strFromU8(data)));
  }
  throw new Error('Unsupported file');
};
