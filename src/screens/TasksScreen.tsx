import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconButton, List, SegmentedButtons, Snackbar, Text } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { getNotes, setTaskDoneInNote } from '../storage/notes';
import { extractTasks, Task } from '../utils/tasks';
import Header, { useHeaderElevation } from '../components/Header';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { groupCorners, readingWidth, space } from '../theme/theme';

type TasksScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Tasks'>;

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const formatDue = (due: string) => new Date(`${due}T00:00`).toLocaleDateString([], { dateStyle: 'medium' });

// Every open checkbox from every note. Ticking one writes "[x]" back into its note.
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

  const sorted = useMemo(() => {
    const byNote = (a: Task, b: Task) =>
      b.noteUpdatedAt.localeCompare(a.noteUpdatedAt) || a.noteId - b.noteId || a.line - b.line;
    return [...tasks].sort((a, b) => {
      if (sortBy === 'due' && a.due !== b.due) {
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      }
      return byNote(a, b);
    });
  }, [tasks, sortBy]);

  const setDone = async (task: Task, done: boolean) => {
    try {
      if (!(await setTaskDoneInNote(task, done))) {
        alert('This task changed', 'Its note was edited. The list has been refreshed.');
      } else {
        setLastDone(done ? task : null);
      }
    } catch {
      alert("Couldn't update the task", 'Try again. If it keeps failing, restart the app.');
    }
    load();
  };

  const todayStr = today();

  const renderItem = ({ item, index }: { item: Task; index: number }) => {
    const overdue = !!item.due && item.due < todayStr;
    return (
      <View
        style={[
          groupCorners(index === 0, index === sorted.length - 1),
          { backgroundColor: theme.colors.surfaceContainerLow },
          index < sorted.length - 1 && styles.gap,
        ]}
      >
        <List.Item
          title={item.text}
          titleNumberOfLines={4}
          description={() => (
            <View>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                {item.noteTitle || 'Untitled note'}
              </Text>
              {item.due && (
                <Text variant="bodySmall" style={{ color: overdue ? theme.colors.error : theme.colors.onSurfaceVariant }}>
                  {overdue ? `Overdue, due ${formatDue(item.due)}` : `Due ${formatDue(item.due)}`}
                </Text>
              )}
            </View>
          )}
          left={props => <List.Icon {...props} icon="checkbox-blank-outline" color={theme.colors.onSurfaceVariant} />}
          right={() => (
            <IconButton
              icon="open-in-new"
              accessibilityLabel={`Open note ${item.noteTitle}`}
              onPress={() => navigation.navigate('NoteView', { noteId: String(item.noteId) })}
            />
          )}
          onPress={() => setDone(item, true)}
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
        data={sorted}
        keyExtractor={t => `${t.noteId}:${t.line}`}
        renderItem={renderItem}
        itemLayoutAnimation={LinearTransition.springify()}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
        style={styles.column}
        ListHeaderComponent={
          <SegmentedButtons
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
        action={{ label: 'Undo', onPress: () => lastDone && setDone(lastDone, false) }}
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
    marginBottom: space.lg,
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
