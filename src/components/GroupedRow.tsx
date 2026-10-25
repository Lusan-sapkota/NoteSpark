import React from 'react';
import { StyleSheet, View } from 'react-native';
import { List } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { groupCorners } from '../theme/theme';

interface GroupedRowProps {
  title: string;
  description?: string;
  icon?: string;
  left?: React.ReactNode; // replaces the icon, e.g. a profile's avatar
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
  isFirst: boolean;
  isLast: boolean;
}

// One row of an M3 segmented list: rows share a tonal group with large outer and small inner corners.
const GroupedRow: React.FC<GroupedRowProps> = ({ title, description, icon, left, right, onPress, disabled, danger, isFirst, isLast }) => {
  const { theme } = useTheme();
  const color = danger ? theme.colors.error : theme.colors.onSurfaceVariant;
  return (
    <View
      style={[
        styles.row,
        groupCorners(isFirst, isLast),
        { backgroundColor: theme.colors.surfaceContainerLow },
        !isLast && styles.gap,
      ]}
    >
      <List.Item
        title={title}
        description={description}
        titleNumberOfLines={2}
        descriptionNumberOfLines={3}
        titleStyle={danger && { color: theme.colors.error }}
        left={left ? props => <View style={[props.style, styles.left]}>{left}</View> : icon ? props => <List.Icon {...props} icon={icon} color={color} /> : undefined}
        right={right ? () => right : undefined}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={onPress ? 'button' : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    overflow: 'hidden',
  },
  gap: {
    marginBottom: 2,
  },
  left: {
    justifyContent: 'center',
  },
});

export default GroupedRow;
