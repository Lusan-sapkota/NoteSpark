import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';
import type { TKey } from '@notespark/core';
import Header, { useHeaderElevation } from '../components/Header';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { readingWidth, space } from '../theme/theme';

const CONTACT_EMAIL = 'contact@lusansapkota.com.np';

// Keep this in step with what the app actually does; update EFFECTIVE_DATE on every change.
const sections: { heading: TKey; intro?: TKey; bullets?: TKey[]; outro?: TKey }[] = [
  { heading: 'privacy.storesHeading',
    bullets: ['privacy.storesM1', 'privacy.storesM2', 'privacy.storesM3', 'privacy.storesM4', 'privacy.storesM5', 'privacy.storesM6'], outro: 'privacy.storesOutro' },
  { heading: 'privacy.leavesHeadingM', intro: 'privacy.leavesIntroM',
    bullets: ['privacy.leavesM1', 'privacy.leavesM2', 'privacy.leavesBackups', 'privacy.leavesM4'] },
  { heading: 'privacy.permHeading',
    bullets: ['privacy.permM1', 'privacy.permM2', 'privacy.permM3', 'privacy.permM4', 'privacy.permM5'] },
  { heading: 'privacy.controlHeading',
    bullets: ['privacy.controlBin', 'privacy.controlExport', 'privacy.controlM3'] },
  { heading: 'privacy.childrenHeading', intro: 'privacy.childrenText' },
  { heading: 'privacy.changesHeading', intro: 'privacy.changesM' },
];

const PrivacyScreen: React.FC = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const body = { color: theme.colors.onSurfaceVariant };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title={t('privacy.title')} showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          <Text variant="bodySmall" style={body}>{t('privacy.effective', { date: t('privacy.dateM') })}</Text>
          <Text variant="bodyLarge" style={[styles.lead, { color: theme.colors.onSurface }]}>
            {t('privacy.leadM')}
          </Text>

          {sections.map(section => (
            <View key={section.heading} style={styles.section}>
              <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>
                {t(section.heading)}
              </Text>
              {!!section.intro && <Text variant="bodyLarge" style={body}>{t(section.intro)}</Text>}
              {section.bullets?.map(item => (
                <View key={item} style={styles.bullet}>
                  <Text variant="bodyLarge" style={body} accessibilityElementsHidden importantForAccessibility="no">•</Text>
                  <Text variant="bodyLarge" style={[body, styles.bulletText]}>{t(item)}</Text>
                </View>
              ))}
              {!!section.outro && <Text variant="bodyLarge" style={body}>{t(section.outro)}</Text>}
            </View>
          ))}

          <View style={styles.section}>
            <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>{t('privacy.contactHeading')}</Text>
            <Text variant="bodyLarge" style={body}>
              {t('privacy.contactLead')}{' '}
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
