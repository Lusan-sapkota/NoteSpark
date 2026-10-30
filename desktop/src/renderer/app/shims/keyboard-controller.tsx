// A desktop has no on-screen keyboard to avoid.
import React from 'react';
import { ScrollView, View } from 'react-native';

export const KeyboardAwareScrollView = React.forwardRef<any, any>(({ bottomOffset, ...props }, ref) => <ScrollView ref={ref} {...props} />);
export const KeyboardProvider = ({ children }: any) => <>{children}</>;
export const KeyboardStickyView = React.forwardRef<any, any>(({ offset, ...props }, ref) => <View ref={ref} {...props} />);
