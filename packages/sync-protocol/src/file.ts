// The sync file: what a profile holds, encrypted with a passphrase, to move by hand with no network.
// Layout: header (authenticated, never encrypted) then ChaCha20-Poly1305 chunks of 64 KB. The key comes from scrypt over the
// passphrase and a random salt, so every file has its own key and a chunk's nonce is just its number plus a "last chunk"
// flag (so a cut, extended or reordered file fails). Strict reader: every length is checked against a cap before anything
// is allocated, and any damage ends in a SyncFileError, never another exception.
//   header  = "NSYNCF" | version u8 | minReader u8 | kdf u8 (1 = scrypt) | logN u8 | r u8 | p u8 | salt 16 bytes
//   payload = syncId 16 bytes | name (len u8 + utf8) | createdAt u64 (ms) | count u32 | { kind u8 (0 catalog, 1 note) | uuid 16 (notes) | len u32 | update }...
//             | blobCount u32 | { sha256 32 bytes | len u32 | attachment bytes }...
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { concatBytes, randomBytes } from '@noble/hashes/utils.js';
import { MAX_DOC_BYTES, bytesToUuid, uuidToBytes } from './wire.ts';

export const FILE_VERSION = 1;
export const FILE_MIN_READER = 1;
const MAGIC = new TextEncoder().encode('NSYNCF');
const HEADER = MAGIC.length + 6 + 16;
const CHUNK = 64 * 1024;
const TAG = 16;
export const MAX_FILE_PLAIN = 96 * 1024 * 1024; // everything together (the phone holds the file in memory); more means leaving attachments out
export const MAX_FILE_BLOB = 32 * 1024 * 1024; // one attachment, the app-wide limit
export const MAX_FILE_BLOBS = 20_000;
export const MAX_FILE_DOCS = 200_000;
const MAX_NAME = 100;
export const SCRYPT = { logN: 15, r: 8, p: 1 }; // about 100 ms on a laptop; the reader refuses less than 2^14 and more than 2^16 (64 MB)
const MIN_LOG_N = 14, MAX_LOG_N = 16;

export type SyncFileProblem = 'format' | 'version' | 'passphrase' | 'tooBig';
export class SyncFileError extends Error {
  reason: SyncFileProblem;
  constructor(reason: SyncFileProblem, message: string) { super(message); this.reason = reason; }
}

export interface FileDoc { id: string; update: Uint8Array } // id: 'catalog' or a note uuid
export interface FileBlob { hash: string; bytes: Uint8Array } // hash: 64 lowercase hex characters, the SHA-256 of the bytes (checked by the importer)
export interface SyncFileContent { syncId: string; name: string; createdAt: number; docs: FileDoc[]; blobs: FileBlob[] }
export type SyncFileInput = Omit<SyncFileContent, 'blobs'> & { blobs?: FileBlob[] };

export interface EncodeOptions { random?: (n: number) => Uint8Array; logN?: number } // tests only: logN below the reader's minimum needs `minLogN` there
export interface DecodeOptions { minLogN?: number; yieldEvery?: () => Promise<void> }

const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const nonce = (index: number, last: boolean) => { const n = new Uint8Array(12); n[0] = last ? 1 : 0; n.set(u32(index), 8); return n; };

const key = (passphrase: string, salt: Uint8Array, logN: number, r: number, p: number) =>
  scryptAsync(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, { N: 2 ** logN, r, p, dkLen: 32, maxmem: 2 ** logN * r * 256 + 8 * 1024 * 1024 });

const hexToBytes = (h: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new SyncFileError('format', 'bad attachment name');
  return Uint8Array.from({ length: 32 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
};
const bytesToHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

const encodePayload = (c: SyncFileInput): Uint8Array => {
  const name = new TextEncoder().encode(c.name);
  if (name.length > MAX_NAME || c.docs.length > MAX_FILE_DOCS || !Number.isSafeInteger(c.createdAt) || c.createdAt < 0) throw new SyncFileError('format', 'bad content');
  const parts: Uint8Array[] = [uuidToBytes(c.syncId), Uint8Array.of(name.length), name, u32(Math.floor(c.createdAt / 2 ** 32)), u32(c.createdAt >>> 0), u32(c.docs.length)];
  let size = 0;
  for (const d of c.docs) {
    if (d.update.length > MAX_DOC_BYTES) throw new SyncFileError('tooBig', 'a note is too large');
    size += d.update.length;
    if (size > MAX_FILE_PLAIN) throw new SyncFileError('tooBig', 'too large');
    parts.push(d.id === 'catalog' ? Uint8Array.of(0) : concatBytes(Uint8Array.of(1), uuidToBytes(d.id)), u32(d.update.length), d.update);
  }
  const blobs = c.blobs ?? [];
  if (blobs.length > MAX_FILE_BLOBS) throw new SyncFileError('tooBig', 'too many attachments');
  parts.push(u32(blobs.length));
  for (const b of blobs) {
    if (b.bytes.length > MAX_FILE_BLOB) throw new SyncFileError('tooBig', 'an attachment is too large');
    size += b.bytes.length;
    if (size > MAX_FILE_PLAIN) throw new SyncFileError('tooBig', 'too large');
    parts.push(hexToBytes(b.hash), u32(b.bytes.length), b.bytes);
  }
  return concatBytes(...parts);
};

export const encodeSyncFile = async (c: SyncFileInput, passphrase: string, o: EncodeOptions = {}): Promise<Uint8Array> => {
  const random = o.random ?? randomBytes;
  const logN = o.logN ?? SCRYPT.logN;
  const header = concatBytes(MAGIC, Uint8Array.of(FILE_VERSION, FILE_MIN_READER, 1, logN, SCRYPT.r, SCRYPT.p), random(16));
  const k = await key(passphrase, header.subarray(HEADER - 16), logN, SCRYPT.r, SCRYPT.p);
  const plain = encodePayload(c);
  const out: Uint8Array[] = [header];
  const count = Math.max(1, Math.ceil(plain.length / CHUNK));
  for (let i = 0; i < count; i++) {
    out.push(chacha20poly1305(k, nonce(i, i === count - 1), header).encrypt(plain.subarray(i * CHUNK, (i + 1) * CHUNK)));
  }
  k.fill(0);
  return concatBytes(...out);
};

class Reader {
  at = 0;
  constructor(private b: Uint8Array) {}
  take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.at + n > this.b.length) throw new SyncFileError('format', 'truncated');
    return this.b.subarray(this.at, (this.at += n));
  }
  u8() { return this.take(1)[0]; }
  u32() { const [a, b, c, d] = this.take(4); return a * 2 ** 24 + (b << 16) + (c << 8) + d; }
  get done() { return this.at === this.b.length; }
}

