// Firefly scheme: seed #9BBF2A, Material 3 Tonal Spot, contrast 0.
// Source: docs/design/firefly-colors.md. Regenerate from the seed; don't hand-tune roles.
export const firefly = {
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

// Corner radii. Controls and small labels share one radius; surfaces are larger; FABs (the bold element) keep M3's 16.
export const shape = {
  extraSmall: 4, // inline code
  small: 8, // chips and small labels (same look as `control` at their height), images, code blocks
  segment: 4, // inner corners of a list group
  group: 20, // outer corners of a list group
  fab: 16, // Paper's AnimatedFAB hardcodes this
  extraLarge: 28, // dialogs, sheets, tiles
  control: 12, // search bar, buttons, segmented buttons
  full: 999, // progress bars
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

// Max width of the reading column (about 70 characters at noteBody).
export const readingWidth = 680;


// Type scale (family, size, line height in dp). UI is Figtree; note content is Literata.
// noteCode is the system monospace font: each platform maps 'monospace' to its own.
export const typeScale = {
  displayLarge: ['Figtree-Regular', 57, 64],
  displayMedium: ['Figtree-Regular', 45, 52],
  displaySmall: ['Figtree-Regular', 36, 44],
  headlineLarge: ['Figtree-Regular', 32, 40],
  headlineMedium: ['Figtree-Regular', 28, 36],
  headlineSmall: ['Figtree-SemiBold', 24, 32],
  titleLarge: ['Figtree-SemiBold', 22, 28],
  titleMedium: ['Figtree-SemiBold', 16, 24],
  titleSmall: ['Figtree-Medium', 14, 20],
  bodyLarge: ['Figtree-Regular', 16, 24],
  bodyMedium: ['Figtree-Regular', 14, 20],
  bodySmall: ['Figtree-Regular', 12, 16],
  labelLarge: ['Figtree-Medium', 14, 20],
  labelMedium: ['Figtree-Medium', 12, 16],
  labelSmall: ['Figtree-Medium', 11, 16],
  noteTitle: ['Literata-SemiBold', 26, 34],
  noteH1: ['Literata-SemiBold', 24, 32],
  noteH2: ['Literata-SemiBold', 21, 30],
  noteH3: ['Literata-SemiBold', 18, 28],
  noteBody: ['Literata-Regular', 17, 28],
  noteCode: ['monospace', 14, 22],
} as const;
