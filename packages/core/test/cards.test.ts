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
