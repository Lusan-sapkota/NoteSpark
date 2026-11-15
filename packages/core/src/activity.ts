import { extractTags } from './tags';

// Numbers for the two extra sections of the notebook landscape. They need no search model, only the notes.
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface WritingDay { date: string; count: number } // count: notes created or edited that day
export interface WritingDays {
  weeks: (WritingDay | null)[][]; // oldest week first, 7 days each, Sunday first; null: a day after today
  activeDays: number;
  totalDays: number; // days from the first to the last cell, up to today
}

// The last `weeks` weeks ending with the week of `now`, in the device's time zone.
export const writingDays = (notes: { createdAt: string; updatedAt: string }[], now: Date, weeks = 12): WritingDays => {
  const perDay = new Map<string, number>();
  for (const n of notes) {
    // A note counts once per day, even when it was created and edited the same day.
    for (const day of new Set([n.createdAt, n.updatedAt].map(iso => key(new Date(iso))))) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - 7 * (weeks - 1));
  let activeDays = 0;
  let totalDays = 0;
  const grid = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
    if (day > today) return null;
    const count = perDay.get(key(day)) ?? 0;
    totalDays++;
    if (count) activeDays++;
    return { date: key(day), count };
  }));
  return { weeks: grid, activeDays, totalDays };
};

// The tags used by the most notes, most used first; ties by name. Archived notes are left out, as on Home.
export const topTags = (notes: { content: string; isArchived: boolean }[], limit = 10): { tag: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const n of notes) if (!n.isArchived) for (const tag of extractTags(n.content)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit);
};
