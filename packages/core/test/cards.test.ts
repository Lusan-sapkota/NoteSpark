import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueCards, extractCards, intervalPreview, schedule } from '../src/cards.ts';
import type { CardState } from '../src/cards.ts';

const note = (content: string, id = 1) => ({ id, title: 'Geography', content });

test('a card is "question ?? answer"; "What??" and code blocks are not cards', () => {
  const cards = extractCards(note('Capital of Nepal ?? Kathmandu\nWhat?? no way\n- Highest peak ?? Everest\n- [ ] Done ?? yes\n```\nfake ?? card\n```\n'));
  assert.deepEqual(cards.map(c => [c.question, c.answer]), [['Capital of Nepal', 'Kathmandu'], ['Highest peak', 'Everest'], ['Done', 'yes']]);
});

test('editing the answer keeps the card, editing the question makes a new one, a repeated question is one card', () => {
  const a = extractCards(note('Capital of Nepal ?? Kathmandu'))[0];
  assert.equal(extractCards(note('Capital of Nepal ?? Kathmandu, the city'))[0].id, a.id);
  assert.equal(extractCards(note('capital of nepal ?? x'))[0].id, a.id);
  assert.notEqual(extractCards(note('Capital of India ?? Delhi'))[0].id, a.id);
  assert.notEqual(extractCards(note('Capital of Nepal ?? Kathmandu', 2))[0].id, a.id);
  assert.equal(extractCards(note('Q ?? a\nQ ?? b')).length, 1);
});

test('good answers space reviews further apart, again starts over', () => {
  let s = schedule(undefined, 'good', '2026-11-01');
  assert.deepEqual([s.interval, s.due, s.reps], [1, '2026-11-02', 1]);
  s = schedule(s, 'good', '2026-11-02');
  assert.deepEqual([s.interval, s.due], [3, '2026-11-05']);
  s = schedule(s, 'good', '2026-11-05');
  assert.equal(s.interval, 8); // 3 x 2.5, rounded
  const lapsed = schedule(s, 'again', '2026-11-13');
  assert.deepEqual([lapsed.interval, lapsed.reps, lapsed.lapses], [1, 0, 1]);
  assert.ok(lapsed.ease < s.ease && lapsed.ease >= 1.3);
});

test('easy and hard move the interval the right way', () => {
  const base: CardState = { due: '2026-11-01', interval: 10, ease: 2.5, reps: 3, lapses: 0 };
  const p = intervalPreview(base, '2026-11-01');
  assert.ok(p.again < p.hard && p.hard < p.good && p.good < p.easy, JSON.stringify(p));
  assert.equal(schedule(undefined, 'easy', '2026-11-01').interval, 3);
});

test('a session: due cards oldest first, then new ones up to the limit', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map(q => extractCards(note(`${q} ?? x`, 7))[0]);
  const states: Record<string, CardState> = {
    [cards[0].id]: { due: '2026-11-03', interval: 1, ease: 2.5, reps: 1, lapses: 0 },
    [cards[1].id]: { due: '2026-10-30', interval: 1, ease: 2.5, reps: 1, lapses: 0 },
    [cards[2].id]: { due: '2026-12-01', interval: 9, ease: 2.5, reps: 4, lapses: 0 },
  };
  const today = dueCards(cards, states, '2026-11-03', 1);
  assert.deepEqual(today.map(c => c.question), ['b', 'a', 'd']);
  assert.equal(dueCards(cards, states, '2026-11-03', 10, 2).length, 2);
});

// Sync (S1): the schedule is replayed from review records, so every device computes the same one.
import { foldReviews, type Review } from '../src/cards.ts';

const rv = (id: string, at: number, grade: Review['grade'], card = 'n1:q', on = '2026-11-01'): Review => ({ id, card, at, on, grade });

test('a card is named by its note uuid when it has one, so devices agree; without one the number is used', () => {
  assert.equal(extractCards({ id: 7, uuid: 'abc', title: 'T', content: 'Q ?? A' })[0].id.startsWith('abc:'), true);
  assert.equal(extractCards({ id: 7, title: 'T', content: 'Q ?? A' })[0].id.startsWith('7:'), true);
  const [a, b] = [extractCards({ id: 1, uuid: 'abc', title: 'T', content: 'Q ?? A' })[0], extractCards({ id: 99, uuid: 'abc', title: 'T', content: 'Q ?? another answer' })[0]];
  assert.equal(a.id, b.id); // another device's number, an edited answer: the same card
});

test('replaying reviews gives the same schedule whatever order they arrive in', () => {
  const list = [rv('a', 1, 'good', 'c', '2026-11-01'), rv('b', 2, 'good', 'c', '2026-11-02'), rv('c', 3, 'again', 'c', '2026-11-05'), rv('d', 4, 'easy', 'c', '2026-11-06'), rv('e', 1, 'hard', 'd', '2026-11-01')];
  const want = foldReviews(list);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 200; i++) {
    const shuffled = [...list].sort(() => rnd() - 0.5);
    assert.deepEqual(foldReviews(shuffled), want);
  }
  // and it is the schedule of doing them one after the other
  let s: CardState | undefined;
  for (const [g, on] of [['good', '2026-11-01'], ['good', '2026-11-02'], ['again', '2026-11-05'], ['easy', '2026-11-06']] as const) s = schedule(s, g, on);
  assert.deepEqual(foldReviews(list).c, s);
});

test('two devices reviewing the same card both count, in time order, with ties broken by id', () => {
  const phone = rv('p', 10, 'good'), desk = rv('d', 20, 'good', 'n1:q', '2026-11-02');
  assert.equal(foldReviews([phone, desk])['n1:q'].reps, 2);
  const tie1 = foldReviews([rv('b', 5, 'again'), rv('a', 5, 'good')]), tie2 = foldReviews([rv('a', 5, 'good'), rv('b', 5, 'again')]);
  assert.deepEqual(tie1, tie2);
});

test('a starting schedule from before reviews were recorded is the base the later reviews build on; records with neither grade nor state are ignored', () => {
  const base: CardState = { due: '2026-11-10', interval: 20, ease: 2.2, reps: 5, lapses: 1 };
  const out = foldReviews([{ id: 'seed:c', card: 'c', at: 0, on: '2026-11-01', state: base }, rv('r', 100, 'good', 'c', '2026-11-10'), { id: 'x', card: 'z', at: 1, on: '2026-11-01' }]);
  assert.equal(out.c.reps, 6);
  assert.equal(out.c.interval, Math.round(20 * 2.2));
  assert.equal(out.z, undefined);
});
