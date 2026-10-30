import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Appbar, FAB, IconButton, List, SegmentedButtons, Text } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import Menu from '../components/Menu';
import AddTaskDialog from '../components/AddTaskDialog';
import { RootStackParamList } from '../types';
import { deleteTaskLine, getNotes, getScratchpad, getScratchpadNote, insertTaskLine, restoreTaskLine, saveScratchpad, SCRATCHPAD_ID, toggleTaskInNote } from '../storage/notes';
import { dueLabel, extractTasks, formatDue, editTaskLine, repeatLabel, setLineDue, Task, today as getToday } from '@notespark/core';
import Header, { useHeaderElevation } from '../components/Header';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, groupCorners, readingWidth, space } from '../theme/theme';

type TasksScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Tasks'>;

type Row =
  | { kind: 'header'; key: string; title: string; noteId?: number; tone?: 'error' }
  | { kind: 'task'; key: string; task: Task; isFirst: boolean; isLast: boolean };

// Flat list of section headers and task rows, so the list keeps its spring layout animation.
const buildRows = (all: Task[], sortBy: 'due' | 'note', today: string): Row[] => {
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
    addSection({ key: 'overdue', title: 'Overdue', tone: 'error' }, byDue.filter(t => t.due && t.due < today));
    addSection({ key: 'today', title: 'Today' }, byDue.filter(t => t.due === today));
    addSection({ key: 'upcoming', title: 'Upcoming' }, byDue.filter(t => t.due && t.due > today));
    addSection({ key: 'none', title: 'No due date' }, byDue.filter(t => !t.due));
    addSection({ key: 'done', title: 'Done' }, all.filter(t => t.done));
  } else {
    const notes = new Map<number, Task[]>();
    [...tasks]
      .sort((a, b) => b.noteUpdatedAt.localeCompare(a.noteUpdatedAt) || a.noteId - b.noteId || Number(a.done) - Number(b.done) || a.line - b.line)
      .forEach(t => notes.set(t.noteId, [...(notes.get(t.noteId) ?? []), t]));
    notes.forEach((items, noteId) =>
      addSection({ key: `note:${noteId}`, title: items[0].noteTitle || 'Untitled note', noteId }, items)
    );
  }
  return rows;
};

// The row's "more" menu; each row keeps its own open state.
const TaskMenu: React.FC<{ title: string; onEdit: () => void; onOpen: () => void; onDelete: () => void }> = ({ title, onEdit, onOpen, onDelete }) => {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(false);
  const pick = (fn: () => void) => () => { setVisible(false); fn(); };
  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={<IconButton icon="dots-vertical" accessibilityLabel={`More options for ${title}`} onPress={() => setVisible(true)} />}
    >
      <Menu.Item leadingIcon="pencil-outline" title="Edit task" onPress={pick(onEdit)} />
      <Menu.Item leadingIcon="open-in-new" title="Open note" onPress={pick(onOpen)} />
      <Menu.Item leadingIcon="delete-outline" title="Delete task" titleStyle={{ color: theme.colors.error }} onPress={pick(onDelete)} />
    </Menu>
  );
};

