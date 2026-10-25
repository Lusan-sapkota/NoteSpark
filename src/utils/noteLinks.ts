import { Note } from '../types';

// [[Note title]] links between notes. Titles match ignoring case and surrounding spaces; a title containing
// [ ] or a line break can't be linked.
export const noteLinkPattern = /\[\[([^[\]\n]+)\]\]/g;

const titleKey = (title: string) => title.trim().toLowerCase();

export const linkedTitles = (content: string): string[] => [...content.matchAll(noteLinkPattern)].map(m => m[1].trim());

export const findNoteByTitle = (notes: Note[], title: string): Note | undefined =>
  notes.find(n => titleKey(n.title) === titleKey(title));

export const linksTo = (content: string, title: string): boolean =>
  !!title.trim() && linkedTitles(content).some(t => titleKey(t) === titleKey(title));
