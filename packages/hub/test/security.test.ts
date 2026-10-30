// Failure-matrix security rows (docs/architecture/sync-reliability.md section 5) that need the whole transport.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CipherState, Handshake, NoiseError, SecureChannel, T, type Transport, decodeFrame, encodeFrame, encodePayload, generateKeypair, type RawSocket } from '@notespark/sync-protocol';
import { WebSocket } from 'ws';
import { open, setup, until } from './support.ts';

const NONE = new Uint8Array(0);
const FUZZ = Number(process.env.FUZZ ?? 20_000); // FUZZ=1000000 for the full run
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test(`fuzz: ${FUZZ} mutated handshake messages never crash, never authorize, never reach the engine, never get a reply`, () => {
  const hub = generateKeypair(), dev = generateKeypair();
  const good = new Handshake({ initiator: true, s: dev, rs: hub.pub }).writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Pixel', token: new Uint8Array(16) }));
  const r = seeded(20261030);
  const pick = (n: number) => Math.floor(r() * n);
  const lowOrder = [new Uint8Array(32), Uint8Array.of(1, ...new Array(31).fill(0)), Uint8Array.of(...new Array(31).fill(0), 0x80)];
  let authorized = 0, ready = 0, sent = 0, closed = 0, skipped = 0;
  const raw = (): RawSocket => ({ send: () => { sent++; }, close: () => { closed++; }, onMessage: () => {}, onClose: () => {} });
  for (let i = 0; i < FUZZ; i++) {
    let m: Uint8Array;
    switch (pick(7)) {
      case 0: m = Uint8Array.from({ length: pick(1100) }, () => pick(256)); break;
      case 1: m = good.slice(); for (let k = 0, n = 1 + pick(3); k < n; k++) m[pick(m.length)] ^= 1 << pick(8); break;
      case 2: m = good.slice(0, pick(good.length)); break;
      case 3: m = Uint8Array.of(...good, ...Array.from({ length: 1 + pick(2000) }, () => pick(256))); break;
      case 4: m = good.slice(); m.set(lowOrder[pick(3)], 0); break;
      case 5: m = good.slice(); m.fill(pick(2) ? 0 : 255, pick(m.length)); break;
      default: m = new Uint8Array(pick(70_000)); break;
    }
    if (m.length === good.length && m.every((x, j) => x === good[j])) { skipped++; continue; }
    const c = SecureChannel.hub(raw(), { s: hub, name: 'Hub', authorize: () => { authorized++; return true; }, onReady: () => { ready++; } });
    const rawSock = (c as unknown as { raw: RawSocket }).raw;
    rawSock.onMessage(m);
    assert.ok(c.closed, `input ${i} left the channel open`);
  }
  assert.equal(authorized, 0);
  assert.equal(ready, 0);
  assert.equal(sent, 0);
  assert.equal(closed + skipped, FUZZ);
  console.log(`handshake fuzz: ${FUZZ} inputs, ${skipped} unchanged copies skipped`);
});

// A raw client that has finished the handshake with the hub, so it can send hand-made transport messages.
const session = async (w: Awaited<ReturnType<typeof setup>>) => {
  const key = generateKeypair();
  w.known.add(Buffer.from(key.pub).toString('hex'));
  const ws: WebSocket = open(w.port);
  const hs = new Handshake({ initiator: true, s: key, rs: w.hubKey.pub });
  const got: Uint8Array[] = [];
  let closed = false;
  ws.on('message', (d: Buffer) => got.push(new Uint8Array(d)));
  ws.on('close', () => { closed = true; });
  ws.on('error', () => {});
  await new Promise<void>(res => ws.on('open', () => res()));
  ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Raw' })));
  await until(() => got.length >= 1);
  hs.readMessage(got.shift()!);
  const t: Transport = hs.split();
  ws.send(t.send.encrypt(NONE, Uint8Array.of(2))); // the confirm message
  const msg = (frame: Uint8Array) => t.send.encrypt(NONE, Uint8Array.of(0, ...frame));
  const frames = () => got.splice(0).map(m => decodeFrame(t.recv.decrypt(NONE, m).subarray(1)));
  return { ws, t, msg, frames, isClosed: () => closed, got: () => got };
};
const ping = (n: number) => encodeFrame({ type: T.PING, nonce: n });

