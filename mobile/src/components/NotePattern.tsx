import React, { useMemo, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, View, ViewStyle } from 'react-native';
import { ArtHue, NotePatternKey, artPalette, isPattern, isPictureBackground, safeAlpha, scrimAlpha } from '../theme/noteStyle';
import { useCachedImage } from '../utils/imageCache';

// Decorative multi-colour artwork from plain shapes; see-through so the note colour and text stay readable.
const shapes = (key: NotePatternKey, w: number, h: number, dark: boolean, base: string, ink: string): ViewStyle[] => {
  const u = Math.min(w, Math.max(h * 1.4, 220));
  const art = artPalette(dark);
  const c = (hue: ArtHue, tone: 0 | 1 | 2 = 1) => art[hue][tone];
  // Opacity is capped so the text keeps its contrast over this shape.
  const safe = (color: string, opacity: number) => safeAlpha(base, ink, color, opacity);
  const fill = (color: string, opacity: number): ViewStyle => ({ position: 'absolute', backgroundColor: color, opacity: safe(color, opacity) });
  const disc = (color: string, size: number, left: number, top: number, opacity: number): ViewStyle => ({
    ...fill(color, opacity), width: size, height: size, borderRadius: size / 2, left, top,
  });
  const ring = (color: string, size: number, left: number, top: number, opacity: number, width = 2): ViewStyle => ({
    position: 'absolute', width: size, height: size, borderRadius: size / 2, left, top, borderWidth: width, borderColor: color, opacity: safe(color, opacity),
  });
  // A bar of `len` by `thick` centred on (cx, cy), turned by `deg`.
  const bar = (color: string, cx: number, cy: number, len: number, thick: number, deg: number, opacity: number): ViewStyle => ({
    ...fill(color, opacity), width: len, height: thick, borderRadius: thick / 2, left: cx - len / 2, top: cy - thick / 2, transform: [{ rotate: `${deg}deg` }],
  });
  // Deterministic, so a card doesn't change on redraw.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hues: ArtHue[] = ['green', 'teal', 'sky', 'violet', 'pink', 'coral', 'orange', 'gold'];

  switch (key) {
    case 'seaweed': {
      // Fronds along the bottom and two birds.
      const frond = (color: string, x: number, height: number, deg: number, opacity: number): ViewStyle => ({
        ...fill(color, opacity), width: 0.07 * u, height, borderRadius: 0.035 * u, left: x - 0.035 * u, top: h - height * 0.85, transform: [{ rotate: `${deg}deg` }],
      });
      const bird = (color: string, size: number, left: number, top: number): ViewStyle => ({
        position: 'absolute', width: size, height: size / 2, left, top, opacity: 0.8,
        borderBottomWidth: 2, borderBottomColor: color, borderBottomLeftRadius: size / 2, borderBottomRightRadius: size / 2,
      });
      const fronds = Array.from({ length: 9 }, (_, i) =>
        frond(c(i % 2 ? 'teal' : 'green', (i % 3) as 0 | 1 | 2), w * (0.04 + i * 0.115), (0.3 + rand() * 0.3) * u, (i % 2 ? 1 : -1) * (6 + rand() * 12), 0.6));
      return [...fronds, bird(c('violet', 2), 0.12 * u, w * 0.72, h * 0.62), bird(c('sky', 2), 0.08 * u, w * 0.84, h * 0.55)];
    }
    case 'skyline': {
      // Buildings with lit windows.
      const out: ViewStyle[] = [];
      const widths = [0.12, 0.09, 0.14, 0.1, 0.13, 0.08];
      let x = w - 0.7 * u;
      widths.forEach((bw, i) => {
        const bh = (0.22 + rand() * 0.3) * u;
        out.push({ ...fill(c((['violet', 'sky', 'teal'] as ArtHue[])[i % 3], 1), 0.55), width: bw * u, height: bh, left: x, top: h - bh });
        for (let r = 0; r < 3; r++) {
          for (let col = 0; col < 2; col++) {
            if (rand() > 0.5) out.push(disc(c('gold', 0), 0.018 * u, x + 0.02 * u + col * 0.045 * u, h - bh + 0.03 * u + r * 0.05 * u, 0.9));
          }
        }
        x += bw * u + 0.01 * u;
      });
      return out;
    }
    case 'flowers': {
      const flower = (x: number, stem: number, hue: ArtHue, size: number): ViewStyle[] => [
        { ...fill(c('green', 1), 0.7), width: 0.012 * u, height: stem, left: x - 0.006 * u, top: h - stem },
        ...[0, 72, 144, 216, 288].map((deg): ViewStyle => {
          const a = ((deg - 90) * Math.PI) / 180;
          return disc(c(hue, 0), size, x + Math.cos(a) * size * 0.7 - size / 2, h - stem + Math.sin(a) * size * 0.7 - size / 2, 0.75);
        }),
        disc(c('gold', 1), size * 0.7, x - size * 0.35, h - stem - size * 0.35, 0.95),
      ];
      return [
        ...flower(w - 0.12 * u, 0.3 * u, 'pink', 0.07 * u),
        ...flower(w - 0.26 * u, 0.2 * u, 'orange', 0.06 * u),
        ...flower(w - 0.38 * u, 0.26 * u, 'violet', 0.065 * u),
      ];
    }
    case 'rain':
      return Array.from({ length: 22 }, (_, i) =>
        bar(c((['sky', 'teal', 'violet'] as ArtHue[])[i % 3], (i % 3) as 0 | 1 | 2), w * rand(), Math.min(h, 1.1 * u) * rand(), 0.07 * u, 0.012 * u, 70, 0.6));
    case 'stars': {
      const star = (color: string, cx: number, cy: number, size: number, opacity: number): ViewStyle[] => [
        bar(color, cx, cy, size, size * 0.18, 0, opacity),
        bar(color, cx, cy, size, size * 0.18, 90, opacity),
        bar(color, cx, cy, size * 0.6, size * 0.12, 45, opacity * 0.8),
        bar(color, cx, cy, size * 0.6, size * 0.12, 135, opacity * 0.8),
      ];
      return Array.from({ length: 7 }, (_, i) =>
        star(c((['gold', 'pink', 'sky', 'violet'] as ArtHue[])[i % 4], (i % 2) as 0 | 1), w * (0.35 + rand() * 0.6), Math.min(h * 0.5, 0.7 * u) * rand() + 0.05 * u, (0.05 + rand() * 0.07) * u, 0.85)).flat();
    }
    case 'hills':
      return [
        disc(c('gold', 0), 0.16 * u, w - 0.3 * u, 0.1 * u, 0.85),
        disc(c('teal', 0), 1.1 * u, w - 0.75 * u, h - 0.38 * u, 0.6),
        disc(c('green', 1), 0.8 * u, -0.2 * u, h - 0.28 * u, 0.55),
        disc(c('green', 2), 0.6 * u, w - 1.1 * u, h - 0.2 * u, 0.5),
      ];
    case 'mountains': {
      // Triangles drawn with borders.
      const peak = (color: string, x: number, height: number, half: number, opacity: number): ViewStyle => ({
        position: 'absolute', width: 0, height: 0, left: x - half, top: h - height, opacity: safe(color, opacity),
        borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
      });
      return [
        disc(c('gold', 0), 0.12 * u, w - 0.22 * u, 0.08 * u, 0.85),
        peak(c('violet', 1), w * 0.22, 0.42 * u, 0.5 * u, 0.55),
        peak(c('sky', 1), w * 0.62, 0.56 * u, 0.62 * u, 0.55),
        peak(c('pink', 0), w * 0.92, 0.34 * u, 0.42 * u, 0.6),
      ];
    }
    case 'sunrise': {
      const cx = w - 0.3 * u;
      const rays = Array.from({ length: 8 }, (_, i) => {
        const a = (-170 + (i * 160) / 7) * (Math.PI / 180);
        return bar(c(i % 2 ? 'orange' : 'gold', 1), cx + Math.cos(a) * 0.36 * u, h + Math.sin(a) * 0.36 * u, 0.2 * u, 0.026 * u, (a * 180) / Math.PI, 0.75);
      });
      return [disc(c('coral', 1), 0.3 * u, cx - 0.15 * u, h - 0.15 * u, 0.7), ...rays];
    }
    case 'waves':
      return [
        { ...fill(c('sky', 0), 0.55), width: 1.5 * u, height: 0.34 * u, borderRadius: 0.17 * u, left: -0.05 * u, top: h - 0.2 * u },
        { ...fill(c('teal', 1), 0.5), width: 1.5 * u, height: 0.34 * u, borderRadius: 0.17 * u, left: -0.45 * u, top: h - 0.13 * u },
        { ...fill(c('sky', 2), 0.45), width: 1.5 * u, height: 0.34 * u, borderRadius: 0.17 * u, left: -0.15 * u, top: h - 0.06 * u },
      ];
    case 'rings':
      return (['coral', 'orange', 'pink', 'violet'] as ArtHue[]).map((hue, i) => {
        const size = (0.3 + 0.22 * i) * u;
        return ring(c(hue, 1), size, w - size / 2, -size / 2, 0.7, 3);
      });
    case 'bloom': {
      const cx = 0.14 * u;
      const cy = 0.14 * u;
      const petal = (color: string, len: number, deg: number, opacity: number) => bar(color, cx, cy, len, len * 0.34, deg, opacity);
      return [
        ...[0, 45, 90, 135].map(d => petal(c('pink', 0), 0.6 * u, d, 0.55)),
        ...[22.5, 67.5, 112.5, 157.5].map(d => petal(c('violet', 0), 0.42 * u, d, 0.6)),
        disc(c('gold', 1), 0.09 * u, cx - 0.045 * u, cy - 0.045 * u, 0.95),
      ];
    }
    case 'petals': {
      const cx = w - 0.14 * u;
      const cy = h - 0.14 * u;
      return [
        ...[0, 90].map(d => bar(c('orange', 0), cx, cy, 0.5 * u, 0.2 * u, d, 0.6)),
        ...[45, 135].map(d => bar(c('coral', 0), cx, cy, 0.5 * u, 0.2 * u, d, 0.6)),
        disc(c('gold', 1), 0.08 * u, cx - 0.04 * u, cy - 0.04 * u, 0.95),
      ];
    }
    case 'bubbles':
      return Array.from({ length: 9 }, (_, i) => {
        const size = (0.06 + rand() * 0.16) * u;
        const left = w * (0.3 + rand() * 0.65) - size / 2;
        const top = h * rand() - size / 2;
        const color = c((['sky', 'teal', 'violet', 'pink'] as ArtHue[])[i % 4], (i % 3) as 0 | 1 | 2);
        return i % 2 ? ring(color, size, left, top, 0.75) : disc(color, size, left, top, 0.45);
      });
    case 'dots':
      return Array.from({ length: 20 }, (_, n) =>
        disc(c((['pink', 'orange', 'gold', 'green'] as ArtHue[])[Math.floor(n / 5)], 1), 0.03 * u, w - 0.1 * u - (n % 5) * 0.075 * u, 0.08 * u + Math.floor(n / 5) * 0.075 * u, 0.8));
    case 'confetti':
      return Array.from({ length: 16 }, (_, i) => {
        const len = (0.05 + rand() * 0.04) * u;
        return bar(c(hues[i % hues.length], (i % 3) as 0 | 1 | 2), w * rand(), Math.min(h * 0.45, 0.5 * u) * rand() + 0.03 * u, len, 0.022 * u, rand() * 180, 0.75);
      });
    case 'stripes':
      return (['coral', 'orange', 'gold', 'green', 'sky'] as ArtHue[]).map((hue, i) => bar(c(hue, 1), w - 0.3 * u, h - (0.05 + 0.1 * i) * u, 1.2 * u, 0.05 * u, -35, 0.6));
    case 'diamonds': {
      const out: ViewStyle[] = [];
      for (let r = 0; r < 4; r++) {
        for (let col = 0; col < 4 - r; col++) {
          const size = 0.1 * u;
          const hue = (['teal', 'sky', 'violet', 'pink'] as ArtHue[])[(r + col) % 4];
          out.push({ ...fill(c(hue, 1), 0.6), width: size, height: size, borderRadius: size * 0.14, left: 0.05 * u + col * 0.14 * u, top: 0.05 * u + r * 0.14 * u, transform: [{ rotate: '45deg' }] });
        }
      }
      return out;
    }
    case 'crosses': {
      const out: ViewStyle[] = [];
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 4; col++) {
          const cx = 0.08 * u + col * 0.12 * u;
          const cy = h - 0.08 * u - r * 0.12 * u;
          const color = c((['coral', 'orange', 'teal'] as ArtHue[])[(r + col) % 3], 1);
          out.push(bar(color, cx, cy, 0.06 * u, 0.016 * u, 0, 0.8), bar(color, cx, cy, 0.06 * u, 0.016 * u, 90, 0.8));
        }
      }
      return out;
    }
    case 'lines': {
      const gap = Math.max(0.14 * u, 20);
      const count = Math.min(40, Math.floor((h - 0.2 * u) / gap) + 1);
      return [
        ...Array.from({ length: count }, (_, i) => ({ ...fill(c('sky', 1), 0.45), width: w, height: 1, left: 0, top: 0.2 * u + i * gap })),
        { ...fill(c('coral', 1), 0.55), width: 1.5, height: h, left: 0.1 * u, top: 0 },
      ];
    }
    case 'grid': {
      const gap = Math.max(0.12 * u, 18);
      const cols = Math.min(60, Math.ceil(w / gap));
      const rows = Math.min(60, Math.ceil(h / gap));
      return [
        ...Array.from({ length: cols }, (_, i) => ({ ...fill(c('teal', 0), 0.5), width: 1, height: h, left: i * gap, top: 0 })),
        ...Array.from({ length: rows }, (_, i) => ({ ...fill(c('sky', 0), 0.5), width: w, height: 1, left: 0, top: i * gap })),
      ];
    }
  }
};

