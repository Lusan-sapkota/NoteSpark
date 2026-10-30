import { Platform } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, adaptNavigationTheme, configureFonts, customText } from 'react-native-paper';
import { firefly, shape, space, readingWidth, typeScale } from '@notespark/core';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';

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

// Static fonts, one family per weight, so fontWeight stays '400' to avoid synthetic bold on Android.
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

export type NoteVariant = 'noteTitle' | 'noteH1' | 'noteH2' | 'noteH3' | 'noteBody' | 'noteCode';

// UI is Figtree on MD3 variants; note content is Literata on custom variants.
const scale = configureFonts({
  config: {
    ...Object.fromEntries(Object.entries(typeScale).map(([name, [family, size, line]]) => [
      name,
      type(name === 'noteCode' ? Platform.select({ ios: 'Menlo', default: family }) : family, size, line),
    ])),
  },
});
// configureFonts doesn't type custom variants, so they're added here.
const fonts = {
  ...(scale as typeof scale & Record<NoteVariant, ReturnType<typeof type>>),
  default: { ...scale.default, fontFamily: 'Figtree-Regular', fontWeight: '400' as const },
};

export { shape, space, readingWidth };

export const NoteText = customText<NoteVariant>();

// For Paper Button and SegmentedButtons, whose corners are 5 × theme.roundness.
export const controlTheme = { roundness: shape.control / 5 };

// Segmented list: large outer corners on the group, small inner corners between rows.
export const groupCorners = (isFirst: boolean, isLast: boolean) => ({
  borderTopLeftRadius: isFirst ? shape.group : shape.segment,
  borderTopRightRadius: isFirst ? shape.group : shape.segment,
  borderBottomLeftRadius: isLast ? shape.group : shape.segment,
  borderBottomRightRadius: isLast ? shape.group : shape.segment,
});

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
