import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRepository,
  getMedicationWithAliases,
  getTotalStock,
  runMigrations,
  seedDatabase,
  setPrice,
  setRepositoryDatabase,
  SqliteWasmAdapter,
  type DatabasePort,
} from './db';

describe('Prompt 1 Acceptance Criteria — src/repository.test.ts', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    setRepositoryDatabase(db);
    await runMigrations(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    setRepositoryDatabase(null);
    await db.close();
  });

  it('getTotalStock correctly sums the batches across medications', async () => {
    const repo = createRepository(db);
    const medications = await repo.listMedications();
    expect(medications).toHaveLength(5);

    // 1. Verify getTotalStock(id) equals the exact sum of batch.quantity for every seeded medication
    for (const med of medications) {
      const batches = await repo.listBatchesForMedication(med.id);
      const expectedSum = batches.reduce((sum, batch) => sum + batch.quantity, 0);
      const actualTotal = await getTotalStock(med.id);

      expect(actualTotal).toBe(expectedSum);
      expect(Number.isInteger(actualTotal)).toBe(true);
    }

    // Specific multi-batch medications from the seed data:
    // Amoxil (id=1): batch #1 (80) + batch #2 (45) = 125
    expect(await getTotalStock(1)).toBe(125);
    // Ventolin HFA (id=2, low-stock): batch #3 (6) < reorder_level (15)
    expect(await getTotalStock(2)).toBe(6);
    // Lantus SoloStar (id=3): batch #4 (18) + batch #5 (12) = 30
    expect(await getTotalStock(3)).toBe(30);

    // 2. Adding a new batch increases getTotalStock by the exact batch quantity
    await repo.insertBatch({
      medication_id: 1,
      lot_number: 'AMX-2026-C3',
      quantity: 35,
      expiry_date: '2028-06-30',
    });
    expect(await getTotalStock(1)).toBe(160);

    // 3. Medication with no batches returns 0
    expect(await getTotalStock(9999)).toBe(0);
  });

  it('setPrice appends exactly one row to price_history and flips price_confirmed to 1', async () => {
    const repo = createRepository(db);

    // Case A: Lipitor (id=4) starts with an unconfirmed imported price (1840 cents, price_confirmed = 0)
    const beforeLipitor = await repo.getMedicationById(4);
    expect(beforeLipitor).not.toBeNull();
    expect(beforeLipitor!.unit_price_cents).toBe(1840);
    expect(beforeLipitor!.price_confirmed).toBe(0);

    const historyBefore = await repo.listPriceHistoryForMedication(4);
    expect(historyBefore).toHaveLength(1);

    const updatedLipitor = await setPrice(
      4,
      1795,
      'official_tariff',
      true,
      'pharmacist:claire.dupont',
    );

    expect(updatedLipitor.unit_price_cents).toBe(1795);
    expect(updatedLipitor.price_source).toBe('official_tariff');
    expect(updatedLipitor.price_confirmed).toBe(1);
    expect(updatedLipitor.price_updated_at).toBeTruthy();

    const historyAfter = await repo.listPriceHistoryForMedication(4);
    expect(historyAfter).toHaveLength(historyBefore.length + 1);

    const appendedRow = historyAfter[historyAfter.length - 1];
    expect(appendedRow.medication_id).toBe(4);
    expect(appendedRow.unit_price_cents).toBe(1795);
    expect(appendedRow.source).toBe('official_tariff');
    expect(appendedRow.changed_by).toBe('pharmacist:claire.dupont');

    // Case B: Lantus SoloStar (id=3) starts with unit_price_cents = NULL and 0 price_history rows
    const lantusHistoryBefore = await repo.listPriceHistoryForMedication(3);
    expect(lantusHistoryBefore).toHaveLength(0);

    const updatedLantus = await setPrice(3, 4650, 'manual', 1, 'pharmacist:claire.dupont');
    expect(updatedLantus.unit_price_cents).toBe(4650);
    expect(updatedLantus.price_confirmed).toBe(1);

    const lantusHistoryAfter = await repo.listPriceHistoryForMedication(3);
    expect(lantusHistoryAfter).toHaveLength(1);
    expect(lantusHistoryAfter[0].unit_price_cents).toBe(4650);
    expect(lantusHistoryAfter[0].source).toBe('manual');
  });

  it('reading the NULL-price medication returns NULL, not 0, and every seeded price is an integer', async () => {
    const repo = createRepository(db);

    // Lantus SoloStar (id=3) is seeded with unit_price_cents = NULL
    const nullPriceMed = await getMedicationWithAliases(3);
    expect(nullPriceMed).not.toBeNull();
    expect(nullPriceMed!.brand_name).toBe('Lantus SoloStar');
    expect(nullPriceMed!.unit_price_cents).toBeNull();
    expect(nullPriceMed!.unit_price_cents).not.toBe(0);
    expect(nullPriceMed!.price_confirmed).toBe(0);
    expect(nullPriceMed!.price_source).toBeNull();

    // Every non-null seeded price must be a strict integer in minor units (cents)
    const allMedications = await repo.listMedications();
    const nullPriceMedications = allMedications.filter((m) => m.unit_price_cents === null);
    expect(nullPriceMedications).toHaveLength(1);
    expect(nullPriceMedications[0].id).toBe(3);

    for (const med of allMedications) {
      if (med.unit_price_cents !== null) {
        expect(Number.isInteger(med.unit_price_cents)).toBe(true);
      }
      if (med.cost_price_cents !== null) {
        expect(Number.isInteger(med.cost_price_cents)).toBe(true);
      }
    }
  });
});
