import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { useNetInfo } from '@react-native-community/netinfo';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { List, Divider, RadioButton, Text } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { clearAllNotes } from '../storage/notes';
import Header from '../components/Header';
import { useTheme } from '../theme/ThemeContext';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { theme, themeType, setThemeType } = useTheme();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const netInfo = useNetInfo();
  // Handler for checking and applying updates
  const handleCheckUpdate = async () => {
    if (!netInfo.isConnected) {
      Alert.alert(
        'No Internet Connection',
        'Looks like you are not connected. App is offline; update needs to be online. Please connect and try again.'
      );
      return;
    }
    setCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      setCheckingUpdate(false);
      if (update.isAvailable) {
        Alert.alert(
          'Update Available',
          'A new version of NoteSpark is available. Would you like to update now?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Update Now', style: 'default', onPress: async () => {
                try {
                  setCheckingUpdate(true);
                  await Updates.fetchUpdateAsync();
                  setCheckingUpdate(false);
                  Alert.alert('Update Ready', 'The app will now reload to apply the update.', [
                    { text: 'OK', onPress: () => Updates.reloadAsync() }
                  ]);
                } catch (err) {
                  setCheckingUpdate(false);
                  Alert.alert('Update Failed', 'Failed to download the update. Please try again later.');
                }
              }
            }
          ]
        );
      } else {
        Alert.alert('Up to Date', 'You already have the latest version of NoteSpark.');
      }
    } catch (e) {
      setCheckingUpdate(false);
      Alert.alert('Error', 'Could not check for updates.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Settings"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentWrapper}>
          <List.Section>
            <List.Subheader style={[styles.subheader, { color: theme.colors.primary }]}>App Updates</List.Subheader>
            <List.Item
              title="Check for Updates"
              description="Get the latest features and fixes"
              titleStyle={{ color: theme.colors.primary }}
              descriptionStyle={{ color: theme.colors.text + 'AA' }}
              left={(props) => <List.Icon {...props} icon="update" color={theme.colors.primary} />}
              onPress={handleCheckUpdate}
              right={() => checkingUpdate ? <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginRight: 16 }} /> : null}
            />
          </List.Section>
          <List.Section>
            <List.Subheader style={[styles.subheader, { color: theme.colors.primary }]}>Appearance</List.Subheader>
            <RadioButton.Group
              onValueChange={(value) => setThemeType(value as 'light' | 'dark' | 'system')}
              value={themeType}
            >
              <RadioButton.Item
                label="Light Theme"
                value="light"
                color={theme.colors.primary}
                labelStyle={{ color: theme.colors.text }}
                style={styles.radioItem}
              />
              <RadioButton.Item
                label="Dark Theme"
                value="dark"
                color={theme.colors.primary}
                labelStyle={{ color: theme.colors.text }}
                style={styles.radioItem}
              />
              <RadioButton.Item
                label="System Default"
                value="system"
                color={theme.colors.primary}
                labelStyle={{ color: theme.colors.text }}
                style={styles.radioItem}
              />
            </RadioButton.Group>
          </List.Section>

          <Divider style={styles.divider} />

          <List.Section>
            <List.Subheader style={[styles.subheader, { color: theme.colors.primary }]}>
              Data Management
            </List.Subheader>

            <List.Item
              title="Import/Export Notes"
              description="Backup or restore your notes"
              titleStyle={{ color: theme.colors.text }}
              descriptionStyle={{ color: theme.colors.text + 'AA' }}
              left={(props) => <List.Icon {...props} icon="database-import-outline" color={theme.colors.primary} />}
              onPress={() => navigation.navigate('ImportExport')}
            />

            <List.Item
              title="Clear All Notes"
              description="Delete all notes (cannot be undone)"
              titleStyle={{ color: theme.colors.error }}
              descriptionStyle={{ color: theme.colors.error + 'AA' }}
              left={(props) => <List.Icon {...props} icon="delete-forever" color={theme.colors.error} />}
              onPress={() => {
                Alert.alert(
                  'Clear All Notes',
                  'Are you sure you want to delete all notes? This action cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete All',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await clearAllNotes();
                          Alert.alert('Success', 'All notes have been deleted.');
                        } catch (error) {
                          Alert.alert('Error', 'Failed to delete all notes.');
                        }
                      },
                    },
                  ]
                );
              }}
            />
          </List.Section>

          <Divider style={styles.divider} />

          <List.Section>
            <List.Subheader style={[styles.subheader, { color: theme.colors.primary }]}>
              About
            </List.Subheader>
            <List.Item
              title="About NoteSpark"
              description="Developer, License, Version, GitHub"
              titleStyle={{ color: theme.colors.text }}
              descriptionStyle={{ color: theme.colors.text + 'AA' }}
              left={(props) => <List.Icon {...props} icon="information" color={theme.colors.primary} />}
              onPress={() => navigation.navigate('About')}
            />
          </List.Section>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  contentWrapper: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  radioItem: {
    marginVertical: -2,
  },
  divider: {
    marginVertical: 12,
    height: 1,
  },
  subheader: {
    fontWeight: '700',
    fontSize: 16,
    paddingLeft: 0,
    marginBottom: 4,
  },
});

export default SettingsScreen;
