// A desktop has no on-screen keyboard to avoid.
import React from 'react';
import { ScrollView, View } from 'react-native';

export const KeyboardAwareScrollView = React.forwardRef<any, any>(({ bottomOffset, enabled, ...props }, ref) => <ScrollView ref={ref} {...props} />);
// No on-screen keyboard on the desktop.
export const useKeyboardState = <T,>(select: (state: { height: number }) => T) => select({ height: 0 });
export const KeyboardProvider = ({ children }: any) => <>{children}</>;
export const KeyboardStickyView = React.forwardRef<any, any>(({ offset, ...props }, ref) => <View ref={ref} {...props} />);
