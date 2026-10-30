import React, { useCallback, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AnimatedFAB, Appbar, IconButton, List, SegmentedButtons, Text } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import Menu from '../components/Menu';
import AddTaskDialog, { TaskTarget } from '../components/AddTaskDialog';
import { updateWidgets } from '../widget/widgets';
import { RootStackParamList } from '../types';
import { addTaskToNote, deleteTaskLine, getNotes, getScratchpadNote, insertTaskLine, restoreTaskLine, SCRATCHPAD_ID, toggleTaskInNote } from '../storage/notes';
import type { t as translate } from '@notespark/core';
import { dueLabel, extractTasks, formatDue, editTaskLine, repeatLabel, Repeat, Task, today as getToday } from '@notespark/core';
import Header, { useHeaderElevation } from '../components/Header';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { controlTheme, groupCorners, readingWidth, space } from '../theme/theme';

type TasksScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Tasks'>;

type Row =
  | { kind: 'header'; key: string; title: string; noteId?: number; tone?: 'error' }
  | { kind: 'task'; key: string; task: Task; isFirst: boolean; isLast: boolean };

// Flat list of section headers and task rows, so the list keeps its spring layout animation.
const buildRows = (all: Task[], sortBy: 'due' | 'note', today: string, t: typeof translate): Row[] => {
  const tasks = sortBy === 'due' ? all.filter(t => !t.done) : all;
  const rows: Row[] = [];
  const addSection = (header: Omit<Extract<Row, { kind: 'header' }>, 'kind'>, items: Task[]) => {
    if (!items.length) return;
    rows.push({ kind: 'header', ...header });
    items.forEach((task, i) =>
      rows.push({ kind: 'task', key: `${task.noteId}:${task.line}`, task, isFirst: i === 0, isLast: i === items.length - 1 })
    );
  };
  if (sortBy === 'due') {
    const byDue = [...tasks].sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || a.noteId - b.noteId || a.line - b.line);
    addSection({ key: 'overdue', title: t('tasks.overdue'), tone: 'error' }, byDue.filter(t => t.due && t.due < today));
    addSection({ key: 'today', title: t('common.today') }, byDue.filter(t => t.due === today));
    addSection({ key: 'upcoming', title: t('tasks.upcoming') }, byDue.filter(t => t.due && t.due > today));
    addSection({ key: 'none', title: t('tasks.noDueDate') }, byDue.filter(t => !t.due));
    addSection({ key: 'done', title: t('common.done') }, all.filter(t => t.done));
  } else {
    const notes = new Map<number, Task[]>();
    [...tasks]
      .sort((a, b) => b.noteUpdatedAt.localeCompare(a.noteUpdatedAt) || a.noteId - b.noteId || Number(a.done) - Number(b.done) || a.line - b.line)
      .forEach(t => notes.set(t.noteId, [...(notes.get(t.noteId) ?? []), t]));
    notes.forEach((items, noteId) =>
      addSection({ key: `note:${noteId}`, title: items[0].noteTitle || t('common.untitledNote'), noteId }, items)
    );
  }
  return rows;
};

// The row's "more" menu; each row keeps its own open state.
const TaskMenu: React.FC<{ title: string; onEdit: () => void; onOpen: () => void; onDelete: () => void }> = ({ title, onEdit, onOpen, onDelete }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const pick = (fn: () => void) => () => { setVisible(false); fn(); };
  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={<IconButton icon="dots-vertical" accessibilityLabel={t('tasks.moreOptionsFor', { title })} onPress={() => setVisible(true)} />}
    >
      <Menu.Item leadingIcon="pencil-outline" title={t('tasks.editTask')} onPress={pick(onEdit)} />
      <Menu.Item leadingIcon="open-in-new" title={t('tasks.openNote')} onPress={pick(onOpen)} />
      <Menu.Item leadingIcon="delete-outline" title={t('tasks.deleteTask')} titleStyle={{ color: theme.colors.error }} onPress={pick(onDelete)} />
    </Menu>
  );
};

