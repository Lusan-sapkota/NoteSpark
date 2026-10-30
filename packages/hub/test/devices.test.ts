import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryStore } from '@notespark/sync';
import { Client, FakeClock, Handshake, PairingMode, encodePayload, generateKeypair, realClock } from '@notespark/sync-protocol';
import { DeviceList, DeviceListError, authorizer } from '../src/devices.ts';
import { wsConnector } from '../src/wsClient.ts';
import { open, outcome, setup, sha256, until } from './support.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'notespark-devices-'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('device list: add, find, rename, revoke, persisted atomically with mode 0600', () => {
  const clock = new FakeClock();
  const path = join(dir(), 'devices.json');
  const list = DeviceList.open(path, clock);
  const a = generateKeypair().pub, b = generateKeypair().pub;
  list.add(a, 'Pixel 8');
  list.add(b, 'Tablet');
  list.add(a, 'Pixel 8 again'); // a key is never listed twice
  assert.equal(list.list().length, 2);
  assert.ok(list.has(a));
  assert.ok(list.rename(b, 'Old tablet'));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(path, '..')), ['devices.json'], 'no temporary file left');
  const again = DeviceList.open(path, clock);
  assert.deepEqual(again.list().map(d => d.name).sort(), ['Old tablet', 'Pixel 8']);
  let revoked = '';
  again.onRevoke = k => { revoked = hex(k); };
  assert.ok(again.revoke(a));
  assert.equal(revoked, hex(a));
  assert.ok(!again.has(a));
  assert.ok(!again.revoke(a));
  assert.equal(DeviceList.open(path, clock).list().length, 1);
});

test('last seen is remembered but written to disk at most once a minute', () => {
  const clock = new FakeClock();
  const path = join(dir(), 'devices.json');
  const list = DeviceList.open(path, clock);
  const k = generateKeypair().pub;
  list.add(k, 'P');
  clock.time = 1_000_000;
  list.touch(k); // first touch writes
  const first = readFileSync(path, 'utf8');
  clock.time += 10_000;
  list.touch(k);
  assert.equal(readFileSync(path, 'utf8'), first, 'not written again within a minute');
  assert.notEqual(list.list()[0].lastSeen, null);
  list.flush();
  assert.notEqual(readFileSync(path, 'utf8'), first);
});

test('a damaged device list stops the hub from starting, with a clear message', () => {
  const clock = new FakeClock();
  const k = 'ab'.repeat(32);
  const good = { format: 1, devices: [{ key: k, name: 'P', addedAt: '2026-01-01T00:00:00.000Z', lastSeen: null }] };
  const bad: [string, string | object][] = [
    ['not JSON', '{"format":1,'],
    ['empty file', ''],
    ['unknown format', { ...good, format: 2 }],
    ['no devices array', { format: 1 }],
    ['short key', { format: 1, devices: [{ ...good.devices[0], key: 'abcd' }] }],
    ['uppercase key', { format: 1, devices: [{ ...good.devices[0], key: 'AB'.repeat(32) }] }],
    ['duplicate key', { format: 1, devices: [good.devices[0], good.devices[0]] }],
    ['name missing', { format: 1, devices: [{ key: k, addedAt: '2026-01-01T00:00:00.000Z', lastSeen: null }] }],
    ['bad date', { format: 1, devices: [{ ...good.devices[0], addedAt: 'yesterday' }] }],
    ['null entry', { format: 1, devices: [null] }],
  ];
  for (const [what, content] of bad) {
    const path = join(dir(), 'devices.json');
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), { mode: 0o600 });
    assert.throws(() => DeviceList.open(path, clock), (e: Error) => e instanceof DeviceListError && /will not start/.test(e.message), what);
  }
  const path = join(dir(), 'devices.json');
  writeFileSync(path, JSON.stringify(good), { mode: 0o600 });
  assert.equal(DeviceList.open(path, clock).list().length, 1);
  chmodSync(path, 0o644);
  assert.throws(() => DeviceList.open(path, clock), DeviceListError, 'readable by others');
  assert.equal(DeviceList.open(join(dir(), 'missing.json'), clock).list().length, 0, 'a missing file is an empty list');
});

