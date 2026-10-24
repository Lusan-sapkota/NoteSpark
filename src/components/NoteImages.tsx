import React, { useState } from 'react';
import { Dimensions, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';
import { useCachedImage } from '../utils/imageCache';

// Image references in note content: Markdown `![alt](uri)` and, for plain notes, `[Image: uri]`.
export const extractImageUris = (content: string, includePlain = false) => {
  const uris = Array.from(content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g), m => m[1].trim());
  if (includePlain) uris.push(...Array.from(content.matchAll(/\[Image: ([^\]]+)\]/g), m => m[1].trim()));
  return uris.filter(Boolean);
};

const imageLabel = (uri: string) => {
  if (uri.startsWith('file:///')) return `Image on this device (${uri.split('/').pop()})`;
  return uri.length > 40 ? `${uri.slice(0, 18)}…${uri.slice(-18)}` : uri;
};

const NoteImage: React.FC<{ uri: string; onOpen: (src: string) => void }> = ({ uri, onOpen }) => {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);
  const src = useCachedImage(uri);
  return (
    <View style={styles.item}>
      {failed ? (
        <View style={[styles.image, styles.failed, { backgroundColor: theme.colors.surfaceContainer }]}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Couldn't load this image</Text>
        </View>
      ) : !src ? (
        <View style={[styles.image, styles.failed, { backgroundColor: theme.colors.surfaceContainer }]}>
          <ActivityIndicator accessibilityLabel="Loading image" />
        </View>
      ) : (
        <Pressable onPress={() => onOpen(src)} accessibilityRole="imagebutton" accessibilityLabel="Open image full screen">
          <Image
            source={{ uri: src }}
            resizeMode="contain"
            onError={() => setFailed(true)}
            style={[styles.image, { backgroundColor: theme.colors.surfaceContainer }]}
          />
        </Pressable>
      )}
      <Text variant="bodySmall" numberOfLines={1} style={[styles.caption, { color: theme.colors.onSurfaceVariant }]}>
        {imageLabel(uri)}
      </Text>
    </View>
  );
};

const NoteImages: React.FC<{ uris: string[] }> = ({ uris }) => {
  const { theme } = useTheme();
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
            accessibilityLabel="Close image"
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
  failed: {
    height: 96,
    justifyContent: 'center',
    alignItems: 'center',
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
