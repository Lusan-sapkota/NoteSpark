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
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
}

export async function sendAppNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      // You can customize other supported properties here
    },
    trigger: null,
  });
}
