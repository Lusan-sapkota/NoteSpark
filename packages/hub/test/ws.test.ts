import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { FakeClock, Handshake, PROTOCOL_VERSION, T, decodeFrame, encodePayload, generateKeypair } from '@notespark/sync-protocol';
import { WebSocket } from 'ws';
import { SUBPROTOCOL } from '../src/wsClient.ts';
import { U, note, open, outcome, rawTcp, setup, sleep, until } from './support.ts';

test('the engine over real ws and Noise: notes reach the hub and a second device, big notes are fragmented', async () => {
  const w = await setup();
  const big = 'x'.repeat(300_000); // several 64 KB chunks, each a frame larger than one Noise message
  const a = w.device('A', undefined, { syncId: '', name: 'Personal' });
  a.store.plain.set(U(11), note('One', big));
  a.client.start();
  await until(() => a.client.state === 'live').catch(e => { throw new Error(`${e.message}: ${a.client.state} ${a.client.attempts} ${w.log}`); });
  const syncId = a.client.syncId!;
  assert.equal(w.store.peek(syncId, U(11))?.content, big);
  const b = w.device('B', undefined, { syncId, name: 'Personal' });
  b.client.start();
  await until(() => b.client.state === 'live');
  await until(() => b.store.peek(syncId, U(11))?.content === big);
  a.store.edit(syncId, U(12), note('Live'));
  await until(() => b.store.peek(syncId, U(12))?.title === 'Live');
  a.client.stop(); b.client.stop();
  await w.stop();
});

test('an unknown device gets no reply at all, and nothing is stored', async () => {
  const w = await setup();
  const stranger = generateKeypair();
  const ws = open(w.port);
  const done = outcome(ws);
  const hs = new Handshake({ initiator: true, s: stranger, rs: w.hubKey.pub });
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Eve' }))));
  const r = await done;
  assert.equal(r.messages, 0);
  assert.ok(w.log.includes('unknown device'));
  assert.equal((await w.store.profiles()).length, 0);
  await w.stop();
});

test('a wrong hub key and garbage get no reply either', async () => {
  const w = await setup();
  const ws = open(w.port);
  const done = outcome(ws);
  const hs = new Handshake({ initiator: true, s: generateKeypair(), rs: generateKeypair().pub });
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'X' }))));
  assert.equal((await done).messages, 0);
  const ws2 = open(w.port);
  const done2 = outcome(ws2);
  ws2.on('open', () => ws2.send(new Uint8Array(120).fill(7)));
  assert.equal((await done2).messages, 0);
  await w.stop();
});

test('an upgrade with an Origin header (a web page) is refused before the handshake', async () => {
  const w = await setup();
  const r = await outcome(open(w.port, { headers: { Origin: 'https://evil.example' } }));
  assert.equal(r.opened, false);
  assert.ok(w.log.includes('refused: Origin header'));
  await w.stop();
});

test('the subprotocol is required; another subprotocol and none are refused', async () => {
  const w = await setup();
  assert.equal((await outcome(open(w.port, { protocols: 'chat' }))).opened, false);
  const none = new WebSocket(`ws://127.0.0.1:${w.port}`);
  none.on('error', () => {});
  assert.equal((await outcome(none)).opened, false);
  await w.stop();
});

test('a public peer address is closed at accept', async () => {
  const w = await setup({ peerAddress: () => '8.8.8.8' });
  const r = await outcome(open(w.port));
  assert.equal(r.opened, false);
  assert.ok(w.log.includes('refused: public address'));
  await w.stop();
});

