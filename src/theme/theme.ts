import { Platform } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, adaptNavigationTheme, configureFonts, customText } from 'react-native-paper';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';

// Firefly scheme: seed #9BBF2A, Material 3 Tonal Spot, contrast 0.
// Source: docs/design/firefly-colors.md. Regenerate from the seed; don't hand-tune roles.
const firefly = {
  light: {
    primary: '#546524',
    onPrimary: '#ffffff',
    primaryContainer: '#d7eb9b',
    onPrimaryContainer: '#3d4c0d',
    inversePrimary: '#bbcf82',
    secondary: '#5b6147',
    onSecondary: '#ffffff',
    secondaryContainer: '#dfe6c4',
    onSecondaryContainer: '#434931',
    tertiary: '#39665e',
    onTertiary: '#ffffff',
    tertiaryContainer: '#bcece2',
    onTertiaryContainer: '#204e47',
    error: '#ba1a1a',
    onError: '#ffffff',
    errorContainer: '#ffdad6',
    onErrorContainer: '#93000a',
    background: '#fbfaee',
    onBackground: '#1b1c15',
    surface: '#fbfaee',
    onSurface: '#1b1c15',
    surfaceVariant: '#e3e4d3',
    onSurfaceVariant: '#46483c',
    surfaceDim: '#dbdbcf',
    surfaceBright: '#fbfaee',
    surfaceContainerLowest: '#ffffff',
    surfaceContainerLow: '#f5f4e8',
    surfaceContainer: '#efeee2',
    surfaceContainerHigh: '#e9e9dd',
    surfaceContainerHighest: '#e3e3d7',
    inverseSurface: '#303129',
    inverseOnSurface: '#f2f1e5',
    outline: '#76786b',
    outlineVariant: '#c6c8b8',
    shadow: '#000000',
    scrim: '#000000',
    // Paper-only roles, derived from the scheme (onSurface at 12% / 38%, inverseSurface at 40%).
    surfaceDisabled: 'rgba(27, 28, 21, 0.12)',
    onSurfaceDisabled: 'rgba(27, 28, 21, 0.38)',
    backdrop: 'rgba(48, 49, 41, 0.4)',
  },
  dark: {
    primary: '#bbcf82',
    onPrimary: '#283500',
    primaryContainer: '#3d4c0d',
    onPrimaryContainer: '#d7eb9b',
    inversePrimary: '#546524',
    secondary: '#c3caa9',
    onSecondary: '#2d331c',
    secondaryContainer: '#434931',
    onSecondaryContainer: '#dfe6c4',
    tertiary: '#a1d0c6',
    onTertiary: '#033731',
    tertiaryContainer: '#204e47',
    onTertiaryContainer: '#bcece2',
    error: '#ffb4ab',
    onError: '#690005',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    background: '#12140d',
    onBackground: '#e3e3d7',
    surface: '#12140d',
    onSurface: '#e3e3d7',
    surfaceVariant: '#46483c',
    onSurfaceVariant: '#c6c8b8',
    surfaceDim: '#12140d',
    surfaceBright: '#393a32',
    surfaceContainerLowest: '#0d0f08',
    surfaceContainerLow: '#1b1c15',
    surfaceContainer: '#1f2019',
    surfaceContainerHigh: '#292b23',
    surfaceContainerHighest: '#34362d',
    inverseSurface: '#e3e3d7',
    inverseOnSurface: '#303129',
    outline: '#909284',
    outlineVariant: '#46483c',
    shadow: '#000000',
    scrim: '#000000',
    surfaceDisabled: 'rgba(227, 227, 215, 0.12)',
    onSurfaceDisabled: 'rgba(227, 227, 215, 0.38)',
    backdrop: 'rgba(48, 49, 41, 0.4)',
  },
};

// Paper's elevation levels map to the M3 surface container roles (tonal, not shadow-tinted).
const withElevation = (c: typeof firefly.light) => ({
  ...c,
  elevation: {
    level0: 'transparent',
    level1: c.surfaceContainerLow,
    level2: c.surfaceContainer,
    level3: c.surfaceContainerHigh,
    level4: c.surfaceContainerHigh,
    level5: c.surfaceContainerHighest,
  },
});

