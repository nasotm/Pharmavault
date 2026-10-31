import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runMigrations,
  setRepositoryDatabase,
  SqliteWasmAdapter,
  type DatabasePort,
} from '../db/index';
import { listMedications } from '../db/repository';
import {
  importAlgerianNomenclatureCsv,
  parseNomenclatureCsv,
  SAMPLE_HUGGINGFACE_ALGERIAN_CSV,
} from './algerianNomenclatureService';

describe('Algerian Drug Nomenclature CSV Import Service', () => {
  let db: DatabasePort;

  beforeEach(async () => {
    db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    setRepositoryDatabase(db);
    await runMigrations(db);
  });

  afterEach(async () => {
    setRepositoryDatabase(null);
    await db.close();
  });

  it('parses CSV with PapaParse and extracts brand_name, inn, dosage, form, laboratory', () => {
    const rows = parseNomenclatureCsv(SAMPLE_HUGGINGFACE_ALGERIAN_CSV);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(first['brand_name']).toBe('Amoxil');
    expect(first['inn']).toBe('Amoxicilline');
    expect(first['dosage']).toBe('500 mg');
    expect(first['form']).toBe('Gélule');
    expect(first['laboratory']).toBe('GSK');
  });

  it('imports medications with exact mappings and leaves price, stock, and location NULL', async () => {
    const csv = `brand_name,inn,dosage,form,laboratory
Amoxil,Amoxicilline,500 mg,Gélule,GSK
Glucophage,Metformine,850 mg,Comprimé pelliculé,Merck`;

    const progressSpy = vi.fn();
    const result = await importAlgerianNomenclatureCsv(db, csv, progressSpy);

    expect(result.total).toBe(2);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.summary).toBe('2 medications imported successfully, 0 skipped (duplicates or errors).');
    expect(progressSpy).toHaveBeenCalled();

    const medications = await listMedications(db);
    expect(medications).toHaveLength(2);

    const amoxil = medications.find((m) => m.brand_name === 'Amoxil');
    expect(amoxil).toBeDefined();
    expect(amoxil?.generic_name).toBe('Amoxicilline');
    expect(amoxil?.strength).toBe('500 mg');
    expect(amoxil?.dosage_form).toBe('Gélule');
    expect(amoxil?.manufacturer).toBe('GSK');

    // Price must be strictly NULL
    expect(amoxil?.unit_price_cents).toBeNull();
    expect(amoxil?.cost_price_cents).toBeNull();
    expect(amoxil?.price_confirmed).toBe(0);

    // Location must be NULL
    expect(amoxil?.zone).toBeNull();
    expect(amoxil?.shelf).toBeNull();
    expect(amoxil?.bin).toBeNull();
    expect(amoxil?.location_note).toBeNull();
  });

  it('skips duplicates and reports skipped count in summary', async () => {
    const csv = `brand_name,inn,dosage,form,laboratory
Doliprane,Paracétamol,1000 mg,Comprimé,Sanofi
Doliprane,Paracétamol,1000 mg,Comprimé,Sanofi
,MissingBrand,500 mg,Gélule,Lab
Tahor,Atorvastatine,20 mg,Comprimé,Pfizer`;

    const result = await importAlgerianNomenclatureCsv(db, csv);

    // Row 1: imported (Doliprane)
    // Row 2: skipped (duplicate of Doliprane 1000 mg Comprimé)
    // Row 3: skipped (missing brand_name)
    // Row 4: imported (Tahor)
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.summary).toBe('2 medications imported successfully, 2 skipped (duplicates or errors).');

    // Running the same import again should skip already imported items
    const secondResult = await importAlgerianNomenclatureCsv(db, csv);
    expect(secondResult.imported).toBe(0);
    expect(secondResult.skipped).toBe(4);
    expect(secondResult.summary).toBe('0 medications imported successfully, 4 skipped (duplicates or errors).');
  });

  it('does NOT import prices even if price columns exist in the CSV', async () => {
    const csvWithHistoricalPrices = `brand_name,inn,dosage,form,laboratory,price_decision,ppa_da
Clamoxyl,Amoxicilline,1 g,Poudre,GSK,450.00,520.00`;

    const result = await importAlgerianNomenclatureCsv(db, csvWithHistoricalPrices);
    expect(result.imported).toBe(1);

    const meds = await listMedications(db);
    const clamoxyl = meds.find((m) => m.brand_name === 'Clamoxyl');
    expect(clamoxyl).toBeDefined();
    expect(clamoxyl?.unit_price_cents).toBeNull();
    expect(clamoxyl?.price_confirmed).toBe(0);
  });
});
