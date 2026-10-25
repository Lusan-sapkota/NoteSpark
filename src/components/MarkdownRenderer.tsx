import React from 'react';
import { View, Text } from 'react-native';
import Markdown, { ASTNode, renderRules } from 'react-native-markdown-display';
import { useAlert } from './DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { shape } from '../theme/theme';
import NoteImages from './NoteImages';
import TaskRow from './TaskRow';
import { findTaskLines, mapTaskLines, splitDue } from '../utils/tasks';
import { noteLinkPattern } from '../utils/noteLinks';

const firstText = (node: ASTNode): string => (node.children?.length ? firstText(node.children[0]) : node.content ?? '');

// Invisible markers on task lines: they find task items while rendering and are stripped from the text.
const OPEN = '\u2063';
const DONE = '\u2064';
const markers = /[\u2063\u2064]/g;

interface MarkdownRendererProps {
  content: string;
  // Gets the task's index in findTaskLines order. Without it, boxes are display-only.
  onToggleTask?: (index: number) => void;
  // Opens a [[Note title]] link. Without it, those links are plain text.
  onOpenNoteLink?: (title: string) => void;
}

// [[Title]] becomes a Markdown link on this made-up scheme, which renderLink hands to onOpenNoteLink.
// ponytail: also rewritten inside code blocks; skip fenced code if that ever matters.
const NOTE_LINK = 'notespark-note:';

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onToggleTask, onOpenNoteLink }) => {
  const { theme } = useTheme();
  const alert = useAlert();

  // Replace <br> tags with newlines so markdown treats them as line breaks
  const tasks = findTaskLines(content);
  // Task markers first, while line numbers still match the note.
  const processedContent = mapTaskLines(content, (t, lead) => `${lead}${t.done ? DONE : OPEN}${splitDue(t.text).text}`)
    .replace(/<br\s*\/?>(?![^<]*<br)/gi, '\n')
    .replace(noteLinkPattern, (whole, title: string) =>
      onOpenNoteLink ? `[${title.trim()}](${NOTE_LINK}${encodeURIComponent(title.trim())})` : whole);

  // Rules run in document order and body renders last, so task items are numbered as they render.
  // ponytail: a task line that doesn't render as a list item (indented code block) shifts later numbers; the write
  // then fails its line check instead of ticking the wrong box.
  let taskIndex = 0;

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

  const renderLink = (props: any) => {
    const { children, href } = props;
    const noteTitle = typeof href === 'string' && href.startsWith(NOTE_LINK) ? decodeURIComponent(href.slice(NOTE_LINK.length)) : null;
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
          if (noteTitle !== null) {
            onOpenNoteLink?.(noteTitle);
            return;
          }
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
          // Same cached, retryable image view the screens use.
          image: (node) => <NoteImages key={node.key} uris={node.attributes.src ? [node.attributes.src] : []} />,
          link: (node, children, parent, styles) => renderLink({ ...node.attributes, children }),
          body: (node, children, parent, styles) => {
            taskIndex = 0;
            return renderRules.body!(node, children, parent, styles);
          },
          text: (node, children, parent, styles, inheritedStyles = {}) => (
            <Text key={node.key} style={[inheritedStyles, styles.text, node.content.startsWith(DONE) && { textDecorationLine: 'line-through' as const }]}>
              {node.content.replace(markers, '')}
            </Text>
          ),
          list_item: (node, children, parent, styles, inheritedStyles) => {
            const marker = firstText(node)[0];
            if (marker !== OPEN && marker !== DONE) return renderRules.list_item!(node, children, parent, styles, inheritedStyles);
            const index = taskIndex++;
            return (
              <TaskRow
                key={node.key}
                done={marker === DONE}
                due={tasks[index] && splitDue(tasks[index].text).due}
                every={tasks[index] && splitDue(tasks[index].text).every}
                onPress={onToggleTask && (() => onToggleTask(index))}
              >
                {children}
              </TaskRow>
            );
          },
        }}
      >
        {processedContent}
      </Markdown>
    </View>
  );
};

export default MarkdownRenderer; 