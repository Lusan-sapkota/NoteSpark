// The phone's transport (mobile/src/sync) against the real HubServer, with the `ws` package standing in for React Native's
// WebSocket (same constructor shape, same on* handlers). What only a device can show is listed in docs/architecture/sync-reliability.md.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { APP_ORIGIN, PairingMode, generateKeypair, pairingUri, parsePairing, realClock, type Keypair } from '@notespark/sync-protocol';
import { WebSocket } from 'ws';
import type { WS, WSConstructor } from '../../../mobile/src/sync/rawSocket.ts';
import { MemoryStore } from '@notespark/sync';
import { U, note, setup, until } from './support.ts';

process.env.NOTESPARK_DIR ??= mkdtempSync(join(tmpdir(), 'notespark-phone-'));
const sync = '../../../mobile/src/sync/';
const shims = '../../node-shims/src/'; // the same modules the loader maps expo-secure-store and async-storage to
const { rawFromRN, rnConnector } = await import(`${sync}rawSocket.ts`);
const { deviceKey } = await import(`${sync}deviceKey.ts`);
const { forgetHub, getHubs, saveHub, setProfileSync, syncedProfiles } = await import(`${sync}pairings.ts`);
const { createSyncClient } = await import(`${sync}SyncManager.ts`);

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// A hub that lets in known keys and one pairing token, like the desktop's host.
const hubWithPairing = async () => {
  const pairing = new PairingMode(realClock);
  const known = new Set<string>();
  const w = await setup({ authorize: (k, hello) => known.has(hex(k)) || (!!hello.token && pairing.check(hello.token) && (known.add(hex(k)), true)) });
  const link = () => parsePairing(pairingUri({ hubKey: w.hubKey.pub, token: pairing.start()!, port: w.port, name: 'Test hub', addresses: ['127.0.0.1'] }));
  return { w, known, link };
};

// Records every socket made, so a test can cut one.
const recording = () => {
  const made: { ws: WebSocket; url: string; origin?: string }[] = [];
  const Ctor = class extends WebSocket {
    constructor(url: string, protocols: string, options: { headers: Record<string, string> }) {
      super(url, protocols, { headers: options.headers, perMessageDeflate: false });
      made.push({ ws: this, url, origin: options.headers.Origin });
    }
  } as unknown as WSConstructor;
  return { made, Ctor };
};

test('device key: made once, kept as 64 hex characters in secure store, the same on the next call', async () => {
  const a = await deviceKey(), b = await deviceKey();
  assert.equal(hex(a.priv), hex(b.priv));
  assert.equal(hex(a.pub), hex(b.pub));
  const SecureStore = await import(`${shims}expo-secure-store.ts`);
  assert.match((await SecureStore.getItemAsync('syncDeviceKey'))!, /^[0-9a-f]{64}$/);
});

test('pair with a scanned link, sync both ways, fragments over 64 KB, the app Origin is sent, the token is dropped', async () => {
  const { w, link } = await hubWithPairing();
  const { made, Ctor } = recording();
  const scanned = link();
  const hub = await saveHub(scanned);
  const big = 'y'.repeat(300_000);
  const phone = new MemoryStore(50);
  phone.plain.set(U(1), note('From phone', big));
  const states: string[] = [];
  const client = createSyncClient({ store: phone, deviceKey: await deviceKey(), hub, deviceName: 'Pixel', link: { syncId: '', name: 'Personal' }, token: scanned.token, WebSocket: Ctor, onState: (s: string) => states.push(s) });
  client.start();
  await until(() => client.state === 'live');
  const syncId = client.syncId!;
  assert.equal(w.store.peek(syncId, U(1))?.content, big);
  assert.ok(made.length >= 1 && made.every(m => m.origin === APP_ORIGIN && m.url === `ws://127.0.0.1:${w.port}`));
  assert.equal(scanned.token.every(b => b === 0), true, 'the token is wiped once the first session is live');
  w.store.edit(syncId, U(2), note('From computer'));
  await until(() => phone.peek(syncId, U(2))?.title === 'From computer');
  phone.edit(syncId, U(3), note('Live edit'));
  await until(() => w.store.peek(syncId, U(3))?.title === 'Live edit');
  client.stop();
  await w.stop();
});

test('a cut socket reconnects by itself, with no token (the device is known now)', async () => {
  const { w, link } = await hubWithPairing();
  const { made, Ctor } = recording();
  const scanned = link();
  const phone = new MemoryStore(51);
  const client = createSyncClient({ store: phone, deviceKey: await deviceKey(), hub: await saveHub(scanned), deviceName: 'Pixel', link: { syncId: '', name: 'Personal' }, token: scanned.token, WebSocket: Ctor });
  client.start();
  await until(() => client.state === 'live');
  const before = made.length;
  made[made.length - 1].ws.terminate();
  await until(() => client.state !== 'live');
  await until(() => client.state === 'live', 30_000);
  assert.ok(made.length > before);
  client.stop();
  await w.stop();
});

