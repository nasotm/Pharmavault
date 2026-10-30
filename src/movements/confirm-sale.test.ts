import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate';
import {
  createRepository,
  getTotalStock,
  listBatchesForMedication,
} from '../db/repository';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import {
  confirmCalculatorSale,
  getMovementHistoryForMedication,
  receiveStock,
} from './stock-movement';

async function createSeededTestDb() {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);
  return db;
}

test('confirmCalculatorSale: deducts multi-item cart quantities using FEFO and records dispense:sale movements', async () => {
  const db = await createSeededTestDb();
  try {
    // Seeded stock:
    // - Amoxil (#1): 125 units total (80 in AMX-2026-01 + 45 in AMX-2026-02)
    // - Doliprane (#5): 200 units in batch #6 (DOL-2026-10)
    const beforeAmoxStock = await getTotalStock(db, 1);
    const beforeDoliStock = await getTotalStock(db, 5);
    assert.equal(beforeAmoxStock, 125);
    assert.equal(beforeDoliStock, 200);

    const res = await confirmCalculatorSale(db, {
      items: [
        { medicationId: 1, brandName: 'Amoxil', quantity: 3 },
        { medicationId: 5, brandName: 'Doliprane', quantity: 2 },
      ],
      userId: 'Claire Dupont (PIN: 4821)',
      createdAt: '2026-10-30T10:00:00.000Z',
    });

    assert.equal(res.totalUnitsDeducted, 5);
    assert.equal(res.movements.length, 2);

    assert.equal(res.movements[0]?.medication_id, 1);
    assert.equal(res.movements[0]?.delta, -3);
    assert.equal(res.movements[0]?.reason, 'dispense:sale');
    assert.equal(res.movements[0]?.user_id, 'Claire Dupont (PIN: 4821)');

    assert.equal(res.movements[1]?.medication_id, 5);
    assert.equal(res.movements[1]?.delta, -2);
    assert.equal(res.movements[1]?.reason, 'dispense:sale');
    assert.equal(res.movements[1]?.user_id, 'Claire Dupont (PIN: 4821)');

    const afterAmoxStock = await getTotalStock(db, 1);
    const afterDoliStock = await getTotalStock(db, 5);
    assert.equal(afterAmoxStock, 122);
    assert.equal(afterDoliStock, 198);
  } finally {
    await db.close();
  }
});

test('confirmCalculatorSale: spans multiple batches in strict FEFO order when earliest batch is smaller than requested quantity', async () => {
  const db = await createSeededTestDb();
  try {
    // Receive an earlier-expiring batch of Amoxil (#1) with 4 units expiring 2026-12-01
    // Existing batch AMX-2026-01 has 80 units expiring 2027-06-30, and AMX-2026-02 has 45 units expiring 2027-11-15
    await receiveStock(db, {
      medicationId: 1,
      lotNumber: 'AMX-EARLY-01',
      expiryDate: '2026-12-01',
      quantity: 4,
      userId: 'Claire Dupont (PIN: 4821)',
    });

    const totalBefore = await getTotalStock(db, 1);
    assert.equal(totalBefore, 129);

    // Sell 7 units of Amoxil -> should deduct 4 from AMX-EARLY-01 (leaving 0) and 3 from AMX-2026-01 (80 -> 77)
    const saleRes = await confirmCalculatorSale(db, {
      items: [{ medicationId: 1, brandName: 'Amoxil', quantity: 7 }],
      userId: 'Claire Dupont (PIN: 4821)',
    });

    assert.equal(saleRes.totalUnitsDeducted, 7);
    assert.equal(saleRes.movements.length, 2);
    assert.equal(saleRes.movements[0]?.delta, -4);
    assert.equal(saleRes.movements[0]?.reason, 'dispense:sale');
    assert.equal(saleRes.movements[1]?.delta, -3);
    assert.equal(saleRes.movements[1]?.reason, 'dispense:sale');

    const batchesAfter = await listBatchesForMedication(db, 1);
    const earlyBatch = batchesAfter.find((b) => b.lot_number === 'AMX-EARLY-01');
    const laterBatch = batchesAfter.find((b) => b.lot_number === 'AMX-2026-01');
    assert.equal(earlyBatch?.quantity, 0);
    assert.equal(laterBatch?.quantity, 77);
    assert.equal(await getTotalStock(db, 1), 122);
  } finally {
    await db.close();
  }
});

test('confirmCalculatorSale: rolls back the entire transaction when any item has insufficient stock', async () => {
  const db = await createSeededTestDb();
  try {
    const repo = createRepository(db);
    const beforeAmoxStock = await getTotalStock(db, 1); // 125
    const beforeVentolinStock = await getTotalStock(db, 2); // 6
    const beforeAmoxHistory = await getMovementHistoryForMedication(db, 1);
    const beforeAllMovements = await repo.listMovementsForMedication(1);

    assert.equal(beforeAmoxStock, 125);
    assert.equal(beforeVentolinStock, 6);

    // Cart has 3 Amoxil (sufficient) + 10 Ventolin HFA (insufficient: only 6 available)
    await assert.rejects(
      () =>
        confirmCalculatorSale(db, {
          items: [
            { medicationId: 1, brandName: 'Amoxil', quantity: 3 },
            { medicationId: 2, brandName: 'Ventolin HFA', quantity: 10 },
          ],
          userId: 'Claire Dupont (PIN: 4821)',
        }),
      {
        message: 'Not enough stock for Ventolin HFA. Available: 6, Requested: 10',
      },
    );

    // Verify complete rollback: Amoxil stock is still 125 and zero new movement rows were written
    const afterAmoxStock = await getTotalStock(db, 1);
    const afterVentolinStock = await getTotalStock(db, 2);
    const afterAmoxHistory = await getMovementHistoryForMedication(db, 1);
    const afterAllMovements = await repo.listMovementsForMedication(1);

    assert.equal(afterAmoxStock, 125);
    assert.equal(afterVentolinStock, 6);
    assert.equal(afterAmoxHistory.length, beforeAmoxHistory.length);
    assert.equal(afterAllMovements.length, beforeAllMovements.length);
  } finally {
    await db.close();
  }
});
