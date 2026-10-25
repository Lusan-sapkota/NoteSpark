import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, StackActions } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Button, PaperProvider, Portal, Text } from 'react-native-paper';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { eraseForgottenProfile, getActiveProfile, getAutoLockMinutes, getDefaultProfile, syncProfileEncryption, getAllProfilesNoteContents, hasProfilePin, purgeProfileBin, switchProfile } from './src/storage/profiles';
import { setupNotificationWorker } from './src/utils/notifications';
import { ActivityIndicator, AppState, BackHandler, Linking, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { sendAppNotification } from './src/utils/notifications';
import { useFonts } from 'expo-font';
import { fontFiles, readingWidth, space } from './src/theme/theme';
import { DialogProvider, useAlert } from './src/components/DialogProvider';
import { pruneImageCache } from './src/utils/imageCache';
import ProfileUnlockScreen from './src/screens/ProfileUnlockScreen';
import { runAutoBackupIfDue } from './src/storage/autoBackup';
import { navigationRef as appNavigation } from './src/navigation/AppNavigator';
import { Notifications } from './src/utils/notifications';
import { useShareIntent } from 'expo-share-intent';
import * as QuickActions from 'expo-quick-actions';
import { isRunningInExpoGo } from 'expo';

const UnreadableProfileScreen = ({
  profileName,
  onRetry,
  onErase,
}: {
  profileName: string;
  onRetry: () => Promise<void>;
  onErase: () => Promise<void>;
}) => {
  const { theme } = useTheme();
  const alert = useAlert();
  const confirmErase = () => {
    alert(
      'Erase this profile?',
      `To use NoteSpark again, ${profileName} and all its notes will be erased from this device. Your other profiles stay as they are. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase profile',
          style: 'destructive',
          onPress: () => onErase().catch(() => alert("Couldn't erase the profile", 'Restart the app and try again.')),
        },
      ]
    );
  };
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View style={styles.errorColumn}>
        <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>
          Couldn't open {profileName}
        </Text>
        <Text variant="bodyLarge" style={[styles.errorBody, { color: theme.colors.onSurfaceVariant }]}>
          This profile's database couldn't be read. If this phone was restored from a backup, a locked profile's encryption key isn't included in backups. You can try again, or erase this profile to use NoteSpark.
        </Text>
        <View style={styles.errorActions}>
          <Button mode="contained" onPress={() => onRetry().catch(() => {})}>
            Try again
          </Button>
          <Button onPress={confirmErase}>Erase profile</Button>
        </View>
      </View>
    </SafeAreaView>
  );
};

const AppContent = () => {
  const { theme, isDarkMode } = useTheme();
  const navigationRef = React.useRef<any>(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [lockedProfile, setLockedProfile] = useState<{ id: string; name: string } | null>(null);
  const [unreadableProfile, setUnreadableProfile] = useState<{ id: string; name: string } | null>(null);
  // A protected profile locked again after time in the background. Drawn over the open screens, so whatever
  // was on them (an unsaved note too) is still there after unlocking.
  const [relocked, setRelocked] = useState<{ id: string; name: string } | null>(null);
  const backgroundSince = useRef<number | null>(null);
  const lockState = useRef({ blocked: true, relocked: false });
  lockState.current = { blocked: !dbInitialized || !!lockedProfile || !!unreadableProfile, relocked: !!relocked };
  useEffect(() => {
    const sub = AppState.addEventListener('change', async state => {
      if (lockState.current.blocked || lockState.current.relocked) {
        backgroundSince.current = null;
        return;
      }
      if (state === 'background') {
        backgroundSince.current = Date.now();
        return;
      }
      if (state !== 'active' || backgroundSince.current === null) return;
      const away = Date.now() - backgroundSince.current;
      backgroundSince.current = null;
      try {
        const active = await getActiveProfile();
        if ((await hasProfilePin(active.id)) && away >= (await getAutoLockMinutes()) * 60000) setRelocked(active);
      } catch {}
    });
    return () => sub.remove();
  }, []);
  // Back must not reach the screens under the lock.
  useEffect(() => {
    if (!relocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [relocked]);
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

  // Widget taps (notespark://new, notespark://note/<profileId>/<id>); expo-share-intent handles its own dataUrl links.
  const [widgetLink, setWidgetLink] = useState<string | null>(null);
  useEffect(() => {
    Linking.getInitialURL().then(url => url && setWidgetLink(url)).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => setWidgetLink(url));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!widgetLink || !navReady || !appNavigation.isReady()) return;
    const match = /^notespark:\/\/note\/(?:([^/]+)\/)?(\d+)$/.exec(widgetLink);
    if (widgetLink === 'notespark://new') {
      appNavigation.dispatch(StackActions.push('Editor'));
    } else if (match) {
      const [, profileId, noteId] = match;
      getActiveProfile()
        .then(active => {
          if (!profileId || profileId === active.id) {
            appNavigation.dispatch(StackActions.push('NoteView', { noteId }));
          }
        })
        .catch(() => {});
    }
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

  // Task reminder taps, including one that cold-started the app before navigation was ready.
  const [notificationScreen, setNotificationScreen] = useState<'Tasks' | null>(null);
  useEffect(() => {
    const handleResponse = (response: { notification: { request: { content: { data?: Record<string, unknown> } } } } | null) => {
      if (response?.notification.request.content.data?.screen === 'Tasks') {
        setNotificationScreen('Tasks');
        Notifications?.clearLastNotificationResponseAsync().catch(() => {});
      }
    };
    Notifications?.getLastNotificationResponseAsync().then(handleResponse).catch(() => {});
    const tapped = Notifications?.addNotificationResponseReceivedListener(handleResponse);
    return () => tapped?.remove();
  }, []);
  useEffect(() => {
    if (notificationScreen !== 'Tasks' || !navReady || !appNavigation.isReady()) return;
    appNavigation.navigate('Tasks');
    setNotificationScreen(null);
  }, [notificationScreen, navReady]);

  const openDefaultProfile = async () => {
    const defaultProfile = await getDefaultProfile();
    if (await hasProfilePin(defaultProfile.id)) {
      setLockedProfile(defaultProfile);
      setUnreadableProfile(null);
    } else {
      try {
        await switchProfile(defaultProfile.id);
        setLockedProfile(null);
        setUnreadableProfile(null);
      } catch (error) {
        console.error('Failed to open default profile:', error);
        setLockedProfile(null);
        setUnreadableProfile(defaultProfile);
      }
    }
  };

  useEffect(() => {
    const setupApp = async () => {
      try {
        await setupNotificationWorker();
        await syncProfileEncryption();
        await openDefaultProfile();
        await purgeProfileBin().catch(error => console.warn('Profile bin purge failed:', error));
        // Reads every profile's notes; waits so it doesn't compete with Home's first load.
        setTimeout(() => getAllProfilesNoteContents().then(pruneImageCache).catch(() => {}), 10000);
        runAutoBackupIfDue().catch(() => {});
      } catch (error) {
        console.error('Failed to initialize database:', error);
        const fallback = await getDefaultProfile().catch(() => ({ id: 'default', name: 'Personal' }));
        setUnreadableProfile(fallback);
      } finally {
        const onboarded = await AsyncStorage.getItem('onboarded').catch(() => 'true');
        setShowOnboarding(onboarded !== 'true');
        setDbInitialized(true);
      }
    };
    setupApp();
    // A due automatic backup also runs when the app comes back to the front.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') runAutoBackupIfDue().catch(() => {});
    });
    return () => {
      sub.remove();
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

  const unlockRelocked = async (pin: string): Promise<boolean> => {
    if (!relocked) return false;
    try {
      await switchProfile(relocked.id, pin);
      setRelocked(null);
      return true;
    } catch {
      return false;
    }
  };

  const eraseRelockedProfile = async () => {
    if (!relocked) return;
    await eraseForgottenProfile(relocked.id);
    setRelocked(null);
    if (appNavigation.isReady()) appNavigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    await openDefaultProfile();
  };

  const eraseUnreadableProfile = async () => {
    if (!unreadableProfile) return;
    await eraseForgottenProfile(unreadableProfile.id);
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
          ) : unreadableProfile ? (
            <UnreadableProfileScreen profileName={unreadableProfile.name} onRetry={openDefaultProfile} onErase={eraseUnreadableProfile} />
          ) : lockedProfile ? (
            <ProfileUnlockScreen profileId={lockedProfile.id} profileName={lockedProfile.name} onUnlock={unlockDefaultProfile} onForgotPin={eraseLockedProfile} />
          ) : showOnboarding ? (
            <OnboardingScreen onFinish={handleFinishOnboarding} />
          ) : (
            <AppNavigator onReady={() => setNavReady(true)} />
          )}
          {relocked && (
            <Portal>
              {/* Its own dialogs, so Forgot PIN's confirmation shows above the lock. */}
              <DialogProvider>
                <View style={StyleSheet.absoluteFill}>
                  <ProfileUnlockScreen profileId={relocked.id} profileName={relocked.name} onUnlock={unlockRelocked} onForgotPin={eraseRelockedProfile} />
                </View>
              </DialogProvider>
            </Portal>
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
  errorColumn: {
    flex: 1,
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
    padding: space.xl,
    justifyContent: 'center',
  },
  errorBody: {
    marginTop: space.md,
    marginBottom: space.xl,
  },
  errorActions: {
    marginTop: space.xl,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
