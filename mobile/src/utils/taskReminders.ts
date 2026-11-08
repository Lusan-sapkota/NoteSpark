// One local notification per profile and day for tasks due then; recomputed whenever Home loads.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Notifications } from './notifications';
import { buildReminders, getLanguage, REMINDER_ID_PREFIX, reminderMinutes, type ProfileTasks } from '@notespark/core';
import { getProfiles, hasProfilePin, readProfileNotes } from '../storage/profiles';

const TIME_KEY = 'reminderTime'; // minutes after midnight
const LEGACY_HOUR_KEY = 'reminderHour';

export const getReminderTime = async (): Promise<number> =>
  reminderMinutes(await AsyncStorage.getItem(TIME_KEY).catch(() => null), await AsyncStorage.getItem(LEGACY_HOUR_KEY).catch(() => null));

export const setReminderTime = async (minutes: number): Promise<void> => {
  await AsyncStorage.setItem(TIME_KEY, String(minutes));
  await syncTaskReminders();
};

export const formatTime = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(getLanguage(), { hour: 'numeric', minute: '2-digit' });
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
  const reminders = buildReminders(profiles, await getReminderTime());
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
