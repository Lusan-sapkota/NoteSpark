import { extractTags } from './tags';

// The notebook landscape: notes grouped by meaning (k-means on their vectors), each group named from its tags or its
// most typical words, placed on a 2D map, with how many notes were written per month. Pure: the storage code gives
// it each note's vector.
export interface LandscapeNote {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  vector: ArrayLike<number>; // unit length
}
export interface Topic {
  name: string; // '' when nothing stands out: the screen shows "Topic N"
  size: number;
  x: number; // 0 to 1
  y: number; // 0 to 1
  notes: { id: number; title: string }[]; // the ones nearest the centre
  monthly: number[]; // notes written per month, aligned with `months`
}
export interface Landscape {
  total: number; // notes with a vector
  topics: Topic[]; // biggest first; empty when there are too few notes
  months: string[]; // 'YYYY-MM', oldest first, the last 12
  rising: number[]; // indexes into topics
  fading: number[];
}

export const MIN_LANDSCAPE_NOTES = 8;
const MONTHS = 12;

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const normalize = (v: number[]) => {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map(x => x / n);
};

// Seeded, so the same notes always give the same groups.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Cosine k-means with k-means++ starts. Returns each vector's group and the (unit) group centres.
export const kmeans = (vectors: ArrayLike<number>[], k: number, seed = 1, rounds = 25): { groups: number[]; centres: number[][] } => {
  const rand = random(seed);
  const dim = vectors[0].length;
  const centres: number[][] = [Array.from(vectors[Math.floor(rand() * vectors.length)])];
  while (centres.length < k) {
    const gap = vectors.map(v => Math.max(0, 1 - Math.max(...centres.map(c => dot(c, v)))) ** 2);
    const total = gap.reduce((a, b) => a + b, 0);
    let pick = rand() * total;
    let at = gap.findIndex(g => (pick -= g) <= 0);
    if (at < 0) at = gap.indexOf(Math.max(...gap));
    centres.push(Array.from(vectors[at]));
  }
  let groups: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const next = vectors.map(v => {
      let best = 0;
      let bestSim = -Infinity;
      centres.forEach((c, i) => {
        const sim = dot(c, v);
        if (sim > bestSim) { bestSim = sim; best = i; }
      });
      return best;
    });
    const changed = next.some((g, i) => g !== groups[i]);
    groups = next;
    for (let g = 0; g < k; g++) {
      const sum = new Array<number>(dim).fill(0);
      let count = 0;
      vectors.forEach((v, i) => { if (groups[i] === g) { count++; for (let d = 0; d < dim; d++) sum[d] += v[d]; } });
      if (count) centres[g] = normalize(sum);
    }
    if (!changed) break;
  }
  return { groups, centres };
};

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Words (or, for scripts written without spaces, pairs of characters) a note uses, each once.
export const termsOf = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (CJK.test(word)) {
      for (let i = 0; i + 1 < word.length; i++) out.add(word.slice(i, i + 2));
    } else if (word.length >= 4 && !/^\d+$/.test(word)) out.add(word);
  }
  return out;
};

