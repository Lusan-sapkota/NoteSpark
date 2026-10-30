import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, IconButton, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { addDays, formatDue, today } from '@notespark/core';
import KeyboardSafePortal from './KeyboardSafePortal';
import { useTheme } from '../theme/ThemeContext';
import { space } from '../theme/theme';

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A month grid, Sunday first. ponytail: no year jump or locale week start; month arrows only.
const Calendar: React.FC<{ value: string | null; onPick: (due: string | null) => void }> = ({ value, onPick }) => {
  const { theme } = useTheme();
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
  const title = new Date(view.y, view.m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <View>
      <View style={styles.monthRow}>
        <IconButton icon="chevron-left" onPress={() => step(-1)} accessibilityLabel="Previous month" />
        <Text variant="titleSmall" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>{title}</Text>
        <IconButton icon="chevron-right" onPress={() => step(1)} accessibilityLabel="Next month" />
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((w, i) => (
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
                  accessibilityLabel={formatDue(k) + (k === now ? ', today' : '')}
                  accessibilityState={{ selected }}
                  style={[
                    styles.day,
                    k === now && { borderWidth: 1, borderColor: theme.colors.outline },
                    selected && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Text variant="bodyMedium" style={{ color: selected ? theme.colors.onPrimary : theme.colors.onSurface }}>{d}</Text>
                </TouchableRipple>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};

// Asks for the task text and an optional due date picked from a calendar; tapping the chosen day again clears it.
// With `task`, it edits that task instead of adding one.
const AddTaskDialog: React.FC<{ visible: boolean; task?: { text: string; due?: string }; onDismiss: () => void; onAdd: (text: string, due: string | null) => void }> = ({ visible, task, onDismiss, onAdd }) => {
  const [text, setText] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [picking, setPicking] = useState(false); // the calendar stays closed until asked for, so the keyboard and the dialog fit together
  const input = useRef<any>(null);
  useEffect(() => { if (visible) { setText(task?.text ?? ''); setDue(task?.due ?? null); setPicking(false); } }, [visible]);
  const custom = !!due && due !== today() && due !== addDays(1);
  const submit = () => text.trim() && onAdd(text.trim(), due);

  return (
    <KeyboardSafePortal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{task ? 'Edit task' : 'Add task'}</Dialog.Title>
        <Dialog.ScrollArea style={styles.area}>
          <View style={styles.body}>
            <TextInput ref={input} mode="outlined" label="Task" value={text} onChangeText={setText} autoFocus maxLength={200} onSubmitEditing={submit} />
            <View style={styles.chips}>
              <Chip selected={due === today()} showSelectedCheck onPress={() => { setDue(today()); setPicking(false); }}>Today</Chip>
              <Chip selected={due === addDays(1)} showSelectedCheck onPress={() => { setDue(addDays(1)); setPicking(false); }}>Tomorrow</Chip>
              <Chip icon="calendar-month-outline" selected={custom || picking} showSelectedCheck={false} onPress={() => { input.current?.blur?.(); setPicking(p => !p); }}>
                {custom ? formatDue(due!) : 'Pick a date'}
              </Chip>
              <Chip selected={!due} showSelectedCheck onPress={() => { setDue(null); setPicking(false); }}>No date</Chip>
            </View>
            {picking && <Calendar value={due} onPick={setDue} />}
          </View>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button onPress={submit} disabled={!text.trim()}>{task ? 'Save task' : 'Add task'}</Button>
        </Dialog.Actions>
      </Dialog>
    </KeyboardSafePortal>
  );
};

const styles = StyleSheet.create({
  area: { maxHeight: 520 },
  body: { paddingVertical: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.md },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  weekday: { textAlign: 'center', minHeight: 32 },
  day: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

export default AddTaskDialog;
