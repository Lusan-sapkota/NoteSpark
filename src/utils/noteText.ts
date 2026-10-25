// Typing helpers shared by the editor and the scratchpad.

// A note saved without a title is named after its first line of text.
export const titleFromText = (text: string) =>
  (text.split('\n').map(line => line.replace(/!?\[[^\]]*\]\([^)]*\)|\[Image: [^\]]*\]|^\s*(?:#+|>|[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/g, '').trim()).find(Boolean) ?? '').slice(0, 60);

// Enter on a list line starts the next item ("- ", "- [ ] ", "2. "); Enter on an empty item ends the list.
// Null when the change wasn't one typed line break.
export const continueList = (prev: string, next: string, cursor: number): { text: string; cursor: number } | null => {
  if (next.length !== prev.length + 1) return null;
  let end = 0;
  while (end < prev.length && prev[end] === next[end]) end++;
  if (next[end] !== '\n' || next.slice(end + 1) !== prev.slice(end)) return null;
  // A break typed beside other breaks could be at any of them: the cursor's if it's there, else the first.
  let start = end;
  while (start > 0 && prev[start - 1] === '\n') start--;
  const at = cursor >= start && cursor <= end ? cursor : start;
  const lineStart = at === 0 ? 0 : prev.lastIndexOf('\n', at - 1) + 1;
  const m = /^(\s*)(?:([-*+])( \[[ xX]\])?|(\d+)([.)])) (.*)$/.exec(prev.slice(lineStart, at));
  if (!m) return null;
  const [, indent, bullet, box, num, delim, rest] = m;
  if (!rest.trim()) return { text: prev.slice(0, lineStart) + prev.slice(at), cursor: lineStart };
  const marker = `${indent}${bullet ? `${bullet}${box ? ' [ ]' : ''}` : `${Number(num) + 1}${delim}`} `;
  return { text: `${prev.slice(0, at)}\n${marker}${prev.slice(at)}`, cursor: at + 1 + marker.length };
};
