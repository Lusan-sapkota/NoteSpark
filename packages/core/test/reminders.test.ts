import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReminders, reminderMinutes } from '../src/reminders.ts';

test('the reminder time: saved minutes, else an older whole hour, else 9:00', () => {
  assert.equal(reminderMinutes('450', '20'), 450);
  assert.equal(reminderMinutes(null, '20'), 1200);
  assert.equal(reminderMinutes(null, null), 540);
  assert.equal(reminderMinutes('9999', 'x'), 540);
  assert.equal(reminderMinutes('0', null), 0);
});

test('a reminder fires at the chosen hour and minute', () => {
  const notes = [{ id: 1, title: 't', content: '- [ ] call @due(2030-01-05)', isMarkdown: true, isPinned: false, isArchived: false }] as never;
  const [r] = buildReminders([{ id: 'p', name: 'P', locked: false, notes }], 7 * 60 + 45, new Date('2030-01-01T00:00:00'));
  if (r) assert.equal(`${r.date.getHours()}:${r.date.getMinutes()}`, '7:45');
});
