import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILE_VERSION, MAX_DOC_BYTES, SyncFileError, decodeSyncFile, encodeSyncFile, type SyncFileContent } from '../src/index.ts';

const FAST = { logN: 4 }; // the reader's floor is lowered to match in these tests
const READ = { minLogN: 4 };
const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const fill = (n: number, v: number) => new Uint8Array(n).fill(v);
const sample = (sizes: number[] = [20, 300, 5]): SyncFileContent => ({
  syncId: U(1), name: 'Personal', createdAt: 1_790_000_000_000,
  docs: [{ id: 'catalog', update: fill(sizes[0], 1) }, ...sizes.slice(1).map((n, i) => ({ id: U(10 + i), update: fill(n, 2 + i) }))],
});
const salt = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 3);
const enc = (c: SyncFileContent, pass = 'correct horse') => encodeSyncFile(c, pass, { ...FAST, random: salt });
const same = (a: SyncFileContent, b: SyncFileContent) => {
  assert.equal(a.syncId, b.syncId); assert.equal(a.name, b.name); assert.equal(a.createdAt, b.createdAt);
  assert.deepEqual(a.docs.map(d => [d.id, Array.from(d.update)]), b.docs.map(d => [d.id, Array.from(d.update)]));
};
const fails = async (bytes: Uint8Array, pass = 'correct horse', want?: string) => {
  await assert.rejects(decodeSyncFile(bytes, pass, READ), (e: unknown) => e instanceof SyncFileError && (!want || e.reason === want));
};

test('a file round-trips: small, empty, and larger than one 64 KB chunk (and exactly one or two chunks)', async () => {
  for (const sizes of [[20, 300, 5], [0], [200_000, 70_000, 1], [65_536 - 100], [131_072 - 100]]) {
    const c = sample(sizes);
    same(await decodeSyncFile(await enc(c), 'correct horse', READ), c);
  }
  const none: SyncFileContent = { syncId: U(2), name: '', createdAt: 0, docs: [] };
  same(await decodeSyncFile(await enc(none), 'correct horse', READ), none);
});

test('the same salt gives the same bytes; a different salt gives a different file', async () => {
  const c = sample();
  assert.deepEqual(await enc(c), await enc(c));
  const other = await encodeSyncFile(c, 'correct horse', { ...FAST, random: n => salt(n).map(x => x ^ 0x55) });
  assert.notDeepEqual(await enc(c), other);
});

test('a wrong passphrase is refused; the same text in another Unicode form is accepted; nothing readable is in the file', async () => {
  const c = sample();
  const file = await enc(c, 'café ①');
  await fails(file, 'wrong', 'passphrase');
  await fails(file, '', 'passphrase');
  same(await decodeSyncFile(file, 'café 1', READ), c); // NFKC: é as e + accent, and ① as 1
  const text = new TextEncoder().encode('Personal');
  const hay = Array.from(file).join(',');
  assert.ok(!hay.includes(Array.from(text).join(',')), 'the name must not appear in the clear');
});

test('not a sync file: empty, short, random, another magic', async () => {
  await fails(new Uint8Array(0), 'x', 'format');
  await fails(new Uint8Array(10), 'x', 'format');
  await fails(fill(500, 9), 'x', 'format');
  const file = await enc(sample());
  const bad = file.slice(); bad[0] = 0x58;
  await fails(bad, 'correct horse', 'format');
});

test('a file that needs a newer reader says so', async () => {
  const file = (await enc(sample())).slice();
  file[7] = FILE_VERSION + 1; // minReader
  await fails(file, 'correct horse', 'version');
});

