import React, { useState, useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { StyleSheet, View, TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
  // Add image to note content as markdown or plain text
  const handleAddImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      const uri = result.assets[0].uri;
      if (isMarkdown) {
        setContent(content + `\n\n![Image](${uri})\n`);
      } else {
        setContent(content + `\n[Image: ${uri}]\n`);
      }
    }
  };
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

  // Safely extract noteId from params
  const { noteId } = route.params ?? {};

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Add image to note content as markdown or plain text
  const handleAddImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      const uri = result.assets[0].uri;
      if (isMarkdown) {
        setContent(content + `\n\n![Image](${uri})\n`);
      } else {
        setContent(content + `\n[Image: ${uri}]\n`);
      }
    }
  };

  useEffect(() => {
    // Support both edit and create modes
    if (!noteId) {
      setIsEditing(false);
      setTitle('');
      setContent('');
      setIsMarkdown(false);
      setCreatedAt(null);
      setUpdatedAt(null);
      return;
    }
    const loadNote = async () => {
      try {
        const note = await getNoteById(noteId);
        if (note) {
          setTitle(note.title);
          setContent(note.content);
          setIsMarkdown(note.isMarkdown);
          setIsEditing(true);
          setCreatedAt(note.createdAt);
          setUpdatedAt(note.updatedAt);
        } else {
          Alert.alert('Error', 'Note not found');
        }
      } catch (error) {
        console.error('Failed to load note:', error);
        Alert.alert('Error', 'Failed to load note');
      }
    };
    loadNote();
  }, [noteId]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title cannot be empty');
      return;
    }
    try {
      if (isEditing && noteId) {
        await updateNote({
          id: noteId,
          title,
          content,
          isMarkdown
        });
      } else {
        const now = new Date().toISOString();
        await saveNote({
          title,
          content,
          isMarkdown,
          createdAt: now,
          updatedAt: now
        });
      }
      // Smooth navigation back
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          navigation.goBack();
        }, 120);
      });
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

      {isEditing && (
        <View style={[styles.timestampContainer, { 
          backgroundColor: theme.colors.surface || theme.colors.background,
          borderBottomColor: theme.colors.outline || theme.colors.primary + '20'
        }]}>
          <View style={styles.timestampRow}>
            <View style={styles.timestampItem}>
              <Text style={[styles.timestampLabel, { color: theme.colors.primary }]}>
                Created
              </Text>
              <Text style={[styles.timestampValue, { color: theme.colors.text }]}>
                {createdAt ? new Date(createdAt).toLocaleString() : 'Unknown'}
              </Text>
            </View>
            
            <View style={[styles.timestampDivider, { backgroundColor: theme.colors.outline || theme.colors.primary + '30' }]} />
            
            <View style={styles.timestampItem}>
              <Text style={[styles.timestampLabel, { color: theme.colors.primary }]}>
                Last Edited
              </Text>
              <Text style={[styles.timestampValue, { color: theme.colors.text }]}>
                {updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown'}
              </Text>
            </View>
          </View>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView style={styles.scrollView}>
          <Button icon="image" mode="outlined" onPress={handleAddImage} style={{ marginBottom: 12 }}>
            Add Image
          </Button>
          <TextInput
            style={[styles.titleInput, { color: theme.colors.text, borderBottomColor: theme.colors.outline || theme.colors.primary + '30' }]}
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
            <View style={[styles.previewContainer, { borderColor: theme.colors.outline || theme.colors.primary + '30' }]}>
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
            selectionColor={theme.colors.primary}
            contextMenuHidden={false}
            editable={true}
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
  timestampContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 8,
    borderBottomWidth: 1,
    elevation: 1, // Android shadow
    shadowColor: '#000', // iOS shadow
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  timestampRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  timestampItem: {
    flex: 1,
    alignItems: 'center',
  },
  timestampDivider: {
    width: 1,
    marginHorizontal: 16,
    opacity: 0.3,
  },
  timestampLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timestampValue: {
    fontSize: 13,
    textAlign: 'center',
    opacity: 0.8,
    lineHeight: 18,
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