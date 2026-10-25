import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepository, runMigrations, seedDatabase, SqliteWasmAdapter } from '../db';
import {
  dispenseStock,
  formatCurrentUserIdentifier,
  getMovementHistoryForMedication,
  postOffsetMovement,
  receiveStock,
  selectFefoBatch,
} from './index';

test('Stock Movement — Receive, FEFO Dispense, Over-Dispense Rejection, Resulting Quantity History, and Offset Corrections', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  try {
    await runMigrations(db);
    await seedDatabase(db);
    const repo = createRepository(db);

    const currentUser = formatCurrentUserIdentifier({
      name: 'Claire Dupont',
      pin: '4821',
    });
    assert.equal(currentUser, 'Claire Dupont (PIN: 4821)');

    // Medication #1 (Amoxil) has 2 seeded batches:
    // - Batch #1: AMX-2026-01, quantity 80, expiry 2027-06-30 (FEFO earliest expiry)
    // - Batch #2: AMX-2026-04, quantity 45, expiry 2027-11-30
    // Initial total stock = 125
    const initialBatches = await repo.listBatchesForMedication(1);
    assert.equal(initialBatches.length, 2);
    const fefo = selectFefoBatch(initialBatches);
    assert.ok(fefo);
    assert.equal(fefo.lot_number, 'AMX-2026-01');
    assert.equal(fefo.quantity, 80);
    assert.equal(await repo.getTotalStock(1), 125);

    // 1. Acceptance: Dispense 3 units (defaults to FEFO batch AMX-2026-01)
    const dispenseRes = await dispenseStock(db, {
      medicationId: 1,
      quantity: 3,
      reason: 'dispense:prescription_rx104',
      userId: currentUser,
    });

    // Confirm the batch dropped by 3 (80 -> 77) and total stock is 122
    assert.equal(dispenseRes.batch.lot_number, 'AMX-2026-01');
    assert.equal(dispenseRes.resultingBatchQuantity, 77);
    assert.equal(dispenseRes.totalStock, 122);
    assert.equal(await repo.getTotalStock(1), 122);

    const batchAfterDispense = await repo.getBatchById(fefo.id);
    assert.ok(batchAfterDispense);
    assert.equal(batchAfterDispense.quantity, 77);

    // Confirm a negative movement row exists with delta = -3 and currentUser
    assert.equal(dispenseRes.movement.delta, -3);
    assert.equal(dispenseRes.movement.user_id, 'Claire Dupont (PIN: 4821)');
    assert.equal(dispenseRes.movement.reason, 'dispense:prescription_rx104');

    // 2. Acceptance: Attempting to dispense more than available is rejected with a clear message
    await assert.rejects(
      async () => {
        await dispenseStock(db, {
          medicationId: 1,
          quantity: 78, // Batch AMX-2026-01 only holds 77 units
          reason: 'dispense:over_limit',
          userId: currentUser,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(
          err.message,
          /Cannot dispense 78 units from batch AMX-2026-01: only 77 units available/i,
        );
        return true;
      },
    );

    // Confirm batch quantity and movement count are unchanged after failed over-dispense
    assert.equal((await repo.getBatchById(fefo.id))?.quantity, 77);
    assert.equal(await repo.getTotalStock(1), 122);

    // 3. Manual batch override: dispense 5 units from the later-expiry batch (AMX-2026-04, id = initialBatches[1].id)
    const secondBatch = initialBatches[1];
    const overrideRes = await dispenseStock(db, {
      medicationId: 1,
      batchId: secondBatch.id,
      quantity: 5,
      reason: 'dispense:manual_batch_override',
      userId: currentUser,
    });
    assert.equal(overrideRes.batch.lot_number, 'AMX-2026-04');
    assert.equal(overrideRes.resultingBatchQuantity, 40);
    assert.equal(overrideRes.totalStock, 117);

    // 4. Receive stock: create a new batch (+25 units)
    const receiveNewRes = await receiveStock(db, {
      medicationId: 1,
      lotNumber: 'AMX-2026-12',
      expiryDate: '2028-03-31',
      quantity: 25,
      reason: 'receive:wholesaler_invoice_881',
      userId: currentUser,
    });
    assert.equal(receiveNewRes.batch.lot_number, 'AMX-2026-12');
    assert.equal(receiveNewRes.resultingBatchQuantity, 25);
    assert.equal(receiveNewRes.movement.delta, 25);
    assert.equal(receiveNewRes.totalStock, 142);

    // 5. Receive stock into an existing batch (+8 units into AMX-2026-01)
    const receiveExistingRes = await receiveStock(db, {
      medicationId: 1,
      batchId: fefo.id,
      quantity: 8,
      reason: 'receive:restock_existing_lot',
      userId: currentUser,
    });
    assert.equal(receiveExistingRes.batch.lot_number, 'AMX-2026-01');
    assert.equal(receiveExistingRes.resultingBatchQuantity, 85); // 77 + 8
    assert.equal(receiveExistingRes.totalStock, 150);

    // 6. Post an offsetting correction movement (-2 units)
    const offsetRes = await postOffsetMovement(db, {
      medicationId: 1,
      batchId: fefo.id,
      delta: -2,
      reason: 'damaged_blister_pack',
      userId: currentUser,
    });
    assert.equal(offsetRes.resultingBatchQuantity, 83);
    assert.equal(offsetRes.totalStock, 148);
    assert.equal(offsetRes.movement.reason, 'correction:damaged_blister_pack');

    // 7. Movement history view per medication: verify timestamp, delta, reason, user, and resulting_quantity
    const history = await getMovementHistoryForMedication(db, 1);
    // 2 initial seed receipts + 5 new movements = 7 movements (returned newest-first)
    assert.equal(history.length, 7);
    assert.equal(history[0].delta, -2);
    assert.equal(history[0].resulting_quantity, 148);
    assert.equal(history[0].resulting_batch_quantity, 83);
    assert.equal(history[0].user_id, 'Claire Dupont (PIN: 4821)');

    assert.equal(history[1].delta, 8);
    assert.equal(history[1].resulting_quantity, 150);
    assert.equal(history[1].resulting_batch_quantity, 85);

    assert.equal(history[2].delta, 25);
    assert.equal(history[2].resulting_quantity, 142);
    assert.equal(history[2].resulting_batch_quantity, 25);

    assert.equal(history[3].delta, -5);
    assert.equal(history[3].resulting_quantity, 117);
    assert.equal(history[3].resulting_batch_quantity, 40);

    assert.equal(history[4].delta, -3);
    assert.equal(history[4].resulting_quantity, 122);
    assert.equal(history[4].resulting_batch_quantity, 77);
  } finally {
    await db.close();
  }
});
