function convertImagesToLinks(text: string, isMarkdown: boolean): string {
  if (isMarkdown) {
    return text;
  } else {
    let result = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
    result = result.replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1');
    return result;
  }
}
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TextInput, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, usePreventRemove, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Chip, Dialog, IconButton, List, SegmentedButtons, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { Note, RootStackParamList } from '../types';
import { clearDraft, getDraft, getNoteById, getNotes, saveDraft, saveNote, updateNote } from '../storage/notes';
import { getActiveProfile } from '../storage/profiles';
import { keepDeviceImage } from '../utils/imageCache';
import { addDays, setLineDue } from '@notespark/core';
import { extractTags } from '@notespark/core';
import { continueList, titleFromText } from '@notespark/core';
import { sendAppNotification } from '../utils/notifications';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Header, { useHeaderElevation } from '../components/Header';
import MarkdownRenderer from '../components/MarkdownRenderer';
import NoteImages, { extractImageUris } from '../components/NoteImages';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, space } from '../theme/theme';

type EditorScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Editor'>;
type EditorScreenRouteProp = RouteProp<RootStackParamList, 'Editor'>;

// IconButton (48) plus toolbar padding; used to keep the cursor clear of the toolbar.
const TOOLBAR_HEIGHT = 56;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

const EditorScreen: React.FC = () => {
  const navigation = useNavigation<EditorScreenNavigationProp>();
  const route = useRoute<EditorScreenRouteProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [saving, setSaving] = useState(false);

  const { noteId, title: titleParam, text: textParam, draft: fromDraft } = route.params ?? {};

  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // The cursor is read from the body field, not controlled: a controlled selection on Android fights the
  // field while it gains focus and the keyboard closes again. Toolbar inserts place it once via the ref.
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);
  const bodyRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const insets = useSafeAreaInsets();
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // Undo and redo for the note text. A step is recorded when typing pauses for 600 ms; typing not yet recorded
  // is undone as one step. `committed` is the text at the last recorded step.
  const [undoStack, setUndoStack] = useState<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const committed = useRef('');
  // "Link a note" picker: inserts [[Title]] at the cursor.
  const [notePicker, setNotePicker] = useState<{ query: string; notes: Note[] } | null>(null);
  const [showDueDialog, setShowDueDialog] = useState(false);
  // For suggestions while typing #tags and [[links]]: the profile's tags and other notes' titles.
  const [known, setKnown] = useState<{ tags: string[]; titles: string[] }>({ tags: [], titles: [] });
  // The note as last loaded or saved; anything different is unsaved and kept as a draft.
  const [saved, setSaved] = useState({ title: '', content: '', isMarkdown: false });
  const [loaded, setLoaded] = useState(false);
  // Only the editor that wrote (or reopened) the draft clears it; another editor opening mustn't erase it.
  const ownsDraft = useRef(!!fromDraft);
  const isDirty = loaded && (title !== saved.title || content !== saved.content || isMarkdown !== saved.isMarkdown);

  // Shows `text` as the starting point; a reopened draft goes on top of it, still unsaved.
  const showLoaded = async (start: { title: string; content: string; isMarkdown: boolean }) => {
    setSaved(start);
    const draft = fromDraft ? await getDraft() : null;
    const shown = draft && draft.noteId === noteId ? draft : start;
    setTitle(shown.title);
    setContent(shown.content);
    setIsMarkdown(shown.isMarkdown);
    committed.current = shown.content;
    setUndoStack({ past: [], future: [] });
    setLoaded(true);
  };

  useEffect(() => {
    if (!noteId) {
      setIsEditing(false);
      setCreatedAt(null);
      setUpdatedAt(null);
      showLoaded({ title: '', content: '', isMarkdown: false }).then(() => {
        // Prefilled text (a [[link]] or a share) counts as unsaved.
        if (titleParam) setTitle(titleParam);
        if (textParam) setContent(textParam);
      });
      return;
    }
    const loadNote = async () => {
      try {
        const note = await getNoteById(Number(noteId));
        if (note) {
          await showLoaded({ title: String(note.title), content: String(note.content), isMarkdown: !!note.isMarkdown });
          setIsEditing(true);
          setCreatedAt(note.createdAt);
          setUpdatedAt(note.updatedAt);
        } else {
          alert('Note not found', 'It may have been deleted.');
        }
      } catch (error) {
        console.error('Failed to load note:', error);
        alert("Couldn't open the note", 'Go back and try again.');
      }
    };
    loadNote();
  }, [noteId, titleParam, textParam]);

  useEffect(() => {
    getNotes()
      .then(notes => {
        const others = notes.filter(n => String(n.id) !== String(noteId));
        setKnown({
          tags: [...new Set(others.flatMap(n => extractTags(n.content)))].sort(),
          titles: others.map(n => n.title.trim()).filter(Boolean),
        });
      })
      .catch(() => {});
  }, [noteId]);

  // Keeps unsaved text as a draft a second after typing stops; Home offers it back after a restart.
  useEffect(() => {
    if (!loaded) return;
    if (!isDirty) {
      if (ownsDraft.current) clearDraft();
      return;
    }
    const timer = setTimeout(async () => {
      const profile = await getActiveProfile().catch(() => null);
      ownsDraft.current = true;
      if (profile) saveDraft({ profileId: profile.id, noteId, title, content, isMarkdown });
    }, 1000);
    return () => clearTimeout(timer);
  }, [loaded, isDirty, title, content, isMarkdown]);

  // Leaving with unsaved changes saves them: people go back without pressing Save, and asking each time got in the way.
  // An empty new note is dropped by handleSave. If saving fails the editor stays open with the text.
  usePreventRemove(isDirty && !saving, ({ data }) => {
    handleSave(() => navigation.dispatch(data.action));
  });

  // `then` replaces going back (used when leaving was asked for another way).
  const handleSave = async (then?: () => void) => {
    if (saving) return;
    // An empty new note has nothing to save.
    if (!isEditing && !title.trim() && !content.trim()) {
      setSaved({ title, content, isMarkdown });
      setTimeout(() => (then ? then() : navigation.goBack()), 0);
      return;
    }
    // No title: the first line of text, or else the date and time.
    const noteTitle = title.trim() ? title : titleFromText(content) || formatDate(new Date().toISOString());
    setSaving(true);
    try {
      if (isEditing && noteId) {
        await updateNote({
          id: Number(noteId),
          title: noteTitle,
          content,
          isMarkdown
        });
      } else {
        const now = new Date().toISOString();
        await saveNote({
          title: noteTitle,
          content,
          isMarkdown,
          createdAt: now,
          updatedAt: now
        });
        try {
          const notes = await getNotes();
          if (notes.length === 1) {
            await sendAppNotification('First note saved', 'Your note is saved on this device.');
          }
        } catch (e) {}
      }
      clearDraft();
      setTitle(noteTitle);
      setSaved({ title: noteTitle, content, isMarkdown });
      setTimeout(() => {
        setSaving(false);
        then ? then() : navigation.goBack();
      }, 120);
    } catch (error) {
      setSaving(false);
      console.error('Failed to save note:', error);
      alert("Couldn't save the note", 'Your text is still here. Try saving again.');
    }
  };

  // After an insert re-renders the text, move the cursor to where the insert said.
  useEffect(() => {
    if (!pendingSelection) return;
    bodyRef.current?.setSelection(pendingSelection.start, pendingSelection.end);
    setSelection(pendingSelection);
    setPendingSelection(null);
  }, [content, pendingSelection]);

  useEffect(() => {
    if (content === committed.current) return;
    const timer = setTimeout(() => {
      const previous = committed.current;
      committed.current = content;
      setUndoStack(stack => ({ past: [...stack.past, previous].slice(-100), future: [] }));
    }, 600);
    return () => clearTimeout(timer);
  }, [content]);

  // Swaps in an undone or redone text and puts the cursor at the end of what changed.
  const showText = (text: string) => {
    let same = 0;
    while (same < content.length && same < text.length && content[content.length - 1 - same] === text[text.length - 1 - same]) same++;
    committed.current = text;
    setContent(text);
    setPendingSelection({ start: text.length - same, end: text.length - same });
  };

  const hasUnrecorded = content !== committed.current;
  const canUndo = hasUnrecorded || undoStack.past.length > 0;
  const canRedo = !hasUnrecorded && undoStack.future.length > 0;

  const handleUndo = () => {
    const past = [...undoStack.past];
    const target = hasUnrecorded ? committed.current : past.pop();
    if (target === undefined) return;
    setUndoStack({ past, future: [content, ...undoStack.future] });
    showText(target);
  };

  const handleRedo = () => {
    if (!canRedo) return;
    const [target, ...future] = undoStack.future;
    setUndoStack({ past: [...undoStack.past, content], future });
    showText(target);
  };

  // Replace the selection with `text`, then select [selStart, selEnd] within the inserted text.
  const insert = (text: string, selStart = text.length, selEnd = selStart) => {
    const before = content.slice(0, selection.start);
    const after = content.slice(selection.end);
    setContent(before + text + after);
    setPendingSelection({ start: before.length + selStart, end: before.length + selEnd });
  };

  const wrapSelection = (marker: string) => {
    const selected = content.slice(selection.start, selection.end);
    insert(`${marker}${selected}${marker}`, marker.length, marker.length + selected.length);
  };

  const prefixLines = (prefix: string) => {
    const lineStart = content.lastIndexOf('\n', selection.start - 1) + 1;
    const block = content.slice(lineStart, selection.end);
    const prefixed = block.split('\n').map(line => prefix + line).join('\n');
    setContent(content.slice(0, lineStart) + prefixed + content.slice(selection.end));
    const end = lineStart + prefixed.length;
    setPendingSelection({ start: end, end });
  };

  // Sets the due date of the line the cursor is on (making it a task); null removes it.
  const setDue = (due: string | null) => {
    setShowDueDialog(false);
    const lineStart = content.lastIndexOf('\n', selection.start - 1) + 1;
    const lineEnd = content.indexOf('\n', selection.start) < 0 ? content.length : content.indexOf('\n', selection.start);
    const line = setLineDue(content.slice(lineStart, lineEnd), due);
    setContent(content.slice(0, lineStart) + line + content.slice(lineEnd));
    setPendingSelection({ start: lineStart + line.length, end: lineStart + line.length });
  };

  const handleChangeText = (text: string) => {
    const list = continueList(convertImagesToLinks(content, isMarkdown), text, selection.start);
    setContent(list ? list.text : text);
    if (list) setPendingSelection({ start: list.cursor, end: list.cursor });
  };

  const handleAddImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      try {
        const uri = await keepDeviceImage(result.assets[0].uri);
        insert(isMarkdown ? `![Image](${uri})` : `[Image: ${uri}]`);
      } catch {
        alert("Couldn't add the image", 'Your phone may be low on storage. Free some space and try again.');
      }
    }
  };

  const handleInsertLink = () => {
    if (!linkUrl.trim()) return;
    const url = linkUrl.trim();
    insert(`[${linkText.trim() || url}](${url})`);
    setShowLinkDialog(false);
    setLinkText('');
    setLinkUrl('');
  };

  const openNotePicker = async () => {
    try {
      const notes = (await getNotes()).filter(n => String(n.id) !== String(noteId) && n.title.trim());
      setNotePicker({ query: '', notes });
    } catch (error) {
      alert("Couldn't load your notes", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const pickerMatches = notePicker
    ? notePicker.notes.filter(n => n.title.toLowerCase().includes(notePicker.query.trim().toLowerCase())).slice(0, 6)
    : [];

  const hasSelection = selection.start !== selection.end;

  // The #tag or [[link]] being typed at the cursor, and what could complete it.
  const typed = content.slice(0, selection.start);
  const typingLink = !hasSelection ? /\[\[([^[\]\n]*)$/.exec(typed) : null;
  const typingTag = !hasSelection && !typingLink ? /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)$/u.exec(typed) : null;
  const partial = (typingLink ?? typingTag)?.[1] ?? '';
  const suggestions = typingLink
    ? known.titles.filter(t => t.toLowerCase().includes(partial.trim().toLowerCase())).slice(0, 8)
    : typingTag
      ? known.tags.filter(t => t.startsWith(partial.toLowerCase()) && t !== partial.toLowerCase()).slice(0, 8)
      : [];
  const completeWith = (word: string) => {
    const start = selection.start - partial.length;
    const closing = typingLink && !content.startsWith(']]', selection.start) ? ']]' : '';
    const text = typingLink ? `${word}${closing}` : `${word} `;
    const end = start + text.length + (typingLink && !closing ? 2 : 0);
    setContent(content.slice(0, start) + text + content.slice(selection.start));
    setPendingSelection({ start: end, end });
  };
  const showPreview = isMarkdown && isPreview;

  return (
    <View style={styles.flex}>
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
        <Header elevated={elevated}
          title={isEditing ? 'Edit note' : 'New note'}
          showBackButton
          onBackPress={() => navigation.goBack()}
          rightActions={
            <Button mode="contained" onPress={() => handleSave()} theme={controlTheme} loading={saving} disabled={saving} style={styles.save}>
              Save
            </Button>
          }
        />

        {/* Scrolls the cursor above the keyboard and the toolbar without resizing anything. */}
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          bottomOffset={TOOLBAR_HEIGHT + (suggestions.length ? 48 : 0) + space.lg}
        >
          <View style={styles.column}>
            <View style={styles.modeRow}>
              <SegmentedButtons theme={controlTheme}
                value={isMarkdown ? 'markdown' : 'text'}
                onValueChange={value => setIsMarkdown(value === 'markdown')}
                buttons={[
                  { value: 'text', label: 'Plain text' },
                  { value: 'markdown', label: 'Markdown' },
                ]}
                style={styles.flex}
              />
              {isMarkdown && (
                <IconButton
                  icon={isPreview ? 'eye-off-outline' : 'eye-outline'}
                  selected={isPreview}
                  mode={isPreview ? 'contained-tonal' : undefined}
                  onPress={() => setIsPreview(v => !v)}
                  accessibilityLabel={isPreview ? 'Hide preview' : 'Show preview'}
                />
              )}
            </View>

            <TextInput
              style={[styles.titleInput, theme.fonts.noteTitle, { color: theme.colors.onSurface }]}
              placeholder="Title"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              value={typeof title === 'string' ? title : String(title)}
              onChangeText={setTitle}
              selectionColor={theme.colors.primary}
              accessibilityLabel="Note title"
            />

            {isEditing && (
              <Text variant="bodySmall" style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
                Created {formatDate(createdAt)}, edited {formatDate(updatedAt)}
              </Text>
            )}

            {showPreview ? (
              <View style={styles.body}>
                <MarkdownRenderer content={content.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')} />
                <NoteImages uris={extractImageUris(content)} />
              </View>
            ) : (
              <TextInput
                ref={bodyRef}
                style={[styles.contentInput, theme.fonts.noteBody, { color: theme.colors.onSurface }]}
                value={convertImagesToLinks(content, isMarkdown)}
                onChangeText={handleChangeText}
                multiline
                textAlignVertical="top"
                selectionColor={theme.colors.primary}
                placeholder={isMarkdown ? 'Start writing. Markdown works here.' : 'Start writing'}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                autoCorrect
                autoCapitalize="sentences"
                onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                scrollEnabled={false}
                accessibilityLabel="Note text"
              />
            )}
          </View>
        </KeyboardAwareScrollView>

        {/* Rides on top of the keyboard via a transform; opened offset cancels the bottom inset it already sits on. */}
        {!showPreview && (
          <KeyboardStickyView offset={{ opened: insets.bottom }}>
          <View style={[styles.toolbar, { backgroundColor: theme.colors.surfaceContainer }]}>
            {suggestions.length > 0 && (
              <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.suggestions}>
                {suggestions.map(word => (
                  <Chip
                    key={word}
                    compact
                    icon={typingLink ? 'note-text-outline' : 'pound'}
                    onPress={() => completeWith(word)}
                    hitSlop={8}
                    style={{ backgroundColor: theme.colors.tertiaryContainer }}
                    textStyle={{ color: theme.colors.onTertiaryContainer }}
                    maxFontSizeMultiplier={1.5}
                    accessibilityLabel={typingLink ? `Link to ${word}` : `Tag ${word}`}
                  >
                    {typingLink ? word : `#${word}`}
                  </Chip>
                ))}
              </ScrollView>
            )}
            <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.toolbarContent}>
              <IconButton icon="undo" disabled={!canUndo} onPress={handleUndo} accessibilityLabel="Undo" />
              <IconButton icon="redo" disabled={!canRedo} onPress={handleRedo} accessibilityLabel="Redo" />
              {isMarkdown && (
                <>
                  <IconButton icon="format-bold" onPress={() => wrapSelection('**')} accessibilityLabel="Bold" />
                  <IconButton icon="format-italic" onPress={() => wrapSelection('_')} accessibilityLabel="Italic" />
                  <IconButton icon="format-header-pound" onPress={() => prefixLines('## ')} accessibilityLabel="Heading" />
                  <IconButton icon="format-list-bulleted" onPress={() => prefixLines('- ')} accessibilityLabel="Bulleted list" />
                  <IconButton icon="link-variant" onPress={() => setShowLinkDialog(true)} accessibilityLabel="Add link" />
                </>
              )}
              <IconButton icon="checkbox-marked-outline" onPress={() => prefixLines('- [ ] ')} accessibilityLabel="Task" />
              <IconButton icon="calendar-outline" onPress={() => setShowDueDialog(true)} accessibilityLabel="Due date" />
              <IconButton icon="note-multiple-outline" onPress={openNotePicker} accessibilityLabel="Link a note" />
              <IconButton icon="image-outline" onPress={handleAddImage} accessibilityLabel="Add image" />
              <IconButton
                icon="selection-remove"
                disabled={!hasSelection}
                onPress={() => insert('')}
                accessibilityLabel="Delete selected text"
              />
            </ScrollView>
          </View>
          </KeyboardStickyView>
        )}

        <KeyboardSafePortal>
          <Dialog visible={showLinkDialog} onDismiss={() => setShowLinkDialog(false)}>
            <Dialog.Title>Add link</Dialog.Title>
            <Dialog.Content style={styles.dialogContent}>
              <PaperTextInput mode="outlined" label="Link text" value={linkText} onChangeText={setLinkText} />
              <PaperTextInput
                mode="outlined"
                label="URL"
                placeholder="https://"
                value={linkUrl}
                onChangeText={setLinkUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setShowLinkDialog(false)}>Cancel</Button>
              <Button onPress={handleInsertLink} disabled={!linkUrl.trim()}>Add link</Button>
            </Dialog.Actions>
          </Dialog>
          <Dialog visible={showDueDialog} onDismiss={() => setShowDueDialog(false)}>
            <Dialog.Title>Due date</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                For the task on the cursor's line. You can also type a date like due:{addDays(3)}.
              </Text>
            </Dialog.Content>
            <Dialog.ScrollArea style={styles.dueList}>
              <List.Item title="Today" left={props => <List.Icon {...props} icon="calendar-today" />} onPress={() => setDue(addDays(0))} />
              <List.Item title="Tomorrow" left={props => <List.Icon {...props} icon="calendar-arrow-right" />} onPress={() => setDue(addDays(1))} />
              <List.Item title="Next week" left={props => <List.Icon {...props} icon="calendar-week" />} onPress={() => setDue(addDays(7))} />
              <List.Item title="No due date" left={props => <List.Icon {...props} icon="calendar-remove-outline" />} onPress={() => setDue(null)} />
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button onPress={() => setShowDueDialog(false)}>Cancel</Button>
            </Dialog.Actions>
          </Dialog>
          <Dialog visible={!!notePicker} onDismiss={() => setNotePicker(null)}>
            <Dialog.Title>Link a note</Dialog.Title>
            <Dialog.Content style={styles.dialogContent}>
              <PaperTextInput
                mode="outlined"
                label="Search note titles"
                value={notePicker?.query ?? ''}
                onChangeText={query => setNotePicker(p => p && { ...p, query })}
                autoFocus
              />
              {pickerMatches.map(n => (
                <List.Item
                  key={n.id}
                  title={n.title}
                  titleNumberOfLines={2}
                  left={props => <List.Icon {...props} icon="note-text-outline" />}
                  onPress={() => { insert(`[[${n.title.trim()}]]`); setNotePicker(null); }}
                />
              ))}
              {notePicker && pickerMatches.length === 0 && (
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  {notePicker.notes.length ? 'No note titles match. Try another word.' : 'Save another note first, then link to it here.'}
                </Text>
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setNotePicker(null)}>Cancel</Button>
            </Dialog.Actions>
          </Dialog>
        </KeyboardSafePortal>
      </SafeAreaView>
    </View>
  );

};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  save: {
    marginRight: space.sm,
  },
  scrollContent: {
    flexGrow: 1,
    padding: space.lg,
  },
  column: {
    flexGrow: 1,
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  titleInput: {
    marginTop: space.xl,
    padding: 0,
  },
  meta: {
    marginTop: space.xs,
  },
  body: {
    flexGrow: 1,
    marginTop: space.lg,
  },
  // Grows with the text and lets the screen scroll; nothing resizes it while it gains focus.
  contentInput: {
    minHeight: 300,
    marginTop: space.lg,
    padding: 0,
  },
  toolbar: {
    paddingHorizontal: space.xs,
  },
  toolbarContent: {
    alignItems: 'center',
  },
  suggestions: {
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.sm,
  },
  dialogContent: {
    gap: space.md,
  },
  dueList: {
    paddingHorizontal: 0,
  },
});

export default EditorScreen;
