// Reminders for tasks with a due date: one per profile and day, at the chosen hour on the due date. Pure, so the phone
// schedules them as notifications and the desktop fires them from its main process.
import { extractTasks } from './tasks';
import { Note } from './types';

// The phone keeps this well under Android's limit on scheduled alarms.
const DAYS_AHEAD = 30;
export const REMINDER_ID_PREFIX = 'task-';

export interface Reminder {
  id: string;
  date: Date;
  title: string;
  body: string;
}

export interface ProfileTasks {
  id: string;
  name: string;
  locked: boolean; // has a PIN: the reminder doesn't show the task text
  notes: Note[];
}

const list = (texts: string[]) =>
  texts.length <= 3 ? texts.join(', ') : `${texts.slice(0, 3).join(', ')} and ${texts.length - 3} more`;

export const buildReminders = (profiles: ProfileTasks[], hour = 9, now = new Date()): Reminder[] => {
  const latest = now.getTime() + DAYS_AHEAD * 86400000;
  const reminders: Reminder[] = [];
  for (const profile of profiles) {
    const byDay = new Map<string, string[]>();
    profile.notes
      .filter(n => !n.isArchived)
      .flatMap(n => extractTasks(n))
      .forEach(t => t.due && byDay.set(t.due, [...(byDay.get(t.due) ?? []), t.text]));
    for (const [due, texts] of byDay) {
      const date = new Date(`${due}T${String(hour).padStart(2, '0')}:00`);
      if (isNaN(date.getTime()) || date.getTime() <= now.getTime() || date.getTime() > latest) continue;
      const where = profiles.length > 1 ? ` in ${profile.name}` : '';
      reminders.push({
        id: `${REMINDER_ID_PREFIX}${profile.id}-${due}`,
        date,
        title: `${texts.length === 1 ? 'A task is' : `${texts.length} tasks are`} due today${where}`,
        body: profile.locked ? 'Open NoteSpark to see it.' : list(texts),
      });
    }
  }
  return reminders;
};
