// One local notification per profile and day for tasks due then; recomputed whenever Home loads.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Notifications } from './notifications';
import { buildReminders, getLanguage, REMINDER_ID_PREFIX, type ProfileTasks } from '@notespark/core';
import { getProfiles, hasProfilePin, readProfileNotes } from '../storage/profiles';

const HOUR_KEY = 'reminderHour';
export const REMINDER_HOURS = [7, 8, 9, 12, 17, 20];

export const getReminderHour = async (): Promise<number> => {
  const hour = Number(await AsyncStorage.getItem(HOUR_KEY).catch(() => null));
  return REMINDER_HOURS.includes(hour) ? hour : 9;
};

export const setReminderHour = async (hour: number): Promise<void> => {
  await AsyncStorage.setItem(HOUR_KEY, String(hour));
  await syncTaskReminders();
};

export const formatHour = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(getLanguage(), { hour: 'numeric', minute: '2-digit' });
let lastScheduled = '';

export const syncTaskReminders = async (): Promise<void> => {
  if (!Notifications) return;
  const profiles: ProfileTasks[] = (
    await Promise.all(
      (await getProfiles()).map(async p => {
        try {
          return {
            id: p.id,
            name: p.name,
            locked: await hasProfilePin(p.id),
            notes: await readProfileNotes(p.id, { withScratchpad: true }),
          };
        } catch {
          return null;
        }
      })
    )
  ).filter((p): p is ProfileTasks => p !== null);
  const reminders = buildReminders(profiles, await getReminderHour());
  const key = JSON.stringify(reminders.map(r => [r.id, r.date.getTime(), r.title, r.body]));
  if (key === lastScheduled) return;
  for (const request of await Notifications.getAllScheduledNotificationsAsync()) {
    if (request.identifier.startsWith(REMINDER_ID_PREFIX)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
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
