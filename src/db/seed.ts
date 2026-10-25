import type { DatabasePort } from './port';
import { createRepository, type CreateMedicationInput, type PriceSource } from './repository';

export interface SeedBatchSpec {
  lot_number: string;
  quantity: number;
  expiry_date: string;
  received_at: string;
}

export interface SeedMedicationSpec {
  medication: CreateMedicationInput;
  aliases: string[];
  batches: SeedBatchSpec[];
  initialPrice?: {
    cents: number;
    source: PriceSource;
    confirmed: 0 | 1;
    changedBy: string;
  };
}

export const SEED_MEDICATIONS: readonly SeedMedicationSpec[] = [
  {
    medication: {
      id: 1,
      brand_name: 'Amoxil',
      generic_name: 'Amoxicillin',
      strength: '500 mg',
      dosage_form: 'Capsule',
      category: 'Antibiotic',
      atc_code: 'J01CA04',
      manufacturer: 'GlaxoSmithKline',
      barcode: '0300296008214',
      storage: 'Room temperature (15-25°C)',
      zone: 'A',
      shelf: 'A1',
      bin: '01',
      location_note: 'Fast-mover antibiotic bay',
      reorder_level: 30,
      lead_time_days: 5,
      unit_price_cents: null,
      cost_price_cents: 820,
      currency: 'USD',
      units_per_pack: 21,
      price_source: null,
      price_confirmed: 0,
      price_updated_at: null,
      updated_at: '2026-10-01T08:00:00.000Z',
    },
    initialPrice: {
      cents: 1250,
      source: 'official_tariff',
      confirmed: 1,
      changedBy: 'pharmacist:claire.dupont',
    },
    aliases: ['Amoxicillin 500', 'Amox 500mg', 'Clamoxyl Equivalent'],
    batches: [
      {
        lot_number: 'AMX-2026-01',
        quantity: 80,
        expiry_date: '2027-06-30',
        received_at: '2026-09-15T09:30:00.000Z',
      },
      {
        lot_number: 'AMX-2026-04',
        quantity: 45,
        expiry_date: '2027-11-30',
        received_at: '2026-10-10T14:15:00.000Z',
      },
    ],
  },
  {
    // LOW-STOCK ITEM: total stock = 6, reorder_level = 15 (6 < 15)
    medication: {
      id: 2,
      brand_name: 'Ventolin HFA',
      generic_name: 'Salbutamol',
      strength: '100 mcg/actuation',
      dosage_form: 'Metered-Dose Inhaler',
      category: 'Bronchodilator',
      atc_code: 'R03AC02',
      manufacturer: 'GlaxoSmithKline',
      barcode: '0301730682204',
      storage: 'Store below 30°C, protect from frost and direct sunlight',
      zone: 'B',
      shelf: 'B2',
      bin: '04',
      location_note: 'Respiratory inhalers rack',
      reorder_level: 15,
      lead_time_days: 7,
      unit_price_cents: null,
      cost_price_cents: 1950,
      currency: 'USD',
      units_per_pack: 1,
      price_source: null,
      price_confirmed: 0,
      price_updated_at: null,
      updated_at: '2026-10-02T10:00:00.000Z',
    },
    initialPrice: {
      cents: 2890,
      source: 'manual',
      confirmed: 1,
      changedBy: 'pharmacist:claire.dupont',
    },
    aliases: ['Albuterol Inhaler', 'Salbutamol 100mcg', 'Ventolin Evohaler'],
    batches: [
      {
        lot_number: 'VEN-2026-02',
        quantity: 6,
        expiry_date: '2026-11-24',
        received_at: '2026-08-20T11:00:00.000Z',
      },
    ],
  },
  {
    // NULL unit_price_cents ITEM: exercises the "price not entered / unknown" path
    medication: {
      id: 3,
      brand_name: 'Lantus SoloStar',
      generic_name: 'Insulin Glargine',
      strength: '100 units/mL',
      dosage_form: 'Pre-filled Pen',
      category: 'Antidiabetic / Basal Insulin',
      atc_code: 'A10AE04',
      manufacturer: 'Sanofi-Aventis',
      barcode: '0300882219052',
      storage: 'Refrigerated (2-8°C)',
      zone: 'C',
      shelf: 'FRIDGE-1',
      bin: 'R2',
      location_note: 'Cold chain middle drawer — do not freeze',
      reorder_level: 10,
      lead_time_days: 3,
      unit_price_cents: null, // Explicitly NULL (unknown price, never 0)
      cost_price_cents: 4100,
      currency: 'USD',
      units_per_pack: 5,
      price_source: null,
      price_confirmed: 0,
      price_updated_at: null,
      updated_at: '2026-10-05T08:45:00.000Z',
    },
    aliases: ['Glargine Pen', 'Lantus 100IU', 'Basal Insulin Glargine'],
    batches: [
      {
        lot_number: 'LAN-2026-08',
        quantity: 18,
        expiry_date: '2026-12-19',
        received_at: '2026-09-28T07:50:00.000Z',
      },
      {
        lot_number: 'LAN-2026-11',
        quantity: 12,
        expiry_date: '2027-08-31',
        received_at: '2026-10-12T08:10:00.000Z',
      },
    ],
  },
  {
    // Imported unconfirmed price item (price_confirmed = 0)
    medication: {
      id: 4,
      brand_name: 'Lipitor',
      generic_name: 'Atorvastatin Calcium',
      strength: '20 mg',
      dosage_form: 'Film-Coated Tablet',
      category: 'Lipid-Modifying Agent',
      atc_code: 'C10AA05',
      manufacturer: 'Viatris / Pfizer',
      barcode: '0300710156238',
      storage: 'Room temperature (20-25°C)',
      zone: 'A',
      shelf: 'A3',
      bin: '09',
      location_note: 'Cardiovascular section',
      reorder_level: 25,
      lead_time_days: 7,
      unit_price_cents: null,
      cost_price_cents: 1120,
      currency: 'USD',
      units_per_pack: 30,
      price_source: null,
      price_confirmed: 0,
      price_updated_at: null,
      updated_at: '2026-10-06T12:20:00.000Z',
    },
    initialPrice: {
      cents: 1840,
      source: 'imported',
      confirmed: 0,
      changedBy: 'catalog-importer',
    },
    aliases: ['Atorvastatin 20mg', 'Tahor 20'],
    batches: [
      {
        lot_number: 'LIP-2026-03',
        quantity: 60,
        expiry_date: '2028-01-31',
        received_at: '2026-09-30T15:40:00.000Z',
      },
    ],
  },
  {
    medication: {
      id: 5,
      brand_name: 'Doliprane',
      generic_name: 'Paracetamol',
      strength: '1000 mg',
      dosage_form: 'Tablet',
      category: 'Analgesic / Antipyretic',
      atc_code: 'N02BE01',
      manufacturer: 'Opella Healthcare (Sanofi)',
      barcode: '3400935955838',
      storage: 'Room temperature (15-25°C), keep dry',
      zone: 'A',
      shelf: 'A1',
      bin: '02',
      location_note: 'High-turnover counter bay',
      reorder_level: 40,
      lead_time_days: 4,
      unit_price_cents: null,
      cost_price_cents: 210,
      currency: 'USD',
      units_per_pack: 8,
      price_source: null,
      price_confirmed: 0,
      price_updated_at: null,
      updated_at: '2026-10-08T16:00:00.000Z',
    },
    initialPrice: {
      cents: 350,
      source: 'official_tariff',
      confirmed: 1,
      changedBy: 'pharmacist:claire.dupont',
    },
    aliases: ['Acetaminophen 1g', 'Paracetamol 1000mg', 'Doliprane 1g'],
    batches: [
      {
        lot_number: 'DOL-2026-05',
        quantity: 110,
        expiry_date: '2028-05-31',
        received_at: '2026-10-01T10:00:00.000Z',
      },
      {
        lot_number: 'DOL-2026-09',
        quantity: 90,
        expiry_date: '2028-09-30',
        received_at: '2026-10-14T11:30:00.000Z',
      },
    ],
  },
];

