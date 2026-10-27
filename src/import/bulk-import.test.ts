import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepository, runMigrations, SqliteWasmAdapter } from '../db';
import {
  autoSuggestColumnMapping,
  buildCatalogOnlySampleCsv,
  buildOfficialTariff10RowCsv,
  buildPharmacy50RowCsv,
  executeBulkImport,
  listMappingProfiles,
  normalizeBrandName,
  parseCsvDocument,
  parsePriceToCents,
  prepareBulkImportPreview,
  saveMappingProfile,
  wRatio,
} from './index';

test('Bulk Import Logic & Acceptance Scenario (50-row pharmacy CSV + 10-row tariff CSV)', async () => {
  // 1. Price parsing to integer cents ("12,50", "12.50", "$12.50" -> 1250; bad prices -> errors, never 0)
  assert.deepEqual(parsePriceToCents('12,50'), { ok: true, cents: 1250 });
  assert.deepEqual(parsePriceToCents('12.50'), { ok: true, cents: 1250 });
  assert.deepEqual(parsePriceToCents('$12.50'), { ok: true, cents: 1250 });
  assert.deepEqual(parsePriceToCents('1,250.50'), { ok: true, cents: 125050 });
  assert.deepEqual(parsePriceToCents(''), { ok: true, cents: null });

  const badPrice1 = parsePriceToCents('$14.5.0');
  assert.equal(badPrice1.ok, false);
  const badPrice2 = parsePriceToCents('TBD');
  assert.equal(badPrice2.ok, false);
  const badPrice3 = parsePriceToCents('12,500'); // Ambiguous 3-digit comma group
  assert.equal(badPrice3.ok, false);

  // 2. Name normalization & RapidFuzz WRatio > 85
  assert.equal(normalizeBrandName('  augmentin   duo... '), 'Augmentin Duo');
  assert.equal(normalizeBrandName('ciproxin,'), 'Ciproxin');
  assert.equal(wRatio('Augmentin Duo', 'Augmentin Duoo') > 85, true);
  assert.equal(wRatio('Zithromax', 'Zithromaxx') > 85, true);
  assert.equal(wRatio('Crestor', 'Crestorr') > 85, true);
  assert.equal(wRatio('Augmentin Duo', 'Paracetamol') < 50, true);

  // 3. Saved mapping profile per source file
  const savedProfile = saveMappingProfile({
    profileName: 'Standard Pharmacy Sheet',
    sourceFileName: 'pharmacy_50_rows.csv',
    hasHeaderRow: true,
    mapping: { brand_name: 0, barcode: 7, unit_price_cents: 18 },
  });
  assert.equal(savedProfile.profileName, 'Standard Pharmacy Sheet');
  assert.equal(listMappingProfiles('pharmacy_50_rows.csv').length, 1);

  // 4. Acceptance Criteria:
  // Import a 50-row pharmacy CSV with 3 duplicates, 2 bad prices, and 1 missing barcode.
  // Error report lists exactly those 6 issues; 44 rows import;
  // all imported prices show price_confirmed=0; 44 price_history rows exist.
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  try {
    await runMigrations(db);
    const repo = createRepository(db);

    const pharmacyCsvText = buildPharmacy50RowCsv();
    const parsedPharmacy = parseCsvDocument(pharmacyCsvText, { hasHeaderRow: true });
    assert.equal(parsedPharmacy.rows.length, 50);

    const pharmacyMapping = autoSuggestColumnMapping(parsedPharmacy.columns);

    // Dry-run preview must not write to the database
    const dryRunResult = await executeBulkImport(db, {
      parsedCsv: parsedPharmacy,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: true,
    });
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(dryRunResult.totalRows, 50);
    assert.equal(dryRunResult.errorCount, 6);
    assert.equal(dryRunResult.validRowCount, 44);
    assert.equal(dryRunResult.summary.duplicateIssueCount, 3);
    assert.equal(dryRunResult.summary.badPriceIssueCount, 2);
    assert.equal(dryRunResult.summary.missingBarcodeIssueCount, 1);
    assert.equal((await repo.listMedications()).length, 0);

    // Commit the 50-row pharmacy import in one transaction
    const importResult = await executeBulkImport(db, {
      parsedCsv: parsedPharmacy,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });

    assert.equal(importResult.errorCount, 6);
    assert.equal(importResult.issues.length, 6);
    assert.equal(importResult.importedCount, 44);
    assert.equal(importResult.insertedMedicationCount, 44);
    assert.equal(importResult.priceHistoryWrittenCount, 44);

    const medsAfter50 = await repo.listMedications();
    assert.equal(medsAfter50.length, 44);
    for (const med of medsAfter50) {
      assert.equal(med.price_confirmed, 0);
      assert.equal(med.price_source, 'manual');
      assert.notEqual(med.unit_price_cents, null);
      assert.equal(Number.isInteger(med.unit_price_cents), true);
    }

    const historyAfter50 = await repo.listAllPriceHistory();
    assert.equal(historyAfter50.length, 44);
    assert.equal(
      historyAfter50.every((h) => h.source === 'manual'),
      true,
    );

    // Re-importing the exact same 50-row file must NOT double stock
    const totalStockBeforeReimport = (
      await Promise.all(medsAfter50.map((m) => repo.getTotalStock(m.id)))
    ).reduce((a, b) => a + b, 0);

    const reimportResult = await executeBulkImport(db, {
      parsedCsv: parsedPharmacy,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });
    assert.equal(reimportResult.insertedMedicationCount, 0);
    assert.equal(reimportResult.updatedMedicationCount, 44);

    const totalStockAfterReimport = (
      await Promise.all(medsAfter50.map((m) => repo.getTotalStock(m.id)))
    ).reduce((a, b) => a + b, 0);
    assert.equal(totalStockAfterReimport, totalStockBeforeReimport);
  } finally {
    await db.close();
  }

  // 5. Fresh DB acceptance check: 50-row pharmacy import (44 history rows) -> 10-row tariff import (54 history rows)
  const db2 = await SqliteWasmAdapter.create({ filename: ':memory:' });
  try {
    await runMigrations(db2);
    const repo2 = createRepository(db2);

    const parsedPharmacy = parseCsvDocument(buildPharmacy50RowCsv(), { hasHeaderRow: true });
    const pharmacyMapping = autoSuggestColumnMapping(parsedPharmacy.columns);

    const firstImport = await executeBulkImport(db2, {
      parsedCsv: parsedPharmacy,
      mapping: pharmacyMapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });
    assert.equal(firstImport.issues.length, 6);
    assert.equal(firstImport.importedCount, 44);
    assert.equal((await repo2.listAllPriceHistory()).length, 44);

    // Now import the 10-row official tariff file
    const parsedTariff = parseCsvDocument(buildOfficialTariff10RowCsv(), { hasHeaderRow: true });
    assert.equal(parsedTariff.rows.length, 10);
    const tariffMapping = autoSuggestColumnMapping(parsedTariff.columns);

    const tariffImport = await executeBulkImport(db2, {
      parsedCsv: parsedTariff,
      mapping: tariffMapping,
      sourceType: 'official_tariff',
      dryRun: false,
    });

    assert.equal(tariffImport.errorCount, 0);
    assert.equal(tariffImport.importedCount, 10);
    assert.equal(tariffImport.insertedMedicationCount, 0);
    assert.equal(tariffImport.updatedMedicationCount, 10);
    assert.equal(tariffImport.priceHistoryWrittenCount, 10);

    const allMeds = await repo2.listMedications();
    assert.equal(allMeds.length, 44);
    const tariffMeds = allMeds.filter((m) => m.price_source === 'official_tariff');
    assert.equal(tariffMeds.length, 10);
    assert.equal(
      tariffMeds.every((m) => m.price_confirmed === 0),
      true,
    );

    const allHistory = await repo2.listAllPriceHistory();
    assert.equal(allHistory.length, 54);
    assert.equal(allHistory.filter((h) => h.source === 'manual').length, 44);
    assert.equal(allHistory.filter((h) => h.source === 'official_tariff').length, 10);

    // 6. Catalog-only import must ignore prices and NEVER create batch rows
    const batchesBeforeCatalog = await repo2.listAllBatches();
    const parsedCatalogOnly = parseCsvDocument(buildCatalogOnlySampleCsv(), { hasHeaderRow: true });
    const catalogMapping = autoSuggestColumnMapping(parsedCatalogOnly.columns);

    const catalogPreview = await prepareBulkImportPreview(db2, {
      parsedCsv: parsedCatalogOnly,
      mapping: catalogMapping,
      sourceType: 'catalog_only',
    });
    assert.equal(catalogPreview.summary.batchesToWrite, 0);
    assert.equal(catalogPreview.summary.priceHistoryToAppend, 0);

    const catalogResult = await executeBulkImport(db2, {
      parsedCsv: parsedCatalogOnly,
      mapping: catalogMapping,
      sourceType: 'catalog_only',
      dryRun: false,
    });
    assert.equal(catalogResult.importedCount, 5);
    assert.equal(catalogResult.batchesWrittenCount, 0);
    assert.equal(catalogResult.priceHistoryWrittenCount, 0);

    const batchesAfterCatalog = await repo2.listAllBatches();
    assert.equal(batchesAfterCatalog.length, batchesBeforeCatalog.length);

    for (const importedMed of catalogResult.importedMedications) {
      assert.equal(importedMed.unit_price_cents, null);
      assert.equal(importedMed.price_source, null);
      assert.equal(importedMed.price_confirmed, 0);
    }
  } finally {
    await db2.close();
  }
});

