import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate';
import { createRepository } from '../db/repository';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import { dispenseStock, receiveStock } from '../movements';
import {
  calculateStockoutPredictionMetrics,
  exportExpiringSoonToCsv,
  exportLowStockToCsv,
  queryExpiringSoonDashboard,
  queryLowStockDashboard,
  queryStockoutPredictions,
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

test('AI Stockout Prediction: pure TypeScript math calculates Avg Daily Usage, Days Remaining, and Critical Prediction deterministically', () => {
  // 1. Critical Prediction: currentStock = 6, totalOutflow30d = 90 -> avgDailyUsage = 3.0 -> daysRemaining = 2.0 (< 7)
  const critical = calculateStockoutPredictionMetrics({
    currentStock: 6,
    totalOutflow30d: 90,
    outflowMovementCount30d: 2,
  });
  assert.equal(critical.avgDailyUsage, 3.0);
  assert.equal(critical.daysRemaining, 2.0);
  assert.equal(critical.hasSufficientHistory, true);
  assert.equal(critical.isCriticalPrediction, true);
  assert.equal(critical.predictionLabel, 'Critical Prediction');

  // 2. Stable (>= 7 days remaining): currentStock = 21, totalOutflow30d = 90 -> avgDailyUsage = 3.0 -> daysRemaining = 7.0 (not < 7)
  const stableBoundary = calculateStockoutPredictionMetrics({
    currentStock: 21,
    totalOutflow30d: 90,
    outflowMovementCount30d: 1,
  });
  assert.equal(stableBoundary.avgDailyUsage, 3.0);
  assert.equal(stableBoundary.daysRemaining, 7.0);
  assert.equal(stableBoundary.hasSufficientHistory, true);
  assert.equal(stableBoundary.isCriticalPrediction, false);
  assert.equal(stableBoundary.predictionLabel, 'Stable');

  // 3. Insufficient History (no negative movements in last 30d): must NOT flag Critical Prediction even if currentStock is 0
  const noHistory = calculateStockoutPredictionMetrics({
    currentStock: 0,
    totalOutflow30d: 0,
    outflowMovementCount30d: 0,
  });
  assert.equal(noHistory.avgDailyUsage, 0);
  assert.equal(noHistory.daysRemaining, null);
  assert.equal(noHistory.hasSufficientHistory, false);
  assert.equal(noHistory.isCriticalPrediction, false);
  assert.equal(noHistory.predictionLabel, 'Insufficient History');
});

test('AI Stockout Prediction: SQL query and view compute 30-day average daily usage, Days Remaining = Current Stock / Avg Daily Usage, and Critical Prediction flag', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);

  const refTimestamp = '2026-10-25T12:00:00.000Z';

  // 1. Before any negative stock movements, positive initial_receipt movements are ignored
  const initialPredictions = await queryStockoutPredictions(db, {
    referenceTimestamp: refTimestamp,
  });
  assert.equal(initialPredictions.length, 5);
  for (const row of initialPredictions) {
    assert.equal(row.total_outflow_30d, 0);
    assert.equal(row.avg_daily_usage, 0);
    assert.equal(row.days_remaining, null);
    assert.equal(row.has_sufficient_history, false);
    assert.equal(row.is_critical_prediction, false);
    assert.equal(row.prediction_label, 'Insufficient History');
  }

  // 2. Record a negative movement OLDER than 30 days (45 days before refTimestamp) -> must be ignored by 30-day window
  const oldReceipt = await receiveStock(db, {
    medicationId: 4, // Lipitor
    lotNumber: 'LIP-OLD',
    expiryDate: '2028-01-31',
    quantity: 60,
    reason: 'old_restock',
    userId: 'pharmacist:test',
    createdAt: '2026-09-01T10:00:00.000Z',
  });
  await dispenseStock(db, {
    medicationId: 4,
    batchId: oldReceipt.batch.id,
    quantity: 60,
    reason: 'dispense:old',
    userId: 'pharmacist:test',
    createdAt: '2026-09-05T10:00:00.000Z', // 50 days before 2026-10-25
  });

  // 3. Record 30-day negative movements for Ventolin HFA (#2, current_stock = 6):
  // Receive 90 and dispense 90 within the 30-day window -> current_stock remains 6, total_outflow_30d = 90
  // avg_daily_usage = 90 / 30 = 3.0
  // days_remaining = 6 / 3.0 = 2.0 (< 7 -> Critical Prediction!)
  const ventolinReceipt = await receiveStock(db, {
    medicationId: 2,
    lotNumber: 'VEN-30D',
    expiryDate: '2027-06-01',
    quantity: 90,
    reason: 'restock',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-10T09:00:00.000Z',
  });
  await dispenseStock(db, {
    medicationId: 2,
    batchId: ventolinReceipt.batch.id,
    quantity: 90,
    reason: 'dispense',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-18T11:00:00.000Z',
  });

  // 4. Record 30-day negative movement for Amoxil (#1, current_stock = 125 -> dispense 25 -> current_stock = 100):
  // total_outflow_30d = 25 -> avg_daily_usage = 25 / 30 = 0.8333...
  // days_remaining = 100 / (25 / 30) = 120.0 (>= 7 -> Stable)
  await dispenseStock(db, {
    medicationId: 1,
    quantity: 25,
    reason: 'dispense',
    userId: 'pharmacist:claire.dupont',
    createdAt: '2026-10-20T15:00:00.000Z',
  });

  const predictions = await queryStockoutPredictions(db, {
    referenceTimestamp: refTimestamp,
  });

  // First item sorted by urgency: Ventolin HFA (#2) with 2.0 days remaining (Critical Prediction)
  const ventolinPred = predictions[0];
  assert.equal(ventolinPred.medication_id, 2);
  assert.equal(ventolinPred.brand_name, 'Ventolin HFA');
  assert.equal(ventolinPred.current_stock, 6);
  assert.equal(ventolinPred.total_outflow_30d, 90);
  assert.equal(ventolinPred.avg_daily_usage, 3.0);
  assert.equal(ventolinPred.days_remaining, 2.0);
  assert.equal(ventolinPred.has_sufficient_history, true);
  assert.equal(ventolinPred.is_critical_prediction, true);
  assert.equal(ventolinPred.prediction_label, 'Critical Prediction');

  // Second item with history: Amoxil (#1) with 120.0 days remaining (Stable)
  const amoxilPred = predictions[1];
  assert.equal(amoxilPred.medication_id, 1);
  assert.equal(amoxilPred.brand_name, 'Amoxil');
  assert.equal(amoxilPred.current_stock, 100);
  assert.equal(amoxilPred.total_outflow_30d, 25);
  assert.ok(Math.abs(amoxilPred.avg_daily_usage - 25 / 30) < 1e-9);
  assert.ok(Math.abs((amoxilPred.days_remaining ?? 0) - 120.0) < 1e-9);
  assert.equal(amoxilPred.has_sufficient_history, true);
  assert.equal(amoxilPred.is_critical_prediction, false);
  assert.equal(amoxilPred.prediction_label, 'Stable');

  // Lipitor (#4) had only a movement 50 days ago, so 30d outflow is 0
  const lipitorPred = predictions.find((p) => p.medication_id === 4);
  assert.ok(lipitorPred);
  assert.equal(lipitorPred.total_outflow_30d, 0);
  assert.equal(lipitorPred.days_remaining, null);
  assert.equal(lipitorPred.is_critical_prediction, false);

  // Verify SQL view v_stockout_prediction_30d exists and is queryable
  const viewRows = await db.query<{ medication_id: number; current_stock: number }>(
    'SELECT medication_id, current_stock FROM v_stockout_prediction_30d ORDER BY medication_id ASC',
  );
  assert.equal(viewRows.length, 5);

  await db.close();
});

