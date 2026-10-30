import React, { useState } from 'react';
import { Dimensions, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, IconButton, Text } from 'react-native-paper';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';
import { t as translate } from '@notespark/core';
import { useCachedImage } from '../utils/imageCache';

// Image references in note content: Markdown `![alt](uri)` and, for plain notes, `[Image: uri]`.
export const extractImageUris = (content: string, includePlain = false) => {
  // The address ends at the first space, so an optional Markdown title (`![a](url "title")`) isn't part of it.
  const uris = Array.from(content.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g), m => m[1].trim());
  if (includePlain) uris.push(...Array.from(content.matchAll(/\[Image: ([^\]]+)\]/g), m => m[1].trim()));
  return uris.filter(Boolean);
};

const imageLabel = (uri: string) => {
  if (uri.startsWith('file:///')) return translate('note.imageOnDevice', { name: uri.split('/').pop() ?? '' });
  return uri.length > 40 ? `${uri.slice(0, 18)}…${uri.slice(-18)}` : uri;
};

const NoteImage: React.FC<{ uri: string; onOpen: (src: string) => void }> = ({ uri, onOpen }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const image = useCachedImage(uri);
  const box = [styles.image, styles.placeholder, { backgroundColor: theme.colors.surfaceContainer }];
  return (
    <View style={styles.item}>
      {image.status === 'loading' ? (
        <View style={box}>
          <ActivityIndicator accessibilityLabel={t('note.loadingImage')} />
        </View>
      ) : image.status === 'ready' && image.src ? (
        <Pressable onPress={() => onOpen(image.src!)} accessibilityRole="imagebutton" accessibilityLabel={t('note.openImageFull')}>
          <Image
            source={{ uri: image.src }}
            resizeMode="contain"
            onError={image.onError}
            style={[styles.image, { backgroundColor: theme.colors.surfaceContainer }]}
          />
        </Pressable>
      ) : (
        <View style={box}>
          <Icon source={image.status === 'gone' ? 'image-off-outline' : 'image-refresh-outline'} size={28} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodyMedium" style={[styles.placeholderText, { color: theme.colors.onSurfaceVariant }]}>
            {image.status === 'gone'
              ? t('note.imageGone')
              : t('note.imageFailed')}
          </Text>
          <Button mode="text" onPress={image.retry}>{t('common.tryAgain')}</Button>
        </View>
      )}
      <Text variant="bodySmall" numberOfLines={1} style={[styles.caption, { color: theme.colors.onSurfaceVariant }]}>
        {imageLabel(uri)}
      </Text>
    </View>
  );
};

const NoteImages: React.FC<{ uris: string[] }> = ({ uris }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState<string | null>(null);
  if (uris.length === 0) return null;
  const { width, height } = Dimensions.get('window');

  return (
    <View style={styles.list}>
      {uris.map((uri, i) => (
        <NoteImage key={`${i}-${uri}`} uri={uri} onOpen={setZoomed} />
      ))}
      <Modal visible={!!zoomed} animationType="fade" onRequestClose={() => setZoomed(null)}>
        <View style={[styles.viewer, { backgroundColor: theme.colors.background }]}>
          <ScrollView
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            {zoomed && (
              <Image source={{ uri: zoomed }} resizeMode="contain" style={{ width: width - space.xxl, height: height - 160 }} />
            )}
          </ScrollView>
          <IconButton
            icon="close"
            mode="contained-tonal"
            onPress={() => setZoomed(null)}
            accessibilityLabel={t('note.closeImage')}
            style={styles.close}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    gap: space.lg,
    marginTop: space.sm,
  },
  item: {
    gap: space.xs,
  },
  image: {
    width: '100%',
    height: 240,
    borderRadius: shape.small,
  },
  placeholder: {
    height: 'auto',
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    padding: space.lg,
  },
  placeholderText: {
    textAlign: 'center',
  },
  caption: {
    paddingHorizontal: space.xs,
  },
  viewer: {
    flex: 1,
  },
  viewerContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  close: {
    position: 'absolute',
    top: space.xxxl,
    right: space.lg,
  },
});

export default NoteImages;
