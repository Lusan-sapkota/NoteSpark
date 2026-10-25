import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

// Expo Go on Android doesn't ship native parts that expo-notifications loads on import
// (ExpoTopicSubscriptionModule), so importing it there crashes the app. Load it only outside
// Expo Go; there, notifications are skipped. Development and store builds are unaffected.
const Notifications: typeof import('expo-notifications') | null =
  Platform.OS === 'android' && isRunningInExpoGo() ? null : require('expo-notifications');

export async function setupNotificationWorker() {
  if (Notifications && Platform.OS !== 'web') {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      console.log('Notification permission status:', status);
      if (status !== 'granted') {
        console.warn('Notification permission not granted. Notifications will not work.');
        return;
      }
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
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
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
      },
      trigger: null,
    });
    console.log('Notification scheduled:', title, body);
  } catch (err) {
    console.error('Failed to schedule notification:', err);
  }
}