test('Medical Information columns: SQLite schema, manual updateMedicationMedicalInfo, and CSV importer support for all 8 fields', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  try {
    await runMigrations(db);
    const repo = createRepository(db);

    const csvWithMedicalColumns = [
      'brand_name,generic_name,strength,dosage_form,barcode,posology,interactions,composition,therapeutic_class,indications,precautions,route,side_effects,quantity,unit_price_cents',
      '"Amlor","Amlodipine","5 mg","Capsule","3400939991112","1 capsule once daily in the morning","CYP3A4 inhibitors, Dantrolene, Simvastatin (>20mg)","Active: Amlodipine besilate 6.93 mg (eq. 5 mg amlodipine). Excipients: Corn starch, lactose","Antihypertensive (Calcium Channel Blocker)","Hypertension and chronic stable or vasospastic angina","Use with caution in hepatic impairment and heart failure","Oral","Peripheral edema, flushing, headache, palpitations, fatigue","40","850"',
    ].join('\n');

    const parsed = parseCsvDocument(csvWithMedicalColumns, { hasHeaderRow: true });
    const mapping = autoSuggestColumnMapping(parsed.columns);

    // Verify all 8 medical columns are automatically mapped by header name
    assert.equal(typeof mapping.posology, 'number');
    assert.equal(typeof mapping.interactions, 'number');
    assert.equal(typeof mapping.composition, 'number');
    assert.equal(typeof mapping.therapeutic_class, 'number');
    assert.equal(typeof mapping.indications, 'number');
    assert.equal(typeof mapping.precautions, 'number');
    assert.equal(typeof mapping.route, 'number');
    assert.equal(typeof mapping.side_effects, 'number');

    const importRes = await executeBulkImport(db, {
      parsedCsv: parsed,
      mapping,
      sourceType: 'pharmacy_spreadsheet',
      dryRun: false,
    });
    assert.equal(importRes.errorCount, 0);
    assert.equal(importRes.insertedMedicationCount, 1);

    const amlor = (await repo.getMedicationByBarcode('3400939991112'))!;
    assert.ok(amlor);
    assert.equal(amlor.posology, '1 capsule once daily in the morning');
    assert.equal(amlor.interactions, 'CYP3A4 inhibitors, Dantrolene, Simvastatin (>20mg)');
    assert.equal(
      amlor.composition,
      'Active: Amlodipine besilate 6.93 mg (eq. 5 mg amlodipine). Excipients: Corn starch, lactose',
    );
    assert.equal(amlor.therapeutic_class, 'Antihypertensive (Calcium Channel Blocker)');
    assert.equal(amlor.indications, 'Hypertension and chronic stable or vasospastic angina');
    assert.equal(amlor.precautions, 'Use with caution in hepatic impairment and heart failure');
    assert.equal(amlor.route, 'Oral');
    assert.equal(amlor.side_effects, 'Peripheral edema, flushing, headache, palpitations, fatigue');

    // Manual update via updateMedicationMedicalInfo
    const updated = await repo.updateMedicationMedicalInfo(amlor.id, {
      posology: '5 mg once daily; may increase to max 10 mg once daily',
      route: 'Oral (Capsule)',
      side_effects: 'Ankle edema, headache, flushing',
    });
    assert.equal(updated.posology, '5 mg once daily; may increase to max 10 mg once daily');
    assert.equal(updated.route, 'Oral (Capsule)');
    assert.equal(updated.side_effects, 'Ankle edema, headache, flushing');
    // Unchanged fields are preserved
    assert.equal(updated.therapeutic_class, 'Antihypertensive (Calcium Channel Blocker)');
    assert.equal(updated.indications, 'Hypertension and chronic stable or vasospastic angina');
  } finally {
    await db.close();
  }
});

