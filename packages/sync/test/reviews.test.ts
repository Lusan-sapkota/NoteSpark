import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { MAX_REVIEW_BYTES, type ReviewEntry, catalogUpdate, docFromUpdates, readCatalog, readReviewEntries } from '../src/index.ts';

const r = (id: string, over: Partial<ReviewEntry> = {}): ReviewEntry => ({ id, card: 'n1:q', at: 1000, on: '2026-11-01', grade: 'good', ...over });
const ids = (updates: Uint8Array[]) => readReviewEntries(updates).map(e => e.id).sort();

test('reviews written on two devices at the same time merge to all of them, in any order, any number of times', () => {
  const base = catalogUpdate([], 1, { live: ['n1'] })!;
  const a = catalogUpdate([base], 11, { reviews: [r('a1'), r('a2', { at: 2000 })] })!;
  const b = catalogUpdate([base], 22, { reviews: [r('b1', { grade: 'again' })] })!;
  for (const order of [[base, a, b], [base, b, a], [base, b, a, a, b], [a, b, base]]) assert.deepEqual(ids(order), ['a1', 'a2', 'b1']);
  assert.deepEqual([...readCatalog([base, a, b]).known], ['n1'], 'the note list is unaffected');
});

test('a record is never rewritten: writing the same id again changes nothing', () => {
  const first = catalogUpdate([], 1, { reviews: [r('x', { grade: 'good' })] })!;
  assert.equal(catalogUpdate([first], 1, { reviews: [r('x', { grade: 'again' })] }), null);
  assert.equal(readReviewEntries([first])[0].grade, 'good');
});

test('records that are not exactly records are skipped when read (they come from other devices)', () => {
  const doc = new Y.Doc();
  const m = doc.getMap<string>('reviews');
  m.set('ok', JSON.stringify(r('ok')));
  m.set('wrong-key', JSON.stringify(r('other')));
  m.set('no-grade', JSON.stringify({ id: 'no-grade', card: 'c', at: 1, on: '2026-11-01' }));
  m.set('bad-day', JSON.stringify(r('bad-day', { on: 'tomorrow' })));
  m.set('bad-grade', JSON.stringify(r('bad-grade', { grade: 'perfect' as never })));
  m.set('bad-state', JSON.stringify({ id: 'bad-state', card: 'c', at: 0, on: '2026-11-01', state: { due: 'x', interval: 1, ease: 2, reps: 1, lapses: 0 } }));
  m.set('huge', JSON.stringify(r('huge', { card: 'c'.repeat(MAX_REVIEW_BYTES) })));
  m.set('junk', '{not json');
  m.set('not-text', 5 as never);
  m.set('seed', JSON.stringify({ id: 'seed', card: 'c', at: 0, on: '2026-11-01', state: { due: '2026-11-09', interval: 7, ease: 2.5, reps: 2, lapses: 0 } }));
  assert.deepEqual(readReviewEntries([Y.encodeStateAsUpdate(doc)]).map(e => e.id).sort(), ['ok', 'seed']);
});

test('an oversized record is not written at all', () => {
  assert.equal(catalogUpdate([], 1, { reviews: [r('big', { card: 'c'.repeat(MAX_REVIEW_BYTES) })] }), null);
});

test('reviews survive compaction of the catalog', () => {
  const updates = [catalogUpdate([], 1, { live: ['n1'] })!];
  for (let i = 0; i < 30; i++) updates.push(catalogUpdate(updates, 1, { reviews: [r(`r${i}`, { at: i })] })!);
  const merged = Y.encodeStateAsUpdate(docFromUpdates(updates));
  assert.equal(readReviewEntries([merged]).length, 30);
});
