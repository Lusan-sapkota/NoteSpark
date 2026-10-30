import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasConnections, noteMap } from '../src/noteMap.ts';

const none = { links: [], linkedFrom: [], mentionedIn: [], related: [] };

test('draws each kind of connection once, with the note itself first', () => {
  const text = noteMap('Trip', { links: ['Packing'], linkedFrom: ['Plans'], mentionedIn: ['Diary'], related: ['Packing', 'Maps'] });
  const lines = text.split('\n');
  assert.equal(lines[0], 'graph LR');
  assert.equal(lines[1], '  N0["Trip"]');
  assert.equal(lines.filter(l => l.includes('["Packing"]')).length, 1);
  assert.ok(lines.includes('  N0 -->|links to| N1'));
  assert.ok(lines.includes('  N2 -->|links to| N0'));
  assert.ok(lines.includes('  N3 -.->|mentions| N0'));
  assert.ok(lines.includes('  N0 -.-|close in meaning| N4'));
});

test('titles can not break out of the label', () => {
  const text = noteMap('A "quoted" <b>title</b> #1; x', { ...none, links: ['"]\nN9 --> N0 ["'] });
  for (const line of text.split('\n').slice(1)) assert.match(line, /^  N\d(\["[^"\n]*"\]| .*)$/);
  assert.ok(!text.includes('<'));
  assert.equal(noteMap('', none), 'graph LR\n  N0["Untitled note"]');
});

test('hasConnections', () => {
  assert.equal(hasConnections(none), false);
  assert.equal(hasConnections({ ...none, related: ['x'] }), true);
});