// base and ink: the note's fill and text colours, which opacity is checked against.
interface Props { pattern?: string | null; dark: boolean; base: string; ink: string }

// A picture the person added, under the note colour at a text-safe opacity.
const PictureBackground: React.FC<{ uri: string; base: string; ink: string }> = ({ uri, base, ink }) => {
  const image = useCachedImage(uri);
  if (image.status !== 'ready' || !image.src) return null;
  return (
    <View pointerEvents="none" style={styles.fill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Image source={{ uri: image.src }} resizeMode="cover" resizeMethod="resize" onError={image.onError} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: base, opacity: scrimAlpha(base, ink) }]} />
    </View>
  );
};

const Artwork: React.FC<Props & { pattern: NotePatternKey }> = ({ pattern, dark, base, ink }) => {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const items = useMemo(() => (size.w > 0 ? shapes(pattern, size.w, size.h, dark, base, ink) : []), [pattern, size.w, size.h, dark, base, ink]);
  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={styles.fill}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {items.map((style, i) => <View key={i} style={style} />)}
    </View>
  );
};

const NotePattern: React.FC<Props> = props =>
  isPictureBackground(props.pattern) ? <PictureBackground uri={props.pattern} base={props.base} ink={props.ink} /> : isPattern(props.pattern) ? <Artwork {...props} pattern={props.pattern} /> : null;

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
});

export default NotePattern;
