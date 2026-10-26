// The desktop privacy policy; keep it in step with the app and update EFFECTIVE_DATE on every change.
import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';
import Header, { useHeaderElevation } from '../../../../../../Mobile/src/components/Header';
import { useTheme } from '../../../../../../Mobile/src/theme/ThemeContext';
import { readingWidth, space } from '../../../../../../Mobile/src/theme/theme';

const CONTACT_EMAIL = 'contact@lusansapkota.com.np';
const EFFECTIVE_DATE = 'October 26, 2026';

const sections: { heading: string; intro?: string; bullets?: string[]; outro?: string }[] = [
  {
    heading: 'What NoteSpark stores',
    bullets: [
      "Your notes: the title, text, format, whether they are pinned or archived, and the dates they were created and edited, and your scratchpad. They are kept in a database in NoteSpark's folder on this computer, one for each profile. On Linux the folder is ~/.config/NoteSpark.",
      "Pictures you add to a note are copied into NoteSpark's own folder on this computer. They aren't uploaded. They stay there until you delete the folder.",
      "Your profile names, which profile is open, your theme choice, whether you've finished the welcome screens, backup settings, and a list of your last 20 imports and exports. These are kept in the same folder.",
      "Profile PINs: only a scrambled form of each PIN (a salted hash) is kept. The PIN itself isn't stored, so it can't be recovered if you forget it. A profile with a PIN also has its notes encrypted, with a key that your system's keyring (such as KWallet or GNOME Keyring) keeps for NoteSpark. If no keyring is available, NoteSpark won't create a protected profile.",
      'A deleted profile stays on this computer for 30 days so you can restore it, then it and its notes are erased.',
    ],
    outro: 'None of this is sent to the developer or anyone else.',
  },
  {
    heading: 'Nothing leaves your computer by itself',
    intro: 'NoteSpark makes no network requests of its own: no sync, no analytics, no crash reporting, no update checks and no remote fonts or images. New versions come only as a new installer that you download yourself.',
    bullets: [
      "Pictures that point at a web address are not loaded, so no website learns that you opened a note.",
      'When you export notes, or save a backup or a PDF, the file goes only where you choose.',
      "Automatic backups, if you turn them on, are saved only to the folder you pick. Profiles with a PIN are left out unless you include them; backup files can be read without the PIN.",
      "When you click a link in a note, it opens in your own browser, which then contacts that website. NoteSpark doesn't.",
    ],
  },
  {
    heading: 'The web view',
    intro: 'The web view is off until you turn it on, and off again when you stop it or quit NoteSpark. It lets a browser on another device use your notes while NoteSpark runs on this computer.',
    bullets: [
      'It answers only devices on private networks: your home or office network, a VPN such as WireGuard, or Tailscale. Requests from public internet addresses are refused.',
      'Opening it needs a link with a random code that changes every time you turn it on. Anyone who has the link can read and edit your notes, so share it only with yourself.',
      'The connection is not encrypted unless it runs through a VPN or Tailscale. On a shared Wi-Fi, other people could read what is sent.',
      'A profile with a PIN is opened and locked on this computer only. The web view works with the profile that is open here.',
    ],
  },
  {
    heading: 'Your control over your data',
    bullets: [
      'Move a note to the bin from its menu, or every note from Settings. Notes in the bin are erased for good 30 days later, or straight away if you delete them forever or empty the bin in Settings, under Bin.',
      'Export a copy of your notes at any time in Settings, under Import and export.',
      "Removing NoteSpark's folder erases everything. The developer has no copy, so deleted notes can't be recovered unless you exported them.",
    ],
  },
  {
    heading: 'Children',
    intro: "NoteSpark doesn't collect personal information from anyone, including children under 13.",
  },
  {
    heading: 'Changes to this policy',
    intro: 'If this policy changes, the new version will appear here with a new effective date.',
  },
];

const PrivacyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
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
            NoteSpark is an offline notes app. It has no account, no ads, no analytics and no tracking. Everything you write stays on this computer. This policy explains what the desktop app stores and where.
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
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl },
  column: { width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  lead: { marginTop: space.md },
  section: { marginTop: space.xl, gap: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm },
  bulletText: { flex: 1 },
});

export default PrivacyScreen;
