import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSearch } from '../src/search.ts';

const notes = [1, 2, 3, 4, 5].map(id => ({ id }));
const byId = new Map(notes.map(n => [n.id, n]));

test('words first, meaning matches below without repeats, order kept', () => {
  const r = mergeSearch([notes[2], notes[0]], [0, 1, 3, 9, 4, 3].map(i => notes[i]?.id ?? 99), byId);
  assert.deepEqual(r.words.map(n => n.id), [3, 1]);
  assert.deepEqual(r.related.map(n => n.id), [2, 4, 5]);
});

test('no meaning result gives words only', () => {
  assert.deepEqual(mergeSearch([notes[0]], null, byId).related, []);
  assert.deepEqual(mergeSearch([notes[0]], [], byId).related, []);
});

test('ids outside the current filter are ignored', () => {
  assert.deepEqual(mergeSearch([], [1, 2], new Map([[2, notes[1]]])).related.map(n => n.id), [2]);
});
