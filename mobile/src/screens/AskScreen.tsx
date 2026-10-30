import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Searchbar, SegmentedButtons, Text, TouchableRipple } from 'react-native-paper';
import { RootStackParamList } from '../types';
import Header, { useHeaderElevation } from '../components/Header';
import { isMeaningSearchAvailable, Passage, searchPassages } from '../storage/semanticSearch';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, groupCorners, readingWidth, shape, space } from '../theme/theme';

type Row =
  | { kind: 'month'; key: string; title: string }
  | { kind: 'passage'; key: string; passage: Passage; isFirst: boolean; isLast: boolean };

const monthOf = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

// Best match: closest first, as one group. Timeline: oldest first under month headings, to see how a topic grew.
const buildRows = (passages: Passage[], timeline: boolean): Row[] => {
  if (!timeline) {
    return passages.map((passage, i) => ({ kind: 'passage', key: String(passage.noteId), passage, isFirst: i === 0, isLast: i === passages.length - 1 }));
  }
  const sorted = [...passages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows: Row[] = [];
  sorted.forEach((passage, i) => {
    const month = monthOf(passage.createdAt);
    const newMonth = i === 0 || monthOf(sorted[i - 1].createdAt) !== month;
    if (newMonth) rows.push({ kind: 'month', key: `m-${month}-${i}`, title: month });
    const lastInMonth = i === sorted.length - 1 || monthOf(sorted[i + 1].createdAt) !== month;
    rows.push({ kind: 'passage', key: String(passage.noteId), passage, isFirst: newMonth, isLast: lastInMonth });
  });
  return rows;
};

const AskScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Ask'>>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const available = isMeaningSearchAvailable();

  const ask = async () => {
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailed(false);
    const found = await searchPassages(text);
    setAsked(text);
    setPassages(found ?? []);
    setFailed(found === null);
    setBusy(false);
  };

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'month') {
      return (
        <Text variant="titleSmall" accessibilityRole="header" style={[styles.month, { color: theme.colors.primary }]}>{item.title}</Text>
      );
    }
    const { passage } = item;
    return (
      <View style={[groupCorners(item.isFirst, item.isLast), styles.card, { backgroundColor: theme.colors.surfaceContainerLow }, !item.isLast && styles.gap]}>
        <TouchableRipple
          onPress={() => navigation.navigate('NoteView', { noteId: String(passage.noteId), find: passage.find || undefined })}
          accessibilityRole="button"
          accessibilityLabel={`${passage.title || 'Untitled note'}. ${passage.excerpt}`}
          accessibilityHint="Opens the note at this passage"
          style={styles.cardPress}
        >
          <View>
            <Text variant="titleMedium" numberOfLines={2} style={{ color: theme.colors.onSurface }}>{passage.title || 'Untitled note'}</Text>
            <Text variant="bodyMedium" numberOfLines={6} style={[styles.excerpt, { color: theme.colors.onSurfaceVariant }]}>{passage.excerpt}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {timeline ? 'Written' : 'Edited'} {dayOf(timeline ? passage.createdAt : passage.updatedAt)}
            </Text>
          </View>
        </TouchableRipple>
      </View>
    );
  };

  let empty: { title: string; body: string };
  if (!available) empty = { title: 'Needs search by meaning', body: "This build doesn't have the search model. Use a build that includes it to ask your notes." };
  else if (failed) empty = { title: "Couldn't search", body: 'Try again. If it keeps failing, restart the app.' };
  else if (passages && !busy) empty = { title: 'No passages found', body: 'Try other words, or say it the way you would write it in a note.' };
  else empty = { title: 'Ask in your own words', body: 'NoteSpark shows the passages from your notes that say it, never made-up answers. Everything is found on this device.' };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title="Ask your notes" showBackButton onBackPress={() => navigation.goBack()} />
      <FlatList
        data={passages ? buildRows(passages, timeline) : []}
        keyExtractor={r => r.key}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        style={styles.column}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <Searchbar
              placeholder="Ask a question or name a topic"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={ask}
              returnKeyType="search"
              editable={available}
              style={{ backgroundColor: theme.colors.surfaceContainerHigh, borderRadius: shape.control }}
              accessibilityLabel="Ask your notes"
            />
            <SegmentedButtons
              theme={controlTheme}
              value={timeline ? 'timeline' : 'best'}
              onValueChange={v => setTimeline(v === 'timeline')}
              style={styles.mode}
              buttons={[
                { value: 'best', label: 'Best match', icon: 'target' },
                { value: 'timeline', label: 'Timeline', icon: 'timeline-clock-outline' },
              ]}
            />
            {busy && <ActivityIndicator style={styles.busy} accessibilityLabel={`Searching for ${query}`} />}
            {!!passages?.length && !busy && (
              <Text variant="bodySmall" style={[styles.count, { color: theme.colors.onSurfaceVariant }]}>
                {passages.length} {passages.length === 1 ? 'passage' : 'passages'} for "{asked}"
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          busy ? undefined : (
            <View style={styles.empty}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{empty.title}</Text>
              <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>{empty.body}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  listContent: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: space.xxl },
  mode: { marginTop: space.md },
  busy: { marginTop: space.xl },
  count: { marginTop: space.md, marginBottom: space.xs },
  month: { minHeight: 48, marginTop: space.md, textAlignVertical: 'center' },
  card: { overflow: 'hidden' },
  gap: { marginBottom: 2 },
  cardPress: { padding: space.lg, minHeight: 48 },
  excerpt: { marginTop: space.xs, marginBottom: space.sm },
  empty: { paddingTop: space.xl, paddingHorizontal: space.xs },
  emptyBody: { marginTop: space.xs },
});

export default AskScreen;
