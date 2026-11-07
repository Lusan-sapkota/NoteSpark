// Bold, italic, strike and # headings as Markdown marks; the token texts always join back to the input.
export interface FormatToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  heading?: 1 | 2 | 3;
  marker?: boolean; // the ** ~~ _ or # itself
}

type Style = Pick<FormatToken, 'bold' | 'italic' | 'strike' | 'heading'>;

// `_` needs a word edge; a mark must touch non-space text on both sides.
const parseInline = (s: string, style: Style = {}): FormatToken[] => {
  const out: FormatToken[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ text: plain, ...style });
    plain = '';
  };
  let i = 0;
  while (i < s.length) {
    const mark = s.startsWith('**', i) ? '**' : s.startsWith('~~', i) ? '~~' : s[i] === '_' && (i === 0 || !/\w/.test(s[i - 1])) ? '_' : null;
    if (mark) {
      const start = i + mark.length;
      let end = -1;
      if (start < s.length && !/\s/.test(s[start])) {
        for (let j = s.indexOf(mark, start + 1); j !== -1; j = s.indexOf(mark, j + 1)) {
          if (!/\s/.test(s[j - 1]) && (mark !== '_' || j + 1 >= s.length || !/\w/.test(s[j + 1]))) {
            end = j;
            break;
          }
        }
      }
      if (end > start) {
        flush();
        const inner: Style = { ...style, ...(mark === '**' ? { bold: true } : mark === '~~' ? { strike: true } : { italic: true }) };
        out.push({ text: mark, ...style, marker: true }, ...parseInline(s.slice(start, end), inner), { text: mark, ...style, marker: true });
        i = end + mark.length;
        continue;
      }
    }
    plain += s[i++];
  }
  flush();
  return out;
};

export const headingOf = (line: string): { level: 1 | 2 | 3; prefix: string } | null => {
  const m = /^(#{1,3})([ \t]+)/.exec(line);
  return m ? { level: m[1].length as 1 | 2 | 3, prefix: m[0] } : null;
};

export const parseFormatted = (text: string): FormatToken[] =>
  text.split('\n').flatMap((line, i, lines) => {
    const heading = headingOf(line);
    const tokens: FormatToken[] = heading
      ? [{ text: heading.prefix, heading: heading.level, marker: true }, ...parseInline(line.slice(heading.prefix.length), { heading: heading.level })]
      : parseInline(line);
    if (i < lines.length - 1) tokens.push({ text: '\n' });
    return tokens;
  });
