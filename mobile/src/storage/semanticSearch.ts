import { NativeModules } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { db, isDatabaseReady, withDatabaseLock } from './database';
import { buildLandscape, createTokenizer, Landscape, LandscapeNote, linksTo, meanPoolNormalize } from '@notespark/core';

const DIMS = 384;
// ponytail: cut-off picked from a few test sentences; tune with real notes.
const MAX_DISTANCE = 0.7;

export const isMeaningSearchAvailable = () => !!NativeModules.Onnxruntime && !!SQLite.bundledExtensions['sqlite-vec'];

type Embed = (text: string) => Promise<Float32Array>;
let embedder: Promise<Embed> | null = null;

const loadEmbedder = async (): Promise<Embed> => {
  // Not a top-level import: it installs its native part on import, which crashes Expo Go.
  const { InferenceSession, Tensor } = require('onnxruntime-react-native') as typeof import('onnxruntime-react-native');
  const [model, vocab] = await Asset.loadAsync([
    require('../../assets/models/all-MiniLM-L6-v2-int8.onnx'),
    require('../../assets/models/all-MiniLM-L6-v2-vocab.txt'),
  ]);
  const session = await InferenceSession.create(model.localUri!);
  const encode = createTokenizer(await FileSystem.readAsStringAsync(vocab.localUri!));
  let queue: Promise<unknown> = Promise.resolve();
  const embed: Embed = async text => {
    const ids = encode(text);
    const n = ids.length;
    const out = await session.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]),
      attention_mask: new Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
      token_type_ids: new Tensor('int64', new BigInt64Array(n), [1, n]),
    });
    return meanPoolNormalize(out.last_hidden_state.data as Float32Array, n, DIMS);
  };
  return text => {
    const next = queue.then(() => embed(text));
    queue = next.catch(() => {});
    return next;
  };
};

const getEmbedder = () => {
  embedder ??= loadEmbedder().catch(error => {
    embedder = null;
    throw error;
  });
  return embedder;
};

const asBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

const cleanText = (content: string) =>
  content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

// ponytail: chunks by words, not tokens; about 1.3 tokens a word keeps the title plus a chunk under the model's 256.
const CHUNK_WORDS = 150;
const MAX_CHUNKS = 40; // bounds indexing time for very long notes; text past 6,000 words isn't searched

