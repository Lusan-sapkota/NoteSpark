// What a web-view session (callStorage from 'http') may not do that only the desktop window may (docs/architecture/desktop.md: protected profiles stay locked in the web view).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { profiles, notes } from './helpers.ts';

const st = await import('../../../desktop/src/main/storage.ts');
const web = (module: string, fn: string, args: unknown[] = []) => st.callStorage({ module, fn, args }, 'http');
const refused = (p: Promise<unknown>) => assert.rejects(p, /Unknown storage call|managed in the desktop/);

test('a web session cannot reach a PIN-protected profile through the database module', async () => {
  await st.lockStatus();
  const secret = await profiles.addProfile('Secret', '1234');
  await profiles.switchProfile(secret.id, '1234');
  await notes.saveNote({ title: 'TOPSECRET', content: 'body', isMarkdown: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await profiles.switchProfile('default');
  await refused(web('profiles', 'switchProfile', [secret.id]));
  for (const fn of ['getProfileKey', 'restoreProfileKey', 'forgetProfileKey', 'openProfileDatabase', 'openProfileConnection', 'deleteProfileDatabase', 'setProfileEncryption']) await refused(web('database', fn, [secret.id, 'x']));
  assert.deepEqual((await web('notes', 'getNotes') as { title: string }[]).map(n => n.title), []);
});

test('a web session cannot name another profile or read host files through attachments', async () => {
  const file = join(process.env.NOTESPARK_DIR!, 'host.txt');
  writeFileSync(file, 'HOSTSECRET');
  await refused(web('attachments', 'addAttachment', [{ uri: file, name: 'a.txt' }]));
  await refused(web('attachments', 'copyAttachmentsForTransfer', [[], 'a', 'b']));
  await refused(web('attachments', 'deleteProfileAttachments', ['default']));
  const added = await web('attachments', 'addAttachment', [{ bytes: new Uint8Array([1, 2, 3]), name: 'a.bin' }]) as { hash: string };
  assert.equal((await web('attachments', 'readAttachment', [added.hash]) as Uint8Array).length, 3);
  // A profile id the caller adds is dropped: the open profile answers, never the named one.
  assert.equal(await web('attachments', 'hasAttachment', [added.hash, 'someone-else']), true);
});
