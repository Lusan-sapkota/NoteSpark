import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { catalogUuids, isErased, isKnown, markErased, markLive } from './catalog.ts';
import { type NoteState, readNote, writeNote } from './note.ts';

// A change to send: the catalog, or one note's doc.
export interface Delta {
  doc: 'catalog' | string;
  bytes: Uint8Array;
}

// y-protocols sync step 1 and 2 between two docs, both ways: each side sends only what the other lacks.
export const exchange = (a: Y.Doc, b: Y.Doc) => {
  const oneWay = (from: Y.Doc, to: Y.Doc) => {
    const ask = encoding.createEncoder();
    syncProtocol.writeSyncStep1(ask, to);
    const answer = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoding.createDecoder(encoding.toUint8Array(ask)), answer, from, 'remote');
    syncProtocol.readSyncMessage(decoding.createDecoder(encoding.toUint8Array(answer)), encoding.createEncoder(), to, 'remote');
  };
  oneWay(a, b);
  oneWay(b, a);
};

// One device's view of a profile: the catalog and a doc per note. The phone keeps these as rows in crdt_updates;
// the hub and the tests keep them in memory. `clientId` makes runs replayable.
export class Replica {
  catalog = new Y.Doc();
  docs = new Map<string, Y.Doc>();

  private clientId?: number;

  constructor(clientId?: number) {
    this.clientId = clientId;
    if (clientId !== undefined) this.catalog.clientID = clientId;
  }

  private doc(uuid: string) {
    let doc = this.docs.get(uuid);
    if (!doc) {
      doc = new Y.Doc();
      if (this.clientId !== undefined) doc.clientID = this.clientId;
      this.docs.set(uuid, doc);
    }
    return doc;
  }

  private catalogChange(change: () => void): Delta {
    const before = Y.encodeStateVector(this.catalog);
    this.catalog.transact(change);
    return { doc: 'catalog', bytes: Y.encodeStateAsUpdate(this.catalog, before) };
  }

  // Creates or edits a note from the editor's new state. Nothing for an erased note.
  save(uuid: string, next: NoteState): Delta[] {
    if (isErased(this.catalog, uuid)) return [];
    const out: Delta[] = [];
    const known = isKnown(this.catalog, uuid);
    if (!known) out.push(this.catalogChange(() => markLive(this.catalog, uuid)));
    const bytes = writeNote(this.doc(uuid), next);
    if (bytes) out.push({ doc: uuid, bytes });
    return out;
  }

  // Erasing for good: a tombstone in the catalog, and the doc is dropped here and wherever the tombstone arrives.
  erase(uuid: string): Delta[] {
    if (isErased(this.catalog, uuid)) return [];
    const out = [this.catalogChange(() => markErased(this.catalog, uuid))];
    this.docs.delete(uuid);
    return out;
  }

  // Applies changes from elsewhere, in any order and any number of times.
  receive(deltas: Delta[]) {
    for (const d of deltas) {
      if (d.doc === 'catalog') Y.applyUpdate(this.catalog, d.bytes);
      else if (!isErased(this.catalog, d.doc)) Y.applyUpdate(this.doc(d.doc), d.bytes);
    }
    this.reap();
  }

  private reap() {
    for (const uuid of [...this.docs.keys()]) if (isErased(this.catalog, uuid)) this.docs.delete(uuid);
  }

  // Meeting another replica: catalogs first, then each note both know of.
  syncWith(other: Replica) {
    exchange(this.catalog, other.catalog);
    for (const uuid of new Set([...catalogUuids(this.catalog), ...this.docs.keys(), ...other.docs.keys()])) {
      if (isErased(this.catalog, uuid)) continue;
      exchange(this.doc(uuid), other.doc(uuid));
    }
    this.reap();
    other.reap();
  }

  // Every note not erased, bin included.
  notes(): Record<string, NoteState> {
    const out: Record<string, NoteState> = {};
    for (const uuid of [...this.docs.keys()].sort()) if (!isErased(this.catalog, uuid)) out[uuid] = readNote(this.docs.get(uuid)!);
    return out;
  }
}
