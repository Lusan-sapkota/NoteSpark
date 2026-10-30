import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple } from 'react-native-paper';
import { formatDue, getLanguage, today } from '@notespark/core';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
// Sunday-first narrow weekday names in the current language (2023-01-01 was a Sunday).
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(getLanguage(), { weekday: 'narrow' }));

// A month grid, Sunday first; days in `marked` get a dot (and ", has a note" for screen readers). ponytail: no year jump or locale week start; month arrows only.
const DateCalendar: React.FC<{ value: string | null; onPick: (day: string | null) => void; marked?: ReadonlySet<string> }> = ({ value, onPick, marked }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const now = today();
  const [view, setView] = useState(() => {
    const d = new Date(`${value ?? now}T00:00`);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(first).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(0);
  const step = (by: number) => setView(v => { const d = new Date(v.y, v.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const title = new Date(view.y, view.m, 1).toLocaleDateString(getLanguage(), { month: 'long', year: 'numeric' });

  return (
    <View>
      <View style={styles.monthRow}>
        <IconButton icon="chevron-left" onPress={() => step(-1)} accessibilityLabel={t('tasks.previousMonth')} />
        <Text variant="titleSmall" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>{title}</Text>
        <IconButton icon="chevron-right" onPress={() => step(1)} accessibilityLabel={t('tasks.nextMonth')} />
      </View>
      <View style={styles.week}>
        {weekdays().map((w, i) => (
          <Text key={i} variant="labelMedium" style={[styles.cell, styles.weekday, { color: theme.colors.onSurfaceVariant }]}>{w}</Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={styles.week}>
          {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={styles.cell} />;
            const k = key(view.y, view.m, d);
            const selected = k === value;
            return (
              <View key={i} style={styles.cell}>
                <TouchableRipple
                  onPress={() => onPick(selected ? null : k)}
                  accessibilityRole="button"
                  accessibilityLabel={formatDue(k) + (k === now ? t('tasks.calendarToday') : '') + (marked?.has(k) ? t('tasks.calendarHasNote') : '')}
                  accessibilityState={{ selected }}
                  style={[
                    styles.day,
                    k === now && { borderWidth: 1, borderColor: theme.colors.outline },
                    selected && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <View style={styles.dayInner}>
                    <Text variant="bodyMedium" style={{ color: selected ? theme.colors.onPrimary : theme.colors.onSurface }}>{d}</Text>
                    {marked?.has(k) && <View style={[styles.dot, { backgroundColor: selected ? theme.colors.onPrimary : theme.colors.primary }]} />}
                  </View>
                </TouchableRipple>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  weekday: { textAlign: 'center', minHeight: 32 },
  dayInner: { alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
  day: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

export default DateCalendar;
