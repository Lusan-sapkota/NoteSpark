import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet, View, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { ActivityIndicator, AnimatedFAB, Appbar, Button, Chip, Searchbar, Snackbar, Text } from 'react-native-paper';
import Menu from '../components/Menu';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getNotes, deleteNote, setNotePinned } from '../storage/notes';
import { getActiveProfile, getProfiles, Profile, switchProfile } from '../storage/profiles';
import { isMeaningSearchAvailable, searchByMeaning, syncSearchIndex } from '../storage/semanticSearch';
import { Note } from '../types';
import Header, { useHeaderElevation } from '../components/Header';
import NoteItem from '../components/NoteItem';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { space } from '../theme/theme';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const typeFilters = [
  { value: 'all', label: 'All' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
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
  const [searchType, setSearchType] = useState<'all' | 'title' | 'content' | 'meaning'>('all');
  const [meaningIds, setMeaningIds] = useState<number[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'pinned' | 'markdown' | 'text'>('all');
  const [sortType, setSortType] = useState<'edited' | 'created'>('edited');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [fabExtended, setFabExtended] = useState(true);
  const [snackbar, setSnackbar] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const lastOffset = useRef(0);

  const loadNotes = async () => {
    try {
      setLoading(true);
      const [list, active] = await Promise.all([getProfiles(), getActiveProfile()]);
      setProfiles(list);
      setActiveProfile(active);
      const fetchedNotes = await getNotes();
      setNotes(fetchedNotes);
      setLoading(false);
      syncSearchIndex().catch(error => console.warn('Search index update failed:', error));
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

  const handleSwitchProfile = async (profile: Profile) => {
    setProfileMenuVisible(false);
    if (profile.id === activeProfile?.id) return;
    try {
      await switchProfile(profile.id);
      setSearchText('');
      await loadNotes();
      setSnackbar(`Switched to ${profile.name}`);
    } catch (error) {
      console.error('Failed to switch profile:', error);
      alert("Couldn't switch profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadNotes();
    setRefreshing(false);
  };

  useEffect(() => {
    const query = searchText.trim();
    if (searchType !== 'meaning' || !query) {
      setMeaningIds(null);
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      const ids = await searchByMeaning(query);
      if (current) setMeaningIds(ids);
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [searchText, searchType, notes]);

  const filteredNotes = useMemo(() => {
    let filtered = notes;
    if (filter === 'pinned') filtered = filtered.filter(n => n.isPinned);
    else if (filter !== 'all') {
      filtered = filtered.filter(n => filter === 'markdown' ? n.isMarkdown : !n.isMarkdown);
    }
    if (searchType === 'meaning' && searchText.trim() && meaningIds) {
      const byId = new Map(filtered.map(n => [n.id, n]));
      return meaningIds.map(id => byId.get(id)).filter((n): n is Note => !!n);
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
      const aPinned = a.isPinned ? 1 : 0;
      const bPinned = b.isPinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned; // pinned first
      if (sortType === 'edited') {
        return (new Date(b.updatedAt || 0).getTime()) - (new Date(a.updatedAt || 0).getTime());
      } else {
        return (new Date(b.createdAt || 0).getTime()) - (new Date(a.createdAt || 0).getTime());
      }
    });
    return filtered;
  }, [notes, searchText, searchType, filter, sortType, meaningIds]);

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

  // Updates the list at once, then saves; puts it back if saving fails.
  const handlePinToggle = useCallback(async (noteId: number) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const setPin = (isPinned: boolean) =>
      setNotes(prev => prev.map(n => (n.id === noteId ? { ...n, isPinned } : n)));
    setPin(!note.isPinned);
    try {
      await setNotePinned(noteId, !note.isPinned);
    } catch (error) {
      setPin(note.isPinned);
      alert("Couldn't pin the note", 'Try again. If it keeps failing, restart the app.');
    }
  }, [notes, alert]);

  const renderNoteItem = useCallback(
    ({ item, index }: { item: Note; index: number }) => {
      const isPinned = item.isPinned;
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
          isFirst={!prev || prev.isPinned !== isPinned}
          isLast={!next || next.isPinned !== isPinned}
          showCreated={sortType === 'created'}
        />
      );
    },
    [handleNotePress, handleDeleteNote, handleEditNote, handlePinToggle, filteredNotes, sortType]
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

  const isFiltered = !!searchText.trim() || filter !== 'all';

  const renderEmpty = () => (
    <View style={styles.empty}>
      {isFiltered ? (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
            {searchText.trim()
              ? `No notes match "${searchText.trim()}"`
              : filter === 'pinned' ? 'No pinned notes' : 'No notes of this type'}
          </Text>
          <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
            {!searchText.trim() && filter === 'pinned'
              ? 'Tap the pin on a note to keep it at the top and find it here.'
              : 'Try another word or filter.'}
          </Text>
          <Button
            mode="text"
            onPress={() => { setSearchText(''); setFilter('all'); }}
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
        title={profiles.length > 1 && activeProfile ? activeProfile.name : 'NoteSpark'}
        rightActions={
          <>
            <Menu
              visible={profileMenuVisible}
              onDismiss={() => setProfileMenuVisible(false)}
              anchor={
                <Appbar.Action
                  icon="account-circle-outline"
                  accessibilityLabel={`Switch profile, current profile ${activeProfile?.name ?? ''}`}
                  onPress={() => setProfileMenuVisible(true)}
                />
              }
            >
              {profiles.map(p => (
                <Menu.Item
                  key={p.id}
                  title={p.name}
                  leadingIcon="account-outline"
                  trailingIcon={p.id === activeProfile?.id ? 'check' : undefined}
                  onPress={() => handleSwitchProfile(p)}
                />
              ))}
              <Menu.Item
                title="Manage profiles"
                leadingIcon="account-cog-outline"
                onPress={() => { setProfileMenuVisible(false); navigation.navigate('Settings'); }}
              />
            </Menu>
            <Appbar.Action icon="checkbox-marked-outline" accessibilityLabel="Tasks" onPress={() => navigation.navigate('Tasks')} />
            <Appbar.Action icon="cog-outline" accessibilityLabel="Settings" onPress={() => navigation.navigate('Settings')} />
          </>
        }
      />

      <View style={[styles.controls, { backgroundColor: elevated ? theme.colors.elevation.level2 : theme.colors.background }]}>
        <Searchbar
          placeholder={searchType === 'meaning' ? 'Search by meaning' : 'Search notes'}
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
              {isMeaningSearchAvailable() && (
                <Menu.Item
                  title="Search by meaning"
                  trailingIcon={searchType === 'meaning' ? 'check' : undefined}
                  onPress={() => { setSearchType('meaning'); setOptionsVisible(false); }}
                />
              )}
            </Menu>
          )}
        />
        <View style={styles.chips}>
          {typeFilters.map(f => (
            <Chip
              key={f.value}
              mode="outlined"
              selected={filter === f.value}
              showSelectedOverlay={false}
              onPress={() => setFilter(f.value)}
              accessibilityState={{ selected: filter === f.value }}
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
