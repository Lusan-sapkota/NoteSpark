import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  attachments,
  crdt,
  database,
  freshProfile,
  notes,
  profiles,
  reopen,
  sample,
} from './helpers.ts';

const noteFilesDir = () => join(process.env.NOTESPARK_DIR!, 'note-files');

const makeBytes = (len: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(len);
  let x = seed | 0 || 1;
  for (let i = 0; i < len; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
};

test('round-trip addAttachment -> readAttachment across small, medium, chunk boundaries, and 32 MB', async () => {
  await freshProfile();
  const sizes = [
    0,
    1,
    64 * 1024 - 1,
    64 * 1024,
    64 * 1024 + 1,
    256 * 1024 + 333,
    attachments.MAX_ATTACHMENT_BYTES,
  ];
  for (const size of sizes) {
    const data = makeBytes(size, size + 7);
    const added = await attachments.addAttachment({ bytes: data, name: `doc-${size}.bin` });
    assert.equal(added.size, size);
    assert.match(added.hash, /^[0-9a-f]{64}$/);

    const meta = await attachments.getAttachmentMeta(added.hash);
    assert.ok(meta);
    assert.equal(meta.size, size);

    const roundTrip = await attachments.readAttachment(added.hash);
    assert.equal(roundTrip.byteLength, data.byteLength);
    assert.equal(Buffer.compare(Buffer.from(roundTrip), Buffer.from(data)), 0, `mismatch at size ${size}`);
  }
});

test('deduplication: attaching identical bytes twice with different names stores one file and returns the same hash', async () => {
  await freshProfile();
  const bytes = makeBytes(12000, 99);
  const first = await attachments.addAttachment({ bytes, name: 'first-name.pdf' });
  const diskPath = join(noteFilesDir(), first.hash);
  const diskBytesBefore = readFileSync(diskPath);

  const second = await attachments.addAttachment({ bytes, name: 'second-name.pdf' });
  assert.equal(first.hash, second.hash);
  assert.equal(first.size, second.size);
  assert.equal(second.name, 'second-name.pdf');

  // Existing valid encrypted file on disk is not rewritten (same random salt/ciphertext).
  const diskBytesAfter = readFileSync(diskPath);
  assert.deepEqual(diskBytesAfter, diskBytesBefore);
});

test('size limit: 32 MB + 1 byte is refused with exact message and writes nothing to disk', async () => {
  await freshProfile();
  const beforeFiles = existsSync(noteFilesDir()) ? readdirSync(noteFilesDir()) : [];
  const oversized = new Uint8Array(attachments.MAX_ATTACHMENT_BYTES + 1);
  oversized[0] = 0x42;
  oversized[oversized.length - 1] = 0x99;

  await assert.rejects(
    () => attachments.addAttachment({ bytes: oversized, name: 'too-big.pdf' }),
    (err: Error) => {
      assert.equal(err.message, 'That file is over 32 MB. Attach a smaller one.');
      return true;
    }
  );

  const afterFiles = existsSync(noteFilesDir()) ? readdirSync(noteFilesDir()) : [];
  assert.deepEqual(afterFiles, beforeFiles);
});

test('tamper and truncation: flipping header, payload, or tag bytes or truncating fails to open', async () => {
  await freshProfile();
  const data = makeBytes(64 * 1024 + 500, 1234); // 2 chunks
  const { hash } = await attachments.addAttachment({ bytes: data, name: 'report.pdf' });
  const diskPath = join(noteFilesDir(), hash);
  const original = readFileSync(diskPath);

  try {
    // 1. Flip version byte
    const badVersion = Buffer.from(original);
    badVersion[0] ^= 0xff;
    writeFileSync(diskPath, badVersion);
    await assert.rejects(() => attachments.readAttachment(hash));

    // 2. Flip salt byte in header
    const badSalt = Buffer.from(original);
    badSalt[5] ^= 0x01;
    writeFileSync(diskPath, badSalt);
    await assert.rejects(() => attachments.readAttachment(hash));

    // 3. Flip ciphertext byte in chunk 0
    const badCipher = Buffer.from(original);
    badCipher[40] ^= 0x01;
    writeFileSync(diskPath, badCipher);
    await assert.rejects(() => attachments.readAttachment(hash));

    // 4. Flip last byte (authentication tag of final chunk)
    const badTag = Buffer.from(original);
    badTag[badTag.length - 1] ^= 0x01;
    writeFileSync(diskPath, badTag);
    await assert.rejects(() => attachments.readAttachment(hash));

    // 5. Truncate 1 byte off the end
    writeFileSync(diskPath, original.subarray(0, original.length - 1));
    await assert.rejects(() => attachments.readAttachment(hash));

    // 6. Truncate entire second chunk off the end
    const chunk2Len = 500 + 16;
    writeFileSync(diskPath, original.subarray(0, original.length - chunk2Len));
    await assert.rejects(() => attachments.readAttachment(hash));
  } finally {
    writeFileSync(diskPath, original);
  }
  assert.deepEqual(await attachments.readAttachment(hash), data);
});

test('openAttachmentTemp sanitizes path traversal and cleans up temp copy', async () => {
  await freshProfile();
  const data = new TextEncoder().encode('hello attachment viewer');
  const { hash } = await attachments.addAttachment({ bytes: data, name: '../../etc/passwd' });
  const { uri, cleanup } = await attachments.openAttachmentTemp(hash, '../../secret/notes.txt');
  const fsPath = fileURLToPath(uri);
  assert.ok(fsPath.endsWith('/notes.txt'));
  assert.ok(!fsPath.includes('/secret/'));
  assert.deepEqual(new Uint8Array(readFileSync(fsPath)), data);
  await cleanup();
  assert.equal(existsSync(fsPath), false);
});

test('protected profile encryption, lock isolation, and transferNotesToProfile with undo', async () => {
  const sourceId = await freshProfile(true);
  const bytes = makeBytes(8192, 555);
  const { hash } = await attachments.addAttachment({ bytes, name: 'contract.pdf' });
  const link = attachments.formatAttachmentLink('contract.pdf', hash);
  const noteId = await notes.saveNote(sample('WithFile', { content: `See ${link}` }));

  // Create a PIN-protected target profile
  const targetId = await freshProfile(true);
  assert.equal(await database.setProfileEncryption(targetId, true), true);

  // Switch back to source and transfer the note to the protected target profile
  await database.openProfileDatabase(sourceId);
  const toMove = (await notes.getNotes()).filter((n: any) => n.id === noteId);
  const undo = await profiles.transferNotesToProfile(toMove, targetId);

  // Open target profile and verify attachment is readable with target's profile key
  await database.openProfileDatabase(targetId);
  assert.deepEqual(await attachments.readAttachment(hash, targetId), bytes);

  // Undo the transfer back to source profile
  await database.openProfileDatabase(sourceId);
  await undo();
  assert.deepEqual(await attachments.readAttachment(hash, sourceId), bytes);

  // Now encrypt source profile itself; when its key is forgotten (locked), attachment cannot be read
  assert.equal(await database.setProfileEncryption(sourceId, true), true);
  assert.deepEqual(await attachments.readAttachment(hash, sourceId), bytes);
  const savedKey = await database.getProfileKey(sourceId);
  assert.ok(savedKey);
  await database.closeProfileDatabase(sourceId);
  await database.forgetProfileKey(sourceId);
  await assert.rejects(() => attachments.readAttachment(hash, sourceId), /locked|corrupt/i);

  // Restore key so later tests can read this profile during pruning
  await database.restoreProfileKey(sourceId, savedKey);
  await database.openProfileDatabase(sourceId);
});

test('pruneAttachments respects active, trashed, versioned, <24h, >24h, and unreadable profile rules', async () => {
  const profileId = await freshProfile(true);

  const mk = async (seed: number, ageHours: number) => {
    const { hash } = await attachments.addAttachment({ bytes: makeBytes(512, seed), name: `f-${seed}.txt` });
    const p = join(noteFilesDir(), hash);
    const mtimeSec = (Date.now() - ageHours * 3600 * 1000) / 1000;
    utimesSync(p, mtimeSec, mtimeSec);
    return hash;
  };

  const activeHash = await mk(101, 48);
  const trashedHash = await mk(102, 48);
  const versionHash = await mk(103, 48);
  const youngUnrefHash = await mk(104, 2); // 2 hours old (<24h)
  const oldUnrefHash = await mk(105, 30); // 30 hours old (>24h)

  // 1. Active note references activeHash
  await notes.saveNote(sample('Active', { content: attachments.formatAttachmentLink('a.txt', activeHash) }));

  // 2. Trashed note references trashedHash
  const trashedId = await notes.saveNote(sample('Trashed', { content: attachments.formatAttachmentLink('b.txt', trashedHash) }));
  await notes.moveNoteToBin(trashedId);

  // 3. Note version references versionHash (edited away in current note content)
  const versionedId = await notes.saveNote(sample('Versioned', { content: attachments.formatAttachmentLink('c.txt', versionHash) }));
  await notes.updateNote({ id: versionedId, title: 'Versioned', content: 'no attachment now', isMarkdown: true });

  // Simulate an unreadable/locked profile database: nothing should be deleted while any profile DB is unreadable!
  const lockedProfile = await freshProfile();
  await database.setProfileEncryption(lockedProfile, true);
  const lockedKey = await database.getProfileKey(lockedProfile);
  await database.closeProfileDatabase(lockedProfile);
  await database.forgetProfileKey(lockedProfile);

  await database.openProfileDatabase(profileId);
  const deletedWhileLocked = await attachments.pruneAttachments();
  assert.equal(deletedWhileLocked, 0, 'must abort and delete 0 files when any profile DB is unreadable');
  assert.equal(await attachments.hasAttachment(oldUnrefHash), true);

  // Restore the locked profile's key so all profiles are readable again
  await database.restoreProfileKey(lockedProfile, lockedKey!);
  await database.openProfileDatabase(profileId);

  const deletedCount = await attachments.pruneAttachments();
  assert.ok(deletedCount >= 1);

  assert.equal(await attachments.hasAttachment(activeHash), true, 'active note attachment must be kept');
  assert.equal(await attachments.hasAttachment(trashedHash), true, 'trashed note attachment must be kept');
  assert.equal(await attachments.hasAttachment(versionHash), true, 'versioned note attachment must be kept');
  assert.equal(await attachments.hasAttachment(youngUnrefHash), true, 'unreferenced <24h attachment must be kept');
  assert.equal(await attachments.hasAttachment(oldUnrefHash), false, 'unreferenced >24h attachment must be pruned');
});

test('crash between attachment write and note save leaves valid blob and clean database', async () => {
  const profileId = await freshProfile(true);
  const data = makeBytes(4096, 777);
  const { hash } = await attachments.addAttachment({ bytes: data, name: 'crash-test.pdf' });

  // Inject a crash on the SQLite INSERT when saving the note that references the attachment
  const proto = (await import('expo-sqlite')).SQLiteDatabase.prototype as any;
  const origRun = proto.runAsync;
  proto.runAsync = function () {
    return Promise.reject(new Error('simulated DB crash'));
  };
  try {
    await assert.rejects(() =>
      notes.saveNote(sample('CrashNote', { content: attachments.formatAttachmentLink('crash-test.pdf', hash) }))
    );
  } finally {
    proto.runAsync = origRun;
  }

  await reopen(profileId);
  // No half-saved note in DB, and the attachment file on disk is intact (not corrupt) and young (<24h so kept until grace expires).
  assert.equal((await notes.getNotes()).length, 0);
  assert.deepEqual(await attachments.readAttachment(hash), data);

  // Also test crash during file moveAsync: leaves no corrupt target file on disk
  const fsLegacy = await import('expo-file-system/legacy');
  const data2 = makeBytes(4096, 888);
  (fsLegacy as any).setFailNextMove(true);
  try {
    await assert.rejects(() => attachments.addAttachment({ bytes: data2, name: 'half.pdf' }));
  } finally {
    (fsLegacy as any).setFailNextMove(false);
  }
  const leftoverTmp = readdirSync(noteFilesDir()).filter(f => f.includes('.tmp.'));
  assert.deepEqual(leftoverTmp, [], 'failed atomic write must clean up its .tmp file');
});