// Paragraphs packed into chunks of up to CHUNK_WORDS words; a heading starts a new chunk, a long paragraph is split.
export const chunkText = (content: string): string[] => {
  const chunks: string[] = [];
  let words: string[] = [];
  const flush = () => {
    if (words.length) chunks.push(words.join(' '));
    words = [];
  };
  for (const block of content.split(/\n\s*\n|\n(?=#{1,6}\s)/)) {
    const blockWords = block.trim().split(/\s+/).filter(Boolean);
    if (/^#{1,6}\s/.test(block.trim())) flush();
    for (let i = 0; i < blockWords.length; i += CHUNK_WORDS) {
      const piece = blockWords.slice(i, i + CHUNK_WORDS);
      if (words.length + piece.length > CHUNK_WORDS) flush();
      words.push(...piece);
    }
  }
  flush();
  return chunks.length ? chunks.slice(0, MAX_CHUNKS) : [''];
};

// Every chunk carries the title, so a match deep in a note still knows what the note is about.
const noteChunks = (title: string, content: string) => chunkText(cleanText(content)).map(chunk => `${title}\n${chunk}`);

let syncing: Promise<void> | null = null;

export const syncSearchIndex = (): Promise<void> => {
  if (!isMeaningSearchAvailable()) return Promise.resolve();
  syncing ??= (async () => {
    const conn = db;
    const live = 'SELECT id FROM notes WHERE deletedAt IS NULL';
    const stale = await withDatabaseLock(async () => {
      if (conn !== db || !isDatabaseReady()) return [];
      const gone = await conn.getAllAsync<{ id: number }>(`SELECT id FROM note_chunks WHERE noteId NOT IN (${live})`);
      for (const { id } of gone) await conn.runAsync('DELETE FROM chunk_vectors WHERE rowid = CAST(? AS INTEGER)', [id]);
      await conn.execAsync(
        `DELETE FROM note_chunks WHERE noteId NOT IN (${live});
         DELETE FROM chunk_state WHERE noteId NOT IN (${live});`
      );
      return conn.getAllAsync<{ id: number; title: string; content: string; updatedAt: string }>(
        `SELECT n.id, n.title, n.content, n.updatedAt FROM notes n
         LEFT JOIN chunk_state s ON s.noteId = n.id WHERE n.deletedAt IS NULL AND s.updatedAt IS NOT n.updatedAt`
      );
    });
    if (!stale.length) return;
    const embed = await getEmbedder();
    for (const note of stale) {
      if (conn !== db || !isDatabaseReady()) return; // profile switched or re-encrypting
      const vectors: Float32Array[] = [];
      for (const chunk of noteChunks(note.title, note.content)) vectors.push(await embed(chunk));
      const stopped = await withDatabaseLock(async () => {
        if (conn !== db || !isDatabaseReady()) return true;
        // No transaction: on the shared connection it could swallow a note being saved. vec0 rejects float rowids.
        const old = await conn.getAllAsync<{ id: number }>('SELECT id FROM note_chunks WHERE noteId = ?', [note.id]);
        for (const { id } of old) await conn.runAsync('DELETE FROM chunk_vectors WHERE rowid = CAST(? AS INTEGER)', [id]);
        await conn.runAsync('DELETE FROM note_chunks WHERE noteId = ?', [note.id]);
        for (const vector of vectors) {
          const { lastInsertRowId } = await conn.runAsync('INSERT INTO note_chunks (noteId) VALUES (?)', [note.id]);
          await conn.runAsync('INSERT INTO chunk_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)', [lastInsertRowId, asBlob(vector)]);
        }
        await conn.runAsync('INSERT OR REPLACE INTO chunk_state (noteId, updatedAt) VALUES (?, ?)', [note.id, note.updatedAt]);
        return false;
      });
      if (stopped) return;
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
};

// Nearest chunks to `vector`, as notes: each note's closest chunk, closest notes first.
const nearestNotes = async (vector: Uint8Array, k: number): Promise<{ id: number; distance: number }[]> => {
  const rows = await db.getAllAsync<{ id: number; distance: number }>(
    `SELECT rowid AS id, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = ${k} ORDER BY distance`,
    [vector]
  );
  if (!rows.length) return [];
  const owners = await db.getAllAsync<{ id: number; noteId: number }>(
    `SELECT id, noteId FROM note_chunks WHERE id IN (${rows.map(() => '?').join(',')})`,
    rows.map(r => r.id)
  );
  const noteOf = new Map(owners.map(o => [o.id, o.noteId]));
  const best = new Map<number, number>();
  for (const r of rows) {
    const noteId = noteOf.get(r.id);
    if (noteId !== undefined && !best.has(noteId)) best.set(noteId, r.distance);
  }
  return [...best].map(([id, distance]) => ({ id, distance }));
};

// null when it fails, so the caller falls back to word search.
export const searchByMeaning = async (query: string): Promise<number[] | null> => {
  try {
    const vector = await (await getEmbedder())(query);
    return (await nearestNotes(asBlob(vector), 90)).filter(r => r.distance <= MAX_DISTANCE).slice(0, 30).map(r => r.id);
  } catch (error) {
    console.warn('Search by meaning failed:', error);
    return null;
  }
};

const RELATED_MAX_DISTANCE = 0.55;
const TEXT_RELATED_MAX_DISTANCE = 0.5; // stricter than a whole note: a paragraph typed a moment ago is a sharp query
const RELATED_CHUNKS = 8; // the note's first chunks, each searched; long notes find what their later parts are about

// The notes closest to a note, from its stored vectors (no model run), with their distances, closest first.
const closeNotes = async (noteId: number, limit: number): Promise<{ id: number; distance: number }[]> => {
  const chunks = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM note_chunks WHERE noteId = ? ORDER BY id LIMIT ${RELATED_CHUNKS}`,
    [noteId]
  );
  const best = new Map<number, number>();
  for (const { id } of chunks) {
    const row = await db.getFirstAsync<{ embedding: Uint8Array }>('SELECT embedding FROM chunk_vectors WHERE rowid = CAST(? AS INTEGER)', [id]);
    if (!row) continue;
    for (const r of await nearestNotes(row.embedding, limit * 4)) {
      if (r.id !== noteId && r.distance <= RELATED_MAX_DISTANCE && r.distance < (best.get(r.id) ?? Infinity)) best.set(r.id, r.distance);
    }
  }
  return [...best].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id, distance]) => ({ id, distance }));
};

// Empty when the note isn't indexed yet or search by meaning is missing.
export const relatedNotes = async (noteId: number, limit = 5): Promise<number[]> => {
  if (!isMeaningSearchAvailable()) return [];
  try {
    return (await closeNotes(noteId, limit)).map(r => r.id);
  } catch (error) {
    console.warn('Related notes failed:', error);
    return [];
  }
};

// Notes close in meaning to a paragraph being written, closest first, leaving out the note being edited.
// Runs the model once, so call it after typing pauses. Empty when search by meaning is missing.
export const relatedToText = async (text: string, excludeNoteId?: number, limit = 5): Promise<number[]> => {
  if (!isMeaningSearchAvailable()) return [];
  try {
    const vector = await (await getEmbedder())(text);
    return (await nearestNotes(asBlob(vector), limit * 4 + 4))
      .filter(r => r.id !== excludeNoteId && r.distance <= TEXT_RELATED_MAX_DISTANCE)
      .slice(0, limit)
      .map(r => r.id);
  } catch (error) {
    console.warn('Related to text failed:', error);
    return [];
  }
};

export interface Passage {
  noteId: number;
  title: string;
  excerpt: string; // the matching chunk, shortened
  find: string; // a few words from it that the note page can search for ('' if none appear in the note as written)
  createdAt: string;
  updatedAt: string;
  distance: number;
}

const EXCERPT_CHARS = 280;

// The closest passages to a question, one per note, closest first. Not the answer written out: the notes' own words,
// so nothing is made up. null when search by meaning is missing or fails.
export const searchPassages = async (query: string, limit = 20): Promise<Passage[] | null> => {
  if (!isMeaningSearchAvailable()) return null;
  try {
    const vector = await (await getEmbedder())(query);
    const rows = (
      await db.getAllAsync<{ id: number; distance: number }>(
        'SELECT rowid AS id, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = 80 ORDER BY distance',
        [asBlob(vector)]
      )
    ).filter(r => r.distance <= MAX_DISTANCE);
    if (!rows.length) return [];
    const marks = (n: number) => Array(n).fill('?').join(',');
    const owners = await db.getAllAsync<{ id: number; noteId: number }>(
      `SELECT id, noteId FROM note_chunks WHERE id IN (${marks(rows.length)})`,
      rows.map(r => r.id)
    );
    const noteOf = new Map(owners.map(o => [o.id, o.noteId]));
    const best = new Map<number, { chunkId: number; distance: number }>();
    for (const r of rows) {
      const noteId = noteOf.get(r.id);
      if (noteId !== undefined && !best.has(noteId)) best.set(noteId, { chunkId: r.id, distance: r.distance });
    }
    const ids = [...best.keys()];
    const notes = await db.getAllAsync<{ id: number; title: string; content: string; createdAt: string; updatedAt: string; indexedAt: string | null }>(
      `SELECT n.id, n.title, n.content, n.createdAt, n.updatedAt, s.updatedAt AS indexedAt
       FROM notes n LEFT JOIN chunk_state s ON s.noteId = n.id
       WHERE n.deletedAt IS NULL AND n.isArchived = 0 AND n.id IN (${marks(ids.length)})`,
      ids
    );
    const siblings = await db.getAllAsync<{ id: number; noteId: number }>(
      `SELECT id, noteId FROM note_chunks WHERE noteId IN (${marks(ids.length)}) ORDER BY id`,
      ids
    );
    const order = new Map<number, number[]>();
    for (const s of siblings) order.set(s.noteId, [...(order.get(s.noteId) ?? []), s.id]);

    const passages: Passage[] = [];
    for (const n of notes) {
      const hit = best.get(n.id)!;
      const clean = cleanText(n.content);
      // Chunks come back the way they were cut when indexed; if the note changed since, show its start instead.
      const index = order.get(n.id)?.indexOf(hit.chunkId) ?? -1;
      const chunk = n.indexedAt === n.updatedAt && index >= 0 ? chunkText(clean)[index] : undefined;
      const text = (chunk ?? clean).replace(/\s+/g, ' ').trim();
      const excerpt = text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}...` : text;
      const lower = n.content.toLowerCase();
      const words = text.split(' ');
      const find = [5, 3, 2].map(k => words.slice(0, k).join(' ')).find(s => s.length >= 6 && lower.includes(s.toLowerCase())) ?? '';
      passages.push({ noteId: n.id, title: n.title, excerpt, find, createdAt: n.createdAt, updatedAt: n.updatedAt, distance: hit.distance });
    }
    return passages.sort((a, b) => a.distance - b.distance).slice(0, limit);
  } catch (error) {
    console.warn('Passage search failed:', error);
    return null;
  }
};

export interface NotePair {
  a: { id: number; title: string; words: number };
  b: { id: number; title: string; words: number };
  distance: number;
  linked: boolean; // one already links to the other with [[Title]]
}

const PAIR_SOURCES = 120; // the most recently edited notes are each checked against the rest; bounds the work on a big library

// Pairs of notes close in meaning, closest first, for suggesting links and finding duplicates. null when unavailable.
export const notePairs = async (limit = 60): Promise<NotePair[] | null> => {
  if (!isMeaningSearchAvailable()) return null;
  try {
    const notes = await db.getAllAsync<{ id: number; title: string; content: string }>(
      'SELECT id, title, content FROM notes WHERE deletedAt IS NULL AND isArchived = 0 ORDER BY updatedAt DESC'
    );
    const byId = new Map(notes.map(n => [n.id, n]));
    const pairs = new Map<string, NotePair>();
    for (const source of notes.slice(0, PAIR_SOURCES)) {
      for (const { id, distance } of await closeNotes(source.id, 4)) {
        const other = byId.get(id);
        if (!other) continue;
        const [a, b] = source.id < id ? [source, other] : [other, source];
        const key = `${a.id}-${b.id}`;
        if (distance >= (pairs.get(key)?.distance ?? Infinity)) continue;
        const ref = (n: typeof a) => ({ id: n.id, title: n.title, words: n.content.split(/\s+/).filter(Boolean).length });
        pairs.set(key, { a: ref(a), b: ref(b), distance, linked: linksTo(a.content, b.title) || linksTo(b.content, a.title) });
      }
    }
    return [...pairs.values()].sort((x, y) => x.distance - y.distance).slice(0, limit);
  } catch (error) {
    console.warn('Note pairs failed:', error);
    return null;
  }
};

// The whole notebook grouped by meaning (see buildLandscape in core). Each note's vector is the average of its chunks'.
// null when search by meaning is missing or reading fails. Reads one row per chunk: a few seconds for a big notebook.
export const notebookLandscape = async (): Promise<Landscape | null> => {
  if (!isMeaningSearchAvailable()) return null;
  try {
    const notes = await db.getAllAsync<{ id: number; title: string; content: string; createdAt: string }>(
      'SELECT id, title, content, createdAt FROM notes WHERE deletedAt IS NULL AND isArchived = 0 ORDER BY updatedAt DESC LIMIT 1500'
    );
    const out: LandscapeNote[] = [];
    for (const n of notes) {
      const chunks = await db.getAllAsync<{ id: number }>('SELECT id FROM note_chunks WHERE noteId = ? ORDER BY id LIMIT 8', [n.id]);
      const sum = new Float32Array(DIMS);
      let count = 0;
      for (const { id } of chunks) {
        const row = await db.getFirstAsync<{ embedding: Uint8Array }>('SELECT embedding FROM chunk_vectors WHERE rowid = CAST(? AS INTEGER)', [id]);
        if (!row) continue;
        const v = new Float32Array(row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength));
        for (let i = 0; i < DIMS; i++) sum[i] += v[i];
        count++;
      }
      if (!count) continue; // not indexed yet
      const length = Math.sqrt(sum.reduce((a, x) => a + x * x, 0)) || 1;
      out.push({ id: n.id, title: n.title, content: n.content, createdAt: n.createdAt, vector: sum.map(x => x / length) });
    }
    return buildLandscape(out, new Date().toISOString());
  } catch (error) {
    console.warn('Notebook landscape failed:', error);
    return null;
  }
};
