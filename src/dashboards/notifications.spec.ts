import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate';
import { createRepository } from '../db/repository';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import { queryNotificationAlerts } from './notifications';

describe('Notification Center Alerts Query', () => {
  it('correctly aggregates low stock items, expiring soon batches (<=30 days), and expired batches (<0 days)', async () => {
    const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);

    const repo = createRepository(db);

    // Insert an expired batch for testing
    const med = await repo.insertMedication({
      brand_name: 'ExpiredMedTest',
      generic_name: 'TestGeneric',
      reorder_level: 50,
    });
    await repo.insertBatch({
      medication_id: med.id,
      lot_number: 'EXP-999',
      quantity: 10,
      expiry_date: '2026-09-01', // Expired compared to 2026-10-25
    });

    const alerts = await queryNotificationAlerts(db, '2026-10-25T12:00:00.000Z');

    expect(alerts.lowStockItems.length).toBeGreaterThan(0);
    expect(alerts.expiringSoonBatches.length).toBeGreaterThan(0);
    expect(alerts.expiredBatches.length).toBe(1);
    expect(alerts.expiredBatches[0].brand_name).toBe('ExpiredMedTest');
    expect(alerts.expiredBatches[0].lot_number).toBe('EXP-999');
    expect(alerts.expiredBatches[0].days_remaining).toBeLessThan(0);

    expect(alerts.totalAlertsCount).toBe(
      alerts.lowStockItems.length +
        alerts.expiringSoonBatches.length +
        alerts.expiredBatches.length,
    );

    await db.close();
  });
});
