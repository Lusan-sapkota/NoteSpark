import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentImageHash, attachmentImageLoader, extractImageRefs, formatAttachmentImage, formatAttachmentLink, imageDataUri, parseAttachmentLinks, referencedHashes, removeAttachmentLink } from '../src/attachments.ts';

const H = 'a'.repeat(64);

test('a picture stored as an attachment is not also a document card, and still counts as referenced', () => {
  const content = `Notes\n${formatAttachmentImage(H)}\n${formatAttachmentLink('report.pdf', 'b'.repeat(64))}`;
  assert.deepEqual(parseAttachmentLinks(content).map(l => l.name), ['report.pdf']);
  assert.deepEqual([...referencedHashes([content])].sort(), [H, 'b'.repeat(64)]);
  assert.equal(removeAttachmentLink(`x\n${formatAttachmentImage(H)}`, H), `x\n${formatAttachmentImage(H)}`, 'removing a document link leaves a picture alone');
});

test('picture references: the Markdown form and the plain-note form', () => {
  assert.equal(formatAttachmentImage(H.toUpperCase()), `![Image](attachment:${H})`);
  assert.equal(attachmentImageHash(`attachment:${H}`), H);
  assert.equal(attachmentImageHash(`attachment:${H.slice(1)}`), null);
  assert.equal(attachmentImageHash('https://example.com/a.png'), null);
  assert.deepEqual(extractImageRefs(`![Image](attachment:${H}) and [Image: attachment:${'c'.repeat(64)}]`, true), [`attachment:${H}`, `attachment:${'c'.repeat(64)}`]);
});

test('image bytes become a data address the page can show, by what they are and not by a name', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 9]);
  assert.equal(imageDataUri(png), `data:image/png;base64,${Buffer.from(png).toString('base64')}`);
  assert.match(imageDataUri(jpg)!, /^data:image\/jpeg;base64,/);
  assert.match(imageDataUri(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0]))!, /^data:image\/gif;base64,/);
  assert.match(imageDataUri(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))!, /^data:image\/webp;base64,/);
  assert.equal(imageDataUri(Uint8Array.from([1, 2, 3, 4])), null, 'anything else is not shown');
  assert.equal(imageDataUri(Uint8Array.from({ length: 200_000 }, (_, i) => i % 251).fill(0xff, 0, 3).fill(0xd8, 1, 2)) !== null, true, 'a large image does not overflow the call stack');
});

test('the picture loader reads each stored picture once, accepts bytes in either shape, and shows nothing for a missing or non-image file', async () => {
  let reads = 0;
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 5]);
  const load = attachmentImageLoader(async hash => {
    reads++;
    if (hash === 'f'.repeat(64)) throw new Error('not here yet');
    if (hash === 'e'.repeat(64)) return Uint8Array.from([1, 2, 3, 4]);
    if (hash === 'd'.repeat(64)) return { 0: 0x89, 1: 0x50, 2: 0x4e, 3: 0x47, 4: 5 }; // what the browser web view gets back as JSON
    return png;
  }, 2);
  const a = await load('a'.repeat(64));
  assert.match(a!, /^data:image\/png;base64,/);
  await load('a'.repeat(64));
  assert.equal(reads, 1, 'second view comes from memory');
  assert.equal(await load('f'.repeat(64)), null);
  assert.equal(await load('e'.repeat(64)), null);
  assert.equal(await load('d'.repeat(64)), imageDataUri(png));
  await load('b'.repeat(64));
  await load('c'.repeat(64));
  const before = reads;
  await load('a'.repeat(64));
  assert.equal(reads, before + 1, 'the oldest picture was dropped from memory (2 are kept)');
});
