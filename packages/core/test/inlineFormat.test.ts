import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormatted } from '../src/inlineFormat.ts';

const join = (s: string) => parseFormatted(s).map(t => t.text).join('');

test('the tokens always add up to the original text', () => {
  for (const s of ['', 'plain', '**bold** and _it_ and ~~gone~~', '# H1\n## H2\n#### no\n', '**a _b_ c**', '** no**', 'snake_case_word', '****', '_a', 'a_ b_', '2 * 3 ** 4', '\n\n', '~~x~~~~y~~']) {
    assert.equal(join(s), s);
  }
});

test('marks style the text between them and are tokens of their own', () => {
  assert.deepEqual(parseFormatted('a **b** c'), [{ text: 'a ' }, { text: '**', marker: true }, { text: 'b', bold: true }, { text: '**', marker: true }, { text: ' c' }]);
  const nested = parseFormatted('**a _b_**').filter(t => !t.marker);
  assert.deepEqual(nested.map(t => [t.text, !!t.bold, !!t.italic]), [['a ', true, false], ['b', true, true]]);
});

test('a mark needs text right next to it, and _ needs a word edge', () => {
  assert.ok(parseFormatted('** not bold **').every(t => !t.bold && !t.marker));
  assert.ok(parseFormatted('snake_case_name').every(t => !t.italic && !t.marker));
  assert.ok(parseFormatted('2 * 3 * 4').every(t => !t.italic && !t.bold));
});

test('headings of level 1 to 3 style the rest of the line', () => {
  const t = parseFormatted('## Title **x**\ntext');
  assert.deepEqual(t[0], { text: '## ', heading: 2, marker: true });
  assert.ok(t.filter(x => x.text === 'x').every(x => x.heading === 2 && x.bold));
  assert.ok(parseFormatted('#### four').every(x => !x.heading));
  assert.ok(parseFormatted('#nospace').every(x => !x.heading));
});
