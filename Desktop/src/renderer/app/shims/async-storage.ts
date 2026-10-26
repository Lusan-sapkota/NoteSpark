// AsyncStorage backed by the main process settings file, shared by the window and the web view.
import { invoke } from '../bridge';

const settings = <T,>(op: string, key: string, value?: string) => invoke<T>('settings', { op, key, value });
export default {
  getItem: (key: string) => settings<string | null>('get', key),
  setItem: (key: string, value: string) => settings<void>('set', key, value),
  removeItem: (key: string) => settings<void>('remove', key),
};
