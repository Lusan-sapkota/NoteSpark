// Answers "embed" through a helper process that loads the model on demand and exits after IDLE_MS idle.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { utilityProcess, UtilityProcess } from 'electron';
import { Asset } from './shims/expo-asset';

const IDLE_MS = Number(process.env.NOTESPARK_EMBED_IDLE_MS) || 10_000;
type Pending = { resolve(v: Float32Array): void; reject(e: Error): void };

let child: UtilityProcess | null = null;
let idle: NodeJS.Timeout | undefined;
let counter = 0;
const pending = new Map<number, Pending>();

// Next to this code, or one folder up when the bundler put it in chunks/ (also inside app.asar once packaged).
const workerFile = () => [join(__dirname, 'embed-worker.js'), join(__dirname, '..', 'embed-worker.js')].find(existsSync) ?? join(__dirname, 'embed-worker.js');

const spawn = async () => {
  const [model, vocab] = await Asset.loadAsync(['models:all-MiniLM-L6-v2-int8.onnx', 'models:all-MiniLM-L6-v2-vocab.txt']);
  const worker = utilityProcess.fork(workerFile(), [model.localUri, vocab.localUri], { serviceName: 'NoteSpark search model' });
  worker.on('message', (m: { id: number; vector?: number[]; error?: string }) => {
    const waiting = pending.get(m.id);
    pending.delete(m.id);
    if (!waiting) return;
    if (m.vector) waiting.resolve(Float32Array.from(m.vector));
    else waiting.reject(new Error(m.error ?? 'The search model failed'));
  });
  worker.on('exit', () => {
    if (child === worker) child = null;
    for (const waiting of pending.values()) waiting.reject(new Error('The search model stopped'));
    pending.clear();
  });
  return worker;
};

export const embedInWorker = async (text: string): Promise<Float32Array> => {
  clearTimeout(idle);
  child ??= await spawn();
  const worker = child;
  const id = ++counter;
  const vector = new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, text });
  });
  try {
    return await vector;
  } finally {
    idle = setTimeout(() => { if (!pending.size) { child?.kill(); child = null; } }, IDLE_MS);
    idle.unref();
  }
};
