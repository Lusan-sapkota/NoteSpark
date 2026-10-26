import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHUNK, type Frame, MAX_BUFFERED, MAX_DOC_BYTES, MAX_FRAME, ProtocolError, Reassembler, T, chunkUpdate, decodeFrame, encodeFrame } from '../src/wire.ts';

const U = '0b9d1f9e-5a54-4b9e-8a3a-1f2b3c4d5e6f';
const U2 = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
const samples: Frame[] = [
  { type: T.PROFILES, profiles: [{ syncId: U, name: 'Personal é😀', notes: 300, protected: true, locked: false }] },
  { type: T.SUBSCRIBE, syncId: U },
  { type: T.LINK, syncId: '', name: 'Work', more: true, entries: [{ uuid: U, hash: new Uint8Array(32).fill(7) }] },
  { type: T.LINK_PLAN, syncId: U, hubNotes: 98, clientNotes: 120, more: false, pairs: [{ clientUuid: U, hubUuid: U2 }] },
  { type: T.LINK_CONFIRM, syncId: U, accept: true },
  { type: T.SV, doc: 'catalog', stateVector: Uint8Array.of(1, 2, 3) },
  { type: T.UPDATE, doc: U, id: 70000, index: 1, count: 3, bytes: Uint8Array.of(9, 9) },
  { type: T.DOC_DONE, doc: U2 },
  { type: T.READY },
  { type: T.PING, nonce: 2 ** 40 },
  { type: T.PONG, nonce: 5 },
  { type: T.ERROR, code: 423, message: 'locked' },
  { type: T.BYE, reason: 'closing' },
];

test('every frame type round-trips', () => {
  for (const f of samples) assert.deepEqual(decodeFrame(encodeFrame(f)), f);
});

test('chunking at 64 KB and reassembly, in any order, with repeats', () => {
  const update = Uint8Array.from({ length: CHUNK * 3 + 17 }, (_, i) => i % 251);
  const frames = chunkUpdate('catalog', 1, update);
  assert.equal(frames.length, 4);
  assert.ok(frames.every(f => encodeFrame(f).length < MAX_FRAME));
  const r = new Reassembler();
  let out: Uint8Array | null = null;
  for (const i of [2, 0, 0, 3, 1, 1]) out = r.add(decodeFrame(encodeFrame(frames[i])) as any) ?? out;
  assert.deepEqual(out, update);
  assert.equal(r.buffered, 0);
  assert.equal(chunkUpdate('catalog', 2, new Uint8Array(0)).length, 1);
});

test('limits: 32 MB per document (413), buffered bytes, open assemblies, changed counts', () => {
  const chunk = (id: number, index: number, count: number, bytes = new Uint8Array(CHUNK)) => ({ type: T.UPDATE, doc: 'catalog', id, index, count, bytes }) as any;
  const r = new Reassembler();
  for (let i = 0; i < MAX_DOC_BYTES / CHUNK; i++) r.add(chunk(1, i, 600));
  assert.throws(() => r.add(chunk(1, 512, 600)), (e: any) => e instanceof ProtocolError && e.code === 413);
  const r2 = new Reassembler();
  for (let id = 0; id < 16; id++) r2.add(chunk(id, 0, 2));
  assert.throws(() => r2.add(chunk(99, 0, 2)), (e: any) => e.code === 429);
  const r3 = new Reassembler();
  r3.add(chunk(1, 0, 2));
  assert.throws(() => r3.add(chunk(1, 1, 3)), (e: any) => e.code === 400);
  assert.ok(MAX_BUFFERED >= 2 * MAX_DOC_BYTES);
  assert.throws(() => decodeFrame(new Uint8Array(MAX_FRAME + 1)), ProtocolError);
  assert.throws(() => decodeFrame(encodeFrame({ type: T.UPDATE, doc: 'catalog', id: 1, index: 0, count: 513 * 1000, bytes: new Uint8Array(0) })), ProtocolError);
});

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('fuzz: a million random and mutated inputs never crash, never over-allocate, never apply', () => {
  const runs = Number(process.env.FUZZ ?? 1_000_000);
  const seed = Number(process.env.SEED ?? 1);
  const r = rng(seed);
  const valid = samples.map(encodeFrame);
  const re = new Reassembler();
  let applied = 0, accepted = 0;
  for (let i = 0; i < runs; i++) {
    let input: Uint8Array;
    const mode = r();
    if (mode < 0.3) input = Uint8Array.from({ length: Math.floor(r() * 64) }, () => Math.floor(r() * 256));
    else {
      input = valid[Math.floor(r() * valid.length)].slice();
      for (let k = Math.floor(r() * 4) + 1; k > 0; k--) {
        const op = r();
        if (op < 0.5 && input.length) input[Math.floor(r() * input.length)] = Math.floor(r() * 256);
        else if (op < 0.7) input = input.subarray(0, Math.floor(r() * input.length));
        else if (op < 0.85) input = Uint8Array.from([...input, ...Array.from({ length: Math.floor(r() * 8) }, () => Math.floor(r() * 256))]);
        else if (input.length) { const at = Math.floor(r() * input.length); input = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x7f, ...input.subarray(at)]); }
      }
    }
    try {
      const f = decodeFrame(input);
      accepted++;
      assert.ok(encodeFrame(f).length <= input.length + 8, 'decoded more than it was given');
      if (f.type === T.UPDATE) { try { if (re.add(f)) applied++; } catch (e) { assert.ok(e instanceof ProtocolError); } }
    } catch (e) {
      assert.ok(e instanceof ProtocolError, `seed ${seed} run ${i}: ${e}`);
    }
    assert.ok(re.buffered <= MAX_BUFFERED);
  }
  assert.ok(accepted > 0);
  console.log(`fuzz: ${runs} inputs, ${accepted} decoded, ${applied} reassembled updates`);
});
