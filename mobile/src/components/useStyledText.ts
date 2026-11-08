import { useEffect, useMemo } from 'react';
import { findNodeHandle, Platform, processColor, StyleSheet, TextInput } from 'react-native';
import { parseFormatted } from '@notespark/core';
import { applyStyledRuns } from '../../modules/styled-text';

// Headings, bold, italic and strikethrough in a note's text box, the same pieces on every platform.
// Android: styled in place with spans on the box's own text (modules/styled-text), so the text is never set again (that flickered).
// Desktop and web: `webProps` go to the text box the desktop draws itself (StyledEditable). Marks: hidden in Plain text, faded otherwise.
export function useStyledText(opts: {
  text: string;
  hideMarks: boolean;
  input: React.RefObject<React.ComponentRef<typeof TextInput> | null>;
  fonts: { noteH1: any; noteH2: any; noteH3: any; noteTitle: any };
  markColor: string;
}) {
  const { text, hideMarks, input, fonts, markColor } = opts;
  const runs = useMemo(() => parseFormatted(text).map(tok => {
    const headFont = tok.heading === 1 ? fonts.noteH1 : tok.heading === 2 ? fonts.noteH2 : tok.heading === 3 ? fonts.noteH3 : null;
    const look = [
      headFont ?? (tok.bold ? { fontFamily: fonts.noteTitle.fontFamily } : tok.italic ? { fontFamily: 'Literata-Italic' } : null),
      tok.bold && tok.italic ? { fontStyle: 'italic' as const } : null,
      tok.strike ? { textDecorationLine: 'line-through' as const } : null,
    ];
    return { tok, look };
  }), [text, fonts]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const tag = findNodeHandle(input.current);
    if (!tag) return;
    let at = 0;
    const spans = runs.map(({ tok }) => {
      const start = at;
      at += tok.text.length;
      return { start, end: at, bold: !!tok.bold, italic: !!tok.italic, strike: !!tok.strike, heading: tok.heading ?? 0, marker: !!tok.marker };
    });
    const faded = /^#[0-9a-fA-F]{6}$/.test(markColor) ? `${markColor}8c` : markColor;
    applyStyledRuns(tag, text.length, spans, {
      hideMarks,
      markColor: Number(processColor(faded) ?? 0),
      boldFamily: fonts.noteTitle.fontFamily ?? '',
      italicFamily: 'Literata-Italic',
      headingFamily: fonts.noteH1.fontFamily ?? '',
      h1: Number(fonts.noteH1.fontSize ?? 0),
      h2: Number(fonts.noteH2.fontSize ?? 0),
      h3: Number(fonts.noteH3.fontSize ?? 0),
    });
  }, [runs, text, hideMarks, markColor, fonts]);

  const webProps = Platform.OS === 'web'
    ? {
        styledText: text,
        styledPieces: runs.map(({ tok, look }) => ({ text: tok.text, css: StyleSheet.flatten([look, tok.marker ? { color: markColor } : null]) as Record<string, string | number>, marker: !!tok.marker })),
        hideMarkers: hideMarks,
      }
    : {};
  return { webProps };
}
