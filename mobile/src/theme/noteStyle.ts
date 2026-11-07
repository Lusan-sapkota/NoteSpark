// Note colours by key: five Firefly roles plus seven extra tonal colours (tone 90, text tone 30, swapped in dark).
import type { MD3Theme } from 'react-native-paper';

export const NOTE_COLORS = ['lime', 'sage', 'teal', 'sky', 'lavender', 'blush', 'rose', 'amber', 'sun', 'clay', 'khaki', 'slate'] as const;
export const NOTE_PATTERNS = [
  'seaweed', 'skyline', 'flowers', 'rain', 'stars', 'hills', 'mountains', 'sunrise', 'waves', 'rings', 'bloom', 'petals', 'bubbles', 'dots', 'confetti',
  'stripes', 'diamonds', 'crosses', 'lines', 'grid',
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

export const isHexColor = (key?: string | null): key is string => /^#[0-9a-f]{6}$/i.test(key ?? '');

// What a person types: with or without #, 3 or 6 digits; null if it isn't a colour.
export const parseHex = (input: string): string | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// A picked colour is the same in light and dark; its text is whichever of dark ink and white reads better on it.
const DARK_INK = '#1b1c15';
const customColor = (hex: string) => {
  const l = luminance(hex);
  return { fill: hex, on: 1.05 / (l + 0.05) > (l + 0.05) / (luminance(DARK_INK) + 0.05) ? '#ffffff' : DARK_INK };
};

// The fill and its text colour for a colour key or a #rrggbb; null for none or a key from a newer version of the app.
export const noteColors = (theme: Pick<MD3Theme, 'colors' | 'dark'>, key?: string | null): { fill: string; on: string } | null => {
  const typed = key; // narrowing `typed` leaves `key` as the string it is for the lookups below
  if (isHexColor(typed)) return customColor(typed.toLowerCase());
  const roles = ROLES[key as NoteColorKey];
  if (roles) return { fill: theme.colors[roles[0]] as string, on: theme.colors[roles[1]] as string };
  const extended = EXTENDED[key as NoteColorKey];
  if (!extended) return null;
  const [fill, on] = theme.dark ? extended.dark : extended.light;
  return { fill, on };
};

export const isPattern = (key?: string | null): key is NotePatternKey => NOTE_PATTERNS.includes(key as NotePatternKey);

// Pattern artwork colours: eight hues, three tones each; lighter set for light notes, deeper for dark.
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

// The theme as it should read on a note colour: text and icons in the colour's own ink, the page in its fill, and the
// neutral surfaces (chips, fields) as 8 to 15% of that ink over it, so nothing on the note can clash with a custom colour.
export const withInk = <T extends Pick<MD3Theme, 'colors'>>(theme: T, own: { fill: string; on: string } | null): T =>
  own
    ? {
        ...theme,
        colors: {
          ...theme.colors,
          onSurface: own.on, onSurfaceVariant: own.on, onBackground: own.on,
          background: own.fill, surface: own.fill,
          surfaceContainerLow: `${own.on}14`, surfaceContainer: `${own.on}1a`, surfaceContainerHigh: `${own.on}1f`, surfaceContainerHighest: `${own.on}26`,
        },
      }
    : theme;

export const isPictureBackground = (key?: string | null): key is string => /^attachment:[0-9a-f]{64}$/.test(key ?? '');

// Contrast, so artwork and pictures never make the text on a note hard to read (WCAG: 4.5 for body text).
const isHex6 = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (under: string, over: string, alpha: number) => {
  const [u, o] = [rgb(under), rgb(over)];
  return `#${u.map((v, i) => Math.round(v * (1 - alpha) + o[i] * alpha).toString(16).padStart(2, '0')).join('')}`;
};
export const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
// A blend may never read worse than 4.5, or than the colour pair itself does if that is lower (a mid-tone custom colour).
const floorFor = (base: string, ink: string) => Math.min(4.5, contrast(base, ink)) - 0.05;

// The largest opacity up to `desired` at which `art` over `base` still leaves `ink` readable; 0 if none does.
export const safeAlpha = (base: string, ink: string, art: string, desired: number): number => {
  if (!isHex6(base) || !isHex6(ink) || !isHex6(art)) return desired * 0.5;
  const floor = floorFor(base, ink);
  for (let a = desired; a > 0.001; a -= 0.05) if (contrast(mix(base, art, a), ink) >= floor) return a;
  return 0;
};

// How opaque the note's colour must be over a picture so text stays readable on the worst picture (all white or all black).
export const scrimAlpha = (base: string, ink: string): number => {
  if (!isHex6(base) || !isHex6(ink)) return 0.92;
  const floor = floorFor(base, ink);
  for (let s = 0.5; s < 0.96; s += 0.05) {
    if (['#ffffff', '#000000'].every(photo => contrast(mix(photo, base, s), ink) >= floor)) return Math.min(s + 0.05, 0.95);
  }
  return 0.95;
};
