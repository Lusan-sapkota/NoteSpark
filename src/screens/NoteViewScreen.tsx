import React, { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { Clipboard } from 'react-native';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Text, IconButton, Card, Divider, Chip } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { getNoteById, deleteNote } from '../storage/database';
import { Note } from '../types';
import Header from '../components/Header';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { useTheme } from '../theme/ThemeContext';

// Types


// Fallback to any if types are not available
type NoteViewScreenNavigationProp = NativeStackNavigationProp<any>;
type NoteViewScreenRouteProp = RouteProp<any>;

const NoteViewScreen: React.FC = () => {
  const navigation = useNavigation<NoteViewScreenNavigationProp>();
  const route = useRoute<NoteViewScreenRouteProp>();
  const { theme } = useTheme();
  const [note, setNote] = useState<Note | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  // Helper to strip markdown syntax for copy
  const getPlainText = (markdown: string) =>
    markdown
      .replace(/^\s*#{1,6}\s*/gm, '') // headings
      .replace(/^\s*[-*+]\s+/gm, '') // unordered lists
      .replace(/^\s*\d+\.\s+/gm, '') // ordered lists
      .replace(/^\s*>\s?/gm, '') // blockquotes
      .replace(/`{1,3}[^`]*`{1,3}/g, '') // inline code
      .replace(/!\[[^\]]*\]\([^\)]*\)/g, '') // images
      .replace(/\[([^\]]*)\]\([^\)]*\)/g, '$1') // links
      .replace(/[*_~`]/g, '') // formatting
      .replace(/\n{2,}/g, '\n') // extra newlines
      .trim();
  const handleCopyAll = () => {
    if (note) {
      const text = note.isMarkdown && showRaw ? getPlainText(note.content) : note.content;
      Clipboard.setString(text);
      setCopyMsg('Copied!');
      setTimeout(() => setCopyMsg(''), 1200);
    }
  };

  useEffect(() => {
    const loadNote = async () => {
      if ((route.params as any)?.noteId) {
        try {
          const fetchedNote = await getNoteById((route.params as any).noteId);
          setNote(fetchedNote);
        } catch (error) {
          Alert.alert('Error', 'Failed to load note');
        }
      }
    };
    loadNote();
  }, [(route.params as any)?.noteId]);

  const handleDelete = () => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(note!.id);
            InteractionManager.runAfterInteractions(() => {
              setTimeout(() => {
                navigation.goBack();
              }, 120);
            });
          } catch (error) {
            Alert.alert('Error', 'Failed to delete note');
          }
        },
      },
    ]);
  };

  const handleEdit = () => {
    navigation.navigate('Editor', { noteId: note!.id });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!note) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
        <Header title="View Note" showBackButton onBackPress={() => {
          InteractionManager.runAfterInteractions(() => {
            setTimeout(() => {
              navigation.goBack();
            }, 120);
          });
        }} />
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <Header title="View Note" showBackButton onBackPress={() => {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            navigation.goBack();
          }, 120);
        });
      }} />
      
      <ScrollView 
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Main Note Card */}
        <Card style={[styles.noteCard, { backgroundColor: theme.colors.surface }]} elevation={3}>
          <Card.Content style={styles.cardContent}>
            {/* Header Section with Type Badge */}
            <View style={styles.headerSection}>
              <View style={styles.titleRow}>
                <View style={styles.titleContent}>
                  <Text style={[styles.title, { color: theme.colors.primary }]}>
                    {note.title}
                  </Text>
                  <Chip 
                    icon={note.isMarkdown ? 'language-markdown' : 'format-text'}
                    style={[
                      styles.typeChip,
                      { 
                        backgroundColor: note.isMarkdown 
                          ? theme.colors.tertiaryContainer 
                          : theme.colors.primaryContainer 
                      }
                    ]}
                    textStyle={[
                      styles.chipText,
                      { 
                        color: note.isMarkdown 
                          ? theme.colors.onTertiaryContainer 
                          : theme.colors.onPrimaryContainer 
                      }
                    ]}
                  >
                    {note.isMarkdown ? 'Markdown' : 'Plain Text'}
                  </Chip>
                </View>
              </View>
              
              {/* Date Information */}
              <View style={styles.dateContainer}>
                <View style={styles.dateRow}>
                  <Text style={[styles.dateLabel, { color: theme.colors.onSurfaceVariant }]}>
                    Created
                  </Text>
                  <Text style={[styles.dateValue, { color: theme.colors.onSurface }]}>
                    {formatDate(note.createdAt)}
                  </Text>
                </View>
                <View style={styles.dateRow}>
                  <Text style={[styles.dateLabel, { color: theme.colors.onSurfaceVariant }]}>
                    Modified
                  </Text>
                  <Text style={[styles.dateValue, { color: theme.colors.onSurface }]}>
                    {formatDate(note.updatedAt)}
                  </Text>
                </View>
              </View>
            </View>

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            {/* Content Section */}
            <View style={styles.contentSection}>
              <Text style={[styles.contentLabel, { color: theme.colors.onSurfaceVariant }]}>
                Content
              </Text>
              <View style={styles.contentContainer}>
                {note.isMarkdown ? (
                  showRaw ? (
                    <Text style={[styles.content, { color: theme.colors.onSurface }]} selectable selectionColor={theme.colors.primary}>
                      {getPlainText(note.content)}
                    </Text>
                  ) : (
                    <MarkdownRenderer content={note.content} />
                  )
                ) : (
                  <Text style={[styles.content, { color: theme.colors.onSurface }]} selectable selectionColor={theme.colors.primary}> 
                    {note.content}
                  </Text>
                )}
                {note.isMarkdown && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <Button mode="outlined" onPress={() => setShowRaw((v) => !v)} style={{ marginRight: 8 }}>
                      {showRaw ? 'Show Markdown' : 'Show Plain Text'}
                    </Button>
                    <Button mode="contained" onPress={handleCopyAll}>
                      Copy All
                    </Button>
                    {!!copyMsg && (
                      <Text style={{ marginLeft: 8, color: theme.colors.primary }}>{copyMsg}</Text>
                    )}
                  </View>
                )}
              </View>
            </View>
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Floating Action Buttons */}
      <View style={[styles.fabContainer, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.fabRow}>
          <IconButton 
            icon="pencil" 
            iconColor={theme.colors.onPrimary} 
            size={24} 
            onPress={handleEdit}
            style={[styles.editButton, { backgroundColor: theme.colors.primary }]}
          />
          <IconButton 
            icon="delete" 
            iconColor={theme.colors.onError} 
            size={24} 
            onPress={handleDelete}
            style={[styles.deleteButton, { backgroundColor: theme.colors.error }]}
          />
        </View>
      </View>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 100, // Space for FAB
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  noteCard: {
    borderRadius: 16,
    marginBottom: 16,
  },
  cardContent: {
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  headerSection: {
    marginBottom: 24,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleContent: {
    flex: 1,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 40,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  typeChip: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateContainer: {
    gap: 8,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.8,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    marginVertical: 24,
    height: 1,
  },
  contentSection: {
    gap: 16,
  },
  contentLabel: {
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.8,
  },
  contentContainer: {
    minHeight: 200,
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  content: {
    fontSize: 18,
    lineHeight: 28,
    letterSpacing: 0.3,
    fontWeight: '400',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  fabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  editButton: {
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  deleteButton: {
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});

export default NoteViewScreen;