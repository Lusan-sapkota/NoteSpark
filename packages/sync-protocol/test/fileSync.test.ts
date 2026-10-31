import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore, type NoteState } from '@notespark/sync';
import { SyncFileFlowError, exportSyncFile, planImport, runImport } from '../src/index.ts';
import { note, rng, sha256, uuid } from './harness.ts';

const S = '11111111-1111-4111-8111-111111111111';
const PASS = 'correct horse';
let ids = 1000;
const newId = () => uuid(ids++);
const exp = (store: MemoryStore, name = 'Personal') => exportSyncFile({ store, name, passphrase: PASS, uuid: newId, now: () => 1_790_000_000_000 });
const imp = async (store: MemoryStore, file: Uint8Array) => {
  const plan = await planImport(store, file, PASS, sha256);
  assert.notEqual(plan.kind, 'otherProfile');
  if (plan.kind !== 'otherProfile') await runImport(store, plan);
  return plan;
};
const linked = (clientId: number, notes: Record<string, NoteState> = {}) => {
  const s = new MemoryStore(clientId);
  void s.createProfile(S, 'Personal');
  for (const [u, n] of Object.entries(notes)) s.edit(S, u, n);
  return s;
};
const view = (s: MemoryStore, id = S) => JSON.stringify(Object.entries(s.notes(id)).sort(([a], [b]) => (a < b ? -1 : 1)));

test('an unlinked profile exports under a sync id of its own; the file imports into a fresh profile and both hold the same notes', async () => {
  const a = new MemoryStore(1);
  a.plain.set(uuid(1), note('One'));
  a.plain.set(uuid(2), note('Two', 'text two'));
  const file = await exp(a);
  const [p] = await a.profiles();
  assert.ok(p.syncId);
  const b = new MemoryStore(2);
  const plan = await imp(b, file);
  assert.equal(plan.kind === 'adopt' && plan.fileNotes, 2);
  assert.equal(view(b, p.syncId), view(a, p.syncId));
});

test('importing the same file twice changes nothing', async () => {
  const a = linked(1, { [uuid(1)]: note('One'), [uuid(2)]: note('Two') });
  const file = await exp(a);
  const b = new MemoryStore(2);
  await imp(b, file);
  const once = view(b);
  const plan = await imp(b, file);
  assert.equal(plan.kind, 'merge');
  assert.equal(view(b), once);
});

test('two devices that each wrote notes end equal after exporting both ways, and again after more edits', async () => {
  const a = linked(1, { [uuid(1)]: note('A one') });
  const b = new MemoryStore(2);
  await imp(b, await exp(a));
  a.edit(S, uuid(2), note('A two'));
  b.edit(S, uuid(3), note('B three'));
  b.edit(S, uuid(1), note('A one, edited on B'));
  await imp(b, await exp(a));
  await imp(a, await exp(b));
  assert.equal(view(a), view(b));
  assert.equal(Object.keys(a.notes(S)).length, 3);
});

test('random edits on two devices, exported both ways in random order, always converge', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = rng(seed);
    const a = linked(10 + seed, { [uuid(1)]: note('seed') });
    const b = new MemoryStore(100 + seed);
    await imp(b, await exp(a));
    for (let round = 0; round < 3; round++) {
      for (const dev of [a, b]) {
        for (let k = Math.floor(r() * 4); k >= 0; k--) {
          const u = uuid(1 + Math.floor(r() * 5));
          if (r() < 0.2 && dev.notes(S)[u]) dev.erase(S, u);
          else if (!dev.erasedSet(S).includes(u)) dev.edit(S, u, note(`t${Math.floor(r() * 1e6)}`, `body ${Math.floor(r() * 1e6)}`));
        }
      }
      if (r() < 0.5) { await imp(b, await exp(a)); await imp(a, await exp(b)); } else { await imp(a, await exp(b)); await imp(b, await exp(a)); }
      assert.equal(view(a), view(b), `seed ${seed} round ${round}`);
      assert.deepEqual(a.erasedSet(S), b.erasedSet(S), `erased, seed ${seed} round ${round}`);
    }
  }
});

test('an erased note stays erased on import, and a note missing from the file is not erased', async () => {
  const a = linked(1, { [uuid(1)]: note('keep'), [uuid(2)]: note('erase me') });
  const b = new MemoryStore(2);
  await imp(b, await exp(a));
  b.edit(S, uuid(3), note('only on B'));
  a.erase(S, uuid(2));
  await imp(b, await exp(a));
  assert.equal(b.peek(S, uuid(2)), null);
  assert.ok(b.peek(S, uuid(3)), 'a note the file lacks stays');
  assert.ok(b.peek(S, uuid(1)));
  // the old file (before the erase) must not bring it back
  const c = linked(3, { [uuid(1)]: note('keep'), [uuid(2)]: note('erase me') });
  const oldFile = await exp(c);
  await imp(b, oldFile);
  assert.equal(b.peek(S, uuid(2)), null);
});

test('first import into a profile with notes joins identical notes and shows counts first; nothing is duplicated', async () => {
  const a = linked(1, { [uuid(1)]: note('Shared', 'same text'), [uuid(2)]: note('Only on A') });
  const b = new MemoryStore(2);
  b.plain.set(uuid(50), note('Shared', 'same text')); // other uuid, same content
  b.plain.set(uuid(51), note('Only on B'));
  const plan = await planImport(b, await exp(a), PASS, sha256);
  assert.equal(plan.kind, 'adopt');
  if (plan.kind !== 'adopt') return;
  assert.deepEqual([plan.localNotes, plan.fileNotes, plan.pairs.length], [2, 2, 1]);
  await runImport(b, plan);
  const titles = Object.values(b.notes(S)).map(n => n.title).sort();
  assert.deepEqual(titles, ['Only on A', 'Only on B', 'Shared']);
});

test('a profile linked to a different sync id is refused with a way out, and nothing changes', async () => {
  const a = linked(1, { [uuid(1)]: note('One') });
  const b = new MemoryStore(2);
  await b.createProfile('22222222-2222-4222-8222-222222222222', 'Work');
  b.edit('22222222-2222-4222-8222-222222222222', uuid(9), note('Work note'));
  const plan = await planImport(b, await exp(a), PASS, sha256);
  assert.deepEqual(plan, { kind: 'otherProfile', fileName: 'Personal' });
  assert.deepEqual(Object.keys(b.notes('22222222-2222-4222-8222-222222222222')), [uuid(9)]);
});

test('a locked profile can neither export nor import', async () => {
  const a = linked(1, { [uuid(1)]: note('One') });
  const file = await exp(a);
  const locked = new MemoryStore(2);
  locked.profiles = async () => [{ syncId: S, name: 'Work', notes: 0, protected: true, locked: true }];
  await assert.rejects(exp(locked), (e: unknown) => e instanceof SyncFileFlowError && e.reason === 'locked');
  await assert.rejects(planImport(locked, file, PASS, sha256), (e: unknown) => e instanceof SyncFileFlowError && e.reason === 'locked');
});

test('a wrong passphrase imports nothing', async () => {
  const a = linked(1, { [uuid(1)]: note('One') });
  const b = new MemoryStore(2);
  await assert.rejects(planImport(b, await exp(a), 'nope', sha256), { reason: 'passphrase' });
  assert.equal((await b.profiles()).length, 0);
});
