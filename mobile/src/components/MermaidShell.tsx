import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';

// What a Mermaid block looks like around the drawn diagram (phone and desktop): the diagram, a button for
// its source, and on a mistake the source with a one-line reason. The note view never crashes on a bad diagram.
const MermaidShell: React.FC<{ code: string; mistake: string | null; children?: React.ReactNode }> = ({ code, mistake, children }) => {
  const { theme } = useTheme();
  const [source, setSource] = useState(false);
  const showSource = source || mistake !== null;
  return (
    <View style={styles.block}>
      {mistake !== null && (
        <Text variant="bodyMedium" style={{ color: theme.colors.error }}>This diagram has a mistake: {mistake}</Text>
      )}
      {showSource ? (
        <Text selectable style={[theme.fonts.noteCode, styles.source, { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceContainerHigh }]}>
          {code}
        </Text>
      ) : (
        <View accessible accessibilityLabel="Diagram">{children}</View>
      )}
      {mistake === null && (
        <Button compact icon={source ? 'chart-timeline-variant' : 'code-tags'} onPress={() => setSource(s => !s)} style={styles.toggle}>
          {source ? 'Show diagram' : 'Show source'}
        </Button>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  block: { marginVertical: space.sm },
  source: { borderRadius: shape.small, padding: space.md, marginVertical: space.sm },
  toggle: { alignSelf: 'flex-start' },
});

export default MermaidShell;
