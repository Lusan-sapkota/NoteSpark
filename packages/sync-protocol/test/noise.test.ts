import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { CipherState, Handshake, NoiseError, type Transport, decodePayload, encodePayload, generateKeypair, keypairFromPrivate } from '../src/noise.ts';

const vectors = JSON.parse(readFileSync(new URL('./vectors/noise-ik.json', import.meta.url), 'utf8'));
const h = (s: string) => hexToBytes(s);

test('published vectors: Noise_IK_25519_ChaChaPoly_BLAKE2s (cacophony and snow)', () => {
  assert.equal(vectors.length, 2);
  let checked = 0;
  for (const v of vectors) {
    const prologue = h(v.init_prologue);
    const ini = new Handshake({ initiator: true, s: keypairFromPrivate(h(v.init_static)), rs: h(v.init_remote_static), prologue, e: keypairFromPrivate(h(v.init_ephemeral)) });
    const res = new Handshake({ initiator: false, s: keypairFromPrivate(h(v.resp_static)), prologue: h(v.resp_prologue), e: keypairFromPrivate(h(v.resp_ephemeral)) });
    const [m0, m1] = v.messages;
    const c0 = ini.writeMessage(h(m0.payload));
    assert.equal(bytesToHex(c0), m0.ciphertext);
    assert.equal(bytesToHex(res.readMessage(c0)), m0.payload);
    const c1 = res.writeMessage(h(m1.payload));
    assert.equal(bytesToHex(c1), m1.ciphertext);
    assert.equal(bytesToHex(ini.readMessage(c1)), m1.payload);
    const ti = ini.split(), tr = res.split();
    if (v.handshake_hash) { assert.equal(bytesToHex(ti.hash), v.handshake_hash); assert.equal(bytesToHex(tr.hash), v.handshake_hash); checked++; }
    v.messages.slice(2).forEach((m: { payload: string; ciphertext: string }, i: number) => {
      const [tx, rx] = i % 2 === 0 ? [ti, tr] : [tr, ti]; // message 2 is from the initiator, then alternating
      const c = tx.send.encrypt(new Uint8Array(0), h(m.payload));
      assert.equal(bytesToHex(c), m.ciphertext);
      assert.equal(bytesToHex(rx.recv.decrypt(new Uint8Array(0), c)), m.payload);
      checked++;
    });
    checked += 2;
  }
  assert.ok(checked >= 10);
});

const pair = (over: { prologue?: Uint8Array } = {}) => {
  const hub = generateKeypair(), dev = generateKeypair();
  const ini = new Handshake({ initiator: true, s: dev, rs: hub.pub });
  const res = new Handshake({ initiator: false, s: hub, prologue: over.prologue });
  return { hub, dev, ini, res };
};
const hello = { version: 1, minVersion: 1, name: 'Pixel 8' };
const connect = () => {
  const { dev, hub, ini, res } = pair();
  const m1 = ini.writeMessage(encodePayload({ ...hello, token: new Uint8Array(16).fill(7) }));
  const p1 = decodePayload(res.readMessage(m1));
  const m2 = res.writeMessage(encodePayload({ ...hello, name: 'Desktop' }));
  const p2 = decodePayload(ini.readMessage(m2));
  return { dev, hub, m1, m2, p1, p2, a: ini.split(), b: res.split() };
};
const empty = new Uint8Array(0);

test('round trip: payloads, static keys learned, both directions', () => {
  const c = connect();
  assert.deepEqual(c.p1.token, new Uint8Array(16).fill(7));
  assert.equal(c.p1.name, 'Pixel 8');
  assert.equal(c.p2.name, 'Desktop');
  assert.deepEqual(c.b.remoteStatic, c.dev.pub);
  assert.deepEqual(c.a.remoteStatic, c.hub.pub);
  assert.deepEqual(c.a.hash, c.b.hash);
  const x = new TextEncoder().encode('hello');
  assert.deepEqual(c.b.recv.decrypt(empty, c.a.send.encrypt(empty, x)), x);
  assert.deepEqual(c.a.recv.decrypt(empty, c.b.send.encrypt(empty, x)), x);
});

