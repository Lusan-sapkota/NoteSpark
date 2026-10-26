import * as Y from 'yjs';
import { catalogUuids, isErased, markErased, markLive } from './catalog.ts';
import { type NoteState, docFromUpdates, readNote, writeNote } from './note.ts';

// What a store of update rows (the phone's crdt_updates) needs, as functions on bytes: no Yjs types leave this package.
// `clientID` is the device's own id for this profile; docs are rebuilt from rows each time, so it must stay the same.

// The update that turns the stored note into `next`, or null when nothing changed.
export const noteUpdate = (updates: Uint8Array[], clientID: number, next: NoteState): Uint8Array | null =>
  writeNote(docFromUpdates(updates, clientID), next);

export const noteFromUpdates = (updates: Uint8Array[]): NoteState => readNote(docFromUpdates(updates));

// One update for the catalog: these uuids are live, these are erased for good. Null when it already says so.
export const catalogUpdate = (updates: Uint8Array[], clientID: number, change: { live?: string[]; erased?: string[] }): Uint8Array | null => {
  const doc = docFromUpdates(updates, clientID);
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    change.live?.forEach(uuid => markLive(doc, uuid));
    change.erased?.forEach(uuid => markErased(doc, uuid));
  });
  const update = Y.encodeStateAsUpdate(doc, before);
  return update.length > 2 ? update : null; // an empty update is two bytes
};

export const readCatalog = (updates: Uint8Array[]) => {
  const doc = docFromUpdates(updates);
  const all = catalogUuids(doc);
  return { erased: new Set(all.filter(uuid => isErased(doc, uuid))), known: new Set(all) };
};
