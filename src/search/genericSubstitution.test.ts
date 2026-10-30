import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  getMedicationById,
  getTotalStock,
  insertBatch,
  insertMedication,
  runMigrations,
  seedDatabase,
  SqliteWasmAdapter,
  type DatabasePort,
} from '../db';
import {
  findGenericEquivalentsInStock,
  GENERIC_DCI_INFERENCE_PROMPT,
  inferDciFromBrandNameDeterministic,
  isEligibleForGenericSubstitution,
} from './genericSubstitution';

describe('Generic Substitution — Read-Only Local Lookup & AI DCI Fallback', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('determines eligibility when totalStock is 0 or <= reorder_level', () => {
    assert.equal(isEligibleForGenericSubstitution(0, 15), true);
    assert.equal(isEligibleForGenericSubstitution(6, 15), true);
    assert.equal(isEligibleForGenericSubstitution(15, 15), true);
    assert.equal(isEligibleForGenericSubstitution(16, 15), false);
    assert.equal(isEligibleForGenericSubstitution(125, 40), false);
  });

  it('returns "No generic equivalent in stock." when no other brand with the same generic_name has stock > 0', async () => {
    // Ventolin HFA (#2) has generic_name = 'Salbutamol', stock = 6 <= reorder_level 15
    const result = await findGenericEquivalentsInStock(db, {
      medicationId: 2,
      brandName: 'Ventolin HFA',
      genericName: 'Salbutamol',
    });

    assert.equal(result.equivalents.length, 0);
    assert.equal(result.summaryText, 'No generic equivalent in stock.');
  });

  it('finds in-stock generic equivalents with matching generic_name and different brand_name, excluding 0-stock items', async () => {
    // Add an in-stock generic equivalent for Salbutamol: Asthalin Inhaler (25 units in Zone B · Shelf B2 · Bin 08)
    const asthalin = await insertMedication(db, {
      brand_name: 'Asthalin',
      generic_name: 'Salbutamol',
      strength: '100 mcg/dose',
      dosage_form: 'Inhaler',
      zone: 'Zone B',
      shelf: 'Shelf B2',
      bin: 'Bin 08',
      reorder_level: 10,
      unit_price_cents: 42000,
      currency: 'DZD',
      price_confirmed: 1,
    });
    await insertBatch(db, {
      medication_id: asthalin.id,
      lot_number: 'LOT-AST-01',
      quantity: 25,
      expiry_date: '2027-09-30',
    });

    // Also add an out-of-stock generic (Salbumol, 0 units) to verify it is excluded
    const salbumol = await insertMedication(db, {
      brand_name: 'Salbumol',
      generic_name: 'Salbutamol',
      strength: '100 mcg/dose',
      dosage_form: 'Inhaler',
      zone: 'Zone B',
      shelf: 'Shelf B3',
      bin: 'Bin 01',
      reorder_level: 10,
    });
    await insertBatch(db, {
      medication_id: salbumol.id,
      lot_number: 'LOT-SAL-00',
      quantity: 0,
      expiry_date: '2027-06-30',
    });

    const result = await findGenericEquivalentsInStock(db, {
      medicationId: 2,
      brandName: 'Ventolin HFA',
      genericName: 'Salbutamol',
    });

    assert.equal(result.inferredByAi, false);
    assert.equal(result.resolvedGenericName, 'Salbutamol');
    assert.equal(result.equivalents.length, 1);
    assert.equal(result.equivalents[0]?.brandName, 'Asthalin');
    assert.equal(result.equivalents[0]?.locationDisplay, 'Zone B · Shelf B2 · Bin 08');
    assert.equal(result.equivalents[0]?.totalStock, 25);
    assert.equal(
      result.equivalents[0]?.formattedLine,
      'Asthalin - Zone B · Shelf B2 · Bin 08 - 25 units',
    );
    assert.equal(
      result.summaryText,
      'Generics available in stock: Asthalin - Zone B · Shelf B2 · Bin 08 - 25 units',
    );
  });

  it('infers DCI via AI Assistant when generic_name is missing in the database and does not mutate catalog or stock', async () => {
    assert.equal(
      GENERIC_DCI_INFERENCE_PROMPT,
      'Look at the brand name and find its DCI (molecule).',
    );
    assert.equal(inferDciFromBrandNameDeterministic('Clamoxyl 500 mg'), 'Amoxicillin');
    assert.equal(inferDciFromBrandNameDeterministic('Efferalgan 1000 mg'), 'Paracetamol');

    // Create a low-stock brand-name medication with NULL generic_name ("Clamoxyl")
    const clamoxyl = await insertMedication(db, {
      brand_name: 'Clamoxyl',
      generic_name: null,
      strength: '500 mg',
      dosage_form: 'Capsule',
      zone: 'Zone A',
      shelf: 'Shelf A2',
      bin: 'Bin 01',
      reorder_level: 20,
    });

    let aiCalledWithBrand = '';
    const result = await findGenericEquivalentsInStock(
      db,
      {
        medicationId: clamoxyl.id,
        brandName: clamoxyl.brand_name,
        genericName: clamoxyl.generic_name,
      },
      {
        inferDciFn: async (brand) => {
          aiCalledWithBrand = brand;
          return { dci: 'Amoxicillin', source: 'ai' };
        },
      },
    );

    assert.equal(aiCalledWithBrand, 'Clamoxyl');
    assert.equal(result.inferredByAi, true);
    assert.equal(result.resolvedGenericName, 'Amoxicillin');
    assert.equal(result.equivalents.length, 1);
    assert.equal(result.equivalents[0]?.brandName, 'Amoxil');
    assert.equal(result.equivalents[0]?.totalStock, 125);
    assert.equal(
      result.summaryText,
      'Generics available in stock: Amoxil - Zone A · Shelf A1 · Bin 01 - 125 units',
    );

    // Verify read-only guarantee: Clamoxyl generic_name is still NULL and Amoxil stock is still 125
    const freshClamoxyl = await getMedicationById(db, clamoxyl.id);
    assert.equal(freshClamoxyl?.generic_name, null);
    const amoxilStock = await getTotalStock(db, 1);
    assert.equal(amoxilStock, 125);
  });
});
