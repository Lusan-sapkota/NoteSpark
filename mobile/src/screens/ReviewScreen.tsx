import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Button, ProgressBar, Text } from 'react-native-paper';
import { Card, formatDue, Grade, intervalPreview, today } from '@notespark/core';
import Header from '../components/Header';
import { RootStackParamList } from '../types';
import { gradeCard, loadReviewSession, ReviewSession } from '../utils/reviewCards';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { NoteText, readingWidth, shape, space } from '../theme/theme';

const GRADES: Grade[] = ['again', 'hard', 'good', 'easy'];

// One card at a time: the question, then the answer and four answers that set when it comes back.
const ReviewScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Review'>>();
  const { theme } = useTheme();
  const { t } = useI18n();
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [failed, setFailed] = useState(false);
  const [queue, setQueue] = useState<Card[]>([]);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0); // cards shown this session, a card marked "again" counts again
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFailed(false);
      loadReviewSession().then(
        s => { setSession(s); setQueue(s.queue); setPosition(0); setTotal(s.queue.length); setRevealed(false); setDone(0); },
        () => setFailed(true)
      );
    }, [])
  );

  const card = session && position < queue.length ? queue[position] : null;
  const gradeLabel = (g: Grade) => t(`review.${g}`);
  const days = (n: number) => t('review.days', { count: n });

  const answer = async (grade: Grade) => {
    if (!session || !card) return;
    await gradeCard(session, card, grade).catch(() => {});
    setDone(d => d + 1);
    // "Again" comes back once more before the session ends.
    if (grade === 'again') { setQueue(q => [...q, card]); setTotal(n => n + 1); }
    setPosition(p => p + 1);
    setRevealed(false);
  };

  let body: React.ReactNode;
  if (failed) {
    body = <Message title={t('review.failedTitle')} body={t('common.tryAgainRestart')} />;
  } else if (!session) {
    body = <ActivityIndicator style={styles.busy} accessibilityLabel={t('common.loading')} />;
  } else if (session.total === 0) {
    body = <Message title={t('review.emptyTitle')} body={t('review.emptyBody')} />;
  } else if (!card) {
    body = done > 0
      ? <Message title={t('review.doneTitle')} body={t('review.doneBody', { count: done })} />
      : <Message title={t('review.caughtUpTitle')} body={session.nextDue ? t('review.nextDue', { date: formatDue(session.nextDue) }) : ''} />;
  } else {
    const preview = intervalPreview(session.states[card.id], today());
    body = (
      <ScrollView contentContainerStyle={styles.content}>
        <ProgressBar
          progress={total ? position / total : 0}
          color={theme.colors.secondary}
          style={[styles.progress, { backgroundColor: theme.colors.surfaceContainerHighest }]}
        />
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('review.progress', { current: position + 1, total })}</Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceContainerLow }]}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('review.question')}</Text>
          <NoteText variant="noteTitle" style={[styles.text, { color: theme.colors.onSurface }]}>{card.question}</NoteText>
          {revealed && (
            <>
              <Text variant="labelMedium" style={[styles.answerLabel, { color: theme.colors.onSurfaceVariant }]}>{t('review.answer')}</Text>
              <NoteText variant="noteBody" style={[styles.text, { color: theme.colors.onSurface }]}>{card.answer}</NoteText>
            </>
          )}
        </View>
        <Button compact icon="open-in-new" onPress={() => navigation.navigate('NoteView', { noteId: String(card.noteId) })} style={styles.openNote} accessibilityLabel={`${t('review.openNote')}: ${t('review.fromNote', { title: card.noteTitle })}`}>
          {t('review.fromNote', { title: card.noteTitle || t('common.untitledNote') })}
        </Button>
        {revealed ? (
          <View style={styles.grades}>
            {GRADES.map(g => (
              <View key={g} style={styles.gradeCell}>
                <Button
                  mode={g === 'good' ? 'contained' : 'outlined'}
                  onPress={() => answer(g)}
                  style={styles.gradeButton}
                  contentStyle={styles.gradeContent}
                  accessibilityLabel={t('review.gradeLabel', { grade: gradeLabel(g), days: days(preview[g]) })}
                >
                  {gradeLabel(g)}
                </Button>
                <Text variant="bodySmall" style={[styles.hint, { color: theme.colors.onSurfaceVariant }]} maxFontSizeMultiplier={1.5}>{days(preview[g])}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Button mode="contained" onPress={() => setRevealed(true)} style={styles.show} contentStyle={styles.gradeContent}>{t('review.showAnswer')}</Button>
        )}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header title={t('review.title')} showBackButton onBackPress={() => navigation.goBack()} />
      <View style={styles.column}>{body}</View>
    </SafeAreaView>
  );
};

const Message: React.FC<{ title: string; body: string }> = ({ title, body }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.message}>
      <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{title}</Text>
      {!!body && <Text variant="bodyMedium" style={[styles.messageBody, { color: theme.colors.onSurfaceVariant }]}>{body}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxl },
  busy: { marginTop: space.xl },
  progress: { height: 4, borderRadius: shape.full, marginBottom: space.xs },
  card: { borderRadius: shape.extraLarge, padding: space.xl, marginTop: space.md, minHeight: 200 },
  text: { marginTop: space.sm },
  answerLabel: { marginTop: space.xl },
  openNote: { alignSelf: 'flex-start', marginTop: space.sm },
  show: { marginTop: space.xl },
  grades: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  gradeCell: { flex: 1, alignItems: 'center' },
  gradeButton: { alignSelf: 'stretch', borderRadius: shape.control },
  gradeContent: { minHeight: 48, paddingHorizontal: 0 },
  hint: { marginTop: space.xs, textAlign: 'center' },
  message: { padding: space.xl },
  messageBody: { marginTop: space.xs },
});

export default ReviewScreen;
