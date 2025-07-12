import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Alert, Share, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Text, ActivityIndicator } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { exportNotesAsJson, importNotesFromJson } from '../storage/database';
import Header from '../components/Header';
import { useTheme } from '../theme/ThemeContext';

type ImportExportScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportExport'>;

const ImportExportScreen: React.FC = () => {
  const navigation = useNavigation<ImportExportScreenNavigationProp>();
  const { theme } = useTheme();
  const [importData, setImportData] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const jsonData = await exportNotesAsJson();
      
      await Share.share({
        message: jsonData,
        title: 'NoteSpark Notes Backup',
      });
      
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

    try {
      setIsImporting(true);
      await importNotesFromJson(importData);
      setIsImporting(false);
      setImportData('');
      Alert.alert('Success', 'Notes imported successfully', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error('Failed to import notes:', error);
      Alert.alert('Error', 'Failed to import notes. Please check your JSON data format.');
      setIsImporting(false);
    }
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
              mode="contained"
              onPress={handleImport}
              loading={isImporting}
              disabled={isImporting || !importData.trim()}
              style={{ backgroundColor: theme.colors.primary, marginTop: 16 }}
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