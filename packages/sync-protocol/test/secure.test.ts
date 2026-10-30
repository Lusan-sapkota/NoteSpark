import assert from 'node:assert/strict';
import test from 'node:test';
import { type RawSocket, SecureChannel, generateKeypair, MAX_FRAME } from '../src/index.ts';

// An in-memory socket pair; messages are delivered on a later tick, in order.
const pair = (): [RawSocket, RawSocket] => {
  const mk = (): RawSocket => ({ send: () => {}, close: () => {}, onMessage: () => {}, onClose: () => {} });
  const [a, b] = [mk(), mk()];
  let open = true;
  const wire = (from: RawSocket, to: RawSocket) => {
    from.send = d => { const c = d.slice(); if (open) setImmediate(() => open && to.onMessage(c)); };
    from.close = () => { if (!open) return; open = false; setImmediate(() => { a.onClose(); b.onClose(); }); };
  };
  wire(a, b); wire(b, a);
  return [a, b];
};
const tick = () => new Promise(r => setImmediate(r));
const connect = async (known = true) => {
  const hub = generateKeypair(), dev = generateKeypair();
  const [ra, rb] = pair();
  let server: SecureChannel | null = null;
  const c = SecureChannel.client(ra, { s: dev, hubKey: hub.pub, name: 'Phone' });
  const h = SecureChannel.hub(rb, { s: hub, name: 'Hub', authorize: () => known, onReady: s => { server = s; } });
  for (let i = 0; i < 5; i++) await tick();
  return { c, h, server: server as SecureChannel | null };
};

test('frames of every awkward size cross intact, fragmented as needed', async () => {
  const { c, server } = await connect();
  assert.ok(server && c.ready);
  const got: Uint8Array[] = [];
  server!.onMessage = d => got.push(d);
  const sizes = [1, 65517, 65518, 65519, 65520, 131_036, 131_037, 300_000, MAX_FRAME];
  for (const n of sizes) c.send(Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 255));
  for (let i = 0; i < 40; i++) await tick();
  assert.deepEqual(got.map(g => g.length), sizes);
  sizes.forEach((n, i) => assert.equal(got[i][n - 1], ((n - 1) * 7 + n) & 255));
  assert.equal(c.peer!.name, 'Hub');
  assert.equal(server!.peer!.name, 'Phone');
});

test('frames sent before the handshake finishes are held, then delivered in order', async () => {
  const hub = generateKeypair(), dev = generateKeypair();
  const [ra, rb] = pair();
  const c = SecureChannel.client(ra, { s: dev, hubKey: hub.pub, name: 'P' });
  c.send(Uint8Array.of(1)); c.send(Uint8Array.of(2));
  const got: number[] = [];
  SecureChannel.hub(rb, { s: hub, name: 'H', authorize: () => true, onReady: s => { s.onMessage = d => got.push(d[0]); } });
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(got, [1, 2]);
});

test('a message that is not a valid Noise message closes the channel and delivers nothing', async () => {
  const { c, server } = await connect();
  let delivered = 0, closed = false;
  server!.onMessage = () => { delivered++; };
  server!.onClose = () => { closed = true; };
  const [ra] = [(c as unknown as { raw: RawSocket }).raw];
  ra.send(new Uint8Array(50));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(delivered, 0);
  assert.ok(closed);
});

test('an unknown device: no reply, and the work done is the same as for a known one', async () => {
  const run = async (known: boolean) => {
    const hub = generateKeypair(), dev = generateKeypair();
    const [ra, rb] = pair();
    let replies = 0;
    ra.onMessage = () => { replies++; };
    const msg: Uint8Array[] = [];
    const c = SecureChannel.client({ ...ra, send: d => msg.push(d), onMessage: () => {} } as RawSocket, { s: dev, hubKey: hub.pub, name: 'P' });
    void c;
    const t0 = process.hrtime.bigint();
    SecureChannel.hub(rb, { s: hub, name: 'H', authorize: () => known, onReady: () => {} }).onClose = () => {};
    rb.onMessage(msg[0]);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    return { dt, sent: replies };
  };
  const times = { known: [] as number[], unknown: [] as number[] };
  for (let i = 0; i < 60; i++) { times.known.push((await run(true)).dt); times.unknown.push((await run(false)).dt); }
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
  const [k, u] = [med(times.known), med(times.unknown)];
  console.log(`handshake work, median ms: known ${k.toFixed(2)}, unknown ${u.toFixed(2)}`);
  assert.ok(Math.abs(k - u) / k < 0.5, `known ${k} unknown ${u}`);
  // And the unknown path sends nothing.
  const hub = generateKeypair(), dev = generateKeypair();
  const [ra, rb] = pair();
  let heard = 0;
  ra.onMessage = () => { heard++; };
  SecureChannel.client(ra, { s: dev, hubKey: hub.pub, name: 'P' });
  SecureChannel.hub(rb, { s: hub, name: 'H', authorize: () => false, onReady: () => {} });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(heard, 0);
});

test('a replayed message 1 never reaches the engine: the hub waits for the device to prove it holds its keys', async () => {
  const hub = generateKeypair(), dev = generateKeypair();
  const sent: Uint8Array[] = [];
  const first = SecureChannel.client({ send: d => sent.push(d), close: () => {}, onMessage: () => {}, onClose: () => {} } as RawSocket, { s: dev, hubKey: hub.pub, name: 'P' });
  void first;
  const message1 = sent[0];
  let ready = 0, replies = 0;
  const raw: RawSocket = { send: () => { replies++; }, close: () => {}, onMessage: () => {}, onClose: () => {} };
  const ch = SecureChannel.hub(raw, { s: hub, name: 'H', authorize: () => true, onReady: () => { ready++; } });
  raw.onMessage(message1); // the attacker replays what it recorded
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(ready, 0);
  assert.equal(replies, 1, 'only the handshake reply');
  raw.onMessage(new Uint8Array(40).fill(3)); // anything but a valid confirm closes it
  assert.ok(ch.closed);
  assert.equal(ready, 0);
});

test('endless empty continuation fragments close the channel', async () => {
  const { c, server } = await connect();
  let closed = false;
  server!.onClose = () => { closed = true; };
  const t = (c as unknown as { t: { send: { encrypt: (a: Uint8Array, p: Uint8Array) => Uint8Array } } }).t;
  const raw = (c as unknown as { raw: RawSocket }).raw;
  raw.send(t.send.encrypt(new Uint8Array(0), Uint8Array.of(1)));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(closed);
});