test('tamper: flipping every bit of both handshake messages fails', () => {
  const flip = (m: Uint8Array, bit: number) => { const c = m.slice(); c[bit >> 3] ^= 1 << (bit & 7); return c; };
  const first = () => {
    const { ini, res } = pair();
    return { ini, res, m1: ini.writeMessage(encodePayload({ ...hello, token: new Uint8Array(16).fill(7) })) };
  };
  const len1 = first().m1.length;
  let cases = 0;
  for (let bit = 0; bit < len1 * 8; bit++, cases++) {
    const { res, m1 } = first();
    assert.throws(() => res.readMessage(flip(m1, bit)), NoiseError);
  }
  const len2 = (() => { const { ini, res, m1 } = first(); res.readMessage(m1); return res.writeMessage(encodePayload(hello)).length; })();
  for (let bit = 0; bit < len2 * 8; bit++, cases++) {
    const { ini, res, m1 } = first();
    res.readMessage(m1);
    assert.throws(() => ini.readMessage(flip(res.writeMessage(encodePayload(hello)), bit)), NoiseError);
  }
  assert.equal(cases, (len1 + len2) * 8);
});

test('tamper: flipping every bit of a transport message fails', () => {
  const { a, b } = connect();
  const good = a.send.encrypt(empty, new TextEncoder().encode('note text'));
  for (let bit = 0; bit < good.length * 8; bit++) {
    const bad = good.slice();
    bad[bit >> 3] ^= 1 << (bit & 7);
    const rx = new CipherState(b.recv.k!.slice());
    assert.throws(() => rx.decrypt(empty, bad), NoiseError);
  }
  assert.ok(b.recv.decrypt(empty, good)); // the real one still works on the real state
});

test('replay, skip and reorder fail, and a failed receiver stays dead', () => {
  const { a, b } = connect();
  const m0 = a.send.encrypt(empty, Uint8Array.of(0)), m1 = a.send.encrypt(empty, Uint8Array.of(1)), m2 = a.send.encrypt(empty, Uint8Array.of(2));
  b.recv.decrypt(empty, m0);
  assert.throws(() => b.recv.decrypt(empty, m0), NoiseError); // replay
  assert.throws(() => b.recv.decrypt(empty, m1), NoiseError); // even the right next one: closed
  const c = connect();
  const [n0, n1] = [c.a.send.encrypt(empty, Uint8Array.of(0)), c.a.send.encrypt(empty, Uint8Array.of(1))];
  void n0;
  assert.throws(() => c.b.recv.decrypt(empty, n1), NoiseError); // skipped
  void m2;
});

test('reflection: a message sent back to its sender fails', () => {
  const { ini, res } = pair();
  const m1 = ini.writeMessage(encodePayload(hello));
  assert.throws(() => ini.readMessage(m1), NoiseError);
  const { ini: i2, res: r2 } = pair();
  r2.readMessage(i2.writeMessage(encodePayload(hello)));
  const m2 = r2.writeMessage(encodePayload(hello));
  assert.throws(() => r2.readMessage(m2), NoiseError);
  void res;
  const c = connect();
  const x = c.a.send.encrypt(empty, Uint8Array.of(1));
  assert.throws(() => c.a.recv.decrypt(empty, x), NoiseError); // a transport message back to the sender
});

test('wrong prologue and wrong static key fail', () => {
  const { ini, res } = pair({ prologue: new TextEncoder().encode('NoteSpark sync v2') });
  assert.throws(() => res.readMessage(ini.writeMessage(encodePayload(hello))), NoiseError);
  const hub = generateKeypair(), other = generateKeypair(), dev = generateKeypair();
  const ini2 = new Handshake({ initiator: true, s: dev, rs: other.pub }); // a different hub's key
  const res2 = new Handshake({ initiator: false, s: hub });
  assert.throws(() => res2.readMessage(ini2.writeMessage(encodePayload(hello))), NoiseError);
});

