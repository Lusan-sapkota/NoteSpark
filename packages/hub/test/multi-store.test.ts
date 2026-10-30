import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '@notespark/sync';
import { type ProfileSource, multiStore } from '../src/multiStore.ts';
import { U, note, sleep } from './support.ts';

const rig = async () => {
  const stores = { work: new MemoryStore(1), home: new MemoryStore(2) };
  await stores.work.createProfile('sw', 'x');
  await stores.home.createProfile('sh', 'x');
  const state = { synced: ['work', 'home'], unlocked: new Set<string>(['work']), opened: [] as string[], keyReads: 0, allowNew: false, adopted: [] as string[] };
  const source: ProfileSource = {
    synced: () => state.synced,
    describe: async id => ({ name: id === 'work' ? 'Work' : 'Home', isProtected: id === 'work', unlocked: state.unlocked.has(id) }),
    syncIdOf: async id => (id === 'work' ? 'sw' : 'sh'),
    open: async id => { state.opened.push(id); return (stores as any)[id] ?? null; },
    adopt: async (syncId, name) => { if (!state.allowNew) return null; state.adopted.push(syncId); const m = new MemoryStore(9); await m.createProfile(syncId, name); (stores as any)[syncId] = m; state.synced.push(syncId); return syncId; },
  };
  return { stores, state, ...multiStore(source) };
};

test('calls go to the profile that owns the sync id', async () => {
  const { stores, store } = await rig();
  stores.work.edit('sw', U(1), note('work note'));
  stores.home.edit('sh', U(2), note('home note'));
  assert.deepEqual(await store.docs('sw'), [U(1)]);
  assert.deepEqual(await store.docs('sh'), [U(2)]);
  assert.deepEqual((await store.profiles()).map(p => [p.syncId, p.name, p.protected, p.locked]), [['sw', 'Work', true, false], ['sh', 'Home', false, false]]);
  await assert.rejects(store.docs('nope'), /unknown profile/);
});

test('a protected profile that is locked is never opened: it reports locked, every call fails with LOCKED, and its listeners wait', async () => {
  const { stores, state, store, rebind } = await rig();
  stores.work.edit('sw', U(1), note('secret'));
  state.unlocked.delete('work');
  state.opened.length = 0;
  const info = (await store.profiles()).find(p => p.syncId === 'sw')!;
  assert.deepEqual([info.locked, info.protected, info.notes], [true, true, 0]);
  for (const call of [() => store.docs('sw'), () => store.stateVector('sw', U(1)), () => store.diff('sw', U(1), new Uint8Array([0])), () => store.apply('sw', U(1), []), () => store.note('sw', U(1)), () => store.allNotes('sw'), () => store.putBlob!('sw', 'a'.repeat(64), new Uint8Array(1))])
    await assert.rejects(call(), (e: any) => e.code === 'LOCKED');
  assert.ok(!state.opened.includes('work'), 'the locked profile was never opened');
  const seen: string[] = [];
  const off = store.subscribe('sw', doc => seen.push(doc));
  await sleep(10);
  stores.work.edit('sw', U(1), note('edit while locked'));
  assert.deepEqual(seen, []); // nothing is forwarded while locked
  state.unlocked.add('work');
  await rebind();
  stores.work.edit('sw', U(1), note('edit after unlock'));
  assert.ok(seen.length > 0);
  state.unlocked.delete('work');
  await rebind();
  const n = seen.length;
  stores.work.edit('sw', U(1), note('locked again'));
  assert.equal(seen.length, n);
  off();
});

test('a new profile from a device is made only when the switch allows it', async () => {
  const { state, store, stores } = await rig();
  await assert.rejects(store.createProfile('snew', 'Phone notes'), /does not accept new profiles/);
  state.allowNew = true;
  await store.createProfile('snew', 'Phone notes');
  await store.createProfile('snew', 'Phone notes'); // idempotent
  assert.deepEqual(state.adopted, ['snew']);
  assert.ok((await store.profiles()).some(p => p.syncId === 'snew'));
  assert.ok(stores);
});

test('rebind moves listeners to the new connection and unsubscribe stops them', async () => {
  const { stores, store, rebind } = await rig();
  const seen: string[] = [];
  const off = store.onNoteChange('sh', u => seen.push(u));
  await sleep(10);
  stores.home.edit('sh', U(5), note('a'));
  assert.deepEqual(seen, [U(5)]);
  await rebind();
  stores.home.edit('sh', U(5), note('b'));
  assert.deepEqual(seen, [U(5), U(5)]); // one listener, not two
  off();
  stores.home.edit('sh', U(5), note('c'));
  assert.equal(seen.length, 2);
});
