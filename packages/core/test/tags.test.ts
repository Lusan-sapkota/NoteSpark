import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTags } from '../src/tags.ts';

test('suggests the tags close notes use most, leaving out the ones the note has', () => {
  const related = ['#recipes #dinner', 'x #recipes', 'y #Dinner #baking', 'z #own'];
  assert.deepEqual(suggestTags(['own'], related), ['dinner', 'recipes', 'baking']);
  assert.deepEqual(suggestTags(['recipes'], related, 1), ['dinner']);
  assert.deepEqual(suggestTags([], []), []);
});
