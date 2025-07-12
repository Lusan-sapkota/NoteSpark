import React from 'react';
import { StyleSheet, View, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { List, Divider, RadioButton, Text } from 'react-native-paper';
import { RootStackParamList } from '../types';
import Header from '../components/Header';
import { useTheme } from '../theme/ThemeContext';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { theme, themeType, setThemeType } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Settings"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.scrollView}>
        <List.Section>
          <List.Subheader style={{ color: theme.colors.primary }}>Appearance</List.Subheader>
          
          <RadioButton.Group
            onValueChange={(value) => setThemeType(value as 'light' | 'dark' | 'system')}
            value={themeType}
          >
            <View style={styles.radioItem}>
              <RadioButton.Item
                label="Light Theme"
                value="light"
                color={theme.colors.primary}
                labelStyle={{ color: theme.colors.text }}
              />
            </View>
            
            <View style={styles.radioItem}>
              <RadioButton.Item
                label="Dark Theme"
                value="dark"
                color={theme.colors.primary}
                labelStyle={{ color: theme.colors.text }}
              />
            </View>
            
            <View style={styles.radioItem}>
              <RadioButton.Item
                label="System Default"
                value="system"
                color={theme.colors.primary}
                labelStyle={{ color: theme.colors.text }}
              />
            </View>
          </RadioButton.Group>
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader style={{ color: theme.colors.primary }}>Data Management</List.Subheader>
          
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
                    onPress: () => {
                      // TODO: Implement clear all notes functionality
                      Alert.alert('Not Implemented', 'This feature is not yet implemented.');
                    },
                  },
                ]
              );
            }}
          />
        </List.Section>

        <Divider />

          <List.Section>
            <List.Subheader style={{ color: theme.colors.primary }}>About</List.Subheader>
            <List.Item
              title="About NoteSpark"
              description="Developer, License, Version, GitHub"
              titleStyle={{ color: theme.colors.text }}
              descriptionStyle={{ color: theme.colors.text + 'AA' }}
              left={(props) => <List.Icon {...props} icon="information" color={theme.colors.primary} />}
              onPress={() => navigation.navigate('About')}
            />
          </List.Section>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  radioItem: {
    marginVertical: -8,
  },
});

export default SettingsScreen; 