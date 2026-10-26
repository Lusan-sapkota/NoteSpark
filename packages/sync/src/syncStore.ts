import * as Y from 'yjs';
import { catalogUuids, isErased } from './catalog.ts';
import { type NoteState, readNote } from './note.ts';
import { rebaseText } from './rebase.ts';
import { type Delta, Replica } from './replica.ts';

export interface ProfileInfo {
  syncId: string;
  name: string;
  notes: number;
  protected: boolean;
  locked: boolean;
}

// A note as the first link compares it.
export interface PlainNote {
  uuid: string;
  title: string;
  content: string;
  isMarkdown: boolean;
}

export interface FileEdit {
  base: string | null; // the text the file was written from, so an edit made elsewhere in the meantime is merged
  title: string;
  content: string;
  isPinned: boolean;
  isArchived: boolean;
}

// All the sync engine knows about storage; `doc` is 'catalog' or a note uuid.
export interface SyncStore {
  profiles(): Promise<ProfileInfo[]>;
  // Idempotent.
  createProfile(syncId: string, name: string): Promise<void>;
  plainNotes(syncId: string): Promise<PlainNote[]>;
  // First link: adopt the hub's uuids, turn sync on, one transaction.
  link(syncId: string, adopt: Map<string, string>): Promise<void>;
  // Notes in the catalog, erased ones left out.
  docs(syncId: string): Promise<string[]>;
  stateVector(syncId: string, doc: string): Promise<Uint8Array>;
  diff(syncId: string, doc: string, remoteStateVector: Uint8Array): Promise<Uint8Array>;
  apply(syncId: string, doc: string, updates: Uint8Array[]): Promise<void>;
  // Changes made here (not by `apply`), once committed.
  subscribe(syncId: string, listener: (doc: string, update: Uint8Array) => void): () => void;
  // For the Markdown mirror: readable notes, and after every commit (local or applied) the uuids that changed.
  note(syncId: string, uuid: string): Promise<NoteState | null>;
  allNotes(syncId: string): Promise<(NoteState & { uuid: string })[]>;
  onNoteChange(syncId: string, listener: (uuid: string) => void): () => void;
  // An outside edit, merged into the note (created if `uuid` is null or unknown); returns the uuid.
  applyFile(syncId: string, uuid: string | null, edit: FileEdit): Promise<string>;
  // A deleted file means the bin, never an erase.
  binNote(syncId: string, uuid: string): Promise<void>;
  // Attachment blobs stored for this profile (64-char lowercase hex SHA-256).
  blobs?(syncId: string): Promise<string[]>;
  getBlob?(syncId: string, hash: string): Promise<Uint8Array | null>;
  putBlob?(syncId: string, hash: string, bytes: Uint8Array): Promise<void>;
}

const BLOB_REF_RE = /attachment:([0-9a-fA-F]{64})\b/g;
export const extractBlobHashes = (notes: Iterable<{ content: string }>): string[] => {
  const out = new Set<string>();
  for (const n of notes) {
    if (!n?.content) continue;
    const re = new RegExp(BLOB_REF_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(n.content)) !== null) out.add(m[1].toLowerCase());
  }
  return [...out].sort();
};

interface Profile {
  name: string;
  replica: Replica;
  blobs: Map<string, Uint8Array>;
}

// A SyncStore in memory, for tests.
export class MemoryStore implements SyncStore {
  profilesById = new Map<string, Profile>();
  plain = new Map<string, NoteState>(); // notes before the first link
  plainBlobs = new Map<string, Uint8Array>(); // blobs before the first link
  private listeners = new Map<string, Set<(doc: string, update: Uint8Array) => void>>();

  clientId: number;
  constructor(clientId: number) {
    this.clientId = clientId;
  }

  private profileEntry(syncId: string) {
    const p = this.profilesById.get(syncId);
    if (!p) throw new Error(`unknown profile ${syncId}`);
    return p;
  }
  private profile(syncId: string) {
    return this.profileEntry(syncId).replica;
  }
  private changeListeners = new Map<string, Set<(uuid: string) => void>>();
  private emit(syncId: string, deltas: Delta[]) {
    for (const d of deltas) {
      this.listeners.get(syncId)?.forEach(l => l(d.doc, d.bytes));
      if (d.doc !== 'catalog') this.changeListeners.get(syncId)?.forEach(l => l(d.doc));
    }
  }