// Tags and words that this group uses much more than the notebook as a whole.
const nameOf = (members: number[], docs: Set<string>[], tags: string[][], globalDf: Map<string, number>, globalTags: Map<string, number>, total: number) => {
  const size = members.length;
  const count = (items: string[][]) => {
    const map = new Map<string, number>();
    for (const i of members) for (const item of new Set(items[i])) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  };
  const tagCounts = count(tags);
  const bestTag = [...tagCounts]
    .filter(([tag, n]) => n >= 2 && n / size >= 0.25 && n / (globalTags.get(tag) ?? n) >= 0.5)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (bestTag) return bestTag[0];
  const df = count(docs.map(d => [...d]));
  const scored = [...df]
    .map(([term, n]) => {
      const share = n / size;
      const lift = share / ((globalDf.get(term) ?? n) / total);
      return { term, score: n >= 2 && lift > 1.5 ? share * Math.log(lift) : 0 };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  return scored.slice(0, 2).map(s => s.term).join(', ');
};

// Where the groups sit relative to each other: the two directions in which the centres differ most.
export const project = (centres: number[][]): { x: number; y: number }[] => {
  const n = centres.length;
  const dim = centres[0].length;
  const mean = new Array<number>(dim).fill(0);
  centres.forEach(c => c.forEach((v, d) => (mean[d] += v / n)));
  let rows = centres.map(c => c.map((v, d) => v - mean[d]));
  const axis = (rows: number[][], seed: number) => {
    let v = normalize(Array.from({ length: dim }, (_, d) => Math.sin(d * 12.9898 + seed) + 1.1));
    for (let i = 0; i < 40; i++) {
      const next = new Array<number>(dim).fill(0);
      rows.forEach(r => { const s = dot(r, v); r.forEach((x, d) => (next[d] += x * s)); });
      v = normalize(next);
    }
    return v;
  };
  const a = axis(rows, 1);
  const first = rows.map(r => dot(r, a));
  rows = rows.map((r, i) => r.map((x, d) => x - first[i] * a[d]));
  const second = n > 2 ? rows.map(r => dot(r, axis(rows, 2))) : first.map(() => 0);
  const fit = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.map(v => (hi - lo < 1e-9 ? 0.5 : 0.12 + (0.76 * (v - lo)) / (hi - lo)));
  };
  const xs = fit(first);
  const ys = fit(second);
  return xs.map((x, i) => ({ x, y: ys[i] }));
};

export const monthKey = (iso: string) => iso.slice(0, 7);
const lastMonths = (now: string, n: number) => {
  const [y, m] = monthKey(now).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

export const buildLandscape = (notes: LandscapeNote[], now: string): Landscape => {
  const months = lastMonths(now, MONTHS);
  const empty: Landscape = { total: notes.length, topics: [], months, rising: [], fading: [] };
  if (notes.length < MIN_LANDSCAPE_NOTES) return empty;

  const k = Math.max(2, Math.min(8, Math.round(Math.sqrt(notes.length / 2))));
  const { groups, centres } = kmeans(notes.map(n => n.vector), k, notes.length);
  const docs = notes.map(n => termsOf(`${n.title}\n${n.content}`));
  const tags = notes.map(n => extractTags(n.content));
  const globalDf = new Map<string, number>();
  docs.forEach(d => d.forEach(t => globalDf.set(t, (globalDf.get(t) ?? 0) + 1)));
  const globalTags = new Map<string, number>();
  tags.forEach(ts => new Set(ts).forEach(t => globalTags.set(t, (globalTags.get(t) ?? 0) + 1)));

  const used = centres.map((_, g) => g).filter(g => groups.includes(g));
  const points = project(used.map(g => centres[g]));
  const topics: Topic[] = used.map((g, at) => {
    const members = notes.map((_, i) => i).filter(i => groups[i] === g);
    const nearest = [...members].sort((a, b) => dot(centres[g], notes[b].vector) - dot(centres[g], notes[a].vector)).slice(0, 5);
    const monthly = months.map(m => members.filter(i => monthKey(notes[i].createdAt) === m).length);
    return {
      name: nameOf(members, docs, tags, globalDf, globalTags, notes.length),
      size: members.length,
      x: points[at].x,
      y: points[at].y,
      notes: nearest.map(i => ({ id: notes[i].id, title: notes[i].title })),
      monthly,
    };
  }).sort((a, b) => b.size - a.size);

  // Rising and fading: the last 3 months against the 3 before, only for groups big enough to mean something.
  const change = topics.map(t => t.monthly.slice(-3).reduce((a, b) => a + b, 0) - t.monthly.slice(-6, -3).reduce((a, b) => a + b, 0));
  const ranked = topics.map((t, i) => i).filter(i => topics[i].size >= 3);
  const rising = ranked.filter(i => change[i] >= 2).sort((a, b) => change[b] - change[a]).slice(0, 2);
  const fading = ranked.filter(i => change[i] <= -2).sort((a, b) => change[a] - change[b]).slice(0, 2);
  return { total: notes.length, topics, months, rising, fading };
};
