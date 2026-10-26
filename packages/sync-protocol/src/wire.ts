// Transport frames (docs/architecture/sync-architecture.md section 4), lib0 number and string encoding.

export const MAX_FRAME = 1024 * 1024;
export const CHUNK = 64 * 1024;
export const MAX_DOC_BYTES = 32 * 1024 * 1024;
export const MAX_DOCS_IN_FLIGHT = 8;
export const MAX_BUFFERED = 64 * 1024 * 1024;
export const MAX_ASSEMBLIES = 16;
export const MAX_LINK_ENTRIES = 10_000;
const MAX_TEXT = 1000;

export const T = {
  PROFILES: 0x02, SUBSCRIBE: 0x03, LINK: 0x04, LINK_PLAN: 0x05, LINK_CONFIRM: 0x06,
  SV: 0x10, UPDATE: 0x11, DOC_DONE: 0x12, READY: 0x13,
  BLOB_HAVE: 0x14, BLOB_REQ: 0x15, BLOB: 0x16, BLOB_ACK: 0x17,
  PING: 0x20, PONG: 0x21, ERROR: 0x30, BYE: 0x31,
} as const;

// 400 malformed, 403 not linked, 409 version, 413 too large, 423 locked, 429 rate limit, 503 shutting down.
export class ProtocolError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
const bad = (message: string): never => {
  throw new ProtocolError(400, message);
};

export interface ProfileEntry { syncId: string; name: string; notes: number; protected: boolean; locked: boolean }
export interface LinkEntry { uuid: string; hash: Uint8Array }
export interface PairEntry { clientUuid: string; hubUuid: string }

export type Frame =
  | { type: 0x02; profiles: ProfileEntry[] }
  | { type: 0x03; syncId: string }
  | { type: 0x04; syncId: string; name: string; more: boolean; entries: LinkEntry[] }
  | { type: 0x05; syncId: string; hubNotes: number; clientNotes: number; more: boolean; pairs: PairEntry[] }
  | { type: 0x06; syncId: string; accept: boolean }
  | { type: 0x10; doc: string; stateVector: Uint8Array }
  | { type: 0x11; doc: string; id: number; index: number; count: number; bytes: Uint8Array }
  | { type: 0x12; doc: string }
  | { type: 0x13 }
  | { type: 0x14; hashes: string[] }
  | { type: 0x15; hash: string }
  | { type: 0x16; hash: string; index: number; count: number; bytes: Uint8Array }
  | { type: 0x17; hash: string }
  | { type: 0x20; nonce: number }
  | { type: 0x21; nonce: number }
  | { type: 0x30; code: number; message: string }
  | { type: 0x31; reason: string };

const HASH_HEX = /^[0-9a-f]{64}$/;
export const hashToBytes = (hash: string): Uint8Array => {
  if (!HASH_HEX.test(hash)) return bad('bad hash');
  return Uint8Array.from({ length: 32 }, (_, i) => parseInt(hash.slice(i * 2, i * 2 + 2), 16));
};
export const bytesToHash = (b: Uint8Array): string =>
  Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

