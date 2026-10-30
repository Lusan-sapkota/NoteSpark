// Noise over any message socket, as a Channel: the engine never sees a byte before the handshake has succeeded.
// One socket message = one Noise message (at most 65,535 bytes). A frame that does not fit is split into
// fragments, each prefixed by one byte (1 = more follows, 0 = last); reassembly is capped at MAX_FRAME.
import type { Channel } from './channel.ts';
import {
  Handshake, type HelloPayload, MAX_NOISE_MESSAGE, MIN_VERSION, NoiseError, PROTOCOL_VERSION, TAG, type Keypair, type Transport,
  decodePayload, encodePayload,
} from './noise.ts';
import { MAX_FRAME, T, encodeFrame } from './wire.ts';

// React Native adds an Origin header to every WebSocket and cannot remove it, so the phone sends this fixed value. A web page cannot.
export const APP_ORIGIN = 'notespark://app';
export const MAX_FIRST_MESSAGE = 1024; // the hub reads no more than this before the handshake succeeds
const FRAGMENT = MAX_NOISE_MESSAGE - TAG - 1;
const NONE = new Uint8Array(0);

// Whole messages, no meaning yet. `close(true)` lets queued messages go first.
export interface RawSocket {
  send(data: Uint8Array): void;
  close(graceful?: boolean): void;
  onMessage: (data: Uint8Array) => void;
  onClose: () => void;
}

export interface PeerInfo { name: string; version: number; minVersion: number; staticKey: Uint8Array; hash: Uint8Array }

export const compatible = (a: { version: number; minVersion: number }) => a.version >= MIN_VERSION && a.minVersion <= PROTOCOL_VERSION;

