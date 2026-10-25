import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Portal } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

// A Portal that slides up with the keyboard so a Paper Dialog stays centred in the space above it. Paper
// centres dialogs between the safe-area insets, so the lift is half of (keyboard height minus the bottom
// inset); a full lift pushed tall dialogs off the top. A transform, not padding: resizing layouts while the
// keyboard animates makes a focused field lose focus (see docs/design/design-system.md, Keyboard).
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

// Max height for a dialog's scrolling body: the space above the keyboard (or the screen bottom) minus the
// dialog's title, buttons and margins (about 240dp), so a tall dialog scrolls inside instead of running off screen.
export const useDialogBodyMaxHeight = () => {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardState(state => state.height);
  return Math.max(160, height - insets.top - (keyboard || insets.bottom) - 240);
};

export default KeyboardSafePortal;
