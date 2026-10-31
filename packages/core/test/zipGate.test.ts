import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, ZIP_TOO_LARGE_MESSAGE, zipImportGate } from '../src/noteFiles.ts';

const MB = 1024 * 1024;

test('a zip importer keeps what it wants and skips the rest without counting it', () => {
  const gate = zipImportGate(n => n.endsWith('.md'));
  assert.equal(gate({ name: 'a.md', originalSize: 10 }), true);
  assert.equal(gate({ name: 'skip.bin', originalSize: 10 * 1024 * MB }), false);
});

test('an entry that declares more than 32 MB is refused, whatever its real size (a small zip can declare gigabytes)', () => {
  const gate = zipImportGate(() => true);
  assert.equal(gate({ name: 'ok.md', originalSize: 32 * MB }), true);
  assert.throws(() => gate({ name: 'big.md', originalSize: 32 * MB + 1 }), { message: ZIP_TOO_LARGE_MESSAGE });
  assert.throws(() => zipImportGate(() => true)({ name: 'nan.md', originalSize: NaN }), { message: ZIP_TOO_LARGE_MESSAGE });
});

test('too many entries, or too many bytes together, are refused', () => {
  const many = zipImportGate(() => true);
  for (let i = 0; i < ZIP_MAX_ENTRIES; i++) many({ name: `n${i}.md`, originalSize: 1 });
  assert.throws(() => many({ name: 'one-more.md', originalSize: 1 }), { message: ZIP_TOO_LARGE_MESSAGE });
  const heavy = zipImportGate(() => true);
  for (let i = 0; i < ZIP_MAX_BYTES / (32 * MB); i++) heavy({ name: `f${i}.md`, originalSize: 32 * MB });
  assert.throws(() => heavy({ name: 'last.md', originalSize: 1 }), { message: ZIP_TOO_LARGE_MESSAGE });
});
