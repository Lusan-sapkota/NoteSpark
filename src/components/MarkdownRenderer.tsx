import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../theme/ThemeContext';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const { theme } = useTheme();

  // Define markdown styles based on the current theme
  const markdownStyles = {
    body: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 24,
    },
    heading1: {
      color: theme.colors.primary,
      fontSize: 28,
      marginTop: 16,
      marginBottom: 8,
      fontWeight: '700' as const,
    },
    heading2: {
      color: theme.colors.primary,
      fontSize: 24,
      marginTop: 16,
      marginBottom: 8,
      fontWeight: '700' as const,
    },
    heading3: {
      color: theme.colors.primary,
      fontSize: 20,
      marginTop: 16,
      marginBottom: 8,
      fontWeight: '700' as const,
    },
    heading4: {
      color: theme.colors.primary,
      fontSize: 18,
      marginTop: 16,
      marginBottom: 8,
      fontWeight: '700' as const,
    },
    heading5: {
      color: theme.colors.primary,
      fontSize: 16,
      marginTop: 12,
      marginBottom: 6,
      fontWeight: '700' as const,
    },
    heading6: {
      color: theme.colors.primary,
      fontSize: 14,
      marginTop: 12,
      marginBottom: 6,
      fontWeight: '700' as const,
    },
    hr: {
      backgroundColor: theme.colors.text,
      height: 1,
      marginTop: 16,
      marginBottom: 16,
    },
    strong: {
      fontWeight: '700' as const,
    },
    em: {
      fontStyle: 'italic' as const,
    },
    blockquote: {
      backgroundColor: theme.colors.background,
      borderLeftColor: theme.colors.accent,
      borderLeftWidth: 4,
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 8,
      paddingBottom: 8,
      marginTop: 8,
      marginBottom: 8,
    },
    bullet_list: {
      marginTop: 8,
      marginBottom: 8,
    },
    ordered_list: {
      marginTop: 8,
      marginBottom: 8,
    },
    list_item: {
      flexDirection: 'row' as const,
      marginBottom: 4,
    },
    code_inline: {
      backgroundColor: theme.colors.background,
      color: theme.colors.accent,
      fontFamily: 'monospace',
      padding: 4,
      borderRadius: 4,
    },
    code_block: {
      backgroundColor: theme.colors.background,
      color: theme.colors.accent,
      fontFamily: 'monospace',
      padding: 8,
      borderRadius: 4,
      marginTop: 8,
      marginBottom: 8,
    },
    link: {
      color: theme.colors.accent,
      textDecorationLine: 'underline' as const,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.colors.text,
      marginTop: 8,
      marginBottom: 8,
    },
    thead: {
      backgroundColor: theme.colors.background,
    },
    th: {
      padding: 8,
      borderWidth: 1,
      borderColor: theme.colors.text,
    },
    td: {
      padding: 8,
      borderWidth: 1,
      borderColor: theme.colors.text,
    },
  };

  return (
    <ScrollView style={styles.container}>
      <Markdown style={markdownStyles}>{content}</Markdown>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
});

export default MarkdownRenderer; 