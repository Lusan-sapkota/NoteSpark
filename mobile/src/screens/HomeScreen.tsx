import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { BackHandler, RefreshControl, ScrollView, StyleSheet, View, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { AnimatedFAB, Appbar, Button, Chip, Dialog, Icon, IconButton, List, Portal, Searchbar, Text, TextInput, TouchableRipple } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import Menu from '../components/Menu';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList } from '../types';
import { clearDraft, getDraft, getNotes, getNotesVersion, moveNoteToBin, restoreNote, setNoteArchived, setNotePinned } from '../storage/notes';
import { eraseForgottenProfile, getActiveProfile, getProfiles, Profile, switchProfile, transferNotesToProfile, unlockWithBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';
import { isMeaningSearchAvailable, searchByMeaning, syncSearchIndex } from '../storage/semanticSearch';
import { Note } from '../types';
import { extractTags, mergeSearch, TemplateKind, templateNote, today } from '@notespark/core';
import { DailyNoteDialog, TemplateDialog } from '../components/NoteTemplates';
import { shareNotesAsJson, shareNotesAsZip } from '../utils/exportNotes';
import { syncTaskReminders } from '../utils/taskReminders';
import { updateWidgets } from '../widget/widgets';
import Header, { useHeaderElevation } from '../components/Header';
import NoteItem, { toPreview } from '../components/NoteItem';
import { hideRediscoverToday, isRediscoverHiddenToday, isRediscoverOn, pickRediscovery, Rediscovery } from '../utils/rediscover';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { groupCorners, shape, space } from '../theme/theme';
import { useI18n } from '../i18n/I18nContext';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

type TypeFilter = 'all' | 'pinned' | 'markdown' | 'text' | 'archived';
type Filter = TypeFilter | `tag:${string}`;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { theme, isDarkMode } = useTheme();
  const { t } = useI18n();
  const typeFilters: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: t('home.filterAll') },
    { value: 'pinned', label: t('home.pinned') },
    { value: 'markdown', label: 'Markdown' },
    { value: 'text', label: t('home.filterText') },
    { value: 'archived', label: t('home.filterArchived') },
  ];
  const { elevated, onScroll: onHeaderScroll } = useHeaderElevation();
  const alert = useAlert();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  // The list filters with this deferred copy, so typing stays responsive with many notes.
  const deferredSearch = useDeferredValue(searchText);
  // 'both' is words, then related notes by meaning; it needs a build with the model.
  const [searchType, setSearchTypeState] = useState<'both' | 'all' | 'title' | 'content'>(isMeaningSearchAvailable() ? 'both' : 'all');
  const setSearchType = (type: typeof searchType) => {
    setSearchTypeState(type);
    AsyncStorage.setItem('searchType', type).catch(() => {});
  };
  useEffect(() => {
    AsyncStorage.getItem('searchType').then(saved => {
      if (saved === 'all' || saved === 'title' || saved === 'content') setSearchTypeState(saved);
      else if (saved === 'both' && isMeaningSearchAvailable()) setSearchTypeState('both');
    }).catch(() => {});
  }, []);
  const [meaningIds, setMeaningIds] = useState<number[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sortType, setSortType] = useState<'edited' | 'created'>('edited');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  const [dailyVisible, setDailyVisible] = useState(false);
  const [templateVisible, setTemplateVisible] = useState(false);
  const [fabExtended, setFabExtended] = useState(true);
  const [snackbar, setSnackbar] = useState('');
  // What the snackbar's Undo does, if it has one.
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
  const route = useRoute<RouteProp<RootStackParamList, 'Home'>>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [profileDialogVisible, setProfileDialogVisible] = useState(false);
  const [pinDialog, setPinDialog] = useState<{ profile: Profile; pin: string; notesToMove?: Note[]; open: boolean } | null>(null);
  const [transferDialog, setTransferDialog] = useState<{ notes: Note[]; open: boolean } | null>(null);
  const lastOffset = useRef(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selecting = selectedIds.length > 0;
  const clearSelection = () => setSelectedIds([]);

  // Rediscover card: whether it may show, and the pick for the current notes.
  const [rediscoverAllowed, setRediscoverAllowed] = useState(false);
  const [rediscovery, setRediscovery] = useState<Rediscovery | null>(null);
  const checkRediscover = () =>
    Promise.all([isRediscoverOn(), isRediscoverHiddenToday()])
      .then(([on, hidden]) => setRediscoverAllowed(on && !hidden))
      .catch(() => {});
  useEffect(() => {
    if (!rediscoverAllowed) {
      setRediscovery(null);
      return;
    }
    let active = true;
    pickRediscovery(notes).then(r => active && setRediscovery(r)).catch(() => {});
    return () => {
      active = false;
    };
  }, [notes, rediscoverAllowed]);

  // Profile and note version of the list on screen: coming back to Home reloads only when one of them changed.
  const loadedKey = useRef('');

  // Only the first load shows the skeleton; reloads keep the current list until the new one arrives.
  const loadNotes = async (force = false) => {
    try {
      const [list, active] = await Promise.all([getProfiles(), getActiveProfile()]);
      setProfiles(list);
      setActiveProfile(active);
      const key = `${active.id}:${getNotesVersion()}`;
      if (!force && key === loadedKey.current) return;
      loadedKey.current = key;
      const fetchedNotes = await getNotes();
      setNotes(fetchedNotes);
      setLoading(false);
      syncSearchIndex().catch(error => console.warn('Search index update failed:', error));
      syncTaskReminders().catch(error => console.warn('Task reminders update failed:', error));
      updateWidgets().catch(error => console.warn('Widget update failed:', error));
    } catch (error) {
      setLoading(false);
      loadedKey.current = '';
      console.error('Failed to load notes:', error);
      alert(t('home.loadFailedTitle'), t('home.loadFailedMessage'));
    }
  };

  // Text left unsaved when the app was last closed (see getDraft): offer it back once per start.
  useEffect(() => {
    (async () => {
      const [draft, active] = await Promise.all([getDraft(), getActiveProfile()]);
      if (!draft || draft.profileId !== active.id) return;
      const name = draft.title.trim();
      alert(t('home.draftTitle'), name ? t('home.draftMessageTitled', { name }) : t('home.draftMessageNew'), [
        { text: t('home.discard'), style: 'destructive', onPress: () => clearDraft() },
        { text: t('common.open'), onPress: () => navigation.navigate('Editor', { noteId: draft.noteId, draft: true }) },
      ], { cancelable: false });
    })().catch(() => {});
  }, []);

  useEffect(() => {
    loadNotes();
    checkRediscover();
    const unsubscribe = navigation.addListener('focus', () => {
      loadNotes();
      checkRediscover();
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
        alert(t('home.incorrectPin'), await wrongPinMessage(profile.id));
        return;
      }
      setPinDialog(d => d && { ...d, open: false });
      await switchProfile(profile.id, enteredPin);
      setSearchText('');
      setUndo(null);
      await loadNotes();
      setSnackbar(t('home.switchedTo', { name: profile.name }));
    } catch (error) {
      console.error('Failed to switch profile:', error);
      alert(
        t('home.openProfileFailedTitle', { name: profile.name }),
        t('home.openProfileFailedMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('home.eraseProfile'), style: 'destructive', onPress: () => handleForgotPin(profile) },
        ]
      );
    }
  };

  // A PIN can't be recovered, so a forgotten one means erasing that profile.
  const handleForgotPin = (profile: Profile) => {
    setPinDialog(d => d && { ...d, open: false });
    alert(
      t('home.eraseProfileTitle'),
      t('home.eraseProfileMessage', { name: profile.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.eraseProfile'),
          style: 'destructive',
          onPress: async () => {
            try {
              await eraseForgottenProfile(profile.id);
              setUndo(null);
              await loadNotes();
              setSnackbar(t('home.profileErased', { name: profile.name }));
            } catch (error) {
              alert(t('home.eraseProfileFailed'), t('common.tryAgainRestart'));
            }
          },
        },
      ]
    );
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadNotes(true);
    setRefreshing(false);
  };

  useEffect(() => {
    const query = searchText.trim();
    if (searchType !== 'both' || !query) {
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
    notes.filter(n => !n.isArchived).forEach(n => tagsByNote.get(n.id)!.forEach(tag => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  }, [notes, tagsByNote]);

  const searchResult = useMemo(() => {
    // Archived notes only show under the Archived filter.
    let filtered = notes.filter(n => (filter === 'archived') === n.isArchived);
    if (filter === 'pinned') filtered = filtered.filter(n => n.isPinned);
    else if (filter.startsWith('tag:')) filtered = filtered.filter(n => tagsByNote.get(n.id)!.includes(filter.slice(4)));
    else if (filter === 'markdown' || filter === 'text') {
      filtered = filtered.filter(n => filter === 'markdown' ? n.isMarkdown : !n.isMarkdown);
    }
    const byId = new Map(filtered.map(n => [n.id, n]));
    if (deferredSearch.trim()) {
      const text = deferredSearch.trim().toLowerCase();
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
    if (searchType !== 'both' || !deferredSearch.trim()) return { notes: filtered, relatedFrom: -1 };
    const { words, related } = mergeSearch(filtered, meaningIds, byId);
    return { notes: [...words, ...related], relatedFrom: related.length ? words.length : -1 };
  }, [notes, tagsByNote, deferredSearch, searchType, filter, sortType, meaningIds]);
  const filteredNotes = searchResult.notes;
  const relatedFrom = searchResult.relatedFrom;

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
          alert(t('home.undoFailed'), t('home.undoFailedCheck'));
        }
        await loadNotes();
      });
      setSnackbar(done);
    } catch (error) {
      alert(failed, t('home.changeFailedMessage'));
    }
    await loadNotes();
  };

  const handlePinSelected = () => {
    const pin = selectedNotes.some(n => !n.isPinned);
    changeSelected(
      n => setNotePinned(n.id, pin),
      n => setNotePinned(n.id, n.isPinned),
      pin ? t('home.notesPinned', { count: selectedNotes.length }) : t('home.notesUnpinned', { count: selectedNotes.length }),
      pin ? t('home.pinNotesFailed') : t('home.unpinNotesFailed'),
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
      archive ? t('home.notesArchived', { count: selectedNotes.length }) : t('home.notesUnarchived', { count: selectedNotes.length }),
      archive ? t('home.archiveNotesFailed') : t('home.unarchiveNotesFailed'),
    );
  };

  const handleBinSelected = () => {
    alert(
      t('home.moveNotesToBinTitle', { count: selectedNotes.length }),
      t('home.moveNotesToBinMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.moveToBin'),
          style: 'destructive',
          onPress: () => changeSelected(
            n => moveNoteToBin(n.id),
            n => restoreNote(n.id),
            t('home.notesMovedToBin', { count: selectedNotes.length }),
            t('home.moveNotesToBinFailed'),
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
        alert(t('home.exportFailedTitle'), t('home.exportFailedMessage'));
      }
    };
    alert(
      t('home.exportTitle', { count: targets.length }),
      t('home.exportMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('home.jsonBackup'), onPress: run(shareNotesAsJson) },
        { text: 'Markdown', onPress: run(shareNotesAsZip) },
      ]
    );
  };

  const executeTransfer = async (profile: Profile, targets: Note[], pin?: string) => {
    try {
      const revert = await transferNotesToProfile(targets, profile.id, pin);
      clearSelection();
      setUndo(() => async () => {
        try {
          await revert();
        } catch (error) {
          alert(t('home.undoFailed'), t('home.undoFailedCheck'));
        }
        await loadNotes();
      });
      await loadNotes();
      setSnackbar(t('home.notesMovedTo', { count: targets.length, name: profile.name }));
    } catch (error) {
      console.error('Failed to transfer notes:', error);
      alert(t('home.moveFailedTitle', { name: profile.name }), t('common.tryAgainRestart'));
    }
  };

  const promptTransferToProfile = async (profile: Profile, targets: Note[]) => {
    setTransferDialog(d => d && { ...d, open: false });
    if (profile.id === activeProfile?.id || targets.length === 0) return;
    const unlocked = await verifyProfilePin(profile.id, '');
    if (unlocked) {
      alert(
        t('home.moveNotesToTitle', { count: targets.length, name: profile.name }),
        targets.length === 1
          ? t('home.noteWillMove', { title: targets[0].title || t('common.untitledNote'), name: profile.name })
          : t('home.notesWillMove', { count: targets.length, name: profile.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('home.move'),
            onPress: () => { executeTransfer(profile, targets); },
          },
        ]
      );
      return;
    }
    // Locked profile: fingerprint first if enabled; otherwise, or on "Use PIN", the PIN dialog.
    if (await unlockWithBiometrics(profile)) {
      await executeTransfer(profile, targets);
      return;
    }
    setPinDialog({ profile, pin: '', notesToMove: targets, open: true });
  };

  const startTransfer = (targets: Note[]) => {
    if (targets.length === 0) return;
    const otherProfiles = profiles.filter(p => p.id !== activeProfile?.id);
    if (otherProfiles.length === 0) {
      alert(
        t('home.noOtherProfilesTitle'),
        t('home.noOtherProfilesMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('home.manageProfiles'),
            onPress: () => {
              clearSelection();
              navigation.navigate('Settings');
            },
          },
        ]
      );
      return;
    }
    if (otherProfiles.length === 1) {
      promptTransferToProfile(otherProfiles[0], targets);
      return;
    }
    setTransferDialog({ notes: targets, open: true });
  };

  const handlePinDialogSubmit = async () => {
    if (!pinDialog || pinDialog.pin.length !== 4) return;
    const { profile, pin, notesToMove } = pinDialog;
    if (!notesToMove) {
      await handleSwitchProfile(profile, pin);
      return;
    }
    if (!(await verifyProfilePin(profile.id, pin))) {
      alert(t('home.incorrectPin'), await wrongPinMessage(profile.id));
      return;
    }
    setPinDialog(d => d && { ...d, open: false });
    await executeTransfer(profile, notesToMove, pin);
  };

  // A text search carries over: the note opens finding it.
  const handleNotePress = useCallback((noteId: number) => {
    const find = deferredSearch.trim() || undefined;
    navigation.navigate('NoteView', { noteId: noteId.toString(), find });
  }, [navigation, deferredSearch]);

  const showBinned = (noteId: number) => {
    setUndo(() => async () => {
      try {
        await restoreNote(noteId);
        await loadNotes();
      } catch (error) {
        alert(t('home.restoreFailedTitle'), t('home.restoreFailedMessage'));
      }
    });
    setSnackbar(t('home.noteMovedToBin'));
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
    const title = notes.find(n => n.id === noteId)?.title || t('home.thisNote');
    alert(
      t('home.moveToBinQuestion'),
      t('home.moveNoteToBinMessage', { title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.moveToBin'),
          style: 'destructive',
          onPress: async () => {
            try {
              await moveNoteToBin(noteId);
              await loadNotes();
              showBinned(noteId);
            } catch (error) {
              console.error('Failed to move note to bin:', error);
              alert(t('home.moveNoteToBinFailed'), t('common.tryAgainRestart'));
            }
          },
        },
      ]
    );
  }, [notes, alert, t]);

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
      alert(t('home.pinNoteFailed'), t('common.tryAgainRestart'));
    }
  }, [notes, alert, t]);

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
          alert(t('home.undoFailed'), t('home.undoFailedMenu'));
        }
      });
      setSnackbar(note.isArchived ? t('home.noteUnarchived') : t('home.noteArchived'));
    } catch (error) {
      alert(note.isArchived ? t('home.unarchiveNoteFailed') : t('home.archiveNoteFailed'), t('common.tryAgainRestart'));
    }
  }, [notes, alert, t]);

  const handleTransferNote = useCallback((noteId: number) => {
    const note = notes.find(n => n.id === noteId);
    if (note) startTransfer([note]);
  }, [notes, profiles, activeProfile]);

  const renderNoteItem = useCallback(
    ({ item, index }: { item: Note; index: number }) => {
      const isPinned = item.isPinned;
      const prev = filteredNotes[index - 1];
      const next = filteredNotes[index + 1];
      const row = (
        <NoteItem
          note={item}
          onPress={handleNotePress}
          onDelete={handleDeleteNote}
          onEdit={handleEditNote}
          isPinned={isPinned}
          onPinToggle={handlePinToggle}
          onArchiveToggle={handleArchiveToggle}
          onTransfer={profiles.length > 1 ? handleTransferNote : undefined}
          onSelect={handleSelect}
          selecting={selecting}
          selected={selectedIds.includes(item.id)}
          isFirst={!prev || index === relatedFrom || prev.isPinned !== isPinned}
          isLast={!next || index + 1 === relatedFrom || next.isPinned !== isPinned}
          showCreated={sortType === 'created'}
        />
      );
      if (index !== relatedFrom) return row;
      return (
        <>
          <Text variant="titleSmall" accessibilityRole="header" style={[styles.relatedHeading, { color: theme.colors.onSurfaceVariant }]}>
            {t('home.alsoRelated')}
          </Text>
          {row}
        </>
      );
    },
    [handleNotePress, handleDeleteNote, handleEditNote, handlePinToggle, handleArchiveToggle, handleTransferNote, profiles.length, handleSelect, selecting, selectedIds, filteredNotes, sortType, relatedFrom, theme, t]
  );

  // A day's note: open it if it exists, else start it from the daily template (nothing is saved until it's edited).
  const openDailyNote = (day: string) => {
    setDailyVisible(false);
    setTemplateVisible(false);
    const existing = notes.find(n => n.title.trim() === day);
    if (existing) navigation.navigate('NoteView', { noteId: String(existing.id) });
    else startTemplate('daily', day);
  };
  const startTemplate = (kind: TemplateKind, day = today()) => {
    setTemplateVisible(false);
    const { title, content } = templateNote(kind, day);
    navigation.navigate('Editor', { title, text: content, template: true, markdown: true });
  };

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
    ...[...tags, ...selectedTag].map(tag => ({ value: `tag:${tag}` as Filter, label: `#${tag}` })),
    ...typeFilters.slice(2),
  ];

  const renderEmpty = () => (
    <View style={styles.empty}>
      {isFiltered ? (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
            {searchText.trim()
              ? t('home.emptyNoMatch', { query: searchText.trim() })
              : filter === 'pinned' ? t('home.emptyPinned') : filter === 'archived' ? t('home.emptyArchived') : filter.startsWith('tag:') ? t('home.emptyTag', { tag: filter.slice(4) }) : t('home.emptyType')}
          </Text>
          <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
            {searchText.trim()
              ? t('home.emptyTryAnother')
              : filter === 'pinned'
              ? t('home.emptyPinnedHint')
              : filter === 'archived'
              ? t('home.emptyArchivedHint')
              : t('home.emptyTryAnother')}
          </Text>
          <Button
            mode="text"
            onPress={() => { setSearchText(''); setFilter('all'); }}
            style={styles.emptyAction}
          >
            {t('home.clearFilters')}
          </Button>
        </>
      ) : (
        <>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('home.emptyNone')}</Text>
          <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
            {t('home.emptyNoneHint')}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      {selecting ? (
        <Appbar.Header mode="small" elevated>
          <Appbar.Action icon="close" accessibilityLabel={t('home.cancelSelection')} onPress={clearSelection} />
          <Appbar.Content title={String(selectedIds.length)} accessibilityLabel={t('home.selectedCount', { count: selectedIds.length })} />
          <Appbar.Action
            icon={selectedNotes.some(n => !n.isPinned) ? 'pin-outline' : 'pin-off-outline'}
            accessibilityLabel={selectedNotes.some(n => !n.isPinned) ? t('home.pinSelected') : t('home.unpinSelected')}
            onPress={handlePinSelected}
          />
          <Appbar.Action
            icon={filter === 'archived' ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline'}
            accessibilityLabel={filter === 'archived' ? t('home.unarchiveSelected') : t('home.archiveSelected')}
            onPress={handleArchiveSelected}
          />
          <Appbar.Action
            icon="account-arrow-right-outline"
            accessibilityLabel={t('home.moveSelected')}
            onPress={() => startTransfer(selectedNotes)}
          />
          <Appbar.Action icon="export-variant" accessibilityLabel={t('home.exportSelected')} onPress={handleExportSelected} />
          <Appbar.Action icon="delete-outline" accessibilityLabel={t('home.binSelected')} onPress={handleBinSelected} />
        </Appbar.Header>
      ) : (
        <Header elevated={elevated}
          title={profiles.length > 1 && activeProfile ? activeProfile.name : 'NoteSpark'}
          rightActions={
            <>
              <Appbar.Action
                icon="account-circle-outline"
                accessibilityLabel={t('home.switchProfileLabel', { name: activeProfile?.name ?? '' })}
                onPress={() => setProfileDialogVisible(true)}
              />
              <Appbar.Action icon="notebook-edit-outline" accessibilityLabel={t('common.scratchpad')} onPress={() => navigation.navigate('Scratchpad')} />
              <Appbar.Action icon="checkbox-marked-outline" accessibilityLabel={t('common.tasks')} onPress={() => navigation.navigate('Tasks')} />
              <Menu
                visible={moreVisible}
                onDismiss={() => setMoreVisible(false)}
                anchor={<Appbar.Action icon="dots-vertical" accessibilityLabel={t('home.more')} onPress={() => setMoreVisible(true)} />}
              >
                <Menu.Item title={t('home.dailyNote')} leadingIcon="calendar-today" onPress={() => { setMoreVisible(false); setDailyVisible(true); }} />
                <Menu.Item title={t('home.newFromTemplate')} leadingIcon="file-document-plus-outline" onPress={() => { setMoreVisible(false); setTemplateVisible(true); }} />
                <Menu.Item title={t('home.askYourNotes')} leadingIcon="comment-search-outline" onPress={() => { setMoreVisible(false); navigation.navigate('Ask'); }} />
                <Menu.Item title={t('home.tidyUpNotes')} leadingIcon="broom" onPress={() => { setMoreVisible(false); navigation.navigate('Tidy'); }} />
              </Menu>
              <Appbar.Action icon="cog-outline" accessibilityLabel={t('common.settings')} onPress={() => navigation.navigate('Settings')} />
            </>
          }
        />
      )}

      <View style={[styles.controls, { backgroundColor: elevated ? theme.colors.elevation.level2 : theme.colors.background }]}>
        <Searchbar
          placeholder={t('home.searchNotes')}
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
                  accessibilityLabel={t('home.sortAndSearchOptions')}
                  onPress={() => setOptionsVisible(true)}
                  color={theme.colors.onSurfaceVariant}
                />
              }
            >
              <Menu.Item
                title={t('home.sortEdited')}
                trailingIcon={sortType === 'edited' ? 'check' : undefined}
                onPress={() => { setSortType('edited'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title={t('home.sortCreated')}
                trailingIcon={sortType === 'created' ? 'check' : undefined}
                onPress={() => { setSortType('created'); setOptionsVisible(false); }}
              />
              {isMeaningSearchAvailable() && (
                <Menu.Item
                  title={t('home.searchBoth')}
                  trailingIcon={searchType === 'both' ? 'check' : undefined}
                  onPress={() => { setSearchType('both'); setOptionsVisible(false); }}
                />
              )}
              <Menu.Item
                title={t('home.searchAll')}
                trailingIcon={searchType === 'all' ? 'check' : undefined}
                onPress={() => { setSearchType('all'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title={t('home.searchTitles')}
                trailingIcon={searchType === 'title' ? 'check' : undefined}
                onPress={() => { setSearchType('title'); setOptionsVisible(false); }}
              />
              <Menu.Item
                title={t('home.searchText')}
                trailingIcon={searchType === 'content' ? 'check' : undefined}
                onPress={() => { setSearchType('content'); setOptionsVisible(false); }}
              />
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
        <View style={styles.listContent} accessible accessibilityLabel={t('home.loadingNotes')}>
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
          ListHeaderComponent={
            rediscovery && !isFiltered && !selecting ? (
              <View style={[styles.rediscover, groupCorners(true, true), { backgroundColor: theme.colors.surfaceContainerLow }]}>
                <TouchableRipple
                  onPress={() => handleNotePress(rediscovery.note.id)}
                  style={styles.rediscoverBody}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.rediscoverLabel', { reason: rediscovery.reason, title: rediscovery.note.title || t('common.untitledNote') })}
                >
                  <View style={styles.rediscoverText}>
                    <View style={styles.rediscoverReason}>
                      <Icon source="history" size={16} color={theme.colors.onSurfaceVariant} />
                      <Text variant="labelMedium" style={[styles.flexText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
                        {rediscovery.reason}
                      </Text>
                    </View>
                    <Text variant="titleMedium" style={{ color: theme.colors.onSurface }} numberOfLines={2}>
                      {rediscovery.note.title || t('common.untitledNote')}
                    </Text>
                    {!!toPreview(rediscovery.note.content) && (
                      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={2}>
                        {toPreview(rediscovery.note.content)}
                      </Text>
                    )}
                  </View>
                </TouchableRipple>
                <IconButton
                  icon="close"
                  accessibilityLabel={t('home.hideForToday')}
                  onPress={() => {
                    setRediscoverAllowed(false);
                    hideRediscoverToday().catch(() => {});
                  }}
                />
              </View>
            ) : undefined
          }
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
          label={t('home.newNote')}
          extended={fabExtended}
          onPress={handleCreateNote}
          animateFrom="right"
          accessibilityLabel={t('home.newNote')}
          // The firefly: a soft primary glow under the FAB in dark mode (Android 9+ tints elevation shadows).
          style={[styles.fab, isDarkMode && { shadowColor: theme.colors.primary }]}
        />
      )}

      <Portal>
        <DailyNoteDialog visible={dailyVisible} notes={notes} onDismiss={() => setDailyVisible(false)} onPick={openDailyNote} />
        <TemplateDialog
          visible={templateVisible}
          onDismiss={() => setTemplateVisible(false)}
          onPick={kind => (kind === 'daily' ? openDailyNote(today()) : startTemplate(kind))}
        />
        <Dialog visible={profileDialogVisible} onDismiss={() => setProfileDialogVisible(false)}>
          <Dialog.Title>{t('home.switchProfile')}</Dialog.Title>
          <Dialog.ScrollArea style={styles.profileList}>
            <ScrollView>
              {profiles.map(p => {
                const current = p.id === activeProfile?.id;
                return (
                  <List.Item
                    key={p.id}
                    title={p.name}
                    description={current ? t('home.currentProfile') : undefined}
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
            <Button onPress={() => { setProfileDialogVisible(false); navigation.navigate('Settings'); }}>{t('home.manageProfiles')}</Button>
            <Button onPress={() => setProfileDialogVisible(false)}>{t('common.cancel')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!transferDialog?.open} onDismiss={() => setTransferDialog(d => d && { ...d, open: false })}>
          <Dialog.Title>{t('home.moveNotesTo', { count: transferDialog?.notes.length ?? 0 })}</Dialog.Title>
          <Dialog.ScrollArea style={styles.profileList}>
            <ScrollView>
              {profiles
                .filter(p => p.id !== activeProfile?.id)
                .map(p => (
                  <List.Item
                    key={p.id}
                    title={p.name}
                    left={props => <List.Icon {...props} icon="account-outline" />}
                    onPress={() => transferDialog && promptTransferToProfile(p, transferDialog.notes)}
                  />
                ))}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setTransferDialog(d => d && { ...d, open: false })}>{t('common.cancel')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pinDialog?.open} onDismiss={() => setPinDialog(d => d && { ...d, open: false })}>
          <Dialog.Title>
            {pinDialog?.notesToMove ? t('home.moveToProfile', { name: pinDialog.profile.name }) : t('home.enterPinTitle')}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {pinDialog?.notesToMove
                ? t('home.enterPinMove', { name: pinDialog.profile.name, count: pinDialog.notesToMove.length })
                : t('home.enterPin', { name: pinDialog?.profile.name ?? '' })}
            </Text>
            <TextInput
              mode="outlined"
              label={t('home.pin')}
              value={pinDialog?.pin ?? ''}
              onChangeText={pin => setPinDialog(d => d && { ...d, pin: pin.replace(/\D/g, '').slice(0, 4) })}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              onSubmitEditing={handlePinDialogSubmit}
              style={styles.pinInput}
            />
            <Button onPress={() => pinDialog && handleForgotPin(pinDialog.profile)} style={styles.forgotPin}>{t('home.forgotPin')}</Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPinDialog(d => d && { ...d, open: false })}>{t('common.cancel')}</Button>
            <Button onPress={handlePinDialogSubmit} disabled={pinDialog?.pin.length !== 4}>
              {pinDialog?.notesToMove ? t('home.move') : t('home.unlock')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={!!snackbar}
        onDismiss={() => { setSnackbar(''); setUndo(null); }}
        duration={4000}
        wrapperStyle={styles.snackbar}
        action={undo ? { label: t('common.undo'), onPress: undo } : undefined}
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
  relatedHeading: {
    minHeight: 48,
    textAlignVertical: 'center',
    marginHorizontal: space.lg,
    paddingTop: space.md,
  },
  // Same inset as the note cards (NoteItem).
  rediscover: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'hidden',
    marginHorizontal: space.lg,
    marginBottom: space.md,
  },
  rediscoverBody: {
    flex: 1,
  },
  rediscoverText: {
    gap: space.xs,
    paddingVertical: space.md,
    paddingLeft: space.lg,
  },
  rediscoverReason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  flexText: {
    flex: 1,
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
