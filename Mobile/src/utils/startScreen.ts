import AsyncStorage from '@react-native-async-storage/async-storage';

// The screen the app opens on; Notes (Home) unless changed in Settings.
export type StartScreen = 'Home' | 'Tasks' | 'Scratchpad';
export const START_SCREENS: StartScreen[] = ['Home', 'Tasks', 'Scratchpad'];
export const startScreenLabel = (screen: StartScreen) => (screen === 'Home' ? 'Notes' : screen);

const KEY = 'startScreen';
export const getStartScreen = async (): Promise<StartScreen> => {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  return START_SCREENS.find(s => s === saved) ?? 'Home';
};
export const setStartScreen = (screen: StartScreen) => AsyncStorage.setItem(KEY, screen);
// Home stays underneath, so Back from Tasks or Scratchpad lands on Notes.
export const startRoutes = (screen: StartScreen) => (screen === 'Home' ? ['Home'] : ['Home', screen]);
