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
import { List, Text } from 'react-native-paper';
import Header from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

const GITHUB_URL = 'https://github.com/Lusan-sapkota/NoteSpark';
const DEVELOPER_EMAIL = 'sapkotalusan@gmail.com';
const WEBSITE = 'https://lusansapkota.com.np';
const getAppVersion = () => {
  if (Updates.manifest && (Updates.manifest as any).version) {
    return (Updates.manifest as any).version;
  }
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

  const external = <List.Icon icon="open-in-new" color={theme.colors.onSurfaceVariant} />;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      edges={['left', 'right', 'bottom']}
    >
      <Header
        title="About"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.column}>
          <View style={styles.identity}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.appIcon}
              accessibilityIgnoresInvertColors
              accessibilityLabel="NoteSpark logo"
            />
            <View style={styles.identityText}>
              <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>NoteSpark</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Version {appVersion}</Text>
            </View>
          </View>

          <Text variant="bodyLarge" style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
            A private notes app that works offline. No account, no cloud, no ads. Write in plain text or Markdown, and back up your notes as a JSON file whenever you like.
          </Text>

          <GroupedRow title="Developer" description="Lusan Sapkota" icon="account-outline" isFirst isLast={false} />
          <GroupedRow
            title="Email"
            description={DEVELOPER_EMAIL}
            icon="email-outline"
            right={external}
            onPress={() => openLink(`mailto:${DEVELOPER_EMAIL}`)}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title="Website"
            description="notespark.lusansapkota.com.np"
            icon="web"
            right={external}
            onPress={() => openLink(WEBSITE)}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title="Source code on GitHub"
            description="github.com/Lusan-sapkota/NoteSpark"
            icon="github"
            right={external}
            onPress={() => openLink(GITHUB_URL)}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title="Documentation"
            description="github.com/Lusan-sapkota/NoteSpark/wiki"
            icon="book-open-outline"
            right={external}
            onPress={() => openLink(`${GITHUB_URL}/wiki`)}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow title="License" description={LICENSE} icon="scale-balance" isFirst={false} isLast />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  // Round, matching the README logo and circle launcher masks.
  appIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  identityText: {
    flex: 1,
  },
  description: {
    marginTop: space.lg,
    marginBottom: space.xl,
  },
});

export default AboutScreen;
