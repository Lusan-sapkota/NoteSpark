import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, IconButton } from 'react-native-paper';
import { Note } from '../types';
import { useTheme } from '../theme/ThemeContext';

interface NoteItemProps {
  note: Note;
  onPress: (noteId: number) => void;
  onDelete: (noteId: number) => void;
}

const NoteItem: React.FC<NoteItemProps> = ({ note, onPress, onDelete }) => {
  const { theme, isDarkMode } = useTheme();
  
  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Card 
      style={[styles.card, { backgroundColor: theme.colors.surface }]} 
      onPress={() => onPress(note.id)}
    >
      <Card.Content style={styles.content}>
        <View style={styles.textContainer}>
          <Text variant="titleMedium" style={{ color: theme.colors.primary }}>
            {note.title}
          </Text>
          <Text variant="bodyMedium" numberOfLines={2} style={{ color: theme.colors.text }}>
            {note.content}
          </Text>
          <View style={styles.footer}>
            <Text variant="bodySmall" style={{ color: theme.colors.text }}>
              {formatDate(note.updatedAt)}
            </Text>
            {note.isMarkdown && (
              <Text variant="bodySmall" style={{ color: theme.colors.accent }}>
                Markdown
              </Text>
            )}
          </View>
        </View>
        <IconButton
          icon="delete"
          iconColor={theme.colors.error}
          size={20}
          onPress={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
        />
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginVertical: 4,
    marginHorizontal: 8,
    elevation: 2,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
});

export default NoteItem; 