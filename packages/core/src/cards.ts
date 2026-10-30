import { addDays } from './tasks';

// Review cards: a line "Capital of Nepal ?? Kathmandu" in any note is a card (question ?? answer, with spaces around the
// two question marks, so "What??" is just text). Cards are read from the notes each time; only the schedule is kept.
export interface Card {
  id: string; // note id and a hash of the question: editing the answer keeps the card's history
  noteId: number;
  noteTitle: string;
  question: string;
  answer: string;
}
export type Grade = 'again' | 'hard' | 'good' | 'easy';
export interface CardState {
  due: string; // YYYY-MM-DD
  interval: number; // days
  ease: number;
  reps: number;
  lapses: number;
}

const fence = /^\s*(```|~~~)/;
const cardLine = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?(.+?)\s+\?\?\s+(.+?)\s*$/;

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

export const extractCards = (note: { id: number; title: string; content: string }): Card[] => {
  const cards: Card[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const line of note.content.split('\n')) {
    if (fence.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = cardLine.exec(line);
    if (!m) continue;
    const question = m[1].trim();
    const id = `${note.id}:${hash(question.toLowerCase())}`;
    if (seen.has(id)) continue; // the same question twice in a note is one card
    seen.add(id);
    cards.push({ id, noteId: note.id, noteTitle: note.title, question, answer: m[2].trim() });
  }
  return cards;
};

// A simple SM-2: days between reviews grow by the card's ease; "again" starts over tomorrow.
export const schedule = (state: CardState | undefined, grade: Grade, today: string): CardState => {
  const s = state ?? { due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  let { interval, ease, reps, lapses } = s;
  if (grade === 'again') {
    reps = 0;
    lapses += 1;
    ease = Math.max(1.3, ease - 0.2);
    interval = 1;
  } else {
    if (grade === 'hard') { ease = Math.max(1.3, ease - 0.15); interval = Math.max(1, Math.round(Math.max(interval, 1) * 1.2)); }
    else if (grade === 'good') interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease);
    else { ease += 0.15; interval = reps === 0 ? 3 : reps === 1 ? 7 : Math.round(interval * ease * 1.3); }
    reps += 1;
  }
  return { due: addDays(interval, today), interval, ease, reps, lapses };
};

// The days each answer would give, for the buttons.
export const intervalPreview = (state: CardState | undefined, today: string): Record<Grade, number> => ({
  again: schedule(state, 'again', today).interval,
  hard: schedule(state, 'hard', today).interval,
  good: schedule(state, 'good', today).interval,
  easy: schedule(state, 'easy', today).interval,
});

// Today's session: cards that are due, oldest first, then new ones up to `newLimit`; at most `max` in all.
export const dueCards = (cards: Card[], states: Record<string, CardState>, today: string, newLimit = 10, max = 30): Card[] => {
  const due = cards.filter(c => states[c.id] && states[c.id].due <= today).sort((a, b) => states[a.id].due.localeCompare(states[b.id].due) || a.id.localeCompare(b.id));
  const fresh = cards.filter(c => !states[c.id]).slice(0, newLimit);
  return [...due, ...fresh].slice(0, max);
};
