import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staleBackups } from '../src/backupFiles.ts';

const f = (name: string, id: string, date: string, extra = '') => `content://x/tree/Docs%2F${encodeURIComponent(`notespark-${name}-${id}-${date}${extra}.json`)}`;

test('keeps the newest files, handles Android " (1)", survives a rename, ignores other profiles and other files', () => {
  const uris = [
    f('Work', 'abc1', '2026-11-01-0900'),
    f('Work', 'abc1', '2026-11-02-0900', ' (1)'),
    f('Renamed', 'abc1', '2026-11-03-0900'),
    f('Work', 'abc1', '2026-11-04-0900'),
    f('Other', 'zzz9', '2026-10-01-0900'),
    'content://x/tree/Docs%2Fholiday.json',
  ];
  const stale = staleBackups(uris, 'abc1', 2);
  assert.deepEqual(stale, [uris[1], uris[0]]);
  assert.deepEqual(staleBackups(uris, 'abc1', 4), []);
});
