// Tasks move to the end of another profile's scratchpad, and Undo puts them back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { database, freshProfile, notes, profiles } from './helpers.ts';

test('moving tasks takes their lines out of the notes, adds them to the other scratchpad, and undo reverses it', async () => {
  await freshProfile();
  const other = await profiles.addProfile('Other');
  const id = await notes.saveNote({ title: 'Plan', content: 'intro\n- [ ] one\nmid\n- [ ] two\nend', isMarkdown: true, createdAt: '', updatedAt: '' });
  const lines = [{ noteId: id, line: 1, raw: '- [ ] one' }, { noteId: id, line: 3, raw: '- [ ] two' }, { noteId: id, line: 2, raw: 'stale' }];
  const move = await profiles.transferTasksToProfile(lines, other.id);
  assert.equal(move.gone.length, 2, 'the stale line was not moved');
  assert.equal((await notes.getNoteById(id)).content, 'intro\nmid\nend');
  const conn = await database.openProfileConnection(other.id, { useNewConnection: true });
  try {
    assert.equal((await conn.getFirstAsync('SELECT content FROM scratchpad WHERE id = 1')).content, '- [ ] one\n- [ ] two\n');
  } finally { await conn.closeAsync(); }
  await profiles.undoTaskMove(move);
  assert.equal((await notes.getNoteById(id)).content, 'intro\n- [ ] one\nmid\n- [ ] two\nend');
  const again = await database.openProfileConnection(other.id, { useNewConnection: true });
  try {
    assert.equal((await again.getFirstAsync('SELECT content FROM scratchpad WHERE id = 1')).content, '');
  } finally { await again.closeAsync(); }
});
