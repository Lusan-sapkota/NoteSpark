import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Clipboard, RefreshControl, View, StyleSheet, ScrollView, Linking, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Appbar, Button, Dialog, Divider, FAB, Icon, IconButton, List, Portal, ProgressBar, Searchbar, Text, TouchableRipple } from 'react-native-paper';
import { useReducedMotion } from 'react-native-reanimated';
import Snackbar from '../components/Snackbar';
import Menu from '../components/Menu';
import { getNoteById, getNotes, getNotesWithLinks, getNoteVersions, moveNoteToBin, setNoteArchived, setNotePinned, updateNote } from '../storage/notes';
import { findTaskLines, formatDue, splitDue, toggleTaskLine } from '@notespark/core';
import { extractTags } from '@notespark/core';
import { findMention, findNoteByTitle, linkMention, linksTo, noteLinkPattern } from '@notespark/core';
import { shareNoteAsMarkdown } from '../utils/exportNotes';
import { Note, NoteVersion } from '../types';
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

type Change = { text: string; type: 'same' | 'removed' | 'added' };

// Word-level changes from a to b; a middle too big to compare shows as replaced.
const diffWords = (a: string, b: string): Change[] => {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e);
  const b2 = B.slice(s, B.length - e);
  const parts: Change[] = [{ text: A.slice(0, s).join(''), type: 'same' }];
  const push = (text: string, type: Change['type']) => {
    const last = parts[parts.length - 1];
    if (last.type === type) last.text += text;
    else parts.push({ text, type });
  };
  if (a2.length * b2.length > 1_000_000) {
    push(a2.join(''), 'removed');
    push(b2.join(''), 'added');
  } else {
    // Longest common subsequence, from the end, then walked from the start.
    const L = Array.from({ length: a2.length + 1 }, () => new Uint16Array(b2.length + 1));
    for (let i = a2.length - 1; i >= 0; i--)
      for (let j = b2.length - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < a2.length || j < b2.length) {
      if (i < a2.length && j < b2.length && a2[i] === b2[j]) { push(a2[i++], 'same'); j++; }
      else if (j >= b2.length || (i < a2.length && L[i + 1][j] >= L[i][j + 1])) push(a2[i++], 'removed');
      else push(b2[j++], 'added');
    }
  }
  push(A.slice(A.length - e).join(''), 'same');
  return parts.filter(p => p.text);
};

