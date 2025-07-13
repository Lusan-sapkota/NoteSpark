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

const AppContent = () => {
  const { theme, isDarkMode } = useTheme();
  const navigationRef = React.useRef<any>(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

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

  // Remove forceUpdate, not needed
  const handleFinishOnboarding = async () => {
    if (!showOnboarding) return;
    try {
      await AsyncStorage.setItem('onboarded', 'true');
      try {
        await sendAppNotification('Welcome to NoteSpark!', 'You are ready to start taking notes.');
      } catch (notifErr) {
        console.error('Notification error:', notifErr);
      }
      setShowOnboarding(false);
      // Navigation reset to Home after onboarding
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
  // ...existing code...
  };

  if (!dbInitialized || showOnboarding === null) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (showOnboarding) {
    return (
      <>
        <OnboardingScreen onFinish={handleFinishOnboarding} />
      </>
    );
  }


  return (
    <PaperProvider theme={theme}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <AppNavigator />
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
