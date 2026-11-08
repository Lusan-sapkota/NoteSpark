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
  editable?: boolean;
}

const STYLE_ID = 'ns-editable-style';
const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = '.ns-editable{outline:none;white-space:pre-wrap;overflow-wrap:anywhere;} .ns-editable:empty::before{content:attr(data-placeholder);color:var(--ns-placeholder);pointer-events:none;}';
  document.head.appendChild(el);
};

// The text a node holds. Chromium may draw a line break it was asked to insert as a <br> rather than as "\n", so a <br> counts as
// one newline; the one this component puts after a final newline (data-end) is only there to give that empty line a height.
const lengthOf = (node: Node): number => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === 'BR') return (node as HTMLElement).dataset.end === '1' ? 0 : 1;
  let n = 0;
  node.childNodes.forEach(c => { n += lengthOf(c); });
  return n;
};
const readText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return (node as HTMLElement).dataset.end === '1' ? '' : '\n';
  let out = '';
  node.childNodes.forEach(c => { out += readText(c); });
  return out;
};
// How much text comes before a DOM position (node, offset) inside root.
const textBefore = (root: Node, node: Node, offset: number): number => {
  let total = 0;
  let found = false;
  const visit = (cur: Node) => {
    if (found) return;
    if (cur === node) {
      if (cur.nodeType === Node.TEXT_NODE) total += offset;
      else for (let i = 0; i < offset; i++) total += lengthOf(cur.childNodes[i]);
      found = true;
      return;
    }
    if (cur.nodeType === Node.TEXT_NODE || cur.nodeName === 'BR') { total += lengthOf(cur); return; }
    cur.childNodes.forEach(visit);
  };
  visit(root);
  return total;
};
// Scroll positions of the element's scrolling ancestors, to put back after the text is redrawn (a redraw must not move the page).
const scrollState = (el: HTMLElement) => {
  const saved: [HTMLElement, number][] = [];
  for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollTop > 0) saved.push([p, p.scrollTop]);
  return () => saved.forEach(([p, top]) => { p.scrollTop = top; });
};

// Scrolls the nearest scrolling ancestor just enough to keep the caret on screen (typing and Enter are made here, not by the
// browser, so the browser does not do this for us).
const revealCaret = (el: HTMLElement, atEnd: boolean) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const brk = el.querySelector('br[data-end="1"]');
  const node = range.startContainer;
  const box = (range.getClientRects()[0] ?? (atEnd && brk ? brk.getBoundingClientRect() : (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.getBoundingClientRect())) as DOMRect | undefined;
  if (!box) return;
  let parent = el.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  if (!parent) return;
  const view = parent.getBoundingClientRect();
  const pad = 24;
  if (box.bottom > view.bottom - pad) parent.scrollTop += box.bottom - view.bottom + pad;
  else if (box.top < view.top + pad) parent.scrollTop -= view.top + pad - box.top;
};

const StyledEditable = React.forwardRef<unknown, StyledEditableProps>((props, ref) => {
  const root = React.useRef<HTMLDivElement>(null);
  const latest = React.useRef(props);
  const editRef = React.useRef<(insert: string) => void>(() => {});
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
    const at = (node: Node, offset: number) => textBefore(el, node, offset);
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
        const span = n.parentElement as HTMLElement | null;
        if (span?.dataset.h === '1') {
          // At the end of a hidden mark (or inside it) the caret goes just after it, so the next letter lands outside the mark.
          if (target > seen && target <= seen + len && span.parentNode) return [span.parentNode, Array.prototype.indexOf.call(span.parentNode.childNodes, span) + 1];
          seen += len;
          continue;
        }
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
    const restoreScroll = scrollState(el);
    const moved = pendingCaret.current;
    pendingCaret.current = null;
    const before = moved !== null ? { start: moved, end: moved } : focused ? offsets() : null;
    const runs = pieces.map(p => p.text).join('') === text ? pieces : [{ text, css: {} }];
    const spans = layoutSpans(runs, { hideMarkers });
    const signature = JSON.stringify([spans, needsFinalBreak(text)]);
    if (signature === drawn.current && readText(el) === text && moved === null) return;
    drawn.current = signature;
    const frag = document.createDocumentFragment();
    for (const s of spans) {
      const span = document.createElement('span');
      span.textContent = s.text;
      Object.assign(span.style, s.css);
      if (s.hidden) { span.style.display = 'none'; span.dataset.h = '1'; }
      frag.appendChild(span);
    }
    if (needsFinalBreak(text)) {
      const end = document.createElement('br');
      end.dataset.end = '1';
      frag.appendChild(end);
    }
    el.replaceChildren(frag);
    if (before) place(before.start, before.end);
    restoreScroll();
    if (before && focused) revealCaret(el, before.end >= text.length);
  };

  React.useLayoutEffect(() => { ensureStyle(); }, []);
  React.useLayoutEffect(() => { if (!composing.current) draw(); });

  // Typing, line breaks and pastes are handled here, before the browser makes <div> or <br> out of them (React's onBeforeInput is not this event).
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onBefore = (e: Event) => {
      const ev = e as InputEvent;
      if (ev.inputType === 'insertParagraph' || ev.inputType === 'insertLineBreak') { ev.preventDefault(); editRef.current('\n'); }
      else if (ev.inputType === 'insertText' && !ev.isComposing && typeof ev.data === 'string') {
        // Typed letters too: the browser would put them in the nearest visible text, which is inside a mark's styled word
        // when the caret sits after a hidden mark.
        ev.preventDefault();
        editRef.current(ev.data);
      } else if (ev.inputType === 'insertFromPaste' || ev.inputType === 'insertFromDrop') {
        ev.preventDefault();
        editRef.current((ev.data ?? ev.dataTransfer?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n'));
      }
    };
    el.addEventListener('beforeinput', onBefore);
    return () => el.removeEventListener('beforeinput', onBefore);
  }, []);

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
    measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) => {
      const r = root.current?.getBoundingClientRect();
      if (r) done(r.left, r.top, r.width, r.height);
    },
    setSelection: (start: number, end: number) => {
      if (document.activeElement !== root.current) root.current?.focus();
      place(start, end);
      caret.current = { start, end };
    },
  }));

  // A change made here rather than by the browser: replaces [start, end) of the text and puts the caret after the new text. Line
  // breaks and pastes go through this, because the browser draws them as <div> or <br> and not as characters in the text.
  const edit = (insert: string) => {
    const el = root.current;
    const o = offsets();
    if (!el || !o) return;
    const text = readText(el);
    const next = text.slice(0, o.start) + insert + text.slice(o.end);
    if (next === text) return;
    pendingCaret.current = o.start + insert.length;
    props.onChangeText(next);
  };

  editRef.current = edit;

  const read = () => (root.current ? readText(root.current) : '');
  const css = toCss(props.style ?? {}) as React.CSSProperties;

  return (
    <div
      ref={root}
      className="ns-editable"
      contentEditable={props.editable === false ? false : 'plaintext-only'}
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
