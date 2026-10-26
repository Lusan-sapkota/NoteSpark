// Just enough of expo-sqlite for the phone's storage code (Mobile/src/storage), on better-sqlite3-multiple-ciphers.
// The native module loads on first open, so a tray-only app never pays for it.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { databaseDir } from './paths';

type Raw = {
  prepare(sql: string): { all(...p: unknown[]): any[]; get(...p: unknown[]): any; run(...p: unknown[]): { changes: number; lastInsertRowid: number | bigint } };
  exec(sql: string): void;
  close(): void;
};
type Params = unknown[] | [unknown[]];
export interface SQLiteOpenOptions { useNewConnection?: boolean }

// better-sqlite3 refuses booleans; expo-sqlite binds them as 0 and 1.
const bind = (params: Params) => ((params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params) as unknown[]).map(v => (typeof v === 'boolean' ? Number(v) : v));

export const defaultDatabaseDirectory = databaseDir();
export const bundledExtensions: Record<string, { libPath: string; entryPoint: string } | undefined> = {}; // no sqlite-vec yet

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
      getFirstAsync: async (sql: string, ...p: Params) => this.db().prepare(sql).get(...bind(p)) ?? null,
      runAsync: async (sql: string, ...p: Params) => {
        const r = this.db().prepare(sql).run(...bind(p));
        return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
      },
      execAsync: async (sql: string) => {
        // SQLCipher files from the phone: use its cipher settings before the key is set. ponytail: unverified
        // against a file written by the phone; check in phase 4.
        if (/^\s*PRAGMA\s+key\b/i.test(sql)) this.db().exec("PRAGMA cipher = 'sqlcipher'; PRAGMA legacy = 4;");
        this.db().exec(sql);
      },
    } as any;
  }

  getAllAsync<T = any>(sql: string, ...p: Params): Promise<T[]> { return this.serial(() => this.ops().getAllAsync(sql, ...p)); }
  getFirstAsync<T = any>(sql: string, ...p: Params): Promise<T | null> { return this.serial(() => this.ops().getFirstAsync(sql, ...p)); }
  runAsync(sql: string, ...p: Params): Promise<{ changes: number; lastInsertRowId: number }> { return this.serial(() => this.ops().runAsync(sql, ...p)); }
  execAsync(sql: string): Promise<void> { return this.serial(() => this.ops().execAsync(sql)); }
  loadExtensionAsync(_path?: string, _entry?: string): Promise<void> { return Promise.reject(new Error('Extensions are not supported on desktop yet')); }
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
  return new SQLiteDatabase(raw);
};

export const deleteDatabaseAsync = async (name: string) => rmSync(join(defaultDatabaseDirectory, name), { force: true });
