function convertImagesToLinks(text: string, isMarkdown: boolean): string {
  if (isMarkdown) {
    return text;
  } else {
    let result = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
    result = result.replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1');
    return result;
  }
}
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TextInput, ScrollView, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, IconButton, Portal, SegmentedButtons, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { getNoteById, saveNote, updateNote } from '../storage/database';
import { sendAppNotification } from '../utils/notifications';
import Header, { useHeaderElevation } from '../components/Header';
import MarkdownRenderer from '../components/MarkdownRenderer';
import NoteImages, { extractImageUris } from '../components/NoteImages';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

type EditorScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Editor'>;
type EditorScreenRouteProp = RouteProp<RootStackParamList, 'Editor'>;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

const EditorScreen: React.FC = () => {
  const navigation = useNavigation<EditorScreenNavigationProp>();
  const route = useRoute<EditorScreenRouteProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [saving, setSaving] = useState(false);

  const { noteId } = route.params ?? {};

  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    if (!noteId) {
      setIsEditing(false);
      setTitle('');
      setContent('');
      setIsMarkdown(false);
      setCreatedAt(null);
      setUpdatedAt(null);
      return;
    }
    const loadNote = async () => {
      try {
        const note = await getNoteById(Number(noteId));
        if (note) {
          setTitle(typeof note.title === 'string' ? note.title : String(note.title));
          setContent(Array.isArray(note.content) ? note.content.join('\n') : typeof note.content === 'string' ? note.content : String(note.content));
          setIsMarkdown(!!note.isMarkdown);
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
  }, [noteId]);

  const handleSave = async () => {
    if (saving) return;
    if (!title.trim()) {
      alert('Add a title', 'Notes need a title before you can save them.');
      return;
    }
    setSaving(true);
    try {
      if (isEditing && noteId) {
        await updateNote({
          id: Number(noteId),
          title,
          content,
          isMarkdown
        });
      } else {
        const now = new Date().toISOString();
        await saveNote({
          title,
          content,
          isMarkdown,
          createdAt: now,
          updatedAt: now
        });
        try {
          const notesModule = await import('../storage/notes');
          const notes = await notesModule.getNotes();
          if (notes.length === 1) {
            await sendAppNotification('First note saved', 'Your note is saved on this device.');
          }
        } catch (e) {}
      }
      setTimeout(() => {
        setSaving(false);
        navigation.goBack();
      }, 120);
    } catch (error) {
      setSaving(false);
      console.error('Failed to save note:', error);
      alert("Couldn't save the note", 'Your text is still here. Try saving again.');
    }
  };

  // Replace the selection with `text`, then select [selStart, selEnd] within the inserted text.
  const insert = (text: string, selStart = text.length, selEnd = selStart) => {
    const before = content.slice(0, selection.start);
    const after = content.slice(selection.end);
    setContent(before + text + after);
    setSelection({ start: before.length + selStart, end: before.length + selEnd });
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
    setSelection({ start: end, end });
  };

  const handleAddImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      const uri = result.assets[0].uri;
      insert(isMarkdown ? `![Image](${uri})` : `[Image: ${uri}]`);
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

  const hasSelection = selection.start !== selection.end;
  const showPreview = isMarkdown && isPreview;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
        <Header elevated={elevated}
          title={isEditing ? 'Edit note' : 'New note'}
          showBackButton
          onBackPress={() => navigation.goBack()}
          rightActions={
            <Button mode="contained" onPress={handleSave} loading={saving} disabled={saving} style={styles.save}>
              Save
            </Button>
          }
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.column}>
            <View style={styles.modeRow}>
              <SegmentedButtons
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
                style={[styles.body, styles.contentInput, theme.fonts.noteBody, { color: theme.colors.onSurface }]}
                value={convertImagesToLinks(content, isMarkdown)}
                onChangeText={setContent}
                multiline
                textAlignVertical="top"
                selectionColor={theme.colors.primary}
                placeholder={isMarkdown ? 'Start writing. Markdown works here.' : 'Start writing'}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                autoCorrect
                autoCapitalize="sentences"
                selection={selection}
                onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                accessibilityLabel="Note text"
              />
            )}
          </View>
        </ScrollView>

        {!showPreview && (
          <View style={[styles.toolbar, { backgroundColor: theme.colors.surfaceContainer }]}>
            <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.toolbarContent}>
              {isMarkdown && (
                <>
                  <IconButton icon="format-bold" onPress={() => wrapSelection('**')} accessibilityLabel="Bold" />
                  <IconButton icon="format-italic" onPress={() => wrapSelection('_')} accessibilityLabel="Italic" />
                  <IconButton icon="format-header-pound" onPress={() => prefixLines('## ')} accessibilityLabel="Heading" />
                  <IconButton icon="format-list-bulleted" onPress={() => prefixLines('- ')} accessibilityLabel="Bulleted list" />
                  <IconButton icon="link-variant" onPress={() => setShowLinkDialog(true)} accessibilityLabel="Add link" />
                </>
              )}
              <IconButton icon="image-outline" onPress={handleAddImage} accessibilityLabel="Add image" />
              <IconButton
                icon="selection-remove"
                disabled={!hasSelection}
                onPress={() => insert('')}
                accessibilityLabel="Delete selected text"
              />
            </ScrollView>
          </View>
        )}

        <Portal>
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
        </Portal>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
  contentInput: {
    minHeight: 300,
    padding: 0,
  },
  toolbar: {
    paddingHorizontal: space.xs,
  },
  toolbarContent: {
    alignItems: 'center',
  },
  dialogContent: {
    gap: space.md,
  },
});

export default EditorScreen;