test('a replayed transport message closes the connection and is applied once', async () => {
  const w = await setup();
  const s = await session(w);
  const m = s.msg(ping(7));
  s.ws.send(m);
  await until(() => s.got().length >= 2); // PROFILES, PONG
  assert.equal(s.frames().filter(f => f.type === T.PONG).length, 1);
  s.ws.send(m); // the same bytes again
  await until(() => s.isClosed());
  assert.equal(s.got().length, 0, 'no second PONG');
  await w.stop();
});

test('an altered transport message closes the connection', async () => {
  const w = await setup();
  const s = await session(w);
  const m = s.msg(ping(1));
  m[m.length >> 1] ^= 0x10;
  s.ws.send(m);
  await until(() => s.isClosed());
  assert.ok(!s.frames().some(f => f.type === T.PONG));
  await w.stop();
});

test('a dropped (skipped) transport message closes the connection', async () => {
  const w = await setup();
  const s = await session(w);
  s.msg(ping(1)); // encrypted but never sent
  s.ws.send(s.msg(ping(2)));
  await until(() => s.isClosed());
  assert.ok(!s.frames().some(f => f.type === T.PONG));
  await w.stop();
});

test('after the handshake a plaintext frame is never accepted', async () => {
  const w = await setup();
  const s = await session(w);
  s.ws.send(ping(3)); // a bare frame, not Noise
  await until(() => s.isClosed());
  assert.ok(!s.frames().some(f => f.type === T.PONG));
  await w.stop();
});

test('a text WebSocket message closes the connection', async () => {
  const w = await setup();
  const ws = open(w.port);
  await new Promise<void>(res => ws.on('open', () => res()));
  ws.on('error', () => {});
  const closed = new Promise<void>(res => ws.on('close', () => res()));
  ws.send('hello');
  await closed;
  await w.stop();
});

test(`fuzz: ${FUZZ} mutated transport messages are never accepted by the receiving cipher`, () => {
  const hub = generateKeypair(), dev = generateKeypair();
  const ini = new Handshake({ initiator: true, s: dev, rs: hub.pub }), res = new Handshake({ initiator: false, s: hub });
  res.readMessage(ini.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'P' })));
  ini.readMessage(res.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'H' })));
  const tx = ini.split(), rx = res.split();
  const key = rx.recv.k!.slice();
  const sample = tx.send.encrypt(NONE, Uint8Array.of(0, ...ping(5)));
  const r = seeded(99), pick = (n: number) => Math.floor(r() * n);
  let accepted = 0, unchanged = 0;
  for (let i = 0; i < FUZZ; i++) {
    let m: Uint8Array;
    switch (pick(4)) {
      case 0: m = Uint8Array.from({ length: pick(200) }, () => pick(256)); break;
      case 1: m = sample.slice(); for (let k = 0, n = 1 + pick(3); k < n; k++) m[pick(m.length)] ^= 1 << pick(8); break;
      case 2: m = sample.slice(0, pick(sample.length)); break;
      default: m = Uint8Array.of(...sample, ...Array.from({ length: 1 + pick(40) }, () => pick(256))); break;
    }
    if (m.length === sample.length && m.every((x, j) => x === sample[j])) { unchanged++; continue; }
    try { new CipherState(key.slice()).decrypt(NONE, m); accepted++; } catch (e) { assert.ok(e instanceof NoiseError); }
  }
  assert.equal(accepted, 0);
  assert.ok(new CipherState(key.slice()).decrypt(NONE, sample)); // the real one still passes
  console.log(`transport fuzz: ${FUZZ} inputs, ${unchanged} unchanged copies skipped`);
});
