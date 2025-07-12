import React, { useState, useEffect } from 'react';
import { StyleSheet, View, FlatList, Alert } from 'react-native';
import { FAB } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getNotes, deleteNote } from '../storage/database';
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

  const loadNotes = async () => {
    try {
      const fetchedNotes = await getNotes();
      setNotes(fetchedNotes);
    } catch (error) {
      console.error('Failed to load notes:', error);
      Alert.alert('Error', 'Failed to load notes');
    }
  };

  useEffect(() => {
    loadNotes();

    // Refresh notes when the screen is focused
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

  const handleNotePress = (noteId: number) => {
    navigation.navigate('Editor', { noteId });
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
              style={[styles.settingsFab, { backgroundColor: theme.colors.secondary }]}
              color={theme.colors.text}
              onPress={() => navigation.navigate('Settings')}
            />
          </View>
        }
      />
      
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <NoteItem
            note={item}
            onPress={handleNotePress}
            onDelete={handleDeleteNote}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
      
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