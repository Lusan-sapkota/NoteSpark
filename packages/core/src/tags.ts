// #tags come from note text; headings, number-only tags and fenced code don't count.
const tagPattern = /(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const fence = /^\s*(```|~~~)/;

// Lowercase and without duplicates, in order of first use.
export const extractTags = (content: string): string[] => {
  const tags = new Set<string>();
  let inFence = false;
  for (const line of content.split('\n')) {
    if (fence.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(tagPattern)) {
      const tag = m[2].replace(/[-/]+$/, '').toLowerCase();
      if (tag && !/^\d+$/.test(tag)) tags.add(tag);
    }
  }
  return [...tags];
};
