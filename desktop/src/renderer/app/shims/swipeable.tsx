// The desktop has no swipe: a row is just its content.
import React from 'react';
import { View } from 'react-native';

export const SwipeDirection = { LEFT: 'left', RIGHT: 'right' } as const;
export type SwipeableMethods = { close(): void };
export default ({ children, containerStyle }: any) => <View style={containerStyle}>{children}</View>;
