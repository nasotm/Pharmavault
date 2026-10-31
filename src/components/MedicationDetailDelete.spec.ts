import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveMedication,
  checkMedicationDeletionEligibility,
  deleteMedication,
  getMedicationById,
  insertAlias,
  insertBatch,
  insertMedication,
  runMigrations,
  seedDatabase,
  setPrice,
  setRepositoryDatabase,
  SqliteWasmAdapter,
  unarchiveMedication,
  type DatabasePort,
} from '../db/index';

describe('MedicationDetailSlideOver - Deletion & Archival Guardrails', () => {
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

  it('verifies that deleting Amoxil (with active stock) produces the exact required error message', async () => {
    const eligibility = await checkMedicationDeletionEligibility(db, 1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.hasStock).toBe(true);
    expect(eligibility.blockReason).toBe(
      'Cannot delete: there is still stock in the pharmacy. Please dispense or adjust stock to 0 first.',
    );

    try {
      await deleteMedication(db, 1);
      expect.fail('Should have thrown deletion error');
    } catch (err: unknown) {
      expect((err as Error).message).toBe(
        'Cannot delete: there is still stock in the pharmacy. Please dispense or adjust stock to 0 first.',
      );
    }
  });

  it('verifies that deleting a medication with zero stock but financial history produces the exact archive requirement message', async () => {
    // Create medication with 0 stock but with price history
    const med = await insertMedication(db, {
      brand_name: 'Historical Med',
      barcode: '111222333444',
    });

    await setPrice(db, med.id, 450, 'manual', 1, 'pharmacist:nassim');

    const eligibility = await checkMedicationDeletionEligibility(db, med.id);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.hasStock).toBe(false);
    expect(eligibility.hasHistory).toBe(true);
    expect(eligibility.blockReason).toBe(
      'Cannot delete: this medication has sales or price history. You can only archive it.',
    );

    try {
      await deleteMedication(db, med.id);
      expect.fail('Should have thrown archive-only requirement');
    } catch (err: unknown) {
      expect((err as Error).message).toBe(
        'Cannot delete: this medication has sales or price history. You can only archive it.',
      );
    }

    // Now test archiving
    await archiveMedication(db, med.id);
    const archivedMed = await getMedicationById(db, med.id);
    expect(archivedMed?.is_archived).toBe(1);

    // Unarchive
    await unarchiveMedication(db, med.id);
    const restoredMed = await getMedicationById(db, med.id);
    expect(restoredMed?.is_archived).toBe(0);
  });

  it('allows complete removal when an unstocked, movement-free, price-free draft medication is deleted', async () => {
    const draftMed = await insertMedication(db, {
      brand_name: 'Mistake Entered Med',
      generic_name: 'None',
      barcode: '999888777000',
    });

    await insertAlias(db, draftMed.id, 'Typo Variant');
    await insertBatch(db, {
      medication_id: draftMed.id,
      quantity: 0,
      lot_number: 'VOID',
    });

    const eligibility = await checkMedicationDeletionEligibility(db, draftMed.id);
    expect(eligibility.canDelete).toBe(true);
    expect(eligibility.blockReason).toBeNull();

    await deleteMedication(db, draftMed.id);
    const checkDeleted = await getMedicationById(db, draftMed.id);
    expect(checkDeleted).toBeNull();
  });
});
