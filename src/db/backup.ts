import { runMigrations } from './migrate';
import type { DatabasePort, SqlParam } from './port';

export type ValidationResult =
  | { ok: true; backup: BackupData }
  | { ok: false; error: string };

export interface BackupData {
  version: number;
  appName: string;
  exportedAt: string;
  counts: {
    medications: number;
    aliases: number;
    batches: number;
    movements: number;
    priceHistory: number;
  };
  tables: {
    medication: Record<string, unknown>[];
    medication_alias: Record<string, unknown>[];
    batch: Record<string, unknown>[];
    stock_movement: Record<string, unknown>[];
    price_history: Record<string, unknown>[];
  };
}

/**
 * Reads all data from the database and packages it into a BackupData object.
 */
export async function exportDatabaseBackup(db: DatabasePort): Promise<BackupData> {
  const medications = await db.query<Record<string, unknown>>(
    'SELECT * FROM medication ORDER BY id ASC',
  );
  const aliases = await db.query<Record<string, unknown>>(
    'SELECT * FROM medication_alias ORDER BY id ASC',
  );
  const batches = await db.query<Record<string, unknown>>(
    'SELECT * FROM batch ORDER BY id ASC',
  );
  const movements = await db.query<Record<string, unknown>>(
    'SELECT * FROM stock_movement ORDER BY id ASC',
  );
  const priceHistory = await db.query<Record<string, unknown>>(
    'SELECT * FROM price_history ORDER BY id ASC',
  );

  return {
    version: 1,
    appName: 'PharmaVault Inventory',
    exportedAt: new Date().toISOString(),
    counts: {
      medications: medications.length,
      aliases: aliases.length,
      batches: batches.length,
      movements: movements.length,
      priceHistory: priceHistory.length,
    },
    tables: {
      medication: medications,
      medication_alias: aliases,
      batch: batches,
      stock_movement: movements,
      price_history: priceHistory,
    },
  };
}

/**
 * Validates whether the given parsed JSON is a valid BackupData structure.
 */
export function validateBackupJson(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Backup file is not a valid JSON object.' };
  }
  const obj = data as Partial<BackupData>;
  if (!obj.tables || typeof obj.tables !== 'object') {
    return { ok: false, error: 'Backup file is missing required "tables" structure.' };
  }
  const tables = obj.tables;
  if (
    !Array.isArray(tables.medication) ||
    !Array.isArray(tables.medication_alias) ||
    !Array.isArray(tables.batch) ||
    !Array.isArray(tables.stock_movement) ||
    !Array.isArray(tables.price_history)
  ) {
    return {
      ok: false,
      error:
        'Backup file is missing required database tables (medication, batch, stock_movement, price_history).',
    };
  }

  return { ok: true, backup: obj as BackupData };
}

/**
 * Overwrites the database with the backup data cleanly and atomically.
 */
export async function restoreDatabaseBackup(
  db: DatabasePort,
  backupData: unknown,
): Promise<{ restoredCounts: BackupData['counts'] }> {
  const validation = validateBackupJson(backupData);
  if (!validation.ok) {
    const errorMsg = 'error' in validation ? validation.error : 'Invalid backup';
    throw new Error(errorMsg);
  }
  const backup = validation.backup;

  await db.transaction(async () => {
    // 1. Drop tables to bypass append-only triggers during restore
    await db.exec('DROP TABLE IF EXISTS stock_movement');
    await db.exec('DROP TABLE IF EXISTS price_history');
    await db.exec('DROP TABLE IF EXISTS batch');
    await db.exec('DROP TABLE IF EXISTS medication_alias');
    await db.exec('DROP TABLE IF EXISTS medication');

    // 2. Re-run migrations to recreate clean tables and triggers
    await runMigrations(db);

    // 3. Populate medication
    for (const row of backup.tables.medication) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => row[k]);
      await db.exec(
        `INSERT INTO medication (${keys.join(', ')}) VALUES (${placeholders})`,
        values as SqlParam[],
      );
    }

    // 4. Populate medication_alias
    for (const row of backup.tables.medication_alias) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => row[k]);
      await db.exec(
        `INSERT INTO medication_alias (${keys.join(', ')}) VALUES (${placeholders})`,
        values as SqlParam[],
      );
    }

    // 5. Populate batch
    for (const row of backup.tables.batch) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => row[k]);
      await db.exec(
        `INSERT INTO batch (${keys.join(', ')}) VALUES (${placeholders})`,
        values as SqlParam[],
      );
    }

    // 6. Populate stock_movement
    for (const row of backup.tables.stock_movement) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => row[k]);
      await db.exec(
        `INSERT INTO stock_movement (${keys.join(', ')}) VALUES (${placeholders})`,
        values as SqlParam[],
      );
    }

    // 7. Populate price_history
    for (const row of backup.tables.price_history) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => row[k]);
      await db.exec(
        `INSERT INTO price_history (${keys.join(', ')}) VALUES (${placeholders})`,
        values as SqlParam[],
      );
    }
  });

  return {
    restoredCounts: {
      medications: backup.tables.medication.length,
      aliases: backup.tables.medication_alias.length,
      batches: backup.tables.batch.length,
      movements: backup.tables.stock_movement.length,
      priceHistory: backup.tables.price_history.length,
    },
  };
}

/**
 * Triggers a browser file download for a JSON string.
 */
export function downloadJsonFile(filename: string, jsonContent: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
