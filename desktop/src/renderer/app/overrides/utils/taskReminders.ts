// Reminders fire from src/main/notify.ts; this side only stores the chosen time (minutes after midnight).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLanguage, reminderMinutes } from '@notespark/core';

export const getReminderTime = async (): Promise<number> =>
  reminderMinutes(await AsyncStorage.getItem('reminderTime').catch(() => null), await AsyncStorage.getItem('reminderHour').catch(() => null));
export const setReminderTime = (minutes: number) => AsyncStorage.setItem('reminderTime', String(minutes));
export const formatTime = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(getLanguage(), { hour: 'numeric', minute: '2-digit' });
export const syncTaskReminders = async (): Promise<void> => {};
