// Shared attachment limits and pure link helpers (no Expo, React Native or Node imports).

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_NOTE_BYTES = 32 * 1024 * 1024;
export const ATTACHMENT_TOO_LARGE_MESSAGE = 'That file is over 32 MB. Attach a smaller one.';

export const ATTACHMENT_HASH_RE = /^[0-9a-f]{64}$/;

// Matches [display name](attachment:<64-hex>) inside note Markdown.
const LINK_RE = /\[([^\]\r\n]*)\]\(attachment:([0-9a-fA-F]{64})\)/g;
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

export const referencedHashes = (notes: Iterable<{ content?: string | null } | string>): Set<string> => {
  const used = new Set<string>();
  for (const item of notes) {
    const text = typeof item === 'string' ? item : String(item?.content ?? '');
    if (!text) continue;
    const re = new RegExp(HASH_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      used.add(match[1].toLowerCase());
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
  const re = new RegExp(`(?:^|\\n)?\\[[^\\]\\r\\n]*\\]\\(attachment:${target}\\)(?:\\r?\\n)?`, 'gi');
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
