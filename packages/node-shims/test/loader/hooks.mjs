// Runs Mobile/src/storage in plain Node: Expo modules -> node-shims, @notespark/* -> sources, extensionless -> .ts.
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const shim = name => resolve(root, 'packages/node-shims/src', name);
const map = {
  'expo-sqlite': shim('expo-sqlite.ts'),
  'expo-crypto': shim('expo-crypto.ts'),
  'expo-secure-store': shim('expo-secure-store.ts'),
  'expo-file-system/legacy': shim('expo-file-system-legacy.ts'),
  '@react-native-async-storage/async-storage': shim('async-storage.ts'),
  'expo-local-authentication': resolve(root, 'packages/node-shims/test/loader/local-authentication.ts'),
  '@notespark/core': resolve(root, 'packages/core/src/index.ts'),
  '@notespark/sync': resolve(root, 'packages/sync/src/index.ts'),
  'better-sqlite3-multiple-ciphers': resolve(root, 'Desktop/node_modules/better-sqlite3-multiple-ciphers/lib/index.js'),
};
const isFile = p => existsSync(p) && statSync(p).isFile();

export async function resolve_(specifier, context, next) {
  if (map[specifier]) return next(pathToFileURL(map[specifier]).href, context);
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) if (isFile(candidate)) return next(pathToFileURL(candidate).href, context);
  }
  return next(specifier, context);
}
export { resolve_ as resolve };

// Type stripping keeps type-only imports; TypeScript's transpile drops them.
const ts = (await import(pathToFileURL(resolve(root, 'Mobile/node_modules/typescript/lib/typescript.js')).href)).default;
export async function load(url, context, next) {
  if (!url.startsWith('file:') || !url.endsWith('.ts') || url.includes('/node_modules/')) return next(url, context);
  const source = (await import('node:fs/promises')).readFile(fileURLToPath(url), 'utf8');
  const out = ts.transpileModule(await source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: fileURLToPath(url) });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}
