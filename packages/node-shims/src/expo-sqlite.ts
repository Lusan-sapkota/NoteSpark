// Just enough of expo-sqlite for the phone's storage code (mobile/src/storage), on better-sqlite3-multiple-ciphers.
// The native module loads on first open, so a tray-only app never pays for it.
import { mkdirSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { databaseDir, requireFromHere } from './paths';

type Raw = {
  prepare(sql: string): { all(...p: unknown[]): any[]; get(...p: unknown[]): any; run(...p: unknown[]): { changes: number; lastInsertRowid: number | bigint } };
  exec(sql: string): void;
  loadExtension(path: string, entryPoint?: string): void;
  close(): void;
};
type Params = unknown[] | [unknown[]];
export interface SQLiteOpenOptions { useNewConnection?: boolean }

// better-sqlite3 refuses booleans; expo-sqlite binds them as 0 and 1.
const bind = (params: Params) => ((params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params) as unknown[]).map(v => (typeof v === 'boolean' ? Number(v) : v));

// What sqlcipher_export does: copies every table (with its rows) and index into another attached database, which
// is how a database is encrypted, re-keyed or decrypted. Triggers, views and virtual tables aren't in the schema.
const exportAll = (raw: Raw, schema: string) => {
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const items = raw.prepare("SELECT type, name, sql FROM main.sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all() as { type: string; name: string; sql: string }[];
  if (items.some(i => (i.type !== 'table' && i.type !== 'index') || /^CREATE VIRTUAL/i.test(i.sql))) throw new Error('This database has parts that cannot be copied');
  raw.exec('BEGIN');
  try {
    for (const t of items.filter(i => i.type === 'table')) {
      raw.exec(t.sql.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?("[^"]+"|\w+)/i, (_m, ine, name) => `CREATE TABLE ${ine ?? ''}${schema}.${name}`));
      raw.exec(`INSERT INTO ${schema}.${quote(t.name)} SELECT * FROM main.${quote(t.name)}`);
    }
    for (const i of items.filter(i => i.type === 'index')) {
      raw.exec(i.sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?("[^"]+"|\w+)/i, (_m, unique, ine, name) => `CREATE ${unique ?? ''}INDEX ${ine ?? ''}${schema}.${name}`));
    }
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
};

export const defaultDatabaseDirectory = databaseDir();
// The vector index for search by meaning. Looked up on first use; a packaged app keeps the library outside app.asar.
const nodeRequire = requireFromHere;
export const bundledExtensions: Record<string, { libPath: string; entryPoint: string } | undefined> = {
  get 'sqlite-vec'() {
    try {
      const libPath = (nodeRequire('sqlite-vec') as { getLoadablePath(): string }).getLoadablePath().replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
      return { libPath, entryPoint: 'sqlite3_vec_init' };
    } catch {
      return undefined;
    }
  },
};

export class SQLiteDatabase {
  // Calls run in order; an exclusive transaction holds the queue until it finishes.
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private raw: Raw | null) {}

  private serial<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  private db() {
    if (!this.raw) throw new Error('Database is not open');
    return this.raw;
  }
  private ops(): Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'> {
    return {
      getAllAsync: async (sql: string, ...p: Params) => this.db().prepare(sql).all(...bind(p)),
      getFirstAsync: async (sql: string, ...p: Params) => {
        // SQLCipher answers this; the code asks to know that encryption is available at all.
        if (/^\s*PRAGMA\s+cipher_version\s*;?\s*$/i.test(sql)) return { cipher_version: 'SQLite3 Multiple Ciphers (SQLCipher 4 mode)' };
        return this.db().prepare(sql).get(...bind(p)) ?? null;
      },
      runAsync: async (sql: string, ...p: Params) => {
        const r = this.db().prepare(sql).run(...bind(p));
        return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
      },
      execAsync: async (sql: string) => {
        const marker = /SELECT\s+sqlcipher_export\('(\w+)'\)\s*;?/i.exec(sql);
        if (!marker) return this.db().exec(sql);
        // This SQLite build has no sqlcipher_export(): run the statements around it and copy everything ourselves.
        this.db().exec(sql.slice(0, marker.index));
        exportAll(this.db(), marker[1]);
        this.db().exec(sql.slice(marker.index + marker[0].length));
      },
    } as any;
  }

  getAllAsync<T = any>(sql: string, ...p: Params): Promise<T[]> { return this.serial(() => this.ops().getAllAsync(sql, ...p)); }
  getFirstAsync<T = any>(sql: string, ...p: Params): Promise<T | null> { return this.serial(() => this.ops().getFirstAsync(sql, ...p)); }
  runAsync(sql: string, ...p: Params): Promise<{ changes: number; lastInsertRowId: number }> { return this.serial(() => this.ops().runAsync(sql, ...p)); }
  execAsync(sql: string): Promise<void> { return this.serial(() => this.ops().execAsync(sql)); }
  loadExtensionAsync(path: string, entryPoint?: string): Promise<void> { return this.serial(() => this.db().loadExtension(path, entryPoint)); }
  closeAsync(): Promise<void> {
    return this.serial(() => { this.raw?.close(); this.raw = null; });
  }
  withExclusiveTransactionAsync(task: (txn: Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'>) => Promise<void>): Promise<void> {
    return this.serial(async () => {
      const ops = this.ops();
      await ops.execAsync('BEGIN IMMEDIATE');
      try {
        await task(ops);
        await ops.execAsync('COMMIT');
      } catch (error) {
        await ops.execAsync('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  }
  withTransactionAsync(task: () => Promise<void>) { return this.withExclusiveTransactionAsync(() => task()); }
}

// Used only as an unused placeholder at import time.
export const openDatabaseSync = (_name: string) => new SQLiteDatabase(null);

export const openDatabaseAsync = async (name: string, _options?: SQLiteOpenOptions) => {
  const { default: Database } = await import('better-sqlite3-multiple-ciphers');
  mkdirSync(defaultDatabaseDirectory, { recursive: true });
  const raw = new Database(join(defaultDatabaseDirectory, name)) as unknown as Raw;
  // The phone's files are SQLCipher 4. ponytail: unverified against a file written by the phone; desktop profiles
  // have their own keys until sync, so nothing needs to open a phone's file yet.
  raw.exec("PRAGMA cipher = 'sqlcipher'; PRAGMA legacy = 4;");
  return new SQLiteDatabase(raw);
};

export const deleteDatabaseAsync = async (name: string) => rmSync(join(defaultDatabaseDirectory, name), { force: true });
