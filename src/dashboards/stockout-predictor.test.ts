import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../db/migrate';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import { dispenseStock, receiveStock } from '../movements';
import {
  calculateStockoutPredictionMetrics,
  queryStockoutPredictions,
  synthesizeStockoutPredictionInsight,
  type StockoutPredictionRow,
} from './operational-dashboards';

test('calculateStockoutPredictionMetrics: pure deterministic TypeScript math', () => {
  // Scenario 1: Amoxil with current stock = 12, 30d usage = 90 (avg = 3.0/day)
  // Days Remaining = 12 / 3.0 = 4.0 days (between 0 and 7 -> Critical Prediction!)
  const critical = calculateStockoutPredictionMetrics({
    currentStock: 12,
    totalOutflow30d: 90,
    outflowMovementCount30d: 5,
    reorderLevel: 20,
  });

  assert.equal(critical.avgDailyUsage, 3.0);
  assert.equal(critical.daysRemaining, 4.0);
  assert.equal(critical.hasSufficientHistory, true);
  assert.equal(critical.isCriticalPrediction, true);
  assert.equal(critical.predictionLabel, 'Critical Prediction');
  // Target buffer = max(20 * 1.5, 3 * 30) = max(30, 90) = 90
  // Suggested reorder = 90 - 12 = 78 units
  assert.equal(critical.suggestedReorderQty, 78);

  // Scenario 2: Healthy stock, 100 units, avg = 1.0/day -> Days Remaining = 100 days (> 7 -> Stable)
  const stable = calculateStockoutPredictionMetrics({
    currentStock: 100,
    totalOutflow30d: 30,
    outflowMovementCount30d: 2,
    reorderLevel: 10,
  });

  assert.equal(stable.avgDailyUsage, 1.0);
  assert.equal(stable.daysRemaining, 100.0);
  assert.equal(stable.hasSufficientHistory, true);
  assert.equal(stable.isCriticalPrediction, false);
  assert.equal(stable.predictionLabel, 'Stable');

  // Scenario 3: Zero outflow (insufficient 30-day history)
  const noHistory = calculateStockoutPredictionMetrics({
    currentStock: 50,
    totalOutflow30d: 0,
    outflowMovementCount30d: 0,
    reorderLevel: 15,
  });

  assert.equal(noHistory.avgDailyUsage, 0);
  assert.equal(noHistory.daysRemaining, null);
  assert.equal(noHistory.hasSufficientHistory, false);
  assert.equal(noHistory.isCriticalPrediction, false);
  assert.equal(noHistory.predictionLabel, 'Insufficient History');
  assert.equal(noHistory.suggestedReorderQty, 1); // target 30 - current 50 = -20 clamped to minimum 1

  // Scenario 4: Boundary test at 0 days remaining (completely out of stock with usage)
  const zeroStock = calculateStockoutPredictionMetrics({
    currentStock: 0,
    totalOutflow30d: 60,
    outflowMovementCount30d: 4,
    reorderLevel: 25,
  });
  assert.equal(zeroStock.avgDailyUsage, 2.0);
  assert.equal(zeroStock.daysRemaining, 0);
  assert.equal(zeroStock.isCriticalPrediction, true);
  assert.equal(zeroStock.suggestedReorderQty, 60);

  // Scenario 5: Boundary test at 6.67 days (< 7 critical) and 7.0 days (>= 7 stable)
  const criticalSub7 = calculateStockoutPredictionMetrics({
    currentStock: 20,
    totalOutflow30d: 90, // avg 3.0/day -> 20 / 3 = 6.666... days
    outflowMovementCount30d: 3,
    reorderLevel: 10,
  });
  assert.equal(criticalSub7.isCriticalPrediction, true);

  const exact7Days = calculateStockoutPredictionMetrics({
    currentStock: 21,
    totalOutflow30d: 90, // avg 3.0/day -> 21 / 3 = 7.0 days
    outflowMovementCount30d: 3,
    reorderLevel: 10,
  });
  assert.equal(exact7Days.daysRemaining, 7.0);
  assert.equal(exact7Days.isCriticalPrediction, false);
});

