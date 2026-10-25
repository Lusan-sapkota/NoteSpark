import { Note } from './types';

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
  title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled note';

export const fileName = (note: Note, taken: Set<string>) => {
  const ext = note.isMarkdown ? 'md' : 'txt';
  let name = `${fileBase(note.title)}.${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${fileBase(note.title)} (${i}).${ext}`;
  taken.add(name.toLowerCase());
  return name;
};

// The reverse of noteToMarkdown, for Markdown and text files from NoteSpark or other apps (Obsidian, Markor…).
// created/updated/pinned/archived come from front matter; other front matter keys stay in the note.
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
    title: base.replace(/\.[^.]+$/, '').trim() || 'Untitled note',
    content: body.replace(/\n$/, ''),
    isMarkdown: ext !== 'txt',
    createdAt: date(meta.created),
    updatedAt: date(meta.updated ?? meta.created),
    isPinned: meta.pinned === 'true',
    isArchived: meta.archived === 'true',
  };
};

export const isNoteFile = (name: string) => /\.(md|markdown|txt)$/i.test(name) && !/(^|\/)(\.|__MACOSX\/)/.test(name);
