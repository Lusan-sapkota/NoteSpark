import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
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
  t,
} from '@notespark/core';
import { addAttachment, hasAttachment, readAttachment } from '../storage/attachments';

// Writes to the app cache (no permission needed), then the share sheet saves it.
export const shareNotesAsJson = async (notes: Note[]): Promise<void> => {
  const uri = `${FileSystem.cacheDirectory}notespark-export-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(uri, notesToJson(notes), { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: t('importExport.saveOrShareNotes') });
};

export const shareNoteAsMarkdown = async (note: Note): Promise<void> => {
  const file = new File(Paths.cache, fileName(note, new Set()));
  await file.write(noteToMarkdown(note));
  await Sharing.shareAsync(file.uri, { mimeType: note.isMarkdown ? 'text/markdown' : 'text/plain', dialogTitle: t('importExport.saveOrShareNote') });
};

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
): Promise<void> => {
  const file = new File(Paths.cache, `notespark-markdown-${Date.now()}.zip`);
  await file.write(await buildNotesZip(notes, options));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: t('importExport.saveOrShareNotes') });
};

// Notes from one picked .json backup, .md or .txt note, or .zip of those; throws on anything else.
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

export const notesFromFile = async (uri: string, name: string): Promise<any[]> => {
  const text = async () => (await readFile(uri, 'text')) as string;
  if (/\.json$/i.test(name)) {
    const parsed = JSON.parse(await text());
    if (!Array.isArray(parsed)) throw new Error('Not a NoteSpark backup');
    return parsed;
  }
  if (isNoteFile(name)) return [markdownToNote(name, await text())];
  if (/\.zip$/i.test(name)) {
    return notesFromZipBytes((await readFile(uri, 'bytes')) as Uint8Array);
  }
  throw new Error('Unsupported file');
};
