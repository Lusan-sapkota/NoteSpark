import { isRunningInExpoGo } from 'expo';

// The widget library throws on import in Expo Go, so it's only loaded outside it.
const load = () => (isRunningInExpoGo() ? null : (require('./pinnedNotesWidget') as typeof import('./pinnedNotesWidget')));

export const registerWidgets = () => load()?.register();

export const updateWidgets = async () => load()?.update();
