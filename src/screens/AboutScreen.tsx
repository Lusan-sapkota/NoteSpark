import React from 'react';
import {
  View,
  StyleSheet,
  Linking,
  ScrollView,
  Image,
} from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Text, Divider } from 'react-native-paper';
import Header from '../components/Header';
import { useTheme } from '../theme/ThemeContext';

const GITHUB_URL = 'https://github.com/Lusan-sapkota/NoteSpark';
const DEVELOPER_EMAIL = 'sapkotalusan@gmail.com';
const WEBSITE = 'https://lusansapkota.com.np';
const getAppVersion = () => {
  // EAS Update manifest
  if (Updates.manifest && (Updates.manifest as any).version) {
    return (Updates.manifest as any).version;
  }
  // Fallback to expo config
  if (Constants.expoConfig && Constants.expoConfig.version) {
    return Constants.expoConfig.version;
  }
  return 'Unknown';
};
const LICENSE = 'GPLv3';

const AboutScreen = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const appVersion = getAppVersion();

  const openLink = (url: string) => {
    Linking.openURL(url).catch((err) =>
      console.error('Failed to open URL:', err)
    );
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <Header
        title="About NoteSpark"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

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
          NoteSpark is a modern, offline-first note-taking app designed for speed and privacy. 
          Enjoy Markdown support, seamless JSON export/import, and robust local storage powered by SQLite. 
          Capture, organize, and manage your notes effortlessly—no cloud required.
        </Text>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="contained">
          <Card.Content style={styles.cardContent}>
            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Developer</Text>
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
            <Text style={[styles.value, { color: theme.colors.onSurface }]}>{appVersion}</Text>

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

            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Read Docs</Text>
            <Text
              style={[styles.link, { color: theme.colors.primary }]}
              onPress={() => openLink(`${GITHUB_URL}/wiki`)}
            >
              github.com/Lusan-sapkota/NoteSpark/wiki
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
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
