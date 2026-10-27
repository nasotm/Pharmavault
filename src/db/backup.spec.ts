import { describe, expect, it, vi } from 'vitest';
import { exportDatabaseBackup, restoreDatabaseBackup, validateBackupJson } from './backup';
import type { DatabasePort } from './port';

describe('Database Backup and Restore Logic', () => {
  it('validates backup JSON structure correctly', () => {
    // Null / non-object
    expect(validateBackupJson(null).ok).toBe(false);
    expect(validateBackupJson('string').ok).toBe(false);

    // Missing tables object
    expect(validateBackupJson({ foo: 'bar' }).ok).toBe(false);

    // Missing required table arrays
    expect(
      validateBackupJson({
        tables: {
          medication: [],
          medication_alias: [],
          batch: [],
        },
      }).ok,
    ).toBe(false);

    // Valid structure
    const valid = validateBackupJson({
      version: 1,
      appName: 'PharmaVault Inventory',
      exportedAt: new Date().toISOString(),
      counts: {
        medications: 1,
        aliases: 0,
        batches: 1,
        movements: 1,
        priceHistory: 1,
      },
      tables: {
        medication: [{ id: 1, brand_name: 'Amoxil' }],
        medication_alias: [],
        batch: [{ id: 1, medication_id: 1, quantity: 100 }],
        stock_movement: [{ id: 1, medication_id: 1, delta: 100 }],
        price_history: [{ id: 1, medication_id: 1, unit_price_cents: 1250 }],
      },
    });

    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.backup.tables.medication.length).toBe(1);
    }
  });

  it('exports database records by querying all 5 tables', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM medication_alias')) return Promise.resolve([]);
        if (sql.includes('FROM medication')) return Promise.resolve([{ id: 1, brand_name: 'Amoxil' }]);
        if (sql.includes('FROM batch')) return Promise.resolve([{ id: 10, quantity: 50 }]);
        if (sql.includes('FROM stock_movement')) return Promise.resolve([{ id: 100, delta: 50 }]);
        if (sql.includes('FROM price_history')) return Promise.resolve([{ id: 1000, unit_price_cents: 1250 }]);
        return Promise.resolve([]);
      }),
    } as unknown as DatabasePort;

    const backup = await exportDatabaseBackup(mockDb);
    expect(backup.version).toBe(1);
    expect(backup.counts.medications).toBe(1);
    expect(backup.counts.batches).toBe(1);
    expect(backup.tables.medication[0].brand_name).toBe('Amoxil');
  });

  it('restores backup atomically using db transaction', async () => {
    const executedSql: string[] = [];
    const mockDb = {
      query: vi.fn().mockResolvedValue([]),
      exec: vi.fn().mockImplementation((sql: string) => {
        executedSql.push(sql);
        return Promise.resolve();
      }),
      execute: vi.fn().mockImplementation((sql: string) => {
        executedSql.push(sql);
        return Promise.resolve();
      }),
      transaction: vi.fn().mockImplementation(async (cb: (tx: DatabasePort) => Promise<void>) => {
        await cb(mockDb);
      }),
    } as unknown as DatabasePort;

    const backup = {
      version: 1,
      appName: 'PharmaVault Inventory',
      exportedAt: new Date().toISOString(),
      counts: { medications: 1, aliases: 0, batches: 1, movements: 1, priceHistory: 1 },
      tables: {
        medication: [{ id: 1, brand_name: 'Amoxil' }],
        medication_alias: [],
        batch: [{ id: 10, medication_id: 1, quantity: 50 }],
        stock_movement: [{ id: 100, medication_id: 1, delta: 50 }],
        price_history: [{ id: 1000, medication_id: 1, unit_price_cents: 1250 }],
      },
    };

    const res = await restoreDatabaseBackup(mockDb, backup);
    expect(res.restoredCounts.medications).toBe(1);
    expect(executedSql.some((s) => s.includes('DROP TABLE IF EXISTS stock_movement'))).toBe(true);
    expect(executedSql.some((s) => s.includes('INSERT INTO medication'))).toBe(true);
  });
});
