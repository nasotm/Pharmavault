import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, SqliteWasmAdapter, type DatabasePort } from '../db';
import {
  formatLocationString,
  formatUnitPriceDisplay,
  getMedicationDetailForSearch,
  searchMedications,
  seed5000Medications,
} from './index';

describe('Primary Search Experience — 3-Layer Search & 5,000-Row Sub-100ms Acceptance', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('meets acceptance criteria: searching "amox", "Amoxil", and a known barcode all return the correct item within 100ms with 5,000 seeded rows', async () => {
    const seeded = await seed5000Medications(db, 5000);
    expect(seeded.totalMedications).toBe(5000);

    // 1. "amox" -> brand_name prefix match
    const resAmox = await searchMedications(db, 'amox');
    expect(resAmox.matchedLayer).toBe('brand_prefix');
    expect(resAmox.results[0]?.medication.brand_name).toBe('Amoxil');
    expect(resAmox.elapsedMs).toBeLessThan(100);

    // 2. "Amoxil" -> brand_name prefix match
    const resAmoxil = await searchMedications(db, 'Amoxil');
    expect(resAmoxil.matchedLayer).toBe('brand_prefix');
    expect(resAmoxil.results[0]?.medication.brand_name).toBe('Amoxil');
    expect(resAmoxil.elapsedMs).toBeLessThan(100);

    // 3. Known barcode ("0300296008214") -> exact barcode match (stops at first hit)
    const resBarcode = await searchMedications(db, '0300296008214');
    expect(resBarcode.matchedLayer).toBe('barcode_exact');
    expect(resBarcode.results).toHaveLength(1);
    expect(resBarcode.results[0]?.medication.brand_name).toBe('Amoxil');
    expect(resBarcode.elapsedMs).toBeLessThan(100);

    // 4. Fuzzy match (WRatio > 70) across brand_name + generic_name + all aliases, returning top 10
    const resFuzzyAlias = await searchMedications(db, 'Clamoxyl Equivalent');
    expect(resFuzzyAlias.matchedLayer).toBe('fuzzy_wratio');
    expect(resFuzzyAlias.results[0]?.medication.brand_name).toBe('Amoxil');
    expect(resFuzzyAlias.results.length).toBeLessThanOrEqual(10);
    expect(resFuzzyAlias.elapsedMs).toBeLessThan(100);
  });

  it('formats prominent location string and shows "price not entered" (never 0.00) when unit_price_cents IS NULL', async () => {
    await seed5000Medications(db, 10);

    expect(formatLocationString({ zone: 'A', shelf: '03', bin: '2' })).toBe(
      'Zone A · Shelf 03 · Bin 2',
    );
    expect(formatUnitPriceDisplay(null)).toBe('price not entered');
    expect(formatUnitPriceDisplay(null)).not.toContain('0.00');

    const lantusDetail = await getMedicationDetailForSearch(db, 3);
    expect(lantusDetail).not.toBeNull();
    expect(lantusDetail!.medication.unit_price_cents).toBeNull();
    expect(lantusDetail!.unitPriceDisplay).toBe('price not entered');
    expect(lantusDetail!.batches).toHaveLength(2);
    expect(lantusDetail!.totalStock).toBe(30);
  });
});
