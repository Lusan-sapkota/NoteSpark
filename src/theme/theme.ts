import { MD3DarkTheme, MD3LightTheme, adaptNavigationTheme } from 'react-native-paper';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';

// Define our color palette
const colors = {
  primary: '#E4572E',
  accent: '#F8A21A',
  background: {
    light: '#FDF5EC',
    dark: '#333333',
  },
  text: {
    light: '#333333',
    dark: '#FFFFFF',
  },
  secondary: '#FFE7A0',
  surface: {
    light: '#FFFFFF',
    dark: '#1E1E1E',
  },
  error: '#B00020',
};

// Adapt navigation themes
const { LightTheme, DarkTheme } = adaptNavigationTheme({
  reactNavigationLight: NavigationDefaultTheme,
  reactNavigationDark: NavigationDarkTheme,
});

// Create our light theme
const lightTheme = {
  ...MD3LightTheme,
  ...LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...LightTheme.colors,
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    background: colors.background.light,
    surface: colors.surface.light,
    text: colors.text.light,
    error: colors.error,
  },
  fonts: MD3LightTheme.fonts,
};

// Create our dark theme
const darkTheme = {
  ...MD3DarkTheme,
  ...DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...DarkTheme.colors,
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    background: colors.background.dark,
    surface: colors.surface.dark,
    text: colors.text.dark,
    error: colors.error,
  },
  fonts: MD3DarkTheme.fonts,
};

export { lightTheme, darkTheme }; 