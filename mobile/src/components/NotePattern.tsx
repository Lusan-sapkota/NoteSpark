import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View, ViewStyle } from 'react-native';
import { NotePatternKey, isPattern } from '../theme/noteStyle';

// Background artwork for a note, drawn from plain shapes (no image files, no extra packages) in the note's text colour
// at low opacity, so the text on top keeps its contrast. Shapes hug the corners and scale with the card or screen.
// Decorative: hidden from screen readers and never takes touches.
const shapes = (key: NotePatternKey, w: number, h: number, color: string): ViewStyle[] => {
  const u = Math.min(w, Math.max(h * 1.4, 220));
  const fill = (opacity: number): ViewStyle => ({ position: 'absolute', backgroundColor: color, opacity });
  const disc = (size: number, left: number, top: number, opacity: number): ViewStyle => ({
    ...fill(opacity), width: size, height: size, borderRadius: size / 2, left, top,
  });
  switch (key) {
    case 'hills':
      return [
        disc(1.1 * u, w - 0.75 * u, h - 0.35 * u, 0.1),
        disc(0.8 * u, -0.2 * u, h - 0.25 * u, 0.08),
        disc(0.6 * u, w - 1.1 * u, h - 0.2 * u, 0.1),
      ];
    case 'rings':
      return [0, 1, 2, 3].map(i => {
        const size = (0.3 + 0.22 * i) * u;
        return { position: 'absolute', width: size, height: size, borderRadius: size / 2, left: w - size / 2, top: -size / 2, borderWidth: 2, borderColor: color, opacity: 0.18 - i * 0.03 };
      });
    case 'stripes':
      return [0, 1, 2, 3, 4].map(i => ({
        ...fill(0.1), width: 1.2 * u, height: 0.045 * u, borderRadius: 0.025 * u, left: w - 0.9 * u, top: h - (0.05 + 0.1 * i) * u, transform: [{ rotate: '-35deg' }],
      }));
    case 'dots':
      return Array.from({ length: 20 }, (_, n) => {
        const col = n % 5;
        const row = Math.floor(n / 5);
        const d = 0.026 * u;
        return disc(d, w - 0.1 * u - col * 0.075 * u, 0.08 * u + row * 0.075 * u, 0.22);
      });
    case 'waves':
      return [0, 1, 2].map(i => ({
        ...fill(0.06 + 0.03 * i), width: 1.5 * u, height: 0.34 * u, borderRadius: 0.17 * u, left: -0.25 * u + i * 0.2 * u, top: h - (0.06 + 0.07 * (2 - i)) * u - 0.06 * u * i,
      }));
    case 'petals': {
      const cx = w - 0.14 * u;
      const cy = h - 0.14 * u;
      return [
        ...[0, 45, 90, 135].map((deg): ViewStyle => ({
          ...fill(0.1), width: 0.5 * u, height: 0.2 * u, borderRadius: 0.1 * u, left: cx - 0.25 * u, top: cy - 0.1 * u, transform: [{ rotate: `${deg}deg` }],
        })),
        disc(0.07 * u, cx - 0.035 * u, cy - 0.035 * u, 0.2),
      ];
    }
  }
};

const NotePattern: React.FC<{ pattern?: string | null; color: string }> = ({ pattern, color }) => {
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (!isPattern(pattern)) return null;
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={styles.fill}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {size.w > 0 && shapes(pattern, size.w, size.h, color).map((style, i) => <View key={i} style={style} />)}
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
});

export default NotePattern;
