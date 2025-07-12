import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Alert, Share, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Text, ActivityIndicator } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { exportNotesAsJson, importNotesFromJson } from '../storage/database';
import { sendAppNotification } from '../utils/notifications';
import { importNotesFromFile } from '../storage/database';
import Header from '../components/Header';
import { useTheme } from '../theme/ThemeContext';

type ImportExportScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportExport'>;

const ImportExportScreen: React.FC = () => {
  const navigation = useNavigation<ImportExportScreenNavigationProp>();
  const { theme } = useTheme();
  const [importData, setImportData] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [fileImporting, setFileImporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const jsonData = await exportNotesAsJson();
      
      await Share.share({
        message: jsonData,
        title: 'NoteSpark Notes Backup',
      });
      await sendAppNotification('Notes Exported', 'Your notes have been exported successfully!');
      setIsExporting(false);
    } catch (error) {
      console.error('Failed to export notes:', error);
      Alert.alert('Error', 'Failed to export notes');
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importData.trim()) {
      Alert.alert('Error', 'Please enter JSON data to import');
      return;
    }
    Alert.alert(
      'Import Notes',
      'Importing will replace all existing notes. Are you sure you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsImporting(true);
              const notesModule = await import('../storage/notes');
              const result = await notesModule.importNotesFromJson(importData);
              setIsImporting(false);
              setImportData('');
              if (typeof result === 'number' && result > 0) {
                console.log(`Imported ${result} notes.`);
                await sendAppNotification('Notes Imported', `${result} notes imported successfully!`);
                Alert.alert('Success', `${result} notes imported successfully`, [
                  { text: 'OK', onPress: () => navigation.goBack() },
                ]);
              } else {
                Alert.alert('Warning', 'No valid notes found in import data.');
              }
            } catch (error) {
              console.error('Failed to import notes:', error);
              Alert.alert('Error', 'Failed to import notes. Please check your JSON data format.');
              setIsImporting(false);
            }
          },
        },
      ]
    );
  };

  const handleFileImport = async () => {
    Alert.alert(
      'Import Notes from File',
      'Importing will replace all existing notes. Are you sure you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: 'destructive',
          onPress: async () => {
            try {
              setFileImporting(true);
              const count = await importNotesFromFile();
              setFileImporting(false);
              await sendAppNotification('Notes Imported', `${count} notes imported successfully!`);
              Alert.alert('Success', `${count} notes imported successfully`, [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } catch (error) {
              setFileImporting(false);
              Alert.alert('Error', 'Failed to import notes from file. Please check your JSON file.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Import/Export"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.scrollView}>
        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Card.Title 
            title="Export Notes" 
            titleStyle={{ color: theme.colors.primary }}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.text, marginBottom: 16 }}>
              Export all your notes as a JSON file that you can save as a backup or transfer to another device.
            </Text>
            <Button
              mode="contained"
              onPress={handleExport}
              loading={isExporting}
              disabled={isExporting}
              style={{ backgroundColor: theme.colors.primary }}
            >
              Export Notes
            </Button>
          </Card.Content>
        </Card>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Card.Title 
            title="Import Notes" 
            titleStyle={{ color: theme.colors.primary }}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.text, marginBottom: 16 }}>
              Import notes from a JSON backup. This will replace all existing notes.
            </Text>
            <TextInput
              style={[styles.importInput, { 
                color: theme.colors.text,
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.text + '40', // 25% opacity
              }]}
              placeholder="Paste JSON data here"
              placeholderTextColor={theme.colors.text + '80'} // 50% opacity
              value={importData}
              onChangeText={setImportData}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
            />
            <Button
              mode="outlined"
              onPress={handleFileImport}
              loading={fileImporting}
              disabled={fileImporting}
              style={{ marginTop: 12, borderColor: theme.colors.primary }}
              labelStyle={{ color: theme.colors.primary }}
            >
              Upload JSON File
            </Button>
            <Button
              mode="contained"
              onPress={handleImport}
              loading={isImporting}
              disabled={isImporting || !importData.trim()}
              style={{ backgroundColor: theme.colors.primary, marginTop: 16 }}
              labelStyle={{ color: '#fff' }}
            >
              Import Notes
            </Button>

          </Card.Content>
        </Card>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Card.Title 
            title="Warning" 
            titleStyle={{ color: theme.colors.error }}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.text }}>
              Importing notes will replace all existing notes in the app. Make sure to export your current notes first if you want to keep them.
            </Text>
          </Card.Content>
        </Card>
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
    padding: 16,
  },
  card: {
    marginBottom: 16,
    elevation: 2,
  },
  importInput: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    minHeight: 120,
  },
});

export default ImportExportScreen; 