import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StyleSheet, View, FlatList, Alert, TextInput } from 'react-native';
import { FAB, IconButton, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getNotes, deleteNote } from '../storage/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Note } from '../types';
import Header from '../components/Header';
import NoteItem from '../components/NoteItem';
import { useTheme } from '../theme/ThemeContext';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { theme } = useTheme();
  const [notes, setNotes] = useState<Note[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'title' | 'content'>('all');
  const [filterMarkdown, setFilterMarkdown] = useState<'all' | 'markdown' | 'text'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [sortType, setSortType] = useState<'edited' | 'created'>('edited');
  // Pin state: in-memory for now, should be persisted in DB for full support
  const [pinned, setPinned] = useState<{ [id: number]: boolean }>({});

  const loadNotes = async () => {
    try {
      const fetchedNotes = await getNotes();
      setNotes(fetchedNotes);
      // Optionally, load pin state from storage here
    } catch (error) {
      console.error('Failed to load notes:', error);
      Alert.alert('Error', 'Failed to load notes');
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

  // Advanced search, sorting, and pin logic
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
        // 'all'
        return (n.title?.toLowerCase().includes(text) || n.content.toLowerCase().includes(text));
      });
    }
    // Sort by pin, then by sortType
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

  const handleNotePress = (noteId: number) => {
    navigation.navigate('NoteView', { noteId });
  };

  const handleDeleteNote = (noteId: number) => {
    Alert.alert(
      'Delete Note',
      'Are you sure you want to delete this note?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteNote(noteId);
              await loadNotes();
            } catch (error) {
              console.error('Failed to delete note:', error);
              Alert.alert('Error', 'Failed to delete note');
            }
          },
        },
      ]
    );
  };

  const handleEditNote = (noteId: number) => {
    Alert.alert(
      'Edit Note',
      'Do you want to edit this note?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Edit',
          onPress: () => navigation.navigate('Editor', { noteId }),
        },
      ]
    );
  };

  const handlePinToggle = useCallback((noteId: number) => {
    setPinned(prev => ({ ...prev, [noteId]: !prev[noteId] }));
    // TODO: persist pin state in DB
  }, []);

  const renderNoteItem = useCallback(
    ({ item }: { item: Note }) => (
      <NoteItem
        note={item}
        onPress={handleNotePress}
        onDelete={handleDeleteNote}
        onEdit={handleEditNote}
        showPreview
        isPinned={!!pinned[item.id]}
        onPinToggle={handlePinToggle}
      />
    ),
    [handleNotePress, handleDeleteNote, handleEditNote, pinned, handlePinToggle]
  );

  const handleCreateNote = () => {
    navigation.navigate('Editor');
  };


  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Header 
        title="NoteSpark"
        rightActions={
            <View style={styles.headerActions}>
            <FAB
              icon="cog"
              size="small"
              style={[styles.settingsFab, { backgroundColor: theme.colors.primary }]}
              color="white"
              onPress={() => navigation.navigate('Settings')}
            />
            </View>
        }
      />

      {/* Advanced Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            style={[
              styles.searchInput,
              { backgroundColor: theme.colors.surface, color: theme.colors.text, flex: 1 }
            ]}
            placeholder="Search notes..."
            placeholderTextColor={theme.colors.outline}
            value={searchText}
            onChangeText={setSearchText}
          />
          <FAB
            icon="filter-variant"
            size="small"
            style={{
              marginLeft: 8,
              backgroundColor: theme.colors.secondary,
              elevation: 0,
              height: 36,
              width: 36,
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 10,
            }}
            color="black"
            onPress={() => setShowFilters(prev => !prev)}
          />
        </View>
        {/* Centered and dynamic sorting row */}
        <View style={[styles.sortRow, { justifyContent: 'center', marginTop: 10 }]}> 
          {['edited', 'created'].map(type => (
            <FAB
              key={type}
              label={type === 'edited' ? 'Last Edited' : 'Last Created'}
              small
              style={[
                styles.sortFab,
                sortType === type && { backgroundColor: theme.colors.primary },
                { marginHorizontal: 8 }
              ]}
              color={sortType === type ? 'white' : theme.colors.text}
              onPress={() => setSortType(type as 'edited' | 'created')}
            />
          ))}
        </View>
        {showFilters && (
          <View style={styles.filterMenu}>
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Search In</Text>
              {['all', 'title', 'content'].map(type => (
                <FAB
                  key={type}
                  label={type.charAt(0).toUpperCase() + type.slice(1)}
                  small
                  style={[
                    styles.filterFab,
                    searchType === type && { backgroundColor: theme.colors.primary }
                  ]}
                  color={searchType === type ? 'white' : theme.colors.text}
                  onPress={() => setSearchType(type as 'all' | 'title' | 'content')}
                />
              ))}
            </View>
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Type</Text>
              {['all', 'markdown', 'text'].map(type => (
                <FAB
                  key={type}
                  label={type === 'all' ? 'All Types' : type.charAt(0).toUpperCase() + type.slice(1)}
                  small
                  style={[
                    styles.filterFab,
                    filterMarkdown === type && { backgroundColor: theme.colors.secondary }
                  ]}
                  color={filterMarkdown === type ? 'black' : theme.colors.text}
                  onPress={() => setFilterMarkdown(type as 'all' | 'markdown' | 'text')}
                />
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Note list or empty state */}
      {filteredNotes.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 40 }}>
          <IconButton icon="note-plus" size={64} iconColor={theme.colors.primary} />
          <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: 'bold', marginTop: 12 }}>Create your first note</Text>
          <Text style={{ color: theme.colors.text, fontSize: 15, marginTop: 6, marginBottom: 18, opacity: 0.7 }}>Start organizing your thoughts and ideas!</Text>
          <FAB
            icon="plus"
            label="Create Note"
            style={{ backgroundColor: theme.colors.primary, marginTop: 8, paddingHorizontal: 24 }}
            color="white"
            onPress={handleCreateNote}
          />
        </View>
      ) : (
        <FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderNoteItem}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color="white"
        onPress={handleCreateNote}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
  },
  settingsFab: {
    marginRight: 8,
    elevation: 0,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: 'transparent',
  },
  searchInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD',
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 8,
  },
  searchOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  searchTypeGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  searchTypeFab: {
    marginRight: 6,
    elevation: 0,
    height: 32,
    minWidth: 60,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 4,
    marginLeft: 2,
  },
  sortFab: {
    marginRight: 6,
    elevation: 0,
    height: 32,
    minWidth: 70,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  filterMenu: {
    position: 'absolute',
    top: 44,
    right: 14.5,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 4,
    zIndex: 99,
    minWidth: 150,
    maxWidth: 220,
    alignSelf: 'flex-end',
    flexDirection: 'column',
    gap: 10,
  },
  filterGroup: {
    flexDirection: 'column',
    marginBottom: 8,
    gap: 4,
  },
  filterLabel: {
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 2,
    color: '#888',
  },
  filterFab: {
    marginBottom: 4,
    elevation: 0,
    height: 32,
    minWidth: 70,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 12,
    width: '100%',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 80,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});

export default HomeScreen; 