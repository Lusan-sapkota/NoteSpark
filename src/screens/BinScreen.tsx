import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Appbar, IconButton, Snackbar, Text } from 'react-native-paper';
import { Note, RootStackParamList } from '../types';
import { deleteNote, emptyBin, getBinNotes, restoreNote } from '../storage/notes';
import { BIN_DAYS } from '../storage/database';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

type BinScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Bin'>;

const timeLeft = (deletedAt: string) => {
  const days = BIN_DAYS - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000);
  if (days <= 0) return 'Deleted for good the next time the app opens';
  if (days === 1) return 'Deleted for good tomorrow';
  return `Deleted for good in ${days} days`;
};

const BinScreen: React.FC = () => {
  const navigation = useNavigation<BinScreenNavigationProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [notes, setNotes] = useState<Note[]>([]);
  const [snackbar, setSnackbar] = useState('');

  const load = useCallback(async () => {
    try {
      setNotes(await getBinNotes());
    } catch {
      alert("Couldn't load the bin", 'Go back and open Bin again.');
    }
  }, [alert]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRestore = async (note: Note) => {
    try {
      await restoreNote(note.id);
      setSnackbar('Note restored');
      load();
    } catch {
      alert("Couldn't restore the note", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleDeleteForever = (note: Note) => {
    alert('Delete forever?', `"${note.title || 'Untitled note'}" will be erased from this device. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete forever',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(note.id);
            setSnackbar('Note deleted forever');
            load();
          } catch {
            alert("Couldn't delete the note", 'Try again. If it keeps failing, restart the app.');
          }
        },
      },
    ]);
  };

  const handleEmpty = () => {
    alert('Empty bin?', `All ${notes.length} notes in the bin will be erased from this device. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty bin',
        style: 'destructive',
        onPress: async () => {
          try {
            await emptyBin();
            setSnackbar('Bin emptied');
            load();
          } catch {
            alert("Couldn't empty the bin", 'Try again. If it keeps failing, restart the app.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header
        elevated={elevated}
        title="Bin"
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightActions={
          notes.length > 0 ? <Appbar.Action icon="delete-sweep-outline" accessibilityLabel="Empty bin" onPress={handleEmpty} /> : undefined
        }
      />
      <Animated.FlatList
        data={notes}
        keyExtractor={n => String(n.id)}
        itemLayoutAnimation={LinearTransition.springify()}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.column}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          notes.length > 0 ? (
            <Text variant="bodyMedium" style={[styles.intro, { color: theme.colors.onSurfaceVariant }]}>
              Notes stay here for {BIN_DAYS} days after you delete them, then they're erased.
            </Text>
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <GroupedRow
            title={item.title || 'Untitled note'}
            description={timeLeft(item.deletedAt!)}
            icon="note-text-outline"
            right={
              <View style={styles.actions}>
                <IconButton icon="restore" accessibilityLabel={`Restore ${item.title}`} onPress={() => handleRestore(item)} />
                <IconButton
                  icon="delete-forever-outline"
                  iconColor={theme.colors.error}
                  accessibilityLabel={`Delete ${item.title} forever`}
                  onPress={() => handleDeleteForever(item)}
                />
              </View>
            }
            isFirst={index === 0}
            isLast={index === notes.length - 1}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>Bin is empty</Text>
            <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              Notes you delete stay here for {BIN_DAYS} days, so you can restore them.
            </Text>
          </View>
        }
      />
      <Snackbar visible={!!snackbar} onDismiss={() => setSnackbar('')} duration={3000}>
        {snackbar}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
  },
  intro: {
    marginTop: space.xs,
    marginBottom: space.lg,
    marginLeft: space.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  empty: {
    paddingHorizontal: space.xs,
    paddingTop: space.xl,
  },
  emptyBody: {
    marginTop: space.xs,
  },
});

export default BinScreen;
