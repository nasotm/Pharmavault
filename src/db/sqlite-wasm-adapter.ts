import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
  type SqlValue,
} from '@sqlite.org/sqlite-wasm';
import type { DatabasePort, SqlParam } from './port';

export interface SqliteWasmAdapterOptions {
  /**
   * Database file name or ':memory:' for ephemeral in-memory database.
   * Defaults to 'pharmacy-inventory.sqlite3'.
   */
  filename?: string;
  /**
   * Optional custom directory for Node.js OPFS simulation (defaults to '.opfs' or process.env.OPFS_DIR).
   */
  nodeOpfsDir?: string;
}

export type StoragePersistenceMode =
  'opfs-native' | 'opfs-sahpool' | 'opfs-async-handle' | 'node-opfs-file' | 'memory';

let sharedSqlite3Promise: Promise<Sqlite3Static> | null = null;

function getSqlite3Module(): Promise<Sqlite3Static> {
  if (!sharedSqlite3Promise) {
    sharedSqlite3Promise = sqlite3InitModule();
  }
  return sharedSqlite3Promise;
}

/**
 * Concrete DatabasePort adapter backed by @sqlite.org/sqlite-wasm.
 * Nothing outside this module may import or touch @sqlite.org/sqlite-wasm directly.
 */
export class SqliteWasmAdapter implements DatabasePort {
  private readonly filename: string;
  private readonly nodeOpfsDir?: string;
  private db: Database | null = null;
  private sqlite3: Sqlite3Static | null = null;
  private initPromise: Promise<void> | null = null;
  private txDepth = 0;
  private savepointCounter = 0;
  private operationQueue: Promise<unknown> = Promise.resolve();
  private persistenceMode: StoragePersistenceMode = 'memory';
  private persistCallback: (() => Promise<void>) | null = null;

  constructor(options: SqliteWasmAdapterOptions = {}) {
    this.filename = options.filename ?? 'pharmacy-inventory.sqlite3';
    this.nodeOpfsDir = options.nodeOpfsDir;
  }

  /**
   * Factory helper that initializes the WASM module and OPFS backing store before returning.
   */
  static async create(options: SqliteWasmAdapterOptions = {}): Promise<SqliteWasmAdapter> {
    const adapter = new SqliteWasmAdapter(options);
    await adapter.ensureInitialized();
    return adapter;
  }

