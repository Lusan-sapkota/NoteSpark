import React from 'react';
import {
  View,
  StyleSheet,
  Linking,
  ScrollView,
  Image,
  SafeAreaView,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Card, Text, Divider } from 'react-native-paper';

const GITHUB_URL = 'https://github.com/Lusan-sapkota/NoteSpark';
const DEVELOPER_EMAIL = 'sapkotalusan@gmail.com';
const WEBSITE = 'https://lusansapkota.com.np';
const APP_VERSION = '1.0.0';
const LICENSE = 'GPLv3';

const AboutScreen = () => {
  const { theme } = useTheme();

  const openLink = (url: string) => {
    Linking.openURL(url).catch((err) =>
      console.error('Failed to open URL:', err)
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.iconContainer}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.appIcon}
            resizeMode="contain"
          />
        </View>

        <Text style={[styles.header, { color: theme.colors.primary }]}>
          About NoteSpark
        </Text>

        <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
          NoteSpark is a modern offline-first note-taking app with support for Markdown, database
          export/import, and full SQLite-based storage. Crafted for simplicity and power, it helps
          you capture and manage thoughts without relying on cloud storage.
        </Text>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="contained">
          <Card.Content style={styles.cardContent}>
            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              Developer
            </Text>
            <Text style={[styles.value, { color: theme.colors.onSurface }]}>Lusan Sapkota</Text>

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Contact</Text>
            <Text
              style={[styles.link, { color: theme.colors.primary }]}
              onPress={() => openLink(`mailto:${DEVELOPER_EMAIL}`)}
            >
              {DEVELOPER_EMAIL}
            </Text>

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Website</Text>
            <Text
              style={[styles.link, { color: theme.colors.primary }]}
              onPress={() => openLink(WEBSITE)}
            >
              lusansapkota.com.np
            </Text>

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Version</Text>
            <Text style={[styles.value, { color: theme.colors.onSurface }]}>{APP_VERSION}</Text>

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>License</Text>
            <Text style={[styles.value, { color: theme.colors.onSurface }]}>{LICENSE}</Text>

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>GitHub</Text>
            <Text
              style={[styles.link, { color: theme.colors.primary }]}
              onPress={() => openLink(GITHUB_URL)}
            >
              github.com/Lusan-sapkota/NoteSpark
            </Text>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  appIcon: {
    width: 96,
    height: 96,
    borderRadius: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
    textAlign: 'center',
  },
  card: {
    borderRadius: 16,
    elevation: 4,
  },
  cardContent: {
    paddingVertical: 8,
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.8,
  },
  value: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 6,
  },
  link: {
    fontSize: 16,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  divider: {
    marginVertical: 8,
    height: 1,
  },
});

export default AboutScreen;
