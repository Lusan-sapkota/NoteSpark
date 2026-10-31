import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldReviews, type Review } from '@notespark/core';
import { World, note, uuid } from './harness.ts';

// Review records ride in the catalog doc, so the ordinary engine carries them between devices and through the hub (S1).
const rv = (id: string, at: number, grade: Review['grade'], on: string): Review => ({ id, card: `${uuid(1)}:q`, at, on, grade });
const ids = (s: { reviews(id: string): { id: string }[] }, syncId: string) => s.reviews(syncId).map(e => e.id).sort();

test('reviews made on two devices, one of them offline, reach every device and the hub, and everyone computes the same schedule', async () => {
  const w = new World();
  const a = w.device();
  a.store.plain.set(uuid(1), note('Cards', 'Q ?? A'));
  a.start({ link: { syncId: '', name: 'Personal' } });
  await w.run(5000);
  const syncId = a.client!.syncId!;
  const b = w.device();
  b.store.plain.set(uuid(9), note('Other'));
  b.start({ link: { syncId, name: 'Personal' } });
  await w.run(5000);

  a.store.addReviews(syncId, [rv('a1', 100, 'good', '2026-11-01')]);
  await w.run(2000);
  assert.deepEqual(ids(b.store, syncId), ['a1'], 'a live review arrives');

  b.online = false;
  b.client!.session?.close('offline');
  b.store.addReviews(syncId, [rv('b1', 300, 'good', '2026-11-03')]);
  a.store.addReviews(syncId, [rv('a2', 200, 'good', '2026-11-02')]);
  await w.run(2000);
  assert.deepEqual(ids(b.store, syncId), ['a1', 'b1'], 'nothing crosses while b is away');
  b.online = true;
  await w.run(120_000);
  for (const s of [a.store, b.store, w.hubStore]) assert.deepEqual(ids(s, syncId), ['a1', 'a2', 'b1']);
  const states = [a.store, b.store, w.hubStore].map(s => JSON.stringify(foldReviews(s.reviews(syncId) as Review[])));
  assert.equal(new Set(states).size, 1, 'the same schedule on every device and the hub');
  assert.equal(foldReviews(a.store.reviews(syncId) as Review[])[`${uuid(1)}:q`].reps, 3);
});
