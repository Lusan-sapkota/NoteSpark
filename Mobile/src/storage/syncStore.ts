// The sync engine's view of one profile's database (the SyncStore interface in packages/sync).
import type { SyncStore } from '@notespark/sync';
import { diffFor, readCatalog, stateVectorOf } from '@notespark/sync';
import type * as SQLite from 'expo-sqlite';
import { applyRemote, docUpdates, linkProfile, linkedSyncId, onLocalUpdate } from './crdt';

type DB = SQLite.SQLiteDatabase;

// ponytail: bound to one profile; the hub keeps one of these per synced profile.
export const storageStore = (db: DB, name = 'Profile'): SyncStore => {
  const own = async (syncId: string) => {
    if ((await linkedSyncId(db)) !== syncId) throw new Error('This profile is not linked to that sync id');
  };
  return {
    profiles: async () => {
      const syncId = await linkedSyncId(db);
      if (!syncId) return [];
      const n = (await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM notes'))!.n;
      return [{ syncId, name, notes: n, protected: false, locked: false }];
    },
    createProfile: async (syncId: string) => {
      if (!(await linkedSyncId(db))) await linkProfile(db, syncId, new Map());
      else await own(syncId);
    },
    plainNotes: async () =>
      (await db.getAllAsync<any>('SELECT uuid, title, content, isMarkdown FROM notes')).map(r => ({ uuid: r.uuid, title: r.title, content: r.content, isMarkdown: !!r.isMarkdown })),
    link: (syncId, adopt) => linkProfile(db, syncId, adopt),
    docs: async syncId => {
      await own(syncId);
      const { erased, known } = readCatalog(await docUpdates(db, 'catalog'));
      return [...known].filter(u => !erased.has(u));
    },
    stateVector: async (syncId, doc) => (await own(syncId), stateVectorOf(await docUpdates(db, doc))),
    diff: async (syncId, doc, remote) => (await own(syncId), diffFor(await docUpdates(db, doc), remote)),
    apply: async (syncId, doc, updates) => (await own(syncId), applyRemote(db, updates.map(bytes => ({ doc, bytes })))),
    subscribe: (_syncId, listener) => onLocalUpdate(db, d => listener(d.doc, d.bytes)),
  };
};
