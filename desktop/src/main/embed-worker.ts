// Runs the search model in its own process so its memory (about 70 MB) is freed when it exits (see embedder.ts).
import { readFileSync } from 'node:fs';
import { createTokenizer, meanPoolNormalize } from '@notespark/core';

const DIMS = 384; // same as storage/semanticSearch.ts
const [modelPath, vocabPath] = process.argv.slice(2);
const parent = (process as unknown as { parentPort: { on(event: 'message', cb: (e: { data: { id: number; text: string } }) => void): void; postMessage(m: unknown): void } }).parentPort;

const ready = (async () => {
  const { InferenceSession, Tensor } = await import('onnxruntime-node');
  const session = await InferenceSession.create(modelPath);
  const encode = createTokenizer(readFileSync(vocabPath, 'utf8'));
  return async (text: string) => {
    const ids = encode(text);
    const n = ids.length;
    const out = await session.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]),
      attention_mask: new Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
      token_type_ids: new Tensor('int64', new BigInt64Array(n), [1, n]),
    });
    return meanPoolNormalize(out.last_hidden_state.data as Float32Array, n, DIMS);
  };
})();

// One text at a time, in order (the caller already queues, this keeps it true).
let chain: Promise<unknown> = Promise.resolve();
parent.on('message', ({ data: { id, text } }) => {
  chain = chain.then(async () => {
    try {
      parent.postMessage({ id, vector: Array.from(await (await ready)(text)) });
    } catch (error) {
      parent.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
