// The sync file on the phone's real storage and attachment files: notes and an encrypted attachment go out in a file and come back.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertInStep, attachments, database, freshProfile, notes, sample } from './helpers.ts';

const flow = await import('@notespark/sync-protocol');
const { storageStore } = await import(new URL('../../../mobile/src/storage/syncStore.ts', import.meta.url).href);
const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
const PASS = 'correct horse';

test('a profile with an attachment exports to a file and imports into another profile, attachment included', async () => {
  const a = await freshProfile(true);
  const bytes = Uint8Array.from({ length: 150_000 }, (_, i) => (i * 31) & 255); // more than one 64 KB chunk
  const { hash } = await attachments.addAttachment({ bytes, name: 'picture.bin', size: bytes.length }, a);
  await notes.saveNote({ ...sample('With picture'), content: `look attachment:${hash}` });
  await notes.saveNote(sample('Plain'));
  const storeA = storageStore(database.db, 'A', a);
  const summary = await flow.summarizeExport(storeA);
  assert.deepEqual(summary, { notes: 2, attachments: 1, attachmentBytes: 150_000 });
  const file = await flow.exportSyncFile({ store: storeA, name: 'A', passphrase: PASS, uuid: () => crypto.randomUUID() });

  rmSync(join(process.env.NOTESPARK_DIR!, 'note-files', hash)); // unprotected profiles share this folder (F46): remove it so the import must bring the file back
  const b = await freshProfile(false);
  await notes.saveNote(sample('Plain')); // the same note already here: joined, not duplicated
  await notes.saveNote(sample('Only here'));
  const storeB = storageStore(database.db, 'B', b);
  const plan = await flow.planImport(storeB, file, PASS, sha256);
  assert.equal(plan.kind, 'adopt');
  if (plan.kind === 'otherProfile') return;
  assert.deepEqual([plan.localNotes, plan.fileNotes, plan.pairs.length, plan.attachments], [2, 2, 1, 1]);
  await flow.runImport(storeB, plan);

  const titles = ((await database.db.getAllAsync('SELECT title FROM notes')) as { title: string }[]).map(r => r.title).sort();
  assert.deepEqual(titles, ['Only here', 'Plain', 'With picture']);
  assert.deepEqual(await attachments.readAttachment(hash, b), bytes);
  await assertInStep('after the import');

  const again = await flow.planImport(storeB, file, PASS, sha256); // the same file again
  assert.equal(again.kind, 'merge');
  if (again.kind !== 'otherProfile') await flow.runImport(storeB, again);
  assert.equal((((await database.db.getAllAsync('SELECT title FROM notes')) as unknown[]).length), 3);
  await assertInStep('after importing twice');
});
