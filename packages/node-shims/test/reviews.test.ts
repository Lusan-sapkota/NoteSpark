// Review card schedules (S1) on the phone's real storage: records in the synced catalog, and schedules kept before sync was on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import AsyncStorage from '../src/async-storage.ts';
import { crdt, database, freshProfile, notes, profiles, reopen, sample } from './helpers.ts';

const { questionHash } = await import('@notespark/core');
const rc = await import(new URL('../../../mobile/src/utils/reviewCards.ts', import.meta.url).href);
const withCard = (title: string, q: string) => notes.saveNote({ ...sample(title), content: `${q} ?? answer` });

test('on a synced profile a grade is one record in the catalog and the schedule survives a restart', async () => {
  const id = await freshProfile(true);
  await withCard('Cards', 'Capital of Nepal');
  const session = await rc.loadReviewSession();
  assert.equal(session.synced, true);
  assert.equal(session.queue.length, 1);
  assert.match(session.queue[0].id, /^[0-9a-f-]{36}:/, 'named by the note uuid, not its number');
  await rc.gradeCard(session, session.queue[0], 'good');
  const data = await notes.getReviewData();
  assert.deepEqual(data.reviews.map((r: any) => r.grade), ['good']);
  await reopen(id);
  const again = await rc.loadReviewSession();
  assert.equal(again.states[session.queue[0].id].reps, 1);
  assert.equal(again.queue.length, 0, 'reviewed today: nothing due');
});

test('without sync the schedule stays local and still works', async () => {
  await freshProfile(false);
  await withCard('Local', 'Highest peak');
  const s = await rc.loadReviewSession();
  assert.equal(s.synced, false);
  await rc.gradeCard(s, s.queue[0], 'easy');
  assert.equal((await notes.getReviewData()).reviews.length, 0);
  const next = await rc.loadReviewSession();
  assert.equal(next.states[s.queue[0].id].reps, 1);
});

test('a schedule kept before sync was on moves into the records once, under the note uuid', async () => {
  await freshProfile(false);
  await withCard('Old', 'Longest river');
  const note = (await notes.getNotes())[0];
  const active = (await profiles.getActiveProfile()).id;
  const old = { due: '2099-01-01', interval: 40, ease: 2.1, reps: 6, lapses: 2 };
  await AsyncStorage.setItem(`cards:${active}`, JSON.stringify({ [`${note.id}:${questionHash('Longest river')}`]: old })); // the old name: the note's number
  await crdt.enableSync(database.db);
  const first = await rc.loadReviewSession();
  const card = `${note.uuid}:${questionHash('Longest river')}`;
  assert.deepEqual(first.states[card], old);
  assert.equal(await AsyncStorage.getItem(`cards:${active}`), null, 'the local copy is gone');
  const records = (await notes.getReviewData()).reviews;
  assert.deepEqual(records.map((r: any) => r.id), [`seed:${card}`]);
  await rc.loadReviewSession(); // again: no second seed
  assert.equal((await notes.getReviewData()).reviews.length, 1);
});
