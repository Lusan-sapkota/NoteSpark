import { NativeModules } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { db } from './database';
import { createTokenizer, meanPoolNormalize } from '../utils/textEmbedding';

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

const noteText = (title: string, content: string) =>
  `${title}\n${content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}`;

let syncing: Promise<void> | null = null;

// ponytail: one vector per note from its first ~200 words; chunk long notes if deep matches get missed.
export const syncSearchIndex = (): Promise<void> => {
  if (!isMeaningSearchAvailable()) return Promise.resolve();
  syncing ??= (async () => {
    const conn = db;
    await conn.execAsync(
      `DELETE FROM note_vectors WHERE rowid NOT IN (SELECT id FROM notes);
       DELETE FROM note_vector_state WHERE noteId NOT IN (SELECT id FROM notes);`
    );
    const stale = await conn.getAllAsync<{ id: number; title: string; content: string; updatedAt: string }>(
      `SELECT n.id, n.title, n.content, n.updatedAt FROM notes n
       LEFT JOIN note_vector_state s ON s.noteId = n.id WHERE s.updatedAt IS NOT n.updatedAt`
    );
    if (!stale.length) return;
    const embed = await getEmbedder();
    for (const note of stale) {
      if (conn !== db) return; // profile switched
      const vector = await embed(noteText(note.title, note.content));
      // No transaction: on the shared connection it could swallow a note being saved. vec0 rejects float rowids.
      await conn.runAsync('DELETE FROM note_vectors WHERE rowid = CAST(? AS INTEGER)', [note.id]);
      await conn.runAsync('INSERT INTO note_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)', [note.id, asBlob(vector)]);
      await conn.runAsync('INSERT OR REPLACE INTO note_vector_state (noteId, updatedAt) VALUES (?, ?)', [note.id, note.updatedAt]);
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
};

// null when it fails, so the caller falls back to word search.
export const searchByMeaning = async (query: string): Promise<number[] | null> => {
  try {
    const vector = await (await getEmbedder())(query);
    const rows = await db.getAllAsync<{ id: number; distance: number }>(
      'SELECT rowid AS id, distance FROM note_vectors WHERE embedding MATCH ? AND k = 30 ORDER BY distance',
      [asBlob(vector)]
    );
    return rows.filter(r => r.distance <= MAX_DISTANCE).map(r => r.id);
  } catch (error) {
    console.warn('Search by meaning failed:', error);
    return null;
  }
};
