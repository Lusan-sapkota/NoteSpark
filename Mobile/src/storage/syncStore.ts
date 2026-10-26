// The sync engine's view of one profile's database (the SyncStore interface in packages/sync).
import type { SyncStore } from '@notespark/sync';
import { type NoteState, diffFor, readCatalog, rebaseText, stateVectorOf } from '@notespark/sync';
import type * as SQLite from 'expo-sqlite';
import { UUID_SQL, applyRemote, docUpdates, linkProfile, linkedSyncId, onDocsChanged, onLocalUpdate, transact } from './crdt';

type DB = SQLite.SQLiteDatabase;

// ponytail: bound to one profile; the hub keeps one of these per synced profile.
const stateOf = (r: any): NoteState => ({
  title: r.title, content: r.content, isMarkdown: !!r.isMarkdown, isPinned: !!r.isPinned, isArchived: !!r.isArchived,
  deletedAt: r.deletedAt ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

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
    note: async (_syncId, uuid) => {
      const r = await db.getFirstAsync<any>('SELECT * FROM notes WHERE uuid = ?', [uuid]);
      return r ? stateOf(r) : null;
    },
    allNotes: async () => (await db.getAllAsync<any>('SELECT * FROM notes')).map(r => ({ uuid: r.uuid, ...stateOf(r) })),
    onNoteChange: (_syncId, listener) => onDocsChanged(db, docs => docs.forEach(listener)),
    applyFile: (_syncId, uuid, e) =>
      transact(db, async sync => {
        const now = new Date().toISOString();
        const row = uuid ? await db.getFirstAsync<any>('SELECT * FROM notes WHERE uuid = ?', [uuid]) : null;
        if (row) {
          const content = e.base !== null ? rebaseText(e.base, e.content, row.content) : e.content;
          await db.runAsync('UPDATE notes SET title = ?, content = ?, isPinned = ?, isArchived = ?, updatedAt = ? WHERE id = ?', [e.title, content, e.isPinned ? 1 : 0, e.isArchived ? 1 : 0, now, row.id]);
          await sync.capture([row.id]);
          return row.uuid as string;
        }
        const r = await db.runAsync(
          `INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, isPinned, isArchived, uuid) VALUES (?, ?, 1, ?, ?, ?, ?, ${uuid ? '?' : UUID_SQL})`,
          uuid ? [e.title, e.content, now, now, e.isPinned ? 1 : 0, e.isArchived ? 1 : 0, uuid] : [e.title, e.content, now, now, e.isPinned ? 1 : 0, e.isArchived ? 1 : 0]
        );
        await sync.capture([r.lastInsertRowId]);
        return (await db.getFirstAsync<{ uuid: string }>('SELECT uuid FROM notes WHERE id = ?', [r.lastInsertRowId]))!.uuid;
      }),
    binNote: (_syncId, uuid) =>
      transact(db, async sync => {
        const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM notes WHERE uuid = ? AND deletedAt IS NULL', [uuid]);
        if (!row) return;
        await db.runAsync('UPDATE notes SET deletedAt = ? WHERE id = ?', [new Date().toISOString(), row.id]);
        await sync.capture([row.id]);
      }),
  };
};
