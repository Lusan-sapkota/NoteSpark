import React from 'react';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { RootStackParamList } from '../types';
import HomeScreen from '../screens/HomeScreen';
import EditorScreen from '../screens/EditorScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ImportExportScreen from '../screens/ImportExportScreen';
import AboutScreen from '../screens/AboutScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import TasksScreen from '../screens/TasksScreen';
import BinScreen from '../screens/BinScreen';
import { useTheme } from '../theme/ThemeContext';
import { navDarkTheme, navLightTheme } from '../theme/theme';
import { Notifications } from '../utils/notifications';
import { StartScreen, startRoutes } from '../utils/startScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// For opening screens from outside a screen: notification taps, shared text, the app shortcut.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// A reminder tapped while the app was closed: open Tasks once navigation is ready.
const openLaunchNotification = () => {
  const response = Notifications?.getLastNotificationResponse();
  if (response?.notification.request.content.data?.screen !== 'Tasks') return;
  Notifications?.clearLastNotificationResponse();
  navigationRef.navigate('Tasks');
};

// onReady: lets App.tsx open the editor for text shared from another app once navigation can take it.
const AppNavigator: React.FC<{ onReady?: () => void; start?: StartScreen; reopenSettings?: boolean }> = ({ onReady, start = 'Home', reopenSettings }) => {
  const { theme, isDarkMode } = useTheme();

  return (
    <NavigationContainer ref={navigationRef} initialState={{ routes: (reopenSettings ? ['Home', 'Settings'] : startRoutes(start)).map(name => ({ name })) }} onReady={() => { openLaunchNotification(); onReady?.(); }} theme={isDarkMode ? navDarkTheme : navLightTheme}>
      <Stack.Navigator
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Editor"
          component={EditorScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="NoteView"
          component={require('../screens/NoteViewScreen').default}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Scratchpad"
          component={require('../screens/ScratchpadScreen').default}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="ProfileLock"
          component={require('../screens/ProfileLockScreen').default}
          options={{ headerShown: false, animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ImportExport"
          component={ImportExportScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="About"
          component={AboutScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Privacy"
          component={PrivacyScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Tasks"
          component={TasksScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Ask"
          component={require('../screens/AskScreen').default}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Tidy"
          component={require('../screens/TidyScreen').default}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Bin"
          component={BinScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator; 