// Note colours and background patterns. Notes store only the keys, so a palette change never touches stored data;
// the colours are existing theme roles, so light, dark and the contrast pairs come from the theme.
import type { MD3Theme } from 'react-native-paper';

export const NOTE_COLORS = ['lime', 'sage', 'teal', 'rose', 'khaki'] as const;
export const NOTE_PATTERNS = ['hills', 'rings', 'stripes', 'dots', 'waves', 'petals'] as const;

export type NoteColorKey = (typeof NOTE_COLORS)[number];
export type NotePatternKey = (typeof NOTE_PATTERNS)[number];

const ROLES: Record<NoteColorKey, [fill: keyof MD3Theme['colors'], on: keyof MD3Theme['colors']]> = {
  lime: ['primaryContainer', 'onPrimaryContainer'],
  sage: ['secondaryContainer', 'onSecondaryContainer'],
  teal: ['tertiaryContainer', 'onTertiaryContainer'],
  rose: ['errorContainer', 'onErrorContainer'],
  khaki: ['surfaceVariant', 'onSurfaceVariant'],
};

// The fill and its text colour for a note colour key; null for none or a key from a newer version of the app.
export const noteColors = (colors: MD3Theme['colors'], key?: string | null): { fill: string; on: string } | null => {
  const roles = ROLES[key as NoteColorKey];
  return roles ? { fill: colors[roles[0]] as string, on: colors[roles[1]] as string } : null;
};

export const isPattern = (key?: string | null): key is NotePatternKey => NOTE_PATTERNS.includes(key as NotePatternKey);
