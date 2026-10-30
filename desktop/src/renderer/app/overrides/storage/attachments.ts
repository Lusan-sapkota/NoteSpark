// Stands in for mobile/src/storage/attachments.ts in the desktop renderer: the real module runs in the main process.
import {
  ATTACHMENT_HASH_RE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_NOTE_BYTES,
  appendAttachmentLink,
  formatAttachmentLink,
  formatAttachmentSize,
  parseAttachmentLinks,
  referencedHashes,
  removeAttachmentLink,
  sanitizeAttachmentName,
} from '@notespark/core';
import type * as Real from '../../../../../../mobile/src/storage/attachments';
import type { AddAttachmentInput } from '../../../../../../mobile/src/storage/attachments';
import { storageProxy } from '../../bridge';

export {
  ATTACHMENT_HASH_RE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_NOTE_BYTES,
  appendAttachmentLink,
  formatAttachmentLink,
  formatAttachmentSize,
  parseAttachmentLinks,
  referencedHashes,
  removeAttachmentLink,
  sanitizeAttachmentName,
};

export const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000;

const api = storageProxy<typeof Real>('attachments', [
  'addAttachment',
  'readAttachment',
  'hasAttachment',
  'getAttachmentMeta',
  'openAttachmentInViewer',
  'clearAttachmentTempDir',
  'listAttachments',
  'pruneAttachments',
  'copyAttachmentsForTransfer',
  'deleteProfileAttachments',
] as const);

export const {
  readAttachment,
  hasAttachment,
  getAttachmentMeta,
  openAttachmentInViewer,
  clearAttachmentTempDir,
  listAttachments,
  pruneAttachments,
  copyAttachmentsForTransfer,
  deleteProfileAttachments,
} = api;

export const addAttachment = async (
  input: AddAttachmentInput,
  profileId?: string
): Promise<{ hash: string; size: number; name: string }> => {
  if (typeof input.size === 'number' && input.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  }
  if ('uri' in input && input.uri) {
    const res = await fetch(input.uri);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
    }
    return api.addAttachment({ bytes, name: input.name, size: bytes.byteLength }, profileId);
  }
  if ('bytes' in input && input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  }
  return api.addAttachment(input, profileId);
};

export const openAttachmentTemp = async (
  hash: string,
  displayName: string,
  profileId?: string
): Promise<{ uri: string; cleanup: () => Promise<void> }> => {
  await api.openAttachmentInViewer(hash, displayName, profileId);
  return { uri: '', cleanup: async () => {} };
};
