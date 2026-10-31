import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDueTasks, editTaskLine } from '../src/tasks.ts';

test('editTaskLine keeps marker, box and repeat, and sets or clears the date', () => {
  assert.equal(editTaskLine('  - [x] old due:2026-01-01 every:week', 'new', '2026-02-02'), '  - [x] new every:week due:2026-02-02');
  assert.equal(editTaskLine('1. [ ] old due:2026-01-01', 'new', null), '1. [ ] new');
  assert.equal(editTaskLine('- [ ] old every:week', 'new', null, 'month'), '- [ ] new every:month');
  assert.equal(editTaskLine('- [ ] old every:week', 'new', '2026-02-02', null), '- [ ] new due:2026-02-02');
  assert.equal(editTaskLine('not a task', 'x', null), 'not a task');
});

test('countDueTasks counts open tasks due today or earlier, in notes that are not archived', () => {
  const note = (content: string, isArchived = false) => ({ id: 1, title: 'n', content, isArchived, updatedAt: '2026-11-01T00:00:00Z' }) as never;
  const notes = [
    note('- [ ] late due:2026-10-30\n- [ ] today due:2026-11-01\n- [ ] later due:2026-11-02\n- [ ] no date\n- [x] done due:2026-10-01'),
    note('- [ ] archived due:2026-10-30', true),
    note('text\n```\n- [ ] in a code block due:2026-10-30\n```'),
  ];
  assert.equal(countDueTasks(notes, '2026-11-01'), 2);
  assert.equal(countDueTasks([], '2026-11-01'), 0);
});
