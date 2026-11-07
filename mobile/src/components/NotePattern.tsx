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
  // A bar of `len` by `thick` centred on (cx, cy), turned by `deg`.
  const bar = (cx: number, cy: number, len: number, thick: number, deg: number, opacity: number): ViewStyle => ({
    ...fill(opacity), width: len, height: thick, borderRadius: thick / 2, left: cx - len / 2, top: cy - thick / 2, transform: [{ rotate: `${deg}deg` }],
  });
  // The same numbers every time for a given size, so a card doesn't change when it redraws.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  switch (key) {
    case 'hills':
      return [
        disc(1.1 * u, w - 0.75 * u, h - 0.35 * u, 0.1),
        disc(0.8 * u, -0.2 * u, h - 0.25 * u, 0.08),
        disc(0.6 * u, w - 1.1 * u, h - 0.2 * u, 0.1),
      ];
    case 'mountains': {
      // Triangles from borders: the two side borders are see-through, the bottom one is the colour.
      const peak = (x: number, height: number, half: number, opacity: number): ViewStyle => ({
        position: 'absolute', width: 0, height: 0, left: x - half, top: h - height, opacity,
        borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
      });
      return [peak(w * 0.22, 0.42 * u, 0.5 * u, 0.07), peak(w * 0.62, 0.56 * u, 0.62 * u, 0.1), peak(w * 0.92, 0.34 * u, 0.42 * u, 0.07)];
    }
    case 'sunrise': {
      const cx = w - 0.3 * u;
      const rays = Array.from({ length: 8 }, (_, i) => {
        const a = (-170 + (i * 160) / 7) * (Math.PI / 180);
        return bar(cx + Math.cos(a) * 0.36 * u, h + Math.sin(a) * 0.36 * u, 0.2 * u, 0.022 * u, (a * 180) / Math.PI, 0.16);
      });
      return [disc(0.3 * u, cx - 0.15 * u, h - 0.15 * u, 0.14), ...rays];
    }
    case 'waves':
      return [0, 1, 2].map(i => ({
        ...fill(0.06 + 0.03 * i), width: 1.5 * u, height: 0.34 * u, borderRadius: 0.17 * u, left: -0.25 * u + i * 0.2 * u, top: h - (0.06 + 0.07 * (2 - i)) * u - 0.06 * u * i,
      }));
    case 'rings':
      return [0, 1, 2, 3].map(i => {
        const size = (0.3 + 0.22 * i) * u;
        return { position: 'absolute', width: size, height: size, borderRadius: size / 2, left: w - size / 2, top: -size / 2, borderWidth: 2, borderColor: color, opacity: 0.18 - i * 0.03 };
      });
    case 'bloom': {
      const cx = 0.14 * u;
      const cy = 0.14 * u;
      const petal = (len: number, deg: number, opacity: number) => bar(cx, cy, len, len * 0.34, deg, opacity);
      return [
        ...[0, 45, 90, 135].map(d => petal(0.6 * u, d, 0.08)),
        ...[22.5, 67.5, 112.5, 157.5].map(d => petal(0.42 * u, d, 0.1)),
        disc(0.08 * u, cx - 0.04 * u, cy - 0.04 * u, 0.22),
      ];
    }
    case 'petals': {
      const cx = w - 0.14 * u;
      const cy = h - 0.14 * u;
      return [...[0, 45, 90, 135].map(d => bar(cx, cy, 0.5 * u, 0.2 * u, d, 0.1)), disc(0.07 * u, cx - 0.035 * u, cy - 0.035 * u, 0.2)];
    }
    case 'bubbles':
      return Array.from({ length: 8 }, (_, i) => {
        const size = (0.06 + rand() * 0.16) * u;
        const left = w * (0.3 + rand() * 0.65) - size / 2;
        const top = h * rand() - size / 2;
        return i % 2 ? { position: 'absolute', width: size, height: size, borderRadius: size / 2, left, top, borderWidth: 2, borderColor: color, opacity: 0.18 } : disc(size, left, top, 0.08);
      });
    case 'dots':
      return Array.from({ length: 20 }, (_, n) => disc(0.026 * u, w - 0.1 * u - (n % 5) * 0.075 * u, 0.08 * u + Math.floor(n / 5) * 0.075 * u, 0.22));
    case 'confetti':
      return Array.from({ length: 14 }, () => {
        const len = (0.05 + rand() * 0.04) * u;
        return bar(w * rand(), Math.min(h * 0.45, 0.5 * u) * rand() + 0.03 * u, len, 0.018 * u, rand() * 180, 0.14 + rand() * 0.12);
      });
    case 'stripes':
      return [0, 1, 2, 3, 4].map(i => bar(w - 0.3 * u, h - (0.05 + 0.1 * i) * u, 1.2 * u, 0.045 * u, -35, 0.1));
    case 'diamonds': {
      const out: ViewStyle[] = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4 - r; c++) {
          const size = 0.1 * u;
          out.push({ ...fill(0.08 + 0.05 * ((r + c) % 2)), width: size, height: size, borderRadius: size * 0.12, left: 0.05 * u + c * 0.14 * u, top: 0.05 * u + r * 0.14 * u, transform: [{ rotate: '45deg' }] });
        }
      }
      return out;
    }
    case 'crosses': {
      const out: ViewStyle[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const cx = 0.08 * u + c * 0.12 * u;
          const cy = h - 0.08 * u - r * 0.12 * u;
          out.push(bar(cx, cy, 0.06 * u, 0.014 * u, 0, 0.2), bar(cx, cy, 0.06 * u, 0.014 * u, 90, 0.2));
        }
      }
      return out;
    }
    case 'lines': {
      const gap = Math.max(0.14 * u, 20);
      return Array.from({ length: Math.min(40, Math.floor((h - 0.2 * u) / gap) + 1) }, (_, i) => ({ ...fill(0.1), width: w, height: 1, left: 0, top: 0.2 * u + i * gap }));
    }
    case 'grid': {
      const gap = Math.max(0.12 * u, 18);
      const cols = Math.min(60, Math.ceil(w / gap));
      const rows = Math.min(60, Math.ceil(h / gap));
      return [
        ...Array.from({ length: cols }, (_, i) => ({ ...fill(0.07), width: 1, height: h, left: i * gap, top: 0 })),
        ...Array.from({ length: rows }, (_, i) => ({ ...fill(0.07), width: w, height: 1, left: 0, top: i * gap })),
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
