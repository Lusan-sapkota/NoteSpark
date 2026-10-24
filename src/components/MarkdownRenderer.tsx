import React from 'react';
import { View, Image, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useAlert } from './DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { shape } from '../theme/theme';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const { theme } = useTheme();
  const alert = useAlert();

  // Replace <br> tags with newlines so markdown treats them as line breaks
  const processedContent = content.replace(/<br\s*\/?>(?![^<]*<br)/gi, '\n');

  const f = theme.fonts;
  const heading = (font: typeof f.noteH1) => ({
    ...font,
    color: theme.colors.onSurface,
    marginTop: 16,
    marginBottom: 8,
  });
  const codeBox = {
    ...f.noteCode,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceContainerHigh,
    borderWidth: 0,
    borderRadius: shape.small,
    padding: 12,
    marginVertical: 8,
  };

  const markdownStyles = {
    body: {
      ...f.noteBody,
      color: theme.colors.onSurface,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 12,
    },
    heading1: heading(f.noteH1),
    heading2: heading(f.noteH2),
    heading3: heading(f.noteH3),
    heading4: heading({ ...f.noteBody, fontFamily: f.noteH3.fontFamily }),
    heading5: heading({ ...f.noteBody, fontFamily: f.noteH3.fontFamily }),
    heading6: heading({ ...f.noteBody, fontFamily: f.noteH3.fontFamily }),
    hr: {
      backgroundColor: theme.colors.outlineVariant,
      height: 1,
      marginVertical: 16,
    },
    // Separate font files per style; fontWeight/fontStyle stay normal to avoid synthetic bold.
    strong: {
      fontFamily: f.noteH1.fontFamily,
      fontWeight: '400' as const,
    },
    em: {
      fontFamily: 'Literata-Italic',
      fontStyle: 'normal' as const,
    },
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftColor: theme.colors.tertiary,
      borderLeftWidth: 4,
      paddingLeft: 16,
      paddingVertical: 4,
      marginVertical: 8,
      marginLeft: 0,
    },
    bullet_list: {
      marginBottom: 12,
    },
    ordered_list: {
      marginBottom: 12,
    },
    bullet_list_icon: {
      color: theme.colors.onSurfaceVariant,
    },
    ordered_list_icon: {
      color: theme.colors.onSurfaceVariant,
    },
    code_inline: {
      ...f.noteCode,
      lineHeight: undefined,
      color: theme.colors.onSurface,
      backgroundColor: theme.colors.surfaceContainerHigh,
      borderWidth: 0,
      borderRadius: shape.extraSmall,
      paddingHorizontal: 4,
    },
    code_block: codeBox,
    fence: codeBox,
    link: {
      color: theme.colors.primary,
      textDecorationLine: 'underline' as const,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      borderRadius: shape.small,
      marginVertical: 8,
    },
    thead: {
      backgroundColor: theme.colors.surfaceContainer,
    },
    th: {
      padding: 8,
      borderColor: theme.colors.outlineVariant,
    },
    tr: {
      borderColor: theme.colors.outlineVariant,
    },
    td: {
      padding: 8,
      borderColor: theme.colors.outlineVariant,
    },
  };

  const trimImagePath = (path: string) => {
    if (!path) return '';
    if (path.startsWith('file:///')) {
      const parts = path.split('/');
      const fileName = parts[parts.length - 1];
      return `Image on this device (${fileName})`;
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
          style={{ width: '100%', height: 200, resizeMode: 'contain', marginTop: 8, borderRadius: shape.small, backgroundColor: theme.colors.surfaceContainer }}
          accessibilityLabel={alt || 'image'}
        />
        <Text key={`image-label-${src}`} style={{ ...theme.fonts.bodySmall, color: theme.colors.onSurfaceVariant, marginTop: 4, marginBottom: 12 }}>
          {trimImagePath(src)}
        </Text>
      </>
    );
  };

  const renderLink = (props: any) => {
    const { children, href } = props;
    let url = href;
    let openUrl = url;
    if (!/^https?:\/\//.test(url)) {
      openUrl = `https://${url}`;
    }
    let renderChildren;
    if (Array.isArray(children)) {
      renderChildren = children.filter(child => child !== null && child !== undefined).map((child, idx) => {
        const uniqueKey = `link-child-${idx}-${typeof child === 'string' ? child.slice(0, 16) : ''}`;
        if (typeof child === 'string' || typeof child === 'number') {
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
        style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
        onPress={() => {
          alert(
            'Open link?',
            `This opens ${url} in your browser.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open link', style: 'default', onPress: () => {
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
    <View>
      <Markdown
        style={markdownStyles}
        rules={{
          image: (node, children, parent, styles) => renderImage(node.attributes),
          link: (node, children, parent, styles) => renderLink({ ...node.attributes, children }),
        }}
      >
        {processedContent}
      </Markdown>
    </View>
  );
};

export default MarkdownRenderer; 