import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Icon, Text, TouchableRipple } from 'react-native-paper';
import { getLanguage, Landscape, MIN_LANDSCAPE_NOTES, Topic } from '@notespark/core';
import Header from '../components/Header';
import { RootStackParamList } from '../types';
import { isMeaningSearchAvailable, notebookLandscape } from '../storage/semanticSearch';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, shape, space } from '../theme/theme';

// Topics are told apart by their names and sizes; the colours only keep neighbours apart. Strong green stays for actions.
const useTones = () => {
  const { theme } = useTheme();
  const c = theme.colors;
  return [
    { bg: c.secondaryContainer, fg: c.onSecondaryContainer },
    { bg: c.tertiaryContainer, fg: c.onTertiaryContainer },
    { bg: c.surfaceContainerHighest, fg: c.onSurface },
    { bg: c.secondary, fg: c.onSecondary },
    { bg: c.tertiary, fg: c.onTertiary },
    { bg: c.surfaceVariant, fg: c.onSurfaceVariant },
    { bg: c.inverseSurface, fg: c.inverseOnSurface },
    { bg: c.surfaceContainerHigh, fg: c.onSurface },
  ];
};

const monthLabel = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString(getLanguage(), { month: 'short', year: '2-digit' });

const LandscapeScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Landscape'>>();
  const { theme } = useTheme();
  const { t } = useI18n();
  const tones = useTones();
  const [data, setData] = useState<Landscape | null | undefined>(undefined); // undefined: reading; null: failed
  const [open, setOpen] = useState<number | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const available = isMeaningSearchAvailable();

  useFocusEffect(
    useCallback(() => {
      if (!available) return;
      setData(undefined);
      notebookLandscape().then(setData, () => setData(null));
    }, [available])
  );

  const nameOf = (topic: Topic, i: number) => topic.name || t('landscape.topicN', { n: i + 1 });
  const biggest = data?.topics[0]?.size ?? 1;
  const bubble = (size: number) => 64 + 72 * Math.sqrt(size / biggest);

  let body: React.ReactNode;
  if (!available) body = <Message title={t('landscape.unavailableTitle')} body={t('landscape.unavailableBody')} />;
  else if (data === undefined) body = <ActivityIndicator style={styles.busy} accessibilityLabel={t('landscape.loading')} />;
  else if (data === null) body = <Message title={t('landscape.failedTitle')} body={t('common.tryAgainRestart')} />;
  else if (!data.topics.length) body = <Message title={t('landscape.tooFewTitle')} body={t('landscape.tooFewBody', { count: MIN_LANDSCAPE_NOTES })} />;
  else {
    const topics = data.topics;
    const rows = data.months.map((month, m) => ({ month, counts: topics.map(tp => tp.monthly[m]), total: topics.reduce((a, tp) => a + tp.monthly[m], 0) }));
    const most = Math.max(1, ...rows.map(r => r.total));
    body = (
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('landscape.intro')}</Text>

        <View
          accessibilityLabel={t('landscape.mapLabel')}
          onLayout={e => setMapSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          style={[styles.map, { backgroundColor: theme.colors.surfaceContainerLow }]}
        >
          {/* Small ones last, so a big bubble never hides a small one. */}
          {[...topics.keys()].reverse().map(i => {
            const tp = topics[i];
            const d = bubble(tp.size);
            const tone = tones[i % tones.length];
            return (
              <TouchableRipple
                key={i}
                onPress={() => setOpen(open === i ? null : i)}
                accessibilityRole="button"
                accessibilityState={{ selected: open === i }}
                accessibilityLabel={`${nameOf(tp, i)}, ${t('landscape.notesCount', { count: tp.size })}`}
                style={[
                  styles.bubble,
                  { width: d, height: d, borderRadius: d / 2, backgroundColor: tone.bg, left: tp.x * Math.max(0, mapSize.width - d), top: tp.y * Math.max(0, mapSize.height - d) },
                  open === i && { borderWidth: 3, borderColor: theme.colors.outline },
                ]}
              >
                <View style={styles.bubbleInner}>
                  <Text variant="labelMedium" numberOfLines={2} maxFontSizeMultiplier={1.3} style={[styles.bubbleName, { color: tone.fg }]}>{nameOf(tp, i)}</Text>
                  <Text variant="labelSmall" maxFontSizeMultiplier={1.3} style={{ color: tone.fg }}>{tp.size}</Text>
                </View>
              </TouchableRipple>
            );
          })}
        </View>

        {topics.map((tp, i) => {
          const tone = tones[i % tones.length];
          return (
            <View key={i} style={[styles.topic, { backgroundColor: theme.colors.surfaceContainerLow }]}>
              <TouchableRipple
                onPress={() => setOpen(open === i ? null : i)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open === i }}
                accessibilityLabel={t('landscape.openTopic', { name: nameOf(tp, i) })}
                style={styles.topicHead}
              >
                <View style={styles.topicHeadInner}>
                  <View style={[styles.swatch, { backgroundColor: tone.bg }]} />
                  <View style={styles.topicText}>
                    <Text variant="titleMedium" numberOfLines={2} style={{ color: theme.colors.onSurface }}>{nameOf(tp, i)}</Text>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('landscape.notesCount', { count: tp.size })}</Text>
                  </View>
                  {data.rising.includes(i) && <Trend icon="trending-up" label={t('landscape.rising')} />}
                  {data.fading.includes(i) && <Trend icon="trending-down" label={t('landscape.fading')} />}
                  <Icon source={open === i ? 'chevron-up' : 'chevron-down'} size={24} color={theme.colors.onSurfaceVariant} />
                </View>
              </TouchableRipple>
              {open === i && (
                <View style={styles.topicNotes}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('landscape.closestNotes')}</Text>
                  {tp.notes.map(n => (
                    <TouchableRipple
                      key={n.id}
                      onPress={() => navigation.navigate('NoteView', { noteId: String(n.id) })}
                      accessibilityRole="button"
                      accessibilityLabel={n.title || t('common.untitledNote')}
                      style={styles.noteRow}
                    >
                      <Text variant="bodyMedium" numberOfLines={2} style={{ color: theme.colors.primary }}>{n.title || t('common.untitledNote')}</Text>
                    </TouchableRipple>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <Text variant="titleSmall" accessibilityRole="header" style={[styles.heading, { color: theme.colors.primary }]}>{t('landscape.overTime')}</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('landscape.overTimeHelp')}</Text>
        <View style={styles.chart}>
          {rows.map(r => (
            <View key={r.month} style={styles.chartRow} accessible accessibilityLabel={t('landscape.monthRow', { month: monthLabel(r.month), count: r.total })}>
              <Text variant="labelSmall" style={[styles.month, { color: theme.colors.onSurfaceVariant }]} maxFontSizeMultiplier={1.3}>{monthLabel(r.month)}</Text>
              <View style={[styles.bar, { width: `${(r.total / most) * 100}%` }]}>
                {r.counts.map((n, i) => n > 0 && <View key={i} style={{ flex: n, backgroundColor: tones[i % tones.length].bg, borderWidth: open === i ? 2 : 0, borderColor: theme.colors.outline }} />)}
              </View>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }} maxFontSizeMultiplier={1.3}>{r.total || ''}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header title={t('landscape.title')} showBackButton onBackPress={() => navigation.goBack()} />
      <View style={styles.column}>{body}</View>
    </SafeAreaView>
  );
};

// A small label with an icon, so rising and fading are words and shapes, not a colour.
const Trend: React.FC<{ icon: string; label: string }> = ({ icon, label }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.trend, { backgroundColor: theme.colors.surfaceContainerHigh }]}>
      <Icon source={icon} size={14} color={theme.colors.onSurfaceVariant} />
      <Text variant="labelMedium" maxFontSizeMultiplier={1.5} style={{ color: theme.colors.onSurfaceVariant }}>{label}</Text>
    </View>
  );
};

const Message: React.FC<{ title: string; body: string }> = ({ title, body }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.message}>
      <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{title}</Text>
      <Text variant="bodyMedium" style={[styles.messageBody, { color: theme.colors.onSurfaceVariant }]}>{body}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.sm },
  busy: { marginTop: space.xl },
  map: { height: 340, borderRadius: shape.group, overflow: 'hidden', marginVertical: space.md },
  bubble: { position: 'absolute', overflow: 'hidden' },
  bubbleInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.sm },
  bubbleName: { textAlign: 'center' },
  topic: { borderRadius: shape.group, overflow: 'hidden' },
  topicHead: { minHeight: 56 },
  topicHeadInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  swatch: { width: 16, height: 16, borderRadius: 8 },
  topicText: { flex: 1 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: shape.small, paddingHorizontal: space.sm, paddingVertical: 2 },
  topicNotes: { paddingHorizontal: space.lg, paddingBottom: space.md },
  noteRow: { minHeight: 48, justifyContent: 'center' },
  heading: { marginTop: space.lg },
  chart: { gap: space.xs, marginTop: space.sm },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  month: { width: 52 },
  bar: { flexDirection: 'row', height: 14, borderRadius: shape.extraSmall, overflow: 'hidden', minWidth: 0 },
  message: { padding: space.xl },
  messageBody: { marginTop: space.xs },
});

export default LandscapeScreen;