export class SecureChannel implements Channel {
  onMessage: (data: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  peer: PeerInfo | null = null;
  ready = false;
  closed = false;
  private confirmed = false; // hub: the device has proved it is alive (message 1 alone can be replayed)
  private hs: Handshake | null;
  private t: Transport | null = null;
  private raw: RawSocket;
  private early: Uint8Array[] = []; // frames sent before the handshake finished
  private parts: Uint8Array[] = [];
  private partBytes = 0;
  private hello: HelloPayload;
  private authorize: ((key: Uint8Array, hello: HelloPayload) => boolean) | null;
  private onReady: ((c: SecureChannel) => void) | null;

  private constructor(raw: RawSocket, hs: Handshake, hello: HelloPayload, authorize: SecureChannel['authorize'], onReady: SecureChannel['onReady']) {
    this.raw = raw;
    this.hs = hs;
    this.hello = hello;
    this.authorize = authorize;
    this.onReady = onReady;
    raw.onMessage = d => this.receive(d);
    raw.onClose = () => this.shut(false);
  }

  // Initiator: knows the hub's key, speaks first.
  static client(raw: RawSocket, o: { s: Keypair; hubKey: Uint8Array; name: string; token?: Uint8Array }) {
    const hs = new Handshake({ initiator: true, s: o.s, rs: o.hubKey });
    const hello = { version: PROTOCOL_VERSION, minVersion: MIN_VERSION, name: o.name };
    const c = new SecureChannel(raw, hs, hello, null, null);
    try { raw.send(hs.writeMessage(encodePayload({ ...hello, token: o.token }))); } catch { c.shut(true); }
    return c;
  }

  // Responder: waits for message 1. `authorize` false (unknown device) closes with no reply of any kind.
  static hub(raw: RawSocket, o: { s: Keypair; name: string; authorize: (key: Uint8Array, hello: HelloPayload) => boolean; onReady: (c: SecureChannel) => void }) {
    const hs = new Handshake({ initiator: false, s: o.s });
    return new SecureChannel(raw, hs, { version: PROTOCOL_VERSION, minVersion: MIN_VERSION, name: o.name }, o.authorize, o.onReady);
  }

  send(frame: Uint8Array) {
    if (this.closed) return;
    if (!this.ready) { this.early.push(frame); return; }
    try {
      for (let at = 0; at < frame.length || at === 0; at += FRAGMENT) {
        const piece = frame.subarray(at, at + FRAGMENT);
        const msg = new Uint8Array(piece.length + 1);
        msg[0] = at + FRAGMENT < frame.length ? 1 : 0;
        msg.set(piece, 1);
        this.raw.send(this.t!.send.encrypt(NONE, msg));
      }
    } catch { this.shut(true); }
  }

  close() { this.shut(true, true); }

  private shut(drop: boolean, graceful = false) {
    if (this.closed) return;
    this.closed = true;
    this.hs?.wipe();
    this.t?.send.wipe();
    this.t?.recv.wipe();
    this.early = [];
    this.parts = [];
    try { this.raw.close(graceful && !drop); } finally { try { this.onClose(); } catch { /* the owner's handler must not break the socket callback */ } }
  }

  private receive(data: Uint8Array) {
    if (this.closed) return;
    if (!this.ready) return this.handshake(data);
    try {
      if (data.length > MAX_NOISE_MESSAGE) throw new NoiseError('message too long');
      const plain = this.t!.recv.decrypt(NONE, data);
      if (plain.length < 1 || plain[0] > 2) throw new NoiseError('bad fragment');
      if (plain[0] === 2) { // the device's first message: "I hold the keys". Hub only; nothing is delivered.
        if (this.confirmed || !this.authorize || plain.length !== 1) throw new NoiseError('unexpected confirm');
        this.confirmed = true;
        const cb = this.onReady!;
        this.onReady = null;
        return cb(this);
      }
      if (this.authorize && !this.confirmed) throw new NoiseError('not confirmed');
      if (plain[0] === 1 && plain.length - 1 !== FRAGMENT) throw new NoiseError('short fragment'); // no endless empty fragments
      this.partBytes += plain.length - 1;
      if (this.partBytes > MAX_FRAME) throw new NoiseError('frame too large');
      this.parts.push(plain.subarray(1));
      if (plain[0] === 1) return;
      const frame = this.parts.length === 1 ? this.parts[0] : concat(this.parts, this.partBytes);
      this.parts = [];
      this.partBytes = 0;
      this.onMessage(frame);
    } catch { this.shut(true); }
  }

  private handshake(data: Uint8Array) {
    const hs = this.hs!;
    try {
      if (this.authorize) {
        // Hub. Same work whether or not the device is known, so a scanner cannot time the difference.
        if (data.length > MAX_FIRST_MESSAGE) throw new NoiseError('first message too long');
        const theirs = decodePayload(hs.readMessage(data));
        const known = this.authorize(hs.remoteStatic!, theirs);
        const reply = hs.writeMessage(encodePayload(this.hello));
        if (!known) return this.shut(true); // no reply, no error frame
        this.raw.send(reply);
        this.finish(theirs);
        if (!compatible(theirs)) { this.send(encodeFrame({ type: T.ERROR, code: 409, message: 'update NoteSpark' })); this.shut(false, true); return; }
        // The engine only gets the channel once the device's confirm message arrives (see receive).
      } else {
        const theirs = decodePayload(hs.readMessage(data));
        this.finish(theirs);
        if (!compatible(theirs)) { this.onMessage(encodeFrame({ type: T.ERROR, code: 409, message: 'update NoteSpark' })); this.shut(true); return; }
        this.raw.send(this.t!.send.encrypt(NONE, Uint8Array.of(2))); // confirm: proves this side holds its keys
        this.flush();
      }
    } catch { this.shut(true); }
  }

  private finish(theirs: HelloPayload) {
    const t = this.hs!.split();
    this.t = t;
    this.hs = null;
    this.peer = { name: theirs.name, version: theirs.version, minVersion: theirs.minVersion, staticKey: t.remoteStatic, hash: t.hash };
    this.ready = true;
  }
  private flush() {
    const early = this.early;
    this.early = [];
    for (const f of early) this.send(f);
  }
}

const concat = (parts: Uint8Array[], n: number) => {
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
