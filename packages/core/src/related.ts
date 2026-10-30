// The paragraph (text between blank lines) holding `offset`, for finding notes close to what's being written.
// '' when it has fewer than `minWords` words: too little to match on.
export const paragraphToMatch = (content: string, offset: number, minWords = 15): string => {
  let start = 0;
  let paragraph = '';
  for (const gap of content.matchAll(/\n[ \t]*\n/g)) {
    if (offset <= gap.index) { paragraph = content.slice(start, gap.index); break; }
    start = gap.index + gap[0].length;
    paragraph = content.slice(start);
  }
  if (!paragraph) paragraph = content.slice(start);
  const text = paragraph.trim();
  return text.split(/\s+/).filter(Boolean).length >= minWords ? text : '';
};