// A hub that pairs by token and keeps a real device list.
const paired = async () => {
  const pairing = new PairingMode(realClock);
  const devices = DeviceList.open(join(dir(), 'devices.json'), realClock);
  const w = await setup({ authorize: authorizer(devices, pairing), stillKnown: k => devices.has(k) });
  devices.onRevoke = k => w.server.closeDevice(k);
  const phone = (name: string, token?: Uint8Array, key = generateKeypair(), hubKey = w.hubKey.pub, link = { syncId: '', name: 'Personal' }) => {
    const client = new Client({
      store: new MemoryStore(500 + Math.floor(Math.random() * 1e6)), clock: realClock, rng: Math.random, hash: sha256, link,
      connect: wsConnector({ deviceKey: key, hubKey, name, addresses: [{ host: '127.0.0.1', port: w.port }], token: () => token }),
    });
    return { client, key };
  };
  return { ...w, pairing, devices, phone };
};

test('pairing over the wire: a valid token adds the device, which then connects without one', async () => {
  const w = await paired();
  const token = w.pairing.start()!;
  const p = w.phone('Pixel 8', token);
  p.client.start();
  await until(() => p.client.state === 'live');
  assert.equal(w.devices.list().length, 1);
  assert.equal(w.devices.list()[0].name, 'Pixel 8');
  p.client.stop();
  const again = w.phone('Pixel 8', undefined, p.key);
  again.client.start();
  await until(() => again.client.state === 'live');
  assert.equal(w.devices.list().length, 1);
  again.client.stop();
  await w.stop();
});

test('a token works once: the second device with the same token gets no reply and is not added', async () => {
  const w = await paired();
  const token = w.pairing.start()!;
  const first = w.phone('One', token);
  first.client.start();
  await until(() => first.client.state === 'live');
  const k = generateKeypair();
  const ws = open(w.port);
  const done = outcome(ws);
  const hs = new Handshake({ initiator: true, s: k, rs: w.hubKey.pub });
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Two', token }))));
  assert.equal((await done).messages, 0);
  assert.ok(!w.devices.has(k.pub));
  first.client.stop();
  await w.stop();
});

test('an expired token fails (fake clock on the pairing mode)', async () => {
  const clock = new FakeClock();
  const pairing = new PairingMode(clock);
  const devices = DeviceList.open(join(dir(), 'devices.json'), realClock);
  const w = await setup({ authorize: authorizer(devices, pairing) });
  const token = pairing.start()!;
  clock.time += 5 * 60_000;
  const k = generateKeypair();
  const ws = open(w.port);
  const done = outcome(ws);
  const hs = new Handshake({ initiator: true, s: k, rs: w.hubKey.pub });
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Late', token }))));
  assert.equal((await done).messages, 0);
  assert.ok(!devices.has(k.pub));
  await w.stop();
});

test('brute force: five wrong tokens lock pairing, then even the right token is refused', async () => {
  const w = await paired();
  const token = w.pairing.start()!;
  for (let i = 0; i < 5; i++) {
    const ws = open(w.port);
    const done = outcome(ws);
    const hs = new Handshake({ initiator: true, s: generateKeypair(), rs: w.hubKey.pub });
    ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Guess', token: new Uint8Array(16).fill(i + 100) }))));
    assert.equal((await done).messages, 0);
  }
  assert.ok(w.pairing.locked);
  const p = w.phone('Real owner', token);
  const ws = open(w.port);
  const done = outcome(ws);
  const hs = new Handshake({ initiator: true, s: p.key, rs: w.hubKey.pub });
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Real owner', token }))));
  assert.equal((await done).messages, 0);
  assert.equal(w.devices.list().length, 0);
  assert.equal(w.pairing.start(), null);
  await w.stop();
});

test('a wrong hub key is refused by the client side: the hub sees nothing it accepts', async () => {
  const w = await paired();
  const token = w.pairing.start()!;
  const p = w.phone('Pixel', token, generateKeypair(), generateKeypair().pub); // a different hub's key
  p.client.start();
  await new Promise(r => setTimeout(r, 400));
  assert.notEqual(p.client.state, 'live');
  assert.equal(w.devices.list().length, 0);
  assert.ok(w.pairing.active, 'the token was not used up');
  p.client.stop();
  await w.stop();
});