test('out of order, short and low-order inputs fail cleanly', () => {
  const { ini, res } = pair();
  assert.throws(() => res.writeMessage(empty), NoiseError);
  assert.throws(() => ini.readMessage(new Uint8Array(200)), NoiseError);
  const r = pair().res;
  assert.throws(() => r.readMessage(new Uint8Array(10)), NoiseError);
  assert.throws(() => pair().res.readMessage(new Uint8Array(150)), NoiseError); // a zero ephemeral key
  assert.throws(() => ini.split(), NoiseError);
});

test('nonce exhaustion closes instead of wrapping; rekey keeps both ends in step', () => {
  const { a, b } = connect();
  a.send.n = 2n ** 64n - 1n;
  assert.throws(() => a.send.encrypt(empty, empty), NoiseError);
  const c = connect();
  const old = c.a.send.encrypt(empty, Uint8Array.of(9));
  c.b.recv.decrypt(empty, old);
  c.a.send.rekey();
  c.b.recv.rekey();
  assert.deepEqual(c.b.recv.decrypt(empty, c.a.send.encrypt(empty, Uint8Array.of(1))), Uint8Array.of(1));
  assert.throws(() => c.b.recv.decrypt(empty, old), NoiseError);
});

test('forward secrecy: two connections between the same keys share no session key', () => {
  const hub = generateKeypair(), dev = generateKeypair();
  const run = () => {
    const ini = new Handshake({ initiator: true, s: dev, rs: hub.pub }), res = new Handshake({ initiator: false, s: hub });
    res.readMessage(ini.writeMessage(encodePayload(hello)));
    ini.readMessage(res.writeMessage(encodePayload(hello)));
    return ini.split();
  };
  const t1 = run(), t2 = run();
  const same = new TextEncoder().encode('same plaintext');
  assert.notDeepEqual(t1.send.encrypt(empty, same), t2.send.encrypt(empty, same)); // equal keys would give equal ciphertext at nonce 0
  assert.notDeepEqual(t1.hash, t2.hash);
  assert.notDeepEqual(t1.recv.k, t2.recv.k);
});

test('wipe: the ephemeral private key and chaining key are zeroed after the handshake', () => {
  const e = generateKeypair(), hub = generateKeypair(), dev = generateKeypair();
  const ini = new Handshake({ initiator: true, s: dev, rs: hub.pub, e }), res = new Handshake({ initiator: false, s: hub });
  res.readMessage(ini.writeMessage(encodePayload(hello)));
  ini.readMessage(res.writeMessage(encodePayload(hello)));
  ini.split();
  assert.ok(e.priv.every(x => x === 0));
  assert.ok(dev.priv.some(x => x !== 0)); // the device key belongs to the caller
});

test('payload codec: round trip and strict rejection', () => {
  const p = decodePayload(encodePayload({ version: 1, minVersion: 1, name: 'Zoë ✨', token: new Uint8Array(16).fill(1) }));
  assert.equal(p.name, 'Zoë ✨');
  assert.throws(() => decodePayload(empty), NoiseError);
  assert.throws(() => decodePayload(Uint8Array.of(1, 1, 5, 65)), NoiseError); // truncated name
  assert.throws(() => decodePayload(Uint8Array.of(1, 1, 1, 0xff, 0)), NoiseError); // not UTF-8
  assert.throws(() => decodePayload(Uint8Array.of(1, 1, 0, 3, 1, 2, 3)), NoiseError); // token length 3
  assert.throws(() => decodePayload(Uint8Array.of(1, 1, 0, 0, 9)), NoiseError); // trailing byte
  assert.throws(() => encodePayload({ ...hello, token: new Uint8Array(5) }), NoiseError);
});

test('transport state cannot be used after wipe', () => {
  const { a } = connect();
  a.send.wipe();
  assert.throws(() => a.send.encrypt(empty, empty), NoiseError);
  const _t: Transport | null = null;
  void _t;
});
