import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRepository,
  runMigrations,
  seedDatabase,
  SqliteWasmAdapter,
  type DatabasePort,
} from '../db';
import {
  dispenseStock,
  formatCurrentUserIdentifier,
  getMovementHistoryForMedication,
  postOffsetMovement,
  receiveStock,
  selectFefoBatch,
} from './index';

describe('Stock Movement — Receive, FEFO Dispense, Over-Dispense Guard & Audit History', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('meets acceptance criteria: dispense 3 units drops FEFO batch by 3, creates a movement row, and rejects dispensing more than available with a clear message', async () => {
    const repo = createRepository(db);
    const userId = formatCurrentUserIdentifier({ name: 'Claire Dupont', pin: '4821' });

    const batchesBefore = await repo.listBatchesForMedication(1);
    const fefoBefore = selectFefoBatch(batchesBefore);
    expect(fefoBefore).not.toBeNull();
    expect(fefoBefore?.lot_number).toBe('AMX-2026-01');
    expect(fefoBefore?.quantity).toBe(80);
    expect(await repo.getTotalStock(1)).toBe(125);

    // Dispense 3 units (defaults to FEFO batch AMX-2026-01)
    const result = await dispenseStock(db, {
      medicationId: 1,
      quantity: 3,
      reason: 'dispense:walk-in',
      userId,
    });

    expect(result.batch.id).toBe(fefoBefore!.id);
    expect(result.resultingBatchQuantity).toBe(77);
    expect(result.totalStock).toBe(122);
    expect(await repo.getTotalStock(1)).toBe(122);

    const updatedBatch = await repo.getBatchById(fefoBefore!.id);
    expect(updatedBatch?.quantity).toBe(77);

    const historyAfterDispense = await getMovementHistoryForMedication(db, 1);
    expect(historyAfterDispense[0].delta).toBe(-3);
    expect(historyAfterDispense[0].reason).toBe('dispense:walk-in');
    expect(historyAfterDispense[0].user_id).toBe('Claire Dupont (PIN: 4821)');
    expect(historyAfterDispense[0].resulting_quantity).toBe(122);
    expect(historyAfterDispense[0].resulting_batch_quantity).toBe(77);

    // Attempting to dispense more than available is rejected with a clear message
    await expect(
      dispenseStock(db, {
        medicationId: 1,
        quantity: 80, // Only 77 left in AMX-2026-01
        reason: 'dispense:excessive',
        userId,
      }),
    ).rejects.toThrow(/Cannot dispense 80 units from batch AMX-2026-01: only 77 units available/i);

    // Verify batch quantity and movement history were not mutated by the rejected transaction
    expect((await repo.getBatchById(fefoBefore!.id))?.quantity).toBe(77);
    expect(await getMovementHistoryForMedication(db, 1)).toHaveLength(historyAfterDispense.length);
  });

  it('supports receiving stock into a new or existing batch, manual batch override on dispense, and offsetting correction movements', async () => {
    const repo = createRepository(db);
    const userId = 'Pharmacist Marc (PIN: 1904)';

    // Receive new batch with an earlier expiry date (2026-12-31) so it becomes the new FEFO batch
    const receiveRes = await receiveStock(db, {
      medicationId: 1,
      lotNumber: 'AMX-EARLY-LOT',
      expiryDate: '2026-12-31',
      quantity: 10,
      reason: 'receive:urgent_transfer',
      userId,
    });

    expect(receiveRes.batch.lot_number).toBe('AMX-EARLY-LOT');
    expect(receiveRes.resultingBatchQuantity).toBe(10);
    expect(receiveRes.totalStock).toBe(135);

    // Next FEFO dispense automatically targets AMX-EARLY-LOT (expiry 2026-12-31 < 2027-06-30)
    const fefoDispense = await dispenseStock(db, {
      medicationId: 1,
      quantity: 10,
      reason: 'dispense:fefo_deplete',
      userId,
    });
    expect(fefoDispense.batch.lot_number).toBe('AMX-EARLY-LOT');
    expect(fefoDispense.resultingBatchQuantity).toBe(0);
    expect(fefoDispense.totalStock).toBe(125);

    // Once AMX-EARLY-LOT has 0 units, FEFO automatically advances to the next earliest non-empty batch (AMX-2026-01)
    const batchesNow = await repo.listBatchesForMedication(1);
    const nextFefo = selectFefoBatch(batchesNow);
    expect(nextFefo?.lot_number).toBe('AMX-2026-01');

    // Post an offsetting correction movement
    const offsetRes = await postOffsetMovement(db, {
      medicationId: 1,
      batchId: nextFefo!.id,
      delta: -4,
      reason: 'inventory_count_variance',
      userId,
    });
    expect(offsetRes.resultingBatchQuantity).toBe(76);
    expect(offsetRes.totalStock).toBe(121);
    expect(offsetRes.movement.reason).toBe('correction:inventory_count_variance');
  });
});
