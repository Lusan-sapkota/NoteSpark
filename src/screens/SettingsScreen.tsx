import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, IconButton, List, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { deleteAllNotesForever, moveAllNotesToBin, restoreBatch } from '../storage/notes';
import { addProfile, deleteProfile, getActiveProfile, getProfiles, Profile, renameProfile, switchProfile } from '../storage/profiles';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Snackbar from '../components/Snackbar';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { theme, themeType, setThemeType } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deleteMode, setDeleteMode] = useState<'bin' | 'forever'>('bin');
  const [snackbar, setSnackbar] = useState('');
  const [undoBatch, setUndoBatch] = useState<string | null>(null);
  const [activeId, setActiveId] = useState('');
  // Kept after closing so the text doesn't change while the dialog fades out.
  const [nameDialog, setNameDialog] = useState<{ editing: Profile | null; name: string; open: boolean } | null>(null);
  const closeNameDialog = () => setNameDialog(d => d && { ...d, open: false });

  const loadProfiles = useCallback(async () => {
    const [list, active] = await Promise.all([getProfiles(), getActiveProfile()]);
    setProfiles(list);
    setActiveId(active.id);
  }, []);

  useFocusEffect(useCallback(() => { loadProfiles().catch(() => {}); }, [loadProfiles]));

  const activeName = profiles.find(p => p.id === activeId)?.name ?? '';

  const handleSaveName = async () => {
    if (!nameDialog) return;
    const name = nameDialog.name.trim();
    if (!name) return;
    try {
      if (nameDialog.editing) await renameProfile(nameDialog.editing.id, name);
      else await addProfile(name);
      closeNameDialog();
      await loadProfiles();
    } catch (error) {
      alert(nameDialog.editing ? "Couldn't rename the profile" : "Couldn't add the profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleSwitch = async (profile: Profile) => {
    if (profile.id === activeId) return;
    try {
      await switchProfile(profile.id);
      await loadProfiles();
    } catch (error) {
      alert("Couldn't switch profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleDeleteProfile = (profile: Profile) => {
    alert(
      'Delete profile?',
      `"${profile.name}" and all its notes will be deleted from this device. This can't be undone. Switch to it and export its notes first if you want a backup.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete profile',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProfile(profile.id);
              await loadProfiles();
            } catch (error) {
              alert("Couldn't delete the profile", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleMoveAllToBin = () => {
    alert(
      'Move all notes to bin?',
      `Every note in the ${activeName} profile moves to the bin. You can restore them from Bin for 30 days.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move all to bin',
          style: 'destructive',
          onPress: async () => {
            try {
              setUndoBatch(await moveAllNotesToBin());
              setSnackbar('All notes moved to bin');
            } catch (error) {
              alert("Couldn't move your notes to the bin", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllForever = () => {
    alert(
      'Delete all notes forever?',
      `Every note in the ${activeName} profile is erased now, without going to the bin. Notes already in the bin stay there. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAllNotesForever();
              setUndoBatch(null);
              setSnackbar('All notes deleted forever');
            } catch (error) {
              alert("Couldn't delete your notes", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleUndoMoveAll = async () => {
    if (!undoBatch) return;
    try {
      await restoreBatch(undoBatch);
    } catch (error) {
      alert("Couldn't restore your notes", 'Open Bin to restore them.');
    }
  };

  const chevron = <List.Icon icon="chevron-right" color={theme.colors.onSurfaceVariant} />;
  const sectionTitle = (title: string) => (
    <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.primary }]}>{title}</Text>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated}
        title="Settings"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          {sectionTitle('Appearance')}
          <SegmentedButtons theme={controlTheme}
            value={themeType}
            onValueChange={value => setThemeType(value as 'light' | 'dark' | 'system')}
            buttons={[
              { value: 'light', label: 'Light', icon: 'white-balance-sunny' },
              { value: 'dark', label: 'Dark', icon: 'weather-night' },
              { value: 'system', label: 'System', icon: 'theme-light-dark' },
            ]}
          />

          {sectionTitle('Profiles')}
          {profiles.map((p, i) => (
            <GroupedRow
              key={p.id}
              title={p.name}
              description={p.id === activeId ? 'Current profile' : 'Tap to switch to this profile'}
              icon={p.id === activeId ? 'account-check' : 'account-outline'}
              onPress={() => handleSwitch(p)}
              right={
                <View style={styles.rowActions}>
                  <IconButton
                    icon="pencil-outline"
                    accessibilityLabel={`Rename ${p.name}`}
                    onPress={() => setNameDialog({ editing: p, name: p.name, open: true })}
                  />
                  {p.id !== activeId && (
                    <IconButton
                      icon="delete-outline"
                      accessibilityLabel={`Delete ${p.name}`}
                      onPress={() => handleDeleteProfile(p)}
                    />
                  )}
                </View>
              }
              isFirst={i === 0}
              isLast={false}
            />
          ))}
          <GroupedRow
            title="Add profile"
            description="A separate set of notes, for work or school"
            icon="account-plus-outline"
            onPress={() => setNameDialog({ editing: null, name: '', open: true })}
            isFirst={false}
            isLast
          />

          {sectionTitle('Your notes')}
          <GroupedRow
            title="Import and export"
            description="Back up your notes or restore a backup"
            icon="swap-vertical"
            right={chevron}
            onPress={() => navigation.navigate('ImportExport')}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title="Bin"
            description="Restore deleted notes for 30 days"
            icon="delete-restore"
            right={chevron}
            onPress={() => navigation.navigate('Bin')}
            isFirst={false}
            isLast={false}
          />
          {/* The swap button flips this row between moving everything to the bin and erasing it without the bin. */}
          <GroupedRow
            title={deleteMode === 'bin' ? 'Move all notes to bin' : 'Delete all notes forever'}
            description={deleteMode === 'bin' ? 'Restorable from Bin for 30 days' : "Skips the bin. Can't be undone."}
            icon={deleteMode === 'bin' ? 'delete-sweep-outline' : 'delete-forever-outline'}
            danger
            onPress={deleteMode === 'bin' ? handleMoveAllToBin : handleDeleteAllForever}
            right={
              <IconButton
                icon="swap-horizontal"
                iconColor={theme.colors.onSurfaceVariant}
                accessibilityLabel={deleteMode === 'bin' ? 'Switch to delete all forever' : 'Switch to move all to bin'}
                onPress={() => setDeleteMode(m => (m === 'bin' ? 'forever' : 'bin'))}
              />
            }
            isFirst={false}
            isLast
          />

          {sectionTitle('App')}
          <GroupedRow
            title="About NoteSpark"
            description="Version, license and source code"
            icon="information-outline"
            right={chevron}
            onPress={() => navigation.navigate('About')}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title="Privacy policy"
            description="Your notes never leave your phone"
            icon="shield-lock-outline"
            right={chevron}
            onPress={() => navigation.navigate('Privacy')}
            isFirst={false}
            isLast
          />
        </View>
      </ScrollView>

      <Snackbar
        visible={!!snackbar}
        onDismiss={() => { setSnackbar(''); setUndoBatch(null); }}
        duration={5000}
        action={undoBatch ? { label: 'Undo', onPress: handleUndoMoveAll } : undefined}
      >
        {snackbar}
      </Snackbar>

      <KeyboardSafePortal>
        <Dialog visible={!!nameDialog?.open} onDismiss={closeNameDialog}>
          <Dialog.Title>{nameDialog?.editing ? 'Rename profile' : 'Add profile'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Profile name"
              value={nameDialog?.name ?? ''}
              onChangeText={name => setNameDialog(d => d && { ...d, name })}
              autoFocus
              onSubmitEditing={handleSaveName}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeNameDialog}>Cancel</Button>
            <Button onPress={handleSaveName} disabled={!nameDialog?.name.trim()}>
              {nameDialog?.editing ? 'Rename' : 'Add profile'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </KeyboardSafePortal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
});

export default SettingsScreen;
