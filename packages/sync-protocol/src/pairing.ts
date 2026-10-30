// Pairing (docs/architecture/sync-pairing-and-protocol.md): device ids, the pairing link and code, the one-time token.
// Strings and rules only; drawing the QR and the screens belong to the apps.
import { isPrivateAddress } from '@notespark/core';
import { blake2s } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes } from '@noble/hashes/utils.js';
import type { Clock } from './clock.ts';
import { MAX_NAME_BYTES, TOKEN_LEN } from './noise.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export const PAIRING_VERSION = 1;
export const MAX_ADDRESSES = 8;
const CHECK = 4;

const b32 = (b: Uint8Array) => {
  let out = '', bits = 0, acc = 0;
  for (const x of b) {
    acc = (acc << 8) | x; bits += 8;
    while (bits >= 5) { out += ALPHABET[(acc >> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
};
const unb32 = (s: string): Uint8Array | null => {
  const out: number[] = [];
  let bits = 0, acc = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null; // padding bits must be zero: one string per value
  return Uint8Array.from(out);
};
const group = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'g'))!.join('-');

// The first 10 bytes of SHA-256 of the public key, as four groups of four letters: K7QP-2MXD-9RTA-W4HE.
export const deviceId = (publicKey: Uint8Array) => group(b32(sha256(publicKey).subarray(0, 10)), 4);

export interface PairingLink { hubKey: Uint8Array; token: Uint8Array; port: number; name: string; addresses: string[] }

export class PairingError extends Error {
  reason: 'format' | 'checksum' | 'version' | 'address';
  constructor(reason: PairingError['reason'], message: string) { super(message); this.reason = reason; }
}

const enc = new TextEncoder();
export const encodePairing = (l: PairingLink): Uint8Array => {
  const name = enc.encode(l.name);
  if (l.hubKey.length !== 32 || l.token.length !== TOKEN_LEN || name.length > MAX_NAME_BYTES || !Number.isInteger(l.port) || l.port < 1 || l.port > 65535
    || l.addresses.length < 1 || l.addresses.length > MAX_ADDRESSES) throw new PairingError('format', 'bad link');
  const addrs = l.addresses.map(a => {
    const b = enc.encode(a);
    if (b.length < 1 || b.length > 80 || !isPrivateAddress(a)) throw new PairingError('address', 'not a private address');
    return concatBytes(Uint8Array.of(b.length), b);
  });
  const body = concatBytes(Uint8Array.of(PAIRING_VERSION), l.hubKey, l.token, Uint8Array.of(l.port >> 8, l.port & 255), Uint8Array.of(name.length), name, Uint8Array.of(addrs.length), ...addrs);
  return concatBytes(body, blake2s(body).subarray(0, CHECK));
};

export const decodePairing = (b: Uint8Array): PairingLink => {
  if (b.length < 1 + 32 + TOKEN_LEN + 2 + 1 + 1 + CHECK) throw new PairingError('format', 'too short');
  if (b[0] !== PAIRING_VERSION) throw new PairingError('version', 'unsupported version');
  const body = b.subarray(0, b.length - CHECK), sum = b.subarray(b.length - CHECK), want = blake2s(body).subarray(0, CHECK);
  if (!sum.every((x, i) => x === want[i])) throw new PairingError('checksum', 'bad checksum');
  let at = 1;
  const take = (n: number) => { if (at + n > body.length) throw new PairingError('format', 'truncated'); return body.subarray(at, (at += n)); };
  const hubKey = take(32).slice(), token = take(TOKEN_LEN).slice();
  const [hi, lo] = take(2);
  const port = (hi << 8) | lo;
  const nameLen = take(1)[0];
  if (nameLen > MAX_NAME_BYTES || port < 1) throw new PairingError('format', 'bad field');
  let name: string;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(take(nameLen)); } catch { throw new PairingError('format', 'bad name'); }
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new PairingError('format', 'bad name');
  const count = take(1)[0];
  if (count < 1 || count > MAX_ADDRESSES) throw new PairingError('format', 'bad address count');
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = take(1)[0];
    let a: string;
    try { a = new TextDecoder('utf-8', { fatal: true }).decode(take(n)); } catch { throw new PairingError('format', 'bad address'); }
    if (n < 1 || n > 80 || !isPrivateAddress(a)) throw new PairingError('address', 'not a private address');
    addresses.push(a);
  }
  if (at !== body.length) throw new PairingError('format', 'trailing bytes');
  return { hubKey, token, port, name, addresses };
};

