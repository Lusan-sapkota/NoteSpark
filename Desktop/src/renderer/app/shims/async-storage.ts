// AsyncStorage for the desktop renderer: the settings file in the main process, so the desktop window and the web view
// share one set of settings (theme choice, reminders, drafts).
import { invoke } from '../bridge';

const settings = <T,>(op: string, key: string, value?: string) => invoke<T>('settings', { op, key, value });
export default {
  getItem: (key: string) => settings<string | null>('get', key),
  setItem: (key: string, value: string) => settings<void>('set', key, value),
  removeItem: (key: string) => settings<void>('remove', key),
};
