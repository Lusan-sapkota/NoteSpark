// A desktop window has no system bars or notch, so every inset is zero.
import React from 'react';
import { View } from 'react-native';

const insets = { top: 0, right: 0, bottom: 0, left: 0 };
export const SafeAreaInsetsContext = React.createContext(insets);
export const SafeAreaProvider = ({ children, style }: any) => <View style={[{ flex: 1 }, style]}>{children}</View>;
export const SafeAreaView = View;
export const useSafeAreaInsets = () => insets;
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
export const initialWindowMetrics = { insets, frame: { x: 0, y: 0, width: 0, height: 0 } };
