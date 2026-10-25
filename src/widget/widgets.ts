import { isRunningInExpoGo } from 'expo';

// react-native-android-widget looks up its native module on import, which throws in Expo Go, so the widget code
// is only loaded outside it.
const load = () => (isRunningInExpoGo() ? null : (require('./pinnedNotesWidget') as typeof import('./pinnedNotesWidget')));

export const registerWidgets = () => load()?.register();

// Called after notes load on Home, so pins, edits and profile switches reach the widget.
export const updateWidgets = async () => load()?.update();
