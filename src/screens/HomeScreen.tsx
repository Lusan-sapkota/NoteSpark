import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet, View, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { ActivityIndicator, AnimatedFAB, Appbar, Button, Chip, Menu, Searchbar, Snackbar, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getNotes, deleteNote } from '../storage/notes';
import { Note } from '../types';
import Header, { useHeaderElevation } from '../components/Header';
import NoteItem from '../components/NoteItem';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { space } from '../theme/theme';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const typeFilters = [
  { value: 'all', label: 'All' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Plain text' },
] as const;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { theme, isDarkMode } = useTheme();
  const { elevated, onScroll: onHeaderScroll } = useHeaderElevation();
  const alert = useAlert();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'title' | 'content'>('all');
  const [filterMarkdown, setFilterMarkdown] = useState<'all' | 'markdown' | 'text'>('all');
  const [sortType, setSortType] = useState<'edited' | 'created'>('edited');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [fabExtended, setFabExtended] = useState(true);
  const [snackbar, setSnackbar] = useState('');
  const lastOffset = useRef(0);
  // Pin state: in-memory for now, should be persisted in DB for full support
  const [pinned, setPinned] = useState<{ [id: number]: boolean }>({});

  const loadNotes = async () => {
    try {
      setLoading(true);
      const fetchedNotes = await getNotes();
      setNotes(fetchedNotes);
      setLoading(false);
    } catch (error) {
      setLoading(false);
      console.error('Failed to load notes:', error);
      alert("Couldn't load notes", 'Pull down on the list to try again.');
    }
  };

  useEffect(() => {
    loadNotes();
    const unsubscribe = navigation.addListener('focus', () => {
      loadNotes();
    });
    return unsubscribe;
  }, [navigation]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadNotes();
    setRefreshing(false);
  };

  const filteredNotes = useMemo(() => {
    let filtered = notes;
    if (filterMarkdown !== 'all') {
      filtered = filtered.filter(n => filterMarkdown === 'markdown' ? n.isMarkdown : !n.isMarkdown);
    }
    if (searchText.trim()) {
      const text = searchText.trim().toLowerCase();
      filtered = filtered.filter(n => {
        if (searchType === 'title') {
          return n.title?.toLowerCase().includes(text);
        } else if (searchType === 'content') {
          return n.content.toLowerCase().includes(text);
        }
        return (n.title?.toLowerCase().includes(text) || n.content.toLowerCase().includes(text));
      });
    }
    filtered = [...filtered].sort((a, b) => {
      const aPinned = pinned[a.id] ? 1 : 0;
      const bPinned = pinned[b.id] ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned; // pinned first
      if (sortType === 'edited') {
        return (new Date(b.updatedAt || 0).getTime()) - (new Date(a.updatedAt || 0).getTime());
      } else {
        return (new Date(b.createdAt || 0).getTime()) - (new Date(a.createdAt || 0).getTime());
      }
    });
    return filtered;
  }, [notes, searchText, searchType, filterMarkdown, sortType, pinned]);

  const handleNotePress = useCallback((noteId: number) => {
    navigation.navigate('NoteView', { noteId: noteId.toString() });
  }, [navigation]);

  const handleDeleteNote = useCallback((noteId: number) => {
    const title = notes.find(n => n.id === noteId)?.title || 'This note';
    alert(
      'Delete note?',
      `"${title}" will be deleted from this device. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteNote(noteId);
              await loadNotes();
              setSnackbar('Note deleted');
            } catch (error) {
              console.error('Failed to delete note:', error);
              alert("Couldn't delete the note", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  }, [notes, alert]);

  const handleEditNote = useCallback((noteId: number) => {
    navigation.navigate('Editor', { noteId: noteId.toString() });
  }, [navigation]);

  const handlePinToggle = useCallback((noteId: number) => {
    setPinned(prev => ({ ...prev, [noteId]: !prev[noteId] }));
    // TODO: persist pin state in DB
  }, []);

  const renderNoteItem = useCallback(
    ({ item, index }: { item: Note; index: number }) => {
      const isPinned = !!pinned[item.id];
      const prev = filteredNotes[index - 1];
      const next = filteredNotes[index + 1];
      return (
        <NoteItem
          note={item}
          onPress={handleNotePress}
          onDelete={handleDeleteNote}
          onEdit={handleEditNote}
          isPinned={isPinned}
          onPinToggle={handlePinToggle}
          isFirst={!prev || !!pinned[prev.id] !== isPinned}
          isLast={!next || !!pinned[next.id] !== isPinned}
          showCreated={sortType === 'created'}
        />
      );
    },
    [handleNotePress, handleDeleteNote, handleEditNote, pinned, handlePinToggle, filteredNotes, sortType]
  );

  const handleCreateNote = () => {
    navigation.navigate('Editor');
  };

  // Extended FAB collapses while scrolling down and expands on scroll up or at the top.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onHeaderScroll(e);
    const y = e.nativeEvent.contentOffset.y;
    const extended = y <= 0 || y < lastOffset.current;
    if (extended !== fabExtended) setFabExtended(extended);
    lastOffset.current = y;
  };

  const isFiltered = !!searchText.trim() || filterMarkdown !== 'all';

  const renderEmpty = () => (
    <View style={styles.empty}>
      {isFiltered ? (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
            {searchText.trim() ? `No notes match "${searchText.trim()}"` : 'No notes of this type'}
          </Text>
          <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
            Try another word or filter.
          </Text>
          <Button
            mode="text"
            onPress={() => { setSearchText(''); setFilterMarkdown('all'); }}
            style={styles.emptyAction}
          >
            Clear search and filters
          </Button>
        </>
      ) : (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>No notes yet</Text>
          <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
            Tap New note to write your first one.
          </Text>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated}
        title="NoteSpark"
        rightActions={
          <Appbar.Action icon="cog-outline" accessibilityLabel="Settings" onPress={() => navigation.navigate('Settings')} />
        }
      />

      <View style={[styles.controls, { backgroundColor: elevated ? theme.colors.elevation.level2 : theme.colors.background }]}>
        <Searchbar
          placeholder="Search notes"
          value={searchText}
          onChangeText={setSearchText}
          style={{ backgroundColor: theme.colors.surfaceContainerHigh }}
          inputStyle={styles.searchInput}
          right={() => (
            <Menu
              visible={optionsVisible}
              onDismiss={() => setOptionsVisible(false)}
              anchor={
                <Appbar.Action
                  icon="sort"
                  accessibilityLabel="Sort and search options"
                  onPress={() => setOptionsVisible(true)}
                  color={theme.colors.onSurfaceVariant}
                />
              }
            >
              <Menu.Item
                title="Sort by last edited"
                trailingIcon={sortType === 'edited' ? 'check' : undefined}
                onPress={() => { setSortType('edited'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title="Sort by date created"
                trailingIcon={sortType === 'created' ? 'check' : undefined}
                onPress={() => { setSortType('created'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title="Search titles and text"
                trailingIcon={searchType === 'all' ? 'check' : undefined}
                onPress={() => { setSearchType('all'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title="Search titles only"
                trailingIcon={searchType === 'title' ? 'check' : undefined}
                onPress={() => { setSearchType('title'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title="Search text only"
                trailingIcon={searchType === 'content' ? 'check' : undefined}
                onPress={() => { setSearchType('content'); setOptionsVisible(false); }}
              />
            </Menu>
          )}
        />
        <View style={styles.chips}>
          {typeFilters.map(f => (
            <Chip
              key={f.value}
              mode="outlined"
              selected={filterMarkdown === f.value}
              showSelectedOverlay={false}
              onPress={() => setFilterMarkdown(f.value)}
              accessibilityState={{ selected: filterMarkdown === f.value }}
            >
              {f.label}
            </Chip>
          ))}
        </View>
      </View>

      {loading && notes.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <Animated.FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderNoteItem}
          itemLayoutAnimation={LinearTransition.springify()}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onScroll={handleScroll}
          scrollEventThrottle={64}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      <AnimatedFAB
        icon="star-four-points"
        label="New note"
        extended={fabExtended}
        onPress={handleCreateNote}
        animateFrom="right"
        accessibilityLabel="New note"
        // The firefly: a soft primary glow under the FAB in dark mode (Android 9+ tints elevation shadows).
        style={[styles.fab, isDarkMode && { shadowColor: theme.colors.primary }]}
      />

      <Snackbar
        visible={!!snackbar}
        onDismiss={() => setSnackbar('')}
        duration={3000}
        wrapperStyle={styles.snackbar}
      >
        {snackbar}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controls: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.md,
  },
  searchInput: {
    minHeight: 0,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingTop: space.xs,
    paddingBottom: 96,
  },
  empty: {
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
  },
  emptyBody: {
    marginTop: space.xs,
  },
  emptyAction: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    marginLeft: -space.md,
  },
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
  },
  snackbar: {
    bottom: 80,
  },
});

export default HomeScreen;