const linkRegex = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}\b)/g;
// Plain notes: a [[note link]] (group 1) or a web link.
const plainLinkRegex = new RegExp(`${noteLinkPattern.source}|${linkRegex.source}`, 'g');

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
  const [backlinks, setBacklinks] = useState<Note[]>([]);
  // Notes that name this one without a [[link]].
  const [mentions, setMentions] = useState<Note[]>([]);
  const [showChanges, setShowChanges] = useState(true);
  // Find in note: the query and current match; lines are drawn plain while finding so each can be measured.
  const [find, setFind] = useState<{ query: string; index: number } | null>(null);
  const findParam: string | undefined = (route.params as any)?.find;
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const bodyY = useRef(0);
  const lineY = useRef<Record<number, number>>({});
  const reduceMotion = useReducedMotion();
  // Version history: the list, or one version being read. Kept after closing so it doesn't change while fading.
  const [history, setHistory] = useState<{ versions: NoteVersion[]; viewing: NoteVersion | null; open: boolean } | null>(null);
  const closeHistory = () => setHistory(h => h && { ...h, open: false });
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

  // The spinner only shows for a pull; opening or returning to the note reloads quietly.
  const reloadNote = async (pulled = false) => {
    if (pulled) setRefreshing(true);
    if ((route.params as any)?.noteId) {
      try {
        const fetchedNote = await getNoteById((route.params as any).noteId);
        setNote(fetchedNote);
        if (fetchedNote) {
          const linking = await getNotesWithLinks();
          setBacklinks(linking.filter(n => n.id !== fetchedNote.id && linksTo(n.content, fetchedNote.title)));
          const others = (await getNotes()).filter(n => n.id !== fetchedNote.id && !linksTo(n.content, fetchedNote.title));
          setMentions(others.filter(n => findMention(n.content, fetchedNote.title) >= 0).slice(0, 10));
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
      await updateNote(updated, { keepVersion: false });
      if (result.next) setSnackbar(`Next due ${formatDue(result.next)}`);
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

  // [[Title]]: open the note with that title, or offer to start one.
  const openNoteLink = async (title: string) => {
    try {
      const target = findNoteByTitle(await getNotes(), title);
      if (target) {
        navigation.push('NoteView', { noteId: String(target.id) });
        return;
      }
      alert(`No note called "${title}"`, 'Start a new note with this title?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'New note', onPress: () => navigation.navigate('Editor', { title }) },
      ]);
    } catch (error) {
      alert("Couldn't open the linked note", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const linkFromMention = async (other: Note) => {
    if (!note) return;
    try {
      await updateNote({ ...other, content: linkMention(other.content, note.title) });
      await reloadNote();
      setSnackbar('Link added');
    } catch (error) {
      alert("Couldn't add the link", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const openHistory = async () => {
    if (!note) return;
    try {
      setHistory({ versions: await getNoteVersions(note.id), viewing: null, open: true });
    } catch (error) {
      alert("Couldn't load the version history", 'Try again. If it keeps failing, restart the app.');
    }
  };

  // The current text becomes a version too, so restoring can be undone from the same list.
  const restoreVersion = async (version: NoteVersion) => {
    if (!note) return;
    try {
      await updateNote({ id: note.id, title: version.title, content: version.content, isMarkdown: version.isMarkdown });
      closeHistory();
      await reloadNote();
      setSnackbar('Version restored');
    } catch (error) {
      alert("Couldn't restore the version", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleEdit = () => {
    navigation.navigate('Editor', { noteId: note!.id });
  };

  // Plain notes: URLs become links that ask before opening; task lines become checkboxes.
  const renderPlainText = (content: string) => {
    const tasks = findTaskLines(content);
    return content.replace(/\[Image: ([^\]]+)\]/g, '').split(/\r?\n/).map((line, lineIdx) => {
      const taskIndex = tasks.findIndex(t => t.line === lineIdx);
      if (taskIndex >= 0) {
        const task = tasks[taskIndex];
        const { text, due, every } = splitDue(task.text);
        return (
          <TaskRow key={`line-${lineIdx}`} done={task.done} due={due} every={every} onPress={() => handleToggleTask(taskIndex)}>
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
      for (const match of line.matchAll(plainLinkRegex)) {
        const url = match[0];
        const noteTitle = match[1]?.trim();
        if (match.index! > lastIndex) parts.push(line.substring(lastIndex, match.index));
        parts.push(
          <Text
            key={`link-${lineIdx}-${match.index}`}
            style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
            onPress={() => (noteTitle ? openNoteLink(noteTitle) : confirmOpenLink(url))}
          >
            {noteTitle ?? url}
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

  // Opened from a Home search: start finding that text, if the note has it.
  const findOpened = useRef(false);
  useEffect(() => {
    if (!note || findOpened.current || !findParam?.trim()) return;
    findOpened.current = true;
    if (note.content.toLowerCase().includes(findParam.trim().toLowerCase())) setFind({ query: findParam.trim(), index: 0 });
  }, [note, findParam]);

  const query = find?.query.trim().toLowerCase() ?? '';
  const matches: { line: number; start: number }[] = [];
  if (note && query) {
    String(note.content).split('\n').forEach((text, line) => {
      const lower = text.toLowerCase();
      for (let i = lower.indexOf(query); i >= 0; i = lower.indexOf(query, i + query.length)) matches.push({ line, start: i });
    });
  }
  const current = find && matches.length ? matches[find.index % matches.length] : null;
  const stepFind = (by: number) => setFind(f => f && { ...f, index: (f.index + by + matches.length) % matches.length });

  // Scrolls the current match into view, once its line has been laid out.
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      const y = lineY.current[current.line];
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, bodyY.current + y - 96), animated: !reduceMotion });
    }, 50);
    return () => clearTimeout(timer);
  }, [current?.line, current?.start, query]);

  const renderFindLines = (content: string) =>
    content.split('\n').map((text, line) => {
      const parts: React.ReactNode[] = [];
      let last = 0;
      matches.filter(m => m.line === line).forEach(m => {
        const isCurrent = m === current;
        parts.push(text.slice(last, m.start));
        parts.push(
          <Text
            key={m.start}
            style={{
              backgroundColor: isCurrent ? theme.colors.tertiary : theme.colors.tertiaryContainer,
              color: isCurrent ? theme.colors.onTertiary : theme.colors.onTertiaryContainer,
            }}
          >
            {text.slice(m.start, m.start + query.length)}
          </Text>
        );
        last = m.start + query.length;
      });
      parts.push(text.slice(last));
      return (
        <View key={line} onLayout={e => { lineY.current[line] = e.nativeEvent.layout.y; }}>
          <NoteText variant="noteBody" style={{ color: theme.colors.onSurface }} selectable selectionColor={theme.colors.primary}>
            {text ? parts : ' '}
          </NoteText>
        </View>
      );
    });

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
                leadingIcon="export-variant"
                title={note.isMarkdown ? 'Export as Markdown' : 'Export as text file'}
                onPress={() => {
                  setMenuVisible(false);
                  shareNoteAsMarkdown(note).catch(() => alert("Couldn't export the note", 'Try again. If it keeps failing, restart the app.'));
                }}
              />
              <Menu.Item
                leadingIcon="magnify"
                title="Find in note"
                onPress={() => { setMenuVisible(false); setFind({ query: '', index: 0 }); }}
              />
              <Menu.Item
                leadingIcon="history"
                title="Version history"
                onPress={() => { setMenuVisible(false); openHistory(); }}
              />
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
      {find && (
        <View style={[styles.findBar, { backgroundColor: elevated ? theme.colors.elevation.level2 : theme.colors.background }]}>
          <Searchbar
            autoFocus
            placeholder="Find in note"
            value={find.query}
            onChangeText={text => setFind({ query: text, index: 0 })}
            icon="close"
            onIconPress={() => setFind(null)}
            searchAccessibilityLabel="Close find"
            style={{ backgroundColor: theme.colors.surfaceContainerHigh, borderRadius: shape.control }}
            inputStyle={styles.findInput}
            right={() => (
              <View style={styles.findActions}>
                {!!query && (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} accessibilityLiveRegion="polite">
                    {matches.length ? `${(find.index % matches.length) + 1} of ${matches.length}` : 'No matches'}
                  </Text>
                )}
                <IconButton icon="chevron-up" disabled={!matches.length} onPress={() => stepFind(-1)} accessibilityLabel="Previous match" />
                <IconButton icon="chevron-down" disabled={!matches.length} onPress={() => stepFind(1)} accessibilityLabel="Next match" />
              </View>
            )}
          />
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 96 + insets.bottom }]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => reloadNote(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} progressBackgroundColor={theme.colors.surfaceContainerHigh} />
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
            {extractTags(content).map(tag => (
              <TouchableRipple
                key={tag}
                onPress={() => navigation.popTo('Home', { tag })}
                accessibilityRole="button"
                accessibilityLabel={`Show notes tagged ${tag}`}
                hitSlop={12}
                borderless
                style={[styles.info, { backgroundColor: theme.colors.tertiaryContainer }]}
              >
                <Text variant="labelMedium" maxFontSizeMultiplier={1.5} style={{ color: theme.colors.onTertiaryContainer }}>#{tag}</Text>
              </TouchableRipple>
            ))}
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

          <View onLayout={e => { bodyY.current = e.nativeEvent.layout.y; }}>
            {query ? (
              renderFindLines(content)
            ) : note.isMarkdown ? (
              showRaw ? (
                <NoteText variant="noteBody" style={{ color: theme.colors.onSurface }} selectable selectionColor={theme.colors.primary}>
                  {getPlainText(content)}
                </NoteText>
              ) : (
                <MarkdownRenderer content={content.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')} onToggleTask={handleToggleTask} onOpenNoteLink={openNoteLink} />
              )
            ) : (
              renderPlainText(content)
            )}
            <NoteImages uris={extractImageUris(content, !note.isMarkdown)} />
          </View>

          {backlinks.length > 0 && (
            <View>
              <Divider style={styles.divider} />
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.primary }]}>Linked from</Text>
              {backlinks.map((b, i) => (
                <GroupedRow
                  key={b.id}
                  title={b.title || 'Untitled note'}
                  description={toPreview(b.content) || undefined}
                  icon="link-variant"
                  onPress={() => navigation.push('NoteView', { noteId: String(b.id) })}
                  isFirst={i === 0}
                  isLast={i === backlinks.length - 1}
                />
              ))}
            </View>
          )}

          {mentions.length > 0 && (
            <View>
              <Divider style={styles.divider} />
              <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.primary }]}>Mentioned in</Text>
              {mentions.map((m, i) => (
                <GroupedRow
                  key={m.id}
                  title={m.title || 'Untitled note'}
                  description={toPreview(m.content) || undefined}
                  icon="text-search"
                  onPress={() => navigation.push('NoteView', { noteId: String(m.id) })}
                  right={
                    <Button compact onPress={() => linkFromMention(m)} accessibilityLabel={`Link this note from ${m.title || 'Untitled note'}`}>
                      Link
                    </Button>
                  }
                  isFirst={i === 0}
                  isLast={i === mentions.length - 1}
                />
              ))}
            </View>
          )}

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

      <Portal>
        <Dialog visible={!!history?.open} onDismiss={closeHistory}>
          <Dialog.Title>{history?.viewing ? history.viewing.title || 'Untitled note' : 'Version history'}</Dialog.Title>
          {history?.viewing ? (
            <>
              <Dialog.ScrollArea style={styles.historyArea}>
                <ScrollView contentContainerStyle={styles.historyText}>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Saved until {formatDate(history.viewing.savedAt)}
                  </Text>
                  {showChanges && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      Changes made after this version: removed text is struck through, added text is underlined.
                    </Text>
                  )}
                  <NoteText variant="noteBody" style={{ color: theme.colors.onSurface }} selectable>
                    {showChanges
                      ? diffWords(history.viewing.content, (history.versions[history.versions.indexOf(history.viewing) - 1] ?? note).content).map((c, i) =>
                          c.type === 'same' ? c.text : (
                            <Text
                              key={i}
                              style={c.type === 'removed'
                                ? { textDecorationLine: 'line-through', backgroundColor: theme.colors.errorContainer, color: theme.colors.onErrorContainer }
                                : { textDecorationLine: 'underline', backgroundColor: theme.colors.tertiaryContainer, color: theme.colors.onTertiaryContainer }}
                            >
                              {c.text}
                            </Text>
                          ))
                      : history.viewing.content || ' '}
                  </NoteText>
                </ScrollView>
              </Dialog.ScrollArea>
              <Dialog.Actions>
                <Button onPress={() => setHistory(h => h && { ...h, viewing: null })}>Back</Button>
                <Button onPress={() => setShowChanges(v => !v)}>{showChanges ? 'Hide changes' : 'Show changes'}</Button>
                <Button onPress={() => history.viewing && restoreVersion(history.viewing)}>Restore</Button>
              </Dialog.Actions>
            </>
          ) : (
            <>
              <Dialog.ScrollArea style={styles.historyArea}>
                <ScrollView>
                  {history?.versions.length ? history.versions.map(v => (
                    <List.Item
                      key={v.id}
                      title={`Before ${formatDate(v.savedAt)}`}
                      description={toPreview(v.content) || v.title}
                      descriptionNumberOfLines={2}
                      left={props => <List.Icon {...props} icon="history" />}
                      onPress={() => setHistory(h => h && { ...h, viewing: v })}
                    />
                  )) : (
                    <Text variant="bodyMedium" style={[styles.historyText, { color: theme.colors.onSurfaceVariant }]}>
                      No earlier versions yet. Each time you save changes, the version before is kept here (the last 20).
                    </Text>
                  )}
                </ScrollView>
              </Dialog.ScrollArea>
              <Dialog.Actions>
                <Button onPress={() => closeHistory()}>Close</Button>
              </Dialog.Actions>
            </>
          )}
        </Dialog>
      </Portal>

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
  historyArea: {
    maxHeight: 420,
    paddingHorizontal: 0,
  },
  historyText: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    gap: space.sm,
  },
  findBar: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  findInput: {
    minHeight: 0,
  },
  findActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
