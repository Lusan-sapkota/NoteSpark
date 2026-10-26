// The sync engine between real storage databases: a hub profile and two phone profiles, linked, adopted, edited, erased.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Client, FakeClock, Hub, Net } from '../../sync-protocol/src/index.ts';
import { crdt, database, sqlite } from './helpers.ts';

const src = new URL('../../../Mobile/src/storage/', import.meta.url).href;
const { storageStore } = await import(`${src}syncStore.ts`);

const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
const T = '2026-01-01T00:00:00.000Z';

let n = 0;
const open = async () => {
  const id = `e${++n}`;
  const conn = await database.openProfileConnection(id, { useNewConnection: true });
  await database.initDatabase(conn);
  return conn;
};
const add = (conn: any, title: string, content = `${title} body`) =>
  crdt.transact(conn, async (sync: any) => {
    const r = await conn.runAsync(`INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, uuid) VALUES (?, ?, 1, ?, ?, ${crdt.UUID_SQL})`, [title, content, T, T]);
    await sync.capture([r.lastInsertRowId]);
  });
const edit = (conn: any, title: string, content: string) =>
  crdt.transact(conn, async (sync: any) => {
    await conn.runAsync('UPDATE notes SET content = ?, updatedAt = ? WHERE title = ?', [content, new Date().toISOString(), title]);
    await sync.capture((await conn.getAllAsync('SELECT id FROM notes WHERE title = ?', [title])).map((r: any) => r.id));
  });
const remove = (conn: any, title: string) =>
  crdt.transact(conn, async (sync: any) => {
    const uuids = (await conn.getAllAsync('SELECT uuid FROM notes WHERE title = ?', [title])).map((r: any) => r.uuid);
    await conn.runAsync('DELETE FROM notes WHERE title = ?', [title]);
    await sync.erase(uuids);
  });
const view = async (conn: any) => (await conn.getAllAsync('SELECT title, content FROM notes ORDER BY title, content')).map((r: any) => `${r.title}|${r.content}`);

test('hub and two phones on real storage: link, adopt, live edits, erase, restart-free convergence', async () => {
  const clock = new FakeClock();
  const rng = () => 0.5;
  const net = new Net(clock, rng);
  const hubDb = await open();
  await add(hubDb, 'Shared');
  await add(hubDb, 'Hub only');
  const hub = new Hub(storageStore(hubDb, 'Personal'), clock, sha256);
  const device = async (notes: [string, string?][], syncId = '') => {
    const conn = await open();
    for (const [t, c] of notes) await add(conn, t, c);
    const client = new Client({ store: storageStore(conn), clock, rng, hash: sha256, link: { syncId, name: syncId ? '' : 'Personal' }, connect: () => { const [a, b] = net.pair(); hub.accept(b); return a; } });
    client.start();
    await clock.advance(10_000);
    return { conn, client };
  };
  const a = await device([['Shared'], ['Phone A only'], ['Draft', 'x']]);
  assert.equal(a.client.state, 'live');
  const syncId = a.client.syncId!;
  assert.equal(syncId, (await storageStore(hubDb).profiles())[0].syncId);
  const b = await device([['Shared'], ['Phone B only']], syncId);
  await clock.advance(10_000);
  const all = ['Draft|x', 'Hub only|Hub only body', 'Phone A only|Phone A only body', 'Phone B only|Phone B only body', 'Shared|Shared body'];
  for (const c of [hubDb, a.conn, b.conn]) assert.deepEqual(await view(c), all);
  // the two copies of "Shared" were joined, not duplicated
  assert.equal((await b.conn.getAllAsync("SELECT 1 FROM notes WHERE title = 'Shared'")).length, 1);

  await edit(a.conn, 'Draft', 'edited on A');
  await edit(hubDb, 'Hub only', 'edited on the hub');
  await add(b.conn, 'New on B');
  await clock.advance(2000);
  await remove(b.conn, 'Phone A only');
  await clock.advance(2000);
  const expected = ['Draft|edited on A', 'Hub only|edited on the hub', 'New on B|New on B body', 'Phone B only|Phone B only body', 'Shared|Shared body'];
  for (const c of [hubDb, a.conn, b.conn]) assert.deepEqual(await view(c), expected);
  for (const c of [hubDb, a.conn, b.conn]) assert.equal((await c.getAllAsync('SELECT docId FROM crdt_adopted')).length, 0, 'no adoption left pending');
  hub.stop();
  a.client.stop();
  b.client.stop();
});
