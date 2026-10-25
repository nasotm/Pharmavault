import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations, SqliteWasmAdapter } from '../db';
import {
  formatLocationString,
  formatUnitPriceDisplay,
  getMedicationDetailForSearch,
  searchMedications,
  seed5000Medications,
} from './index';

test('Primary Search Experience — 3-layer search order, NULL price display, and <100ms on 5,000 rows', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });

  try {
    await runMigrations(db);
    const seedStats = await seed5000Medications(db, 5000);
    assert.equal(seedStats.totalMedications, 5000);

    // 1. Acceptance: searching "amox", "Amoxil", and a known barcode all return the correct item within 100ms with 5,000 seeded rows.
    const prefixAmox = await searchMedications(db, 'amox');
    assert.equal(prefixAmox.matchedLayer, 'brand_prefix');
    assert.equal(prefixAmox.results.length >= 1, true);
    assert.equal(prefixAmox.results[0].medication.brand_name, 'Amoxil');
    assert.equal(prefixAmox.results[0].totalStock, 125);
    assert.equal(
      prefixAmox.elapsedMs < 100,
      true,
      `Expected <100ms, got ${prefixAmox.elapsedMs}ms`,
    );

    const exactBrand = await searchMedications(db, 'Amoxil');
    assert.equal(exactBrand.matchedLayer, 'brand_prefix');
    assert.equal(exactBrand.results[0].medication.brand_name, 'Amoxil');
    assert.equal(
      exactBrand.elapsedMs < 100,
      true,
      `Expected <100ms, got ${exactBrand.elapsedMs}ms`,
    );

    const barcodeHit = await searchMedications(db, '0300296008214');
    assert.equal(barcodeHit.matchedLayer, 'barcode_exact');
    assert.equal(barcodeHit.results.length, 1);
    assert.equal(barcodeHit.results[0].medication.brand_name, 'Amoxil');
    assert.equal(
      barcodeHit.elapsedMs < 100,
      true,
      `Expected <100ms, got ${barcodeHit.elapsedMs}ms`,
    );

    // 2. Layer 2c: Fuzzy match (rapidfuzz WRatio > 70) across brand_name + generic_name + all aliases, returning top 10
    const aliasHit = await searchMedications(db, 'Clamoxyl Equivalent');
    assert.equal(aliasHit.matchedLayer, 'fuzzy_wratio');
    assert.equal(aliasHit.results[0].medication.brand_name, 'Amoxil');
    assert.equal(aliasHit.results[0].matchedField, 'alias');
    assert.equal(aliasHit.results[0].wRatioScore > 70, true);
    assert.equal(aliasHit.elapsedMs < 100, true, `Expected <100ms, got ${aliasHit.elapsedMs}ms`);

    const genericFuzzyHit = await searchMedications(db, 'Atorvastatine');
    assert.equal(genericFuzzyHit.matchedLayer, 'fuzzy_wratio');
    assert.equal(genericFuzzyHit.results[0].medication.brand_name, 'Lipitor');
    assert.equal(genericFuzzyHit.results.length <= 10, true);
    assert.equal(
      genericFuzzyHit.elapsedMs < 100,
      true,
      `Expected <100ms, got ${genericFuzzyHit.elapsedMs}ms`,
    );

    // 3. Deliverable 3 & 4: Location formatting and Detail card with NULL unit_price_cents -> "price not entered"
    assert.equal(
      formatLocationString({ zone: 'A', shelf: '03', bin: '2' }),
      'Zone A · Shelf 03 · Bin 2',
    );
    assert.equal(formatUnitPriceDisplay(null), 'price not entered');
    assert.equal(formatUnitPriceDisplay(1240, 'USD'), '$12.40 (1240 ¢)');

    const lantusDetail = await getMedicationDetailForSearch(db, 3);
    assert.ok(lantusDetail);
    assert.equal(lantusDetail.medication.brand_name, 'Lantus SoloStar');
    assert.equal(lantusDetail.medication.unit_price_cents, null);
    assert.equal(lantusDetail.unitPriceDisplay, 'price not entered');
    assert.equal(lantusDetail.totalStock, 30);
    assert.equal(lantusDetail.batches.length, 2);

    // 4. Empty and no-results states
    const emptySearch = await searchMedications(db, '   ');
    assert.equal(emptySearch.matchedLayer, null);
    assert.equal(emptySearch.results.length, 0);

    const noMatchSearch = await searchMedications(db, 'zzzz-nonexistent-drug-999');
    assert.equal(noMatchSearch.matchedLayer, null);
    assert.equal(noMatchSearch.results.length, 0);
    assert.equal(noMatchSearch.query, 'zzzz-nonexistent-drug-999');
  } finally {
    await db.close();
  }
});
