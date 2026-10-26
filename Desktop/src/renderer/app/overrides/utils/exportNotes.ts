// Exports are browser downloads, so they work in the window and the web view; formats come from @notespark/core.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  Note,
  fileName,
  isNoteFile,
  markdownToNote,
  noteToMarkdown,
  notesToJson,
  parseAttachmentLinks,
  referencedHashes,
  sanitizeAttachmentName,
} from '@notespark/core';
import { addAttachment, hasAttachment, readAttachment } from '../storage/attachments';

const download = (name: string, type: string, data: BlobPart) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const shareNotesAsJson = async (notes: Note[]) =>
  download(`notespark-export-${Date.now()}.json`, 'application/json', notesToJson(notes));

export const shareNoteAsMarkdown = async (note: Note) =>
  download(fileName(note, new Set()), note.isMarkdown ? 'text/markdown' : 'text/plain', noteToMarkdown(note));

export const notesToZip = (notes: Note[], attachmentEntries: Record<string, Uint8Array> = {}): Uint8Array => {
  const taken = new Set<string>();
  const noteEntries = Object.fromEntries(notes.map(note => [fileName(note, taken), strToU8(noteToMarkdown(note))]));
  return zipSync({ ...noteEntries, ...attachmentEntries });
};

export const buildNotesZip = async (
  notes: Note[],
  options: { includeAttachments?: boolean } = {}
): Promise<Uint8Array> => {
  const includeAttachments = options.includeAttachments ?? true;
  const attachmentEntries: Record<string, Uint8Array> = {};
  if (includeAttachments) {
    const namesByHash = new Map<string, string>();
    for (const note of notes) {
      for (const link of parseAttachmentLinks(note.content)) {
        if (!namesByHash.has(link.hash)) {
          namesByHash.set(link.hash, sanitizeAttachmentName(link.name));
        }
      }
      for (const hash of referencedHashes([note])) {
        if (!namesByHash.has(hash)) {
          namesByHash.set(hash, hash);
        }
      }
    }
    for (const [hash, name] of namesByHash) {
      if (await hasAttachment(hash)) {
        const plain = await readAttachment(hash);
        attachmentEntries[`attachments/${hash}-${name}`] = plain;
      }
    }
  }
  return notesToZip(notes, attachmentEntries);
};

export const shareNotesAsZip = async (
  notes: Note[],
  options: { includeAttachments?: boolean } = {}
) => {
  const zip = await buildNotesZip(notes, options);
  download(`notespark-markdown-${Date.now()}.zip`, 'application/zip', zip as BlobPart);
};

const ATTACHMENT_ZIP_ENTRY_RE = /^attachments\/([0-9a-fA-F]{64})(?:-(.+))?$/;

export const notesFromZipBytes = async (zipBytes: Uint8Array): Promise<any[]> => {
  const entries = unzipSync(zipBytes, {
    filter: f => {
      if (ATTACHMENT_ZIP_ENTRY_RE.test(f.name)) {
        if (f.originalSize > MAX_ATTACHMENT_BYTES) {
          throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
        }
        return true;
      }
      return !f.name.startsWith('attachments/') && isNoteFile(f.name);
    },
  });

  const noteEntries: [string, Uint8Array][] = [];
  for (const [path, data] of Object.entries(entries)) {
    const m = ATTACHMENT_ZIP_ENTRY_RE.exec(path);
    if (m) {
      const expectedHash = m[1].toLowerCase();
      const rawName = m[2] || expectedHash;
      if (data.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
      }
      const actualHash = bytesToHex(sha256(data));
      if (actualHash !== expectedHash) {
        throw new Error(`Attachment hash mismatch in archive for ${rawName}`);
      }
      await addAttachment({ bytes: data, name: sanitizeAttachmentName(rawName), size: data.byteLength });
    } else if (isNoteFile(path)) {
      noteEntries.push([path, data]);
    }
  }

  return noteEntries.map(([path, data]) => markdownToNote(path, strFromU8(data)));
};

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
    return notesFromZipBytes(new Uint8Array(await response.arrayBuffer()));
  }
  throw new Error('Unsupported file');
};