  async profiles(): Promise<ProfileInfo[]> {
    return [...this.profilesById].map(([syncId, p]) => ({ syncId, name: p.name, notes: Object.keys(p.replica.notes()).length, protected: false, locked: false }));
  }
  async createProfile(syncId: string, name: string) {
    if (!this.profilesById.has(syncId)) this.profilesById.set(syncId, { name, replica: new Replica(this.clientId), blobs: new Map() });
  }
  async plainNotes(syncId: string): Promise<PlainNote[]> {
    const source = this.profilesById.get(syncId)?.replica.notes() ?? Object.fromEntries(this.plain);
    return Object.entries(source).map(([uuid, n]) => ({ uuid, title: n.title, content: n.content, isMarkdown: n.isMarkdown }));
  }
  async link(syncId: string, adopt: Map<string, string>) {
    if (this.profilesById.has(syncId)) return;
    const replica = new Replica(this.clientId);
    for (const [uuid, state] of this.plain) if (!adopt.has(uuid)) replica.save(uuid, state);
    const blobs = new Map<string, Uint8Array>();
    for (const [h, b] of this.plainBlobs) blobs.set(h, b.slice());
    this.profilesById.set(syncId, { name: 'Profile', replica, blobs });
    this.plain.clear();
    this.plainBlobs.clear();
  }
  async docs(syncId: string) {
    const r = this.profile(syncId);
    return catalogUuids(r.catalog).filter(u => !isErased(r.catalog, u));
  }
  async stateVector(syncId: string, doc: string) {
    const r = this.profile(syncId);
    return Y.encodeStateVector(doc === 'catalog' ? r.catalog : r.getDoc(doc));
  }
  async diff(syncId: string, doc: string, remote: Uint8Array) {
    const r = this.profile(syncId);
    return Y.encodeStateAsUpdate(doc === 'catalog' ? r.catalog : r.getDoc(doc), remote);
  }
  async apply(syncId: string, doc: string, updates: Uint8Array[]) {
    const r = this.profile(syncId);
    const wasErased = doc !== 'catalog' && isErased(r.catalog, doc);
    r.receive(updates.map(bytes => ({ doc, bytes })));
    if (doc !== 'catalog' && !wasErased) this.changeListeners.get(syncId)?.forEach(l => l(doc));
    if (doc === 'catalog') for (const u of catalogUuids(r.catalog)) if (isErased(r.catalog, u) && this.known.get(syncId)?.has(u)) this.changeListeners.get(syncId)?.forEach(l => l(u));
    this.known.set(syncId, new Set(r.docs.keys()));
  }
  private known = new Map<string, Set<string>>();
  subscribe(syncId: string, listener: (doc: string, update: Uint8Array) => void) {
    const set = this.listeners.get(syncId) ?? new Set();
    this.listeners.set(syncId, set);
    set.add(listener);
    return () => void set.delete(listener);
  }

  // Local actions.
  edit(syncId: string, uuid: string, state: NoteState) {
    this.emit(syncId, this.profile(syncId).save(uuid, state));
  }
  erase(syncId: string, uuid: string) {
    this.emit(syncId, this.profile(syncId).erase(uuid));
  }
  notes(syncId: string) {
    return this.profile(syncId).notes();
  }
  erasedSet(syncId: string) {
    const r = this.profile(syncId);
    return catalogUuids(r.catalog).filter(u => isErased(r.catalog, u)).sort();
  }
  peek(syncId: string, uuid: string): NoteState | null {
    const r = this.profile(syncId);
    return isErased(r.catalog, uuid) || !r.docs.has(uuid) ? null : readNote(r.getDoc(uuid));
  }
  async note(syncId: string, uuid: string) {
    return this.peek(syncId, uuid);
  }
  async allNotes(syncId: string) {
    return Object.entries(this.profile(syncId).notes()).map(([uuid, n]) => ({ uuid, ...n }));
  }
  onNoteChange(syncId: string, listener: (uuid: string) => void) {
    const set = this.changeListeners.get(syncId) ?? new Set();
    this.changeListeners.set(syncId, set);
    set.add(listener);
    return () => void set.delete(listener);
  }
  async applyFile(syncId: string, uuid: string | null, e: FileEdit) {
    const id = uuid ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const cur = await this.note(syncId, id);
    const content = cur && e.base !== null ? rebaseText(e.base, e.content, cur.content) : e.content;
    this.edit(syncId, id, { isMarkdown: true, deletedAt: null, createdAt: now, ...cur, title: e.title, content, isPinned: e.isPinned, isArchived: e.isArchived, updatedAt: now });
    return id;
  }
  async binNote(syncId: string, uuid: string) {
    const cur = await this.note(syncId, uuid);
    if (cur && !cur.deletedAt) this.edit(syncId, uuid, { ...cur, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  async blobs(syncId: string): Promise<string[]> {
    return [...this.profileEntry(syncId).blobs.keys()].sort();
  }
  async getBlob(syncId: string, hash: string): Promise<Uint8Array | null> {
    const b = this.profileEntry(syncId).blobs.get(hash.toLowerCase());
    return b ? b.slice() : null;
  }
  async putBlob(syncId: string, hash: string, bytes: Uint8Array): Promise<void> {
    this.profileEntry(syncId).blobs.set(hash.toLowerCase(), bytes.slice());
  }
  referencedBlobs(syncId: string): string[] {
    return extractBlobHashes(Object.values(this.notes(syncId)));
  }

  // Restart with a new client id.
  snapshot() {
    return [...this.profilesById].map(([syncId, p]) => ({
      syncId, name: p.name,
      updates: [{ doc: 'catalog', bytes: Y.encodeStateAsUpdate(p.replica.catalog) }, ...[...p.replica.docs].map(([doc, d]) => ({ doc, bytes: Y.encodeStateAsUpdate(d) }))],
      blobs: [...p.blobs].map(([h, b]) => [h, b.slice()] as [string, Uint8Array]),
    }));
  }
  static restore(
    clientId: number,
    snapshot: ReturnType<MemoryStore['snapshot']>,
    plain: Map<string, NoteState> = new Map(),
    plainBlobs: Map<string, Uint8Array> = new Map()
  ) {
    const store = new MemoryStore(clientId);
    store.plain = new Map(plain);
    store.plainBlobs = new Map(plainBlobs);
    for (const p of snapshot) {
      const replica = new Replica(clientId);
      replica.receive(p.updates);
      store.profilesById.set(p.syncId, { name: p.name, replica, blobs: new Map(p.blobs ?? []) });
    }
    return store;
  }
}
