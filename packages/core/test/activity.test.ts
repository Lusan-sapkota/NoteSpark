import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topTags, writingDays } from '../src/activity.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test('writing days: weeks end with the current week, future days are empty, a note counts once a day', () => {
  const now = new Date(2026, 10, 18, 9); // Wednesday 18 Nov 2026
  const r = writingDays([
    { createdAt: at(2026, 11, 18), updatedAt: at(2026, 11, 18, 15) }, // created and edited today: one
    { createdAt: at(2026, 11, 2), updatedAt: at(2026, 11, 16) },      // counts on both days
    { createdAt: at(2026, 1, 1), updatedAt: at(2026, 1, 1) },         // too old
  ], now);
  assert.equal(r.weeks.length, 12);
  assert.ok(r.weeks.every(w => w.length === 7));
  const last = r.weeks[11];
  assert.equal(last[3]?.date, '2026-11-18');
  assert.equal(last[3]?.count, 1);
  assert.equal(last[4], null); // Thursday is still to come
  assert.equal(last[1]?.count, 1); // Monday 16 Nov
  assert.equal(r.weeks[0][0]?.date, '2026-08-30'); // 11 weeks before Sunday 15 Nov
  assert.equal(r.activeDays, 3);
  assert.equal(r.totalDays, 11 * 7 + 4);
});

test('top tags: by notes using them, ties by name, archived and code-block tags ignored', () => {
  const r = topTags([
    { content: '#work #idea', isArchived: false },
    { content: '#work again #Idea', isArchived: false },
    { content: '#zeta', isArchived: false },
    { content: '#work #old', isArchived: true },
    { content: '```\n#fake\n```', isArchived: false },
  ], 3);
  assert.deepEqual(r, [{ tag: 'idea', count: 2 }, { tag: 'work', count: 2 }, { tag: 'zeta', count: 1 }]);
});
