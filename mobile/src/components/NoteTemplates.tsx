import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, List } from 'react-native-paper';
import { isDayTitle, TemplateKind, today } from '@notespark/core';
import DateCalendar from './DateCalendar';
import { Note } from '../types';
import { space } from '../theme/theme';

// Pick a day, then open that day's note or start it from the daily template. Days with a note have a dot.
export const DailyNoteDialog: React.FC<{ visible: boolean; notes: Note[]; onDismiss: () => void; onPick: (day: string) => void }> = ({ visible, notes, onDismiss, onPick }) => {
  const marked = useMemo(() => new Set(notes.filter(n => isDayTitle(n.title)).map(n => n.title.trim())), [notes]);
  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>Daily note</Dialog.Title>
      <Dialog.Content>
        {visible && <DateCalendar value={null} marked={marked} onPick={day => day && onPick(day)} />}
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>Cancel</Button>
        <Button onPress={() => onPick(today())}>Today</Button>
      </Dialog.Actions>
    </Dialog>
  );
};

const TEMPLATES: { kind: TemplateKind; title: string; description: string; icon: string }[] = [
  { kind: 'meeting', title: 'Meeting notes', description: 'Attendees, agenda, decisions and action items', icon: 'account-group-outline' },
  { kind: 'checklist', title: 'Checklist', description: 'Three tasks to fill in', icon: 'format-list-checks' },
  { kind: 'daily', title: "Today's note", description: 'Plan, notes and what got done', icon: 'calendar-today' },
];

export const TemplateDialog: React.FC<{ visible: boolean; onDismiss: () => void; onPick: (kind: TemplateKind) => void }> = ({ visible, onDismiss, onPick }) => (
  <Dialog visible={visible} onDismiss={onDismiss}>
    <Dialog.Title>New from template</Dialog.Title>
    <Dialog.Content style={styles.list}>
      <View>
        {TEMPLATES.map(t => (
          <List.Item
            key={t.kind}
            title={t.title}
            description={t.description}
            descriptionNumberOfLines={2}
            left={props => <List.Icon {...props} icon={t.icon} />}
            onPress={() => onPick(t.kind)}
          />
        ))}
      </View>
    </Dialog.Content>
    <Dialog.Actions>
      <Button onPress={onDismiss}>Cancel</Button>
    </Dialog.Actions>
  </Dialog>
);

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.sm },
});
