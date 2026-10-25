import assert from 'node:assert/strict';
import test from 'node:test';
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

test('Prompt 5 Acceptance: With seeded data, low-stock list matches hand-written SQL query exactly and falls back to "low" badge before outflow movements', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);

  const refTimestamp = '2026-10-25T12:00:00.000Z';
  const dashboardRows = await queryLowStockDashboard(db, {
    referenceTimestamp: refTimestamp,
  });

  // Hand-written SQL query against the same database
  const handWrittenRows = await db.query<{
    medication_id: number;
    brand_name: string;
    current_qty: number;
    reorder_level: number;
    ratio: number;
    zone: string;
    shelf: string;
    bin: string;
    location_note: string;
  }>(`
    SELECT
      m.id AS medication_id,
      m.brand_name,
      COALESCE(SUM(b.quantity), 0) AS current_qty,
      m.reorder_level,
      CASE
        WHEN m.reorder_level = 0 THEN 0.0
        ELSE CAST(COALESCE(SUM(b.quantity), 0) AS REAL) / CAST(m.reorder_level AS REAL)
      END AS ratio,
      m.zone,
      m.shelf,
      m.bin,
      m.location_note
    FROM medication m
    LEFT JOIN batch b ON b.medication_id = m.id
    GROUP BY m.id
    HAVING COALESCE(SUM(b.quantity), 0) <= m.reorder_level
    ORDER BY ratio ASC, current_qty ASC, m.id ASC
  `);

  assert.equal(dashboardRows.length, handWrittenRows.length);
  assert.equal(dashboardRows.length, 1);

  assert.deepEqual(
    dashboardRows.map((r) => ({
      medication_id: r.medication_id,
      brand_name: r.brand_name,
      current_qty: r.current_qty,
      reorder_level: r.reorder_level,
      ratio: r.stock_to_reorder_ratio,
      zone: r.zone,
      shelf: r.shelf,
      bin: r.bin,
      location_note: r.location_note,
    })),
    handWrittenRows.map((r) => ({
      medication_id: Number(r.medication_id),
      brand_name: r.brand_name,
      current_qty: Number(r.current_qty),
      reorder_level: Number(r.reorder_level),
      ratio: Number(r.ratio),
      zone: r.zone,
      shelf: r.shelf,
      bin: r.bin,
      location_note: r.location_note,
    })),
  );

  // Verify seeded Ventolin HFA (#2): stock = 6, reorder_level = 15, ratio = 0.4, fallback badge = 'low'
  const ventolin = dashboardRows[0];
  assert.equal(ventolin.brand_name, 'Ventolin HFA');
  assert.equal(ventolin.current_qty, 6);
  assert.equal(ventolin.reorder_level, 15);
  assert.equal(ventolin.stock_to_reorder_ratio, 6 / 15);
  assert.equal(ventolin.location_label, 'Zone B · Shelf B2 · Bin 04');
  assert.equal(ventolin.suggested_qty, null);
  assert.equal(ventolin.reorder_badge, 'low');

  await db.close();
});

test('Prompt 5 Acceptance: Reorder suggestion updates deterministically in SQL when stock movements are added', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);

  const refTimestamp = '2026-10-25T12:00:00.000Z';

  // 1. Before any negative stock_movement: fallback badge is 'low'
  const before = await queryLowStockDashboard(db, { referenceTimestamp: refTimestamp });
  assert.equal(before[0].medication_id, 2);
  assert.equal(before[0].suggested_qty, null);
  assert.equal(before[0].reorder_badge, 'low');

  // 2. Add stock movements within the 90-day window for Ventolin HFA (lead_time_days = 7):
  // Receive 90 units and dispense 90 units -> current_qty remains 6, total_outflow_90d = 90
  // avg_daily_usage = 90 / 90 = 1.0
  // suggested_qty = ceil(1.0 * 7 * 1.3) - 6 = ceil(9.1) - 6 = 10 - 6 = 4
  const receipt = await receiveStock(db, {
    medicationId: 2,
    lotNumber: 'VEN-90D-CYCLE',
    expiryDate: '2027-05-01',
    quantity: 90,
    reason: 'restock_cycle',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-10T09:00:00.000Z',
  });
  await dispenseStock(db, {
    medicationId: 2,
    batchId: receipt.batch.id,
    quantity: 90,
    reason: 'dispense_cycle',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-15T10:00:00.000Z',
  });

  const afterFirstCycle = await queryLowStockDashboard(db, {
    referenceTimestamp: refTimestamp,
  });
  assert.equal(afterFirstCycle[0].current_qty, 6);
  assert.equal(afterFirstCycle[0].total_outflow_90d, 90);
  assert.equal(afterFirstCycle[0].avg_daily_usage, 1.0);
  assert.equal(afterFirstCycle[0].lead_time_days, 7);
  assert.equal(afterFirstCycle[0].suggested_qty, 4);
  assert.equal(afterFirstCycle[0].reorder_badge, 'suggested');

  // 3. Dispense 3 more units from Ventolin HFA's remaining stock (6 -> 3):
  // total_outflow_90d = 93 -> avg_daily_usage = 93 / 90 = 1.033333...
  // raw_target = (93 / 90) * 7 * 1.3 = 9.403333... -> ceil = 10
  // suggested_qty = 10 - 3 = 7
  await dispenseStock(db, {
    medicationId: 2,
    quantity: 3,
    reason: 'dispense:walk_in',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-20T14:00:00.000Z',
  });

  const afterDispense = await queryLowStockDashboard(db, {
    referenceTimestamp: refTimestamp,
  });
  assert.equal(afterDispense[0].current_qty, 3);
  assert.equal(afterDispense[0].total_outflow_90d, 93);
  assert.equal(afterDispense[0].suggested_qty, 7);
  assert.equal(afterDispense[0].reorder_badge, 'suggested');

  await db.close();
});

