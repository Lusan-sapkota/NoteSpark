import * as Y from 'yjs';
import { applyTextDiff } from './diff.ts';

// What a note doc holds: the text fields as Y.Text (merged by character) and the flags as a Y.Map (last writer wins).
export interface NoteState {
  title: string;
  content: string;
  isMarkdown: boolean;
  isPinned: boolean;
  isArchived: boolean;
  deletedAt: string | null; // in the bin since
  createdAt: string;
  updatedAt: string;
}

const FLAGS = ['isMarkdown', 'isPinned', 'isArchived', 'deletedAt', 'updatedAt'] as const;

export const readNote = (doc: Y.Doc): NoteState => {
  const meta = doc.getMap<any>('meta');
  const archived = !!meta.get('isArchived');
  return {
    title: doc.getText('title').toString(),
    content: doc.getText('body').toString(),
    isMarkdown: !!meta.get('isMarkdown'),
    // Archiving unpins. A pin and an archive made at the same time on two devices both stick, so it's decided here.
    isPinned: !!meta.get('isPinned') && !archived,
    isArchived: archived,
    deletedAt: meta.get('deletedAt') ?? null,
    createdAt: meta.get('createdAt') ?? '',
    updatedAt: meta.get('updatedAt') ?? '',
  };
};

// Applies the difference between the doc and `next` and returns just that change as an update, or null if nothing changed.
export const writeNote = (doc: Y.Doc, next: NoteState): Uint8Array | null => {
  const before = Y.encodeStateVector(doc);
  let changed = false;
  doc.transact(() => {
    changed = applyTextDiff(doc.getText('title'), next.title) || changed;
    changed = applyTextDiff(doc.getText('body'), next.content) || changed;
    const meta = doc.getMap<any>('meta');
    for (const key of FLAGS) {
      if (meta.get(key) !== next[key]) {
        meta.set(key, next[key]);
        changed = true;
      }
    }
    if (meta.get('createdAt') === undefined) {
      meta.set('createdAt', next.createdAt);
      changed = true;
    }
  });
  return changed ? Y.encodeStateAsUpdate(doc, before) : null;
};

// Builds a doc from stored updates, in any order and with repeats.
export const docFromUpdates = (updates: Uint8Array[], clientID?: number): Y.Doc => {
  const doc = new Y.Doc();
  doc.transact(() => updates.forEach(u => Y.applyUpdate(doc, u)));
  // After the replay: updates this device wrote earlier carry this id, and Yjs swaps the id for a random one when
  // it sees its own id arrive from "another client".
  if (clientID !== undefined) doc.clientID = clientID;
  return doc;
};
