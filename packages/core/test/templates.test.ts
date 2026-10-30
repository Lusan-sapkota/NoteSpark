import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTaskLines } from '../src/tasks.ts';
import { isDayTitle, TEMPLATE_LABELS, templateNote } from '../src/templates.ts';

test('a daily note is titled by its date and has a task to fill in', () => {
  const note = templateNote('daily', '2026-11-03');
  assert.equal(note.title, '2026-11-03');
  assert.ok(isDayTitle(note.title));
  assert.equal(findTaskLines(note.content).length, 1);
});

test('meeting and checklist templates', () => {
  assert.equal(templateNote('meeting', '2026-11-03').title, 'Meeting 2026-11-03');
  assert.ok(templateNote('meeting', '2026-11-03').content.includes('## Action items'));
  assert.equal(findTaskLines(templateNote('checklist', '2026-11-03').content).length, 3);
});

test('translated labels are used', () => {
  const note = templateNote('meeting', '2026-11-03', { ...TEMPLATE_LABELS, meeting: 'Reunión', agenda: 'Orden del día' });
  assert.equal(note.title, 'Reunión 2026-11-03');
  assert.ok(note.content.includes('## Orden del día'));
});

test('isDayTitle only accepts a plain date', () => {
  assert.equal(isDayTitle(' 2026-11-03 '), true);
  for (const t of ['2026-1-3', 'Meeting 2026-11-03', '', '2026-11-03 notes']) assert.equal(isDayTitle(t), false, t);
});
