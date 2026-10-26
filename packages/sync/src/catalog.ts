import * as Y from 'yjs';

// One per profile: which note uuids exist and which were erased for good. Erased uuids live in their own map and
// are never removed from it, so a concurrent write of "live" can't bring a note back (one key with two values
// would be last writer wins). An erased uuid never comes back.
const live = (doc: Y.Doc) => doc.getMap<true>('live');
const erased = (doc: Y.Doc) => doc.getMap<true>('erased');

export const markLive = (doc: Y.Doc, uuid: string) => {
  if (!live(doc).has(uuid)) live(doc).set(uuid, true);
};
export const markErased = (doc: Y.Doc, uuid: string) => {
  if (!erased(doc).has(uuid)) erased(doc).set(uuid, true);
};
export const isErased = (doc: Y.Doc, uuid: string) => erased(doc).has(uuid);
export const isKnown = (doc: Y.Doc, uuid: string) => live(doc).has(uuid) || erased(doc).has(uuid);
export const catalogUuids = (doc: Y.Doc) => [...new Set([...live(doc).keys(), ...erased(doc).keys()])];
