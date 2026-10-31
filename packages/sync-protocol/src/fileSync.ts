// Export a profile to a sync file and import one (docs/prompts/sync-file-session.md). Pure: all storage goes through SyncStore,
// the file format is file.ts. Import is one transaction through `applyMany`; a note missing from the file means nothing, and
// an erased note stays erased (the catalog carries the erase marks, and the store drops updates for erased notes).
import { type PlainNote, type SyncStore, docFromUpdates, readCatalog, readNote } from '@notespark/sync';
import { type Hash, fingerprints, planAdoption } from './adopt.ts';
import { type SyncFileContent, decodeSyncFile, encodeSyncFile } from './file.ts';
import type { PairEntry } from './wire.ts';

export type FlowProblem = 'locked' | 'otherProfile' | 'noProfile';
export class SyncFileFlowError extends Error {
  reason: FlowProblem;
  constructor(reason: FlowProblem, message: string) { super(message); this.reason = reason; }
}

const EMPTY_VECTOR = Uint8Array.of(0); // the state vector of a document with nothing in it, so a diff against it is the whole state

export interface ExportOptions { store: SyncStore; name: string; passphrase: string; uuid: () => string; now?: () => number }

// A profile never linked gets a sync id of its own first; that is what makes the file name its profile.
export const exportSyncFile = async (o: ExportOptions): Promise<Uint8Array> => {
  let [profile] = await o.store.profiles();
  if (!profile) {
    await o.store.link(o.uuid(), new Map()); // keeps this profile's notes; adopts nothing
    [profile] = await o.store.profiles();
    if (!profile) throw new SyncFileFlowError('noProfile', 'could not prepare this profile');
  }
  if (profile.locked) throw new SyncFileFlowError('locked', 'profile is locked');
  const ids = ['catalog', ...(await o.store.docs(profile.syncId))];
  const docs = [];
  for (const id of ids) docs.push({ id, update: await o.store.diff(profile.syncId, id, EMPTY_VECTOR) });
  return encodeSyncFile({ syncId: profile.syncId, name: profile.name || o.name, createdAt: (o.now ?? Date.now)(), docs }, o.passphrase);
};

export type ImportPlan =
  | { kind: 'merge' | 'adopt'; content: SyncFileContent; fileNotes: number; localNotes: number; pairs: PairEntry[] } // adopt: this profile was never linked
  | { kind: 'otherProfile'; fileName: string };

const filePlainNotes = (c: SyncFileContent): PlainNote[] => {
  const out: PlainNote[] = [];
  const erased = readCatalog(c.docs.filter(d => d.id === 'catalog').map(d => d.update)).erased;
  for (const d of c.docs) {
    if (d.id === 'catalog' || erased.has(d.id)) continue;
    const n = readNote(docFromUpdates([d.update]));
    out.push({ uuid: d.id, title: n.title, content: n.content, isMarkdown: n.isMarkdown });
  }
  return out;
};

// Reads and checks the file; changes nothing. The caller shows the plan (counts) before `runImport`.
export const planImport = async (store: SyncStore, bytes: Uint8Array, passphrase: string, hash: Hash): Promise<ImportPlan> => {
  const content = await decodeSyncFile(bytes, passphrase);
  const [mine] = await store.profiles();
  if (mine?.locked) throw new SyncFileFlowError('locked', 'profile is locked');
  if (mine && mine.syncId !== content.syncId) return { kind: 'otherProfile', fileName: content.name };
  const fileNotes = filePlainNotes(content);
  if (mine) return { kind: 'merge', content, fileNotes: fileNotes.length, localNotes: mine.notes, pairs: [] };
  const local = await store.plainNotes('');
  return { kind: 'adopt', content, fileNotes: fileNotes.length, localNotes: local.length, pairs: planAdoption(fingerprints(local, hash), fingerprints(fileNotes, hash)) };
};

export const runImport = async (store: SyncStore, plan: Exclude<ImportPlan, { kind: 'otherProfile' }>): Promise<void> => {
  const { content } = plan;
  if (plan.kind === 'adopt') await store.link(content.syncId, new Map(plan.pairs.map(p => [p.clientUuid, p.hubUuid])));
  const items = content.docs.map(d => ({ doc: d.id, update: d.update }));
  if (store.applyMany) await store.applyMany(content.syncId, items);
  else for (const i of items) await store.apply(content.syncId, i.doc, [i.update]);
};

