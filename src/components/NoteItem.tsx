import React, { memo, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import Menu from './Menu';
import { markTaskBoxes } from '../utils/tasks';
import { Note } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { groupCorners, shape, space } from '../theme/theme';

interface NoteItemProps {
  note: Note;
  onPress: (noteId: number) => void;
  onDelete: (noteId: number) => void;
  onEdit: (noteId: number) => void;
  isPinned: boolean;
  onPinToggle: (noteId: number) => void;
  isFirst: boolean;
  isLast: boolean;
  showCreated?: boolean;
}

// Plain-text preview: drop images, keep link text, strip Markdown markers, show task boxes as ☐ / ☑.
export const toPreview = (content: string) =>
  markTaskBoxes(content)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[Image: [^\]]+\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const relativeDate = (dateStr: string) => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
};

const NoteItem: React.FC<NoteItemProps> = memo(({
  note,
  onPress,
  onDelete,
  onEdit,
  isPinned,
  onPinToggle,
  isFirst,
  isLast,
  showCreated = false,
}) => {
  const { theme } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const preview = useMemo(() => toPreview(note.content), [note.content]);
  const title = note.title || 'Untitled note';
  const date = relativeDate(showCreated ? note.createdAt : note.updatedAt);
  const onColor = isPinned ? theme.colors.onPrimaryContainer : theme.colors.onSurface;
  const onColorVariant = isPinned ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant;

  return (
    <View
      style={[
        styles.container,
        groupCorners(isFirst, isLast),
        { backgroundColor: isPinned ? theme.colors.primaryContainer : theme.colors.surfaceContainerLow },
        isLast ? styles.groupGap : styles.gap,
      ]}
    >
      <TouchableRipple
        onPress={() => onPress(note.id)}
        accessibilityRole="button"
        accessibilityLabel={isPinned ? `${title}, pinned` : title}
        style={styles.row}
      >
        <View>
          {isPinned && isFirst && (
            <View style={styles.pinnedLabel}>
              <Icon source="pin" size={14} color={onColorVariant} />
              <Text variant="labelMedium" style={{ color: onColorVariant }}>Pinned</Text>
            </View>
          )}
          <Text variant="titleMedium" numberOfLines={2} style={{ color: onColor }}>{title}</Text>
          {!!preview && (
            <Text variant="bodyMedium" numberOfLines={2} style={[styles.preview, { color: onColorVariant }]}>
              {preview}
            </Text>
          )}
          <View style={styles.meta}>
            {note.isMarkdown && (
              <View style={[styles.label, { backgroundColor: theme.colors.tertiaryContainer }]}>
                <Text variant="labelSmall" maxFontSizeMultiplier={1.5} style={{ color: theme.colors.onTertiaryContainer }}>
                  Markdown
                </Text>
              </View>
            )}
            <Text variant="bodySmall" style={[styles.date, { color: onColorVariant }]}>
              {showCreated ? 'Created' : 'Edited'} {date}
            </Text>
            <IconButton
              icon={isPinned ? 'pin' : 'pin-outline'}
              iconColor={onColorVariant}
              size={20}
              onPress={() => onPinToggle(note.id)}
              accessibilityLabel={isPinned ? `Unpin ${title}` : `Pin ${title}`}
              style={styles.action}
            />
            <Menu
              visible={menuVisible}
              onDismiss={() => setMenuVisible(false)}
              anchor={
                <IconButton
                  icon="dots-vertical"
                  iconColor={onColorVariant}
                  size={20}
                  onPress={() => setMenuVisible(true)}
                  accessibilityLabel={`More options for ${title}`}
                  style={styles.action}
                />
              }
            >
              <Menu.Item
                leadingIcon="pencil-outline"
                title="Edit note"
                onPress={() => { setMenuVisible(false); onEdit(note.id); }}
              />
              <Menu.Item
                leadingIcon="delete-outline"
                title="Delete note"
                titleStyle={{ color: theme.colors.error }}
                onPress={() => { setMenuVisible(false); onDelete(note.id); }}
              />
            </Menu>
          </View>
        </View>
      </TouchableRipple>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: space.lg,
    overflow: 'hidden',
  },
  gap: {
    marginBottom: 2,
  },
  groupGap: {
    marginBottom: space.lg,
  },
  row: {
    paddingTop: space.md,
    paddingLeft: space.lg,
    paddingRight: space.xs,
  },
  pinnedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.xs,
  },
  preview: {
    marginTop: 2,
    paddingRight: space.md,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  label: {
    borderRadius: shape.small,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    marginRight: space.sm,
  },
  date: {
    flex: 1,
  },
  action: {
    margin: 0,
    width: 48,
    height: 48,
  },
});

NoteItem.displayName = 'NoteItem';

export default NoteItem;
