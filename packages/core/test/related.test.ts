import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paragraphToMatch } from '../src/related.ts';

const long = (word: string) => Array(16).fill(word).join(' ');
const text = `${long('alpha')}\n\nshort one\n\n${long('gamma')}`;

test('picks the paragraph around the cursor', () => {
  assert.equal(paragraphToMatch(text, 3), long('alpha'));
  assert.equal(paragraphToMatch(text, text.length), long('gamma'));
  assert.equal(paragraphToMatch(text, text.indexOf('gamma') + 5), long('gamma'));
});

test('too short a paragraph gives nothing, and the word count is adjustable', () => {
  assert.equal(paragraphToMatch(text, text.indexOf('short') + 2), '');
  assert.equal(paragraphToMatch(text, text.indexOf('short') + 2, 2), 'short one');
  assert.equal(paragraphToMatch('', 0), '');
});
