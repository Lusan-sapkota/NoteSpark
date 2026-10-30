import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Button, Icon, SegmentedButtons, Text, TouchableRipple } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import Header, { useHeaderElevation } from '../components/Header';
import { useAlert } from '../components/DialogProvider';
import { RootStackParamList } from '../types';
import { getNoteById, moveNoteToBin, restoreNote, updateNote } from '../storage/notes';
import { getActiveProfile } from '../storage/profiles';
import { isMeaningSearchAvailable, NotePair, notePairs } from '../storage/semanticSearch';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, shape, space } from '../theme/theme';

// Two notes this close, of about the same length, are the same note written twice.
const DUPLICATE_DISTANCE = 0.15;
const isDuplicate = (p: NotePair) => p.distance <= DUPLICATE_DISTANCE && Math.max(p.a.words, p.b.words) <= 2 * Math.min(p.a.words, p.b.words);

const pairKey = (p: NotePair) => `${p.a.id}-${p.b.id}`;
const hiddenKey = (profileId: string) => `tidyHidden:${profileId}`;

const TidyScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Tidy'>>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [pairs, setPairs] = useState<NotePair[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [profileId, setProfileId] = useState('');
  const [mode, setMode] = useState<'links' | 'duplicates'>('links');
  const [done, setDone] = useState<{ message: string; undo: () => Promise<void> } | null>(null);
  const available = isMeaningSearchAvailable();

  const load = useCallback(async () => {
    if (!available) return;
    setPairs(null);
    setFailed(false);
    try {
      const profile = await getActiveProfile();
      setProfileId(profile.id);
      setHidden(JSON.parse((await AsyncStorage.getItem(hiddenKey(profile.id)).catch(() => null)) ?? '[]'));
    } catch {}
    const found = await notePairs();
    setFailed(found === null);
    setPairs(found ?? []);
  }, [available]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hide = (p: NotePair) => {
    const next = [...hidden, pairKey(p)];
    setHidden(next);
    AsyncStorage.setItem(hiddenKey(profileId), JSON.stringify(next)).catch(() => {});
  };
  const drop = (p: NotePair) => setPairs(list => list && list.filter(x => pairKey(x) !== pairKey(p)));
  const fail = (what: string) => alert(`Couldn't ${what}`, 'Try again. If it keeps failing, restart the app.');

  // The link goes in the note edited more recently, as a line at its end.
  const addLink = async (p: NotePair) => {
    try {
      const [x, y] = await Promise.all([getNoteById(p.a.id), getNoteById(p.b.id)]);
      if (!x || !y) throw new Error('missing');
      const [from, to] = x.updatedAt >= y.updatedAt ? [x, y] : [y, x];
      await updateNote({ ...from, content: `${from.content.trimEnd()}\n\nSee also [[${to.title.trim()}]]\n` });
      drop(p);
      setDone({
        message: `Linked ${from.title || 'the note'} to ${to.title}`,
        undo: async () => { await updateNote({ ...from, content: from.content }); await load(); },
      });
    } catch {
      fail('add the link');
    }
  };

  // The note edited more recently keeps its place and gets the other's text at the end; the other goes to the bin.
  const merge = async (p: NotePair) => {
    try {
      const [x, y] = await Promise.all([getNoteById(p.a.id), getNoteById(p.b.id)]);
      if (!x || !y) throw new Error('missing');
      const [keep, other] = x.updatedAt >= y.updatedAt ? [x, y] : [y, x];
      const heading = other.title.trim() ? `**${other.title.trim()}**\n\n` : '';
      await updateNote({ ...keep, content: `${keep.content.trimEnd()}\n\n---\n\n${heading}${other.content.trim()}\n` });
      await moveNoteToBin(other.id);
      drop(p);
      setDone({
        message: 'Notes merged',
        undo: async () => { await updateNote({ ...keep, content: keep.content }); await restoreNote(other.id); await load(); },
      });
    } catch {
      fail('merge the notes');
    }
  };

  const undo = async () => {
    const last = done;
    setDone(null);
    try { await last?.undo(); } catch { alert("Couldn't undo", 'Open the Bin in Settings to restore a merged note.'); }
  };

  const visible = (pairs ?? []).filter(p => !hidden.includes(pairKey(p)) && p.a.title.trim() && p.b.title.trim());
  const duplicates = visible.filter(isDuplicate);
  const links = visible.filter(p => !p.linked && !isDuplicate(p));
  const list = mode === 'links' ? links : duplicates;

  const noteLine = (note: NotePair['a']) => (
    <TouchableRipple
      onPress={() => navigation.navigate('NoteView', { noteId: String(note.id) })}
      accessibilityRole="button"
      accessibilityLabel={`Open ${note.title}`}
      style={styles.noteLine}
    >
      <View style={styles.noteLineInner}>
        <Icon source="note-text-outline" size={20} color={theme.colors.onSurfaceVariant} />
        <Text variant="titleSmall" numberOfLines={2} style={[styles.noteTitle, { color: theme.colors.onSurface }]}>{note.title}</Text>
      </View>
    </TouchableRipple>
  );

  const renderItem = ({ item: p }: { item: NotePair }) => (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceContainerLow }]}>
      {noteLine(p.a)}
      {noteLine(p.b)}
      <Text variant="bodySmall" style={[styles.reason, { color: theme.colors.onSurfaceVariant }]}>
        {mode === 'links'
          ? 'Close in meaning, and neither links to the other.'
          : `Almost the same text (${p.a.words} and ${p.b.words} words). Merging keeps the one edited last and moves the other to the bin.`}
      </Text>
      <View style={styles.actions}>
        <Button onPress={() => hide(p)}>Hide</Button>
        <Button mode="contained-tonal" onPress={() => (mode === 'links' ? addLink(p) : merge(p))}>
          {mode === 'links' ? 'Add link' : 'Merge'}
        </Button>
      </View>
    </View>
  );

  let empty: { title: string; body: string };
  if (!available) empty = { title: 'Needs search by meaning', body: "This build doesn't have the search model. Use a build that includes it to tidy up your notes." };
  else if (failed) empty = { title: "Couldn't look through your notes", body: 'Pull back to this screen to try again, or restart the app.' };
  else if (mode === 'links') empty = { title: 'No link suggestions', body: 'Notes that are close in meaning but not linked show up here.' };
  else empty = { title: 'No duplicates found', body: 'Notes that say almost the same thing show up here.' };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title="Tidy up notes" showBackButton onBackPress={() => navigation.goBack()} />
      <FlatList
        data={list}
        keyExtractor={pairKey}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.column}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <SegmentedButtons
            theme={controlTheme}
            value={mode}
            onValueChange={v => setMode(v as 'links' | 'duplicates')}
            style={styles.mode}
            buttons={[
              { value: 'links', label: pairs ? `Links (${links.length})` : 'Links', icon: 'link-variant' },
              { value: 'duplicates', label: pairs ? `Duplicates (${duplicates.length})` : 'Duplicates', icon: 'content-copy' },
            ]}
          />
        }
        ListEmptyComponent={
          available && pairs === null ? (
            <ActivityIndicator style={styles.busy} accessibilityLabel="Looking through your notes" />
          ) : (
            <View style={styles.empty}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{empty.title}</Text>
              <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>{empty.body}</Text>
            </View>
          )
        }
      />
      <Snackbar visible={!!done} onDismiss={() => setDone(null)} duration={5000} action={{ label: 'Undo', onPress: undo }}>
        {done?.message}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  listContent: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  mode: { marginTop: space.xs, marginBottom: space.md },
  separator: { height: space.sm },
  card: { borderRadius: shape.group, padding: space.md, overflow: 'hidden' },
  noteLine: { minHeight: 48, justifyContent: 'center', borderRadius: shape.small },
  noteLineInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  noteTitle: { flex: 1 },
  reason: { marginTop: space.xs, paddingHorizontal: space.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.sm },
  busy: { marginTop: space.xl },
  empty: { paddingTop: space.xl, paddingHorizontal: space.xs },
  emptyBody: { marginTop: space.xs },
});

export default TidyScreen;
