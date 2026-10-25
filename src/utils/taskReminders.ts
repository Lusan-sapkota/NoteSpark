// Reminders for tasks with a due date: one notification per profile and day, at REMIND_HOUR on the due date.
// Scheduled on the phone (no push); recomputed from the notes whenever Home loads.
import { Notifications } from './notifications';
import { extractTasks } from './tasks';
import { getProfiles, hasProfilePin, readProfileNotes } from '../storage/profiles';
import { Note } from '../types';

export const REMIND_HOUR = 9;
const DAYS_AHEAD = 30; // keeps well under Android's limit on scheduled alarms
const ID_PREFIX = 'task-';

export interface Reminder {
  id: string;
  date: Date;
  title: string;
  body: string;
}

interface ProfileTasks {
  id: string;
  name: string;
  locked: boolean; // has a PIN: the reminder doesn't show the task text
  notes: Note[];
}

const list = (texts: string[]) =>
  texts.length <= 3 ? texts.join(', ') : `${texts.slice(0, 3).join(', ')} and ${texts.length - 3} more`;

export const buildReminders = (profiles: ProfileTasks[], now = new Date()): Reminder[] => {
  const latest = now.getTime() + DAYS_AHEAD * 86400000;
  const reminders: Reminder[] = [];
  for (const profile of profiles) {
    const byDay = new Map<string, string[]>();
    profile.notes
      .filter(n => !n.isArchived)
      .flatMap(extractTasks)
      .forEach(t => t.due && byDay.set(t.due, [...(byDay.get(t.due) ?? []), t.text]));
    for (const [due, texts] of byDay) {
      const date = new Date(`${due}T${String(REMIND_HOUR).padStart(2, '0')}:00`);
      if (isNaN(date.getTime()) || date.getTime() <= now.getTime() || date.getTime() > latest) continue;
      const where = profiles.length > 1 ? ` in ${profile.name}` : '';
      reminders.push({
        id: `${ID_PREFIX}${profile.id}-${due}`,
        date,
        title: `${texts.length === 1 ? 'A task is' : `${texts.length} tasks are`} due today${where}`,
        body: profile.locked ? 'Open NoteSpark to see it.' : list(texts),
      });
    }
  }
  return reminders;
};

let lastScheduled = '';

export const syncTaskReminders = async (): Promise<void> => {
  if (!Notifications) return;
  const profiles: ProfileTasks[] = await Promise.all(
    (await getProfiles()).map(async p => ({
      id: p.id,
      name: p.name,
      locked: await hasProfilePin(p.id),
      notes: await readProfileNotes(p.id),
    }))
  );
  const reminders = buildReminders(profiles);
  const key = JSON.stringify(reminders.map(r => [r.id, r.date.getTime(), r.title, r.body]));
  if (key === lastScheduled) return;
  for (const request of await Notifications.getAllScheduledNotificationsAsync()) {
    if (request.identifier.startsWith(ID_PREFIX)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
  for (const r of reminders) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { screen: 'Tasks' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.date },
    });
  }
  lastScheduled = key;
};
