import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Linking } from 'react-native';
import * as Updates from 'expo-updates';
import { useNetInfo } from '@react-native-community/netinfo';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, List, SegmentedButtons, Text } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { clearAllNotes } from '../storage/notes';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const errorReason = (e: unknown) => (e instanceof Error ? `${e.message}. ` : '');

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { theme, themeType, setThemeType } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const netInfo = useNetInfo();

  const applyUpdate = async () => {
    try {
      setCheckingUpdate(true);
      await Updates.fetchUpdateAsync();
      setCheckingUpdate(false);
      await Updates.reloadAsync();
    } catch (err) {
      setCheckingUpdate(false);
      alert("Couldn't download the update", `${errorReason(err)}Check your internet connection and try again.`);
    }
  };

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;

    if (!netInfo.isConnected) {
      alert("You're offline", 'Connect to the internet to check for updates. Your notes work offline as usual.');
      return;
    }

    setCheckingUpdate(true);

    try {
      const update = await Updates.checkForUpdateAsync();
      setCheckingUpdate(false);
      if (update.isAvailable) {
        alert(
          'Update available',
          'A new version of NoteSpark is ready. The app will restart to install it.',
          [{ text: 'Update now', onPress: applyUpdate }],
          { cancelable: false }
        );
      } else {
        alert("You're up to date", 'You have the latest version of NoteSpark.');
      }
    } catch (e) {
      setCheckingUpdate(false);
      alert("Couldn't check for updates", `${errorReason(e)}Check your internet connection and try again.`);
    }
  };

  const handleDeleteAll = () => {
    alert(
      'Delete all notes?',
      "Every note on this device will be deleted. This can't be undone. Export your notes first if you want a backup.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all notes',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllNotes();
              alert('All notes deleted');
            } catch (error) {
              alert("Couldn't delete your notes", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleWhatsNext = () => {
    alert(
      "What's next",
      'Planned for NoteSpark:\n\n- Vault encryption\n- Secure sync between your phone and the web\n- A web app that works without the cloud',
      [
        { text: 'OK', style: 'cancel' },
        { text: 'Learn more', onPress: () => Linking.openURL('https://notespark.lusansapkota.com.np') },
      ]
    );
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
          <SegmentedButtons
            value={themeType}
            onValueChange={value => setThemeType(value as 'light' | 'dark' | 'system')}
            buttons={[
              { value: 'light', label: 'Light', icon: 'white-balance-sunny' },
              { value: 'dark', label: 'Dark', icon: 'weather-night' },
              { value: 'system', label: 'System', icon: 'theme-light-dark' },
            ]}
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
            title="Delete all notes"
            description="Removes every note from this device"
            icon="delete-outline"
            danger
            onPress={handleDeleteAll}
            isFirst={false}
            isLast
          />

          {sectionTitle('App')}
          <GroupedRow
            title="Check for updates"
            description="Get the latest fixes and features"
            icon="update"
            right={checkingUpdate ? <ActivityIndicator style={styles.spinner} /> : undefined}
            onPress={handleCheckUpdate}
            disabled={checkingUpdate}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title="About NoteSpark"
            description="Version, license and source code"
            icon="information-outline"
            right={chevron}
            onPress={() => navigation.navigate('About')}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title="What's next"
            description="Vault encryption, sync and a web app"
            icon="lightbulb-outline"
            right={chevron}
            onPress={handleWhatsNext}
            isFirst={false}
            isLast
          />
        </View>
      </ScrollView>
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
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  spinner: {
    marginRight: space.sm,
  },
});

export default SettingsScreen;
