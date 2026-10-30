// Reminders fire from src/main/notify.ts; this side only stores the chosen hour.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLanguage } from '@notespark/core';

export const REMINDER_HOURS = [7, 8, 9, 12, 17, 20];
export const getReminderHour = async (): Promise<number> => {
  const hour = Number(await AsyncStorage.getItem('reminderHour').catch(() => null));
  return REMINDER_HOURS.includes(hour) ? hour : 9;
};
export const setReminderHour = (hour: number) => AsyncStorage.setItem('reminderHour', String(hour));
export const formatHour = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(getLanguage(), { hour: 'numeric', minute: '2-digit' });
export const syncTaskReminders = async (): Promise<void> => {};