const TasksScreen: React.FC = () => {
  const navigation = useNavigation<TasksScreenNavigationProp>();
  const { theme, isDarkMode } = useTheme();
  const { t, language } = useI18n();
  const { elevated, onScroll: onHeaderScroll } = useHeaderElevation();
  // Same as Home: the extended FAB collapses while scrolling down and expands on scroll up or at the top.
  const [fabExtended, setFabExtended] = useState(true);
  const lastOffset = useRef(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onHeaderScroll(e);
    const y = e.nativeEvent.contentOffset.y;
    const extended = y <= 0 || y < lastOffset.current;
    if (extended !== fabExtended) setFabExtended(extended);
    lastOffset.current = y;
  };
  const alert = useAlert();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sortBy, setSortBy] = useState<'due' | 'note'>('due');
  const [showDone, setShowDone] = useState(false);
  // The last tick, for Undo: the task before, the line after, and a repeating task's next date.
  const [lastDone, setLastDone] = useState<{ task: Task; raw: string; next?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleted, setDeleted] = useState<Task | null>(null);
  const [added, setAdded] = useState('');

  const load = useCallback(async () => {
    try {
      const [notes, pad] = await Promise.all([getNotes(), getScratchpadNote().catch(() => null)]);
      setTasks([...notes.filter(n => !n.isArchived), ...(pad ? [pad] : [])].flatMap(n => extractTasks(n, { done: showDone })));
    } catch {
      alert(t('tasks.loadFailedTitle'), t('tasks.loadFailedMessage'));
    }
  }, [alert, showDone, t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const today = getToday();
  const rows = useMemo(() => buildRows(tasks, sortBy, today, t), [tasks, sortBy, today, t, language]);

  const toggle = async (task: Task) => {
    try {
      const result = await toggleTaskInNote(task.noteId, task);
      if (!result) {
        alert(t('tasks.changedTitle'), t('tasks.changedMessage'));
      } else {
        setLastDone(task.done ? null : { task, ...result });
      }
    } catch {
      alert(t('tasks.updateFailedTitle'), t('common.tryAgainRestart'));
    }
    updateWidgets().catch(() => {}); // the Tasks due widget
    load();
  };

  const undoLastDone = async () => {
    if (!lastDone) return;
    const { task, raw } = lastDone;
    setLastDone(null);
    try {
      if (!(await restoreTaskLine(task.noteId, task.line, raw, task.raw))) {
        alert(t('tasks.undoFailedTitle'), t('tasks.undoEditedMessage'));
      }
    } catch {
      alert(t('tasks.undoFailedTitle'), t('common.tryAgainRestart'));
    }
    updateWidgets().catch(() => {}); // the Tasks due widget
    load();
  };

  // A new task goes on the end of the chosen note (the scratchpad unless picked), where the list already reads it.
  const addTask = async (text: string, due: string | null, every: Repeat | null, target: TaskTarget) => {
    setAdding(false);
    try {
      const line = editTaskLine('- [ ] x', text.replace(/\s+/g, ' '), due, every);
      if (!(await addTaskToNote(target.id, line))) throw new Error('missing');
      setAdded(target.title);
    } catch {
      alert(t('tasks.addFailedTitle'), t('common.tryAgainRestart'));
    }
    updateWidgets().catch(() => {}); // the Tasks due widget
    load();
  };

  const saveEdit = async (text: string, due: string | null, every: Repeat | null) => {
    const task = editing;
    setEditing(null);
    if (!task) return;
    try {
      if (!(await restoreTaskLine(task.noteId, task.line, task.raw, editTaskLine(task.raw, text, due, every)))) {
        alert(t('tasks.changedTitle'), t('tasks.changedMessage'));
      }
    } catch {
      alert(t('tasks.saveFailedTitle'), t('common.tryAgainRestart'));
    }
    updateWidgets().catch(() => {}); // the Tasks due widget
    load();
  };

  const removeTask = async (task: Task) => {
    try {
      if (await deleteTaskLine(task.noteId, task.line, task.raw)) {
        setLastDone(null);
        setDeleted(task);
      } else {
        alert(t('tasks.changedTitle'), t('tasks.changedMessage'));
      }
    } catch {
      alert(t('tasks.deleteFailedTitle'), t('common.tryAgainRestart'));
    }
    updateWidgets().catch(() => {}); // the Tasks due widget
    load();
  };

  const undoDelete = async () => {
    const task = deleted;
    setDeleted(null);
    if (!task) return;
    try {
      await insertTaskLine(task.noteId, task.line, task.raw);
    } catch {
      alert(t('tasks.undoFailedTitle'), t('tasks.undoDeleteMessage'));
    }
    updateWidgets().catch(() => {}); // the Tasks due widget
    load();
  };

  const openNote = (noteId: number) =>
    noteId === SCRATCHPAD_ID ? navigation.navigate('Scratchpad') : navigation.navigate('NoteView', { noteId: String(noteId) });

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text
            variant="titleSmall"
            numberOfLines={2}
            style={[styles.sectionTitle, { color: item.tone === 'error' ? theme.colors.error : theme.colors.primary }]}
          >
            {item.title}
          </Text>
          {item.noteId !== undefined && (
            <IconButton icon="open-in-new" accessibilityLabel={t('tasks.openNoteTitled', { title: item.title })} onPress={() => openNote(item.noteId!)} />
          )}
        </View>
      );
    }
    const { task } = item;
    const overdue = !task.done && !!task.due && task.due < today;
    const dueText = [task.due && (overdue || !task.done ? dueLabel(task.due, today) : t('tasks.dueOn', { date: formatDue(task.due) })), task.every && repeatLabel(task.every)]
      .filter(Boolean)
      .join(', ');
    return (
      <View
        style={[
          groupCorners(item.isFirst, item.isLast),
          { backgroundColor: theme.colors.surfaceContainerLow },
          !item.isLast && styles.gap,
        ]}
      >
        <List.Item
          title={task.text}
          titleNumberOfLines={4}
          description={
            sortBy === 'note' && !dueText
              ? undefined
              : () => (
                  <View>
                    {sortBy === 'due' && (
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                        {task.noteTitle || t('common.untitledNote')}
                      </Text>
                    )}
                    {!!dueText && (
                      <Text variant="bodySmall" style={{ color: overdue ? theme.colors.error : theme.colors.onSurfaceVariant }}>
                        {dueText}
                      </Text>
                    )}
                  </View>
                )
          }
          titleStyle={task.done && styles.doneTitle}
          left={props => <List.Icon {...props} icon={task.done ? 'checkbox-marked' : 'checkbox-blank-outline'} color={theme.colors.onSurfaceVariant} />}
          right={() => (
            <TaskMenu title={task.text} onEdit={() => setEditing(task)} onOpen={() => openNote(task.noteId)} onDelete={() => removeTask(task)} />
          )}
          onPress={() => toggle(task)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.done }}
          accessibilityHint={task.done ? t('tasks.markNotDoneHint') : t('tasks.markDoneHint')}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header
        elevated={elevated}
        title={t('common.tasks')}
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightActions={
          <Appbar.Action
            icon={showDone ? 'checkbox-marked-outline' : 'checkbox-blank-off-outline'}
            selected={showDone}
            onPress={() => setShowDone(v => !v)}
            accessibilityLabel={showDone ? t('tasks.hideDone') : t('tasks.showDone')}
          />
        }
      />
      <Animated.FlatList
        data={rows}
        keyExtractor={r => r.key}
        renderItem={renderItem}
        itemLayoutAnimation={LinearTransition.springify()}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surfaceContainerHigh}
          />
        }
        contentContainerStyle={styles.listContent}
        style={styles.column}
        ListHeaderComponent={
          <SegmentedButtons theme={controlTheme}
            value={sortBy}
            onValueChange={v => setSortBy(v as 'due' | 'note')}
            style={styles.sort}
            buttons={[
              { value: 'due', label: t('tasks.byDueDate'), icon: 'calendar' },
              { value: 'note', label: t('tasks.byNote'), icon: 'note-text-outline' },
            ]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{showDone ? t('tasks.emptyAll') : t('tasks.emptyOpen')}</Text>
            <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              {t('tasks.emptyHelp')}
            </Text>
          </View>
        }
      />
      <AnimatedFAB
        icon="star-four-points"
        label={t('tasks.addTask')}
        extended={fabExtended}
        onPress={() => setAdding(true)}
        animateFrom="right"
        accessibilityLabel={t('tasks.addTask')}
        // The firefly glow in dark mode, as on Home's New note button.
        style={[styles.fab, isDarkMode && { shadowColor: theme.colors.primary }]}
      />
      <AddTaskDialog visible={adding} onDismiss={() => setAdding(false)} onAdd={addTask} />
      <AddTaskDialog visible={!!editing} task={editing ?? undefined} onDismiss={() => setEditing(null)} onAdd={saveEdit} />
      <Snackbar visible={!!deleted} onDismiss={() => setDeleted(null)} duration={4000} action={{ label: t('common.undo'), onPress: undoDelete }}>{t('tasks.deleted')}</Snackbar>
      <Snackbar visible={!!added} onDismiss={() => setAdded('')} duration={3000}>{t('tasks.addedTo', { name: added })}</Snackbar>
      <Snackbar
        visible={!!lastDone}
        onDismiss={() => setLastDone(null)}
        duration={4000}
        action={{ label: t('common.undo'), onPress: undoLastDone }}
      >
        {lastDone?.next ? t('tasks.nextDue', { date: formatDue(lastDone.next) }) : t('tasks.doneSnack')}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 96,
    paddingHorizontal: space.lg,
  },
  sort: {
    marginTop: space.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    marginTop: space.md,
  },
  sectionTitle: {
    flex: 1,
    marginLeft: space.xs,
  },
  gap: {
    marginBottom: 2,
  },
  doneTitle: {
    textDecorationLine: 'line-through',
  },
  empty: {
    paddingHorizontal: space.xs,
    paddingTop: space.xl,
  },
  emptyBody: {
    marginTop: space.xs,
  },
});

export default TasksScreen;
