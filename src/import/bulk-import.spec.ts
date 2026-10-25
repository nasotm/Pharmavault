import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepository, runMigrations, SqliteWasmAdapter, type DatabasePort } from '../db';
import {
  autoSuggestColumnMapping,
  buildCatalogOnlySampleCsv,
  buildOfficialTariff10RowCsv,
  buildPharmacy50RowCsv,
  executeBulkImport,
  normalizeBrandName,
  parseCsvDocument,
  parsePriceToCents,
  wRatio,
} from './index';

describe('Bulk Import Flow — Acceptance Criteria & Constraints', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('parses "12,50", "12.50", "$12.50" to integer cents and rejects ambiguous/non-numeric prices without coercing to 0', () => {
    expect(parsePriceToCents('12,50')).toEqual({ ok: true, cents: 1250 });
    expect(parsePriceToCents('12.50')).toEqual({ ok: true, cents: 1250 });
    expect(parsePriceToCents('$12.50')).toEqual({ ok: true, cents: 1250 });
    expect(parsePriceToCents('€ 18,40')).toEqual({ ok: true, cents: 1840 });
    expect(parsePriceToCents('')).toEqual({ ok: true, cents: null });

    for (const invalid of ['$14.5.0', 'TBD', 'N/A', 'abc', '12,500', '-10.00', '0.00', 'free']) {
      const res = parsePriceToCents(invalid);
      expect(res.ok).toBe(false);
    }
  });

  it('normalizes brand names (trim, collapse whitespace, title-case, strip trailing punctuation) and detects fuzzy duplicates with WRatio > 85', () => {
    expect(normalizeBrandName('  augmentin   duo... ')).toBe('Augmentin Duo');
    expect(normalizeBrandName('flagyl;')).toBe('Flagyl');
    expect(wRatio('Augmentin Duo', 'Augmentin Duoo')).toBeGreaterThan(85);
    expect(wRatio('Zithromax', 'Zithromaxx')).toBeGreaterThan(85);
    expect(wRatio('Crestor', 'Crestorr')).toBeGreaterThan(85);
  });

  it('satisfies the 50-row pharmacy CSV + 10-row official tariff CSV acceptance scenario', async () => {
    const repo = createRepository(db);

    // Step 1: Import 50-row pharmacy CSV (3 duplicates, 2 bad prices, 1 missing barcode)
    const pharmacyDoc = parseCsvDocument(buildPharmacy50RowCsv(), { hasHeaderRow: true });
    expect(pharmacyDoc.rows).toHaveLength(50);

    const pharmacyMapping = autoSuggestColumnMapping(pharmacyDoc.columns);
    const pharmacyImport = await executeBulkImport(db, {
      parsedCsv: pharmacyDoc,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });

    // Error report lists exactly those 6 issues (3 duplicates, 2 bad prices, 1 missing barcode)
    expect(pharmacyImport.errorCount).toBe(6);
    expect(pharmacyImport.issues).toHaveLength(6);
    expect(pharmacyImport.summary.duplicateIssueCount).toBe(3);
    expect(pharmacyImport.summary.badPriceIssueCount).toBe(2);
    expect(pharmacyImport.summary.missingBarcodeIssueCount).toBe(1);

    // 44 rows import; all imported prices show price_confirmed=0; 44 price_history rows exist
    expect(pharmacyImport.importedCount).toBe(44);
    expect(pharmacyImport.insertedMedicationCount).toBe(44);
    expect(pharmacyImport.priceHistoryWrittenCount).toBe(44);

    const medsAfter50 = await repo.listMedications();
    expect(medsAfter50).toHaveLength(44);
    expect(medsAfter50.every((m) => m.price_confirmed === 0)).toBe(true);
    expect(medsAfter50.every((m) => m.price_source === 'manual')).toBe(true);

    const historyAfter50 = await repo.listAllPriceHistory();
    expect(historyAfter50).toHaveLength(44);

    // Step 2: Import 10-row tariff file; the same 10 medications' prices update,
    // remain unconfirmed, and 10 more price_history rows exist
    const tariffDoc = parseCsvDocument(buildOfficialTariff10RowCsv(), { hasHeaderRow: true });
    expect(tariffDoc.rows).toHaveLength(10);

    const tariffMapping = autoSuggestColumnMapping(tariffDoc.columns);
    const tariffImport = await executeBulkImport(db, {
      parsedCsv: tariffDoc,
      mapping: tariffMapping,
      sourceType: 'official_tariff',
      dryRun: false,
    });

    expect(tariffImport.errorCount).toBe(0);
    expect(tariffImport.importedCount).toBe(10);
    expect(tariffImport.insertedMedicationCount).toBe(0);
    expect(tariffImport.updatedMedicationCount).toBe(10);
    expect(tariffImport.priceHistoryWrittenCount).toBe(10);

    const medsAfterTariff = await repo.listMedications();
    expect(medsAfterTariff).toHaveLength(44);

    const updatedTariffMeds = medsAfterTariff.filter((m) => m.price_source === 'official_tariff');
    expect(updatedTariffMeds).toHaveLength(10);
    expect(updatedTariffMeds.every((m) => m.price_confirmed === 0)).toBe(true);

    const historyAfterTariff = await repo.listAllPriceHistory();
    expect(historyAfterTariff).toHaveLength(54);
  });

  it('re-importing the same file does not double stock, and catalog-only imports create zero batch rows', async () => {
    const repo = createRepository(db);
    const pharmacyDoc = parseCsvDocument(buildPharmacy50RowCsv(), { hasHeaderRow: true });
    const pharmacyMapping = autoSuggestColumnMapping(pharmacyDoc.columns);

    await executeBulkImport(db, {
      parsedCsv: pharmacyDoc,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });

    const meds = await repo.listMedications();
    const stockBefore = (await Promise.all(meds.map((m) => repo.getTotalStock(m.id)))).reduce(
      (a, b) => a + b,
      0,
    );

    // Re-import the exact same file
    await executeBulkImport(db, {
      parsedCsv: pharmacyDoc,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });

    const stockAfter = (await Promise.all(meds.map((m) => repo.getTotalStock(m.id)))).reduce(
      (a, b) => a + b,
      0,
    );
    expect(stockAfter).toBe(stockBefore);

    // Catalog-only import must not create batch rows
    const batchesBefore = await repo.listAllBatches();
    const catalogDoc = parseCsvDocument(buildCatalogOnlySampleCsv(), { hasHeaderRow: true });
    const catalogMapping = autoSuggestColumnMapping(catalogDoc.columns);

    const catalogImport = await executeBulkImport(db, {
      parsedCsv: catalogDoc,
      mapping: catalogMapping,
      sourceType: 'catalog_only',
      dryRun: false,
    });
    expect(catalogImport.importedCount).toBe(5);
    expect(catalogImport.batchesWrittenCount).toBe(0);
    expect(catalogImport.priceHistoryWrittenCount).toBe(0);

    const batchesAfter = await repo.listAllBatches();
    expect(batchesAfter).toHaveLength(batchesBefore.length);
  });
});
