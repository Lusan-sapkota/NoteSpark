// BERT uncased WordPiece tokenizer and pooling for all-MiniLM-L6-v2.

const isCjk = (cp: number) =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0x3400 && cp <= 0x4dbf) ||
  (cp >= 0x20000 && cp <= 0x2a6df) ||
  (cp >= 0x2a700 && cp <= 0x2b73f) ||
  (cp >= 0x2b740 && cp <= 0x2b81f) ||
  (cp >= 0x2b820 && cp <= 0x2ceaf) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0x2f800 && cp <= 0x2fa1f);

const isPunctuation = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) || /\p{P}/u.test(ch);
};

const basicTokenize = (text: string): string[] => {
  let cleaned = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (/[\t\n\r\p{Zs}]/u.test(ch)) cleaned += ' ';
    else if (cp === 0 || cp === 0xfffd || /\p{C}/u.test(ch)) continue;
    else if (isCjk(cp)) cleaned += ` ${ch} `;
    else cleaned += ch;
  }
  const tokens: string[] = [];
  for (const word of cleaned.split(' ')) {
    if (!word) continue;
    let current = '';
    for (const ch of word.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '')) {
      if (isPunctuation(ch)) {
        if (current) tokens.push(current);
        tokens.push(ch);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
  }
  return tokens;
};

export const createTokenizer = (vocabText: string) => {
  const vocab = new Map<string, number>();
  vocabText.split('\n').forEach((line, i) => {
    const token = line.replace(/\r$/, '');
    if (token) vocab.set(token, i);
  });
  const unk = vocab.get('[UNK]')!;
  const cls = vocab.get('[CLS]')!;
  const sep = vocab.get('[SEP]')!;

  const wordPiece = (word: string): number[] => {
    const chars = [...word];
    if (chars.length > 100) return [unk];
    const ids: number[] = [];
    for (let start = 0; start < chars.length; ) {
      let end = chars.length;
      let id: number | undefined;
      for (; end > start; end--) {
        id = vocab.get((start > 0 ? '##' : '') + chars.slice(start, end).join(''));
        if (id !== undefined) break;
      }
      if (id === undefined) return [unk];
      ids.push(id);
      start = end;
    }
    return ids;
  };

  return (text: string, maxLength = 256): number[] => {
    const ids = basicTokenize(text).flatMap(wordPiece);
    return [cls, ...ids.slice(0, maxLength - 2), sep];
  };
};

export const meanPoolNormalize = (hidden: Float32Array, tokens: number, dims: number): Float32Array => {
  const out = new Float32Array(dims);
  for (let t = 0; t < tokens; t++) {
    for (let d = 0; d < dims; d++) out[d] += hidden[t * dims + d];
  }
  let norm = 0;
  for (let d = 0; d < dims; d++) {
    out[d] /= tokens;
    norm += out[d] * out[d];
  }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dims; d++) out[d] /= norm;
  return out;
};
