import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function setupNotificationWorker() {
  if (Platform.OS !== 'web') {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      console.log('Notification permission status:', status);
      if (status !== 'granted') {
        console.warn('Notification permission not granted. Notifications will not work.');
        return;
      }
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    } catch (err) {
      console.error('Notification setup error:', err);
    }
  }
}

export async function sendAppNotification(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // You can customize other supported properties here
      },
      trigger: null,
    });
    console.log('Notification scheduled:', title, body);
  } catch (err) {
    console.error('Failed to schedule notification:', err);
  }
}
