import React, { useState, useCallback } from 'react';
import { Clipboard, RefreshControl, View, StyleSheet, ScrollView, Linking, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Appbar, Divider, FAB, Icon, ProgressBar, Text } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import Menu from '../components/Menu';
import { getNoteById, moveNoteToBin, setNoteArchived, setNotePinned, updateNote } from '../storage/notes';
import { findTaskLines, splitDue, toggleTaskLine } from '../utils/tasks';
import { Note } from '../types';
import Header, { useHeaderElevation } from '../components/Header';
import MarkdownRenderer from '../components/MarkdownRenderer';
import TaskRow from '../components/TaskRow';
import GroupedRow from '../components/GroupedRow';
import { toPreview } from '../components/NoteItem';
import { relatedNotes } from '../storage/semanticSearch';
import NoteImages, { extractImageUris } from '../components/NoteImages';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { NoteText, readingWidth, shape, space } from '../theme/theme';

type NoteViewScreenNavigationProp = NativeStackNavigationProp<any>;
type NoteViewScreenRouteProp = RouteProp<any>;

const getPlainText = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1') // images to URL
    .replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1') // links to URL
    .replace(/^\s*#{1,6}\s*/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // unordered lists
    .replace(/^\s*\d+\.\s+/gm, '') // ordered lists
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // inline code
    .replace(/[*_~`]/g, '') // formatting
    .replace(/\n{2,}/g, '\n') // extra newlines
    .trim();

// "today, 12:49 PM", "yesterday, …", "Oct 25, 12:49 PM", with the year only when it isn't this year.
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
};

const linkRegex = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}\b)/g;

const NoteViewScreen: React.FC = () => {
  const navigation = useNavigation<NoteViewScreenNavigationProp>();
  const route = useRoute<NoteViewScreenRouteProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();

  const confirmOpenLink = (url: string) => {
    const openUrl = /^https?:\/\//.test(url) ? url : `https://${url}`;
    alert('Open link?', `This opens ${url} in your browser.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open link', onPress: () => Linking.openURL(openUrl).catch(() => {}) },
    ]);
  };
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState<Note | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [snackbar, setSnackbar] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [related, setRelated] = useState<Note[]>([]);
  // The top bar shows the title only once the big title has scrolled under it.
  const [titleBottom, setTitleBottom] = useState(0);
  const [titleInBar, setTitleInBar] = useState(false);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll(e);
    setTitleInBar(e.nativeEvent.contentOffset.y > titleBottom);
  };

  const handleCopyAll = () => {
    if (note) {
      const text = note.isMarkdown && showRaw ? getPlainText(note.content) : note.content;
      Clipboard.setString(text);
      setSnackbar('Copied to clipboard');
    }
  };

  const reloadNote = async () => {
    setRefreshing(true);
    if ((route.params as any)?.noteId) {
      try {
        const fetchedNote = await getNoteById((route.params as any).noteId);
        setNote(fetchedNote);
        if (fetchedNote) {
          const ids = await relatedNotes(fetchedNote.id);
          const notes = await Promise.all(ids.map(id => getNoteById(id).catch(() => null)));
          setRelated(notes.filter((n): n is Note => !!n));
        }
      } catch (error) {
        alert("Couldn't load the note", 'Pull down to try again.');
      }
    }
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      reloadNote();
    }, [(route.params as any)?.noteId])
  );

  // No confirmation here: the note goes to the bin, and Home offers Undo.
  const handleDelete = async () => {
    try {
      await moveNoteToBin(note!.id);
      navigation.popTo('Home', { binnedNoteId: note!.id });
    } catch (error) {
      alert("Couldn't move the note to the bin", 'Try again. If it keeps failing, restart the app.');
    }
  };

  // Ticks on screen at once, then saves; puts it back if saving fails.
  const handleToggleTask = async (index: number) => {
    if (!note) return;
    const task = findTaskLines(note.content)[index];
    const result = task && toggleTaskLine(note.content, task);
    if (!result) return;
    const updated = { ...note, content: result.content, updatedAt: new Date().toISOString() };
    setNote(updated);
    try {
      await updateNote(updated);
    } catch (error) {
      setNote(note);
      alert("Couldn't update the task", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handlePinToggle = async () => {
    if (!note) return;
    setNote({ ...note, isPinned: !note.isPinned });
    try {
      await setNotePinned(note.id, !note.isPinned);
      setSnackbar(note.isPinned ? 'Note unpinned' : 'Note pinned');
    } catch (error) {
      setNote(note);
      alert("Couldn't pin the note", 'Try again. If it keeps failing, restart the app.');
    }
  };

  // Archiving also unpins (see setNoteArchived); the page stays open.
  const handleArchiveToggle = async () => {
    if (!note) return;
    try {
      await setNoteArchived(note.id, !note.isArchived);
      setNote({ ...note, isArchived: !note.isArchived, isPinned: note.isArchived && note.isPinned });
      setSnackbar(note.isArchived ? 'Note unarchived' : 'Note archived');
    } catch (error) {
      alert(note.isArchived ? "Couldn't unarchive the note" : "Couldn't archive the note", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleEdit = () => {
    navigation.navigate('Editor', { noteId: note!.id });
  };

  // Plain notes: render each line, turning URLs into links that ask before opening. Task lines become checkboxes.
  const renderPlainText = (content: string) => {
    const tasks = findTaskLines(content);
    return content.replace(/\[Image: ([^\]]+)\]/g, '').split(/\r?\n/).map((line, lineIdx) => {
      const taskIndex = tasks.findIndex(t => t.line === lineIdx);
      if (taskIndex >= 0) {
        const task = tasks[taskIndex];
        const { text, due } = splitDue(task.text);
        return (
          <TaskRow key={`line-${lineIdx}`} done={task.done} due={due} onPress={() => handleToggleTask(taskIndex)}>
            <NoteText
              variant="noteBody"
              style={{ color: theme.colors.onSurface, textDecorationLine: task.done ? 'line-through' : 'none' }}
            >
              {text}
            </NoteText>
          </TaskRow>
        );
      }
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      for (const match of line.matchAll(linkRegex)) {
        const url = match[0];
        if (match.index! > lastIndex) parts.push(line.substring(lastIndex, match.index));
        parts.push(
          <Text
            key={`link-${lineIdx}-${match.index}`}
            style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
            onPress={() => confirmOpenLink(url)}
          >
            {url}
          </Text>
        );
        lastIndex = match.index! + url.length;
      }
      if (lastIndex < line.length) parts.push(line.substring(lastIndex));
      return (
        <NoteText
          key={`line-${lineIdx}`}
          variant="noteBody"
          style={{ color: theme.colors.onSurface }}
          selectable
          selectionColor={theme.colors.primary}
        >
          {parts.length ? parts : ' '}
        </NoteText>
      );
    });
  };

  const goBack = () => navigation.goBack();

  if (!note) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
        <Header elevated={elevated} title="" showBackButton onBackPress={goBack} />
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const content = String(note.content ?? '');
  const taskLines = findTaskLines(content);
  const doneCount = taskLines.filter(t => t.done).length;

  const infoLabel = (icon: string, label: string) => (
    <View style={[styles.info, { backgroundColor: theme.colors.surfaceContainerHigh }]}>
      <Icon source={icon} size={16} color={theme.colors.onSurfaceVariant} />
      <Text variant="labelMedium" maxFontSizeMultiplier={1.5} style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right']}>
      <Header
        elevated={elevated}
        title={titleInBar ? note.title : ''}
        showBackButton
        onBackPress={goBack}
        rightActions={
          <>
            <Appbar.Action
              icon={note.isPinned ? 'pin' : 'pin-outline'}
              onPress={handlePinToggle}
              accessibilityLabel={note.isPinned ? 'Unpin note' : 'Pin note'}
            />
            <Appbar.Action icon="content-copy" onPress={handleCopyAll} accessibilityLabel="Copy note text" />
            <Menu
              visible={menuVisible}
              onDismiss={() => setMenuVisible(false)}
              anchor={<Appbar.Action icon="dots-vertical" onPress={() => setMenuVisible(true)} accessibilityLabel="More options" />}
            >
              {!!note.isMarkdown && (
                <Menu.Item
                  leadingIcon={showRaw ? 'language-markdown' : 'format-text'}
                  title={showRaw ? 'Show formatted text' : 'Show plain text'}
                  onPress={() => { setMenuVisible(false); setShowRaw(v => !v); }}
                />
              )}
              <Menu.Item
                leadingIcon={note.isArchived ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline'}
                title={note.isArchived ? 'Unarchive' : 'Archive'}
                onPress={() => { setMenuVisible(false); handleArchiveToggle(); }}
              />
              <Menu.Item
                leadingIcon="delete-outline"
                title="Move to bin"
                titleStyle={{ color: theme.colors.error }}
                onPress={() => { setMenuVisible(false); handleDelete(); }}
              />
            </Menu>
          </>
        }
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 96 + insets.bottom }]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={reloadNote} tintColor={theme.colors.primary} colors={[theme.colors.primary]} progressBackgroundColor={theme.colors.surfaceContainerHigh} />
        }
      >
        <View style={styles.column}>
          <View onLayout={e => setTitleBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
            <NoteText variant="noteTitle" style={{ color: theme.colors.onSurface }} selectable>
              {note.title}
            </NoteText>
          </View>
          <View style={styles.infoRow}>
            {note.isMarkdown ? infoLabel('language-markdown', 'Markdown') : infoLabel('text', 'Text')}
            {infoLabel('pencil-outline', `Edited ${formatDate(note.updatedAt)}`)}
            {note.isArchived && infoLabel('archive-outline', 'Archived')}
          </View>
          {taskLines.length > 0 && (
            <View style={styles.progress}>
              <ProgressBar
                progress={doneCount / taskLines.length}
                color={theme.colors.secondary}
                style={[styles.progressBar, { backgroundColor: theme.colors.surfaceContainerHighest }]}
              />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {doneCount} of {taskLines.length} done
              </Text>
            </View>
          )}
          <Divider style={styles.divider} />

          <View>
            {note.isMarkdown ? (
              showRaw ? (
                <NoteText variant="noteBody" style={{ color: theme.colors.onSurface }} selectable selectionColor={theme.colors.primary}>
                  {getPlainText(content)}
                </NoteText>
              ) : (
                <MarkdownRenderer content={content.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')} onToggleTask={handleToggleTask} />
              )
            ) : (
              renderPlainText(content)
            )}
            <NoteImages uris={extractImageUris(content, !note.isMarkdown)} />
          </View>

          {related.length > 0 && (
            <View>
              <Divider style={styles.divider} />
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.primary }]}>Related notes</Text>
              {related.map((r, i) => (
                <GroupedRow
                  key={r.id}
                  title={r.title || 'Untitled note'}
                  description={toPreview(r.content) || undefined}
                  icon="note-text-outline"
                  onPress={() => navigation.push('NoteView', { noteId: String(r.id) })}
                  isFirst={i === 0}
                  isLast={i === related.length - 1}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <FAB
        icon="pencil-outline"
        label="Edit"
        onPress={handleEdit}
        accessibilityLabel="Edit note"
        style={[styles.fab, { bottom: space.lg + insets.bottom }]}
      />

      <Snackbar visible={!!snackbar} onDismiss={() => setSnackbar('')} duration={2000} wrapperStyle={{ bottom: 80 + insets.bottom }}>
        {snackbar}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: shape.small,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  progressBar: {
    width: 96,
    height: 4,
    borderRadius: shape.full,
  },
  divider: {
    marginVertical: space.lg,
  },
  sectionTitle: {
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  fab: {
    position: 'absolute',
    right: space.lg,
  },
});

export default NoteViewScreen;
