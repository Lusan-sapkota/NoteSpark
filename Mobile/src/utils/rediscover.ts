import AsyncStorage from '@react-native-async-storage/async-storage';
import { Note } from '../types';
import { relatedNotes } from '../storage/semanticSearch';
import { linksTo } from '@notespark/core';
import { today } from '@notespark/core';

// "Rediscover" on Home: one older note a day; on unless switched off in Settings.
const OFF_KEY = 'rediscoverOff';
const HIDDEN_KEY = 'rediscoverHidden'; // the YYYY-MM-DD it was hidden on

export const isRediscoverOn = async () => (await AsyncStorage.getItem(OFF_KEY).catch(() => null)) !== 'true';
export const setRediscoverOn = (on: boolean) => (on ? AsyncStorage.removeItem(OFF_KEY) : AsyncStorage.setItem(OFF_KEY, 'true'));
export const isRediscoverHiddenToday = async () => (await AsyncStorage.getItem(HIDDEN_KEY).catch(() => null)) === today();
export const hideRediscoverToday = () => AsyncStorage.setItem(HIDDEN_KEY, today());

export interface Rediscovery {
  note: Note;
  reason: string;
}

const DAY_MS = 86400000;

// Notes written on this day in an earlier year; the same pick all day.
export const onThisDay = (notes: Note[], now = new Date()): Rediscovery | null => {
  const matches = notes.filter(n => {
    const d = new Date(n.createdAt);
    return !n.isArchived && d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
  });
  if (!matches.length) return null;
  const note = matches[Math.floor(now.getTime() / DAY_MS) % matches.length];
  const years = now.getFullYear() - new Date(note.createdAt).getFullYear();
  return { note, reason: `Written ${years === 1 ? 'a year' : `${years} years`} ago today` };
};

// Else, with search by meaning: a month-old note close to one edited this week and not linked to it.
export const pickRediscovery = async (notes: Note[], now = new Date()): Promise<Rediscovery | null> => {
  const dated = onThisDay(notes, now);
  if (dated) return dated;
  const byId = new Map(notes.map(n => [n.id, n]));
  const recent = notes
    .filter(n => !n.isArchived && now.getTime() - Date.parse(n.updatedAt) < 7 * DAY_MS)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  for (const fresh of recent) {
    for (const id of await relatedNotes(fresh.id)) {
      const old = byId.get(id);
      if (
        old &&
        !old.isArchived &&
        now.getTime() - Date.parse(old.updatedAt) > 30 * DAY_MS &&
        !linksTo(fresh.content, old.title) &&
        !linksTo(old.content, fresh.title)
      ) {
        return { note: old, reason: `Close to "${fresh.title}", which you edited this week` };
      }
    }
  }
  return null;
};
