// Two devices that each already hold the same scratchpad text must not end up with it twice after the first sync.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Client, FakeClock, Hub, Net } from '../../sync-protocol/src/index.ts';
import { crdt, database } from './helpers.ts';

const src = new URL('../../../mobile/src/storage/', import.meta.url).href;
const { storageStore } = await import(`${src}syncStore.ts`);
const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());

let n = 0;
const open = async () => {
  const conn = await database.openProfileConnection(`sl${++n}`, { useNewConnection: true });
  await database.initDatabase(conn);
  return conn;
};
const setPad = (db: any, content: string) => crdt.transact(db, async (sync: any) => {
  await db.runAsync('INSERT INTO scratchpad (id, content, updatedAt) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updatedAt = excluded.updatedAt', [content, new Date().toISOString()]);
  await sync.scratchpad();
});
const pad = async (db: any) => (await db.getFirstAsync('SELECT content FROM scratchpad WHERE id = 1'))?.content;

const link = async (hubText: string, phoneText: string) => {
  const clock = new FakeClock();
  const net = new Net(clock, () => 0.5);
  const hubDb = await open();
  await crdt.enableSync(hubDb);
  if (hubText) await setPad(hubDb, hubText);
  const hub = new Hub(storageStore(hubDb, 'Personal'), clock, sha256);
  const phone = await open();
  await phone.runAsync('INSERT INTO scratchpad (id, content, updatedAt) VALUES (1, ?, ?)', [phoneText, new Date().toISOString()]);
  const client = new Client({ store: storageStore(phone), clock, rng: () => 0.5, hash: sha256, link: { syncId: (await crdt.linkedSyncId(hubDb)) as string, name: 'Personal' }, connect: () => { const [a, b] = net.pair(); hub.accept(b); return a; } });
  client.start();
  await clock.advance(30_000);
  await crdt.reconcile(phone);
  await crdt.reconcile(hubDb);
  await clock.advance(30_000);
  return { hubDb, phone };
};

test('the same text on both devices stays one copy', async () => {
  const { hubDb, phone } = await link('shared text\nline two', 'shared text\nline two');
  assert.equal(await pad(hubDb), 'shared text\nline two');
  assert.equal(await pad(phone), 'shared text\nline two');
});

test('different text on both devices keeps both, once', async () => {
  const { hubDb, phone } = await link('from the computer', 'from the phone');
  const a = await pad(hubDb);
  assert.equal(a, await pad(phone), 'both end the same');
  assert.ok(a.includes('from the computer') && a.includes('from the phone'));
  assert.equal(a.split('from the computer').length, 2);
  assert.equal(a.split('from the phone').length, 2);
});
