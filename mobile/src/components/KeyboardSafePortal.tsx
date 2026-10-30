import React from 'react';
import { StyleSheet } from 'react-native';
import { Portal } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

// Lifts dialogs by half the keyboard height (a transform; resizing layouts makes fields lose focus).
const KeyboardSafePortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const keyboard = useReanimatedKeyboardAnimation(); // height runs 0 to -keyboardHeight
  const insets = useSafeAreaInsets();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(0, keyboard.height.value + insets.bottom) / 2 }],
  }));
  return (
    <Portal>
      <Animated.View style={[StyleSheet.absoluteFill, lift]} pointerEvents="box-none">
        {children}
      </Animated.View>
    </Portal>
  );
};

export default KeyboardSafePortal;
