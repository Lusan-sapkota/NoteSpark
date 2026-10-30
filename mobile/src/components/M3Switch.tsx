import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';

interface M3SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

// Material 3 switch (Paper's Switch draws the older platform one); the thumb springs across on tap.
const TRACK_W = 52;
const TRACK_H = 32;

const M3Switch: React.FC<M3SwitchProps> = ({ value, onValueChange, accessibilityLabel, disabled }) => {
  const { theme } = useTheme();
  const reduceMotion = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.value = reduceMotion ? (value ? 1 : 0) : withSpring(value ? 1 : 0, { damping: 18, stiffness: 260 });
  }, [value, reduceMotion]);

  // Thumb grows from 16 to 24 and moves from the left end to the right end (centres 16 and 36).
  const thumbStyle = useAnimatedStyle(() => {
    const size = 16 + 8 * on.value;
    const centre = 16 + 20 * on.value;
    return { width: size, height: size, borderRadius: size / 2, left: centre - size / 2 - 2, top: (TRACK_H - size) / 2 - 2 }; // inside the border
  });

  const c = theme.colors;
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.track,
        value
          ? { backgroundColor: c.primary, borderColor: c.primary }
          : { backgroundColor: c.surfaceContainerHighest, borderColor: c.outline },
        disabled && styles.disabled,
      ]}
    >
      <Animated.View style={[styles.thumb, { backgroundColor: value ? c.onPrimary : c.outline }, thumbStyle]}>
        {value && <Icon source="check" size={16} color={c.onPrimaryContainer} />}
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: 2,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.38,
  },
});

export default M3Switch;