test('an unknown device gets no reply: it never syncs, the hub logs it, the client keeps retrying and stops cleanly', async () => {
  const { w, link } = await hubWithPairing();
  const { Ctor } = recording();
  const phone = new MemoryStore(52);
  const client = createSyncClient({ store: phone, deviceKey: generateKeypair(), hub: await saveHub(link()), deviceName: 'Stranger', link: { syncId: '', name: 'Personal' }, WebSocket: Ctor });
  try {
    client.start();
    await until(() => w.log.includes('unknown device'));
    assert.ok(client.state === 'waiting' || client.state === 'connecting', client.state); // no 403: the hub says nothing to a stranger
    assert.equal(client.syncId, undefined);
    assert.equal(phone.plain.size, 0);
  } finally {
    client.stop();
    await w.stop();
  }
});

test('a public address or a name is never dialled', async () => {
  let dialled = 0;
  const Ctor = class { constructor() { dialled++; } } as unknown as WSConstructor;
  const key: Keypair = generateKeypair();
  for (const host of ['8.8.8.8', '1.1.1.1', 'example.com', 'hub.local', 'mypc.tailnet.ts.net', '2606:4700::1111', '10.0.0.1.evil.com']) {
    const c = rnConnector({ WebSocket: Ctor, deviceKey: key, hubKey: key.pub, name: 'x', addresses: [{ host, port: 4578 }] });
    assert.equal(c(), null, host);
  }
  assert.equal(dialled, 0);
  const ok = rnConnector({ WebSocket: class { constructor() { dialled++; throw new Error('stop'); } } as unknown as WSConstructor, deviceKey: key, hubKey: key.pub, name: 'x', addresses: [{ host: '192.168.1.20', port: 4578 }] });
  assert.equal(ok(), null); // a private literal is tried (and the constructor refusing is survived)
  assert.equal(dialled, 1);
});

test('rawFromRN: text frames and messages over 65,535 bytes end the socket; binary passes; sends wait for open', () => {
  const make = () => {
    const sent: Uint8Array[] = [];
    const ws = { binaryType: '', readyState: 0, send: (d: Uint8Array) => void sent.push(d), close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null } as unknown as WS;
    const raw = rawFromRN(ws);
    const got: Uint8Array[] = [];
    let closed = 0;
    raw.onMessage = (d: Uint8Array) => got.push(d);
    raw.onClose = () => closed++;
    return { ws, raw, sent, got, closed: () => closed };
  };
  const a = make();
  a.raw.send(Uint8Array.of(1));
  assert.equal(a.sent.length, 0);
  a.ws.readyState = 1; a.ws.onopen!({});
  assert.deepEqual(a.sent, [Uint8Array.of(1)]);
  a.ws.onmessage!({ data: new Uint8Array([5, 6]).buffer });
  assert.deepEqual(a.got, [Uint8Array.of(5, 6)]);
  assert.equal(a.ws.binaryType, 'arraybuffer');
  a.ws.onmessage!({ data: 'text' });
  assert.equal(a.closed(), 1);
  const b = make();
  b.ws.onmessage!({ data: new ArrayBuffer(65_536) });
  assert.equal(b.closed(), 1);
  const c = make();
  c.ws.onmessage!({ data: new ArrayBuffer(65_535) });
  assert.equal(c.got.length, 1);
  c.raw.close(true); c.raw.close();
  assert.equal(c.closed(), 1, 'onClose fires once');
});

test('pairing records hold public data only; forgetting a computer also turns its profiles off', async () => {
  const { w, link } = await hubWithPairing();
  const hub = await saveHub(link());
  await setProfileSync('p1', hub.id);
  assert.deepEqual(Object.keys(hub).sort(), ['addresses', 'hubKey', 'id', 'name', 'pairedAt', 'port']);
  const AsyncStorage = (await import(`${shims}async-storage.ts`)).default;
  const raw = (await AsyncStorage.getItem('syncHubs'))!;
  assert.ok(!/token/i.test(raw));
  assert.equal((await getHubs()).filter((h: { id: string }) => h.id === hub.id).length, 1);
  await saveHub(parsePairing(pairingUri({ hubKey: Buffer.from(hub.hubKey, 'hex'), token: new Uint8Array(16).fill(9), port: 1234, name: 'Renamed', addresses: ['10.0.0.2'] })));
  assert.equal((await getHubs()).filter((h: { id: string }) => h.id === hub.id).length, 1, 'the same key is one record');
  await forgetHub(hub.id);
  assert.equal((await getHubs()).some((h: { id: string }) => h.id === hub.id), false);
  assert.equal((await syncedProfiles()).p1, undefined);
  await w.stop();
});
