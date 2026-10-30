import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, List, TextInput } from 'react-native-paper';
import { addDays, formatDue, Repeat, today } from '@notespark/core';
import DateCalendar from './DateCalendar';
import Menu from './Menu';
import { getNotes, SCRATCHPAD_ID } from '../storage/notes';
import { Note } from '../types';
import KeyboardSafePortal from './KeyboardSafePortal';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';

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
              {picking && <DateCalendar value={due} onPick={setDue} />}
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
});

export default AddTaskDialog;