const TasksScreen: React.FC = () => {
  const navigation = useNavigation<TasksScreenNavigationProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
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
  const [added, setAdded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [notes, pad] = await Promise.all([getNotes(), getScratchpadNote().catch(() => null)]);
      setTasks([...notes.filter(n => !n.isArchived), ...(pad ? [pad] : [])].flatMap(n => extractTasks(n, { done: showDone })));
    } catch {
      alert("Couldn't load tasks", 'Pull down on the list to try again.');
    }
  }, [alert, showDone]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const today = getToday();
  const rows = useMemo(() => buildRows(tasks, sortBy, today), [tasks, sortBy, today]);

  const toggle = async (task: Task) => {
    try {
      const result = await toggleTaskInNote(task.noteId, task);
      if (!result) {
        alert('This task changed', 'Its note was edited. The list has been refreshed.');
      } else {
        setLastDone(task.done ? null : { task, ...result });
      }
    } catch {
      alert("Couldn't update the task", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  const undoLastDone = async () => {
    if (!lastDone) return;
    const { task, raw } = lastDone;
    setLastDone(null);
    try {
      if (!(await restoreTaskLine(task.noteId, task.line, raw, task.raw))) {
        alert("Couldn't undo", 'The note was edited since. Open it to change the task.');
      }
    } catch {
      alert("Couldn't undo", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  // New tasks go on the end of the scratchpad, which the list already reads.
  const addTask = async (text: string, due: string | null) => {
    setAdding(false);
    try {
      const pad = await getScratchpad();
      await saveScratchpad(`${pad}${pad && !pad.endsWith('\n') ? '\n' : ''}${setLineDue(text.replace(/\s+/g, ' '), due)}\n`);
      setAdded(true);
    } catch {
      alert("Couldn't add the task", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  const saveEdit = async (text: string, due: string | null) => {
    const task = editing;
    setEditing(null);
    if (!task) return;
    try {
      if (!(await restoreTaskLine(task.noteId, task.line, task.raw, editTaskLine(task.raw, text, due)))) {
        alert('This task changed', 'Its note was edited. The list has been refreshed.');
      }
    } catch {
      alert("Couldn't save the task", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  const removeTask = async (task: Task) => {
    try {
      if (await deleteTaskLine(task.noteId, task.line, task.raw)) {
        setLastDone(null);
        setDeleted(task);
      } else {
        alert('This task changed', 'Its note was edited. The list has been refreshed.');
      }
    } catch {
      alert("Couldn't delete the task", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  const undoDelete = async () => {
    const task = deleted;
    setDeleted(null);
    if (!task) return;
    try {
      await insertTaskLine(task.noteId, task.line, task.raw);
    } catch {
      alert("Couldn't undo", 'Open the note to add the task again.');
    }
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
            <IconButton icon="open-in-new" accessibilityLabel={`Open note ${item.title}`} onPress={() => openNote(item.noteId!)} />
          )}
        </View>
      );
    }
    const { task } = item;
    const overdue = !task.done && !!task.due && task.due < today;
    const dueText = [task.due && (overdue || !task.done ? dueLabel(task.due, today) : `Due ${formatDue(task.due)}`), task.every && repeatLabel(task.every)]
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
                        {task.noteTitle || 'Untitled note'}
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
          accessibilityHint={task.done ? 'Marks the task not done in its note' : 'Marks the task done in its note'}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header
        elevated={elevated}
        title="Tasks"
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightActions={
          <Appbar.Action
            icon={showDone ? 'checkbox-marked-outline' : 'checkbox-blank-off-outline'}
            selected={showDone}
            onPress={() => setShowDone(v => !v)}
            accessibilityLabel={showDone ? 'Hide done tasks' : 'Show done tasks'}
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
              { value: 'due', label: 'By due date', icon: 'calendar' },
              { value: 'note', label: 'By note', icon: 'note-text-outline' },
            ]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{showDone ? 'No tasks yet' : 'No open tasks'}</Text>
            <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              Tap Add task and pick a date, or start a line in any note with "- [ ] ".
            </Text>
          </View>
        }
      />
      <FAB icon="plus" label="Add task" onPress={() => setAdding(true)} accessibilityLabel="Add task" style={styles.fab} />
      <AddTaskDialog visible={adding} onDismiss={() => setAdding(false)} onAdd={addTask} />
      <AddTaskDialog visible={!!editing} task={editing ?? undefined} onDismiss={() => setEditing(null)} onAdd={saveEdit} />
      <Snackbar visible={!!deleted} onDismiss={() => setDeleted(null)} duration={4000} action={{ label: 'Undo', onPress: undoDelete }}>Task deleted</Snackbar>
      <Snackbar visible={added} onDismiss={() => setAdded(false)} duration={3000}>Task added to Scratchpad</Snackbar>
      <Snackbar
        visible={!!lastDone}
        onDismiss={() => setLastDone(null)}
        duration={4000}
        action={{ label: 'Undo', onPress: undoLastDone }}
      >
        {lastDone?.next ? `Next due ${formatDue(lastDone.next)}` : 'Task done'}
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
