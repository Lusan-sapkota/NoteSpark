// Pure reminders for tasks with a due date: one per profile and day, at the chosen hour.
import { extractTasks } from './tasks';
import { t } from './i18n';
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
  texts.length <= 3 ? texts.join(', ') : t('core.reminderMore', { list: texts.slice(0, 3).join(', '), count: texts.length - 3 });

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
      reminders.push({
        id: `${REMINDER_ID_PREFIX}${profile.id}-${due}`,
        date,
        title: profiles.length > 1 ? t('core.reminderTitleIn', { count: texts.length, profile: profile.name }) : t('core.reminderTitle', { count: texts.length }),
        body: profile.locked ? t('core.reminderLocked') : list(texts),
      });
    }
  }
  return reminders;
};
