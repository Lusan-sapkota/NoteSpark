import React, { useEffect, useState } from 'react';
import { NavigationContainer, StackActions } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { eraseForgottenProfile, getDefaultProfile, syncProfileEncryption, getAllProfilesNoteContents, hasProfilePin, purgeProfileBin, switchProfile } from './src/storage/profiles';
import { setupNotificationWorker } from './src/utils/notifications';
import { ActivityIndicator, AppState, Linking, View, StyleSheet, Button } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { sendAppNotification } from './src/utils/notifications';
import { useFonts } from 'expo-font';
import { fontFiles } from './src/theme/theme';
import { DialogProvider } from './src/components/DialogProvider';
import { pruneImageCache } from './src/utils/imageCache';
import ProfileUnlockScreen from './src/screens/ProfileUnlockScreen';
import { runAutoBackupIfDue } from './src/storage/autoBackup';
import { navigationRef as appNavigation } from './src/navigation/AppNavigator';
import { Notifications } from './src/utils/notifications';
import { useShareIntent } from 'expo-share-intent';
import * as QuickActions from 'expo-quick-actions';
import { isRunningInExpoGo } from 'expo';

const AppContent = () => {
  const { theme, isDarkMode } = useTheme();
  const navigationRef = React.useRef<any>(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [lockedProfile, setLockedProfile] = useState<{ id: string; name: string } | null>(null);
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  // Share to NoteSpark: opens a new note once the navigator (so an unlocked profile) is ready.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: isRunningInExpoGo() });
  const [navReady, setNavReady] = useState(false);
  useEffect(() => {
    if (!hasShareIntent || !navReady || !appNavigation.isReady()) return;
    const text = (shareIntent.text ?? '').trim();
    if (text) {
      const title = shareIntent.meta?.title?.trim() || text.split('\n')[0].slice(0, 60);
      // push, not navigate: an editor that's already open keeps what's being typed.
      appNavigation.dispatch(StackActions.push('Editor', { title, text }));
    }
    resetShareIntent();
  }, [hasShareIntent, navReady, shareIntent]);

  // Widget taps (notespark://new, notespark://note/<id>); expo-share-intent handles its own dataUrl links.
  const [widgetLink, setWidgetLink] = useState<string | null>(null);
  useEffect(() => {
    Linking.getInitialURL().then(url => url && setWidgetLink(url)).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => setWidgetLink(url));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!widgetLink || !navReady || !appNavigation.isReady()) return;
    const noteId = /^notespark:\/\/note\/(\d+)$/.exec(widgetLink)?.[1];
    if (widgetLink === 'notespark://new') appNavigation.dispatch(StackActions.push('Editor'));
    else if (noteId) appNavigation.dispatch(StackActions.push('NoteView', { noteId }));
    setWidgetLink(null);
  }, [widgetLink, navReady]);

  // Long-press the app icon: "New note". `initial` is the shortcut that launched the app, if any.
  const [quickAction, setQuickAction] = useState<QuickActions.Action | null>(QuickActions.initial ?? null);
  useEffect(() => {
    QuickActions.setItems([{ id: 'new-note', title: 'New note', icon: 'new_note' }]).catch(() => {});
    const sub = QuickActions.addListener(setQuickAction);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (quickAction?.id !== 'new-note' || !navReady || !appNavigation.isReady()) return;
    appNavigation.dispatch(StackActions.push('Editor'));
    setQuickAction(null);
  }, [quickAction, navReady]);

  const openDefaultProfile = async () => {
    const defaultProfile = await getDefaultProfile();
    if (await hasProfilePin(defaultProfile.id)) {
      setLockedProfile(defaultProfile);
    } else {
      await switchProfile(defaultProfile.id);
      setLockedProfile(null);
    }
  };

  useEffect(() => {
    const setupApp = async () => {
      try {
        await setupNotificationWorker();
        // Before any profile opens, so a protected profile's file isn't in use while it's converted.
        await syncProfileEncryption();
        await openDefaultProfile();
        await purgeProfileBin().catch(error => console.warn('Profile bin purge failed:', error));
        // Reads every profile's notes; waits so it doesn't compete with Home's first load.
        setTimeout(() => getAllProfilesNoteContents().then(pruneImageCache).catch(() => {}), 10000);
        runAutoBackupIfDue().catch(() => {});
        setDbInitialized(true);
        const onboarded = await AsyncStorage.getItem('onboarded');
        setShowOnboarding(onboarded !== 'true');
      } catch (error) {
        console.error('Failed to initialize database:', error);
      }
    };
    setupApp();
    // A due automatic backup also runs when the app comes back to the front.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') runAutoBackupIfDue().catch(() => {});
    });
    const tapped = Notifications?.addNotificationResponseReceivedListener(response => {
      if (response.notification.request.content.data?.screen === 'Tasks' && appNavigation.isReady()) appNavigation.navigate('Tasks');
    });
    return () => {
      sub.remove();
      tapped?.remove();
    };
  }, []);

  const handleFinishOnboarding = async () => {
    if (!showOnboarding) return;
    try {
      await AsyncStorage.setItem('onboarded', 'true');
      try {
        await sendAppNotification('Welcome to NoteSpark', 'Tap New note to write your first note.');
      } catch (notifErr) {
        console.error('Notification error:', notifErr);
      }
      setShowOnboarding(false);
      if (navigationRef.current) {
        navigationRef.current.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        });
      }
    } catch (err) {
      console.error('Onboarding finish error:', err);
      setShowOnboarding(false);
    }
  };

  const unlockDefaultProfile = async (pin: string): Promise<boolean> => {
    if (!lockedProfile) return false;
    try {
      await switchProfile(lockedProfile.id, pin);
      setLockedProfile(null);
      return true;
    } catch {
      return false;
    }
  };

  const eraseLockedProfile = async () => {
    if (!lockedProfile) return;
    await eraseForgottenProfile(lockedProfile.id);
    await openDefaultProfile();
  };

  // Font load failure falls back to the system font instead of blocking the app.
  const ready = dbInitialized && showOnboarding !== null && (fontsLoaded || !!fontError);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <PaperProvider theme={theme}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <DialogProvider>
          {!ready ? (
            <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : lockedProfile ? (
            <ProfileUnlockScreen profileId={lockedProfile.id} profileName={lockedProfile.name} onUnlock={unlockDefaultProfile} onForgotPin={eraseLockedProfile} />
          ) : showOnboarding ? (
            <OnboardingScreen onFinish={handleFinishOnboarding} />
          ) : (
            <AppNavigator onReady={() => setNavReady(true)} />
          )}
        </DialogProvider>
      </PaperProvider>
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Keyboard avoidance is per screen (KeyboardAwareScrollView, KeyboardStickyView, KeyboardAvoidingView).
          Padding the whole app while the keyboard animates made the editor body lose focus. */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
