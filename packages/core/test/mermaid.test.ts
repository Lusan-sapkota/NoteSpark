import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMermaidFence, mermaidMistake } from '../src/mermaid.ts';

test('isMermaidFence matches the language in any case and with spacing', () => {
  for (const info of ['mermaid', 'Mermaid', 'MERMAID', '  mermaid  ', 'mermaid title=x']) assert.equal(isMermaidFence(info), true, info);
  for (const info of ['', undefined, 'mermaidjs', 'js', 'not mermaid', 'mermaid-sequence']) assert.equal(isMermaidFence(info), false, String(info));
});

test('mermaidMistake keeps only the first non-empty line', () => {
  assert.equal(mermaidMistake(new Error('\nParse error on line 2:\n  A-->\nExpecting X')), 'Parse error on line 2:');
  assert.equal(mermaidMistake('plain failure'), 'plain failure');
  assert.equal(mermaidMistake(undefined), 'Unknown error');
  assert.equal(mermaidMistake(new Error('  ')), 'Unknown error');
});
