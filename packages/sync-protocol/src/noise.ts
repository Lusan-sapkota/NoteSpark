// Noise_IK_25519_ChaChaPoly_BLAKE2s (Noise revision 34) on @noble/*. Spec: noiseprotocol.org.
// Layers as in the spec: CipherState (key + counter nonce), SymmetricState (ck, h), Handshake (the IK pattern).
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { concatBytes, randomBytes } from '@noble/hashes/utils.js';

export const PROTOCOL_NAME = 'Noise_IK_25519_ChaChaPoly_BLAKE2s';
export const PROLOGUE = new TextEncoder().encode('NoteSpark sync v1');
export const MAX_NOISE_MESSAGE = 65535;
export const TAG = 16;
const DH_LEN = 32;
const MAX_NONCE = 2n ** 64n - 1n; // reserved for rekey, never used to encrypt

export class NoiseError extends Error {}

export interface Keypair { priv: Uint8Array; pub: Uint8Array }
export const generateKeypair = (): Keypair => {
  const priv = randomBytes(32);
  return { priv, pub: x25519.getPublicKey(priv) };
};
export const keypairFromPrivate = (priv: Uint8Array): Keypair => ({ priv, pub: x25519.getPublicKey(priv) });

const dh = (priv: Uint8Array, pub: Uint8Array) => {
  let out: Uint8Array;
  try { out = x25519.getSharedSecret(priv, pub); } catch { throw new NoiseError('bad key'); }
  if (out.every(b => b === 0)) throw new NoiseError('bad key'); // low-order point
  return out;
};

const nonceBytes = (n: bigint) => {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigUint64(4, n, true);
  return out;
};

// A key and a counter. After one failed decrypt it never works again: the caller closes the connection.
export class CipherState {
  k: Uint8Array | null;
  n = 0n;
  private broken = false;
  constructor(k: Uint8Array | null = null) { this.k = k; }
  hasKey() { return this.k !== null; }
  encrypt(ad: Uint8Array, plaintext: Uint8Array) {
    if (this.broken) throw new NoiseError('closed');
    if (!this.k) return plaintext; // only before the first mixKey, inside the handshake
    if (this.n >= MAX_NONCE) throw new NoiseError('nonce exhausted');
    const out = chacha20poly1305(this.k, nonceBytes(this.n), ad).encrypt(plaintext);
    this.n++;
    return out;
  }
  decrypt(ad: Uint8Array, ciphertext: Uint8Array) {
    if (this.broken) throw new NoiseError('closed');
    if (!this.k) return ciphertext;
    if (this.n >= MAX_NONCE) throw new NoiseError('nonce exhausted');
    try {
      const out = chacha20poly1305(this.k, nonceBytes(this.n), ad).decrypt(ciphertext);
      this.n++;
      return out;
    } catch {
      this.broken = true;
      throw new NoiseError('decrypt failed');
    }
  }
  // Spec REKEY: k = first 32 bytes of ENCRYPT(k, 2^64-1, empty, zeros). Not called in v1 (see docs), but proven by a test.
  rekey() {
    if (!this.k) throw new NoiseError('no key');
    const out = chacha20poly1305(this.k, nonceBytes(MAX_NONCE), new Uint8Array(0)).encrypt(new Uint8Array(32));
    this.k.fill(0);
    this.k = out.slice(0, 32);
  }
  // JavaScript cannot promise no other copy exists (GC moves, noble internals); this zeroes the one we hold.
  wipe() { this.k?.fill(0); this.k = null; this.broken = true; }
}

const hash = (d: Uint8Array) => blake2s(d);
const hmacHash = (key: Uint8Array, data: Uint8Array) => hmac(blake2s, key, data);
// Noise HKDF, two outputs.
const hkdf2 = (ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] => {
  const temp = hmacHash(ck, ikm);
  const o1 = hmacHash(temp, Uint8Array.of(1));
  const o2 = hmacHash(temp, concatBytes(o1, Uint8Array.of(2)));
  temp.fill(0);
  return [o1, o2];
};

class SymmetricState {
  ck: Uint8Array;
  h: Uint8Array;
  cs = new CipherState();
  constructor(name: Uint8Array) {
    const bytes = name.length <= 32 ? concatBytes(name, new Uint8Array(32 - name.length)) : hash(name);
    this.h = bytes;
    this.ck = bytes.slice();
  }
  mixHash(d: Uint8Array) { this.h = hash(concatBytes(this.h, d)); }
  mixKey(ikm: Uint8Array) {
    const [ck, k] = hkdf2(this.ck, ikm);
    this.ck.fill(0);
    this.ck = ck;
    this.cs.k?.fill(0);
    this.cs = new CipherState(k);
  }
  encryptAndHash(p: Uint8Array) {
    const c = this.cs.encrypt(this.h, p);
    this.mixHash(c);
    return c;
  }
  decryptAndHash(c: Uint8Array) {
    const p = this.cs.decrypt(this.h, c);
    this.mixHash(c);
    return p;
  }
  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf2(this.ck, new Uint8Array(0));
    return [new CipherState(k1), new CipherState(k2)];
  }
  wipe() { this.ck.fill(0); this.cs.wipe(); }
}

export interface Transport {
  send: CipherState;
  recv: CipherState;
  hash: Uint8Array; // the handshake hash, a public transcript fingerprint
  remoteStatic: Uint8Array;
}

export interface HandshakeOptions {
  initiator: boolean;
  s: Keypair; // this device's static key
  rs?: Uint8Array; // initiator only: the hub's static public key
  prologue?: Uint8Array;
  e?: Keypair; // tests only: a fixed ephemeral key (the vectors need it)
}

