import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Switch, Text, Button } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { getNoteById, saveNote, updateNote } from '../storage/database';
import { Note } from '../types';
import Header from '../components/Header';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { useTheme } from '../theme/ThemeContext';

type EditorScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Editor'>;
type EditorScreenRouteProp = RouteProp<RootStackParamList, 'Editor'>;

const EditorScreen: React.FC = () => {
  const navigation = useNavigation<EditorScreenNavigationProp>();
  const route = useRoute<EditorScreenRouteProp>();
  const { theme } = useTheme();
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const loadNote = async () => {
      if (route.params?.noteId) {
        try {
          const note = await getNoteById(route.params.noteId);
          if (note) {
            setTitle(note.title);
            setContent(note.content);
            setIsMarkdown(note.isMarkdown);
            setIsEditing(true);
          }
        } catch (error) {
          console.error('Failed to load note:', error);
          Alert.alert('Error', 'Failed to load note');
        }
      }
    };

    loadNote();
  }, [route.params?.noteId]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title cannot be empty');
      return;
    }

    try {
      if (isEditing && route.params?.noteId) {
        await updateNote({
          id: route.params.noteId,
          title,
          content,
          isMarkdown,
          createdAt: '', // This will be ignored in the update
          updatedAt: '', // This will be updated in the database function
        });
      } else {
        await saveNote({
          title,
          content,
          isMarkdown,
          createdAt: '', // This will be set in the database function
          updatedAt: '', // This will be set in the database function
        });
      }
      navigation.goBack();
    } catch (error) {
      console.error('Failed to save note:', error);
      Alert.alert('Error', 'Failed to save note');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title={isEditing ? 'Edit Note' : 'New Note'}
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView style={styles.scrollView}>
          <TextInput
            style={[styles.titleInput, { color: theme.colors.text }]}
            placeholder="Title"
            placeholderTextColor={theme.colors.text + '80'} // 50% opacity
            value={title}
            onChangeText={setTitle}
          />

          <View style={styles.optionsRow}>
            <View style={styles.optionItem}>
              <Text style={{ color: theme.colors.text }}>Markdown</Text>
              <Switch
                value={isMarkdown}
                onValueChange={setIsMarkdown}
                color={theme.colors.primary}
              />
            </View>
            
            {isMarkdown && (
              <View style={styles.optionItem}>
                <Text style={{ color: theme.colors.text }}>Preview</Text>
                <Switch
                  value={isPreview}
                  onValueChange={setIsPreview}
                  color={theme.colors.primary}
                />
              </View>
            )}
          </View>

          {isMarkdown && isPreview ? (
            <View style={styles.previewContainer}>
              <MarkdownRenderer content={content} />
            </View>
          ) : (
            <TextInput
              style={[styles.contentInput, { color: theme.colors.text }]}
              placeholder="Note content"
              placeholderTextColor={theme.colors.text + '80'} // 50% opacity
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
            />
          )}
        </ScrollView>

        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={handleSave}
            style={[styles.saveButton, { backgroundColor: theme.colors.primary }]}
            labelStyle={{ color: 'white' }}
          >
            Save
          </Button>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  optionsRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 24,
  },
  contentInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 300,
    textAlignVertical: 'top',
  },
  previewContainer: {
    flex: 1,
    minHeight: 300,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
  },
  buttonContainer: {
    padding: 16,
  },
  saveButton: {
    borderRadius: 4,
  },
});

export default EditorScreen; 