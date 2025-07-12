import React, { memo, useMemo, useCallback, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { Card, Text, IconButton, Chip, Surface } from 'react-native-paper';
import { Note } from '../types';
import { useTheme } from '../theme/ThemeContext';

interface NoteItemProps {
  note: Note;
  onPress: (noteId: number) => void;
  onDelete: (noteId: number) => void;
  onEdit?: (noteId: number) => void;
  showPreview?: boolean;
  isSelected?: boolean;
  showActions?: boolean;
  compact?: boolean;
  isPinned?: boolean;
  onPinToggle?: (noteId: number) => void;
}

const { width: screenWidth } = Dimensions.get('window');

const NoteItem: React.FC<NoteItemProps> = memo(({ 
  note, 
  onPress, 
  onDelete, 
  onEdit, 
  showPreview = true, 
  isSelected = false,
  showActions = true,
  compact = false,
  isPinned = false,
  onPinToggle
}) => {
  const { theme } = useTheme();
  const [pressAnim] = useState(new Animated.Value(1));
  const [showFullContent, setShowFullContent] = useState(false);

  // Full date/time formatting for created and edited dates
  const formatFullDate = (dateStr?: string) => {
    if (!dateStr) return 'No date';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'No date';
    return date.toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const createdDate = useMemo(() => formatFullDate(note.createdAt), [note.createdAt]);
  const editedDate = useMemo(() => formatFullDate(note.updatedAt), [note.updatedAt]);

  // Content preview with smart truncation
  const previewContent = useMemo(() => {
    if (!showPreview) return note.content;
    
    const maxLength = compact ? 80 : 120;
    if (note.content.length <= maxLength) return note.content;
    
    // Find the last complete word within the limit
    const truncated = note.content.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
  }, [note.content, showPreview, compact]);

  // Word count calculation
  const wordCount = useMemo(() => {
    return note.content.trim().split(/\s+/).filter(word => word.length > 0).length;
  }, [note.content]);

  // Animated press handlers
  const handlePressIn = useCallback(() => {
    Animated.spring(pressAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      tension: 300,
      friction: 50,
    }).start();
  }, [pressAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(pressAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 50,
    }).start();
  }, [pressAnim]);

  const handlePress = useCallback(() => {
    onPress(note.id);
  }, [note.id, onPress]);

  const handleEdit = useCallback(() => {
    onEdit?.(note.id);
  }, [note.id, onEdit]);

  const handleDelete = useCallback(() => {
    onDelete(note.id);
  }, [note.id, onDelete]);

  const toggleContent = useCallback(() => {
    setShowFullContent(!showFullContent);
  }, [showFullContent]);

  const dynamicStyles = useMemo(() => ({
    card: {
      backgroundColor: isSelected ? theme.colors.primaryContainer : theme.colors.surface,
      borderColor: isSelected ? theme.colors.primary : 'transparent',
      borderWidth: isSelected ? 2 : 0,
    },
    title: {
      color: theme.colors.onSurface,
    },
    previewText: {
      color: theme.colors.onSurfaceVariant,
    },
  }), [theme, isSelected]);

  return (
    <Animated.View 
      style={[
        { transform: [{ scale: pressAnim }] },
        styles.container
      ]}
    >
      <TouchableOpacity 
        activeOpacity={0.9}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.touchable}
      >
        <Card 
          style={[
            styles.card, 
            dynamicStyles.card,
            compact && styles.compactCard
          ]}
          elevation={isSelected ? 4 : 2}
        > 
          <Card.Content style={[styles.content, compact && styles.compactContent]}>
            {/* Header Section */}
            <View style={styles.header}>
              <View style={styles.titleContainer}>
                <Text 
                  style={[
                    styles.title,
                    { color: theme.colors.primary },
                    compact && { fontSize: 16, marginBottom: 2 }
                  ]}
                  numberOfLines={compact ? 1 : 2}
                >
                  {note.title || 'Untitled Note'}
                </Text>
                <View style={styles.metaRow}>
                    <Chip
                    mode="outlined"
                    style={[
                      styles.typeChip,
                      {
                      backgroundColor: note.isMarkdown ? theme.colors.accent + '22' : theme.colors.secondary + '22',
                      borderColor: note.isMarkdown ? theme.colors.accent : theme.colors.secondary,
                      paddingHorizontal: 6,
                      paddingVertical: 0,
                      minHeight: 20,
                      alignSelf: 'flex-start',
                      },
                    ]}
                    textStyle={[
                      styles.chipText,
                      {
                      color: note.isMarkdown
                        ? theme.dark
                        ? theme.colors.accent
                        : '#2B2B2B' // darker text for light mode
                        : theme.dark
                        ? theme.colors.secondary
                        : '#2B2B2B',
                      fontWeight: 'bold',
                      fontSize: compact ? 10 : 12,
                      lineHeight: compact ? 12 : 14,
                      textAlign: 'center',
                      includeFontPadding: false,
                      textAlignVertical: 'center',
                      marginBottom: compact ? 0 : 2,
                      marginTop: compact ? 0 : 2,
                      textShadowColor: theme.dark ? undefined : '#FFF',
                      textShadowOffset: theme.dark ? undefined : { width: 0, height: 1 },
                      textShadowRadius: theme.dark ? undefined : 1,
                      letterSpacing: 0.3,
                      },
                    ]}
                    compact
                    >
                    {note.isMarkdown ? 'Markdown' : 'Text'}
                    </Chip>

                  <Text style={[styles.date, { color: theme.colors.text, fontWeight: '500', marginLeft: 8 }]}> 
                    Created: {createdDate}
                  </Text>
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: theme.colors.outline }]} />
            </View>

            {/* Content Preview */}
            {showPreview && (
              <View
                style={[
                  styles.previewContainer,
                  {
                    backgroundColor: `${theme.colors.primary}33`, // 20% opacity
                    padding: 14,
                    borderRadius: 12,
                    justifyContent: 'center',
                    alignItems: 'center',
                  },
                ]}
              >
                <Text
                  style={{
                    color: theme.colors.primary,
                    fontWeight: 'bold',
                    fontSize: 18,
                    textAlign: 'center',
                  }}
                >
                  Tap to view content
                </Text>
              </View>
            )}

            {/* Actions Footer */}
            {showActions && (
              <View
                style={[
                  styles.actions,
                  {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  },
                ]}
              >
                {/* Edited date on the left */}
                <Text style={[styles.date, { color: theme.colors.text, fontWeight: '500' }]}> 
                  Edited: {editedDate && editedDate !== 'No date' ? editedDate : 'none'}
                </Text>

                {/* Action buttons on the right */}
                <View style={[styles.actionButtons, { flexDirection: 'row', alignItems: 'center' }]}> 
                  {/* Pin/unpin button */}
                  {onPinToggle && (
                    <IconButton
                      icon={isPinned ? 'pin' : 'pin-outline'}
                      iconColor={isPinned ? theme.colors.primary : theme.colors.outline}
                      size={20}
                      onPress={() => onPinToggle(note.id)}
                      style={styles.actionButton}
                    />
                  )}
                  {onEdit && (
                    <IconButton
                      icon="pencil-outline"
                      iconColor={theme.colors.primary}
                      size={20}
                      onPress={handleEdit}
                      style={styles.actionButton}
                    />
                  )}
                  <IconButton
                    icon="delete-outline"
                    iconColor={theme.colors.error}
                    size={20}
                    onPress={handleDelete}
                    style={styles.actionButton}
                  />
                  <IconButton
                    icon="eye-outline"
                    iconColor={theme.colors.outline}
                    size={18}
                    onPress={handlePress}
                    style={styles.actionButton}
                  />
                </View>
              </View>
            )}
          </Card.Content>
        </Card>
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginVertical: 6,
  },
  touchable: {
    borderRadius: 16,
  },
  card: {
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  compactCard: {
    marginVertical: 2,
  },
  content: {
    padding: 16,
  },
  compactContent: {
    padding: 12,
  },
  header: {
    marginBottom: 12,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
    lineHeight: 26,
    letterSpacing: 0.1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  date: {
    fontSize: 13,
    opacity: 0.8,
    fontWeight: '500',
    marginRight: 8,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
  },
  typeChip: {
    height: 24,
  },
  wordChip: {
    height: 24,
  },
  chipText: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.2,
  },
  previewContainer: {
    marginBottom: 8,
  },
  markdownPreview: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    maxHeight: 100,
    overflow: 'hidden',
  },
  markdownContent: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  expandButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  expandText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: -8,
  },
  actionButton: {
    margin: 0,
  },
  divider: {
    height: 2,
    borderRadius: 2,
    marginTop: 4,
    marginBottom: 8,
    opacity: 0.12,
  },
});

NoteItem.displayName = 'NoteItem';

export default NoteItem;