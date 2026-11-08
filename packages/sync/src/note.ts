import * as Y from 'yjs';
import { applyTextDiff } from './diff.ts';

// What a note doc holds: the text fields as Y.Text (merged by character) and the flags as a Y.Map (last writer wins).
export interface NoteState {
  title: string;
  content: string;
  isMarkdown: boolean;
  isPinned: boolean;
  isArchived: boolean;
  color?: string | null; // note colour and background pattern keys, last writer wins; absent from older devices
  background?: string | null;
  deletedAt: string | null; // in the bin since
  createdAt: string;
  updatedAt: string;
}

const STYLE = ['color', 'background'] as const;
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
    // Left out when unset, so uncoloured notes read as before.
    ...(meta.get('color') ? { color: meta.get('color') as string } : {}),
    ...(meta.get('background') ? { background: meta.get('background') as string } : {}),
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
    // Missing equals null, so devices that don't know the field make no change.
    for (const key of STYLE) {
      if ((meta.get(key) ?? null) !== (next[key] ?? null)) {
        meta.set(key, next[key] ?? null);
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

export const docFromUpdates = (updates: Uint8Array[], clientID?: number): Y.Doc => {
  const doc = new Y.Doc();
  doc.transact(() => updates.forEach(u => Y.applyUpdate(doc, u)));
  // After the replay: updates this device wrote earlier carry this id, and Yjs swaps the id for a random one when
  // it sees its own id arrive from "another client".
  if (clientID !== undefined) doc.clientID = clientID;
  return doc;
};


// Earlier texts of a note (its version history) ride in the note's own doc, so they travel with it. Newest few only, and
// small ones only: a doc must stay well inside the protocol's frame size.
export interface NoteVersion { at: string; title: string; content: string; isMarkdown: boolean }
export const VERSIONS_SYNCED = 10;
export const MAX_VERSION_BYTES = 20_000;
const versionList = (doc: Y.Doc) => doc.getArray<string>('versions');
const parseVersion = (text: unknown): NoteVersion | null => {
  if (typeof text !== 'string' || text.length > MAX_VERSION_BYTES + 400) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v.at === 'string' && typeof v.title === 'string' && typeof v.content === 'string' ? { at: v.at, title: v.title, content: v.content, isMarkdown: !!v.isMarkdown } : null;
  } catch { return null; }
};
export const readVersions = (doc: Y.Doc): NoteVersion[] => versionList(doc).toArray().map(parseVersion).filter((v): v is NoteVersion => !!v);
// Adds the ones not there yet and drops the oldest past VERSIONS_SYNCED; returns whether anything changed.
export const addVersions = (doc: Y.Doc, versions: NoteVersion[]): boolean => {
  const list = versionList(doc);
  const have = new Set(list.toArray());
  let changed = false;
  doc.transact(() => {
    for (const v of versions) {
      if (v.content.length + v.title.length > MAX_VERSION_BYTES) continue;
      const text = JSON.stringify({ at: v.at, title: v.title, content: v.content, isMarkdown: v.isMarkdown });
      if (have.has(text)) continue;
      list.push([text]);
      have.add(text);
      changed = true;
    }
    const extra = list.length - VERSIONS_SYNCED;
    if (extra > 0) {
      const order = list.toArray().map((t, i) => ({ i, at: parseVersion(t)?.at ?? '' })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i));
      order.slice(0, extra).map(o => o.i).sort((a, b) => b - a).forEach(i => list.delete(i, 1));
      changed = true;
    }
  });
  return changed;
};
