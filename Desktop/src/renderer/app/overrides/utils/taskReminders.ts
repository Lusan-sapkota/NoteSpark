// Task reminders are phone notifications; the desktop has none yet.
export const REMINDER_HOURS = [7, 8, 9, 12, 17, 20];
export const getReminderHour = async () => 9;
export const setReminderHour = async (_hour: number) => {};
export const formatHour = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const syncTaskReminders = async (): Promise<void> => {};