test('revoked: the open connection is closed at once, and the next connection gets no reply', async () => {
  const w = await paired();
  const token = w.pairing.start()!;
  const p = w.phone('Pixel 8', token);
  p.client.start();
  await until(() => p.client.state === 'live');
  w.devices.revoke(p.key.pub);
  await until(() => p.client.state !== 'live');
  const ws = open(w.port);
  const done = outcome(ws);
  const hs = new Handshake({ initiator: true, s: p.key, rs: w.hubKey.pub });
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Pixel 8' }))));
  assert.equal((await done).messages, 0);
  p.client.stop();
  await w.stop();
});

test('two devices pair and sync with each other through the hub', async () => {
  const w = await paired();
  const a = w.phone('A', w.pairing.start()!);
  a.client.start();
  await until(() => a.client.state === 'live');
  const syncId = a.client.syncId!;
  const b = w.phone('B', w.pairing.start()!, generateKeypair(), w.hubKey.pub, { syncId, name: 'Personal' });
  b.client.start();
  await until(() => b.client.state === 'live');
  assert.equal(w.devices.list().length, 2);
  (a.client as unknown as { o: { store: MemoryStore } }).o.store.edit(syncId, '00000000-0000-4000-8000-000000000001', { title: 'Hi', content: 'from A', isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  await until(() => (b.client as unknown as { o: { store: MemoryStore } }).o.store.peek(syncId, '00000000-0000-4000-8000-000000000001')?.content === 'from A');
  a.client.stop(); b.client.stop();
  await w.stop();
});

test('revoke closes the open connection even if the disk write fails, and a failed add leaves no unsaved device', async () => {
  const d = dir();
  const list = DeviceList.open(join(d, 'devices.json'), realClock);
  const k = generateKeypair().pub;
  list.add(k, 'P');
  let closed = false;
  list.onRevoke = () => { closed = true; };
  chmodSync(d, 0o500); // read-only directory: the atomic write cannot create its temporary file
  try {
    if (process.getuid?.() !== 0) {
      assert.throws(() => list.revoke(k));
      assert.ok(closed);
      assert.throws(() => list.add(generateKeypair().pub, 'Q'));
      assert.equal(list.list().length, 0, 'the failed add was rolled back');
    }
  } finally { chmodSync(d, 0o700); }
});

test('the connector returns null for a host string the URL parser refuses, instead of throwing', () => {
  const connect = wsConnector({ deviceKey: generateKeypair(), hubKey: generateKeypair().pub, name: 'P', addresses: [{ host: '10.0.0.1%x', port: 1 }, { host: '8.8.8.8', port: 1 }] });
  assert.equal(connect(), null);
  assert.equal(connect(), null);
});

test('a name is resolved first: a name that points at the internet is never dialled, one that points inside is', async () => {
  const w = await setup();
  const key = generateKeypair();
  w.known.add(Buffer.from(key.pub).toString('hex'));
  let dialled = 0;
  w.server.address(); // keep the server alive
  const mk = (ips: string[]) => new Client({
    store: new MemoryStore(1), clock: realClock, rng: Math.random, hash: sha256, link: { syncId: '', name: 'P' },
    connect: wsConnector({ deviceKey: key, hubKey: w.hubKey.pub, name: 'P', addresses: [{ host: 'studio.local', port: w.port }], resolve: async () => { dialled++; return ips; } }),
  });
  const before = w.server.connections;
  const bad = mk(['8.8.8.8']);
  bad.start();
  await new Promise(r => setTimeout(r, 300));
  assert.notEqual(bad.state, 'live');
  assert.equal(w.server.connections, before, 'nothing reached the hub');
  bad.stop();
  const mixed = mk(['127.0.0.1', '1.1.1.1']); // every answer must be private
  mixed.start();
  await new Promise(r => setTimeout(r, 300));
  assert.notEqual(mixed.state, 'live');
  mixed.stop();
  const good = mk(['127.0.0.1']);
  good.start();
  await until(() => good.state === 'live');
  assert.ok(dialled >= 3);
  good.stop();
  await w.stop();
});
