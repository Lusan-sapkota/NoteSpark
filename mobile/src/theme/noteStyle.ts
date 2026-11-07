// Note colours and background patterns. Notes store only the keys, so a palette change never touches stored data.
// The first five colours are existing Firefly roles. The rest are extended colours made the Material way: a tonal
// palette per hue (Material Theme Builder custom colours, chroma 10 to 40), container at tone 90 and its text at tone 30
// in light, swapped in dark, the same pairing every container role uses.
import type { MD3Theme } from 'react-native-paper';

export const NOTE_COLORS = ['lime', 'sage', 'teal', 'sky', 'lavender', 'blush', 'rose', 'amber', 'sun', 'clay', 'khaki', 'slate'] as const;
export const NOTE_PATTERNS = [
  'hills', 'mountains', 'sunrise', 'waves', 'rings', 'bloom', 'petals', 'bubbles', 'dots', 'confetti', 'stripes', 'diamonds', 'crosses', 'lines', 'grid',
] as const;

export type NoteColorKey = (typeof NOTE_COLORS)[number];
export type NotePatternKey = (typeof NOTE_PATTERNS)[number];

type Roles = [fill: keyof MD3Theme['colors'], on: keyof MD3Theme['colors']];
const ROLES: Partial<Record<NoteColorKey, Roles>> = {
  lime: ['primaryContainer', 'onPrimaryContainer'],
  sage: ['secondaryContainer', 'onSecondaryContainer'],
  teal: ['tertiaryContainer', 'onTertiaryContainer'],
  rose: ['errorContainer', 'onErrorContainer'],
  khaki: ['surfaceVariant', 'onSurfaceVariant'],
};

// [fill, on] for light and dark.
const EXTENDED: Partial<Record<NoteColorKey, { light: [string, string]; dark: [string, string] }>> = {
  sky: { light: ['#c4e7ff', '#004c69'], dark: ['#004c69', '#c4e7ff'] },
  lavender: { light: ['#e6deff', '#49416d'], dark: ['#49416d', '#e6deff'] },
  blush: { light: ['#ffd8e8', '#6a3552'], dark: ['#6a3552', '#ffd8e8'] },
  amber: { light: ['#ffdcbd', '#693c00'], dark: ['#693c00', '#ffdcbd'] },
  sun: { light: ['#ffe17b', '#554500'], dark: ['#554500', '#ffe17b'] },
  clay: { light: ['#ffdbce', '#5f3f33'], dark: ['#5f3f33', '#ffdbce'] },
  slate: { light: ['#dce3ee', '#404750'], dark: ['#404750', '#dce3ee'] },
};

// The fill and its text colour for a note colour key; null for none or a key from a newer version of the app.
export const noteColors = (theme: Pick<MD3Theme, 'colors' | 'dark'>, key?: string | null): { fill: string; on: string } | null => {
  const roles = ROLES[key as NoteColorKey];
  if (roles) return { fill: theme.colors[roles[0]] as string, on: theme.colors[roles[1]] as string };
  const extended = EXTENDED[key as NoteColorKey];
  if (!extended) return null;
  const [fill, on] = theme.dark ? extended.dark : extended.light;
  return { fill, on };
};

export const isPattern = (key?: string | null): key is NotePatternKey => NOTE_PATTERNS.includes(key as NotePatternKey);

// Colours for the pattern artwork: eight hues at three tones each (light, mid, deep), from Material tonal palettes
// (chroma 40 to 64), the lighter set for light notes and the deeper set for dark ones. Used only by NotePattern.
export type ArtHue = 'green' | 'teal' | 'sky' | 'violet' | 'pink' | 'coral' | 'orange' | 'gold';
const ART: Record<'light' | 'dark', Record<ArtHue, [string, string, string]>> = {
  light: {
    green: ['#acd370', '#84aa4c', '#5e8229'],
    teal: ['#75d7c8', '#49ae9f', '#0f8679'],
    sky: ['#7cd0ff', '#3ba8db', '#0080ad'],
    violet: ['#c6c0ff', '#9c96dd', '#756fb3'],
    pink: ['#ffafd6', '#e37cb3', '#b6568b'],
    coral: ['#ffb4ab', '#fa7568', '#c85045'],
    orange: ['#ffb779', '#eb8400', '#b26300'],
    gold: ['#ecc300', '#bc9b00', '#8e7500'],
  },
  dark: {
    green: ['#91b758', '#6b8f35', '#476810'],
    teal: ['#58bbad', '#279385', '#006a60'],
    sky: ['#4cb6e9', '#008dbf', '#00668a'],
    violet: ['#aaa3eb', '#827cc1', '#5c5698'],
    pink: ['#f389c1', '#c56298', '#983d71'],
    coral: ['#ff897d', '#d95c51', '#a73830'],
    orange: ['#fe8f00', '#c56e00', '#8f4e00'],
    gold: ['#cba800', '#9d8100', '#715c00'],
  },
};
export const artPalette = (dark: boolean) => ART[dark ? 'dark' : 'light'];