  getStorageMode(): StoragePersistenceMode {
    return this.persistenceMode;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.db) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeInternal();
    }
    await this.initPromise;
  }

  private async initializeInternal(): Promise<void> {
    const sqlite3 = await getSqlite3Module();
    this.sqlite3 = sqlite3;

    if (this.filename === ':memory:') {
      this.db = new sqlite3.oo1.DB(':memory:', 'c');
      this.persistenceMode = 'memory';
      this.db.exec('PRAGMA foreign_keys = ON;');
      return;
    }

    const cleanName = this.filename.replace(/^\/+/, '');
    const vfsPath = `/${cleanName}`;

    // 1. Browser Environment: Attempt native OPFS VFS, SAHPool OPFS VFS, or Main-Thread OPFS FileSystemFileHandle
    if (
      typeof window !== 'undefined' ||
      (typeof self !== 'undefined' && typeof process === 'undefined')
    ) {
      // 1a. Native Worker OPFS VFS (sqlite3.oo1.OpfsDb)
      if ('opfs' in sqlite3 && sqlite3.oo1.OpfsDb) {
        try {
          this.db = new sqlite3.oo1.OpfsDb(vfsPath, 'c');
          this.persistenceMode = 'opfs-native';
          this.db.exec('PRAGMA foreign_keys = ON;');
          return;
        } catch {
          // Fall through to SAHPool or async OPFS file handle
        }
      }

      // 1b. OPFS SyncAccessHandle Pool VFS
      if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
        try {
          const pool = await sqlite3.installOpfsSAHPoolVfs({
            name: 'pharmavault-opfs-sahpool',
            initialCapacity: 8,
          });
          this.db = new pool.OpfsSAHPoolDb(vfsPath);
          this.persistenceMode = 'opfs-sahpool';
          this.db.exec('PRAGMA foreign_keys = ON;');
          return;
        } catch {
          // Fall through to Main-Thread OPFS FileSystemFileHandle
        }
      }

      // 1c. Main-Thread Browser OPFS (navigator.storage.getDirectory) + sqlite3 serialize/deserialize
      if (
        typeof navigator !== 'undefined' &&
        navigator.storage &&
        typeof navigator.storage.getDirectory === 'function'
      ) {
        try {
          const rootDir = await navigator.storage.getDirectory();
          const fileHandle = await rootDir.getFileHandle(cleanName, { create: true });
          const existingFile = await fileHandle.getFile();
          const existingBytes = new Uint8Array(await existingFile.arrayBuffer());

          const uniqueVfsName = `/${Date.now()}_${Math.random().toString(36).slice(2)}_${cleanName}`;
          if (existingBytes.byteLength > 0) {
            sqlite3.capi.sqlite3_js_posix_create_file(uniqueVfsName, existingBytes);
          }

          this.db = new sqlite3.oo1.DB(uniqueVfsName, 'c');
          this.persistenceMode = 'opfs-async-handle';
          this.db.exec('PRAGMA foreign_keys = ON;');

          this.persistCallback = async () => {
            if (!this.db || !this.sqlite3) return;
            const exported = this.sqlite3.capi.sqlite3_js_db_export(this.db);
            const writable = await fileHandle.createWritable();
            await writable.write(exported);
            await writable.close();
          };
          return;
        } catch {
          // Fall through to in-memory DB if OPFS is blocked by browser context
        }
      }

      this.db = new sqlite3.oo1.DB(':memory:', 'c');
      this.persistenceMode = 'memory';
      this.db.exec('PRAGMA foreign_keys = ON;');
      return;
    }

    // 2. Node.js CLI / Test Environment: Persist SQLite-Wasm database bytes to local .opfs directory
    const fs = await import('node:fs');
    const path = await import('node:path');
    const opfsDir =
      this.nodeOpfsDir ?? process.env.OPFS_DIR ?? path.resolve(process.cwd(), '.opfs');
    fs.mkdirSync(opfsDir, { recursive: true });
    const fullDiskPath = path.resolve(opfsDir, cleanName);

    const uniqueVfsName = `/${Date.now()}_${Math.random().toString(36).slice(2)}_${cleanName}`;
    if (fs.existsSync(fullDiskPath)) {
      const existingBytes = fs.readFileSync(fullDiskPath);
      if (existingBytes.byteLength > 0) {
        sqlite3.capi.sqlite3_js_posix_create_file(uniqueVfsName, new Uint8Array(existingBytes));
      }
    }

    this.db = new sqlite3.oo1.DB(uniqueVfsName, 'c');
    this.persistenceMode = 'node-opfs-file';
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.persistCallback = async () => {
      if (!this.db || !this.sqlite3) return;
      const exported = this.sqlite3.capi.sqlite3_js_db_export(this.db);
      fs.mkdirSync(path.dirname(fullDiskPath), { recursive: true });
      fs.writeFileSync(fullDiskPath, Buffer.from(exported));
    };
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(work, work);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private queryInternal<T = Record<string, SqlParam>>(
    sql: string,
    params?: readonly SqlParam[],
  ): T[] {
    if (!this.db) {
      throw new Error('SqliteWasmAdapter is not initialized.');
    }
    const rows: Record<string, SqlValue>[] = [];
    this.db.exec({
      sql,
      bind: params && params.length > 0 ? (params as readonly SqlValue[]) : undefined,
      rowMode: 'object',
      resultRows: rows,
    });
    return rows as unknown as T[];
  }

  private async execInternal(sql: string, params?: readonly SqlParam[]): Promise<void> {
    if (!this.db) {
      throw new Error('SqliteWasmAdapter is not initialized.');
    }
    if (params && params.length > 0) {
      this.db.exec({
        sql,
        bind: params as readonly SqlValue[],
      });
    } else {
      this.db.exec(sql);
    }
    if (this.txDepth === 0 && this.persistCallback) {
      await this.persistCallback();
    }
  }

  async query<T = Record<string, SqlParam>>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<T[]> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      const rows = this.queryInternal<T>(sql, params);
      if (
        this.txDepth === 0 &&
        this.persistCallback &&
        /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql)
      ) {
        await this.persistCallback();
      }
      return rows;
    });
  }

  async exec(sql: string, params?: readonly SqlParam[]): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      await this.execInternal(sql, params);
    });
  }

  async transaction<T>(fn: (tx: DatabasePort) => Promise<T> | T): Promise<T> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      return this.runTransactionInternal(fn);
    });
  }

  private async runTransactionInternal<T>(fn: (tx: DatabasePort) => Promise<T> | T): Promise<T> {
    if (!this.db) {
      throw new Error('SqliteWasmAdapter is not initialized.');
    }

    const isNested = this.txDepth > 0;
    const savepointName = isNested ? `sp_${++this.savepointCounter}` : '';

    this.txDepth++;
    if (isNested) {
      this.db.exec(`SAVEPOINT ${savepointName}`);
    } else {
      this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    }

    const txPort: DatabasePort = {
      query: async <R = Record<string, SqlParam>>(
        sql: string,
        params?: readonly SqlParam[],
      ): Promise<R[]> => {
        return this.queryInternal<R>(sql, params);
      },
      exec: async (sql: string, params?: readonly SqlParam[]): Promise<void> => {
        await this.execInternal(sql, params);
      },
      transaction: async <R>(nestedFn: (nestedTx: DatabasePort) => Promise<R> | R): Promise<R> => {
        return this.runTransactionInternal(nestedFn);
      },
      close: async (): Promise<void> => {
        throw new Error('Cannot close database inside an active transaction.');
      },
    };

    try {
      const result = await fn(txPort);
      if (isNested) {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      } else {
        this.db.exec('COMMIT');
      }
      this.txDepth--;
      if (this.txDepth === 0 && this.persistCallback) {
        await this.persistCallback();
      }
      return result;
    } catch (error) {
      try {
        if (isNested) {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
        } else {
          this.db.exec('ROLLBACK');
        }
      } catch {
        // Ignore rollback error if SQLite already rolled back the transaction
      }
      this.txDepth--;
      throw error;
    }
  }

  async close(): Promise<void> {
    return this.enqueue(async () => {
      if (this.db) {
        if (this.persistCallback) {
          await this.persistCallback();
        }
        this.db.close();
        this.db = null;
        this.initPromise = null;
      }
    });
  }
}
