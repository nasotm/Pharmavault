import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  insertMedication,
  insertBatch,
  insertMovement,
  insertPriceHistory,
  listBatchesForMedication,
  listMovementsForMedication,
  listPriceHistoryForMedication,
} from '../db/repository';
import {
  runMigrations,
  setRepositoryDatabase,
  SqliteWasmAdapter,
  type DatabasePort,
} from '../db/index';

describe('Manual Add Medication Feature', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    setRepositoryDatabase(db);
    await runMigrations(db);
  });

  afterEach(async () => {
    setRepositoryDatabase(null);
    await db.close();
  });

  it('performs atomic/sequential creation: medication, batch, price_history, and stock_movement', async () => {
    // 1. Insert medication row
    const med = await insertMedication(db, {
      brand_name: 'Augmentin 1g',
      generic_name: 'Amoxicilline / Acide Clavulanique',
      strength: '1g',
      dosage_form: 'Dispersible Tablet',
      category: 'Antibiotic',
      barcode: '613998877665',
      zone: 'B',
      shelf: '2',
      bin: '4',
      location_note: 'Main antibiotics counter',
      reorder_level: 15,
      lead_time_days: 7,
      unit_price_cents: 850,
      cost_price_cents: 620,
      currency: 'DZD',
      currency_code: 'DZD',
      units_per_pack: 1,
      price_source: 'manual',
      price_confirmed: 1,
      price_updated_at: new Date().toISOString(),
    });

    expect(med.id).toBeGreaterThan(0);
    expect(med.brand_name).toBe('Augmentin 1g');
    expect(med.unit_price_cents).toBe(850);
    expect(med.cost_price_cents).toBe(620);
    expect(med.zone).toBe('B');

    // 2. Insert batch row with initial quantity and expiry date
    const batch = await insertBatch(db, {
      medication_id: med.id,
      lot_number: 'BATCH-AUG-01',
      quantity: 25,
      expiry_date: '2027-06-30',
      received_at: new Date().toISOString(),
    });

    expect(batch.id).toBeGreaterThan(0);
    expect(batch.medication_id).toBe(med.id);
    expect(batch.quantity).toBe(25);
    expect(batch.lot_number).toBe('BATCH-AUG-01');

    // 3. Insert price_history row (source='manual', confirmed=1)
    const priceHist = await insertPriceHistory(db, {
      medication_id: med.id,
      unit_price_cents: 850,
      source: 'manual',
      changed_by: 'Pharmacist',
      created_at: new Date().toISOString(),
    });

    expect(priceHist.id).toBeGreaterThan(0);
    expect(priceHist.medication_id).toBe(med.id);
    expect(priceHist.unit_price_cents).toBe(850);
    expect(priceHist.source).toBe('manual');

    // 4. Insert initial stock_movement row (delta = +quantity, reason = 'initial_receipt')
    const movement = await insertMovement(db, {
      medication_id: med.id,
      batch_id: batch.id,
      delta: 25,
      reason: 'initial_receipt',
      user_id: 'Pharmacist',
      created_at: new Date().toISOString(),
    });

    expect(movement.id).toBeGreaterThan(0);
    expect(movement.medication_id).toBe(med.id);
    expect(movement.batch_id).toBe(batch.id);
    expect(movement.delta).toBe(25);
    expect(movement.reason).toBe('initial_receipt');

    // Verify DB integrity
    const batches = await listBatchesForMedication(db, med.id);
    expect(batches).toHaveLength(1);
    expect(batches[0].quantity).toBe(25);

    const movements = await listMovementsForMedication(db, med.id);
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(25);
    expect(movements[0].reason).toBe('initial_receipt');

    const histories = await listPriceHistoryForMedication(db, med.id);
    expect(histories).toHaveLength(1);
    expect(histories[0].unit_price_cents).toBe(850);
  });

  it('handles item addition without retail price gracefully', async () => {
    // Medication without price
    const med = await insertMedication(db, {
      brand_name: 'Unpriced Sample 50mg',
      generic_name: 'Sample generic',
      reorder_level: 10,
      unit_price_cents: null,
      price_confirmed: 0,
      zone: 'A',
      shelf: '1',
      bin: '1',
    });

    const batch = await insertBatch(db, {
      medication_id: med.id,
      lot_number: 'LOT-SMPL',
      quantity: 10,
      expiry_date: '2026-12-31',
    });

    const movement = await insertMovement(db, {
      medication_id: med.id,
      batch_id: batch.id,
      delta: 10,
      reason: 'initial_receipt',
      user_id: 'Pharmacist',
    });

    expect(med.unit_price_cents).toBeNull();
    expect(batch.quantity).toBe(10);
    expect(movement.reason).toBe('initial_receipt');

    // No price history inserted when price is not provided
    const histories = await listPriceHistoryForMedication(db, med.id);
    expect(histories).toHaveLength(0);
  });
});
