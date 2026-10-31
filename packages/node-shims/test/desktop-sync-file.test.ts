// The desktop's sync file operations (desktop/src/main/syncFile.ts) on real storage, with the dialogs replaced.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { crdt, database, freshProfile, notes, sample } from './helpers.ts';

const { SyncFileOps } = await import(new URL('../../../desktop/src/main/syncFile.ts', import.meta.url).href);
const dir = process.env.NOTESPARK_DIR!;
const file = join(dir, 'desktop-export.nsync');
let saveTo: string | null = file, openFrom: string | null = file;
let ready = true;
const ops = new SyncFileOps({ save: async () => saveTo, open: async () => openFrom }, () => ready);
const titles = async () => ((await database.db.getAllAsync('SELECT title FROM notes')) as { title: string }[]).map(r => r.title).sort();
const failure = async (p: Promise<unknown>) => { try { await p; return 'none'; } catch (e) { return String((e as Error).message); } };

test('export writes a locked file where the dialog says; cancelling writes nothing', async () => {
  await freshProfile(false);
  await notes.saveNote(sample('One'));
  await notes.saveNote(sample('Two'));
  assert.deepEqual(await ops.call('summary'), { notes: 2, attachments: 0, attachmentBytes: 0 });
  saveTo = null;
  assert.equal(await ops.call('export', { passphrase: 'correct horse', attachments: true }), false);
  assert.equal(existsSync(file), false);
  saveTo = file;
  assert.equal(await ops.call('export', { passphrase: 'correct horse', attachments: true }), true);
  assert.ok(statSync(file).size > 60);
  assert.equal(statSync(file).mode & 0o077, 0, 'readable by the owner only');
  assert.ok(!readFileSync(file).includes(Buffer.from('One')), 'no readable note text');
});

test('import: a wrong passphrase is refused, the right one shows the counts, and run joins the notes', async () => {
  await freshProfile(false);
  await notes.saveNote(sample('One')); // already here: joined
  await notes.saveNote(sample('Only here'));
  assert.equal(await ops.call('pick'), true);
  assert.equal(await failure(ops.call('plan', { passphrase: 'wrong' })), 'SYNC_FILE:passphrase');
  const view: any = await ops.call('plan', { passphrase: 'correct horse' });
  assert.deepEqual([view.kind, view.localNotes, view.fileNotes, view.same], ['adopt', 2, 2, 1]);
  await ops.call('run', {});
  assert.deepEqual(await titles(), ['One', 'Only here', 'Two']);
  await ops.call('clear');
});

test('a file from another profile imports as a new profile and leaves the open one alone', async () => {
  const mine = await freshProfile(false);
  await notes.saveNote(sample('Mine'));
  await crdt.linkProfile(database.db, crypto.randomUUID(), new Map()); // linked to a sync id that is not the file's
  assert.equal(await ops.call('pick'), true);
  const view: any = await ops.call('plan', { passphrase: 'correct horse' });
  assert.equal(view.kind, 'otherProfile');
  assert.ok(view.fileName);
  await ops.call('run', { asNewProfile: true });
  assert.deepEqual(await titles(), ['One', 'Two'], 'the new profile holds the file notes');
  await database.openProfileDatabase(mine);
  assert.deepEqual(await titles(), ['Mine'], 'the profile that was open is untouched');
});

test('picking a damaged file, a missing file or cancelling is handled; a locked profile refuses', async () => {
  await freshProfile(false);
  openFrom = null;
  assert.equal(await ops.call('pick'), false);
  openFrom = join(dir, 'does-not-exist.nsync');
  assert.equal(await failure(ops.call('pick')), 'SYNC_FILE:format');
  openFrom = file;
  await ops.call('pick');
  ready = false;
  assert.equal(await failure(ops.call('summary')), 'PROFILE_LOCKED');
  ready = true;
});