// IK:  <- s   ...   -> e, es, s, ss   <- e, ee, se
export class Handshake {
  private ss: SymmetricState;
  private o: HandshakeOptions;
  private re: Uint8Array | null = null;
  private rs: Uint8Array | null;
  private e: Keypair | null = null;
  private step = 0;
  failed = false;
  constructor(o: HandshakeOptions) {
    this.o = o;
    this.rs = o.initiator ? (o.rs ?? null) : null;
    if (o.initiator && !this.rs) throw new NoiseError('initiator needs the hub key');
    this.ss = new SymmetricState(new TextEncoder().encode(PROTOCOL_NAME));
    this.ss.mixHash(o.prologue ?? PROLOGUE);
    this.ss.mixHash(o.initiator ? this.rs! : o.s.pub); // pre-message: <- s
  }
  get remoteStatic() { return this.rs; }
  get done() { return this.step === 2; }

  private eph() { return (this.e ??= this.o.e ?? generateKeypair()); }
  private guard<T>(fn: () => T): T {
    if (this.failed) throw new NoiseError('handshake failed');
    try { return fn(); } catch (e) { this.failed = true; this.wipe(); throw e instanceof NoiseError ? e : new NoiseError('bad message'); }
  }

  writeMessage(payload: Uint8Array): Uint8Array {
    return this.guard(() => {
      const ss = this.ss, init = this.o.initiator;
      if (this.step !== (init ? 0 : 1)) throw new NoiseError('out of order');
      const e = this.eph();
      ss.mixHash(e.pub);
      let out = e.pub;
      if (init) {
        ss.mixKey(dh(e.priv, this.rs!)); // es
        out = concatBytes(out, ss.encryptAndHash(this.o.s.pub)); // s
        ss.mixKey(dh(this.o.s.priv, this.rs!)); // ss
      } else {
        ss.mixKey(dh(e.priv, this.re!)); // ee
        ss.mixKey(dh(e.priv, this.rs!)); // se
      }
      out = concatBytes(out, ss.encryptAndHash(payload));
      if (out.length > MAX_NOISE_MESSAGE) throw new NoiseError('message too long');
      this.step++;
      return out;
    });
  }

  readMessage(msg: Uint8Array): Uint8Array {
    return this.guard(() => {
      const ss = this.ss, init = this.o.initiator;
      if (this.step !== (init ? 1 : 0)) throw new NoiseError('out of order');
      if (msg.length > MAX_NOISE_MESSAGE) throw new NoiseError('message too long');
      const min = init ? DH_LEN + TAG : DH_LEN + DH_LEN + TAG + TAG;
      if (msg.length < min) throw new NoiseError('message too short');
      this.re = msg.slice(0, DH_LEN);
      ss.mixHash(this.re);
      let at = DH_LEN;
      if (init) {
        const e = this.eph();
        ss.mixKey(dh(e.priv, this.re)); // ee
        ss.mixKey(dh(this.o.s.priv, this.re)); // se
      } else {
        ss.mixKey(dh(this.o.s.priv, this.re)); // es
        this.rs = ss.decryptAndHash(msg.subarray(at, at + DH_LEN + TAG)); // s
        at += DH_LEN + TAG;
        ss.mixKey(dh(this.o.s.priv, this.rs)); // ss
      }
      const payload = ss.decryptAndHash(msg.subarray(at));
      this.step++;
      return payload;
    });
  }

  split(): Transport {
    if (!this.done || this.failed) throw new NoiseError('handshake not finished');
    const [c1, c2] = this.ss.split();
    const t: Transport = {
      send: this.o.initiator ? c1 : c2, recv: this.o.initiator ? c2 : c1,
      hash: this.ss.h.slice(), remoteStatic: this.rs!.slice(),
    };
    this.wipe();
    return t;
  }

  // Zeroes the ephemeral private key and chaining state. The static key belongs to the caller.
  wipe() {
    this.e?.priv.fill(0);
    this.ss.wipe();
  }
}

// ---- handshake payloads (inside the Noise messages) ----

export const PROTOCOL_VERSION = 1;
export const MIN_VERSION = 1;
export const TOKEN_LEN = 16;
export const MAX_NAME_BYTES = 64;

export interface HelloPayload { version: number; minVersion: number; name: string; token?: Uint8Array }

// version, minVersion, name length + name, token length (0 or 16) + token. Message 2 has no token.
export const encodePayload = (p: HelloPayload): Uint8Array => {
  const name = new TextEncoder().encode(p.name).slice(0, MAX_NAME_BYTES);
  const token = p.token ?? new Uint8Array(0);
  if (token.length !== 0 && token.length !== TOKEN_LEN) throw new NoiseError('bad token');
  return concatBytes(Uint8Array.of(p.version, p.minVersion, name.length), name, Uint8Array.of(token.length), token);
};

export const decodePayload = (b: Uint8Array): HelloPayload => {
  if (b.length < 4) throw new NoiseError('bad payload');
  const [version, minVersion, n] = b;
  if (n > MAX_NAME_BYTES || b.length < 3 + n + 1) throw new NoiseError('bad payload');
  let name: string;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(3, 3 + n)); } catch { throw new NoiseError('bad payload'); }
  const t = b[3 + n];
  if ((t !== 0 && t !== TOKEN_LEN) || b.length !== 3 + n + 1 + t) throw new NoiseError('bad payload');
  return { version, minVersion, name, token: t ? b.slice(4 + n) : undefined };
};
