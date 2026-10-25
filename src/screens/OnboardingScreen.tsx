import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { Button, Text, TextInput } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, space } from '../theme/theme';

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

const OnboardingScreen = ({ onFinish, onProfileSetup }: { onFinish: () => void; onProfileSetup: (name: string, pin?: string) => Promise<void> }) => {
  const [finished, setFinished] = useState(false);
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const [setup, setSetup] = useState(false);
  const [name, setName] = useState('Personal');
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const isLast = step === slides.length - 1;

  const finish = () => {
    if (finished) return;
    if (!setup) {
      setSetup(true);
      return;
    }
    setFinished(true);
    setTimeout(onFinish, 150);
  };

  const handleNext = () => {
    if (isLast) setSetup(true);
    else setStep(step + 1);
  };

  const saveProfile = async (withPin: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      await onProfileSetup(name.trim() || 'Personal', withPin ? pin : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column}>
        {!setup && (
          <Button mode="text" onPress={finish} disabled={finished} style={styles.skip}>
            Skip
          </Button>
        )}
        {setup ? (
          <>
            <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onSurface }]}>Set up your profile</Text>
            <Text variant="bodyLarge" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
              Choose a name and optionally protect this profile with a four-digit PIN.
            </Text>
            <TextInput mode="outlined" label="Profile name" value={name} onChangeText={setName} style={styles.setupInput} autoFocus />
            <TextInput mode="outlined" label="Four-digit PIN (optional)" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry style={styles.setupInput} />
            <TextInput mode="outlined" label="Confirm PIN" value={pinConfirmation} onChangeText={value => setPinConfirmation(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry style={styles.setupInput} />
            <View style={styles.setupActions}>
              <Button mode="text" onPress={() => saveProfile(false)} disabled={saving || !!pin || !!pinConfirmation}>Skip PIN</Button>
              <Button mode="contained" onPress={() => saveProfile(true)} disabled={saving || !name.trim() || pin.length !== 4 || pin !== pinConfirmation}>Save profile</Button>
            </View>
          </>
        ) : (
          <>
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
              <Button mode="contained" onPress={handleNext} theme={controlTheme} disabled={finished}>
                {isLast ? 'Start writing' : 'Next'}
              </Button>
            </View>
          </>
        )}
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
  setupInput: {
    marginTop: space.md,
  },
  setupActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: space.xl,
    gap: space.sm,
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