test('synthesizeStockoutPredictionInsight: formats human-readable insight strictly from deterministic numbers', () => {
  const mockPredictions: StockoutPredictionRow[] = [
    {
      medication_id: 1,
      brand_name: 'Amoxil',
      generic_name: 'Amoxicilline',
      strength: '500 mg',
      dosage_form: 'Gélule',
      zone: 'A',
      shelf: '1',
      bin: '02',
      location_note: null,
      location_label: 'A-1-02',
      current_stock: 12,
      reorder_level: 20,
      total_outflow_30d: 90,
      outflow_movement_count_30d: 4,
      avg_daily_usage: 3.0,
      days_remaining: 4.0,
      has_sufficient_history: true,
      is_critical_prediction: true,
      prediction_label: 'Critical Prediction',
      suggested_reorder_qty: 78,
    },
    {
      medication_id: 2,
      brand_name: 'Doliprane',
      generic_name: 'Paracétamol',
      strength: '1000 mg',
      dosage_form: 'Comprimé',
      zone: 'B',
      shelf: '2',
      bin: '01',
      location_note: null,
      location_label: 'B-2-01',
      current_stock: 150,
      reorder_level: 30,
      total_outflow_30d: 60,
      outflow_movement_count_30d: 5,
      avg_daily_usage: 2.0,
      days_remaining: 75.0,
      has_sufficient_history: true,
      is_critical_prediction: false,
      prediction_label: 'Stable',
      suggested_reorder_qty: 1,
    },
  ];

  const insight = synthesizeStockoutPredictionInsight(mockPredictions);
  assert.match(insight, /Amoxil will run out in 4\.0 days based on current sales speed/);
  assert.match(insight, /12 units in stock/);
  assert.match(insight, /3\.00\/day/);
  assert.match(insight, /Suggested reorder: 78 units/);

  // When no critical items exist
  const stableOnly = [mockPredictions[1]];
  const stableInsight = synthesizeStockoutPredictionInsight(stableOnly);
  assert.match(stableInsight, /healthy stock/);
  assert.match(stableInsight, /Doliprane with 75\.0 days remaining/);
});

test('queryStockoutPredictions: calculates 30-day usage and critical 0-7 days remaining in database', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);

  const refTimestamp = '2026-10-25T12:00:00.000Z';

  // Seed item #2 (Ventolin HFA): initial stock = 6.
  // Add 90 received and 90 dispensed in the last 30 days:
  const receipt = await receiveStock(db, {
    medicationId: 2,
    lotNumber: 'VEN-30D',
    expiryDate: '2027-06-01',
    quantity: 90,
    reason: 'restock',
    userId: 'pharmacist:claire',
    createdAt: '2026-10-10T09:00:00.000Z',
  });

  await dispenseStock(db, {
    medicationId: 2,
    batchId: receipt.batch.id,
    quantity: 90,
    reason: 'dispense',
    userId: 'pharmacist:claire',
    createdAt: '2026-10-18T11:00:00.000Z',
  });

  const predictions = await queryStockoutPredictions(db, {
    referenceTimestamp: refTimestamp,
  });

  const ventolin = predictions.find((p) => p.medication_id === 2);
  assert.ok(ventolin);
  assert.equal(ventolin.brand_name, 'Ventolin HFA');
  assert.equal(ventolin.current_stock, 6);
  assert.equal(ventolin.total_outflow_30d, 90);
  assert.equal(ventolin.avg_daily_usage, 3.0);
  assert.equal(ventolin.days_remaining, 2.0);
  assert.equal(ventolin.is_critical_prediction, true);
  assert.ok(ventolin.suggested_reorder_qty > 0);

  // Critical predictions filter matches days_remaining between 0 and 7
  const criticalOnly = predictions.filter(
    (p) =>
      p.has_sufficient_history &&
      p.days_remaining !== null &&
      p.days_remaining >= 0 &&
      p.days_remaining <= 7.0,
  );
  assert.equal(criticalOnly.length, 1);
  assert.equal(criticalOnly[0].medication_id, 2);

  await db.close();
});
