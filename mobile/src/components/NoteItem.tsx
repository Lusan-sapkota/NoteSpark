import React, { memo, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import Swipeable, { SwipeableMethods, SwipeDirection } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Menu from './Menu';
import { getLanguage, markTaskBoxes, t as translate } from '@notespark/core';
import { Note } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { groupCorners, shape, space } from '../theme/theme';

interface NoteItemProps {
  note: Note;
  onPress: (noteId: number) => void;
  onDelete: (noteId: number) => void;
  onEdit: (noteId: number) => void;
  isPinned: boolean;
  onPinToggle: (noteId: number) => void;
  onArchiveToggle: (noteId: number) => void;
  onTransfer?: (noteId: number) => void;
  // Selecting: long-press starts it; while it's on, a tap selects instead of opening.
  onSelect: (noteId: number) => void;
  selecting?: boolean;
  selected?: boolean;
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
    .replace(/\[\[([^[\]\n]+)\]\]/g, '$1')
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const relativeDate = (dateStr: string) => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return translate('home.justNow');
  if (minutes < 60) return translate('home.minutesAgo', { count: minutes });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(getLanguage(), { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return translate('home.yesterday');
  return date.toLocaleDateString(getLanguage(), {
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
  onArchiveToggle,
  onTransfer,
  onSelect,
  selecting = false,
  selected = false,
  isFirst,
  isLast,
  showCreated = false,
}) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [menuVisible, setMenuVisible] = useState(false);
  const swipe = useRef<SwipeableMethods>(null);
  const preview = useMemo(() => toPreview(note.content), [note.content]);
  const title = note.title || t('common.untitledNote');
  const date = relativeDate(showCreated ? note.createdAt : note.updatedAt);
  const onColor = selected ? theme.colors.onSecondaryContainer : isPinned ? theme.colors.onPrimaryContainer : theme.colors.onSurface;
  const onColorVariant = selected ? theme.colors.onSecondaryContainer : isPinned ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant;
  const background = selected ? theme.colors.secondaryContainer : isPinned ? theme.colors.primaryContainer : theme.colors.surfaceContainerLow;

  // Swipe right to archive (no question, Home offers Undo); swipe left to move to bin (Home asks first, so the row snaps back).
  const swipeAction = (icon: string, label: string, color: string, onColor: string, align: 'flex-start' | 'flex-end') => (
    <View style={[styles.swipeAction, { backgroundColor: color, alignItems: align }]}>
      <Icon source={icon} size={24} color={onColor} />
      <Text variant="labelMedium" maxFontSizeMultiplier={1.5} style={{ color: onColor }}>{label}</Text>
    </View>
  );
  const onSwipeOpen = (direction: SwipeDirection.LEFT | SwipeDirection.RIGHT) => {
    swipe.current?.close();
    if (direction === SwipeDirection.LEFT) onArchiveToggle(note.id);
    else onDelete(note.id);
  };

  const body = (
    <View style={{ backgroundColor: background }}>
      <TouchableRipple
        onPress={() => (selecting ? onSelect(note.id) : onPress(note.id))}
        onLongPress={() => onSelect(note.id)}
        accessibilityRole={selecting ? 'checkbox' : 'button'}
        accessibilityState={selecting ? { checked: selected } : undefined}
        accessibilityLabel={isPinned ? t('home.pinnedTitle', { title }) : title}
        accessibilityHint={selecting ? undefined : t('home.longPressSelect')}
        style={styles.row}
      >
        <View>
          {isPinned && isFirst && (
            <View style={styles.pinnedLabel}>
              <Icon source="pin" size={14} color={onColorVariant} />
              <Text variant="labelMedium" style={{ color: onColorVariant }}>{t('home.pinned')}</Text>
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
              {showCreated ? t('home.created', { date }) : t('home.edited', { date })}
            </Text>
            {selecting ? (
              // A check, not just the color, shows what's selected. The row itself is the touch target.
              <View style={styles.action}>
                <Icon source={selected ? 'check-circle' : 'checkbox-blank-circle-outline'} size={24} color={onColorVariant} />
              </View>
            ) : (
              <>
                <IconButton
                  icon={isPinned ? 'pin' : 'pin-outline'}
                  iconColor={onColorVariant}
                  size={20}
                  onPress={() => onPinToggle(note.id)}
                  accessibilityLabel={isPinned ? t('home.unpinNote', { title }) : t('home.pinNote', { title })}
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
                      accessibilityLabel={t('home.moreOptionsFor', { title })}
                      style={styles.action}
                    />
                  }
                >
                  <Menu.Item
                    leadingIcon="pencil-outline"
                    title={t('home.editNote')}
                    onPress={() => { setMenuVisible(false); onEdit(note.id); }}
                  />
                  <Menu.Item
                    leadingIcon={note.isArchived ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline'}
                    title={note.isArchived ? t('home.unarchive') : t('home.archive')}
                    onPress={() => { setMenuVisible(false); onArchiveToggle(note.id); }}
                  />
                  {onTransfer && (
                    <Menu.Item
                      leadingIcon="account-arrow-right-outline"
                      title={t('home.moveToProfile')}
                      onPress={() => { setMenuVisible(false); onTransfer(note.id); }}
                    />
                  )}
                  <Menu.Item
                    leadingIcon="delete-outline"
                    title={t('home.moveToBin')}
                    titleStyle={{ color: theme.colors.error }}
                    onPress={() => { setMenuVisible(false); onDelete(note.id); }}
                  />
                </Menu>
              </>
            )}
          </View>
        </View>
      </TouchableRipple>
    </View>
  );

  const containerStyle = [styles.container, groupCorners(isFirst, isLast), isLast ? styles.groupGap : styles.gap];
  if (selecting) return <View style={containerStyle}>{body}</View>;
  return (
    <Swipeable
      ref={swipe}
      containerStyle={containerStyle}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableOpen={onSwipeOpen}
      renderLeftActions={() =>
        swipeAction(note.isArchived ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline', note.isArchived ? t('home.unarchive') : t('home.archive'), theme.colors.secondaryContainer, theme.colors.onSecondaryContainer, 'flex-start')
      }
      renderRightActions={() =>
        swipeAction('delete-outline', t('home.moveToBin'), theme.colors.errorContainer, theme.colors.onErrorContainer, 'flex-end')
      }
    >
      {body}
    </Swipeable>
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
  swipeAction: {
    flex: 1,
    minWidth: 112,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
});

NoteItem.displayName = 'NoteItem';

export default NoteItem;
