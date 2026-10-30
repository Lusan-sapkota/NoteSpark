import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Appbar, IconButton, Text } from 'react-native-paper';
import Snackbar from '../components/Snackbar';
import { Note, RootStackParamList } from '../types';
import { deleteNote, emptyBin, getBinNotes, restoreNote } from '../storage/notes';
import { BIN_DAYS } from '../storage/database';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { t as translate } from '@notespark/core';
import { readingWidth, space } from '../theme/theme';

type BinScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Bin'>;

const timeLeft = (deletedAt: string) => {
  const days = BIN_DAYS - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000);
  if (days <= 0) return translate('bin.deletedNextOpen');
  if (days === 1) return translate('bin.deletedTomorrow');
  return translate('bin.deletedInDays', { count: days });
};

const BinScreen: React.FC = () => {
  const navigation = useNavigation<BinScreenNavigationProp>();
  const { theme } = useTheme();
  const { t } = useI18n();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [notes, setNotes] = useState<Note[]>([]);
  const [snackbar, setSnackbar] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await getBinNotes());
    } catch {
      alert(t('bin.loadFailedTitle'), t('bin.loadFailedMessage'));
    }
  }, [alert, t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleRestore = async (note: Note) => {
    try {
      await restoreNote(note.id);
      setSnackbar(t('bin.restored'));
      load();
    } catch {
      alert(t('bin.restoreFailedTitle'), t('common.tryAgainRestart'));
    }
  };

  const handleDeleteForever = (note: Note) => {
    alert(t('bin.deleteForeverTitle'), t('bin.deleteForeverMessage', { title: note.title || t('common.untitledNote') }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bin.deleteForever'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(note.id);
            setSnackbar(t('bin.deletedForever'));
            load();
          } catch {
            alert(t('bin.deleteFailedTitle'), t('common.tryAgainRestart'));
          }
        },
      },
    ]);
  };

  const handleEmpty = () => {
    alert(t('bin.emptyTitle'), t('bin.emptyMessage', { count: notes.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bin.emptyAction'),
        style: 'destructive',
        onPress: async () => {
          try {
            await emptyBin();
            setSnackbar(t('bin.emptied'));
            load();
          } catch {
            alert(t('bin.emptyFailedTitle'), t('common.tryAgainRestart'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header
        elevated={elevated}
        title={t('bin.title')}
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightActions={
          notes.length > 0 ? <Appbar.Action icon="delete-sweep-outline" accessibilityLabel={t('bin.emptyAction')} onPress={handleEmpty} /> : undefined
        }
      />
      <Animated.FlatList
        data={notes}
        keyExtractor={n => String(n.id)}
        itemLayoutAnimation={LinearTransition.springify()}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surfaceContainerHigh}
          />
        }
        style={styles.column}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          notes.length > 0 ? (
            <Text variant="bodyMedium" style={[styles.intro, { color: theme.colors.onSurfaceVariant }]}>
              {t('bin.intro', { days: BIN_DAYS })}
            </Text>
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <GroupedRow
            title={item.title || t('common.untitledNote')}
            description={timeLeft(item.deletedAt!)}
            icon="note-text-outline"
            right={
              <View style={styles.actions}>
                <IconButton icon="restore" accessibilityLabel={t('bin.restoreNote', { title: item.title })} onPress={() => handleRestore(item)} />
                <IconButton
                  icon="delete-forever-outline"
                  iconColor={theme.colors.error}
                  accessibilityLabel={t('bin.deleteNoteForever', { title: item.title })}
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
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('bin.emptyState')}</Text>
            <Text variant="bodyMedium" style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}>
              {t('bin.emptyStateBody', { days: BIN_DAYS })}
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
