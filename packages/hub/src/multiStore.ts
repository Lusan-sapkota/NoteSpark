// One SyncStore over several local profiles, for the hub: routes by sync id to the store of the profile that owns it.
// The profile source decides which connection serves a profile and whether it may be used at all (a protected profile that is
// locked in the app is not: D2). A locked profile's key never reaches this code, let alone the hub process.
import type { ProfileInfo, SyncStore } from '@notespark/sync';

export interface ProfileSource {
  synced(): string[]; // local profile ids with the sync switch on
  describe(id: string): Promise<{ name: string; isProtected: boolean; unlocked: boolean; exists?: boolean }>; // exists false: deleted or binned, skipped
  syncIdOf(id: string): Promise<string | null>; // while locked: the id remembered from the last time it was open
  open(id: string): Promise<SyncStore | null>; // null: cannot be used now
  adopt(syncId: string, name: string): Promise<string | null>; // a device linked a new profile: make one, or null when not allowed
}

export class LockedError extends Error {
  code = 'LOCKED';
  constructor() { super('profile is locked'); }
}

export const multiStore = (source: ProfileSource) => {
  let map: Map<string, string> | null = null; // sync id -> local profile id
  const creating = new Map<string, Promise<void>>();
  const watchers = new Set<{ syncId: string; kind: 'subscribe' | 'onNoteChange'; l: (...a: any[]) => void; off: (() => void) | null; dead: boolean }>();

  const listAll = async (): Promise<(ProfileInfo & { localId: string })[]> => {
    const out: (ProfileInfo & { localId: string })[] = [];
    for (const id of source.synced()) {
      const d = await source.describe(id);
      if (d.exists === false) continue;
      if (d.isProtected && !d.unlocked) {
        const syncId = await source.syncIdOf(id);
        if (syncId) out.push({ syncId, name: d.name, notes: 0, protected: true, locked: true, localId: id });
        continue;
      }
      const store = await source.open(id);
      if (!store) continue;
      for (const p of await store.profiles()) out.push({ ...p, name: d.name, protected: d.isProtected, locked: false, localId: id });
    }
    map = new Map(out.map(p => [p.syncId, p.localId]));
    return out;
  };
  const route = async (syncId: string): Promise<SyncStore> => {
    let id = map?.get(syncId);
    if (!id) { await listAll(); id = map!.get(syncId); }
    if (!id) throw new Error('unknown profile');
    const d = await source.describe(id);
    if (d.exists === false) throw new Error('unknown profile');
    const store = d.isProtected && !d.unlocked ? null : await source.open(id);
    if (!store) throw new LockedError();
    return store;
  };

  const attach = async (w: (typeof watchers extends Set<infer T> ? T : never)) => {
    w.off?.(); w.off = null;
    try {
      const store = await route(w.syncId);
      if (w.dead) return;
      w.off = w.kind === 'subscribe' ? store.subscribe(w.syncId, w.l) : store.onNoteChange(w.syncId, w.l);
    } catch { /* locked or gone: attached again at the next rebind */ }
  };
  const watch = (kind: 'subscribe' | 'onNoteChange', syncId: string, l: (...a: any[]) => void) => {
    const w = { syncId, kind, l, off: null as (() => void) | null, dead: false };
    watchers.add(w);
    void attach(w);
    return () => { w.dead = true; w.off?.(); watchers.delete(w); };
  };

  const store: SyncStore = {
    profiles: async () => (await listAll()).map(({ localId: _l, ...p }) => p),
    // One at a time per sync id, so two calls cannot make two profiles; only a real UUID is a sync id.
    createProfile: (syncId, name) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(syncId)) return Promise.reject(new Error('bad sync id'));
      const run = async () => {
        if (!map) await listAll();
        if (map!.has(syncId)) return;
        const id = await source.adopt(syncId, name);
        if (!id) throw new Error('This computer does not accept new profiles from devices');
        map = null;
      };
      const next = (creating.get(syncId) ?? Promise.resolve()).then(run, run);
      creating.set(syncId, next.catch(() => {}));
      return next;
    },
    plainNotes: async syncId => (await route(syncId)).plainNotes(syncId),
    link: async (syncId, adopt) => (await route(syncId)).link(syncId, adopt),
    docs: async syncId => (await route(syncId)).docs(syncId),
    stateVector: async (syncId, doc) => (await route(syncId)).stateVector(syncId, doc),
    diff: async (syncId, doc, sv) => (await route(syncId)).diff(syncId, doc, sv),
    apply: async (syncId, doc, updates) => (await route(syncId)).apply(syncId, doc, updates),
    subscribe: (syncId, l) => watch('subscribe', syncId, l),
    note: async (syncId, uuid) => (await route(syncId)).note(syncId, uuid),
    allNotes: async syncId => (await route(syncId)).allNotes(syncId),
    onNoteChange: (syncId, l) => watch('onNoteChange', syncId, l),
    applyFile: async (syncId, uuid, e) => (await route(syncId)).applyFile(syncId, uuid, e),
    binNote: async (syncId, uuid) => (await route(syncId)).binNote(syncId, uuid),
    blobs: async syncId => (await route(syncId)).blobs!(syncId),
    getBlob: async (syncId, hash) => (await route(syncId)).getBlob!(syncId, hash),
    putBlob: async (syncId, hash, bytes) => (await route(syncId)).putBlob!(syncId, hash, bytes),
  };
  // The active profile changed, a profile was locked or re-encrypted, or the sync switches moved: forget routes, move listeners.
  const rebind = async () => { map = null; await Promise.all([...watchers].map(attach)); };
  return { store, rebind };
};
