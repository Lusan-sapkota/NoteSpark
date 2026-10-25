import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconButton, List, SegmentedButtons, Text } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import { RootStackParamList } from '../types';
import { getNotes, toggleTaskInNote } from '../storage/notes';
import { dueLabel, extractTasks, Task, today as getToday } from '../utils/tasks';
import Header, { useHeaderElevation } from '../components/Header';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, groupCorners, readingWidth, space } from '../theme/theme';

type TasksScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Tasks'>;

type Row =
  | { kind: 'header'; key: string; title: string; noteId?: number; tone?: 'error' }
  | { kind: 'task'; key: string; task: Task; isFirst: boolean; isLast: boolean };

// Flat list of section headers and task rows, so the list keeps its spring layout animation.
const buildRows = (tasks: Task[], sortBy: 'due' | 'note', today: string): Row[] => {
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
  } else {
    const notes = new Map<number, Task[]>();
    [...tasks]
      .sort((a, b) => b.noteUpdatedAt.localeCompare(a.noteUpdatedAt) || a.noteId - b.noteId || a.line - b.line)
      .forEach(t => notes.set(t.noteId, [...(notes.get(t.noteId) ?? []), t]));
    notes.forEach((items, noteId) =>
      addSection({ key: `note:${noteId}`, title: items[0].noteTitle || 'Untitled note', noteId }, items)
    );
  }
  return rows;
};

const TasksScreen: React.FC = () => {
  const navigation = useNavigation<TasksScreenNavigationProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sortBy, setSortBy] = useState<'due' | 'note'>('due');
  const [lastDone, setLastDone] = useState<Task | null>(null);

  const load = useCallback(async () => {
    try {
      const notes = await getNotes();
      setTasks(notes.flatMap(extractTasks));
    } catch {
      alert("Couldn't load tasks", 'Go back and open Tasks again.');
    }
  }, [alert]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = getToday();
  const rows = useMemo(() => buildRows(tasks, sortBy, today), [tasks, sortBy, today]);

  // Ticking keeps the ticked line in lastDone, so Undo can clear it again.
  const toggle = async (task: Task, undo = false) => {
    try {
      const raw = await toggleTaskInNote(task.noteId, task);
      if (raw == null) {
        alert('This task changed', 'Its note was edited. The list has been refreshed.');
      } else {
        setLastDone(undo ? null : { ...task, raw });
      }
    } catch {
      alert("Couldn't update the task", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  const openNote = (noteId: number) => navigation.navigate('NoteView', { noteId: String(noteId) });

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
    const overdue = !!task.due && task.due < today;
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
            sortBy === 'note' && !task.due
              ? undefined
              : () => (
                  <View>
                    {sortBy === 'due' && (
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                        {task.noteTitle || 'Untitled note'}
                      </Text>
                    )}
                    {task.due && (
                      <Text variant="bodySmall" style={{ color: overdue ? theme.colors.error : theme.colors.onSurfaceVariant }}>
                        {dueLabel(task.due, today)}
                      </Text>
                    )}
                  </View>
                )
          }
          left={props => <List.Icon {...props} icon="checkbox-blank-outline" color={theme.colors.onSurfaceVariant} />}
          right={
            sortBy === 'due'
              ? () => (
                  <IconButton
                    icon="open-in-new"
                    accessibilityLabel={`Open note ${task.noteTitle}`}
                    onPress={() => openNote(task.noteId)}
                  />
                )
              : undefined
          }
          onPress={() => toggle(task)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: false }}
          accessibilityHint="Marks the task done in its note"
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title="Tasks" showBackButton onBackPress={() => navigation.goBack()} />
      <Animated.FlatList
        data={rows}
        keyExtractor={r => r.key}
        renderItem={renderItem}
        itemLayoutAnimation={LinearTransition.springify()}
        onScroll={onScroll}
        scrollEventThrottle={16}
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
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>No open tasks</Text>
            <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              Start a line in any note with "- [ ] " to add a task. Add "due:2026-11-01" to give it a due date.
            </Text>
          </View>
        }
      />
      <Snackbar
        visible={!!lastDone}
        onDismiss={() => setLastDone(null)}
        duration={4000}
        action={{ label: 'Undo', onPress: () => lastDone && toggle(lastDone, true) }}
      >
        Task done
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
  listContent: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
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
  empty: {
    paddingHorizontal: space.xs,
    paddingTop: space.xl,
  },
  emptyBody: {
    marginTop: space.xs,
  },
});

export default TasksScreen;
