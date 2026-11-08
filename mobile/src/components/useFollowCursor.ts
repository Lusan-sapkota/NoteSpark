import React, { useCallback, useEffect, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, PixelRatio, TextInput, useWindowDimensions } from 'react-native';

// Keeps the cursor of a text box that does not scroll itself (it grows inside a ScrollView) above the keyboard and `reserve`
// (the toolbar). The keyboard library's own auto-scroll is off because it made the keyboard open and close in a loop.
// shortcut: the cursor's place is estimated from the text (wrapped rows guessed by characters per row); exact enough to
// keep it in view, upgrade only if it drifts on very long wrapped lines.
export function useFollowCursor(opts: {
  input: React.RefObject<React.ComponentRef<typeof TextInput> | null>;
  scroll: React.RefObject<{ scrollTo: (o: { y: number; animated: boolean }) => void; scrollToEnd: () => void } | null>;
  text: string;
  cursor: number;
  keyboardHeight: number;
  reserve: number;
  charWidth: number;
}) {
  const { input, scroll, text, cursor, keyboardHeight, reserve } = opts;
  // Larger system text means fewer characters per row.
  const charWidth = opts.charWidth * PixelRatio.getFontScale();
  const offset = useRef(0);
  const windowHeight = useWindowDimensions().height;
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; }, []);

  // At the end of the text the box's size change scrolls to the end; elsewhere (a tap, the keyboard opening, typing in the middle) the cursor's
  // row is scrolled into view only when it would be hidden by the keyboard or the toolbar.
  const onContentSizeChange = useCallback(() => {
    if (input.current?.isFocused() && cursor >= text.length) scroll.current?.scrollToEnd();
  }, [cursor, text.length]);

  useEffect(() => {
    if (!keyboardHeight || !input.current?.isFocused()) return;
    const timer = setTimeout(() => {
      input.current?.measureInWindow((_x, top, width, height) => {
        const perRow = Math.max(1, Math.floor(width / charWidth));
        const rows = (s: string) => s.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perRow)), 0);
        const total = rows(text);
        const before = rows(text.slice(0, cursor));
        const rowHeight = height / total;
        const caretBottom = top + before * rowHeight;
        const visibleBottom = windowHeight - keyboardHeight - reserve;
        if (caretBottom > visibleBottom) scroll.current?.scrollTo({ y: offset.current + caretBottom - visibleBottom + rowHeight, animated: false });
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [cursor, keyboardHeight, reserve, text.length]);

  // A tap in the empty space beside the box: focus it and put the cursor at the end of the line at that height (end of text if below it).
  const tapAt = useCallback((pageX: number, pageY: number) => {
    input.current?.measureInWindow((left, top, width, height) => {
      // A click on the box itself (the web bubbles it up to here) is the box's own business.
      if (pageY < top || (pageX >= left && pageX <= left + width && pageY <= top + height)) return;
      const perRow = Math.max(1, Math.floor(width / charWidth));
      const lines = text.split('\n');
      const rowsOf = (line: string) => Math.max(1, Math.ceil(line.length / perRow));
      const total = lines.reduce((n, line) => n + rowsOf(line), 0);
      let row = Math.floor((pageY - top) / (height / total));
      let end = 0;
      for (let i = 0; i < lines.length; i++) {
        end += lines[i].length;
        row -= rowsOf(lines[i]);
        if (row < 0) break;
        end += 1;
      }
      const at = Math.min(end, text.length);
      // Place the cursor before focusing: focusing first shows it at the top for a moment (the desktop's setSelection focuses by itself).
      input.current?.setSelection(at, at);
      input.current?.focus();
      setTimeout(() => input.current?.setSelection(at, at), 50); // the phone can reset it while focusing
    });
  }, [text]);

  return { onScroll, onContentSizeChange, tapAt };
}
