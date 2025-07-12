import React, { useEffect, useState, useCallback } from 'react';
import { RefreshControl } from 'react-native';
import { InteractionManager } from 'react-native';
import { Clipboard } from 'react-native';
import { View, StyleSheet, ScrollView, Alert, Platform, Image, Modal, TouchableOpacity, Dimensions } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
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
  const [refreshing, setRefreshing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  // Image zoom modal state
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  // Helper to strip markdown syntax for copy (convert images and links to URLs only)
  const getPlainText = (markdown: string) =>
    markdown
      .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1') // images to URL
      .replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1') // links to URL
      .replace(/^\s*#{1,6}\s*/gm, '') // headings
      .replace(/^\s*[-*+]\s+/gm, '') // unordered lists
      .replace(/^\s*\d+\.\s+/gm, '') // ordered lists
      .replace(/^\s*>\s?/gm, '') // blockquotes
      .replace(/`{1,3}[^`]*`{1,3}/g, '') // inline code
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

  // Load note on mount and when screen is focused (after edit)
  const reloadNote = async () => {
    setRefreshing(true);
    if ((route.params as any)?.noteId) {
      try {
        const fetchedNote = await getNoteById((route.params as any).noteId);
        setNote(fetchedNote);
      } catch (error) {
        Alert.alert('Error', 'Failed to load note');
      }
    }
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      reloadNote();
    }, [(route.params as any)?.noteId])
  );

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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={reloadNote} tintColor={theme.colors.primary} />
        }
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
                    <>
                      <Text
                        style={{
                          fontSize: 16,
                          lineHeight: 18,
                          color: theme.colors.onSurface,
                          includeFontPadding: false,
                          textAlignVertical: 'center',
                          marginVertical: -2,
                        }}
                        selectable
                        selectionColor={theme.colors.primary}
                      >
                        {getPlainText(note.content)}
                      </Text>
                      {/* Render images below plain text if any image links exist */}
                      {(() => {
                        const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
                        const matches = Array.from(note.content.matchAll(imageRegex));
                        if (matches.length > 0) {
                          return matches.map((m, idx) => (
                            <View key={`rawimg-${idx}-${m[1]}`} style={{ marginTop: 12, alignItems: 'center' }}>
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
                              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{m[1]}</Text>
                            </View>
                          ));
                        }
                        return null;
                      })()}
                    </>
                  ) : (
                    <>
                      {/* Render markdown (excluding images) and images below */}
                      <View style={{ flexDirection: 'column', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                        <View style={{ width: '100%' }}>
                          <MarkdownRenderer
                            content={note.content.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')}
                          />
                        </View>
                      </View>
                      {/* Render images below markdown if any image links exist */}
                      {(() => {
                        const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
                        const matches = Array.from(note.content.matchAll(imageRegex));
                        if (matches.length > 0) {
                          return matches.map((m, idx) => (
                            <View key={`mdimg-${idx}-${m[1]}`} style={{ marginTop: 12, alignItems: 'center' }}>
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
                              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{m[1]}</Text>
                            </View>
                          ));
                        }
                        return null;
                      })()}
                    </>
                  )
                ) : (
                  <>
                    <View style={{ flexDirection: 'column', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      {(() => {
                        const contentStr = Array.isArray(note.content)
                          ? note.content.join('\n')
                          : typeof note.content === 'string'
                            ? note.content
                            : String(note.content);
                        const cleanStr = contentStr.replace(/\[Image: ([^\]]+)\]/g, '');
                        const linkRegex = /(https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}\b)/g;
                        const lines = cleanStr.split(/\r?\n/);
                        return lines.map((line, lineIdx) => {
                          let lastIndex = 0;
                          let match;
                          const lineParts = [];
                          while ((match = linkRegex.exec(line)) !== null) {
                            if (match.index > lastIndex) {
                              lineParts.push(line.substring(lastIndex, match.index));
                            }
                            const url = match[0];
                            const openUrl = /^https?:\/-\//.test(url) ? url : `https://${url}`;
                            lineParts.push(
                              <Text
                                key={`link-${lineIdx}-${match.index}`}
                                style={{
                                  color: theme.colors.primary,
                                  textDecorationLine: 'underline',
                                  fontSize: 16,
                                  lineHeight: 18,
                                  includeFontPadding: false,
                                }}
                                onPress={() => {
                                  Alert.alert(
                                    'Open Link',
                                    `Are you sure you want to open this link in your browser?\n${url}`,
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: 'Open',
                                        style: 'default',
                                        onPress: () => {
                                          try {
                                            require('react-native').Linking.openURL(openUrl);
                                          } catch {}
                                        }
                                      }
                                    ]
                                  );
                                }}
                              >
                                {url}
                              </Text>
                            );
                            lastIndex = match.index + url.length;
                          }
                          if (lastIndex < line.length) {
                            lineParts.push(line.substring(lastIndex));
                          }
                          return (
                            <Text
                              key={`line-${lineIdx}`}
                              style={{
                                fontSize: 16,
                                lineHeight: 18,
                                color: theme.colors.onSurface,
                                includeFontPadding: false,
                                textAlignVertical: 'center',
                                marginVertical: -2,
                              }}
                              selectable
                              selectionColor={theme.colors.primary}
                            >
                              {lineParts}
                            </Text>
                          );
                        });
                      })()}
                    </View>
                    {/* Render images below plain text if any image links exist */}
                    {(() => {
                      // Support both markdown images and [Image: ...] style
                      const contentStr = Array.isArray(note.content)
                        ? note.content.join('\n')
                        : typeof note.content === 'string'
                          ? note.content
                          : String(note.content);
                      // Markdown image: ![alt](url)
                      const mdImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
                      // Plain text: [Image: url]
                      const plainImageRegex = /\[Image: ([^\]]+)\]/g;
                      const mdMatches = Array.from(contentStr.matchAll(mdImageRegex));
                      const plainMatches = Array.from(contentStr.matchAll(plainImageRegex));
                      const allImages = [
                        ...mdMatches.map(m => m[1]),
                        ...plainMatches.map(m => m[1])
                      ];
                      if (allImages.length > 0) {
                        return allImages.map((img, idx) => (
                          <View key={idx} style={{ marginTop: idx === 0 ? 0 : 8, alignItems: 'center' }}>
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
                                borderColor: theme.dark ? '#444' : '#f5f5f5', // Follows mode
                              }}
                            >
                              {img && img.trim() ? (
                                <TouchableOpacity onPress={() => setZoomedImage(img.trim())} activeOpacity={0.85}>
                                  <Image
                                    source={{ uri: img.trim() }}
                                    style={{ width: 300, height: 300, resizeMode: 'contain', backgroundColor: theme.dark ? '#333' : '#ccc' }}
                                    defaultSource={Platform.OS === 'android' ? require('../../assets/icon.png') : undefined}
                                    onError={() => {}}
                                  />
                                </TouchableOpacity>
                              ) : (
                                <Text style={{ color: theme.colors.error }}>Invalid image URL</Text>
                              )}
                            </View>
                            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}>{img}</Text>
                          </View>
                        ));
                      }
                      return null;
                    })()}
                  </>
                )}
                {note.isMarkdown && (
                    null
                )}
              </View>
            </View>
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Floating Action Buttons */}
      <View style={[styles.fabContainer, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.fabRow}>
          {/* Copy button (always shown) */}
          <IconButton
            icon="content-copy"
            iconColor={theme.colors.primary}
            size={24}
            onPress={handleCopyAll}
            style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 16, marginRight: 2 }}
          />
          {/* Show Plain Text/Markdown toggle (only for markdown notes) */}
          {note.isMarkdown && (
            <IconButton
              icon={showRaw ? 'language-markdown' : 'file-document-outline'}
              iconColor={theme.colors.primary}
              size={24}
              onPress={() => setShowRaw((v) => !v)}
              style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 16, marginRight: 2 }}
              accessibilityLabel={showRaw ? 'Show Markdown' : 'Show Plain Text'}
            />
          )}
          {/* Edit button */}
          <IconButton
            icon="pencil"
            iconColor="#fff"
            size={24}
            onPress={() => {
              Alert.alert(
                showRaw ? 'Edit Plain Text' : 'Edit Markdown',
                `Are you sure you want to edit this note in ${showRaw ? 'plain text' : 'markdown'} mode?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Edit', style: 'default', onPress: handleEdit }
                ]
              );
            }}
            style={[styles.editButton, { backgroundColor: theme.colors.primary }]}
          />
          {/* Delete button */}
          <IconButton
            icon="delete"
            iconColor="#fff"
            size={24}
            onPress={handleDelete}
            style={[styles.deleteButton, { backgroundColor: theme.colors.error }]}
          />
          {/* Copy feedback */}
          {!!copyMsg && (
            <Text style={{ marginLeft: 4, color: theme.colors.primary, fontWeight: 'bold', alignSelf: 'center' }}>{copyMsg}</Text>
          )}
        </View>
      </View>
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
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // ...existing code...
  emptyLine: {
    height: 1,
    fontSize: 0.1,
    paddingVertical: 0,
    marginVertical: 0,
    color: 'transparent',
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