test('plain HTTP and a TLS hello get nothing back', async () => {
  const w = await setup();
  const http = await rawTcp(w.port, new TextEncoder().encode('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
  assert.equal(http.received, 0);
  const tls = await rawTcp(w.port, Uint8Array.of(0x16, 0x03, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00, 0x01, 0x00));
  assert.equal(tls.received, 0);
  await w.stop();
});

test('slowloris: a socket that sends nothing, or a header a byte at a time, is closed at the first-message limit', async () => {
  const w = await setup({ limits: { firstMessageMs: 300 } });
  const idle = await rawTcp(w.port, null);
  assert.ok(idle.closedAfterMs >= 250 && idle.closedAfterMs < 2000, String(idle.closedAfterMs));
  const t0 = Date.now();
  const s = net.connect(w.port, '127.0.0.1');
  s.on('error', () => {});
  const closed = new Promise<void>(r => s.on('close', () => r()));
  for (const ch of 'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n') { if (s.destroyed) break; s.write(ch); await sleep(40); }
  await closed;
  assert.ok(Date.now() - t0 < 2000);
  await w.stop();
});

test('a connected socket that never sends the handshake is closed, and one that sends over 1 KB is closed', async () => {
  const w = await setup({ limits: { firstMessageMs: 300 } });
  const silent = open(w.port);
  const t0 = Date.now();
  const r = await outcome(silent);
  assert.equal(r.opened, true);
  assert.ok(Date.now() - t0 < 2000);
  const loud = open(w.port);
  const done = outcome(loud);
  loud.on('open', () => loud.send(new Uint8Array(1025).fill(1)));
  assert.equal((await done).messages, 0);
  await w.stop();
});

test('connection caps: per address and global', async () => {
  const w = await setup({ limits: { maxPerIp: 2, firstMessageMs: 5000 } });
  const socks = [0, 1, 2].map(() => net.connect(w.port, '127.0.0.1'));
  const results = socks.map(s => new Promise<boolean>(r => { s.on('error', () => {}); s.on('close', () => r(true)); setTimeout(() => r(false), 400); }));
  const closed = await Promise.all(results);
  assert.equal(closed.filter(Boolean).length, 1);
  assert.equal(w.server.connections, 2);
  socks.forEach(s => s.destroy());
  await w.stop();
});

test('connection rate limit per address', async () => {
  const w = await setup({ limits: { newPerIp: 3, maxPerIp: 100, windowMs: 60_000, firstMessageMs: 5000 } });
  const outcomes: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const s = net.connect(w.port, '127.0.0.1');
    s.on('error', () => {});
    outcomes.push(await new Promise<boolean>(r => { s.on('close', () => r(true)); setTimeout(() => { s.destroy(); r(false); }, 150); }));
  }
  assert.deepEqual(outcomes, [false, false, false, true, true, true]);
  assert.ok(w.log.includes('refused: rate limit'));
  await w.stop();
});

test('a version this hub cannot speak gets the handshake, then 409, and nothing else', async () => {
  const w = await setup();
  const key = generateKeypair();
  w.known.add(Buffer.from(key.pub).toString('hex'));
  const ws = open(w.port);
  const hs = new Handshake({ initiator: true, s: key, rs: w.hubKey.pub });
  const got: Uint8Array[] = [];
  ws.on('message', d => got.push(new Uint8Array(d as Buffer)));
  const done = outcome(ws);
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: PROTOCOL_VERSION + 5, minVersion: PROTOCOL_VERSION + 5, name: 'Future' }))));
  await done;
  assert.equal(got.length, 2); // message 2, then one encrypted frame
  hs.readMessage(got[0]);
  const t = hs.split();
  const plain = t.recv.decrypt(new Uint8Array(0), got[1]);
  const f = decodeFrame(plain.subarray(1));
  assert.equal(f.type, T.ERROR);
  assert.equal((f as { code: number }).code, 409);
  await w.stop();
});

test('a socket whose peer stops answering pings is dead after 45 s (fake clock)', async () => {
  const clock = new FakeClock();
  const w = await setup({ clock });
  const d = w.device();
  d.client.start();
  await until(() => d.client.state === 'connecting' || d.client.state === 'syncing' || d.client.state === 'live');
  const key = generateKeypair();
  w.known.add(Buffer.from(key.pub).toString('hex'));
  const ws = open(w.port);
  (ws as unknown as { pong: () => void }).pong = () => {}; // this peer never answers
  const hs = new Handshake({ initiator: true, s: key, rs: w.hubKey.pub });
  const done = outcome(ws);
  ws.on('open', () => ws.send(hs.writeMessage(encodePayload({ version: 1, minVersion: 1, name: 'Mute' }))));
  await until(() => w.server.connections >= 2);
  for (let i = 0; i < 4; i++) { await clock.advance(15_000); await sleep(20); }
  await done;
  d.client.stop();
  await w.stop();
});

test('revoked: closeDevice ends an open connection at once', async () => {
  const w = await setup();
  const a = w.device('A', undefined, { syncId: '', name: 'P' });
  a.client.start();
  await until(() => a.client.state === 'live');
  w.server.closeDevice(a.key.pub);
  await until(() => a.client.state === 'waiting');
  a.client.stop();
  await w.stop();
});

test('the hub binds only to what it is given', async () => {
  const w = await setup();
  assert.equal((w.server.address() as net.AddressInfo).address, '127.0.0.1');
  await w.stop();
});

test('limitKey: IPv4 as is, IPv6 by its /64, mapped and bracketed forms normalised', async () => {
  const { limitKey } = await import('../src/wsServer.ts');
  assert.equal(limitKey('192.168.1.5'), '192.168.1.5');
  assert.equal(limitKey('::ffff:192.168.1.5'), '192.168.1.5');
  assert.equal(limitKey('fd00::1'), limitKey('fd00::abcd:1'));
  assert.equal(limitKey('fd00:0:0:1::5'), limitKey('FD00:0:0:1:aaaa:bbbb:cccc:dddd'));
  assert.notEqual(limitKey('fd00:0:0:1::5'), limitKey('fd00:0:0:2::5'));
  assert.equal(limitKey('[fe80::1%eth0]'), limitKey('fe80::2'));
  assert.equal(limitKey('fd00:1:2:3:4:5:6:7'), 'fd00:0001:0002:0003::/64');
});

test('one IPv6 /64 shares one connection cap, however many addresses it uses', async () => {
  let n = 0;
  const w = await setup({ limits: { maxPerIp: 2, firstMessageMs: 5000 }, peerAddress: () => `fd00::${(++n).toString(16)}` });
  const socks = [0, 1, 2, 3].map(() => net.connect(w.port, '127.0.0.1'));
  const closed = await Promise.all(socks.map(s => new Promise<boolean>(r => { s.on('error', () => {}); s.on('close', () => r(true)); setTimeout(() => r(false), 400); })));
  assert.equal(closed.filter(Boolean).length, 2);
  assert.equal(w.server.connections, 2);
  socks.forEach(s => s.destroy());
  await w.stop();
});
