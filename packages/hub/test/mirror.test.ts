import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryStore, type NoteState, rebaseText } from '@notespark/sync';
import { Mirror, parse, render } from '../src/mirror.ts';

const T = '2026-01-01T00:00:00.000Z';
const note = (title: string, content = `${title} body`, over: Partial<NoteState> = {}): NoteState => ({ title, content, isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: T, updatedAt: T, ...over });
const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const setup = async (opts: { protected?: boolean } = {}) => {
  const folder = await mkdtemp(join(tmpdir(), 'notespark-mirror-'));
  const store = new MemoryStore(1);
  await store.createProfile('p', 'Personal');
  await store.link('p', new Map());
  const calls = { applyFile: 0 };
  const real = store.applyFile.bind(store);
  store.applyFile = async (...a) => { calls.applyFile++; return real(...a); };
  const mirror = new Mirror({ store, syncId: 'p', folder, profileName: 'Personal', debounceMs: 30, retryMs: 100, isProtected: opts.protected });
  const dir = join(folder, 'Personal');
  const wait = () => mirror.idle();
  const files = async () => (await readdir(dir).catch(() => [] as string[])).filter(f => !f.startsWith('.')).sort();
  const read = (f: string) => readFile(join(dir, f), 'utf8');
  return { folder, dir, store, mirror, calls, wait, files, read, done: async () => { await mirror.stop(); await rm(folder, { recursive: true, force: true }); } };
};

test('rebase: edits in different places both stay, the same place loses nothing', () => {
  assert.equal(rebaseText('a b c', 'A b c', 'a b C'), 'A b C');
  assert.equal(rebaseText('a b c', 'a b c!', 'a b c'), 'a b c!');
  const merged = rebaseText('one two three', 'one TWO three', 'one 2 three');
  assert.ok(merged.includes('2') && merged.includes('TWO'));
  assert.equal(rebaseText('x', 'y', 'x'), 'y');
});

test('front matter: round trip, broken front matter keeps the whole text', () => {
  const n = note('T', 'line\n---\nmore');
  assert.deepEqual(parse(render(U(1), n)), { uuid: U(1), pinned: false, archived: false, body: n.content });
  for (const raw of ['---\nuuid: nope\n---\nbody', '---\nuuid: ' + U(2) + '\nno close', 'plain text', '---\ntitle: x\n---\nbody'])
    assert.deepEqual(parse(raw), { uuid: null, pinned: false, archived: false, body: raw });
});

test('notes become files: layout, duplicate titles, atomic writes, no import loop (the hub\'s own writes)', async t => {
  const s = await setup();
  t.after(s.done);
  s.store.edit('p', U(1), note('Same', 'first', { createdAt: '2026-01-01T00:00:00.000Z' }));
  s.store.edit('p', U(2), note('Same', 'second', { createdAt: '2026-01-02T00:00:00.000Z' }));
  s.store.edit('p', U(3), note('Bad/Name: here?', 'x', { isPinned: true }));
  await s.mirror.start();
  await s.wait();
  assert.deepEqual(await s.files(), ['Bad-Name- here-.md', 'Same (2).md', 'Same.md']);
  assert.match(await s.read('Same.md'), /^---\nuuid: 00000000-0000-4000-8000-000000000001\n/);
  assert.match(await s.read('Bad-Name- here-.md'), /pinned: true/);
  s.store.edit('p', U(1), note('Same', 'first edited'));
  await s.wait();
  assert.ok((await s.read('Same.md')).endsWith('first edited'));
  assert.equal(s.calls.applyFile, 0, 'the hub\'s own writes were not imported again');
  assert.deepEqual((await readdir(s.dir)).filter(f => f.endsWith('.tmp')), []);
});

test('an outside edit becomes a change on the note; a new file without a uuid becomes a note and gets one', async t => {
  const s = await setup();
  t.after(s.done);
  s.store.edit('p', U(1), note('Note', 'hello'));
  await s.mirror.start();
  await s.wait();
  await writeFile(join(s.dir, 'Note.md'), (await s.read('Note.md')).replace('hello', 'hello world'));
  await writeFile(join(s.dir, 'Fresh idea.md'), 'written in an editor');
  await s.wait();
  assert.equal(s.store.peek('p', U(1))!.content, 'hello world');
  const fresh = (await s.store.allNotes('p')).find(n => n.title === 'Fresh idea')!;
  assert.equal(fresh.content, 'written in an editor');
  assert.match(await s.read('Fresh idea.md'), new RegExp(`uuid: ${fresh.uuid}`));
});

test('broken front matter: nothing is dropped', async t => {
  const s = await setup();
  t.after(s.done);
  await s.mirror.start();
  await writeFile(join(s.dir, 'Broken.md'), '---\nuuid: ???\nbody text');
  await s.wait();
  const n = (await s.store.allNotes('p')).find(x => x.title === 'Broken')!;
  assert.ok(n.content.includes('body text') && n.content.includes('uuid: ???'));
});

