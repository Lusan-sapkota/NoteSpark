import * as Y from 'yjs';
import { catalogUuids, isErased, markErased, markLive } from './catalog.ts';
import { type NoteState, docFromUpdates, readNote, writeNote } from './note.ts';

// Functions on bytes for the phone's crdt_updates rows, so no Yjs types leave this package. `clientID` must stay the
// same for a device and profile: docs are rebuilt from rows each time.

export const noteUpdate = (updates: Uint8Array[], clientID: number, next: NoteState): Uint8Array | null =>
  writeNote(docFromUpdates(updates, clientID), next);

export const noteFromUpdates = (updates: Uint8Array[]): NoteState => readNote(docFromUpdates(updates));

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

// The same, plus the doc's state vector after the change (the phone's row marker).
export const noteCapture = (updates: Uint8Array[], clientID: number, next: NoteState): { update: Uint8Array | null; stateVector: Uint8Array } => {
  const doc = docFromUpdates(updates, clientID);
  const update = writeNote(doc, next);
  return { update, stateVector: Y.encodeStateVector(doc) };
};

export const noteWithStateVector = (updates: Uint8Array[]): { note: NoteState; stateVector: Uint8Array } => {
  const doc = docFromUpdates(updates);
  return { note: readNote(doc), stateVector: Y.encodeStateVector(doc) };
};

// For the sync engine: a doc's state vector, and the update a peer with `remote` lacks (any doc, catalog included).
export const stateVectorOf = (updates: Uint8Array[]): Uint8Array => Y.encodeStateVector(docFromUpdates(updates));
export const diffFor = (updates: Uint8Array[], remote: Uint8Array): Uint8Array => Y.encodeStateAsUpdate(docFromUpdates(updates), remote);
