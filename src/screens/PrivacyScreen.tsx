import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';
import Header, { useHeaderElevation } from '../components/Header';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

const CONTACT_EMAIL = 'sapkotalusan@gmail.com';
const EFFECTIVE_DATE = 'October 24, 2026';

// Keep this in step with what the app actually does; update EFFECTIVE_DATE on every change.
const sections: { heading: string; intro?: string; bullets?: string[]; outro?: string }[] = [
  {
    heading: 'What NoteSpark stores',
    bullets: [
      'Your notes: the title, text, format and the dates they were created and edited. They are kept in a database on your device.',
      "Images you add to a note aren't copied or uploaded. The note keeps a link to the image file on your device.",
      "Your theme choice, whether you've finished the welcome screens, and a list of your last 20 imports and exports. These are also kept on your device.",
    ],
    outro: 'None of this is sent to the developer or anyone else.',
  },
  {
    heading: 'What leaves your device',
    bullets: [
      "App updates: when you open NoteSpark, it checks Expo's update service (expo.dev) for a newer version and downloads it if there is one. The request includes technical details such as the app version, your device platform and an anonymous identifier for this installation. It never includes your notes. Expo's privacy policy is at expo.dev/privacy.",
      "Exports: when you export your notes, the file goes only where you choose in the share sheet, such as a file manager, a cloud drive or another app. That service's privacy policy then applies.",
      'Links: links you open from a note or from this app open in your browser.',
    ],
  },
  {
    heading: 'Permissions',
    bullets: [
      "Notifications: to tell you things like an export finishing. These notifications are created on your device; NoteSpark doesn't use push notifications.",
      'Photos: only the images you pick when adding an image to a note.',
      'Files: only the backup file you pick when importing notes.',
      'Internet: only for app updates and the links you open.',
    ],
  },
  {
    heading: 'Your control over your data',
    bullets: [
      'Delete a note from its menu, or delete every note in Settings, under Delete all notes.',
      'Export a copy of your notes at any time in Settings, under Import and export.',
      "Uninstalling NoteSpark deletes all of its data from your device. The developer has no copy, so deleted notes can't be recovered unless you exported them.",
    ],
  },
  {
    heading: 'Children',
    intro: "NoteSpark doesn't collect personal information from anyone, including children under 13.",
  },
  {
    heading: 'Changes to this policy',
    intro: 'If this policy changes, the new version will appear here and on notespark.lusansapkota.com.np with a new effective date.',
  },
];

const PrivacyScreen: React.FC = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const body = { color: theme.colors.onSurfaceVariant };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title="Privacy policy" showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          <Text variant="bodySmall" style={body}>Effective {EFFECTIVE_DATE}</Text>
          <Text variant="bodyLarge" style={[styles.lead, { color: theme.colors.onSurface }]}>
            NoteSpark is a notes app that works offline. It has no account, no ads and no analytics. This policy explains what the app stores, where it's kept, and what leaves your device.
          </Text>

          {sections.map(section => (
            <View key={section.heading} style={styles.section}>
              <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>
                {section.heading}
              </Text>
              {!!section.intro && <Text variant="bodyLarge" style={body}>{section.intro}</Text>}
              {section.bullets?.map(item => (
                <View key={item} style={styles.bullet}>
                  <Text variant="bodyLarge" style={body} accessibilityElementsHidden importantForAccessibility="no">•</Text>
                  <Text variant="bodyLarge" style={[body, styles.bulletText]}>{item}</Text>
                </View>
              ))}
              {!!section.outro && <Text variant="bodyLarge" style={body}>{section.outro}</Text>}
            </View>
          ))}

          <View style={styles.section}>
            <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>Contact</Text>
            <Text variant="bodyLarge" style={body}>
              Questions about privacy:{' '}
              <Text
                style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`).catch(() => {})}
                accessibilityRole="link"
              >
                {CONTACT_EMAIL}
              </Text>
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
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
  lead: {
    marginTop: space.md,
  },
  section: {
    marginTop: space.xl,
    gap: space.sm,
  },
  bullet: {
    flexDirection: 'row',
    gap: space.sm,
  },
  bulletText: {
    flex: 1,
  },
});

export default PrivacyScreen;
