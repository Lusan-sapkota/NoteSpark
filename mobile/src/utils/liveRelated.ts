import AsyncStorage from '@react-native-async-storage/async-storage';

// "Related notes while writing": off unless switched on in Settings, since it runs the search model as you type.
const KEY = 'liveRelatedOn';
export const isLiveRelatedOn = async () => (await AsyncStorage.getItem(KEY).catch(() => null)) === 'true';
export const setLiveRelatedOn = (on: boolean) => (on ? AsyncStorage.setItem(KEY, 'true') : AsyncStorage.removeItem(KEY));
