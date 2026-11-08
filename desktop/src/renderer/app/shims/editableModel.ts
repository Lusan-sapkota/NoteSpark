// The pure part of the desktop's styled note editor: what to draw for the text, no DOM here (see StyledEditable.tsx).

// One run of the note's text with its look. `marker` runs are the # and ** marks the formatter found.
export interface Piece { text: string; css: Record<string, string | number | undefined>; marker?: boolean }
export interface Span { text: string; css: Record<string, string>; hidden: boolean }

// Numbers in these are plain; every other number in a React Native style is a length in px.
const UNITLESS = new Set(['flex', 'flexGrow', 'flexShrink', 'opacity', 'fontWeight', 'zIndex']);

// React Native style values as CSS: sizes in px, text decoration by its CSS name, nothing undefined.
export const toCss = (style: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (key === 'textDecorationLine') out.textDecoration = String(value);
    else if (typeof value === 'number') out[key] = UNITLESS.has(key) ? String(value) : `${value}px`;
    else if (typeof value === 'string') out[key] = value;
  }
  return out;
};

// Marks are shown (faded) when `hideMarkers` is off, as in the Markdown tab, and hidden in the Plain text tab.
export const layoutSpans = (pieces: Piece[], opts: { hideMarkers: boolean }): Span[] =>
  pieces.map(p => {
    const css = toCss(p.css);
    if (!p.marker) return { text: p.text, css, hidden: false };
    return { text: p.text, css: opts.hideMarkers ? css : { ...css, opacity: '0.55' }, hidden: opts.hideMarkers };
  });

// The mark a Backspace (before the caret) or Delete (after it) would reach in a hidden mark: the whole mark goes, since a
// half-deleted `**` would leave stray characters nobody can see. null when there is no mark right there.
export const markToRemove = (pieces: Piece[], caret: number, key: 'Backspace' | 'Delete'): [number, number] | null => {
  let at = 0;
  for (const p of pieces) {
    const from = at;
    at += p.text.length;
    if (!p.marker || !p.text) continue;
    if (key === 'Backspace' ? caret > from && caret <= at : caret >= from && caret < at) return [from, at];
  }
  return null;
};

// A last empty line needs something after the final newline to be drawn and to hold the caret.
export const needsFinalBreak = (text: string) => text.endsWith('\n');
