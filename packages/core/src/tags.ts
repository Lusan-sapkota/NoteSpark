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

// Tags that notes close in meaning use and this one doesn't have yet, most common first (at most `limit`).
export const suggestTags = (ownTags: string[], relatedContents: string[], limit = 3): string[] => {
  const own = new Set(ownTags.map(t => t.toLowerCase()));
  const counts = new Map<string, number>();
  for (const content of relatedContents) {
    for (const tag of extractTags(content)) if (!own.has(tag.toLowerCase())) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag);
};
