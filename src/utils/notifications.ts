import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function setupNotificationWorker() {
  if (Platform.OS !== 'web') {
    await Notifications.requestPermissionsAsync();
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
}

export async function sendAppNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      // Show app logo for Android notifications
      icon: Platform.OS === 'android' ? require('../../assets/icon.png') : undefined,
    },
    trigger: null,
  });
}
