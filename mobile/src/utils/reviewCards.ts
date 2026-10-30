import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, CardState, dueCards, extractCards, Grade, schedule, today } from '@notespark/core';
import { getNotes, getScratchpadNote } from '../storage/notes';
import { getActiveProfile } from '../storage/profiles';
import { Note } from '../types';

// Review cards live in the notes; only each card's schedule is stored, per profile, on this device.
// ponytail: a card deleted from its note leaves its small schedule entry behind; prune if it ever matters.
const key = (profileId: string) => `cards:${profileId}`;
const readStates = async (profileId: string): Promise<Record<string, CardState>> => {
  try { return JSON.parse((await AsyncStorage.getItem(key(profileId))) ?? '{}'); } catch { return {}; }
};
const cardsOf = (notes: Note[]) => notes.filter(n => !n.isArchived).flatMap(extractCards);

export interface ReviewSession {
  profileId: string;
  states: Record<string, CardState>;
  total: number; // cards in the notebook
  queue: Card[]; // today's cards
  nextDue: string | null; // when the next card comes due, if none is due now
}

export const loadReviewSession = async (): Promise<ReviewSession> => {
  const [profile, notes, pad] = await Promise.all([getActiveProfile(), getNotes(), getScratchpadNote().catch(() => null)]);
  const states = await readStates(profile.id);
  const cards = cardsOf(pad ? [...notes, pad] : notes);
  const now = today();
  const queue = dueCards(cards, states, now);
  const later = cards.map(c => states[c.id]?.due).filter((d): d is string => !!d && d > now).sort();
  return { profileId: profile.id, states, total: cards.length, queue, nextDue: queue.length ? null : later[0] ?? null };
};

export const gradeCard = async (session: ReviewSession, card: Card, grade: Grade): Promise<void> => {
  session.states[card.id] = schedule(session.states[card.id], grade, today());
  await AsyncStorage.setItem(key(session.profileId), JSON.stringify(session.states));
};

// How many cards are due now, for the Home menu; reads only what Home already loaded.
export const dueCardCount = async (notes: Note[]): Promise<number> => {
  const cards = cardsOf(notes);
  if (!cards.length) return 0;
  const profile = await getActiveProfile();
  return dueCards(cards, await readStates(profile.id), today()).length;
};
