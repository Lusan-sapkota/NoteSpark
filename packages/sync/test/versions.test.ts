import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERSIONS_SYNCED, noteVersionsUpdate, versionsFromUpdates } from '../src/index.ts';

const v = (n: number, content = `text ${n}`) => ({ at: `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`, title: 't', content, isMarkdown: true });

test('versions are added once, merge from two devices, keep only the newest few and skip huge ones', () => {
  const a = noteVersionsUpdate([], 1, [v(1), v(2)]).update!;
  const again = noteVersionsUpdate([a], 1, [v(1)]);
  assert.equal(again.update, null, 'the same version twice is no change');
  const b = noteVersionsUpdate([a], 2, [v(3)]).update!;
  const c = noteVersionsUpdate([a], 3, [v(4)]).update!;
  assert.deepEqual(versionsFromUpdates([a, b, c]).map(x => x.at.slice(8, 10)).sort(), ['01', '02', '03', '04']);
  const many = noteVersionsUpdate([], 4, Array.from({ length: 15 }, (_, i) => v(i + 1))).update!;
  const kept = versionsFromUpdates([many]);
  assert.equal(kept.length, VERSIONS_SYNCED);
  assert.equal(kept.some(x => x.at.startsWith('2026-11-01')), false, 'the oldest went');
  assert.equal(noteVersionsUpdate([], 5, [v(1, 'x'.repeat(30_000))]).update, null, 'a huge version is not synced');
});
