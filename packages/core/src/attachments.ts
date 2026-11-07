// Shared attachment limits and pure link helpers (no Expo, React Native or Node imports).

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_NOTE_BYTES = 32 * 1024 * 1024;
export const ATTACHMENT_TOO_LARGE_MESSAGE = 'That file is over 32 MB. Attach a smaller one.';

export const ATTACHMENT_HASH_RE = /^[0-9a-f]{64}$/;

// Matches [display name](attachment:<64-hex>) inside note Markdown. `![Image](attachment:…)` is a picture, not a document card.
const LINK_RE = /(?<!!)\[([^\]\r\n]*)\]\(attachment:([0-9a-fA-F]{64})\)/g;
// Matches any attachment:<64-hex> reference (even if link text was edited).
const HASH_RE = /attachment:([0-9a-fA-F]{64})\b/g;

export interface AttachmentLink {
  name: string;
  hash: string;
  raw: string;
  index: number;
}

// Strips path separators, traversal segments and control characters so a note can never pick a folder path.
export const sanitizeAttachmentName = (rawName: string): string => {
  const base = String(rawName ?? '')
    .split(/[\\/]/)
    .pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || 'attachment';
};

const sanitizeLinkText = (name: string): string =>
  sanitizeAttachmentName(name).replace(/[\[\]]/g, '');

export const formatAttachmentLink = (name: string, hash: string): string => {
  const normalized = hash.toLowerCase();
  if (!ATTACHMENT_HASH_RE.test(normalized)) {
    throw new Error(`Invalid attachment hash: ${hash}`);
  }
  const label = sanitizeLinkText(name) || 'attachment';
  return `[${label}](attachment:${normalized})`;
};

export const parseAttachmentLinks = (content: string): AttachmentLink[] => {
  if (!content) return [];
  const out: AttachmentLink[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(LINK_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    out.push({
      name: sanitizeAttachmentName(match[1] || 'attachment'),
      hash: match[2].toLowerCase(),
      raw: match[0],
      index: match.index,
    });
  }
  return out;
};

// A note's picture background is `attachment:<hash>` in its `background` field, so that counts as used too.
export const referencedHashes = (notes: Iterable<{ content?: string | null; background?: string | null } | string>): Set<string> => {
  const used = new Set<string>();
  for (const item of notes) {
    const texts = typeof item === 'string' ? [item] : [String(item?.content ?? ''), String(item?.background ?? '')];
    for (const text of texts) {
      if (!text) continue;
      const re = new RegExp(HASH_RE.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        used.add(match[1].toLowerCase());
      }
    }
  }
  return used;
};

export const appendAttachmentLink = (content: string, name: string, hash: string): string => {
  const link = formatAttachmentLink(name, hash);
  if (!content) return link;
  const sep = content.endsWith('\n') ? '' : '\n';
  return `${content}${sep}${link}`;
};

export const removeAttachmentLink = (content: string, hash: string, occurrence = 0): string => {
  const target = hash.toLowerCase();
  let seen = 0;
  const re = new RegExp(`(?:^|\\n)?(?<!!)\\[[^\\]\\r\\n]*\\]\\(attachment:${target}\\)(?:\\r?\\n)?`, 'gi');
  return content.replace(re, (full) => {
    if (seen++ !== occurrence) return full;
    if (full.startsWith('\n') && /\r?\n$/.test(full)) return '\n';
    return '';
  });
};

export const formatAttachmentSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Pictures added to a note are stored as attachments (encrypted, synced with the note) and shown from the stored copy.
export const formatAttachmentImage = (hash: string): string => `![Image](attachment:${hash.toLowerCase()})`;
export const attachmentImageHash = (uri: string): string | null => {
  const m = /^attachment:([0-9a-fA-F]{64})$/.exec(uri.trim());
  return m ? m[1].toLowerCase() : null;
};
// Image addresses in note text: Markdown `![alt](uri)` and, for plain notes, `[Image: uri]`.
export const extractImageRefs = (content: string, includePlain = false): string[] => {
  // The address ends at the first space, so an optional Markdown title (`![a](url "title")`) isn't part of it.
  const uris = Array.from(content.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g), m => m[1].trim());
  if (includePlain) uris.push(...Array.from(content.matchAll(/\[Image: ([^\]]+)\]/g), m => m[1].trim()));
  return uris.filter(Boolean);
};
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const imageType = (b: Uint8Array): string | null => {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
};
// A data address for the image view (the same on the phone and the desktop page); null if the bytes are not a picture.
export const imageDataUri = (bytes: Uint8Array): string | null => {
  const type = imageType(bytes);
  if (!type) return null;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63] + (i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? BASE64[n & 63] : '='));
  }
  return `data:${type};base64,${parts.join('')}`;
};
// Reads a stored picture and keeps the last few in memory, so a note with pictures doesn't decrypt them again on every redraw.
// `read` may give real bytes (the phone, the desktop window) or the index-keyed object a JSON reply turns them into (the browser web view).
export const attachmentImageLoader = (read: (hash: string) => Promise<Uint8Array | Record<string, number>>, keep = 6) => {
  const memory = new Map<string, string>();
  return async (hash: string): Promise<string | null> => {
    const hit = memory.get(hash);
    if (hit) return hit;
    try {
      const got = await read(hash);
      const src = imageDataUri(got instanceof Uint8Array ? got : Uint8Array.from(Object.values(got)));
      if (src) {
        memory.set(hash, src);
        if (memory.size > keep) memory.delete(memory.keys().next().value as string);
      }
      return src;
    } catch {
      return null;
    }
  };
};
