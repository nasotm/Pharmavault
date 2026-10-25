import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRepository,
  getMedicationWithAliases,
  getTotalStock,
  insertMovement,
  runMigrations,
  seedDatabase,
  setPrice,
  setRepositoryDatabase,
  SqliteWasmAdapter,
} from './index';

test('foundation logic: migrations, seed, integer cents, NULL price, getTotalStock, setPrice, and append-only ledgers', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  setRepositoryDatabase(db);

  try {
    const firstMigrate = await runMigrations(db);
    assert.equal(firstMigrate.applied.length, 1);

    const secondMigrate = await runMigrations(db);
    assert.equal(secondMigrate.applied.length, 0);

    const seedRes = await seedDatabase(db);
    assert.equal(seedRes.insertedMedications, 5);

    const repo = createRepository(db);
    const meds = await repo.listMedications();
    assert.equal(meds.length, 5);

    for (const med of meds) {
      if (med.unit_price_cents !== null) {
        assert.equal(Number.isInteger(med.unit_price_cents), true);
      }
    }

    // NULL-price medication (Lantus SoloStar, id=3) must return null, never 0
    const lantus = await getMedicationWithAliases(3);
    assert.ok(lantus);
    assert.equal(lantus.unit_price_cents, null);
    assert.notEqual(lantus.unit_price_cents, 0);

    // getTotalStock matches sum of batches
    assert.equal(await getTotalStock(1), 125);
    assert.equal(await getTotalStock(2), 6); // low-stock item (6 < 15)
    assert.equal(await getTotalStock(3), 30);
    assert.equal(await getTotalStock(4), 60);
    assert.equal(await getTotalStock(5), 200);

    // setPrice appends 1 price_history row and flips price_confirmed
    const beforeHist = await repo.listPriceHistoryForMedication(4);
    const updated = await setPrice(4, 1795, 'official_tariff', true, 'pharmacist:test');
    assert.equal(updated.unit_price_cents, 1795);
    assert.equal(updated.price_confirmed, 1);
    const afterHist = await repo.listPriceHistoryForMedication(4);
    assert.equal(afterHist.length, beforeHist.length + 1);

    // insertMovement appends a movement
    const mv = await insertMovement(1, 1, -2, 'dispense', 'pharmacist:test');
    assert.equal(mv.delta, -2);
  } finally {
    setRepositoryDatabase(null);
    await db.close();
  }
});
