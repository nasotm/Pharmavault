import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveMedication,
  checkMedicationDeletionEligibility,
  createRepository,
  deleteMedication,
  getMedicationById,
  insertAlias,
  insertBatch,
  insertMedication,
  insertMovement,
  listAliasesForMedication,
  listBatchesForMedication,
  listMedications,
  runMigrations,
  seedDatabase,
  setPrice,
  setRepositoryDatabase,
  SqliteWasmAdapter,
  unarchiveMedication,
  type DatabasePort,
} from './index';
import { searchMedications } from '../search/search';

describe('Medication Deletion & Archival Safety Checks', () => {
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

  it('blocks deletion when a medication has batches with quantity > 0', async () => {
    // Medication 1 (Amoxil) in seeded DB has batches with quantity > 0
    const check = await checkMedicationDeletionEligibility(db, 1);
    expect(check.canDelete).toBe(false);
    expect(check.hasStock).toBe(true);
    expect(check.blockReason).toBe(
      'Cannot delete: there is still stock in the pharmacy. Please dispense or adjust stock to 0 first.',
    );

    await expect(deleteMedication(db, 1)).rejects.toThrow(
      'Cannot delete: there is still stock in the pharmacy. Please dispense or adjust stock to 0 first.',
    );
  });

  it('blocks deletion when a medication has zero stock but has stock_movement or price_history', async () => {
    // Create a medication with zero stock but insert a movement record
    const med = await insertMedication(db, {
      brand_name: 'Test Med With History',
      generic_name: 'Test Molecule',
      barcode: '999000111222',
    });

    const batch = await insertBatch(db, {
      medication_id: med.id,
      quantity: 0,
      lot_number: 'EMPTY-001',
    });

    // Add a stock movement
    await insertMovement(db, med.id, batch.id, 0, 'stock_check:zero', 'pharmacist:test');

    const check = await checkMedicationDeletionEligibility(db, med.id);
    expect(check.canDelete).toBe(false);
    expect(check.hasStock).toBe(false);
    expect(check.hasHistory).toBe(true);
    expect(check.blockReason).toBe(
      'Cannot delete: this medication has sales or price history. You can only archive it.',
    );

    await expect(deleteMedication(db, med.id)).rejects.toThrow(
      'Cannot delete: this medication has sales or price history. You can only archive it.',
    );
  });

  it('blocks deletion when a medication has price_history rows', async () => {
    // Create a medication with zero stock and a confirmed price
    const med = await insertMedication(db, {
      brand_name: 'Test Priced Med',
      barcode: '999000333444',
    });

    await setPrice(db, med.id, 500, 'manual', 1, 'pharmacist:test');

    const check = await checkMedicationDeletionEligibility(db, med.id);
    expect(check.canDelete).toBe(false);
    expect(check.hasHistory).toBe(true);
    expect(check.priceHistoryCount).toBeGreaterThan(0);
    expect(check.blockReason).toBe(
      'Cannot delete: this medication has sales or price history. You can only archive it.',
    );

    await expect(deleteMedication(db, med.id)).rejects.toThrow(
      'Cannot delete: this medication has sales or price history. You can only archive it.',
    );
  });

  it('successfully deletes a medication with zero stock, no movement history, and no price history', async () => {
    const med = await insertMedication(db, {
      brand_name: 'Accidental Duplicate',
      generic_name: 'Harmless Molecule',
      barcode: '888777666555',
    });

    // Add an alias and an empty batch
    await insertAlias(db, med.id, 'Duplicate Brand Alternative');
    await insertBatch(db, {
      medication_id: med.id,
      quantity: 0,
      lot_number: 'EMPTY-BATCH',
    });

    const check = await checkMedicationDeletionEligibility(db, med.id);
    expect(check.canDelete).toBe(true);
    expect(check.hasStock).toBe(false);
    expect(check.hasHistory).toBe(false);
    expect(check.blockReason).toBeNull();

    // Perform deletion
    await deleteMedication(db, med.id);

    // Verify medication is gone
    const fetched = await getMedicationById(db, med.id);
    expect(fetched).toBeNull();

    // Verify aliases are cleaned up
    const aliases = await listAliasesForMedication(db, med.id);
    expect(aliases).toHaveLength(0);

    // Verify batches are cleaned up
    const batches = await listBatchesForMedication(db, med.id);
    expect(batches).toHaveLength(0);
  });

  it('archives a medication with history: hides from inventory and search while preserving history', async () => {
    // Seeded Medication 1 has history and batches
    const medBefore = await getMedicationById(db, 1);
    expect(medBefore).not.toBeNull();
    expect(medBefore?.is_archived).toBe(0);

    // Verify it appears in active list and search
    const activeBefore = await listMedications(db);
    expect(activeBefore.some((m) => m.id === 1)).toBe(true);

    const searchBefore = await searchMedications(db, 'Amoxil');
    expect(searchBefore.results.some((r) => r.medication.id === 1)).toBe(true);

    // Archive it
    await archiveMedication(db, 1);

    const medAfter = await getMedicationById(db, 1);
    expect(medAfter?.is_archived).toBe(1);

    // Active listMedications excludes archived medications by default
    const activeAfter = await listMedications(db);
    expect(activeAfter.some((m) => m.id === 1)).toBe(false);

    // listMedications with includeArchived includes it
    const allWithArchived = await listMedications(db, { includeArchived: true });
    expect(allWithArchived.some((m) => m.id === 1)).toBe(true);

    // Search excludes archived medications
    const searchAfter = await searchMedications(db, 'Amoxil');
    expect(searchAfter.results.some((r) => r.medication.id === 1)).toBe(false);

    // Stock movements and batches are preserved
    const batches = await listBatchesForMedication(db, 1);
    expect(batches.length).toBeGreaterThan(0);

    // Unarchive brings it back to active inventory and search
    await unarchiveMedication(db, 1);
    const unarchivedSearch = await searchMedications(db, 'Amoxil');
    expect(unarchivedSearch.results.some((r) => r.medication.id === 1)).toBe(true);
  });

  it('works via repository object instance created with createRepository', async () => {
    const repo = createRepository(db);
    const med = await repo.insertMedication({
      brand_name: 'Repo Bound Med',
      barcode: '1234554321',
    });

    const check = await repo.checkMedicationDeletionEligibility(med.id);
    expect(check.canDelete).toBe(true);

    await repo.archiveMedication(med.id);
    const archived = await repo.getMedicationById(med.id);
    expect(archived?.is_archived).toBe(1);

    await repo.unarchiveMedication(med.id);
    const restored = await repo.getMedicationById(med.id);
    expect(restored?.is_archived).toBe(0);

    await repo.deleteMedication(med.id);
    expect(await repo.getMedicationById(med.id)).toBeNull();
  });
});
