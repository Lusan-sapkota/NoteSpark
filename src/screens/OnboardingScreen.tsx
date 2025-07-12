import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { Image } from 'react-native';

const LOGO = require('../../assets/icon.png');
const { width } = Dimensions.get('window');

const slides = [
  {
    title: 'Welcome to NoteSpark!',
    subtitle: 'Your notes, beautifully organized.',
    animation: 'fade',
  },
  {
    title: 'Quick Note Creation',
    subtitle: 'Capture ideas instantly with a single tap.',
    animation: 'scale',
  },
  {
    title: 'Markdown Support',
    subtitle: 'Write notes with rich formatting.',
    animation: 'slide',
  },
];

const OnboardingScreen = ({ onFinish }: { onFinish: () => void }) => {
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const slideAnim = useRef(new Animated.Value(width)).current;
  const logoScaleAnim = useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    // Reset animations
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.8);
    slideAnim.setValue(width);
    logoScaleAnim.setValue(1);
    if (slides[step].animation === 'fade') {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.out(Easing.exp),
      }).start();
    } else if (slides[step].animation === 'scale') {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true,
      }).start();
    } else if (slides[step].animation === 'slide') {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
        easing: Easing.out(Easing.exp),
      }).start();
    }
    // Logo pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoScaleAnim, {
          toValue: 1.08,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(logoScaleAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [step, fadeAnim, scaleAnim, slideAnim, logoScaleAnim]);

  const handleNext = () => {
    if (step < slides.length - 1) {
      setStep(step + 1);
    } else {
      onFinish();
    }
  };

  let animatedStyle = {};
  if (slides[step].animation === 'fade') {
    animatedStyle = { opacity: fadeAnim };
  } else if (slides[step].animation === 'scale') {
    animatedStyle = { transform: [{ scale: scaleAnim }] };
  } else if (slides[step].animation === 'slide') {
    animatedStyle = { transform: [{ translateX: slideAnim }] };
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}> 
      <TouchableOpacity style={styles.skipBtn} onPress={onFinish}>
        <Text style={[styles.skipText, { color: theme.colors.disabled }]}>Skip</Text>
      </TouchableOpacity>
      <Animated.View style={[animatedStyle, styles.centered]}>
        <Animated.View style={[styles.logoContainer, { transform: [{ scale: logoScaleAnim }] }]}> 
          <Image source={LOGO} style={styles.logo} />
        </Animated.View>
        <Text style={[styles.title, { color: theme.colors.primary }]}>{slides[step].title}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.text }]}>{slides[step].subtitle}</Text>
      </Animated.View>
      <View style={styles.footer}>
        <View style={styles.dotsContainer}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i === step ? theme.colors.primary : theme.colors.disabled }]} />
          ))}
        </View>
        <TouchableOpacity style={[styles.button, { backgroundColor: theme.colors.primary }]} onPress={handleNext}>
          <Text style={[styles.buttonText, { color: theme.colors.background }]}> 
            {step === slides.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    width: '100%',
  },
  logoContainer: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  logo: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  skipBtn: {
    position: 'absolute',
    top: 50,
    right: 18,
    zIndex: 10,
    padding: 4,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.7,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  footer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 18,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 5,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default OnboardingScreen;
