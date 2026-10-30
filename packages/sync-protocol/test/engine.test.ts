import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Session, backoff } from '../src/index.ts';
import { T, encodeFrame } from '../src/wire.ts';
import { World, note, rng, sha256, uuid } from './harness.ts';

// A device that links a local profile to a hub profile ('' = a new one).
const linked = async (w: World, notes: Record<string, ReturnType<typeof note>>, hubSyncId = '', over: Record<string, unknown> = {}) => {
  const d = w.device();
  for (const [u, n] of Object.entries(notes)) d.store.plain.set(u, n);
  d.start({ link: { syncId: hubSyncId, name: 'Personal' }, ...over });
  await w.run(5000);
  return d;
};

test('first link as a new profile: notes reach the hub', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One'), [uuid(2)]: note('Two') });
  assert.equal(a.client!.state, 'live');
  const syncId = a.client!.syncId!;
  assert.deepEqual(Object.values(w.hubStore.notes(syncId)).map(n => n.title).sort(), ['One', 'Two']);
});

test('adoption: identical notes are joined, different and near-identical ones stay, empty ones are never joined', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('Same'), [uuid(2)]: note('Only phone'), [uuid(3)]: note('Near', 'text A'), [uuid(4)]: note('', '') });
  const syncId = a.client!.syncId!;
  let plan: any;
  const b = await linked(w, { [uuid(11)]: note('Same'), [uuid(12)]: note('Near', 'text B'), [uuid(13)]: note('', ''), [uuid(14)]: note('Same', 'Same body\r\n') }, syncId, { confirmLink: async (p: any) => ((plan = p), true) });
  assert.equal(plan.pairs.length, 1, 'Same (twice on b, once on a) joins one copy; the second Same joins nothing');
  await w.run(5000);
  const titles = (s: any) => Object.values(s.notes(syncId)).map((n: any) => `${n.title}|${n.content}`).sort();
  assert.deepEqual(titles(w.hubStore), titles(a.store));
  assert.deepEqual(titles(b.store), titles(a.store));
  assert.equal(titles(b.store).filter(t => t.startsWith('Same|')).length, 2, 'one joined, one extra copy kept');
  assert.equal(titles(b.store).filter(t => t.startsWith('Near|')).length, 2);
  assert.equal(titles(b.store).filter(t => t === '|').length, 2, 'empty notes are separate');
  assert.ok(b.store.peek(syncId, uuid(1)), 'b adopted the hub uuid');
});

test('declining the plan changes nothing', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const b = await linked(w, { [uuid(2)]: note('One') }, a.client!.syncId!, { confirmLink: async () => false });
  assert.equal(b.store.plain.size, 1);
  assert.equal(b.store.profilesById.size, 0);
});

test('live changes go through the hub to every device, erase and bin included', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  const c = await linked(w, {}, syncId);
  a.store.edit(syncId, uuid(1), note('One', 'edited on a'));
  b.store.edit(syncId, uuid(9), note('From b'));
  await w.run(1000);
  for (const d of [a, b, c, { store: w.hubStore }]) assert.equal(d.store.peek(syncId, uuid(1))!.content, 'edited on a');
  assert.equal(c.store.peek(syncId, uuid(9))!.title, 'From b');
  c.store.erase(syncId, uuid(1));
  w.hubStore.edit(syncId, uuid(5), note('From hub'));
  await w.run(1000);
  for (const d of [a, b, c, { store: w.hubStore }]) { assert.equal(d.store.peek(syncId, uuid(1)), null); assert.equal(d.store.peek(syncId, uuid(5))!.title, 'From hub'); }
});

test('a device that was offline catches up in one exchange, and the 30 second reconcile heals a lost push', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  b.online = false;
  b.client!.session!.close('wifi off');
  for (let i = 0; i < 50; i++) a.store.edit(syncId, uuid(100 + i), note(`n${i}`));
  await w.run(10_000);
  assert.equal(Object.keys(b.store.notes(syncId)).length, 1);
  b.online = true;
  await w.run(70_000);
  assert.deepEqual(b.store.notes(syncId), a.store.notes(syncId));
  // a lost push
  w.net.faults.drop = 1;
  a.store.edit(syncId, uuid(1), note('One', 'lost push'));
  await w.run(100);
  w.net.faults.drop = 0;
  await w.run(45_000);
  assert.equal(b.store.peek(syncId, uuid(1))!.content, 'lost push');
});

