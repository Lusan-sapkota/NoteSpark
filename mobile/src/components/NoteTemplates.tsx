import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, List } from 'react-native-paper';
import { isDayTitle, TemplateKind, today } from '@notespark/core';
import DateCalendar from './DateCalendar';
import { Note } from '../types';
import { useI18n } from '../i18n/I18nContext';
import { space } from '../theme/theme';

// Pick a day, then open that day's note or start it from the daily template. Days with a note have a dot.
export const DailyNoteDialog: React.FC<{ visible: boolean; notes: Note[]; onDismiss: () => void; onPick: (day: string) => void }> = ({ visible, notes, onDismiss, onPick }) => {
  const { t } = useI18n();
  const marked = useMemo(() => new Set(notes.filter(n => isDayTitle(n.title)).map(n => n.title.trim())), [notes]);
  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>{t('home.dailyNote')}</Dialog.Title>
      <Dialog.Content>
        {visible && <DateCalendar value={null} marked={marked} onPick={day => day && onPick(day)} />}
      </Dialog.Content>
      <Dialog.Actions>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        <Button onPress={() => onPick(today())}>{t('common.today')}</Button>
      </Dialog.Actions>
    </Dialog>
  );
};

export const TemplateDialog: React.FC<{ visible: boolean; onDismiss: () => void; onPick: (kind: TemplateKind) => void }> = ({ visible, onDismiss, onPick }) => {
  const { t } = useI18n();
  const templates: { kind: TemplateKind; title: string; description: string; icon: string }[] = [
    { kind: 'meeting', title: t('home.templateMeeting'), description: t('home.templateMeetingDesc'), icon: 'account-group-outline' },
    { kind: 'checklist', title: t('home.templateChecklist'), description: t('home.templateChecklistDesc'), icon: 'format-list-checks' },
    { kind: 'daily', title: t('home.templateDaily'), description: t('home.templateDailyDesc'), icon: 'calendar-today' },
  ];
  return (
  <Dialog visible={visible} onDismiss={onDismiss}>
    <Dialog.Title>{t('home.newFromTemplate')}</Dialog.Title>
    <Dialog.Content style={styles.list}>
      <View>
        {templates.map(tpl => (
          <List.Item
            key={tpl.kind}
            title={tpl.title}
            description={tpl.description}
            descriptionNumberOfLines={2}
            left={props => <List.Icon {...props} icon={tpl.icon} />}
            onPress={() => onPick(tpl.kind)}
          />
        ))}
      </View>
    </Dialog.Content>
    <Dialog.Actions>
      <Button onPress={onDismiss}>{t('common.cancel')}</Button>
    </Dialog.Actions>
  </Dialog>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.sm },
});
