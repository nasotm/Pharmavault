import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  type DatabasePort,
} from './index';

describe('Pharmacy Inventory Foundation (DatabasePort, Migrations, Seed, Repository)', () => {
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

  it('runs migrations idempotently and a second run is a no-op', async () => {
    const secondRun = await runMigrations(db);
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.skipped).toContain('001_initial_schema.sql');
  });

  it('persists across separate adapter instances in a clean OPFS directory', async () => {
    const tempOpfsDir = path.resolve(
      process.cwd(),
      '.opfs',
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      const firstAdapter = await SqliteWasmAdapter.create({
        filename: 'test-opfs.sqlite3',
        nodeOpfsDir: tempOpfsDir,
      });
      const firstMigrate = await runMigrations(firstAdapter);
      expect(firstMigrate.applied).toEqual(['001_initial_schema.sql']);

      const seedStats = await seedDatabase(firstAdapter);
      expect(seedStats.insertedMedications).toBe(5);
      await firstAdapter.close();

      // Re-open from the same OPFS directory and verify second migrate is a no-op
      const secondAdapter = await SqliteWasmAdapter.create({
        filename: 'test-opfs.sqlite3',
        nodeOpfsDir: tempOpfsDir,
      });
      const secondMigrate = await runMigrations(secondAdapter);
      expect(secondMigrate.applied).toEqual([]);
      expect(secondMigrate.skipped).toEqual(['001_initial_schema.sql']);

      const repo = createRepository(secondAdapter);
      const meds = await repo.listMedications();
      expect(meds).toHaveLength(5);

      // Standalone insertMovement (using INSERT ... RETURNING) must also persist across reopen
      await repo.insertMovement(3, 4, -2, 'dispense:opfs-test', 'pharmacist:test');
      await secondAdapter.close();

      const thirdAdapter = await SqliteWasmAdapter.create({
        filename: 'test-opfs.sqlite3',
        nodeOpfsDir: tempOpfsDir,
      });
      const thirdRepo = createRepository(thirdAdapter);
      const lantusMovements = await thirdRepo.listMovementsForMedication(3);
      expect(lantusMovements.some((m) => m.reason === 'dispense:opfs-test' && m.delta === -2)).toBe(
        true,
      );
      await thirdAdapter.close();
    } finally {
      fs.rmSync(tempOpfsDir, { recursive: true, force: true });
    }
  });

  it('asserts every seeded price is an integer (or null for the unpriced item) and rejects floats', async () => {
    const repo = createRepository(db);
    const medications = await repo.listMedications();
    expect(medications).toHaveLength(5);

    const pricedMedications = medications.filter((m) => m.unit_price_cents !== null);
    expect(pricedMedications).toHaveLength(4);

    for (const med of medications) {
      if (med.unit_price_cents !== null) {
        expect(typeof med.unit_price_cents).toBe('number');
        expect(Number.isInteger(med.unit_price_cents)).toBe(true);
        expect(med.unit_price_cents).toBeGreaterThan(0);
      }
      if (med.cost_price_cents !== null) {
        expect(typeof med.cost_price_cents).toBe('number');
        expect(Number.isInteger(med.cost_price_cents)).toBe(true);
        expect(med.cost_price_cents).toBeGreaterThan(0);
      }

      const history = await repo.listPriceHistoryForMedication(med.id);
      for (const entry of history) {
        if (entry.unit_price_cents !== null) {
          expect(Number.isInteger(entry.unit_price_cents)).toBe(true);
        }
      }
    }

    // Float values must be rejected by setPrice
    await expect(setPrice(1, 12.99, 'manual', true, 'pharmacist:test')).rejects.toThrow(/integer/i);
  });

  it('reading the NULL-price seeded medication returns NULL, not 0', async () => {
    const lantus = await getMedicationWithAliases(3);
    expect(lantus).not.toBeNull();
    expect(lantus!.brand_name).toBe('Lantus SoloStar');
    expect(lantus!.unit_price_cents).toBeNull();
    expect(lantus!.unit_price_cents).not.toBe(0);
    expect(lantus!.price_confirmed).toBe(0);
    expect(lantus!.price_source).toBeNull();
  });

  it('getTotalStock matches sum of batches for all seeded medications and identifies low-stock item', async () => {
    const repo = createRepository(db);
    const medications = await repo.listMedications();

    let lowStockCount = 0;

    for (const med of medications) {
      const batches = await repo.listBatchesForMedication(med.id);
      const expectedSum = batches.reduce((acc, batch) => acc + batch.quantity, 0);
      const totalStock = await getTotalStock(med.id);

      expect(totalStock).toBe(expectedSum);
      expect(Number.isInteger(totalStock)).toBe(true);

      if (totalStock < med.reorder_level) {
        lowStockCount++;
      }
    }

    // Ventolin HFA (id=2) has batch quantity 6 and reorder_level 15
    expect(await getTotalStock(2)).toBe(6);
    expect(lowStockCount).toBe(1);

    // Non-existent or zero-batch medication returns 0
    expect(await getTotalStock(9999)).toBe(0);
  });

  it('getMedicationWithAliases returns medication with all associated alias strings', async () => {
    const amoxil = await getMedicationWithAliases(1);
    expect(amoxil).not.toBeNull();
    expect(amoxil!.brand_name).toBe('Amoxil');
    expect(amoxil!.generic_name).toBe('Amoxicillin');
    expect(amoxil!.aliases).toEqual(['Amoxicillin 500', 'Amox 500mg', 'Clamoxyl Equivalent']);
    expect(amoxil!.alias_records).toHaveLength(3);
  });

  it('setPrice updates medication AND appends exactly one price_history row and flips price_confirmed', async () => {
    const repo = createRepository(db);

    // Lipitor (id=4) starts with imported unconfirmed price (1840 cents, price_confirmed=0)
    const beforeMed = await repo.getMedicationById(4);
    expect(beforeMed?.unit_price_cents).toBe(1840);
    expect(beforeMed?.price_confirmed).toBe(0);

    const beforeHistory = await repo.listPriceHistoryForMedication(4);
    expect(beforeHistory).toHaveLength(1);

    // Pharmacist confirms a new tariff price of 1795 cents
    const updatedMed = await setPrice(4, 1795, 'official_tariff', true, 'pharmacist:claire.dupont');

    expect(updatedMed.unit_price_cents).toBe(1795);
    expect(updatedMed.price_source).toBe('official_tariff');
    expect(updatedMed.price_confirmed).toBe(1);
    expect(updatedMed.price_updated_at).toBeTruthy();

    const afterHistory = await repo.listPriceHistoryForMedication(4);
    expect(afterHistory).toHaveLength(beforeHistory.length + 1);

    const latestEntry = afterHistory[afterHistory.length - 1];
    expect(latestEntry.medication_id).toBe(4);
    expect(latestEntry.unit_price_cents).toBe(1795);
    expect(latestEntry.source).toBe('official_tariff');
    expect(latestEntry.changed_by).toBe('pharmacist:claire.dupont');

    // Also test setting price on the NULL-price medication (Lantus SoloStar, id=3)
    const lantusBeforeHistory = await repo.listPriceHistoryForMedication(3);
    expect(lantusBeforeHistory).toHaveLength(0);

    const updatedLantus = await setPrice(3, 4650, 'manual', 1, 'pharmacist:claire.dupont');
    expect(updatedLantus.unit_price_cents).toBe(4650);
    expect(updatedLantus.price_confirmed).toBe(1);

    const lantusAfterHistory = await repo.listPriceHistoryForMedication(3);
    expect(lantusAfterHistory).toHaveLength(1);
    expect(lantusAfterHistory[0].unit_price_cents).toBe(4650);
  });

  it('enforces append-only semantics on stock_movement and price_history', async () => {
    const repo = createRepository(db);

    // Verify no update or delete methods exist for stock_movement or price_history on the repository
    const repoKeys = Object.keys(repo);
    expect(repoKeys).not.toContain('updateMovement');
    expect(repoKeys).not.toContain('deleteMovement');
    expect(repoKeys).not.toContain('updateStockMovement');
    expect(repoKeys).not.toContain('deleteStockMovement');
    expect(repoKeys).not.toContain('updatePriceHistory');
    expect(repoKeys).not.toContain('deletePriceHistory');

    // Verify insertMovement appends a movement record
    const beforeMovements = await repo.listMovementsForMedication(1);
    const createdMovement = await insertMovement({
      medication_id: 1,
      batch_id: 1,
      delta: -3,
      reason: 'dispense:rx-10042',
      user_id: 'pharmacist:claire.dupont',
    });
    expect(createdMovement.delta).toBe(-3);
    const afterMovements = await repo.listMovementsForMedication(1);
    expect(afterMovements).toHaveLength(beforeMovements.length + 1);

    // Verify SQLite triggers block raw UPDATE and DELETE on stock_movement and price_history
    await expect(
      db.exec('UPDATE stock_movement SET delta = 0 WHERE id = ?', [createdMovement.id]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      db.exec('DELETE FROM stock_movement WHERE id = ?', [createdMovement.id]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      db.exec('UPDATE price_history SET unit_price_cents = 100 WHERE medication_id = 1'),
    ).rejects.toThrow(/append-only/i);

    await expect(db.exec('DELETE FROM price_history WHERE medication_id = 1')).rejects.toThrow(
      /append-only/i,
    );
  });

  it('enforces architectural boundaries: only SqliteWasmAdapter touches @sqlite.org/sqlite-wasm', () => {
    const srcDir = path.resolve(process.cwd(), 'src');

    function collectTsFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...collectTsFiles(full));
        } else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.endsWith('.spec.ts') &&
          !entry.name.endsWith('.test.ts')
        ) {
          out.push(full);
        }
      }
      return out;
    }

    const files = collectTsFiles(srcDir);
    for (const file of files) {
      const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');
      if (rel !== 'src/db/sqlite-wasm-adapter.ts') {
        expect(content).not.toContain('@sqlite.org/sqlite-wasm');
      }
    }

    const repoSource = fs.readFileSync(path.resolve(process.cwd(), 'src/db/repository.ts'), 'utf8');
    expect(repoSource).toMatch(/AI layer.*must NEVER write/i);
  });
});
