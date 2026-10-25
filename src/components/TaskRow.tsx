import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { shape, space } from '../theme/theme';
import { dueLabel, today } from '../utils/tasks';

interface TaskRowProps {
  done: boolean;
  due?: string;
  onPress?: () => void;
  children: React.ReactNode;
}

// A checkbox line in a note. The whole row ticks it.
const TaskRow: React.FC<TaskRowProps> = ({ done, due, onPress, children }) => {
  const { theme } = useTheme();
  const overdue = !done && !!due && due < today();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.surfaceContainerHigh }]}
    >
      <View style={styles.box}>
        <Icon
          source={done ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={done ? theme.colors.onSurfaceVariant : theme.colors.onSurface}
        />
      </View>
      <View style={[styles.content, done && styles.done]}>
        {children}
        {!!due && (
          <View style={[styles.due, { backgroundColor: overdue ? theme.colors.errorContainer : theme.colors.surfaceContainerHigh }]}>
            <Icon source="calendar-blank-outline" size={14} color={overdue ? theme.colors.onErrorContainer : theme.colors.onSurfaceVariant} />
            <Text
              variant="labelMedium"
              maxFontSizeMultiplier={1.5}
              style={{ color: overdue ? theme.colors.onErrorContainer : theme.colors.onSurfaceVariant }}
            >
              {done ? dueLabel(due).replace('Overdue, due', 'Due') : dueLabel(due)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 48,
    borderRadius: shape.small,
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  box: {
    height: 28,
    justifyContent: 'center',
    marginTop: 8,
    marginRight: space.md,
  },
  content: {
    flex: 1,
    paddingVertical: 8,
  },
  done: {
    opacity: 0.6,
  },
  due: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    borderRadius: shape.small,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    marginTop: space.xs,
  },
});

export default TaskRow;
