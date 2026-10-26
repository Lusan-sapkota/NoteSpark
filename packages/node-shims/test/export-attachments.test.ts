import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { unzipSync, zipSync } from '../../../Mobile/node_modules/fflate/esm/browser.js';
import { attachments, freshProfile, notes, sample } from './helpers.ts';

const exportNotes = await import(new URL('../../../Mobile/src/utils/exportNotes.ts', import.meta.url).href);

const noteFilesDir = () => join(process.env.NOTESPARK_DIR!, 'note-files');

test('zip export (includeAttachments default true) and import round-trip after wiping storage', async () => {
  await freshProfile(true);
  const pdfBytes = new Uint8Array(15_000);
  for (let i = 0; i < pdfBytes.length; i++) pdfBytes[i] = (i * 31 + 17) & 0xff;
  const csvBytes = new TextEncoder().encode('col1,col2\n10,20\n30,40\n');

  const addedPdf = await attachments.addAttachment({ bytes: pdfBytes, name: 'budget.pdf' });
  const addedCsv = await attachments.addAttachment({ bytes: csvBytes, name: 'table.csv' });

  const linkPdf = attachments.formatAttachmentLink('budget.pdf', addedPdf.hash);
  const linkCsv = attachments.formatAttachmentLink('table.csv', addedCsv.hash);

  await notes.saveNote(sample('Project Plan', { content: `Here is the budget:\n${linkPdf}\nAnd data:\n${linkCsv}` }));
  await notes.saveNote(sample('Plain Note', { content: 'No attachments here' }));

  const exportedNotes = await notes.getNotes();
  // Default options: includeAttachments is true
  const zipBytes = await exportNotes.buildNotesZip(exportedNotes);

  // Verify the zip contains both notes and attachments/<hash>-<name>
  const rawEntries = unzipSync(zipBytes);
  assert.ok(rawEntries[`attachments/${addedPdf.hash}-budget.pdf`]);
  assert.ok(rawEntries[`attachments/${addedCsv.hash}-table.csv`]);
  assert.deepEqual(rawEntries[`attachments/${addedPdf.hash}-budget.pdf`], pdfBytes);
  assert.deepEqual(rawEntries[`attachments/${addedCsv.hash}-table.csv`], csvBytes);

  // Also verify includeAttachments: false omits attachments/
  const zipWithout = await exportNotes.buildNotesZip(exportedNotes, { includeAttachments: false });
  const withoutEntries = Object.keys(unzipSync(zipWithout));
  assert.equal(withoutEntries.some(k => k.startsWith('attachments/')), false);

  // Wipe notes and attachment files on disk
  await notes.deleteAllNotesForever();
  rmSync(noteFilesDir(), { recursive: true, force: true });
  assert.equal(await attachments.hasAttachment(addedPdf.hash), false);
  assert.equal(await attachments.hasAttachment(addedCsv.hash), false);

  // Import from the zip via notesFromFile / notesFromZipBytes
  const zipPath = join(process.env.NOTESPARK_DIR!, 'roundtrip.zip');
  writeFileSync(zipPath, zipBytes);
  const parsedNotes = await exportNotes.notesFromFile(zipPath, 'roundtrip.zip');
  assert.equal(parsedNotes.length, 2);
  const { imported } = await notes.importNotes(parsedNotes, 'append');
  assert.equal(imported, 2);

  // Verify attachments are restored and decrypt to identical bytes
  assert.equal(await attachments.hasAttachment(addedPdf.hash), true);
  assert.equal(await attachments.hasAttachment(addedCsv.hash), true);
  assert.deepEqual(await attachments.readAttachment(addedPdf.hash), pdfBytes);
  assert.deepEqual(await attachments.readAttachment(addedCsv.hash), csvBytes);

  // Re-importing the same zip does not overwrite existing encrypted files on disk
  const diskBefore = readFileSync(join(noteFilesDir(), addedPdf.hash));
  await exportNotes.notesFromZipBytes(zipBytes);
  const diskAfter = readFileSync(join(noteFilesDir(), addedPdf.hash));
  assert.deepEqual(diskAfter, diskBefore);
});

test('zip import rejects tampered attachment hash and oversized (>32 MB) attachment entry', async () => {
  await freshProfile();
  const fakeHash = 'a'.repeat(64);
  const badZip = zipSync({
    'Note.md': new TextEncoder().encode('# Note\nHello'),
    [`attachments/${fakeHash}-tampered.bin`]: new Uint8Array([1, 2, 3, 4]),
  });

  await assert.rejects(
    () => exportNotes.notesFromZipBytes(badZip),
    /hash mismatch/i
  );
  assert.equal(await attachments.hasAttachment(fakeHash), false);
});
