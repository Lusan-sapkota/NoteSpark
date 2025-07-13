// Utility to convert markdown images to their image URLs for plain text mode
function convertImagesToLinks(text: string, isMarkdown: boolean): string {
  if (isMarkdown) {
    // Show original markdown for images and links
    return text;
  } else {
    // Replace markdown image with its URL only
    let result = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
    // Replace markdown links with their URLs only
    result = result.replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1');
    return result;
  }
}
import React, { useState, useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { StyleSheet, View, TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform, Dimensions, Image, Modal, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Switch, Text, Button, IconButton } from 'react-native-paper';
import SafeText from '../components/SafeText';
import { RootStackParamList } from '../types';
import { getNoteById, saveNote, updateNote } from '../storage/database';
import { sendAppNotification } from '../utils/notifications';
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
  const [saving, setSaving] = useState(false);

  // Safely extract noteId from params
  const { noteId } = route.params ?? {};

  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // Image zoom modal state
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Add image to note content as markdown or plain text
  const handleAddImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
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
        const note = await getNoteById(Number(noteId));
        if (note) {
          setTitle(typeof note.title === 'string' ? note.title : String(note.title));
          setContent(Array.isArray(note.content) ? note.content.join('\n') : typeof note.content === 'string' ? note.content : String(note.content));
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
    if (saving) return;
    if (!title.trim()) {
      Alert.alert('Error', 'Title cannot be empty');
      return;
    }
    setSaving(true);
    try {
      if (isEditing && noteId) {
        await updateNote({
          id: Number(noteId),
          title,
          content,
          isMarkdown
        });
      } else {
        const now = new Date().toISOString();
        const id = await saveNote({
          title,
          content,
          isMarkdown,
          createdAt: now,
          updatedAt: now
        });
        // Check if this is the first note
        try {
          const notesModule = await import('../storage/notes');
          const notes = await notesModule.getNotes();
          if (notes.length === 1) {
            await sendAppNotification('First Note Created!', 'Congratulations on creating your first note in NoteSpark!');
          }
        } catch (e) {}
      }
      // Smooth navigation back
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          setSaving(false);
          navigation.goBack();
        }, 120);
      });
    } catch (error) {
      setSaving(false);
      console.error('Failed to save note:', error);
      Alert.alert('Error', 'Failed to save note');
    }
  };

  // Dialog state for link insertion
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background, flex: 1 }]} edges={['left', 'right', 'bottom']}> 
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Removed Add Image/Add Link buttons from top, now only in footer */}
  // Dialog state for link insertion
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
      {/* Link Insert Dialog */}
      {showLinkDialog && (
        <Modal
          visible={showLinkDialog}
          transparent
          animationType="fade"
          onRequestClose={() => setShowLinkDialog(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 16, padding: 24, width: 320 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: theme.colors.primary }}>Insert Link</Text>
              <TextInput
                style={{ borderBottomWidth: 1, borderColor: theme.colors.outline, marginBottom: 16, color: theme.colors.text, fontSize: 16 }}
                placeholder="Link Text"
                value={linkText}
                onChangeText={setLinkText}
                placeholderTextColor={theme.colors.text + '80'}
              />
              <TextInput
                style={{ borderBottomWidth: 1, borderColor: theme.colors.outline, marginBottom: 16, color: theme.colors.text, fontSize: 16 }}
                placeholder="Link URL (https://...)"
                value={linkUrl}
                onChangeText={setLinkUrl}
                placeholderTextColor={theme.colors.text + '80'}
                autoCapitalize="none"
                autoCorrect={false}
              />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                <Button 
                  mode="text" 
                  onPress={() => setShowLinkDialog(false)} 
                  style={{ marginRight: 8, backgroundColor: theme.colors.primary }} 
                  labelStyle={{ color: '#fff' }}
                >
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  onPress={() => {
                  if (!linkUrl.trim()) return;
                  const text = linkText.trim() || linkUrl.trim();
                  const url = linkUrl.trim();
                  // Insert at cursor
                  const before = content.slice(0, selection.start);
                  const after = content.slice(selection.end);
                  setContent(before + `[${text}](${url})` + after);
                  const newPos = before.length + `[${text}](${url})`.length;
                  setSelection({ start: newPos, end: newPos });
                  setShowLinkDialog(false);
                  setLinkText('');
                  setLinkUrl('');
                  }}
                  style={{ backgroundColor: theme.colors.primary }}
                  labelStyle={{ color: '#fff' }}
                >
                  Insert
                </Button>
                </View>
            </View>
          </View>
        </Modal>
      )}
          <TextInput
            style={[styles.titleInput, { color: theme.colors.text, borderBottomColor: theme.colors.outline || theme.colors.primary + '30' }]}
            placeholder="Title"
            placeholderTextColor={theme.colors.text + '80'} // 50% opacity
            value={typeof title === 'string' ? title : String(title)}
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
              {/* Only <br> tags are rendered as line breaks in markdown preview. All other markdown formatting is preserved. */}
              <MarkdownRenderer 
                content={
                  content
                    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '') // Remove images
                    .replace(/<br\s*\/?>(?![^<]*<br)/gi, '\n') // Replace <br> tags with newlines
                }
              />
              {/* Images below with modal support */}
          {(() => {
            const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
            const matches = Array.from(content.matchAll(imageRegex));
            const trimImagePath = (path: string) => {
              if (!path) return '';
              if (path.startsWith('file:///')) {
                const parts = path.split('/');
                const fileName = parts[parts.length - 1];
                return `Local Image (${fileName})`;
              }
              if (path.length > 32) {
                return path.slice(0, 12) + '...' + path.slice(-12);
              }
              return path;
            };
            if (matches.length > 0) {
              return matches.map((m, idx) => (
                <View key={idx} style={{ marginTop: 12, alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>Image:</Text>
                  <View
                    style={{
                      borderRadius: 16,
                      overflow: 'hidden',
                      backgroundColor: theme.dark ? '#222' : '#eee',
                      marginBottom: 12,
                      width: 340,
                      height: 340,
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderWidth: 3,
                      borderColor: theme.dark ? '#444' : '#f5f5f5',
                    }}
                  >
                    {m[1] && m[1].trim() ? (
                      <TouchableOpacity onPress={() => setZoomedImage(m[1].trim())} activeOpacity={0.85}>
                        <Image
                          source={{ uri: m[1].trim() }}
                          style={{ width: 300, height: 300, resizeMode: 'contain', backgroundColor: theme.dark ? '#333' : '#ccc' }}
                          defaultSource={Platform.OS === 'android' ? require('../../assets/icon.png') : undefined}
                          onError={() => {}}
                        />
                      </TouchableOpacity>
                    ) : (
                      <Text style={{ color: theme.colors.error }}>Invalid image URL</Text>
                    )}
                  </View>
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{trimImagePath(m[1])}</Text>
                </View>
              ));
            }
            return null;
          })()}
              {/* Image Zoom Modal */}
              <Modal
                visible={!!zoomedImage}
                transparent
                animationType="fade"
                onRequestClose={() => setZoomedImage(null)}
              >
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
                  <TouchableOpacity
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    activeOpacity={1}
                    onPress={() => setZoomedImage(null)}
                  />
                  <ScrollView
                    style={{ flex: 1, width: '100%' }}
                    contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    centerContent
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                  >
                    {zoomedImage && (
                      <Image
                        source={{ uri: zoomedImage }}
                        style={{
                          width: Dimensions.get('window').width - 32,
                          height: Dimensions.get('window').height - 120,
                          resizeMode: 'contain',
                          borderRadius: 16,
                          backgroundColor: '#222',
                        }}
                      />
                    )}
                  </ScrollView>
                  <TouchableOpacity
                    onPress={() => setZoomedImage(null)}
                    style={{ position: 'absolute', top: 36, right: 24, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: 4 }}
                    accessibilityLabel="Close image preview"
                  >
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold' }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </Modal>
            </View>
          ) : (
            <View style={[styles.previewContainer, { borderColor: theme.colors.outline || theme.colors.primary + '30' }]}> 
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[styles.contentInput, { color: theme.colors.text }]}
                  value={convertImagesToLinks(content, isMarkdown)}
                  onChangeText={setContent}
                  multiline
                  textAlignVertical="top"
                  selectionColor={theme.colors.primary}
                  placeholder={isMarkdown ? 'Enter markdown content...' : 'Enter note content...'}
                  placeholderTextColor={theme.colors.text + '80'}
                  autoCorrect
                  autoCapitalize="sentences"
                  selection={selection}
                  onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                />
                {selection.start !== selection.end && (
                  <View
                    pointerEvents="box-none"
                    style={{
                      position: 'absolute',
                      zIndex: 20,
                      right: 12,
                      top: 90 + Math.floor(selection.start / 40) * 24, // further offset for below selection bar
                      backgroundColor: theme.colors.surface,
                      borderRadius: 16,
                      elevation: 6,
                      shadowColor: '#000',
                      shadowOpacity: 0.15,
                      shadowRadius: 6,
                      padding: 2,
                    }}
                  >
                    <IconButton
                      icon="close"
                      size={20}
                      style={{ backgroundColor: theme.colors.error, margin: 0 }}
                      iconColor="#fff"
                      onPress={() => {
                        setContent(
                          content.slice(0, selection.start) + content.slice(selection.end)
                        );
                        setSelection({ start: selection.start, end: selection.start });
                      }}
                      accessibilityLabel="Delete selected text"
                    />
                  </View>
                )}
              </View>
            </View>
          )}
        </ScrollView>
        <View style={[styles.buttonContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}> 
          <Button
            mode="contained"
            onPress={handleSave}
            style={[
              styles.saveButton,
              { 
                backgroundColor: theme.colors.primary, 
                flex: isMarkdown ? 6 : 7, // Reduce flex if two icon buttons
                marginRight: 0 
              }
            ]}
            labelStyle={{ color: 'white', fontSize: 18 }}
            loading={saving}
            disabled={saving}
          >
            Save
          </Button>
          <View 
            style={{ 
              flexDirection: 'row', 
              flex: isMarkdown ? 3 : 2, // Increase flex if two icon buttons
              justifyContent: 'flex-end', 
              alignItems: 'center' 
            }}
          >
            <IconButton
              icon="image"
              size={28}
              onPress={async () => {
                let result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  quality: 0.7,
                });
                if (!result.canceled && result.assets?.[0]?.uri) {
                  const uri = result.assets[0].uri;
                  // Insert at cursor
                  const before = content.slice(0, selection.start);
                  const after = content.slice(selection.end);
                  if (isMarkdown) {
                    setContent(before + `![Image](${uri})` + after);
                    const newPos = before.length + `![Image](${uri})`.length;
                    setSelection({ start: newPos, end: newPos });
                  } else {
                    setContent(before + `[Image: ${uri}]` + after);
                    const newPos = before.length + `[Image: ${uri}]`.length;
                    setSelection({ start: newPos, end: newPos });
                  }
                }
              }}
              style={{ backgroundColor: theme.colors.surfaceVariant, marginRight: isMarkdown ? 8 : 0 }}
              accessibilityLabel="Add Image"
            />
            {isMarkdown && (
              <IconButton
                icon="link"
                size={28}
                onPress={() => setShowLinkDialog(true)}
                style={{ backgroundColor: theme.colors.surfaceVariant, marginLeft: 0 }}
                accessibilityLabel="Add Link"
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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