test('key settings outside the safe range are refused before any key work', async () => {
  const file = await enc(sample());
  for (const logN of [0, 3, 13, 17, 31, 255]) {
    const f = file.slice(); f[9] = logN;
    const t = Date.now();
    await assert.rejects(decodeSyncFile(f, 'correct horse'), (e: unknown) => e instanceof SyncFileError && e.reason === 'format');
    assert.ok(Date.now() - t < 100, `logN ${logN} must not run scrypt`);
  }
  for (const [at, v] of [[8, 2], [8, 0], [10, 9], [11, 2]] as const) { // kdf, r, p
    const f = file.slice(); f[at] = v;
    await fails(f, 'correct horse', 'format');
  }
});

test('every single flipped byte is refused', async () => {
  const file = await enc(sample());
  for (let i = 0; i < file.length; i++) {
    const f = file.slice(); f[i] ^= 0x01;
    await fails(f);
  }
});

test('cut at any length, or with bytes added, is refused', async () => {
  const file = await enc(sample());
  for (let n = 0; n < file.length; n++) await fails(file.subarray(0, n));
  for (const extra of [1, 16, 17, 100]) await fails(concat(file, fill(extra, 0)));
});

const concat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

test('chunks cannot be swapped, dropped, repeated or moved between files', async () => {
  const HEADER = 6 + 6 + 16, FULL = 65_536 + 16;
  const file = await enc(sample([150_000, 10]));
  const at = (i: number) => file.subarray(HEADER + i * FULL, HEADER + (i + 1) * FULL);
  const head = file.subarray(0, HEADER), last = file.subarray(HEADER + 2 * FULL);
  await fails(concat(concat(concat(head, at(1)), at(0)), last)); // swapped
  await fails(concat(concat(head, at(0)), last)); // one dropped
  await fails(concat(concat(concat(concat(head, at(0)), at(0)), at(1)), last)); // repeated
  await fails(concat(concat(head, at(0)), at(1))); // last chunk dropped: a full chunk in last position is not the real last
  const other = await encodeSyncFile(sample([150_000, 10]), 'correct horse', { ...FAST, random: n => salt(n).map(x => x + 1) });
  await fails(concat(file.subarray(0, HEADER + FULL), other.subarray(HEADER + FULL))); // chunk from another file
});

test('repeated note ids are refused, and so are too-large notes when writing', async () => {
  const c = sample();
  c.docs.push({ id: U(10), update: fill(3, 9) });
  await fails(await enc(c), 'correct horse', 'format');
  await assert.rejects(encodeSyncFile({ ...sample(), docs: [{ id: 'catalog', update: new Uint8Array(MAX_DOC_BYTES + 1) }] }, 'x', FAST), (e: unknown) => e instanceof SyncFileError && e.reason === 'tooBig');
});

test('fuzz: random damage never throws anything but SyncFileError and never decodes to different content', async () => {
  const c = sample([2000, 70_000, 40]);
  const file = await enc(c);
  let seed = 20261031;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let refused = 0;
  for (let i = 0; i < 1500; i++) {
    let f = file.slice();
    const kind = Math.floor(rnd() * 4);
    if (kind === 0) for (let k = Math.floor(rnd() * 4) + 1; k > 0; k--) f[Math.floor(rnd() * f.length)] = Math.floor(rnd() * 256);
    else if (kind === 1) f = f.subarray(0, Math.floor(rnd() * f.length));
    else if (kind === 2) { const at = Math.floor(rnd() * f.length); f = concat(concat(f.subarray(0, at), fill(Math.floor(rnd() * 40) + 1, Math.floor(rnd() * 256))), f.subarray(at)); }
    else { const a = Math.floor(rnd() * f.length), b = Math.floor(rnd() * f.length); const g = f.slice(); g.set(f.subarray(a, Math.min(a + 30, f.length)), b); f = g.subarray(0, f.length); }
    try {
      same(await decodeSyncFile(f, 'correct horse', READ), c); // only an unchanged copy may succeed
    } catch (e) {
      assert.ok(e instanceof SyncFileError, `unexpected ${String(e)} at iteration ${i}`);
      refused++;
    }
  }
  assert.ok(refused > 1400);
});
