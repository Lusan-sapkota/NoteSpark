import React from 'react';
import { StyleSheet, ScrollView, Image, Alert, Linking, TouchableOpacity, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../theme/ThemeContext';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const { theme } = useTheme();

  // Replace <br> tags with newlines so markdown treats them as line breaks
  const processedContent = content.replace(/<br\s*\/?>(?![^<]*<br)/gi, '\n');

  // Define markdown styles based on the current theme
  const markdownStyles = {
    body: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 18,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    heading1: {
      color: theme.colors.primary,
      fontSize: 20,
      lineHeight: 28, // Increased for better vertical alignment
      marginTop: 8,
      marginBottom: 4,
      fontWeight: '700' as const,
      includeFontPadding: false,
      textAlignVertical: 'center',
      // Removed marginVertical for heading1
    },
    heading2: {
      color: theme.colors.primary,
      fontSize: 18,
      lineHeight: 18,
      marginTop: 8,
      marginBottom: 4,
      fontWeight: '700' as const,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    heading3: {
      color: theme.colors.primary,
      fontSize: 17,
      lineHeight: 18,
      marginTop: 8,
      marginBottom: 4,
      fontWeight: '700' as const,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    heading4: {
      color: theme.colors.primary,
      fontSize: 16,
      lineHeight: 18,
      marginTop: 8,
      marginBottom: 4,
      fontWeight: '700' as const,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    heading5: {
      color: theme.colors.primary,
      fontSize: 16,
      lineHeight: 18,
      marginTop: 6,
      marginBottom: 2,
      fontWeight: '700' as const,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    heading6: {
      color: theme.colors.primary,
      fontSize: 15,
      lineHeight: 18,
      marginTop: 6,
      marginBottom: 2,
      fontWeight: '700' as const,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    hr: {
      backgroundColor: theme.colors.text,
      height: 1,
      marginTop: 8,
      marginBottom: 8,
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
      marginTop: 4,
      marginBottom: 4,
    },
    ordered_list: {
      marginTop: 4,
      marginBottom: 4,
    },
    list_item: {
      flexDirection: 'row' as const,
      marginBottom: 2,
    },
    code_inline: {
      backgroundColor: theme.colors.background,
      color: theme.colors.accent,
      fontFamily: 'monospace',
      padding: 4,
      borderRadius: 4,
      fontSize: 15,
      lineHeight: 18,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    code_block: {
      backgroundColor: theme.colors.background,
      color: theme.colors.accent,
      fontFamily: 'monospace',
      padding: 8,
      borderRadius: 4,
      marginTop: 8,
      marginBottom: 8,
      fontSize: 15,
      lineHeight: 18,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    link: {
      color: theme.colors.primary,
      textDecorationLine: 'underline' as const,
      fontSize: 16,
      lineHeight: 18,
      includeFontPadding: false,
      textAlignVertical: 'center',
      marginVertical: -2,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.colors.text,
      marginTop: 4,
      marginBottom: 4,
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

  // Custom renderer for images
  const trimImagePath = (path: string) => {
    if (!path) return '';
    // If file path is long, trim and show friendly label
    if (path.startsWith('file:///')) {
      const parts = path.split('/');
      const fileName = parts[parts.length - 1];
      return `Local Image (${fileName})`;
    }
    if (path.length > 32) {
      return path.slice(0, 12) + '...' + path.slice(-12);
    }
    return path;
  };

  const renderImage = (props: any) => {
    const { src, alt } = props;
    if (!src) return null;
    return (
      <>
        <Image
          source={{ uri: src }}
          style={{ width: '100%', height: 200, resizeMode: 'contain', marginVertical: 8, borderRadius: 8, backgroundColor: theme.colors.surface }}
          accessibilityLabel={alt || 'image'}
        />
        <Text key={`image-label-${src}`} style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2, marginBottom: 8, textAlign: 'center' }}>
          {trimImagePath(src)}
        </Text>
      </>
    );
  };

  // Custom renderer for links
  const renderLink = (props: any) => {
    const { children, href } = props;
    let url = href;
    let openUrl = url;
    // Add protocol if missing for www.* or domain.tld
    if (!/^https?:\/\//.test(url)) {
      openUrl = `https://${url}`;
    }
    // Only allow string or valid React elements as children
    let renderChildren;
    if (Array.isArray(children)) {
      renderChildren = children.filter(child => child !== null && child !== undefined).map((child, idx) => {
        const uniqueKey = `link-child-${idx}-${typeof child === 'string' ? child.slice(0, 16) : ''}`;
        if (typeof child === 'string' || typeof child === 'number') {
          // For strings/numbers, wrap in Fragment with key
          return <React.Fragment key={uniqueKey}>{child}</React.Fragment>;
        } else if (React.isValidElement(child)) {
          return React.cloneElement(child, { key: uniqueKey });
        } else {
          return <React.Fragment key={uniqueKey}>{String(child)}</React.Fragment>;
        }
      });
    } else if (typeof children === 'string' || typeof children === 'number') {
      renderChildren = children;
    } else if (React.isValidElement(children)) {
      renderChildren = children;
    } else if (children == null) {
      renderChildren = null;
    } else {
      renderChildren = String(children);
    }
    return (
      <Text
        style={{
          color: theme.colors.primary,
          textDecorationLine: 'underline',
          fontSize: 16,
          lineHeight: 18,
          includeFontPadding: false,
          textAlignVertical: 'center',
          marginVertical: -2,
        }}
        onPress={() => {
          Alert.alert(
            'Open Link',
            `Are you sure you want to open this link in your browser?\n${url}`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open', style: 'default', onPress: () => {
                try {
                  require('react-native').Linking.openURL(openUrl);
                } catch {}
              }}
            ]
          );
        }}
      >
        {renderChildren}
      </Text>
    );
  };

  return (
    <ScrollView style={[styles.container, { padding: 0 }]}> {/* Remove extra padding for tighter look */}
      <Markdown
        style={markdownStyles}
        rules={{
          image: (node, children, parent, styles) => renderImage(node.attributes),
          link: (node, children, parent, styles) => renderLink({ ...node.attributes, children }),
        }}
      >
        {processedContent}
      </Markdown>
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