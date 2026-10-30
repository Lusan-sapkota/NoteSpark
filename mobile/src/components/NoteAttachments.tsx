import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { ActivityIndicator, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import {
  AttachmentLink,
  formatAttachmentSize,
  parseAttachmentLinks,
} from '@notespark/core';
import {
  clearAttachmentTempDir,
  getAttachmentMeta,
  openAttachmentInViewer,
  openAttachmentTemp,
} from '../storage/attachments';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';
import { useAlert } from './DialogProvider';
import { useI18n } from '../i18n/I18nContext';


interface NoteAttachmentsProps {
  content: string;
  onRemove?: (hash: string, occurrenceIndex: number) => void;
}

const iconForFile = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'file-pdf-box';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'file-document-outline';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'file-table-outline';
  if (['zip', 'tar', 'gz', '7z'].includes(ext)) return 'folder-zip-outline';
  return 'paperclip';
};

const NoteAttachments: React.FC<NoteAttachmentsProps> = ({ content, onRemove }) => {
  const { theme } = useTheme();
  const alert = useAlert();
  const { t } = useI18n();
  const links = parseAttachmentLinks(content);
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const [openingHash, setOpeningHash] = useState<string | null>(null);
  const cleanups = useRef<(() => Promise<void>)[]>([]);
  const openedRef = useRef(false);

  const refreshMeta = useCallback(async (items: AttachmentLink[]) => {
    if (items.length === 0) return;
    const uniqueHashes = [...new Set(items.map(l => l.hash))];
    const next: Record<string, number | null> = {};
    for (const hash of uniqueHashes) {
      const meta = await getAttachmentMeta(hash).catch(() => null);
      next[hash] = meta ? meta.size : null;
    }
    setSizes(next);
  }, []);

  useEffect(() => {
    refreshMeta(links);
  }, [content, refreshMeta]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && openedRef.current) {
        openedRef.current = false;
        clearAttachmentTempDir().catch(() => {});
        const list = cleanups.current.splice(0);
        for (const fn of list) fn().catch(() => {});
      }
    });
    return () => {
      sub.remove();
      const list = cleanups.current.splice(0);
      for (const fn of list) fn().catch(() => {});
    };
  }, []);

  if (links.length === 0) return null;

  const handleOpen = async (link: AttachmentLink) => {
    if (openingHash) return;
    const meta = await getAttachmentMeta(link.hash).catch(() => null);
    if (!meta) {
      setSizes(prev => ({ ...prev, [link.hash]: null }));
      alert(t('note.attachmentSyncingTitle'), t('note.attachmentSyncingMessage'));
      return;
    }
    setSizes(prev => ({ ...prev, [link.hash]: meta.size }));
    setOpeningHash(link.hash);
    try {
      try {
        openedRef.current = true;
        await openAttachmentInViewer(link.hash, link.name);
      } catch {
        const temp = await openAttachmentTemp(link.hash, link.name);
        cleanups.current.push(temp.cleanup);
        await Sharing.shareAsync(temp.uri, { dialogTitle: link.name });
      }
    } catch {
      alert(t('note.openFileFailedTitle'), t('note.openFileFailedMessage'));
    } finally {
      setOpeningHash(null);
    }
  };

  const seenByHash = new Map<string, number>();

  return (
    <View style={styles.list}>
      {links.map((link, idx) => {
        const occurrence = seenByHash.get(link.hash) ?? 0;
        seenByHash.set(link.hash, occurrence + 1);
        const size = sizes[link.hash];
        const isMissing = size === null;
        const isOpening = openingHash === link.hash;
        const subtitle = isMissing
          ? t('note.attachmentSyncingTitle')
          : typeof size === 'number'
            ? formatAttachmentSize(size)
            : '';

        return (
          <View
            key={`${link.hash}-${idx}`}
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surfaceContainer,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
          >
            <TouchableRipple
              onPress={() => handleOpen(link)}
              accessibilityRole="button"
              accessibilityLabel={subtitle ? t('note.openAttachmentSized', { name: link.name, detail: subtitle }) : t('note.openAttachment', { name: link.name })}
              borderless
              style={styles.mainAction}
            >
              <View style={styles.rowContent}>
                {isOpening || isMissing ? (
                  <View style={styles.iconBox}>
                    {isOpening ? (
                      <ActivityIndicator size={20} accessibilityLabel={t('note.openingAttachment')} />
                    ) : (
                      <Icon source="cloud-download-outline" size={22} color={theme.colors.onSurfaceVariant} />
                    )}
                  </View>
                ) : (
                  <View style={styles.iconBox}>
                    <Icon source={iconForFile(link.name)} size={22} color={theme.colors.primary} />
                  </View>
                )}
                <View style={styles.textColumn}>
                  <Text variant="bodyMedium" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
                    {link.name}
                  </Text>
                  {!!subtitle && (
                    <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>
                      {subtitle}
                    </Text>
                  )}
                </View>
              </View>
            </TouchableRipple>
            {onRemove && (
              <IconButton
                icon="close"
                size={20}
                onPress={() => onRemove(link.hash, occurrence)}
                accessibilityLabel={t('note.removeAttachment', { name: link.name })}
                style={styles.removeButton}
              />
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    gap: space.sm,
    marginTop: space.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: shape.small,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
    overflow: 'hidden',
  },
  mainAction: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  iconBox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  removeButton: {
    minWidth: 48,
    minHeight: 48,
    margin: 0,
  },
});

export default NoteAttachments;