class Writer {
  parts: number[] = [];
  chunks: Uint8Array[] = [];
  u8(n: number) { this.parts.push(n & 255); }
  uint(n: number) {
    while (n > 127) { this.parts.push(128 | (n & 127)); n = Math.floor(n / 128); }
    this.parts.push(n);
  }
  raw(b: Uint8Array) { this.flush(); this.chunks.push(b); }
  bytes(b: Uint8Array) { this.uint(b.length); this.raw(b); }
  str(s: string) { this.bytes(new TextEncoder().encode(s)); }
  private flush() { if (this.parts.length) { this.chunks.push(Uint8Array.from(this.parts)); this.parts = []; } }
  done() {
    this.flush();
    const out = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const uuidToBytes = (uuid: string): Uint8Array => {
  if (!HEX.test(uuid)) return bad('bad uuid');
  const hex = uuid.replaceAll('-', '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};
export const bytesToUuid = (b: Uint8Array): string => {
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const writeDoc = (w: Writer, doc: string) => {
  if (doc === 'catalog') w.u8(0);
  else { w.u8(1); w.raw(uuidToBytes(doc)); }
};

export const encodeFrame = (f: Frame): Uint8Array => {
  const w = new Writer();
  w.u8(f.type);
  switch (f.type) {
    case T.PROFILES:
      w.uint(f.profiles.length);
      for (const p of f.profiles) { w.str(p.syncId); w.str(p.name); w.uint(p.notes); w.u8(p.protected ? 1 : 0); w.u8(p.locked ? 1 : 0); }
      break;
    case T.SUBSCRIBE: w.str(f.syncId); break;
    case T.LINK:
      w.str(f.syncId); w.str(f.name); w.u8(f.more ? 1 : 0); w.uint(f.entries.length);
      for (const e of f.entries) { w.raw(uuidToBytes(e.uuid)); w.raw(e.hash); }
      break;
    case T.LINK_PLAN:
      w.str(f.syncId); w.uint(f.hubNotes); w.uint(f.clientNotes); w.u8(f.more ? 1 : 0); w.uint(f.pairs.length);
      for (const p of f.pairs) { w.raw(uuidToBytes(p.clientUuid)); w.raw(uuidToBytes(p.hubUuid)); }
      break;
    case T.LINK_CONFIRM: w.str(f.syncId); w.u8(f.accept ? 1 : 0); break;
    case T.SV: writeDoc(w, f.doc); w.bytes(f.stateVector); break;
    case T.UPDATE: writeDoc(w, f.doc); w.uint(f.id); w.uint(f.index); w.uint(f.count); w.bytes(f.bytes); break;
    case T.DOC_DONE: writeDoc(w, f.doc); break;
    case T.READY: break;
    case T.BLOB_HAVE:
      w.uint(f.hashes.length);
      for (const h of f.hashes) w.raw(hashToBytes(h));
      break;
    case T.BLOB_REQ: w.raw(hashToBytes(f.hash)); break;
    case T.BLOB: w.raw(hashToBytes(f.hash)); w.uint(f.index); w.uint(f.count); w.bytes(f.bytes); break;
    case T.BLOB_ACK: w.raw(hashToBytes(f.hash)); break;
    case T.PING: case T.PONG: w.uint(f.nonce); break;
    case T.ERROR: w.uint(f.code); w.str(f.message.slice(0, 200)); break;
    case T.BYE: w.str(f.reason.slice(0, 200)); break;
  }
  const out = w.done();
  if (out.length > MAX_FRAME) throw new Error('frame too large to send');
  return out;
};

class Reader {
  at = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  left() { return this.data.length - this.at; }
  u8() { return this.at < this.data.length ? this.data[this.at++] : bad('short frame'); }
  bool() { const v = this.u8(); return v > 1 ? bad('bad flag') : v === 1; }
  uint() {
    let n = 0, mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      n += (b & 127) * mul;
      if (b < 128) return n;
      mul *= 128;
    }
    return bad('number too long');
  }
  raw(len: number) {
    if (len > this.left()) bad('short frame');
    const out = this.data.subarray(this.at, this.at + len);
    this.at += len;
    return out;
  }
  bytes(max: number) { const len = this.uint(); return len > max ? bad('too long') : this.raw(len); }
  str() {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(MAX_TEXT)); } catch (e) { return e instanceof ProtocolError ? bad(e.message) : bad('bad text'); }
  }
  // Believed only if the bytes for that many entries are there.
  count(entrySize: number, max: number) { const n = this.uint(); return n > max || n * entrySize > this.left() ? bad('bad count') : n; }
  doc() {
    const tag = this.u8();
    return tag === 0 ? 'catalog' : tag === 1 ? bytesToUuid(this.raw(16)) : bad('bad doc');
  }
}

export const decodeFrame = (data: Uint8Array): Frame => {
  if (data.length === 0 || data.length > MAX_FRAME) bad('bad frame size');
  const r = new Reader(data);
  const type = r.u8();
  let f: Frame;
  switch (type) {
    case T.PROFILES: {
      const n = r.count(5, 1000);
      const profiles: ProfileEntry[] = [];
      for (let i = 0; i < n; i++) profiles.push({ syncId: r.str(), name: r.str(), notes: r.uint(), protected: r.bool(), locked: r.bool() });
      f = { type, profiles };
      break;
    }
    case T.SUBSCRIBE: f = { type, syncId: r.str() }; break;
    case T.LINK: {
      const syncId = r.str(), name = r.str(), more = r.bool();
      const n = r.count(48, MAX_LINK_ENTRIES);
      const entries: LinkEntry[] = [];
      for (let i = 0; i < n; i++) entries.push({ uuid: bytesToUuid(r.raw(16)), hash: r.raw(32) });
      f = { type, syncId, name, more, entries };
      break;
    }
    case T.LINK_PLAN: {
      const syncId = r.str(), hubNotes = r.uint(), clientNotes = r.uint(), more = r.bool();
      const n = r.count(32, MAX_LINK_ENTRIES);
      const pairs: PairEntry[] = [];
      for (let i = 0; i < n; i++) pairs.push({ clientUuid: bytesToUuid(r.raw(16)), hubUuid: bytesToUuid(r.raw(16)) });
      f = { type, syncId, hubNotes, clientNotes, more, pairs };
      break;
    }
    case T.LINK_CONFIRM: f = { type, syncId: r.str(), accept: r.bool() }; break;
    case T.SV: f = { type, doc: r.doc(), stateVector: r.bytes(MAX_FRAME) }; break;
    case T.UPDATE: {
      const doc = r.doc(), id = r.uint(), index = r.uint(), count = r.uint();
      if (count < 1 || count > MAX_DOC_BYTES / CHUNK || index >= count) bad('bad chunk numbers');
      f = { type, doc, id, index, count, bytes: r.bytes(CHUNK) };
      break;
    }
    case T.DOC_DONE: f = { type, doc: r.doc() }; break;
    case T.READY: f = { type }; break;
    case T.BLOB_HAVE: {
      const n = r.count(32, MAX_LINK_ENTRIES);
      const hashes: string[] = [];
      for (let i = 0; i < n; i++) hashes.push(bytesToHash(r.raw(32)));
      f = { type, hashes };
      break;
    }
    case T.BLOB_REQ: f = { type, hash: bytesToHash(r.raw(32)) }; break;
    case T.BLOB: {
      const hash = bytesToHash(r.raw(32)), index = r.uint(), count = r.uint();
      if (count < 1 || count > MAX_DOC_BYTES / CHUNK || index >= count) bad('bad chunk numbers');
      f = { type, hash, index, count, bytes: r.bytes(CHUNK) };
      break;
    }
    case T.BLOB_ACK: f = { type, hash: bytesToHash(r.raw(32)) }; break;
    case T.PING: case T.PONG: f = { type, nonce: r.uint() }; break;
    case T.ERROR: f = { type, code: r.uint(), message: r.str() }; break;
    case T.BYE: f = { type, reason: r.str() }; break;
    default: return bad('unknown frame type');
  }
  if (r.left() !== 0) bad('trailing bytes');
  return f;
};

// An update as UPDATE frames of at most CHUNK bytes.
export const chunkUpdate = (doc: string, id: number, bytes: Uint8Array): Frame[] => {
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK));
  return Array.from({ length: count }, (_, index) => ({ type: T.UPDATE, doc, id, index, count, bytes: bytes.subarray(index * CHUNK, (index + 1) * CHUNK) }));
};

