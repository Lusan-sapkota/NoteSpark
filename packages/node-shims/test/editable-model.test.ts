import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutSpans, markToRemove, needsFinalBreak, toCss } from '../../../desktop/src/renderer/app/shims/editableModel.ts';

const pieces = [
  { text: '## ', css: { fontSize: 24 }, marker: true }, { text: 'Title', css: { fontSize: 24 } }, { text: '\n', css: {} },
  { text: 'body ', css: {} }, { text: '**', css: {}, marker: true }, { text: 'x', css: {} }, { text: '**', css: {}, marker: true }, { text: '\n', css: {} },
];

test('marks are hidden in Plain text and shown faded in Markdown', () => {
  assert.deepEqual(layoutSpans(pieces, { hideMarkers: true }).map(s => s.hidden), [true, false, false, false, true, false, true, false]);
  const markdown = layoutSpans(pieces, { hideMarkers: false });
  assert.ok(markdown.every(s => !s.hidden));
  assert.equal(markdown[0].css.opacity, '0.55');
  assert.equal(markdown[1].css.fontSize, '24px');
});

test('Backspace after a hidden mark and Delete before one remove the whole mark', () => {
  assert.deepEqual(markToRemove(pieces, 3, 'Backspace'), [0, 3], 'caret at the start of the heading text');
  assert.deepEqual(markToRemove(pieces, 0, 'Delete'), [0, 3]);
  assert.deepEqual(markToRemove(pieces, 16, 'Backspace'), [14, 16], 'caret right after the opening **');
  assert.equal(markToRemove(pieces, 17, 'Backspace'), null, 'at the end of the word: a normal delete of the letter');
  assert.deepEqual(markToRemove(pieces, 17, 'Delete'), [17, 19], 'caret at the end of the word, before the closing **');
  assert.equal(markToRemove(pieces, 4, 'Delete'), null);
});

test('style conversion and the final line break', () => {
  assert.deepEqual(toCss({ fontSize: 17, lineHeight: 28, fontWeight: '600', marginTop: 24, flexGrow: 1, textDecorationLine: 'line-through', color: undefined }), { fontSize: '17px', lineHeight: '28px', fontWeight: '600', marginTop: '24px', flexGrow: '1', textDecoration: 'line-through' });
  assert.equal(needsFinalBreak('a\n'), true);
  assert.equal(needsFinalBreak('a'), false);
});
