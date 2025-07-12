import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { initDatabase } from './src/storage/database';
import { setupNotificationWorker } from './src/utils/notifications';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { sendAppNotification } from './src/utils/notifications';

const AppContent = () => {
  const { theme, isDarkMode } = useTheme();
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

  const handleFinishOnboarding = async () => {
    await AsyncStorage.setItem('onboarded', 'true');
    await sendAppNotification('Welcome to NoteSpark!', 'You are ready to start taking notes.');
    setShowOnboarding(false);
  };

  if (!dbInitialized || showOnboarding === null) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}> 
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (showOnboarding) {
    return <OnboardingScreen onFinish={handleFinishOnboarding} />;
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
