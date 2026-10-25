/**
 * Primitive parameter and column values supported by the SQLite DatabasePort boundary.
 * Money values are strictly integer cents (number) or null (unknown).
 */
export type SqlParam = string | number | null | Uint8Array;

/**
 * Isolated database port interface.
 * Nothing outside SqliteWasmAdapter may touch the underlying SQLite Wasm module directly.
 */
export interface DatabasePort {
  /**
   * Execute a read query (or RETURNING statement) and return typed rows as plain objects.
   */
  query<T = Record<string, SqlParam>>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;

  /**
   * Execute one or more DDL/DML SQL statements that do not return rows.
   */
  exec(sql: string, params?: readonly SqlParam[]): Promise<void>;

  /**
   * Execute a callback within an atomic SQLite transaction (BEGIN IMMEDIATE ... COMMIT / ROLLBACK).
   * Supports nested transactions via SQLite SAVEPOINTs.
   */
  transaction<T>(fn: (tx: DatabasePort) => Promise<T> | T): Promise<T>;

  /**
   * Close the underlying database connection and release resources.
   */
  close(): Promise<void>;
}
