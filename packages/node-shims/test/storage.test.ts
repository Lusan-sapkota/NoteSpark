import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertInStep, byTitle, crdt, database, docs, freshProfile, notes, profiles, reopen, rows, sample, sqlite, sync, warnings } from './helpers.ts';

const count = async (sql: string) => (await database.db.getFirstAsync(sql)).n;

test('sync off: every write works and nothing is written to crdt tables', async () => {
  await freshProfile();
  const a = await notes.saveNote(sample('A'));
  await notes.updateNote({ id: a, title: 'A', content: 'x', isMarkdown: false });
  await notes.setNoteArchived(a, true);
  await notes.moveNoteToBin(a);
  assert.equal(await count('SELECT count(*) AS n FROM crdt_updates'), 0);
  assert.equal((await notes.getBinNotes()).length, 1);
});

test('migration: an old database opens with identical notes, and sync seeds docs that match', async () => {
  const id = 'old';
  const old = await sqlite.openDatabaseAsync('notespark-old.db');
  await old.execAsync(`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, isMarkdown INTEGER NOT NULL, createdAt TEXT, updatedAt TEXT)`);
  for (let i = 0; i < 5; i++) await old.runAsync('INSERT INTO notes (title, content, isMarkdown) VALUES (?, ?, ?)', [`N${i}`, `body ${i} é😀`, i % 2]);
  await old.closeAsync();
  await database.openProfileDatabase(id);
  const before = await notes.getNotes();
  assert.equal(before.length, 5);
  assert.equal(new Set((await database.db.getAllAsync('SELECT uuid FROM notes')).map((r: any) => r.uuid)).size, 5);
  assert.deepEqual(before.map((n: any) => [n.title, n.content, n.isMarkdown]).sort(), [0, 1, 2, 3, 4].map(i => [`N${i}`, `body ${i} é😀`, Boolean(i % 2)]).sort());
  await notes.setNotePinned(before[0].id, true);
  await notes.moveNoteToBin(before[1].id);
  await notes.setNoteArchived(before[2].id, true);
  const snapshot = await rows();
  await crdt.enableSync(database.db);
  assert.deepEqual(await rows(), snapshot, 'enabling sync does not change a row');
  await assertInStep();
  assert.equal((await docs()).known.size, 5);
  await reopen(id);
  assert.deepEqual(await rows(), snapshot, 'reopening does not change a row');
  await assertInStep('after reopen');
});

test('a protected profile: encrypt, sync on, write, reopen', async () => {
  const id = await freshProfile();
  const a = await notes.saveNote(sample('Secret'));
  assert.equal(await database.setProfileEncryption(id, true), true);
  assert.ok(await database.isProfileEncrypted(id));
  await crdt.enableSync(database.db);
  await notes.updateNote({ id: a, title: 'Secret', content: 'changed', isMarkdown: true });
  await reopen(id);
  assert.equal((await notes.getNotes())[0].content, 'changed');
  await assertInStep();
});

test('import: merge, append and replace keep rows and docs in step', async () => {
  await freshProfile(true);
  const batch = [sample('A'), sample('B', { isPinned: true }), sample('C', { isArchived: true })];
  assert.deepEqual(await notes.importNotes(batch, 'append'), { imported: 3, skipped: 0 });
  assert.deepEqual(await notes.importNotes(batch, 'merge'), { imported: 0, skipped: 3 });
  await assertInStep('merge');
  await notes.importNotes([sample('D')], 'replace');
  assert.deepEqual(Object.keys(byTitle(await rows())), ['D']);
  await assertInStep('replace');
  assert.equal((await docs()).erased.size, 3);
  await assert.rejects(notes.importNotes([{ nope: 1 }], 'append'));
});

test('transfer to another profile and undo', async () => {
  const target = await freshProfile();
  await freshProfile(true);
  const a = await notes.saveNote(sample('Move me'));
  await notes.saveNote(sample('Stay'));
  const all = await notes.getNotes();
  const undo = await profiles.transferNotesToProfile(all.filter((n: any) => n.id === a), target);
  assert.deepEqual(Object.keys(byTitle(await rows())), ['Stay']);
  await assertInStep('source after transfer');
  await undo();
  assert.deepEqual(Object.keys(byTitle(await rows())).sort(), ['Move me', 'Stay']);
  await assertInStep('source after undo');
});

test('remote apply: edit, new note, erase; the notes table follows', async () => {
  await freshProfile(true);
  const id = await notes.saveNote(sample('Local'));
  const uuid = (await database.db.getFirstAsync('SELECT uuid FROM notes WHERE id = ?', [id])).uuid;
  const remote = new sync.Replica(4242);
  remote.receive(await allDeltas());
  await crdt.applyRemote(database.db, remote.save(uuid, { ...sync.readNote(remote.docs.get(uuid)!), content: 'from the hub' }));
  assert.equal((await notes.getNotes())[0].content, 'from the hub');
  const fresh = crypto.randomUUID();
  await crdt.applyRemote(database.db, remote.save(fresh, { title: 'Remote', content: 'r', isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
  assert.equal((await notes.getNotes()).length, 2);
  await crdt.applyRemote(database.db, remote.erase(uuid));
  assert.deepEqual(Object.keys(byTitle(await rows())), ['Remote']);
  await assertInStep();
});

export const allDeltas = async () =>
  (await database.db.getAllAsync('SELECT docId, "update" FROM crdt_updates ORDER BY id')).map((r: any) => ({ doc: r.docId, bytes: r.update }));

test('reconcile never writes a stale row over a newer doc (F1)', async () => {
  await freshProfile(true);
  const id = await notes.saveNote(sample('Local'));
  const uuid = (await database.db.getFirstAsync('SELECT uuid FROM notes WHERE id = ?', [id])).uuid;
  const remote = new sync.Replica(4243);
  remote.receive(await allDeltas());
  // what the old code could leave after a crash: the update stored, the notes row not yet written
  for (const d of remote.save(uuid, { ...sync.readNote(remote.docs.get(uuid)!), content: 'remote edit' }))
    await database.db.runAsync('INSERT INTO crdt_updates (docId, "update", createdAt) VALUES (?, ?, ?)', [d.doc, d.bytes, 'now']);
  await crdt.reconcile(database.db);
  assert.equal((await notes.getNotes())[0].content, 'remote edit');
  await assertInStep();
});

test('the Yjs client id is never stored, and no client-id warning appears', async () => {
  const profile = await freshProfile(true);
  const id = await notes.saveNote(sample('A'));
  await notes.updateNote({ id, title: 'A', content: 'two', isMarkdown: true });
  await reopen(profile);
  await notes.updateNote({ id: (await notes.getNotes())[0].id, title: 'A', content: 'three', isMarkdown: true });
  assert.equal((await database.db.getFirstAsync('SELECT clientId AS c FROM sync_state')).c, 0);
  assert.equal(warnings.filter(w => /client-id|clientID/i.test(w)).length, 0);
  await assertInStep();
});
