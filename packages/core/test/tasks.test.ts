import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editTaskLine } from '../src/tasks.ts';

test('editTaskLine keeps marker, box and repeat, and sets or clears the date', () => {
  assert.equal(editTaskLine('  - [x] old due:2026-01-01 every:week', 'new', '2026-02-02'), '  - [x] new every:week due:2026-02-02');
  assert.equal(editTaskLine('1. [ ] old due:2026-01-01', 'new', null), '1. [ ] new');
  assert.equal(editTaskLine('not a task', 'x', null), 'not a task');
});