test('Low-stock SQL handles divide-by-zero when reorder_level is 0 and sorts by (quantity / reorder_level) ascending', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);

  const repo = createRepository(db);

  // Insert a medication with reorder_level = 0 and 0 stock (0 <= 0, divide-by-zero edge case)
  const zeroReorderMed = await repo.insertMedication({
    brand_name: 'ZeroThresholdMed',
    generic_name: 'Placebo',
    strength: '10 mg',
    dosage_form: 'Tablet',
    zone: 'D',
    shelf: 'D1',
    bin: '01',
    reorder_level: 0,
    lead_time_days: 7,
  });

  // Insert another low-stock medication with stock = 2, reorder_level = 10 (ratio = 0.2)
  const ratioPointTwoMed = await repo.insertMedication({
    brand_name: 'QuarterStockMed',
    generic_name: 'Testolol',
    strength: '5 mg',
    dosage_form: 'Tablet',
    zone: 'D',
    shelf: 'D2',
    bin: '02',
    reorder_level: 10,
    lead_time_days: 7,
  });
  await receiveStock(db, {
    medicationId: ratioPointTwoMed.id,
    lotNumber: 'QSM-01',
    expiryDate: '2027-09-01',
    quantity: 2,
    reason: 'initial',
    userId: 'pharmacist:test',
  });

  const rows = await queryLowStockDashboard(db, {
    referenceTimestamp: '2026-10-25T12:00:00.000Z',
  });

  // Expected order by ratio ascending:
  // 1. ZeroThresholdMed: current_qty = 0, reorder_level = 0 -> ratio = 0.0
  // 2. QuarterStockMed:  current_qty = 2, reorder_level = 10 -> ratio = 0.2
  // 3. Ventolin HFA:     current_qty = 6, reorder_level = 15 -> ratio = 0.4
  assert.equal(rows.length, 3);
  assert.equal(rows[0].medication_id, zeroReorderMed.id);
  assert.equal(rows[0].stock_to_reorder_ratio, 0);
  assert.equal(rows[1].medication_id, ratioPointTwoMed.id);
  assert.equal(rows[1].stock_to_reorder_ratio, 0.2);
  assert.equal(rows[2].medication_id, 2);
  assert.equal(rows[2].stock_to_reorder_ratio, 0.4);

  await db.close();
});

test('Expiring-soon dashboard lists batches expiring within 90 days grouped by medication and sorted by expiry date, and exports both lists to CSV', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);

  // Add a second expiring batch to Ventolin HFA (#2) expiring on 2026-12-05 (41 days from 2026-10-25)
  await receiveStock(db, {
    medicationId: 2,
    lotNumber: 'VEN-2026-09',
    expiryDate: '2026-12-05',
    quantity: 4,
    reason: 'short_dated_transfer',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-20T09:00:00.000Z',
  });

  const expiring = await queryExpiringSoonDashboard(db, {
    referenceDate: '2026-10-25',
    withinDays: 90,
  });

  // Flat batches must be sorted by expiry_date ascending:
  // 1. VEN-2026-02 (2026-11-24, 30 days remaining, qty 6)
  // 2. VEN-2026-09 (2026-12-05, 41 days remaining, qty 4)
  // 3. LAN-2026-08 (2026-12-19, 55 days remaining, qty 18)
  assert.equal(expiring.batches.length, 3);
  assert.deepEqual(
    expiring.batches.map((b) => ({
      lot: b.lot_number,
      qty: b.quantity,
      expiry: b.expiry_date,
      days: b.days_remaining,
    })),
    [
      { lot: 'VEN-2026-02', qty: 6, expiry: '2026-11-24', days: 30 },
      { lot: 'VEN-2026-09', qty: 4, expiry: '2026-12-05', days: 41 },
      { lot: 'LAN-2026-08', qty: 18, expiry: '2026-12-19', days: 55 },
    ],
  );

  // Grouped by medication: Ventolin HFA group has 2 batches (total 10), Lantus SoloStar group has 1 batch (total 18)
  assert.equal(expiring.groups.length, 2);
  assert.equal(expiring.groups[0].brand_name, 'Ventolin HFA');
  assert.equal(expiring.groups[0].batches.length, 2);
  assert.equal(expiring.groups[0].total_expiring_qty, 10);
  assert.equal(expiring.groups[1].brand_name, 'Lantus SoloStar');
  assert.equal(expiring.groups[1].batches.length, 1);
  assert.equal(expiring.groups[1].total_expiring_qty, 18);

  // Verify CSV exports for both lists
  const lowStockRows = await queryLowStockDashboard(db, {
    referenceTimestamp: '2026-10-25T12:00:00.000Z',
  });
  const lowStockCsv = exportLowStockToCsv(lowStockRows);
  assert.ok(lowStockCsv.includes('medication_id,brand_name,generic_name'));
  assert.ok(lowStockCsv.includes('Ventolin HFA'));

  const expiringCsv = exportExpiringSoonToCsv(expiring.groups);
  assert.ok(expiringCsv.includes('lot_number,quantity,expiry_date,days_remaining'));
  assert.ok(expiringCsv.includes('VEN-2026-02,6,2026-11-24,30'));
  assert.ok(expiringCsv.includes('LAN-2026-08,18,2026-12-19,55'));

  await db.close();
});
