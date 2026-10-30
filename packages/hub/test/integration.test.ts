// The whole engine over real sockets: hub + 3 devices, Noise on the wire, sockets killed for real, a capture of every byte.
import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { MemoryStore, type NoteState } from '@notespark/sync';
import { Client, type Clock, generateKeypair } from '@notespark/sync-protocol';
import { wsConnector } from '../src/wsClient.ts';
import { T0, U, note, setup, sha256, sleep, until } from './support.ts';

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Ten times faster than real time, so back-off (1 s, 2 s, ...) and timeouts do not make the test wait minutes.
const fast: Clock = { now: () => Date.now() * 10, after: (ms, fn) => { const t = setTimeout(fn, ms / 10); return () => clearTimeout(t); } };

// A TCP relay that records every byte in both directions and can cut connections.
const relay = async (target: number, rng: () => number) => {
  const captured: Buffer[] = [];
  const live = new Set<[net.Socket, net.Socket]>();
  let budgets = 0; // the next connections are cut after a random number of bytes
  let accepted = 0, cut = 0;
  const server = net.createServer(client => {
    accepted++;
    const up = net.connect(target, '127.0.0.1');
    const pair: [net.Socket, net.Socket] = [client, up];
    live.add(pair);
    let left = budgets-- > 0 ? 30_000 + Math.floor(rng() * 170_000) : Infinity;
    const end = () => { client.destroy(); up.destroy(); live.delete(pair); };
    const pipe = (from: net.Socket, to: net.Socket) => {
      from.on('data', d => {
        captured.push(Buffer.from(d));
        left -= d.length;
        if (left < 0) { cut++; return end(); }
        to.write(d);
      });
      from.on('close', end);
      from.on('error', () => {});
    };
    pipe(client, up); pipe(up, client);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return {
    port: (server.address() as net.AddressInfo).port,
    captured: () => Buffer.concat(captured),
    killRandom: () => { const all = [...live]; if (all.length) { const [c, u] = all[Math.floor(rng() * all.length)]; c.destroy(); u.destroy(); cut++; } },
    limitNext: (n: number) => { budgets = n; },
    stats: () => ({ accepted, cut }),
    close: async () => { for (const [c, u] of live) { c.destroy(); u.destroy(); } await new Promise<void>(r => server.close(() => r())); },
  };
};

const MARK = 'ZZMARKER';
const snapshot = (s: MemoryStore, syncId: string) => JSON.stringify([Object.entries(s.notes(syncId)).sort(([a], [b]) => a.localeCompare(b)), [...s.erasedSet(syncId)].sort()]);

test('hub and three devices over real ws and Noise: edits, races, an erase, an attachment, sockets cut for real, then identical, and no note bytes on the wire', async () => {
  const rng = seeded(4242);
  const w = await setup();
  const proxy = await relay(w.port, rng);
  const mk = (clientId: number, link: { syncId: string; name: string }) => {
    const key = generateKeypair();
    w.known.add(Buffer.from(key.pub).toString('hex'));
    const store = new MemoryStore(clientId);
    const client = new Client({
      store, clock: fast, rng, hash: sha256, link,
      connect: wsConnector({ deviceKey: key, hubKey: w.hubKey.pub, name: `Device ${clientId}`, addresses: [{ host: '127.0.0.1', port: proxy.port }], clock: fast }),
    });
    return { store, client };
  };

  const a = mk(101, { syncId: '', name: `${MARK}-profile` });
  const base: Record<string, NoteState> = {
    [U(1)]: note(`${MARK}-title one`, `${MARK}-body one\nline two\nline three`),
    [U(2)]: note('Shared', 'alpha beta gamma'),
    [U(3)]: note('Doomed', 'will be erased'),
    [U(4)]: note('Rename me', 'body stays'),
  };
  for (const [u, n] of Object.entries(base)) a.store.plain.set(u, n);
  a.client.start();
  await until(() => a.client.state === 'live', 20_000);
  const syncId = a.client.syncId!;
  const b = mk(102, { syncId, name: '' }), c = mk(103, { syncId, name: '' });
  b.client.start(); c.client.start();
  await until(() => b.client.state === 'live' && c.client.state === 'live', 20_000);
  await until(() => Object.keys(b.store.notes(syncId)).length === 4 && Object.keys(c.store.notes(syncId)).length === 4, 20_000);

  // An attachment (several 64 KB chunks, with the marker inside), pushed over connections that are cut part way.
  const blobBytes = new Uint8Array(260_000).map((_, i) => (i * 31 + 7) & 255);
  new TextEncoder().encodeInto(`${MARK}-blob-bytes`, blobBytes.subarray(1000));
  const hash = Buffer.from(sha256(blobBytes)).toString('hex');
  proxy.limitNext(6);
  await a.store.putBlob(syncId, hash, blobBytes);
  a.store.edit(syncId, U(5), note('With file', `see [file.bin](attachment:${hash})`));

  // Races while sockets are cut: same note edited on two devices, a rename against a body edit, an erase against an edit, a pin.
  const cur = (s: MemoryStore, u: string) => s.peek(syncId, u)!;
  const stamp = new Date().toISOString();
  a.store.edit(syncId, U(2), { ...cur(a.store, U(2)), content: 'alpha A-edit beta gamma', updatedAt: stamp });
  b.store.edit(syncId, U(2), { ...cur(b.store, U(2)), content: 'alpha beta B-edit gamma', updatedAt: stamp });
  a.store.edit(syncId, U(4), { ...cur(a.store, U(4)), title: 'Renamed on A' });
  b.store.edit(syncId, U(4), { ...cur(b.store, U(4)), content: 'body edited on B' });
  c.store.erase(syncId, U(3));
  b.store.edit(syncId, U(3), { ...cur(b.store, U(3)), content: 'edit after the erase' });
  c.store.edit(syncId, U(1), { ...cur(c.store, U(1)), isPinned: true });
  for (let i = 0; i < 8; i++) { await sleep(60 + Math.floor(rng() * 120)); proxy.killRandom(); }

  const stores = [a.store, b.store, c.store];
  await until(async () => {
    const snaps = [...stores, w.store].map(s => snapshot(s, syncId));
    if (!snaps.every(s => s === snaps[0])) return false;
    for (const s of [...stores, w.store]) { const got = await s.getBlob(syncId, hash); if (!got || got.length !== blobBytes.length) return false; }
    return true;
  }, 60_000);

  // Converged (I2): same notes everywhere, the erase won, both concurrent edits survived, the file arrived intact.
  assert.equal(a.store.peek(syncId, U(3)), null);
  const shared = a.store.peek(syncId, U(2))!.content;
  assert.ok(shared.includes('A-edit') && shared.includes('B-edit'), shared);
  const renamed = a.store.peek(syncId, U(4))!;
  assert.equal(renamed.title, 'Renamed on A');
  assert.equal(renamed.content, 'body edited on B');
  assert.ok(a.store.peek(syncId, U(1))!.isPinned);
  for (const s of [...stores, w.store]) assert.deepEqual(await s.getBlob(syncId, hash), blobBytes);
  const st = proxy.stats();
  assert.ok(st.cut >= 5, `sockets really cut: ${st.cut}`);
  assert.ok(st.accepted > 3, 'devices reconnected');

  // I3: nothing readable on the wire.
  const wire = proxy.captured();
  assert.ok(wire.length > 300_000, `captured ${wire.length} bytes`);
  for (const secret of [MARK, 'Doomed', 'alpha', 'Rename me', 'body stays', 'attachment:', 'file.bin', hash.slice(0, 16), 'Personal'])
    assert.equal(wire.indexOf(secret), -1, `plaintext "${secret}" found in the capture`);
  console.log(`integration: ${wire.length} bytes captured, ${st.accepted} connections, ${st.cut} cut`);

  for (const d of [a, b, c]) d.client.stop();
  await proxy.close();
  await w.stop();
});
void T0;

test('the hub is killed and restarted on the same port: devices reconnect and nothing is lost', async () => {
  const probe = net.createServer();
  await new Promise<void>(r => probe.listen(0, '127.0.0.1', () => r()));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(r => probe.close(() => r()));
  const w = await setup({ port });
  const key = generateKeypair();
  w.known.add(Buffer.from(key.pub).toString('hex'));
  const store = new MemoryStore(7);
  store.plain.set(U(1), note('Before'));
  const client = new Client({
    store, clock: fast, rng: seeded(1), hash: sha256, link: { syncId: '', name: 'P' },
    connect: wsConnector({ deviceKey: key, hubKey: w.hubKey.pub, name: 'Phone', addresses: [{ host: '127.0.0.1', port }], clock: fast }),
  });
  client.start();
  await until(() => client.state === 'live', 20_000);
  const syncId = client.syncId!;
  await w.server.close(); // the hub process dies: every socket is cut
  await until(() => client.state !== 'live', 10_000);
  store.edit(syncId, U(2), note('While the hub was down'));
  const { HubServer } = await import('../src/wsServer.ts');
  const again = new HubServer({ host: '127.0.0.1', port, hubKey: w.hubKey, name: 'Test hub', hub: w.hub, authorize: k => w.known.has(Buffer.from(k).toString('hex')) });
  await again.listen();
  await until(() => client.state === 'live' && w.store.peek(syncId, U(2))?.title === 'While the hub was down', 30_000);
  assert.equal(w.store.peek(syncId, U(1))?.title, 'Before');
  client.stop();
  await again.close();
  w.hub.stop();
});
