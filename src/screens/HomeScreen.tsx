import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { BackHandler, RefreshControl, ScrollView, StyleSheet, View, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { AnimatedFAB, Appbar, Button, Chip, Dialog, List, Portal, Searchbar, Text, TextInput } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import Menu from '../components/Menu';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getNotes, moveNoteToBin, restoreNote, setNoteArchived, setNotePinned } from '../storage/notes';
import { eraseForgottenProfile, getActiveProfile, getProfiles, Profile, switchProfile, unlockWithBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';
import { isMeaningSearchAvailable, searchByMeaning, syncSearchIndex } from '../storage/semanticSearch';
import { Note } from '../types';
import { extractTags } from '../utils/tags';
import { shareNotesAsJson, shareNotesAsZip } from '../utils/exportNotes';
import { syncTaskReminders } from '../utils/taskReminders';
import { updateWidgets } from '../widget/widgets';
import Header, { useHeaderElevation } from '../components/Header';
import NoteItem from '../components/NoteItem';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { groupCorners, shape, space } from '../theme/theme';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const typeFilters = [
  { value: 'all', label: 'All' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
  { value: 'archived', label: 'Archived' },
] as const;

type Filter = typeof typeFilters[number]['value'] | `tag:${string}`;

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
  const [filter, setFilter] = useState<Filter>('all');
  const [sortType, setSortType] = useState<'edited' | 'created'>('edited');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [fabExtended, setFabExtended] = useState(true);
  const [snackbar, setSnackbar] = useState('');
  // What the snackbar's Undo does, if it has one.
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
  const route = useRoute<RouteProp<RootStackParamList, 'Home'>>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [profileDialogVisible, setProfileDialogVisible] = useState(false);
  const [pinDialog, setPinDialog] = useState<{ profile: Profile; pin: string; open: boolean } | null>(null);
  const lastOffset = useRef(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selecting = selectedIds.length > 0;
  const clearSelection = () => setSelectedIds([]);

  const loadNotes = async () => {
    // Only the first load shows the skeleton; reloads on focus keep the current list until the new one arrives.
    try {
      const [list, active] = await Promise.all([getProfiles(), getActiveProfile()]);
      setProfiles(list);
      setActiveProfile(active);
      const fetchedNotes = await getNotes();
      setNotes(fetchedNotes);
      setLoading(false);
      syncSearchIndex().catch(error => console.warn('Search index update failed:', error));
      syncTaskReminders().catch(error => console.warn('Task reminders update failed:', error));
      updateWidgets().catch(error => console.warn('Widget update failed:', error));
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

  const handleSwitchProfile = async (profile: Profile, pin?: string) => {
    setProfileDialogVisible(false);
    if (profile.id === activeProfile?.id) return;
    try {
      const enteredPin = pin ?? '';
      if (pin === undefined && !(await verifyProfilePin(profile.id, ''))) {
        // Fingerprint first if it's on; otherwise, or on "Use PIN", the PIN dialog.
        if (!(await unlockWithBiometrics(profile))) {
          setPinDialog({ profile, pin: '', open: true });
          return;
        }
      } else if (!(await verifyProfilePin(profile.id, enteredPin))) {
        alert('Incorrect PIN', await wrongPinMessage(profile.id));
        return;
      }
      setPinDialog(d => d && { ...d, open: false });
      await switchProfile(profile.id, enteredPin);
      setSearchText('');
      await loadNotes();
      setSnackbar(`Switched to ${profile.name}`);
    } catch (error) {
      console.error('Failed to switch profile:', error);
      alert("Couldn't switch profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  // A PIN can't be recovered, so a forgotten one means erasing that profile.
  const handleForgotPin = (profile: Profile) => {
    setPinDialog(d => d && { ...d, open: false });
    alert(
      'Erase this profile?',
      `A forgotten PIN can't be recovered. ${profile.name} and all its notes will be erased from this device. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase profile',
          style: 'destructive',
          onPress: async () => {
            try {
              await eraseForgottenProfile(profile.id);
              await loadNotes();
              setSnackbar(`${profile.name} erased`);
            } catch (error) {
              alert("Couldn't erase the profile", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
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

  // Tag chips, most used first, from notes outside the archive.
  const tagsByNote = useMemo(() => new Map(notes.map(n => [n.id, extractTags(n.content)])), [notes]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    notes.filter(n => !n.isArchived).forEach(n => tagsByNote.get(n.id)!.forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  }, [notes, tagsByNote]);

  const filteredNotes = useMemo(() => {
    // Archived notes only show under the Archived filter.
    let filtered = notes.filter(n => (filter === 'archived') === n.isArchived);
    if (filter === 'pinned') filtered = filtered.filter(n => n.isPinned);
    else if (filter.startsWith('tag:')) filtered = filtered.filter(n => tagsByNote.get(n.id)!.includes(filter.slice(4)));
    else if (filter === 'markdown' || filter === 'text') {
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
  }, [notes, tagsByNote, searchText, searchType, filter, sortType, meaningIds]);

  const handleSelect = useCallback((noteId: number) => {
    setSelectedIds(ids => (ids.includes(noteId) ? ids.filter(id => id !== noteId) : [...ids, noteId]));
  }, []);

  // Back leaves selection first; a new filter or search starts over.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => sub.remove();
  }, [selecting]);
  useEffect(clearSelection, [filter, searchText, searchType]);

  const selectedNotes = notes.filter(n => selectedIds.includes(n.id));
  const countLabel = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

  // Runs `change` on every selected note, then offers Undo that runs `revert` on each.
  const changeSelected = async (
    change: (note: Note) => Promise<void>,
    revert: (note: Note) => Promise<void>,
    done: string,
    failed: string,
  ) => {
    const targets = selectedNotes;
    try {
      for (const note of targets) await change(note);
      clearSelection();
      setUndo(() => async () => {
        try {
          for (const note of targets) await revert(note);
        } catch (error) {
          alert("Couldn't undo", 'Some notes may have changed. Check them and try again.');
        }
        await loadNotes();
      });
      setSnackbar(done);
    } catch (error) {
      alert(failed, 'Some notes may have changed. Try again.');
    }
    await loadNotes();
  };

  const handlePinSelected = () => {
    const pin = selectedNotes.some(n => !n.isPinned);
    changeSelected(
      n => setNotePinned(n.id, pin),
      n => setNotePinned(n.id, n.isPinned),
      `${countLabel(selectedNotes.length)} ${pin ? 'pinned' : 'unpinned'}`,
      pin ? "Couldn't pin the notes" : "Couldn't unpin the notes",
    );
  };

  const handleArchiveSelected = () => {
    const archive = filter !== 'archived';
    changeSelected(
      n => setNoteArchived(n.id, archive),
      async n => {
        await setNoteArchived(n.id, n.isArchived);
        if (n.isPinned) await setNotePinned(n.id, true);
      },
      `${countLabel(selectedNotes.length)} ${archive ? 'archived' : 'unarchived'}`,
      archive ? "Couldn't archive the notes" : "Couldn't unarchive the notes",
    );
  };

  const handleBinSelected = () => {
    alert(
      `Move ${countLabel(selectedNotes.length)} to bin?`,
      'They stay in the bin for 30 days. You can restore them from Bin in Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to bin',
          style: 'destructive',
          onPress: () => changeSelected(
            n => moveNoteToBin(n.id),
            n => restoreNote(n.id),
            `${countLabel(selectedNotes.length)} moved to bin`,
            "Couldn't move the notes to the bin",
          ),
        },
      ]
    );
  };

  const handleExportSelected = () => {
    const targets = selectedNotes;
    const run = (share: (notes: Note[]) => Promise<void>) => async () => {
      try {
        await share(targets);
        clearSelection();
      } catch (error) {
        alert("Couldn't export the notes", 'Try again. If it keeps failing, use Import and export in Settings.');
      }
    };
    alert(
      `Export ${countLabel(targets.length)}?`,
      'A JSON backup can be restored into NoteSpark. Markdown files (in a zip) open in other notes apps.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'JSON backup', onPress: run(shareNotesAsJson) },
        { text: 'Markdown', onPress: run(shareNotesAsZip) },
      ]
    );
  };

  const handleNotePress = useCallback((noteId: number) => {
    navigation.navigate('NoteView', { noteId: noteId.toString() });
  }, [navigation]);

  const showBinned = (noteId: number) => {
    setUndo(() => async () => {
      try {
        await restoreNote(noteId);
        await loadNotes();
      } catch (error) {
        alert("Couldn't restore the note", 'Open Bin in Settings to restore it.');
      }
    });
    setSnackbar('Note moved to bin');
  };

  // The note page bins without asking and comes back here, so Undo is offered here.
  const binnedNoteId = route.params?.binnedNoteId;
  useEffect(() => {
    if (binnedNoteId === undefined) return;
    showBinned(binnedNoteId);
    navigation.setParams({ binnedNoteId: undefined });
  }, [binnedNoteId]);

  // A tag tapped on the note page opens Home filtered to it.
  const tagParam = route.params?.tag;
  useEffect(() => {
    if (tagParam === undefined) return;
    setFilter(`tag:${tagParam}`);
    setSearchText('');
    navigation.setParams({ tag: undefined });
  }, [tagParam]);

  const handleDeleteNote = useCallback((noteId: number) => {
    const title = notes.find(n => n.id === noteId)?.title || 'This note';
    alert(
      'Move to bin?',
      `"${title}" will stay in the bin for 30 days. You can restore it from Bin in Settings.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to bin',
          style: 'destructive',
          onPress: async () => {
            try {
              await moveNoteToBin(noteId);
              await loadNotes();
              showBinned(noteId);
            } catch (error) {
              console.error('Failed to move note to bin:', error);
              alert("Couldn't move the note to the bin", 'Try again. If it keeps failing, restart the app.');
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

  const handleArchiveToggle = useCallback(async (noteId: number) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const archive = async (archived: boolean) => {
      await setNoteArchived(noteId, archived);
      await loadNotes();
    };
    try {
      await archive(!note.isArchived);
      setUndo(() => async () => {
        try {
          await archive(note.isArchived);
          if (note.isPinned) await setNotePinned(noteId, true);
          await loadNotes();
        } catch (error) {
          alert("Couldn't undo", 'Try again from the note menu.');
        }
      });
      setSnackbar(note.isArchived ? 'Note unarchived' : 'Note archived');
    } catch (error) {
      alert(note.isArchived ? "Couldn't unarchive the note" : "Couldn't archive the note", 'Try again. If it keeps failing, restart the app.');
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
          onArchiveToggle={handleArchiveToggle}
          onSelect={handleSelect}
          selecting={selecting}
          selected={selectedIds.includes(item.id)}
          isFirst={!prev || prev.isPinned !== isPinned}
          isLast={!next || next.isPinned !== isPinned}
          showCreated={sortType === 'created'}
        />
      );
    },
    [handleNotePress, handleDeleteNote, handleEditNote, handlePinToggle, handleArchiveToggle, handleSelect, selecting, selectedIds, filteredNotes, sortType]
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

  // All and Pinned, then tags (keeping a selected tag that no note uses any more), then the rest.
  const selectedTag = filter.startsWith('tag:') && !tags.includes(filter.slice(4)) ? [filter.slice(4)] : [];
  const chipFilters: { value: Filter; label: string }[] = [
    ...typeFilters.slice(0, 2),
    ...[...tags, ...selectedTag].map(t => ({ value: `tag:${t}` as Filter, label: `#${t}` })),
    ...typeFilters.slice(2),
  ];

  const renderEmpty = () => (
    <View style={styles.empty}>
      {isFiltered ? (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
            {searchText.trim()
              ? `No notes match "${searchText.trim()}"`
              : filter === 'pinned' ? 'No pinned notes' : filter === 'archived' ? 'No archived notes' : filter.startsWith('tag:') ? `No notes tagged #${filter.slice(4)}` : 'No notes of this type'}
          </Text>
          <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
            {searchText.trim()
              ? 'Try another word or filter.'
              : filter === 'pinned'
              ? 'Tap the pin on a note to keep it at the top and find it here.'
              : filter === 'archived'
              ? "Choose Archive in a note's menu to hide it from your list without deleting it."
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
      {selecting ? (
        <Appbar.Header mode="small" elevated>
          <Appbar.Action icon="close" accessibilityLabel="Cancel selection" onPress={clearSelection} />
          <Appbar.Content title={`${selectedIds.length} selected`} />
          <Appbar.Action
            icon={selectedNotes.some(n => !n.isPinned) ? 'pin-outline' : 'pin-off-outline'}
            accessibilityLabel={selectedNotes.some(n => !n.isPinned) ? 'Pin selected notes' : 'Unpin selected notes'}
            onPress={handlePinSelected}
          />
          <Appbar.Action
            icon={filter === 'archived' ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline'}
            accessibilityLabel={filter === 'archived' ? 'Unarchive selected notes' : 'Archive selected notes'}
            onPress={handleArchiveSelected}
          />
          <Appbar.Action icon="export-variant" accessibilityLabel="Export selected notes" onPress={handleExportSelected} />
          <Appbar.Action icon="delete-outline" accessibilityLabel="Move selected notes to bin" onPress={handleBinSelected} />
        </Appbar.Header>
      ) : (
        <Header elevated={elevated}
          title={profiles.length > 1 && activeProfile ? activeProfile.name : 'NoteSpark'}
          rightActions={
            <>
              <Appbar.Action
                icon="account-circle-outline"
                accessibilityLabel={`Switch profile, current profile ${activeProfile?.name ?? ''}`}
                onPress={() => setProfileDialogVisible(true)}
              />
              <Appbar.Action icon="checkbox-marked-outline" accessibilityLabel="Tasks" onPress={() => navigation.navigate('Tasks')} />
              <Appbar.Action icon="cog-outline" accessibilityLabel="Settings" onPress={() => navigation.navigate('Settings')} />
            </>
          }
        />
      )}

      <View style={[styles.controls, { backgroundColor: elevated ? theme.colors.elevation.level2 : theme.colors.background }]}>
        <Searchbar
          placeholder={searchType === 'meaning' ? 'Search by meaning' : 'Search notes'}
          value={searchText}
          onChangeText={setSearchText}
          style={{ backgroundColor: theme.colors.surfaceContainerHigh, borderRadius: shape.control }}
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipRow}>
          {chipFilters.map(f => (
            <View key={f.value}>
              {/* Selected is filled with no outline and no check mark, so chips don't change width. */}
              <Chip
                mode={filter === f.value ? 'flat' : 'outlined'}
                selected={filter === f.value}
                showSelectedCheck={false}
                showSelectedOverlay={false}
                onPress={() => setFilter(f.value)}
                accessibilityState={{ selected: filter === f.value }}
                style={[styles.chipShape, filter === f.value && { backgroundColor: theme.colors.secondaryContainer }]}
                textStyle={[
                  theme.fonts.labelMedium,
                  styles.chipText,
                  { color: filter === f.value ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant },
                ]}
                maxFontSizeMultiplier={1.5}
              >
                {f.label}
              </Chip>
            </View>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        // Static placeholder cards shaped like NoteItem; no shimmer, since motion only follows user actions.
        <View style={styles.listContent} accessible accessibilityLabel="Loading notes">
          {[0, 1, 2, 3].map(i => (
            <View
              key={i}
              style={[styles.skeletonCard, groupCorners(i === 0, i === 3), { backgroundColor: theme.colors.surfaceContainerLow }]}
            >
              <View style={[styles.skeletonLine, styles.skeletonTitle, { backgroundColor: theme.colors.surfaceContainerHighest }]} />
              <View style={[styles.skeletonLine, { backgroundColor: theme.colors.surfaceContainerHighest }]} />
            </View>
          ))}
        </View>
      ) : (
        <Animated.FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderNoteItem}
          itemLayoutAnimation={LinearTransition.springify()}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[theme.colors.primary]}
              progressBackgroundColor={theme.colors.surfaceContainerHigh}
            />
          }
          onScroll={handleScroll}
          scrollEventThrottle={64}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      {!selecting && (
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
      )}

      <Portal>
        <Dialog visible={profileDialogVisible} onDismiss={() => setProfileDialogVisible(false)}>
          <Dialog.Title>Switch profile</Dialog.Title>
          <Dialog.ScrollArea style={styles.profileList}>
            <ScrollView>
              {profiles.map(p => {
                const current = p.id === activeProfile?.id;
                return (
                  <List.Item
                    key={p.id}
                    title={p.name}
                    description={current ? 'Current profile' : undefined}
                    left={props => <List.Icon {...props} icon={current ? 'account-check' : 'account-outline'} />}
                    onPress={() => handleSwitchProfile(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: current }}
                  />
                );
              })}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => { setProfileDialogVisible(false); navigation.navigate('Settings'); }}>Manage profiles</Button>
            <Button onPress={() => setProfileDialogVisible(false)}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pinDialog?.open} onDismiss={() => setPinDialog(d => d && { ...d, open: false })}>
          <Dialog.Title>Enter profile PIN</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">Enter the four-digit PIN for {pinDialog?.profile.name}.</Text>
            <TextInput
              mode="outlined"
              label="PIN"
              value={pinDialog?.pin ?? ''}
              onChangeText={pin => setPinDialog(d => d && { ...d, pin: pin.replace(/\D/g, '').slice(0, 4) })}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              onSubmitEditing={() => pinDialog && handleSwitchProfile(pinDialog.profile, pinDialog.pin)}
              style={styles.pinInput}
            />
            <Button onPress={() => pinDialog && handleForgotPin(pinDialog.profile)} style={styles.forgotPin}>Forgot PIN?</Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPinDialog(d => d && { ...d, open: false })}>Cancel</Button>
            <Button onPress={() => pinDialog && handleSwitchProfile(pinDialog.profile, pinDialog.pin)} disabled={pinDialog?.pin.length !== 4}>Unlock</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={!!snackbar}
        onDismiss={() => { setSnackbar(''); setUndo(null); }}
        duration={4000}
        wrapperStyle={styles.snackbar}
        action={undo ? { label: 'Undo', onPress: undo } : undefined}
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
  // Scrolls sideways; bleeds to the screen edges so chips don't look cut off at the padding.
  chipRow: {
    marginHorizontal: -space.lg,
  },
  chips: {
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  chipShape: {
    borderRadius: shape.small,
  },
  chipText: {
    marginLeft: space.md,
    marginRight: space.md,
  },
  skeletonCard: {
    marginHorizontal: space.lg,
    marginBottom: 2,
    minHeight: 88,
    padding: space.lg,
    gap: space.md,
  },
  skeletonLine: {
    height: 12,
    width: '80%',
    borderRadius: shape.extraSmall,
  },
  skeletonTitle: {
    height: 16,
    width: '45%',
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
  profileList: {
    maxHeight: 320,
    paddingHorizontal: 0,
  },
  snackbar: {
    bottom: 80,
  },
  pinInput: {
    marginTop: space.md,
  },
  forgotPin: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
});

export default HomeScreen;
