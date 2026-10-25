import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';
import Header, { useHeaderElevation } from '../components/Header';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

const CONTACT_EMAIL = 'contact@lusansapkota.com.np';
const EFFECTIVE_DATE = 'October 25, 2026';

// Keep this in step with what the app actually does; update EFFECTIVE_DATE on every change.
const sections: { heading: string; intro?: string; bullets?: string[]; outro?: string }[] = [
  {
    heading: 'What NoteSpark stores',
    bullets: [
      'Your notes: the title, text, format, whether they are pinned, and the dates they were created and edited. They are kept in a database on your device, one for each profile.',
      'A search index: for search by meaning, each note is turned into a list of numbers by a small model that is part of the app and runs on your device. The index is kept in the same database as your notes.',
      "Images you add to a note aren't copied or uploaded. The note keeps a link to the image file on your device.",
      "Your profile names, which profile is open, your theme choice, whether you've finished the welcome screens, and a list of your last 20 imports and exports. These are also kept on your device.",
    ],
    outro: 'None of this is sent to the developer or anyone else.',
  },
  {
    heading: 'Nothing leaves your device',
    intro: "NoteSpark makes no network requests of its own: no sync, no analytics, no crash reporting and no update checks. App updates come only through the store you installed it from.",
    bullets: [
      "If you add an image from a web address to a note, it's downloaded from that website the first time you view the note, then kept on your phone so it shows offline, even if the website removes it. A saved copy is deleted once no note uses it and it hasn't been viewed for 30 days.",
      'When you export or share notes, the file goes only where you choose in the share sheet.',
    ],
  },
  {
    heading: 'Permissions',
    bullets: [
      "Notifications: to tell you things like an export finishing. These notifications are created on your device; NoteSpark doesn't use push notifications.",
      'Photos: only the images you pick when adding an image to a note.',
      'Files: only the backup file you pick when importing notes.',
      'Internet: only to show images from web addresses that you add to notes.',
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
            NoteSpark is an offline notes app. It has no account, no ads, no analytics and no tracking. Everything you write stays on your phone. This policy explains what the app stores and where.
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
