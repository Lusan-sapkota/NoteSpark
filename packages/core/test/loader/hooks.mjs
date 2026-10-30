// The sources import each other without extensions (Metro, Vite and tsc allow it); Node needs the .ts.
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isFile = p => existsSync(p) && statSync(p).isFile();

export async function resolve_(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) if (isFile(candidate)) return next(pathToFileURL(candidate).href, context);
  }
  return next(specifier, context);
}
export { resolve_ as resolve };