test('rename follows the file name; delete means the bin, never an erase', async t => {
  const s = await setup();
  t.after(s.done);
  s.store.edit('p', U(1), note('Old name', 'keep me'));
  s.store.edit('p', U(2), note('Doomed', 'bye'));
  await s.mirror.start();
  await s.wait();
  await rename(join(s.dir, 'Old name.md'), join(s.dir, 'New name.md'));
  await s.wait();
  assert.equal(s.store.peek('p', U(1))!.title, 'New name');
  assert.deepEqual(await s.files(), ['Doomed.md', 'New name.md']);
  await rm(join(s.dir, 'Doomed.md'));
  await s.wait();
  const doomed = s.store.peek('p', U(2))!;
  assert.ok(doomed.deletedAt, 'in the bin');
  assert.equal(doomed.content, 'bye');
  assert.deepEqual(s.store.erasedSet('p'), []);
  assert.deepEqual(await s.files(), ['New name.md']);
  s.store.edit('p', U(2), { ...doomed, deletedAt: null });
  await s.wait();
  assert.deepEqual(await s.files(), ['Doomed.md', 'New name.md'], 'restored from the bin, the file is back');
});

test('race: an outside edit while a remote update arrives, both are kept', async t => {
  const s = await setup();
  t.after(s.done);
  s.store.edit('p', U(1), note('Race', 'line one\nline two\nline three\n'));
  await s.mirror.start();
  await s.wait();
  const other = new MemoryStore(2);
  await other.createProfile('p', 'Personal');
  await other.link('p', new Map());
  const send = async (doc: string) => s.store.apply('p', doc, [await other.diff('p', doc, await s.store.stateVector('p', doc))]);
  for (const doc of ['catalog', U(1)]) await other.apply('p', doc, [await s.store.diff('p', doc, await other.stateVector('p', doc))]);
  other.edit('p', U(1), { ...(await other.note('p', U(1)))!, content: 'line one\nline two\nline three REMOTE\n', updatedAt: new Date().toISOString() });
  await send(U(1));
  // the file has not been rewritten yet: the person saves an edit made on the old text
  const old = await s.read('Race.md');
  await writeFile(join(s.dir, 'Race.md'), old.replace('line one', 'line one LOCAL'));
  await s.wait();
  const final = s.store.peek('p', U(1))!.content;
  assert.equal(final, 'line one LOCAL\nline two\nline three REMOTE\n');
  assert.ok((await s.read('Race.md')).endsWith(final));
});

test('protected profiles are not mirrored; an unwritable folder pauses, then recovers', async t => {
  const p = await setup({ protected: true });
  t.after(p.done);
  p.store.edit('p', U(1), note('Secret'));
  await p.mirror.start();
  assert.equal(p.mirror.status.state, 'not mirrored');
  assert.deepEqual(await p.files(), []);

  const s = await setup();
  t.after(s.done);
  s.store.edit('p', U(1), note('A'));
  await mkdir(join(s.folder, 'Personal'));
  await chmod(join(s.folder, 'Personal'), 0o500);
  await s.mirror.start();
  assert.equal(s.mirror.status.state, 'paused');
  assert.equal(s.store.peek('p', U(1))!.title, 'A', 'syncing between devices is not affected');
  await chmod(join(s.folder, 'Personal'), 0o700);
  await new Promise(r => setTimeout(r, 300));
  await s.wait();
  assert.equal(s.mirror.status.state, 'ok');
  assert.deepEqual(await s.files(), ['A.md']);
});

test('rebuild: a lost database comes back from the files', async t => {
  const s = await setup();
  t.after(s.done);
  await mkdir(s.dir, { recursive: true });
  await writeFile(join(s.dir, 'Back.md'), render(U(9), note('Back', 'from a file', { isPinned: true })));
  await writeFile(join(s.dir, 'No uuid.md'), 'skipped by rebuild');
  assert.equal(await Mirror.rebuild(s.store, 'p', s.dir), 1);
  assert.deepEqual({ ...s.store.peek('p', U(9))!, createdAt: '', updatedAt: '' }, { ...note('Back', 'from a file', { isPinned: true }), createdAt: '', updatedAt: '' });
  assert.equal(await Mirror.rebuild(s.store, 'p', s.dir), 0, 'notes the hub already has are left alone');
});

test('a phone edit through the engine reaches the file, and the file edit reaches the phone', async t => {
  const { Client, FakeClock, Hub, Net } = await import('../../sync-protocol/src/index.ts');
  const { createHash } = await import('node:crypto');
  const s = await setup();
  t.after(s.done);
  const clock = new FakeClock();
  const net = new Net(clock, () => 0.5);
  const sha = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
  const hub = new Hub(s.store, clock, sha);
  const phone = new MemoryStore(7);
  phone.plain.set(U(5), note('From phone', 'typed on the phone'));
  const client = new Client({ store: phone, clock, rng: () => 0.5, hash: sha, syncId: undefined, link: { syncId: 'p', name: '' }, connect: () => { const [a, b] = net.pair(); hub.accept(b); return a; } });
  await s.mirror.start();
  client.start();
  await clock.advance(10_000);
  await s.wait();
  assert.ok((await s.files()).includes('From phone.md'));
  const before = s.calls.applyFile;
  phone.edit('p', U(5), { ...phone.peek('p', U(5))!, content: 'edited on the phone', updatedAt: new Date().toISOString() });
  await clock.advance(2000);
  await s.wait();
  assert.ok((await s.read('From phone.md')).endsWith('edited on the phone'));
  assert.equal(s.calls.applyFile, before, 'applied remote updates are not imported back from the file');
  const f = join(s.dir, 'From phone.md');
  await writeFile(f, (await readFile(f, 'utf8')).replace('edited on', 'edited in VS Code, not on'));
  await s.wait();
  await clock.advance(2000);
  assert.equal(phone.peek('p', U(5))!.content, 'edited in VS Code, not on the phone');
  client.stop();
  hub.stop();
});
