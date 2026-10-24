import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { initDatabase } from './src/storage/database';
import { setupNotificationWorker } from './src/utils/notifications';
import { ActivityIndicator, View, StyleSheet, Button } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { sendAppNotification } from './src/utils/notifications';
import { useFonts } from 'expo-font';
import { fontFiles } from './src/theme/theme';

const AppContent = () => {
  const { theme, isDarkMode } = useTheme();
  const navigationRef = React.useRef<any>(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [fontsLoaded, fontError] = useFonts(fontFiles);

  useEffect(() => {
    const setupApp = async () => {
      try {
        await setupNotificationWorker();
        await initDatabase();
        setDbInitialized(true);
        const onboarded = await AsyncStorage.getItem('onboarded');
        setShowOnboarding(onboarded !== 'true');
      } catch (error) {
        console.error('Failed to initialize database:', error);
      }
    };
    setupApp();
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

  // Font load failure falls back to the system font instead of blocking the app.
  const ready = dbInitialized && showOnboarding !== null && (fontsLoaded || !!fontError);

  return (
    <PaperProvider theme={theme}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      {!ready ? (
        <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : showOnboarding ? (
        <OnboardingScreen onFinish={handleFinishOnboarding} />
      ) : (
        <AppNavigator />
      )}
    </PaperProvider>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
