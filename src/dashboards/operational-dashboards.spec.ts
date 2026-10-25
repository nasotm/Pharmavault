import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate';
import { createRepository } from '../db/repository';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import { dispenseStock, receiveStock } from '../movements';
import {
  exportExpiringSoonToCsv,
  exportLowStockToCsv,
  queryExpiringSoonDashboard,
  queryLowStockDashboard,
} from './operational-dashboards';

describe('Prompt 5 Acceptance Criteria: Deterministic SQL Operational Dashboards', () => {
  it('matches a hand-written SQL query on seeded data and updates reorder suggestion when movements are added', async () => {
    const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);

    const refTimestamp = '2026-10-25T12:00:00.000Z';
    const lowStock = await queryLowStockDashboard(db, {
      referenceTimestamp: refTimestamp,
    });

    const handWritten = await db.query<{
      medication_id: number;
      brand_name: string;
      current_qty: number;
      reorder_level: number;
      ratio: number;
    }>(`
      SELECT
        m.id AS medication_id,
        m.brand_name,
        COALESCE(SUM(b.quantity), 0) AS current_qty,
        m.reorder_level,
        CASE
          WHEN m.reorder_level <= 0 THEN 0.0
          ELSE CAST(COALESCE(SUM(b.quantity), 0) AS REAL) / CAST(m.reorder_level AS REAL)
        END AS ratio
      FROM medication m
      LEFT JOIN batch b ON b.medication_id = m.id
      GROUP BY m.id
      HAVING COALESCE(SUM(b.quantity), 0) <= m.reorder_level
      ORDER BY ratio ASC, current_qty ASC, m.id ASC
    `);

    expect(
      lowStock.map((r) => ({
        medication_id: r.medication_id,
        brand_name: r.brand_name,
        current_qty: r.current_qty,
        reorder_level: r.reorder_level,
        ratio: r.stock_to_reorder_ratio,
      })),
    ).toEqual(
      handWritten.map((r) => ({
        medication_id: Number(r.medication_id),
        brand_name: r.brand_name,
        current_qty: Number(r.current_qty),
        reorder_level: Number(r.reorder_level),
        ratio: Number(r.ratio),
      })),
    );

    // Fallback to plain 'low' badge before negative movements
    expect(lowStock[0].reorder_badge).toBe('low');
    expect(lowStock[0].suggested_qty).toBeNull();

    // Add 90d movements (+90 received, -90 dispensed) -> avg_daily_usage = 1.0, suggested_qty = ceil(1 * 7 * 1.3) - 6 = 4
    const receipt = await receiveStock(db, {
      medicationId: 2,
      lotNumber: 'VEN-CYCLE-1',
      expiryDate: '2027-06-30',
      quantity: 90,
      reason: 'restock',
      userId: 'pharmacist:claire.dupont',
      createdAt: '2026-10-05T10:00:00.000Z',
    });
    await dispenseStock(db, {
      medicationId: 2,
      batchId: receipt.batch.id,
      quantity: 90,
      reason: 'dispense',
      userId: 'pharmacist:claire.dupont',
      createdAt: '2026-10-15T10:00:00.000Z',
    });

    const updatedLowStock = await queryLowStockDashboard(db, {
      referenceTimestamp: refTimestamp,
    });
    expect(updatedLowStock[0].avg_daily_usage).toBeCloseTo(1.0, 5);
    expect(updatedLowStock[0].suggested_qty).toBe(4);
    expect(updatedLowStock[0].reorder_badge).toBe('suggested');

    await db.close();
  });

  it('handles divide-by-zero when reorder_level is 0, queries batches expiring within 90 days grouped by medication, and exports CSVs', async () => {
    const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);

    const repo = createRepository(db);
    const zeroMed = await repo.insertMedication({
      brand_name: 'ZeroReorderItem',
      generic_name: 'Saline',
      strength: '0.9%',
      dosage_form: 'Vial',
      zone: 'A',
      shelf: 'A9',
      bin: '01',
      reorder_level: 0,
    });

    const lowStock = await queryLowStockDashboard(db, {
      referenceTimestamp: '2026-10-25T12:00:00.000Z',
    });
    expect(lowStock[0].medication_id).toBe(zeroMed.id);
    expect(lowStock[0].stock_to_reorder_ratio).toBe(0);
    // Default lead_time_days is 7
    expect(lowStock[0].lead_time_days).toBe(7);

    const expiring = await queryExpiringSoonDashboard(db, {
      referenceDate: '2026-10-25',
      withinDays: 90,
    });
    expect(expiring.batches.length).toBe(2);
    expect(expiring.batches[0].lot_number).toBe('VEN-2026-02');
    expect(expiring.batches[0].days_remaining).toBe(30);
    expect(expiring.batches[1].lot_number).toBe('LAN-2026-08');
    expect(expiring.batches[1].days_remaining).toBe(55);

    const lowStockCsv = exportLowStockToCsv(lowStock);
    const expiringCsv = exportExpiringSoonToCsv(expiring.groups);
    expect(lowStockCsv).toContain('ZeroReorderItem');
    expect(expiringCsv).toContain('VEN-2026-02');
    expect(expiringCsv).toContain('LAN-2026-08');

    await db.close();
  });
});
