import * as Y from 'yjs';

// One per profile: which note uuids exist and which were erased for good. Erased uuids live in their own map and
// are never removed from it, so a concurrent write of "live" can't bring a note back (one key with two values
// would be last writer wins). An erased uuid never comes back.
const live = (doc: Y.Doc) => doc.getMap<true>('live');
const erased = (doc: Y.Doc) => doc.getMap<true>('erased');

export const markLive = (doc: Y.Doc, uuid: string) => {
  if (!live(doc).has(uuid)) live(doc).set(uuid, true);
};
export const markErased = (doc: Y.Doc, uuid: string) => {
  if (!erased(doc).has(uuid)) erased(doc).set(uuid, true);
};
export const isErased = (doc: Y.Doc, uuid: string) => erased(doc).has(uuid);
export const isKnown = (doc: Y.Doc, uuid: string) => live(doc).has(uuid) || erased(doc).has(uuid);
export const catalogUuids = (doc: Y.Doc) => [...new Set([...live(doc).keys(), ...erased(doc).keys()])];

// Review records (docs/decisions/sync-decisions.md S1) ride in the catalog doc, so the hub, the sync file and every store
// carry them without a protocol change. One key per record, never rewritten, so two devices never conflict: the union is the merge.
const reviews = (doc: Y.Doc) => doc.getMap<string>('reviews');
export const MAX_REVIEW_BYTES = 400;

export interface ReviewEntry {
  id: string;
  card: string;
  at: number;
  on: string;
  grade?: 'again' | 'hard' | 'good' | 'easy';
  state?: { due: string; interval: number; ease: number; reps: number; lapses: number };
}

export const markReview = (doc: Y.Doc, entry: ReviewEntry) => {
  const text = JSON.stringify(entry);
  if (text.length <= MAX_REVIEW_BYTES && !reviews(doc).has(entry.id)) reviews(doc).set(entry.id, text);
};

// A real calendar day, not just a shape: '9999-99-99' would make a card's due date 'NaN-NaN-NaN'.
const isDay = (s: unknown) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
// Records come from other devices: anything that is not exactly a record is skipped.
export const readReviews = (doc: Y.Doc): ReviewEntry[] => {
  const out: ReviewEntry[] = [];
  for (const [key, text] of reviews(doc)) {
    if (typeof text !== 'string' || text.length > MAX_REVIEW_BYTES) continue;
    let e: ReviewEntry;
    try { e = JSON.parse(text); } catch { continue; }
    if (!e || typeof e !== 'object') continue; // the text 'null' or '5' parses fine
    const s = e.state;
    const okState = !s || (isDay(s.due) && num(s.interval) && num(s.ease) && num(s.reps) && num(s.lapses));
    if (e && e.id === key && typeof e.card === 'string' && num(e.at) && isDay(e.on) && okState
      && (e.state || ['again', 'hard', 'good', 'easy'].includes(e.grade as string))) out.push(e);
  }
  return out;
};
