import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, CardState, Grade, Review, dueCards, extractCards, foldReviews, schedule, today } from '@notespark/core';
import { addReviews, getNotes, getReviewData, getScratchpadNote } from '../storage/notes';
import { getActiveProfile } from '../storage/profiles';
import { Note } from '../types';

// Review cards live in the notes. Each card's schedule is replayed from review records (core `foldReviews`): while sync is on
// for the profile the records are in the synced catalog, so every device and the hub share them (S1); otherwise the schedule
// stays on this device. A card is named by its note's uuid and a hash of its question, the same on every device.
// ponytail: a card deleted from its note leaves its records behind; prune if it ever matters.
const key = (profileId: string) => `cards:${profileId}`;
const cardsOf = (notes: Note[]) => notes.filter(n => !n.isArchived).flatMap(extractCards);

const readLocal = async (profileId: string): Promise<Record<string, CardState>> => {
  try { return JSON.parse((await AsyncStorage.getItem(key(profileId))) ?? '{}'); } catch { return {}; }
};

// Before uuids, cards were named by the note's local number. Rename those once, so they match on every device.
const byUuid = (local: Record<string, CardState>, notes: Note[]): Record<string, CardState> => {
  const uuidOf = new Map(notes.filter(n => n.uuid).map(n => [String(n.id), n.uuid!]));
  const out: Record<string, CardState> = {};
  for (const [card, state] of Object.entries(local)) {
    const [head, ...rest] = card.split(':');
    out[/^\d+$/.test(head) && uuidOf.has(head) ? `${uuidOf.get(head)}:${rest.join(':')}` : card] = state;
  }
  return out;
};

const reviewId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface ReviewSession {
  profileId: string;
  synced: boolean;
  reviews: Review[]; // records so far when synced
  states: Record<string, CardState>;
  total: number; // cards in the notebook
  queue: Card[]; // today's cards
  nextDue: string | null; // when the next card comes due, if none is due now
}

// Schedules for this profile; moves schedules kept before sync was on into the synced records, once.
const loadStates = async (profileId: string, notes: Note[]) => {
  const { synced, reviews } = await getReviewData();
  const local = byUuid(await readLocal(profileId), notes);
  if (!synced) {
    await AsyncStorage.setItem(key(profileId), JSON.stringify(local));
    return { synced, reviews: [] as Review[], states: local };
  }
  const have = new Set(reviews.map(r => r.id));
  const seeds: Review[] = Object.entries(local).map(([card, state]) => ({ id: `seed:${card}`, card, at: 0, on: today(), state })).filter(r => !have.has(r.id));
  if (seeds.length) await addReviews(seeds);
  if (Object.keys(local).length) await AsyncStorage.removeItem(key(profileId)); // now in the records
  const all: Review[] = [...reviews, ...seeds];
  return { synced, reviews: all, states: foldReviews(all) };
};

export const loadReviewSession = async (): Promise<ReviewSession> => {
  const [profile, notes, pad] = await Promise.all([getActiveProfile(), getNotes(), getScratchpadNote().catch(() => null)]);
  const all = pad ? [...notes, pad] : notes;
  const { synced, reviews, states } = await loadStates(profile.id, all);
  const cards = cardsOf(all);
  const now = today();
  const queue = dueCards(cards, states, now);
  const later = cards.map(c => states[c.id]?.due).filter((d): d is string => !!d && d > now).sort();
  return { profileId: profile.id, synced, reviews, states, total: cards.length, queue, nextDue: queue.length ? null : later[0] ?? null };
};

export const gradeCard = async (session: ReviewSession, card: Card, grade: Grade): Promise<void> => {
  if (session.synced) {
    const record: Review = { id: reviewId(), card: card.id, at: Date.now(), on: today(), grade };
    await addReviews([record]);
    session.reviews.push(record);
    session.states[card.id] = foldReviews(session.reviews)[card.id];
  } else {
    session.states[card.id] = schedule(session.states[card.id], grade, today());
    await AsyncStorage.setItem(key(session.profileId), JSON.stringify(session.states));
  }
};

// How many cards are due now, for the Home menu; reads only what Home already loaded.
export const dueCardCount = async (notes: Note[]): Promise<number> => {
  const cards = cardsOf(notes);
  if (!cards.length) return 0;
  const profile = await getActiveProfile();
  return dueCards(cards, (await loadStates(profile.id, notes)).states, today()).length;
};
