import * as Y from 'yjs';

// When a doc's stored updates are folded into one (sync.md).
export const COMPACT_UPDATES = 200;
export const COMPACT_BYTES = 256 * 1024;

export const needsCompaction = (updates: Uint8Array[]) =>
  updates.length >= COMPACT_UPDATES || updates.reduce((n, u) => n + u.length, 0) >= COMPACT_BYTES;

// One update with the same state: loading the doc first drops deleted text, which merging the bytes would keep.
export const compact = (updates: Uint8Array[]): Uint8Array => {
  const doc = new Y.Doc();
  updates.forEach(u => Y.applyUpdate(doc, u));
  return Y.encodeStateAsUpdate(doc);
};
