// A review made on one real storage database reaches the other while both are connected, and the schedule matches.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { foldReviews } from '@notespark/core';
import { Client, FakeClock, Hub, Net } from '../../sync-protocol/src/index.ts';
import { crdt, database } from './helpers.ts';

const src = new URL('../../../mobile/src/storage/', import.meta.url).href;
const { storageStore } = await import(`${src}syncStore.ts`);
const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
const T = '2026-01-01T00:00:00.000Z';

let n = 0;
const open = async () => {
  const conn = await database.openProfileConnection(`rl${++n}`, { useNewConnection: true });
  await database.initDatabase(conn);
  return conn;
};

test('a review on the phone shows on the computer, and one on the computer shows on the phone, live', async () => {
  const clock = new FakeClock();
  const net = new Net(clock, () => 0.5);
  const hubDb = await open();
  await crdt.transact(hubDb, async (sync: any) => {
    const r = await hubDb.runAsync(`INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, uuid) VALUES ('Cards', 'Q ?? A', 1, ?, ?, ${crdt.UUID_SQL})`, [T, T]);
    await sync.capture([r.lastInsertRowId]);
  });
  const hub = new Hub(storageStore(hubDb, 'Personal'), clock, sha256);
  const phone = await open();
  const client = new Client({ store: storageStore(phone), clock, rng: () => 0.5, hash: sha256, link: { syncId: '', name: 'Personal' }, connect: () => { const [a, b] = net.pair(); hub.accept(b); return a; } });
  client.start();
  await clock.advance(10_000);
  assert.equal(client.state, 'live');
  // The first link made the phone's profile its own; link the hub's to the same id the way the app does.
  const hubSync = (await storageStore(hubDb).profiles())[0].syncId;
  assert.equal(client.syncId, hubSync);

  const card = `${(await hubDb.getFirstAsync('SELECT uuid FROM notes')).uuid}:q`;
  await crdt.recordReviews(phone, [{ id: 'p1', card, at: 100, on: '2026-11-08', grade: 'good' }]);
  await clock.advance(10_000);
  assert.deepEqual((await crdt.loadReviews(hubDb)).map((r: any) => r.id), ['p1'], 'phone review reached the computer');
  await crdt.recordReviews(hubDb, [{ id: 'h1', card, at: 200, on: '2026-11-09', grade: 'good' }]);
  await clock.advance(10_000);
  const onPhone = await crdt.loadReviews(phone);
  assert.deepEqual(onPhone.map((r: any) => r.id).sort(), ['h1', 'p1'], 'computer review reached the phone');
  assert.equal(foldReviews(onPhone)[card].reps, 2);

  // Settings ride the same catalog: the newest value of a setting wins on both.
  await crdt.recordSettings(phone, [{ name: 'reminderTime', value: '450', at: 1000 }]);
  await clock.advance(10_000);
  await crdt.recordSettings(hubDb, [{ name: 'reminderTime', value: '1200', at: 2000 }, { name: 'theme', value: 'dark', at: 2000 }]);
  await clock.advance(10_000);
  for (const db of [phone, hubDb]) {
    const got = Object.fromEntries((await crdt.loadSettings(db)).map((e: any) => [e.name, e.value]));
    assert.deepEqual(got, { reminderTime: '1200', theme: 'dark' });
  }

  // The scratchpad is a doc of its own: it reaches the other device, survives a reconcile, and edits from both merge.
  const pad = async (db: any, content: string) => crdt.transact(db, async (sync: any) => {
    await db.runAsync('INSERT INTO scratchpad (id, content, updatedAt) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updatedAt = excluded.updatedAt', [content, new Date().toISOString()]);
    await sync.scratchpad();
  });
  await pad(phone, 'from the phone');
  await clock.advance(10_000);
  assert.equal((await hubDb.getFirstAsync('SELECT content FROM scratchpad WHERE id = 1')).content, 'from the phone');
  await crdt.reconcile(hubDb);
  await crdt.reconcile(phone);
  assert.equal((await hubDb.getFirstAsync('SELECT content FROM scratchpad WHERE id = 1')).content, 'from the phone', 'a reconcile does not erase it');
  assert.equal((await hubDb.getAllAsync("SELECT uuid FROM notes WHERE uuid = ?", [crdt.SCRATCH_UUID])).length, 0, 'it is never a note');
  await pad(hubDb, 'from the phone, and more');
  await clock.advance(10_000);
  assert.equal((await phone.getFirstAsync('SELECT content FROM scratchpad WHERE id = 1')).content, 'from the phone, and more');

  // A note's earlier text travels with it.
  const noteRow = await phone.getFirstAsync('SELECT id, uuid FROM notes');
  await crdt.transact(phone, async (sync: any) => {
    await phone.runAsync("UPDATE notes SET content = 'Q ?? A, edited', updatedAt = ? WHERE id = ?", [new Date().toISOString(), noteRow.id]);
    await sync.capture([noteRow.id]);
    await sync.versions(noteRow.id, [{ at: '2026-11-08T10:00:00.000Z', title: 'Cards', content: 'Q ?? A', isMarkdown: true }]);
  });
  await clock.advance(10_000);
  const hubNote = await hubDb.getFirstAsync('SELECT id FROM notes WHERE uuid = ?', [noteRow.uuid]);
  const versions = await hubDb.getAllAsync('SELECT content, savedAt FROM note_versions WHERE noteId = ?', [hubNote.id]);
  assert.deepEqual(versions.map((v: any) => v.content), ['Q ?? A'], 'the version reached the computer');
});
