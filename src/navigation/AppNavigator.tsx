import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { RootStackParamList } from '../types';
import HomeScreen from '../screens/HomeScreen';
import EditorScreen from '../screens/EditorScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ImportExportScreen from '../screens/ImportExportScreen';
import AboutScreen from '../screens/AboutScreen';
import { useTheme } from '../theme/ThemeContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const { theme } = useTheme();
  
  const navigationTheme = {
    ...DefaultTheme,
    dark: theme.dark,
    colors: {
      ...DefaultTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.text + '20', // 12.5% opacity
      notification: theme.colors.accent,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Home"
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
          name="Settings"
          component={SettingsScreen}
          options={{
            headerShown: false,
          }}
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
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator; 