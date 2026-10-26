// Word matches first, then meaning matches that are not already listed; order is kept and repeats are dropped.
export const mergeSearch = <T extends { id: number }>(words: T[], meaningIds: number[] | null, byId: Map<number, T>): { words: T[]; related: T[] } => {
  const seen = new Set(words.map(n => n.id));
  const related: T[] = [];
  for (const id of meaningIds ?? []) {
    const note = byId.get(id);
    if (!note || seen.has(id)) continue;
    seen.add(id);
    related.push(note);
  }
  return { words, related };
};
