import { Note } from './types';

// [[Note title]] links between notes. Titles match ignoring case and surrounding spaces; a title containing
// [ ] or a line break can't be linked.
export const noteLinkPattern = /\[\[([^[\]\n]+)\]\]/g;

const titleKey = (title: string) => title.trim().toLowerCase();

export const linkedTitles = (content: string): string[] => [...content.matchAll(noteLinkPattern)].map(m => m[1].trim());

export const findNoteByTitle = (notes: Note[], title: string): Note | undefined =>
  notes.find(n => titleKey(n.title) === titleKey(title));

export const linksTo = (content: string, title: string): boolean =>
  !!title.trim() && linkedTitles(content).some(t => titleKey(t) === titleKey(title));

// [[from]] links rewritten to [[to]]; other links stay as typed.
export const renameLinks = (content: string, from: string, to: string): string =>
  content.replace(noteLinkPattern, (whole, title: string) => (titleKey(title) === titleKey(from) ? `[[${to.trim()}]]` : whole));

// Where `title` first appears as whole words outside a [[link]], or -1. Titles under 3 characters aren't looked for.
export const findMention = (content: string, title: string): number => {
  const t = title.trim();
  if (t.length < 3) return -1;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of content.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))) {
    const before = content.slice(0, m.index);
    if (before.lastIndexOf('[[') <= before.lastIndexOf(']]')) return m.index!;
  }
  return -1;
};

// Turns the first plain mention of `title` into a [[link]], keeping the text as written.
export const linkMention = (content: string, title: string): string => {
  const at = findMention(content, title);
  const end = at + title.trim().length;
  return at < 0 ? content : `${content.slice(0, at)}[[${content.slice(at, end)}]]${content.slice(end)}`;
};
