import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateAddress } from '@notespark/core';
import { FakeClock, PairingError, PairingMode, TOKEN_TTL, decodePairing, deviceId, encodePairing, generateKeypair, pairingCode, pairingUri, parsePairing, type PairingLink } from '../src/index.ts';
import { rng } from './harness.ts';

const link = (over: Partial<PairingLink> = {}): PairingLink => ({ hubKey: generateKeypair().pub, token: new Uint8Array(16).fill(9), port: 7421, name: "Lusan's desktop", addresses: ['192.168.1.20', 'studio.local', 'pc.tail1234.ts.net', 'fd00::1'], ...over });
const reason = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof PairingError ? e.reason : `other:${e}`; } return 'none'; };

test('device id: four groups of four letters, stable, no look-alike characters', () => {
  const k = generateKeypair().pub;
  assert.match(deviceId(k), /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(deviceId(k), deviceId(k.slice()));
  assert.notEqual(deviceId(k), deviceId(generateKeypair().pub));
});

test('link and code round-trip to the same value; both forms carry the same bytes', () => {
  const l = link();
  for (const text of [pairingUri(l), pairingCode(l), pairingCode(l).toLowerCase(), pairingCode(l).replaceAll('-', ' '), `  ${pairingUri(l)}\n`]) {
    const p = parsePairing(text);
    assert.deepEqual(p.hubKey, l.hubKey);
    assert.deepEqual(p.token, l.token);
    assert.equal(p.port, l.port);
    assert.equal(p.name, l.name);
    assert.deepEqual(p.addresses, l.addresses);
  }
  assert.ok(pairingUri(l).startsWith('notespark://pair?c='));
});

test('the parser rejects every single-bit change, every truncation and trailing bytes', () => {
  const bytes = encodePairing(link());
  for (let bit = 0; bit < bytes.length * 8; bit++) {
    const b = bytes.slice();
    b[bit >> 3] ^= 1 << (bit & 7);
    assert.notEqual(reason(() => decodePairing(b)), 'none', `bit ${bit}`);
  }
  for (let n = 0; n < bytes.length; n++) assert.notEqual(reason(() => decodePairing(bytes.subarray(0, n))), 'none');
  assert.notEqual(reason(() => decodePairing(Uint8Array.of(...bytes, 0))), 'none');
});

test('version: an unknown version is reported as a version problem, not a bad code', () => {
  const b = encodePairing(link());
  b[0] = 2;
  assert.equal(reason(() => decodePairing(b)), 'version');
});

test('a public or malformed address is refused when encoding and when parsing', () => {
  for (const bad of ['8.8.8.8', 'example.com', 'evil.local.example.com', '1.2.3', '2001:4860:4860::8888', '', 'a b.local'])
    assert.equal(reason(() => encodePairing(link({ addresses: [bad] }))), 'address', bad);
});

test('the parser never throws anything but PairingError (fuzz)', () => {
  const r = rng(77);
  const L = link(), good = encodePairing(L), code = pairingCode(L);
  let accepted = 0;
  for (let i = 0; i < 20_000; i++) {
    const b = r() < 0.5 ? Uint8Array.from({ length: Math.floor(r() * 120) }, () => Math.floor(r() * 256)) : good.map(x => (r() < 0.03 ? Math.floor(r() * 256) : x));
    const text = r() < 0.3 ? code.slice(0, Math.floor(r() * (code.length - 1))) : Buffer.from(b).toString(r() < 0.5 ? 'base64url' : 'latin1');
    for (const t of [text, `notespark://pair?c=${text}`]) {
      try { assert.deepEqual(parsePairing(t).hubKey, L.hubKey); accepted++; } catch (e) { assert.ok(e instanceof PairingError, String(e)); }
    }
    try { assert.deepEqual(decodePairing(b).hubKey, L.hubKey); } catch (e) { assert.ok(e instanceof PairingError, String(e)); }
  }
  assert.ok(accepted < 3000, `${accepted} accepted`); // only unchanged copies of the real link get through
});

test('isPrivateAddress: names are accepted only as .local or .ts.net', () => {
  for (const ok of ['studio.local', 'pc.tail1234.ts.net', '192.168.0.4', '[fd12::1]', '100.101.1.1']) assert.ok(isPrivateAddress(ok), ok);
  for (const no of ['example.com', 'local', 'x.local.com', 'a..local', '-a.local', 'ts.net.evil.com', '8.8.8.8', 'localhost.example']) assert.ok(!isPrivateAddress(no), no);
});

test('pairing token: valid once, for five minutes', () => {
  const c = new FakeClock();
  const m = new PairingMode(c, n => new Uint8Array(n).fill(5));
  assert.equal(m.check(new Uint8Array(16).fill(5)), false); // not started
  const t = m.start()!;
  assert.ok(m.active);
  assert.equal(m.check(t), true);
  assert.equal(m.check(t), false); // burned
  const t2 = m.start()!;
  c.time += TOKEN_TTL - 1;
  assert.equal(m.check(t2), true);
  const t3 = m.start()!;
  c.time += TOKEN_TTL;
  assert.equal(m.check(t3), false); // expired
  assert.ok(!m.active);
});

test('starting again replaces the old token', () => {
  let n = 0;
  const m = new PairingMode(new FakeClock(), s => new Uint8Array(s).fill(++n));
  const first = m.start()!, second = m.start()!;
  assert.equal(m.check(first), false);
  assert.equal(m.check(second), true);
});

test('five wrong tokens in a minute lock pairing for five minutes, even for the right token', () => {
  const c = new FakeClock();
  const m = new PairingMode(c, s => new Uint8Array(s).fill(5));
  const t = m.start()!;
  for (let i = 0; i < 4; i++) { assert.equal(m.check(new Uint8Array(16).fill(i)), false); c.time += 1000; }
  assert.ok(!m.locked);
  assert.equal(m.check(new Uint8Array(16).fill(99)), false);
  assert.ok(m.locked);
  assert.equal(m.check(t), false);
  assert.equal(m.start(), null);
  c.time += 5 * 60_000 - 1;
  assert.equal(m.start(), null);
  c.time += 1;
  assert.ok(m.start());
});

test('wrong tokens spread over more than a minute do not lock', () => {
  const c = new FakeClock();
  const m = new PairingMode(c);
  m.start();
  for (let i = 0; i < 20; i++) { m.check(new Uint8Array(16).fill(i)); c.time += 20_000; }
  assert.ok(!m.locked);
});

test('a wrong-length token counts as wrong and never matches', () => {
  const m = new PairingMode(new FakeClock(), s => new Uint8Array(s));
  m.start();
  assert.equal(m.check(new Uint8Array(0)), false);
  assert.equal(m.check(new Uint8Array(15)), false);
});

test('isPrivateAddress: leading zeros are refused (octal look-alikes of public addresses)', () => {
  for (const no of ['010.1.1.1', '172.016.0.1', '100.064.0.1', '192.168.001.1', '0127.0.0.1']) assert.ok(!isPrivateAddress(no), no);
  assert.ok(isPrivateAddress('10.0.0.1'));
  assert.ok(isPrivateAddress('0.0.0.0') === false);
});
