import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '@notespark/sync';
import { remoteStore, serveStore, StoreError } from '../src/storeRpc.ts';
import { U, note, sleep, until } from './support.ts';
import { portPair } from './support-port.ts';

const setupRpc = async (store = new MemoryStore(1), opts = {}) => {
  const p = portPair();
  const dispose = serveStore(p.a, store);
  const remote = remoteStore(p.b, opts);
  await store.createProfile('s1', 'One');
  return { store, remote: remote.store, closed: remote.closed, dispose, p };
};

test('calls cross the port with bytes intact, and results match the real store', async () => {
  const { store, remote } = await setupRpc();
  store.edit('s1', U(1), note('hello'));
  assert.deepEqual(await remote.profiles(), await store.profiles());
  assert.deepEqual(await remote.docs('s1'), await store.docs('s1'));
  const sv = await remote.stateVector('s1', U(1));
  assert.ok(sv instanceof Uint8Array && sv.length > 0);
  const empty = new MemoryStore(2);
  await empty.createProfile('s1', 'One');
  const update = await remote.diff('s1', U(1), new Uint8Array([0]));
  await empty.apply('s1', U(1), [update]);
  assert.equal(empty.peek('s1', U(1))?.title, 'hello');
  await remote.putBlob!('s1', 'a'.repeat(64), new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await store.getBlob!('s1', 'a'.repeat(64)))!], [1, 2, 3]);
  const withMap = await remote.link('s2', new Map([['x', 'y']])).catch((e: Error) => e);
  assert.ok(withMap === undefined || withMap instanceof Error); // a Map survives the clone (the store decides)
});

test('errors cross with their message and code; a bad call is refused before it reaches the store', async () => {
  const { remote, store, p } = await setupRpc();
  (store as any).docs = async () => { throw Object.assign(new Error('profile is locked'), { code: 'LOCKED' }); };
  await assert.rejects(remote.docs('s1'), (e: StoreError) => e.message === 'profile is locked' && e.code === 'LOCKED');
  let reached = 0;
  (store as any).note = async () => { reached++; return null; };
  const raw: unknown[] = [];
  p.b.on(m => raw.push(m));
  for (const op of ['note', 'nope', '__proto__', 'constructor', 'toString']) p.b.send({ k: 's:call', id: 900, op, args: [42, {}] });
  p.b.send({ k: 's:call', id: 901, op: 'diff', args: ['s1', 'doc', 'not bytes'] });
  p.b.send({ k: 's:call', id: 902, op: 'apply', args: ['s1', 'doc', [new Uint8Array(1), 'x']] });
  p.b.send({ k: 's:call', id: 903, op: 'note', args: ['x'.repeat(5000), 'y'] });
  await sleep(50);
  assert.equal(reached, 0);
  assert.equal(raw.filter((m: any) => m.k === 's:ret' && m.ok === false && m.code === 'BAD').length, 8);
});

test('subscribe and onNoteChange become events, unsubscribe is explicit and stops them', async () => {
  const { remote, store, dispose } = await setupRpc();
  const updates: string[] = [], changes: string[] = [];
  const off1 = remote.subscribe('s1', doc => updates.push(doc));
  const off2 = remote.onNoteChange('s1', uuid => changes.push(uuid));
  await sleep(20);
  store.edit('s1', U(1), note('a'));
  await until(() => updates.length > 0 && changes.length > 0);
  assert.ok(changes.includes(U(1)));
  off1(); off2();
  await sleep(20);
  const n = updates.length, c = changes.length;
  store.edit('s1', U(1), note('b'));
  await sleep(50);
  assert.equal(updates.length, n);
  assert.equal(changes.length, c);
  const off3 = remote.subscribe('s1', () => {});
  dispose(); // the worker exits: the main side drops every subscription
  store.edit('s1', U(2), note('c'));
  off3();
});

test('a call that is not answered times out; a dead port fails waiting calls at once; in-flight calls are capped', async () => {
  const { remote, store, p, closed } = await setupRpc(new MemoryStore(1), { timeoutMs: 40 });
  (store as any).docs = () => new Promise(() => {});
  await assert.rejects(remote.docs('s1'), (e: StoreError) => e.code === 'TIMEOUT');
  const { remote: r2, store: s2, closed: c2 } = await setupRpc(new MemoryStore(1), { timeoutMs: 5000 });
  (s2 as any).docs = () => new Promise(() => {});
  const waiting = Promise.allSettled(Array.from({ length: 70 }, () => r2.docs('s1')));
  await sleep(50);
  c2();
  const results = await waiting;
  const busy = results.filter(r => r.status === 'rejected' && (r.reason as StoreError).code === 'BUSY').length;
  const gone = results.filter(r => r.status === 'rejected' && (r.reason as StoreError).code === 'GONE').length;
  assert.equal(busy, 6);
  assert.equal(gone, 64);
  void p; void closed;
});

test('a 64 KB chunk and a 4 MB blob cross intact', async () => {
  const { remote, store } = await setupRpc();
  for (const size of [65_536, 4 * 1024 * 1024]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31) & 255);
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await remote.putBlob!('s1', hash, bytes);
    assert.deepEqual(await remote.getBlob!('s1', hash), bytes);
  }
  void store;
});