// A blob as BLOB frames of at most CHUNK bytes.
export const chunkBlob = (hash: string, bytes: Uint8Array): Frame[] => {
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK));
  return Array.from({ length: count }, (_, index) => ({ type: T.BLOB, hash, index, count, bytes: bytes.subarray(index * CHUNK, (index + 1) * CHUNK) }));
};

interface Assembly { count: number; parts: Map<number, Uint8Array>; bytes: number }

// Puts chunks back together; refuses over-limit documents/blobs (413) and buffering (429).
export class Reassembler {
  private open = new Map<string, Assembly>();
  private finished = new Set<string>(); // a late repeat must not start a new assembly
  buffered = 0;

  add(f: Extract<Frame, { type: 0x11 | 0x16 }>): Uint8Array | null {
    const key = f.type === T.UPDATE ? `${f.doc}/${f.id}` : `blob/${f.hash}`;
    if (this.finished.has(key)) return null;
    let a = this.open.get(key);
    if (!a) {
      if (this.open.size >= MAX_ASSEMBLIES) throw new ProtocolError(429, 'too many updates in flight');
      a = { count: f.count, parts: new Map(), bytes: 0 };
      this.open.set(key, a);
    }
    if (a.count !== f.count) bad('chunk count changed');
    if (!a.parts.has(f.index)) {
      if (a.bytes + f.bytes.length > MAX_DOC_BYTES) throw new ProtocolError(413, 'update too large');
      if (this.buffered + f.bytes.length > MAX_BUFFERED) throw new ProtocolError(429, 'too much buffered');
      a.parts.set(f.index, f.bytes.slice());
      a.bytes += f.bytes.length;
      this.buffered += f.bytes.length;
    }
    if (a.parts.size < a.count) return null;
    const out = new Uint8Array(a.bytes);
    let at = 0;
    for (let i = 0; i < a.count; i++) { out.set(a.parts.get(i)!, at); at += a.parts.get(i)!.length; }
    this.buffered -= a.bytes;
    this.open.delete(key);
    this.finished.add(key);
    if (this.finished.size > 512) this.finished.delete(this.finished.values().next().value!);
    return out;
  }
}
