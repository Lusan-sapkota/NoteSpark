// The desktop privacy policy; keep it in step with the app and update EFFECTIVE_DATE on every change.
import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from 'react-native-paper';
import type { TKey } from '@notespark/core';
import Header, { useHeaderElevation } from '../../../../../../mobile/src/components/Header';
import { useTheme } from '../../../../../../mobile/src/theme/ThemeContext';
import { useI18n } from '../../../../../../mobile/src/i18n/I18nContext';
import { readingWidth, space } from '../../../../../../mobile/src/theme/theme';

const CONTACT_EMAIL = 'contact@lusansapkota.com.np';

const sections: { heading: TKey; intro?: TKey; bullets?: TKey[]; outro?: TKey }[] = [
  { heading: 'privacy.storesHeading',
    bullets: ['privacy.storesD1', 'privacy.storesD2', 'privacy.storesD3', 'privacy.storesD4', 'privacy.storesD5'], outro: 'privacy.storesOutro' },
  { heading: 'privacy.leavesHeadingD', intro: 'privacy.leavesIntroD',
    bullets: ['privacy.leavesD1', 'privacy.leavesD2', 'privacy.leavesBackups', 'privacy.leavesD4'] },
  { heading: 'privacy.webHeading', intro: 'privacy.webIntro',
    bullets: ['privacy.web1', 'privacy.web2', 'privacy.web3', 'privacy.web4'] },
  { heading: 'privacy.controlHeading',
    bullets: ['privacy.controlBin', 'privacy.controlExport', 'privacy.controlD3'] },
  { heading: 'privacy.childrenHeading', intro: 'privacy.childrenText' },
  { heading: 'privacy.changesHeading', intro: 'privacy.changesD' },
];

const PrivacyScreen: React.FC = () => {
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const body = { color: theme.colors.onSurfaceVariant };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title={t('privacy.title')} showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          <Text variant="bodySmall" style={body}>{t('privacy.effective', { date: t('privacy.dateD') })}</Text>
          <Text variant="bodyLarge" style={[styles.lead, { color: theme.colors.onSurface }]}>
            {t('privacy.leadD')}
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
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl },
  column: { width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  lead: { marginTop: space.md },
  section: { marginTop: space.xl, gap: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm },
  bulletText: { flex: 1 },
});

export default PrivacyScreen;
