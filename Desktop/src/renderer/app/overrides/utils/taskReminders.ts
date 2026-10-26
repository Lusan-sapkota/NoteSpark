// Task reminders are fired by the main process (src/main/notify.ts), so they work with the window closed.
// This side only holds the chosen hour, which the main process reads from the same settings file.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const REMINDER_HOURS = [7, 8, 9, 12, 17, 20];
export const getReminderHour = async (): Promise<number> => {
  const hour = Number(await AsyncStorage.getItem('reminderHour').catch(() => null));
  return REMINDER_HOURS.includes(hour) ? hour : 9;
};
export const setReminderHour = (hour: number) => AsyncStorage.setItem('reminderHour', String(hour));
export const formatHour = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const syncTaskReminders = async (): Promise<void> => {};