test('state machine: back-off doubles to 60 s, a dead connection is noticed, 403 and 423 are reported', async () => {
  const seq = Array.from({ length: 9 }, (_, i) => backoff(i, () => 0.5));
  assert.deepEqual(seq, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  const w = new World();
  const d = await linked(w, { [uuid(1)]: note('x') });
  assert.equal(d.client!.state, 'live');
  w.net.faults.drop = 1; // silent link: dead after 45 s
  await w.run(120_000);
  assert.notEqual(d.client!.state, 'live');
  assert.ok(d.states.includes('waiting'));
  w.net.faults.drop = 0;
  await w.run(120_000);
  assert.equal(d.client!.state, 'live');
  const lost = w.device('00000000-0000-4000-8000-00000000dead');
  lost.start();
  await w.run(1000);
  assert.equal(lost.client!.state, 'notLinked');
});

test('a locked profile answers 423 and the client waits, then syncs after unlock', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  const real = w.hubStore.profiles.bind(w.hubStore);
  w.hubStore.profiles = async () => (await real()).map(p => ({ ...p, locked: true }));
  b.client!.session!.close('lock test');
  await w.run(3000);
  assert.equal(b.client!.state, 'locked');
  w.hubStore.profiles = real;
  await w.run(20_000);
  assert.equal(b.client!.state, 'live');
});

test('a hub session refuses frames before subscribing, floods of requests, and applies nothing', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const [x, y] = w.net.pair();
  let applied = 0;
  const apply = w.hubStore.apply.bind(w.hubStore);
  w.hubStore.apply = async (...args) => { applied++; return apply(...args); };
  const closed: string[] = [];
  const s = w.hub.accept(y, { onClosed: r => closed.push(r) });
  x.send(encodeFrame({ type: T.UPDATE, doc: uuid(7), id: 1, index: 0, count: 1, bytes: Uint8Array.of(1, 2, 3) }));
  await w.run(100);
  assert.equal(applied, 0);
  assert.equal(s.state, 'closed');
  const [x2, y2] = w.net.pair();
  const s2 = w.hub.accept(y2);
  x2.send(encodeFrame({ type: T.SUBSCRIBE, syncId }));
  await w.run(100);
  for (let i = 0; i < 9; i++) y2.onMessage(encodeFrame({ type: T.SV, doc: uuid(50 + i), stateVector: Uint8Array.of(0) }));
  await w.run(200);
  assert.equal(s2.state, 'closed');
  assert.equal(s2.closeCode, 400);
  assert.equal(applied, 0);
});

test('a note over 32 MB stays on its device, is reported, and everything else syncs (row 12)', async () => {
  const w = new World();
  const problems: { code: number; doc: string }[] = [];
  const a = await linked(w, { [uuid(1)]: note('Small') }, '', { onProblem: (p: { code: number; doc: string }) => problems.push(p) });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  a.store.edit(syncId, uuid(2), note('Huge', 'x'.repeat(33 * 1024 * 1024)));
  a.store.edit(syncId, uuid(3), note('Normal'));
  await w.run(70_000);
  assert.equal(b.store.peek(syncId, uuid(3))!.title, 'Normal');
  assert.equal(b.store.peek(syncId, uuid(2))?.content ?? '', '', 'the huge note never arrived');
  assert.deepEqual(problems[0], { code: 413, doc: uuid(2) });
  assert.equal(a.client!.state, 'live');
});

test('a peer that sends faster than the store can apply is cut off at 64 MB queued (429)', async () => {
  const w = new World();
  w.hubStore.profiles = () => new Promise(() => {}); // the hub never gets to the frames
  const [a, b] = w.net.pair();
  const session = w.hub.accept(b);
  const frame = encodeFrame({ type: T.SV, doc: 'catalog', stateVector: new Uint8Array(1024 * 1024 - 64) });
  for (let i = 0; i < 70 && session.state !== 'closed'; i++) a.send(frame);
  await w.run(100);
  assert.equal(session.state, 'closed');
  assert.equal(session.closeCode, 429);
});

test('a stopped client does not reconnect', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const sent = w.net.sent;
  a.client!.stop();
  await w.run(5 * 60_000);
  assert.equal(a.client!.state, 'off');
  assert.equal(w.clock.pending(), 0, 'no timer left running');
  assert.ok(w.net.sent - sent < 5);
});

test('a reference to a file nobody has is asked for a few times, then not again; once a peer offers it, it is fetched', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255);
  const hash = Array.from(sha256(bytes), x => x.toString(16).padStart(2, '0')).join('');
  let requests = 0;
  const pair = w.net.pair.bind(w.net);
  w.net.pair = () => {
    const ends = pair();
    for (const end of ends) { const send = end.send; end.send = d => { if (d[0] === T.BLOB_REQ) requests++; send(d); }; }
    return ends;
  };
  for (const d of [a, b]) { d.online = false; d.client!.session?.close('offline'); }
  await w.run(5000);
  for (const d of [a, b]) d.online = true;
  a.store.edit(syncId, uuid(2), note('Dangling', `[f.bin](attachment:${hash})`)); // a reference, but no file anywhere
  await w.run(5 * 60_000);
  const early = requests;
  assert.ok(early > 0 && early <= 3 * 4, `asked ${early} times`);
  await w.run(10 * 60_000);
  assert.equal(requests, early, 'it stopped asking');
  await a.store.putBlob(syncId, hash, bytes); // the file turns up on one device
  await w.run(3 * 60_000);
  assert.deepEqual(await b.store.getBlob(syncId, hash), bytes);
  assert.deepEqual(await w.hubStore.getBlob(syncId, hash), bytes);
});
