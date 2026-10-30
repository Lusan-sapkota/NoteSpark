import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, IconButton, List, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { addDays, formatDue, Repeat, today } from '@notespark/core';
import Menu from './Menu';
import { getNotes, SCRATCHPAD_ID } from '../storage/notes';
import { Note } from '../types';
import KeyboardSafePortal from './KeyboardSafePortal';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';

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

// Same look as Home's filter chips: filled when chosen, outlined otherwise, no check mark so widths don't change.
const DateChip: React.FC<{ label: string; selected: boolean; onPress: () => void }> = ({ label, selected, onPress }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.chipCell}>
      <Chip
        mode={selected ? 'flat' : 'outlined'}
        selected={selected}
        showSelectedCheck={false}
        showSelectedOverlay={false}
        onPress={onPress}
        accessibilityState={{ selected }}
        style={[styles.chipShape, selected && { backgroundColor: theme.colors.secondaryContainer }]}
        textStyle={[theme.fonts.labelMedium, styles.chipText, { color: selected ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant }]}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Chip>
    </View>
  );
};

export interface TaskTarget { id: number; title: string }
const SCRATCHPAD: TaskTarget = { id: SCRATCHPAD_ID, title: 'Scratchpad' };
const REPEATS: { value: Repeat | null; label: string }[] = [
  { value: null, label: 'Never' }, { value: 'day', label: 'Every day' }, { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' }, { value: 'year', label: 'Every year' },
];

// Asks for the task text, an optional due date picked from a calendar (tap the chosen day again to clear it), a repeat,
// and which note it goes in (the scratchpad unless chosen). With `task`, it edits that task instead; the note stays.
const AddTaskDialog: React.FC<{
  visible: boolean;
  task?: { text: string; due?: string; every?: Repeat };
  onDismiss: () => void;
  onAdd: (text: string, due: string | null, every: Repeat | null, target: TaskTarget) => void;
}> = ({ visible, task, onDismiss, onAdd }) => {
  const [text, setText] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [every, setEvery] = useState<Repeat | null>(null);
  const [target, setTarget] = useState<TaskTarget>(SCRATCHPAD);
  const [picking, setPicking] = useState(false); // the calendar stays closed until asked for, so the keyboard and the dialog fit together
  const [repeatMenu, setRepeatMenu] = useState(false);
  const [choosing, setChoosing] = useState<{ query: string; notes: Note[] } | null>(null);
  const input = useRef<any>(null);
  useEffect(() => {
    if (!visible) return;
    setText(task?.text ?? '');
    setDue(task?.due ?? null);
    setEvery(task?.every ?? null);
    setTarget(SCRATCHPAD);
    setPicking(false);
    setChoosing(null);
  }, [visible]);
  const custom = !!due && due !== today() && due !== addDays(1);
  const submit = () => text.trim() && onAdd(text.trim(), due, every, target);
  const chooseRepeat = (value: Repeat | null) => {
    setRepeatMenu(false);
    setEvery(value);
    if (value && !due) setDue(today()); // a repeat counts from a date
  };
  const openChooser = () => {
    input.current?.blur?.();
    setChoosing({ query: '', notes: [] });
    getNotes().then(
      notes => setChoosing(c => c && { ...c, notes: notes.filter(n => !n.isArchived && n.title.trim()) }),
      () => {}
    );
  };
  const matches = choosing ? choosing.notes.filter(n => n.title.toLowerCase().includes(choosing.query.trim().toLowerCase())).slice(0, 8) : [];

  return (
    <KeyboardSafePortal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{choosing ? 'Add to' : task ? 'Edit task' : 'Add task'}</Dialog.Title>
        <Dialog.ScrollArea style={styles.area}>
          {choosing ? (
            <View style={styles.body}>
              <TextInput mode="outlined" label="Search note titles" value={choosing.query} onChangeText={query => setChoosing(c => c && { ...c, query })} autoFocus />
              {[SCRATCHPAD, ...matches.map(n => ({ id: n.id, title: n.title }))].map(t => (
                <List.Item
                  key={t.id}
                  title={t.title}
                  titleNumberOfLines={2}
                  left={props => <List.Icon {...props} icon={t.id === SCRATCHPAD_ID ? 'notebook-edit-outline' : 'note-text-outline'} />}
                  right={props => (t.id === target.id ? <List.Icon {...props} icon="check" /> : null)}
                  onPress={() => { setTarget(t); setChoosing(null); }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.body}>
              <TextInput ref={input} mode="outlined" label="Task" value={text} onChangeText={setText} autoFocus maxLength={200} onSubmitEditing={submit} />
              <View style={styles.chips}>
                <DateChip label="Today" selected={due === today()} onPress={() => { setDue(today()); setPicking(false); }} />
                <DateChip label="Tomorrow" selected={due === addDays(1)} onPress={() => { setDue(addDays(1)); setPicking(false); }} />
                <DateChip label="No date" selected={!due} onPress={() => { setDue(null); setEvery(null); setPicking(false); }} />
              </View>
              <Button
                mode={custom || picking ? 'contained-tonal' : 'outlined'}
                icon="calendar-month-outline"
                style={styles.chipShape}
                onPress={() => { input.current?.blur?.(); setPicking(p => !p); }}
                accessibilityState={{ expanded: picking }}
              >
                {custom ? formatDue(due!) : 'Pick a date'}
              </Button>
              {picking && <Calendar value={due} onPick={setDue} />}
              <Menu
                visible={repeatMenu}
                onDismiss={() => setRepeatMenu(false)}
                anchor={
                  <Button mode={every ? 'contained-tonal' : 'outlined'} icon="repeat" style={[styles.chipShape, styles.row]} onPress={() => { input.current?.blur?.(); setRepeatMenu(true); }}>
                    {every ? REPEATS.find(r => r.value === every)!.label : 'Repeat'}
                  </Button>
                }
              >
                {REPEATS.map(r => (
                  <Menu.Item key={String(r.value)} title={r.label} trailingIcon={r.value === every ? 'check' : undefined} onPress={() => chooseRepeat(r.value)} />
                ))}
              </Menu>
              {!task && (
                <Button mode="outlined" icon={target.id === SCRATCHPAD_ID ? 'notebook-edit-outline' : 'note-text-outline'} style={[styles.chipShape, styles.row]} onPress={openChooser}>
                  {`Add to ${target.title}`}
                </Button>
              )}
            </View>
          )}
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {choosing ? (
            <Button onPress={() => setChoosing(null)}>Back</Button>
          ) : (
            <>
              <Button onPress={onDismiss}>Cancel</Button>
              <Button onPress={submit} disabled={!text.trim()}>{task ? 'Save task' : 'Add task'}</Button>
            </>
          )}
        </Dialog.Actions>
      </Dialog>
    </KeyboardSafePortal>
  );
};

const styles = StyleSheet.create({
  area: { maxHeight: 520 },
  body: { paddingVertical: space.sm },
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  chipCell: { flex: 1 },
  chipText: { flex: 1, textAlign: 'center' },
  chipShape: { borderRadius: shape.small },
  row: { marginTop: space.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  weekday: { textAlign: 'center', minHeight: 32 },
  day: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

export default AddTaskDialog;
