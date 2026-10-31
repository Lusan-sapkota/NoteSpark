import AsyncStorage from '@react-native-async-storage/async-storage';

// "Show web images" in Settings: off until switched on, because loading one contacts the website the note names.
const KEY = 'webImages';

export const isWebImagesOn = async () => (await AsyncStorage.getItem(KEY).catch(() => null)) === 'true';
export const setWebImagesOn = (on: boolean) => (on ? AsyncStorage.setItem(KEY, 'true') : AsyncStorage.removeItem(KEY));
