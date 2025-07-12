import React from 'react';
import { Text, TextProps } from 'react-native';

interface SafeTextProps extends TextProps {
  children: any;
}

const SafeText: React.FC<SafeTextProps> = ({ children, ...props }) => {
  let text = '';
  if (Array.isArray(children)) {
    text = children.join('\n');
  } else if (typeof children === 'string') {
    text = children;
  } else if (children != null) {
    text = String(children);
  }
  return <Text {...props}>{text}</Text>;
};

export default SafeText;
