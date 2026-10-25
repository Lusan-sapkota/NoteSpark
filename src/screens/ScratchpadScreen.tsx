import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Appbar, Text } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { getScratchpad, saveNote, saveScratchpad } from '../storage/notes';
import { continueList, titleFromText } from '../utils/noteText';
import Header, { useHeaderElevation } from '../components/Header';
import Snackbar from '../components/Snackbar';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

type ScratchpadNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Scratchpad'>;

// The profile's scratchpad: saved as you type, filed into notes (all of it, or the selection) or cleared.
const ScratchpadScreen: React.FC = () => {
  const navigation = useNavigation<ScratchpadNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Scratchpad'>>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Snackbar after filing (Open the new note) or clearing (Undo puts the text back).
  const [snackbar, setSnackbar] = useState<{ message: string; noteId?: number; cleared?: string } | null>(null);
  const saved = useRef('');
  const latest = useRef('');
  latest.current = text;

  const flush = useCallback(() => {
    const content = latest.current;
    if (content === saved.current) return;
    const before = saved.current;
    saved.current = content;
    saveScratchpad(content).catch(() => {
      saved.current = before;
      alert("Couldn't save the scratchpad", 'Your text is still here. Keep typing to try again.');
    });
  }, [alert]);

  // Saves half a second after typing stops, when the app goes to the background, and on leaving.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(flush, 500);
    return () => clearTimeout(timer);
  }, [text, loaded, flush]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => state === 'background' && flush());
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  // Reads the pad each time the screen shows (it may have changed under it, e.g. a task ticked on Tasks) and adds
  // shared text; saves when another screen covers it.
  const append = route.params?.append;
  useFocusEffect(
    useCallback(() => {
      getScratchpad()
        .then(content => {
          saved.current = content;
          if (append) {
            setText(content.trimEnd() ? `${content.trimEnd()}\n\n${append}` : append);
            navigation.setParams({ append: undefined });
          } else {
            setText(content);
          }
          setLoaded(true);
        })
        .catch(() => alert("Couldn't open the scratchpad", 'Go back and try again.'));
      return flush;
    }, [append, flush])
  );

  useEffect(() => {
    if (!pendingSelection) return;
    inputRef.current?.setSelection(pendingSelection.start, pendingSelection.end);
    setSelection(pendingSelection);
    setPendingSelection(null);
  }, [text, pendingSelection]);

  const handleChangeText = (next: string) => {
    const list = continueList(text, next, selection.start);
    setText(list ? list.text : next);
    if (list) setPendingSelection({ start: list.cursor, end: list.cursor });
  };

  const hasSelection = selection.start !== selection.end;

  const fileAsNote = async () => {
    const piece = hasSelection ? text.slice(selection.start, selection.end) : text;
    if (!piece.trim()) return;
    try {
      const now = new Date().toISOString();
      const title = titleFromText(piece) || new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      const noteId = await saveNote({ title, content: piece.trim(), isMarkdown: false, createdAt: now, updatedAt: now });
      const rest = hasSelection ? text.slice(0, selection.start) + text.slice(selection.end) : '';
      setText(rest);
      setPendingSelection({ start: hasSelection ? selection.start : 0, end: hasSelection ? selection.start : 0 });
      setSnackbar({ message: 'Filed as a note', noteId });
    } catch {
      alert("Couldn't file the note", 'Your text is still in the scratchpad. Try again.');
    }
  };

  const clear = () => {
    if (!text) return;
    setSnackbar({ message: 'Scratchpad cleared', cleared: text });
    setText('');
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header
        elevated={elevated}
        title="Scratchpad"
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightActions={
          <>
            <Appbar.Action
              icon="note-plus-outline"
              disabled={!(hasSelection ? text.slice(selection.start, selection.end) : text).trim()}
              onPress={fileAsNote}
              accessibilityLabel={hasSelection ? 'File selected text as a note' : 'File as a note'}
            />
            <Appbar.Action icon="eraser" disabled={!text} onPress={clear} accessibilityLabel="Clear scratchpad" />
          </>
        }
      />
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        bottomOffset={space.lg}
      >
        <View style={styles.column}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Saved as you type. Select text to file just that part as a note.
          </Text>
          <TextInput
            ref={inputRef}
            style={[styles.input, theme.fonts.noteBody, { color: theme.colors.onSurface }]}
            value={text}
            onChangeText={handleChangeText}
            onSelectionChange={e => setSelection(e.nativeEvent.selection)}
            editable={loaded}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
            autoFocus
            selectionColor={theme.colors.primary}
            placeholder="Jot it down. File it as a note later, or clear it."
            placeholderTextColor={theme.colors.onSurfaceVariant}
            accessibilityLabel="Scratchpad text"
          />
        </View>
      </KeyboardAwareScrollView>
      <Snackbar
        visible={!!snackbar}
        onDismiss={() => setSnackbar(null)}
        duration={4000}
        action={
          snackbar?.noteId !== undefined
            ? { label: 'Open', onPress: () => navigation.navigate('NoteView', { noteId: String(snackbar.noteId) }) }
            : snackbar?.cleared !== undefined
              ? { label: 'Undo', onPress: () => setText(snackbar.cleared!) }
              : undefined
        }
      >
        {snackbar?.message}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
  input: {
    minHeight: 300,
    marginTop: space.md,
    padding: 0,
  },
});

export default ScratchpadScreen;