const decodePayload = (b: Uint8Array): SyncFileContent => {
  const r = new Reader(b);
  const syncId = bytesToUuid(r.take(16));
  const nameLen = r.u8();
  if (nameLen > MAX_NAME) throw new SyncFileError('format', 'bad name');
  let name: string;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(r.take(nameLen)); } catch { throw new SyncFileError('format', 'bad name'); }
  const hi = r.u32(), lo = r.u32();
  const createdAt = hi * 2 ** 32 + lo;
  if (!Number.isSafeInteger(createdAt)) throw new SyncFileError('format', 'bad time');
  const count = r.u32();
  if (count > MAX_FILE_DOCS) throw new SyncFileError('tooBig', 'too many notes');
  const docs: FileDoc[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const kind = r.u8();
    if (kind > 1) throw new SyncFileError('format', 'bad kind');
    const id = kind === 0 ? 'catalog' : bytesToUuid(r.take(16));
    if (seen.has(id)) throw new SyncFileError('format', 'repeated note');
    seen.add(id);
    const len = r.u32();
    if (len > MAX_DOC_BYTES) throw new SyncFileError('tooBig', 'a note is too large');
    docs.push({ id, update: r.take(len).slice() });
  }
  const blobCount = r.u32();
  if (blobCount > MAX_FILE_BLOBS) throw new SyncFileError('tooBig', 'too many attachments');
  const blobs: FileBlob[] = [];
  for (let i = 0; i < blobCount; i++) {
    const hash = bytesToHex(r.take(32));
    if (seen.has(`blob:${hash}`)) throw new SyncFileError('format', 'repeated attachment');
    seen.add(`blob:${hash}`);
    const len = r.u32();
    if (len > MAX_FILE_BLOB) throw new SyncFileError('tooBig', 'an attachment is too large');
    blobs.push({ hash, bytes: r.take(len).slice() });
  }
  if (!r.done) throw new SyncFileError('format', 'trailing bytes');
  return { syncId, name, createdAt, docs, blobs };
};

export const decodeSyncFile = async (file: Uint8Array, passphrase: string, o: DecodeOptions = {}): Promise<SyncFileContent> => {
  if (file.length < HEADER + TAG || !MAGIC.every((m, i) => file[i] === m)) throw new SyncFileError('format', 'not a sync file');
  const [version, minReader, kdf, logN, r, p] = file.subarray(MAGIC.length, MAGIC.length + 6);
  if (minReader > FILE_VERSION) throw new SyncFileError('version', 'made by a newer version');
  if (version < 1 || kdf !== 1 || r !== SCRYPT.r || p !== SCRYPT.p || logN < (o.minLogN ?? MIN_LOG_N) || logN > MAX_LOG_N) throw new SyncFileError('format', 'bad key settings');
  const body = file.length - HEADER;
  if (body > MAX_FILE_PLAIN + (Math.ceil(MAX_FILE_PLAIN / CHUNK) + 1) * TAG + 4096) throw new SyncFileError('tooBig', 'too large');
  const header = file.subarray(0, HEADER);
  const k = await key(passphrase, header.subarray(HEADER - 16), logN, r, p);
  const plain: Uint8Array[] = [];
  let total = 0;
  try {
    for (let at = HEADER, i = 0; at < file.length; i++) {
      const last = file.length - at <= CHUNK + TAG;
      const end = last ? file.length : at + CHUNK + TAG;
      const piece = chacha20poly1305(k, nonce(i, last), header).decrypt(file.subarray(at, end));
      total += piece.length;
      if (total > MAX_FILE_PLAIN) throw new SyncFileError('tooBig', 'too large');
      plain.push(piece);
      at = end;
      if (o.yieldEvery && i % 64 === 63) await o.yieldEvery();
    }
  } catch (e) {
    if (e instanceof SyncFileError) throw e;
    throw new SyncFileError('passphrase', 'wrong passphrase or a damaged file'); // the cipher cannot tell the two apart
  } finally { k.fill(0); }
  return decodePayload(concatBytes(...plain));
};
