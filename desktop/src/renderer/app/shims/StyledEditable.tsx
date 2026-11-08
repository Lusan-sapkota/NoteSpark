// The note text box on the desktop when the formatter's styling should show (the phone draws the same thing with styled Text
// inside its TextInput). An editable element holding the note's text unchanged, drawn in spans: headings and bold look like
// themselves and the # and ** marks are hidden (Plain text) or faded (Markdown), but they stay in the text, so what is saved is
// exactly what was typed and there is nothing to map between what you see and what is stored.
import React from 'react';
import { type Piece, layoutSpans, markToRemove, needsFinalBreak, toCss } from './editableModel';

type Selection = { start: number; end: number };
export interface StyledEditableProps {
  text: string;
  pieces: Piece[];
  hideMarkers: boolean;
  onChangeText: (text: string) => void;
  onSelectionChange?: (e: { nativeEvent: { selection: Selection } }) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  style?: Record<string, unknown>;
  placeholder?: string;
  placeholderTextColor?: string;
  selectionColor?: string;
  accessibilityLabel?: string;
}

const STYLE_ID = 'ns-editable-style';
const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = '.ns-editable{outline:none;white-space:pre-wrap;overflow-wrap:anywhere;} .ns-editable:empty::before{content:attr(data-placeholder);color:var(--ns-placeholder);pointer-events:none;}';
  document.head.appendChild(el);
};

const StyledEditable = React.forwardRef<unknown, StyledEditableProps>((props, ref) => {
  const root = React.useRef<HTMLDivElement>(null);
  const latest = React.useRef(props);
  latest.current = props;
  const caret = React.useRef<Selection>({ start: 0, end: 0 });
  const composing = React.useRef(false);
  const pendingCaret = React.useRef<number | null>(null); // where the caret goes after a mark was removed by a key
  const drawn = React.useRef('');

  // The selection as character offsets in the text (line breaks drawn as <br> are not text, so they do not count).
  const offsets = (): Selection | null => {
    const el = root.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
    const at = (node: Node, offset: number) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.setEnd(node, offset);
      return range.toString().length;
    };
    return { start: at(r.startContainer, r.startOffset), end: at(r.endContainer, r.endOffset) };
  };

  // Puts the selection at text offsets, on visible text (a hidden mark cannot hold the caret).
  const place = (start: number, end: number) => {
    const el = root.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const find = (target: number): [Node, number] => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let last: Text | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = n.textContent?.length ?? 0;
        if ((n.parentElement as HTMLElement | null)?.dataset.h === '1') { seen += len; continue; }
        last = n as Text;
        if (target <= seen + len) return [n, Math.max(0, target - seen)];
        seen += len;
      }
      return last ? [last, last.textContent?.length ?? 0] : [el, 0];
    };
    const [a, ao] = find(start);
    const [b, bo] = start === end ? [a, ao] : find(end);
    const range = document.createRange();
    range.setStart(a, ao);
    range.setEnd(b, bo);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Draws the text: one span per run, the marks hidden or faded; keeps the caret where it was.
  const draw = () => {
    const el = root.current;
    if (!el) return;
    const { text, pieces, hideMarkers } = latest.current;
    const focused = document.activeElement === el;
    const moved = pendingCaret.current;
    pendingCaret.current = null;
    const before = moved !== null ? { start: moved, end: moved } : focused ? offsets() : null;
    const runs = pieces.map(p => p.text).join('') === text ? pieces : [{ text, css: {} }];
    const spans = layoutSpans(runs, { hideMarkers });
    const signature = JSON.stringify([spans, needsFinalBreak(text)]);
    if (signature === drawn.current && el.textContent === text && moved === null) return;
    drawn.current = signature;
    const frag = document.createDocumentFragment();
    for (const s of spans) {
      const span = document.createElement('span');
      span.textContent = s.text;
      Object.assign(span.style, s.css);
      if (s.hidden) { span.style.display = 'none'; span.dataset.h = '1'; }
      frag.appendChild(span);
    }
    if (needsFinalBreak(text)) frag.appendChild(document.createElement('br'));
    el.replaceChildren(frag);
    if (before) place(before.start, before.end);
  };

  React.useLayoutEffect(() => { ensureStyle(); }, []);
  React.useLayoutEffect(() => { if (!composing.current) draw(); });

  // The caret moved: tell the screen.
  React.useEffect(() => {
    const onSelection = () => {
      const o = document.activeElement === root.current ? offsets() : null;
      if (!o) return;
      caret.current = o;
      latest.current.onSelectionChange?.({ nativeEvent: { selection: o } });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  React.useImperativeHandle(ref, () => ({
    focus: () => root.current?.focus(),
    blur: () => root.current?.blur(),
    isFocused: () => document.activeElement === root.current,
    setSelection: (start: number, end: number) => {
      if (document.activeElement !== root.current) root.current?.focus();
      place(start, end);
      caret.current = { start, end };
    },
  }));

  const read = () => root.current?.textContent ?? '';
  const css = toCss(props.style ?? {}) as React.CSSProperties;

  return (
    <div
      ref={root}
      className="ns-editable"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={props.accessibilityLabel}
      data-placeholder={props.placeholder}
      spellCheck
      style={{ ...css, ['--ns-placeholder' as string]: props.placeholderTextColor, caretColor: props.selectionColor }}
      onInput={() => { const o = offsets(); if (o) caret.current = o; props.onChangeText(read()); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; props.onChangeText(read()); draw(); }}
      onKeyDown={e => {
        const mod = e.ctrlKey || e.metaKey;
        const o = props.hideMarkers && (e.key === 'Backspace' || e.key === 'Delete') && !e.nativeEvent.isComposing ? offsets() : null;
        const mark = o && o.start === o.end ? markToRemove(props.pieces, o.start, e.key as 'Backspace' | 'Delete') : null;
        if (mark) {
          e.preventDefault();
          pendingCaret.current = mark[0];
          props.onChangeText(props.text.slice(0, mark[0]) + props.text.slice(mark[1]));
        } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
        } else if (mod && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          (e.shiftKey ? props.onRedo : props.onUndo)?.();
        } else if (mod && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          props.onRedo?.();
        }
      }}
    />
  );
});

export default StyledEditable;