export interface SeedResult {
  insertedMedications: number;
  skippedMedications: number;
}

/**
 * Seeds the 5 sample medications with aliases, batches, initial stock movements,
 * one low-stock item (Ventolin HFA: stock 6 < reorder_level 15), and one NULL
 * unit_price_cents item (Lantus SoloStar: unit_price_cents = null).
 *
 * Uses only the repository module over DatabasePort.
 */
export async function seedDatabase(db: DatabasePort): Promise<SeedResult> {
  let insertedMedications = 0;
  let skippedMedications = 0;

  await db.transaction(async (tx) => {
    const repo = createRepository(tx);

    for (const item of SEED_MEDICATIONS) {
      const existing = item.medication.barcode
        ? await repo.getMedicationByBarcode(item.medication.barcode)
        : null;

      if (existing) {
        skippedMedications++;
        continue;
      }

      const createdMed = await repo.insertMedication(item.medication);

      if (item.initialPrice) {
        await repo.setPrice(
          createdMed.id,
          item.initialPrice.cents,
          item.initialPrice.source,
          item.initialPrice.confirmed,
          item.initialPrice.changedBy,
        );
      }

      for (const alias of item.aliases) {
        await repo.insertAlias(createdMed.id, alias);
      }

      for (const batchSpec of item.batches) {
        const createdBatch = await repo.insertBatch({
          medication_id: createdMed.id,
          lot_number: batchSpec.lot_number,
          quantity: batchSpec.quantity,
          expiry_date: batchSpec.expiry_date,
          received_at: batchSpec.received_at,
        });

        await repo.insertMovement({
          medication_id: createdMed.id,
          batch_id: createdBatch.id,
          delta: batchSpec.quantity,
          reason: `initial_receipt:${batchSpec.lot_number}`,
          user_id: 'pharmacist:claire.dupont',
          created_at: batchSpec.received_at,
        });
      }

      insertedMedications++;
    }
  });

  return { insertedMedications, skippedMedications };
}