// Static font files in assets/fonts, loaded in App.tsx under these names.
// Each weight is its own family, so fontWeight stays '400' to avoid synthetic bold on Android.
export const fontFiles = {
  'Figtree-Regular': require('../../assets/fonts/Figtree-Regular.ttf'),
  'Figtree-Medium': require('../../assets/fonts/Figtree-Medium.ttf'),
  'Figtree-SemiBold': require('../../assets/fonts/Figtree-SemiBold.ttf'),
  'Literata-Regular': require('../../assets/fonts/Literata-Regular.ttf'),
  'Literata-Italic': require('../../assets/fonts/Literata-Italic.ttf'),
  'Literata-SemiBold': require('../../assets/fonts/Literata-SemiBold.ttf'),
};

const type = (fontFamily: string, fontSize: number, lineHeight: number) => ({
  fontFamily,
  fontSize,
  lineHeight,
  fontWeight: '400' as const,
  letterSpacing: 0,
});

// Type scale (size/line height in dp). UI is Figtree on Paper's MD3 variants;
// note content is Literata on custom variants. See CLAUDE.md "Type scale".
const scale = configureFonts({
  config: {
    displayLarge: type('Figtree-Regular', 57, 64),
    displayMedium: type('Figtree-Regular', 45, 52),
    displaySmall: type('Figtree-Regular', 36, 44),
    headlineLarge: type('Figtree-Regular', 32, 40),
    headlineMedium: type('Figtree-Regular', 28, 36),
    headlineSmall: type('Figtree-SemiBold', 24, 32),
    titleLarge: type('Figtree-SemiBold', 22, 28),
    titleMedium: type('Figtree-SemiBold', 16, 24),
    titleSmall: type('Figtree-Medium', 14, 20),
    bodyLarge: type('Figtree-Regular', 16, 24),
    bodyMedium: type('Figtree-Regular', 14, 20),
    bodySmall: type('Figtree-Regular', 12, 16),
    labelLarge: type('Figtree-Medium', 14, 20),
    labelMedium: type('Figtree-Medium', 12, 16),
    labelSmall: type('Figtree-Medium', 11, 16),
    noteTitle: type('Literata-SemiBold', 26, 34),
    noteH1: type('Literata-SemiBold', 24, 32),
    noteH2: type('Literata-SemiBold', 21, 30),
    noteH3: type('Literata-SemiBold', 18, 28),
    noteBody: type('Literata-Regular', 17, 28),
    noteCode: type(Platform.select({ ios: 'Menlo', default: 'monospace' }), 14, 22),
  },
});
// Paper components without a variant read fonts.default.
const fonts = { ...scale, default: { ...scale.default, fontFamily: 'Figtree-Regular', fontWeight: '400' as const } };

export type NoteVariant = 'noteTitle' | 'noteH1' | 'noteH2' | 'noteH3' | 'noteBody' | 'noteCode';
export const NoteText = customText<NoteVariant>();

// Corner radii by hierarchy (M3 shape roles). See docs/prompts/material-redesign.md Phase 0.
export const shape = {
  extraSmall: 4, // inline code
  small: 8, // chips, images, code blocks
  segment: 4, // inner corners of a list group
  group: 20, // outer corners of a list group
  fab: 16,
  extraLarge: 28, // dialogs, sheets
  full: 999, // search bar, buttons
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

// Max width of the reading column (about 70 characters at noteBody).
export const readingWidth = 680;

const lightTheme = {
  ...MD3LightTheme,
  colors: withElevation(firefly.light),
  fonts,
};

const darkTheme = {
  ...MD3DarkTheme,
  colors: withElevation(firefly.dark),
  fonts,
};

export type AppTheme = typeof lightTheme;

const { LightTheme: navLightTheme, DarkTheme: navDarkTheme } = adaptNavigationTheme({
  reactNavigationLight: NavigationDefaultTheme,
  reactNavigationDark: NavigationDarkTheme,
  materialLight: lightTheme,
  materialDark: darkTheme,
});

export { lightTheme, darkTheme, navLightTheme, navDarkTheme };
