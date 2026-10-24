import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';

const LOGO = require('../../assets/icon.png');

const slides = [
  {
    title: 'Notes that stay on your phone',
    body: 'No account, no cloud, no ads. Everything you write is saved on this device.',
  },
  {
    title: 'Write it down fast',
    body: 'Tap New note on the home screen and start typing. Pin the notes you need most.',
  },
  {
    title: 'Plain text or Markdown',
    body: 'Switch any note to Markdown for headings, lists and links. Back up everything as a JSON file.',
  },
];

const OnboardingScreen = ({ onFinish }: { onFinish: () => void }) => {
  const [finished, setFinished] = useState(false);
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const isLast = step === slides.length - 1;

  const finish = () => {
    if (finished) return;
    setFinished(true);
    setTimeout(onFinish, 150);
  };

  const handleNext = () => {
    if (isLast) finish();
    else setStep(step + 1);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column}>
        <Button mode="text" onPress={finish} disabled={finished} style={styles.skip}>
          Skip
        </Button>

        {/* Keyed by step so each Next brings the new slide in; layout animations follow the OS reduce-motion setting. */}
        <Animated.View key={step} entering={step === 0 ? undefined : FadeInRight.springify()} style={styles.slide}>
          <Image source={LOGO} style={styles.logo} accessibilityLabel="NoteSpark logo" />
          <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onSurface }]} accessibilityRole="header">
            {slides[step].title}
          </Text>
          <Text variant="bodyLarge" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
            {slides[step].body}
          </Text>
        </Animated.View>

        <View style={styles.footer}>
          <View style={styles.dots} accessible accessibilityLabel={`Step ${step + 1} of ${slides.length}`}>
            {slides.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: i === step ? theme.colors.primary : theme.colors.outlineVariant },
                  i === step && styles.dotActive,
                ]}
              />
            ))}
          </View>
          <Button mode="contained" onPress={handleNext} disabled={finished}>
            {isLast ? 'Start writing' : 'Next'}
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  skip: {
    alignSelf: 'flex-end',
    marginTop: space.sm,
    marginRight: -space.md,
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
  },
  // Round, matching the launcher icon in a circle mask.
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: space.xl,
  },
  title: {
    marginBottom: space.md,
  },
  body: {
    maxWidth: 420,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: {
    flexDirection: 'row',
    gap: space.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // The current step is a longer pill, so it doesn't rely on color alone.
  dotActive: {
    width: 24,
  },
});

export default OnboardingScreen;
