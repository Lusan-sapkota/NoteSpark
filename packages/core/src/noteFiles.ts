import type { Note } from './types';
import { t } from './i18n';

// The JSON backup format: the stored note fields, with isMarkdown as a boolean.
export const notesToJson = (notes: Note[]) =>
  JSON.stringify(notes.map(note => ({ ...note, isMarkdown: !!note.isMarkdown })), null, 2);

// One file per note, named after the title, with dates and flags in front matter; plain notes get .txt.
export const noteToMarkdown = (note: Note) => {
  const meta = [
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    ...(note.isPinned ? ['pinned: true'] : []),
    ...(note.isArchived ? ['archived: true'] : []),
  ];
  return `---\n${meta.join('\n')}\n---\n\n${note.content}\n`;
};

export const fileBase = (title: string) =>
  title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || t('common.untitledNote');

export const fileName = (note: Note, taken: Set<string>) => {
  const ext = note.isMarkdown ? 'md' : 'txt';
  let name = `${fileBase(note.title)}.${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${fileBase(note.title)} (${i}).${ext}`;
  taken.add(name.toLowerCase());
  return name;
};

// The reverse of noteToMarkdown; other front matter keys stay in the note.
export const markdownToNote = (fileName: string, text: string) => {
  const base = fileName.split('/').pop() ?? fileName;
  const ext = base.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
  const meta: Record<string, string> = {};
  let body = text.replace(/\r\n?/g, '\n');
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(body);
  if (front) {
    const kept = front[1].split('\n').filter(line => {
      const m = /^(created|updated|pinned|archived):\s*(.*)$/.exec(line);
      if (m) meta[m[1]] = m[2].trim();
      return !m;
    });
    body = (kept.some(l => l.trim()) ? `---\n${kept.join('\n')}\n---\n` : '') + body.slice(front[0].length).replace(/^\n+/, '');
  }
  const date = (value?: string) => (value && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString());
  return {
    title: base.replace(/\.[^.]+$/, '').trim() || t('common.untitledNote'),
    content: body.replace(/\n$/, ''),
    isMarkdown: ext !== 'txt',
    createdAt: date(meta.created),
    updatedAt: date(meta.updated ?? meta.created),
    isPinned: meta.pinned === 'true',
    isArchived: meta.archived === 'true',
  };
};

export const isNoteFile = (name: string) => /\.(md|markdown|txt)$/i.test(name) && !/(^|\/)(\.|__MACOSX\/)/.test(name);

// A zip is read into memory entry by entry, with each entry sized from a number the file itself declares, so a small
// hostile zip can ask for gigabytes. This is the unzip filter for every importer: it counts what it keeps and refuses a file
// whose entries, one by one or together, ask for more than a real export holds (32 MB per entry, as for any note or attachment).
export const ZIP_MAX_ENTRIES = 10_000;
export const ZIP_MAX_BYTES = 256 * 1024 * 1024;
const ZIP_ENTRY_MAX_BYTES = 32 * 1024 * 1024;
export const ZIP_TOO_LARGE_MESSAGE = 'This zip is too large to import. Split it into smaller zips and import them one at a time.';
export const zipImportGate = (keep: (name: string) => boolean) => {
  let entries = 0;
  let bytes = 0;
  return (f: { name: string; originalSize: number }) => {
    if (!keep(f.name)) return false;
    entries += 1;
    bytes += f.originalSize;
    if (entries > ZIP_MAX_ENTRIES || bytes > ZIP_MAX_BYTES || !(f.originalSize <= ZIP_ENTRY_MAX_BYTES)) throw new Error(ZIP_TOO_LARGE_MESSAGE);
    return true;
  };
};
