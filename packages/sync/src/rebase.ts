const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

// The one contiguous replacement that turns `from` into `to` (common prefix and suffix kept, no split surrogate pairs).
const span = (from: string, to: string) => {
  const max = Math.min(from.length, to.length);
  let start = 0;
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  if (start > 0 && isHigh(from.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < max - start && from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)) end++;
  if (end > 0 && isLow(from.charCodeAt(from.length - end))) end--;
  return { start, end: from.length - end, text: to.slice(start, to.length - end) };
};

// How much text differs between two versions.
export const editSize = (from: string, to: string) => {
  const s = span(from, to);
  return s.end - s.start + s.text.length;
};

// An outside edit (base -> edited) applied to the text as it is now. Edits in different places both stay; edits to the
// same place keep the current text and add the outside text after it, so nothing is lost.
export const rebaseText = (base: string, edited: string, current: string): string => {
  if (current === base) return edited;
  if (edited === base || edited === current) return current;
  const a = span(base, edited);
  const b = span(base, current);
  if (a.end <= b.start || b.end <= a.start) {
    const [first, second] = a.end <= b.start ? [a, b] : [b, a];
    return base.slice(0, first.start) + first.text + base.slice(first.end, second.start) + second.text + base.slice(second.end);
  }
  const at = b.start + b.text.length;
  return current.slice(0, at) + a.text + current.slice(at);
};
