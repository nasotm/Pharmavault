import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMedicationById,
  getTotalStock,
  listBatchesForMedication,
  listMedications,
  listMovementsForMedication,
  listPriceHistoryForMedication,
  runMigrations,
  seedDatabase,
  setRepositoryDatabase,
  SqliteWasmAdapter,
  type DatabasePort,
} from '../db';
import {
  autoSuggestInventoryMapping,
  buildDryRunPreview,
  importPharmacyInventoryCsv,
  parsePharmacyInventoryCsv,
} from './pharmacyInventoryImportService';

describe('Pharmacy Inventory CSV Importer Service', () => {
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

  it('parses CSV headers, auto-maps columns, and builds a 5-row dry-run preview', () => {
    const csv = `Produit,Code_Barre,PPA,Prix_Achat,Qte,Date_Peremption,Lot,Zone,Rayon,Bac
Amoxil,0300296008214,1320 DA,860,40,2028-03-31,AMX-28,A,A1,01
Doliprane,0340093595583,380,250,120,2028-06-30,DOL-28,A,A1,02
Augmentin,613001,950,680,35,2027-12-31,AUG-27,B,B1,03
Spasfon,613002,420,290,50,2028-05-15,SPS-28,A,A2,04
Smecta,613003,540,370,60,2028-09-30,SMC-28,C,C1,02
Flagyl,613004,310,210,45,2027-10-31,FLG-27,B,B2,01`;

    const parsed = parsePharmacyInventoryCsv(csv);
    expect(parsed.headers).toEqual([
      'Produit',
      'Code_Barre',
      'PPA',
      'Prix_Achat',
      'Qte',
      'Date_Peremption',
      'Lot',
      'Zone',
      'Rayon',
      'Bac',
    ]);
    expect(parsed.rows).toHaveLength(6);

    const mapping = autoSuggestInventoryMapping(parsed.headers);
    expect(mapping).toEqual({
      brand_name: 'Produit',
      barcode: 'Code_Barre',
      unit_price: 'PPA',
      cost_price: 'Prix_Achat',
      quantity: 'Qte',
      expiry_date: 'Date_Peremption',
      lot_number: 'Lot',
      zone: 'Zone',
      shelf: 'Rayon',
      bin: 'Bac',
    });

    const preview = buildDryRunPreview(parsed.rows, mapping, 5);
    expect(preview).toHaveLength(5);
    expect(preview[0]).toMatchObject({
      rowNumber: 1,
      brand_name: 'Amoxil',
      barcode: '0300296008214',
      unit_price: 1320,
      cost_price: 860,
      quantity: 40,
      expiry_date: '2028-03-31',
      lot_number: 'AMX-28',
      zone: 'A',
      shelf: 'A1',
      bin: '01',
      validationError: null,
    });
  });

  it('updates existing medications (price, batch, stock_movement +qty initial_receipt, price_history, location) and creates new ones', async () => {
    const stockBeforeAmoxil = await getTotalStock(db, 1);
    const movementsBeforeAmoxil = await listMovementsForMedication(db, 1);
    const pricesBeforeAmoxil = await listPriceHistoryForMedication(db, 1);

    const csv = `brand_name,barcode,unit_price,cost_price,quantity,expiry_date,lot_number,zone,shelf,bin
Amoxil,0300296008214,1400,900,30,2028-11-30,AMX-NEW-LOT,Z,Z9,99
Clamoxyl Sirops,6139998887771,620,410,25,2028-04-30,CLM-28-01,B,B3,05
,0000000,500,300,10,2028-01-01,ERR-LOT,A,A1,01`;

    const parsed = parsePharmacyInventoryCsv(csv);
    const mapping = autoSuggestInventoryMapping(parsed.headers);

    const progressUpdates: number[] = [];
    const result = await importPharmacyInventoryCsv(db, parsed.rows, mapping, {
      userId: 'Claire Dupont (PIN: 4821)',
      onProgress: (p) => progressUpdates.push(p.processed),
    });

    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.summary).toContain('1 items updated, 1 items created, 1 errors');
    expect(progressUpdates).toEqual([1, 2, 3]);

    // Verify Amoxil (id=1) was updated
    const updatedAmoxil = await getMedicationById(db, 1);
    expect(updatedAmoxil?.unit_price_cents).toBe(1400);
    expect(updatedAmoxil?.cost_price_cents).toBe(900);
    expect(updatedAmoxil?.zone).toBe('Z');
    expect(updatedAmoxil?.shelf).toBe('Z9');
    expect(updatedAmoxil?.bin).toBe('99');

    const stockAfterAmoxil = await getTotalStock(db, 1);
    expect(stockAfterAmoxil).toBe(stockBeforeAmoxil + 30);

    const movementsAfterAmoxil = await listMovementsForMedication(db, 1);
    expect(movementsAfterAmoxil).toHaveLength(movementsBeforeAmoxil.length + 1);
    const latestMovement = movementsAfterAmoxil[movementsAfterAmoxil.length - 1];
    expect(latestMovement.delta).toBe(30);
    expect(latestMovement.reason).toBe('initial_receipt');

    const pricesAfterAmoxil = await listPriceHistoryForMedication(db, 1);
    expect(pricesAfterAmoxil).toHaveLength(pricesBeforeAmoxil.length + 1);
    expect(pricesAfterAmoxil[pricesAfterAmoxil.length - 1].unit_price_cents).toBe(1400);

    // Verify Clamoxyl Sirops was created with batch, movement, and price history
    const allMeds = await listMedications(db);
    const clamoxyl = allMeds.find((m) => m.brand_name === 'Clamoxyl Sirops');
    expect(clamoxyl).toBeDefined();
    expect(clamoxyl?.unit_price_cents).toBe(620);
    expect(clamoxyl?.cost_price_cents).toBe(410);
    expect(clamoxyl?.zone).toBe('B');
    expect(clamoxyl?.shelf).toBe('B3');
    expect(clamoxyl?.bin).toBe('05');

    const clamoxylBatches = await listBatchesForMedication(db, clamoxyl!.id);
    expect(clamoxylBatches).toHaveLength(1);
    expect(clamoxylBatches[0].quantity).toBe(25);
    expect(clamoxylBatches[0].lot_number).toBe('CLM-28-01');

    const clamoxylMovements = await listMovementsForMedication(db, clamoxyl!.id);
    expect(clamoxylMovements).toHaveLength(1);
    expect(clamoxylMovements[0].delta).toBe(25);
    expect(clamoxylMovements[0].reason).toBe('initial_receipt');
  });
});