const URI = 'notespark://pair?c=';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const toB64u = (b: Uint8Array) => {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '') + (i + 2 < b.length ? B64[n & 63] : '');
  }
  return out;
};
const fromB64u = (s: string): Uint8Array => {
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of s) { acc = (acc << 6) | B64.indexOf(ch); bits += 6; if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; } }
  return Uint8Array.from(out);
};
// The QR text and the long pasteable code carry the same bytes.
export const pairingUri = (l: PairingLink) => URI + toB64u(encodePairing(l));
export const pairingCode = (l: PairingLink) => group(b32(encodePairing(l)), 5);

// Accepts the link or the code (spaces, dashes and case ignored). Anything else is a PairingError.
export const parsePairing = (text: string): PairingLink => {
  const t = text.trim();
  if (t.length > 4096) throw new PairingError('format', 'too long');
  if (t.toLowerCase().startsWith(URI)) {
    const raw = t.slice(URI.length);
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new PairingError('format', 'bad link');
    const bytes = fromB64u(raw);
    if (toB64u(bytes) !== raw) throw new PairingError('format', 'bad link'); // non-canonical encoding
    return decodePairing(bytes);
  }
  const bytes = unb32(t.toUpperCase().replace(/[\s-]/g, ''));
  if (!bytes) throw new PairingError('format', 'bad code');
  return decodePairing(bytes);
};

export const LOCK_AFTER = 5;
export const WRONG_WINDOW = 60_000;
export const LOCK_FOR = 5 * 60_000;
export const TOKEN_TTL = 5 * 60_000;

// The hub's pairing mode: one token at a time, five minutes, one use; five wrong tokens in a minute lock it for five minutes.
export class PairingMode {
  private token: Uint8Array | null = null;
  private expires = 0;
  private wrong: number[] = [];
  private lockedUntil = 0;
  private clock: Clock;
  private random: (n: number) => Uint8Array;
  constructor(clock: Clock, random: (n: number) => Uint8Array = randomBytes) { this.clock = clock; this.random = random; }

  get locked() { return this.clock.now() < this.lockedUntil; }
  get active() { return !!this.token && this.clock.now() < this.expires && !this.locked; }

  // null while locked. Starting again replaces the old token.
  start(): Uint8Array | null {
    if (this.locked) return null;
    this.token = this.random(TOKEN_LEN);
    this.expires = this.clock.now() + TOKEN_TTL;
    return this.token.slice();
  }
  cancel() { this.token?.fill(0); this.token = null; }

  // True once per token. Every presented token that fails counts, whether or not pairing is open.
  check(presented: Uint8Array): boolean {
    const now = this.clock.now();
    if (this.locked) return false;
    let ok = false;
    if (this.token && now < this.expires && presented.length === TOKEN_LEN) {
      let diff = 0;
      for (let i = 0; i < TOKEN_LEN; i++) diff |= presented[i] ^ this.token[i]; // constant time
      ok = diff === 0;
    }
    if (ok) { this.cancel(); return true; }
    this.wrong = this.wrong.filter(t => now - t < WRONG_WINDOW);
    this.wrong.push(now);
    if (this.wrong.length >= LOCK_AFTER) { this.lockedUntil = now + LOCK_FOR; this.wrong = []; this.cancel(); }
    return false;
  }
}
