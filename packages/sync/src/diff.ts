import type * as Y from 'yjs';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

// Turns the editor's old and new text into the one change between them (common prefix and suffix kept), so
// concurrent edits elsewhere in the note still merge. Never cuts a surrogate pair. Returns whether it changed.
// ponytail: one contiguous replace per save; two far-apart edits in one save merge less finely. fast-diff if needed.
export const applyTextDiff = (text: Y.Text, next: string): boolean => {
  const prev = text.toString();
  if (prev === next) return false;
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  if (start > 0 && isHigh(prev.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < max - start && prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
  if (end > 0 && isLow(prev.charCodeAt(prev.length - end))) end--;
  const removed = prev.length - start - end;
  if (removed) text.delete(start, removed);
  const added = next.slice(start, next.length - end);
  if (added) text.insert(start, added);
  return true;
};
