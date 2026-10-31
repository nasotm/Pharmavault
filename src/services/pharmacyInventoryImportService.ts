import Papa from 'papaparse';
import type { DatabasePort, SqlParam } from '../db/port';
import {
  insertBatch,
  insertMedication,
  insertMovement,
  insertPriceHistory,
  type Medication,
} from '../db/repository';

export type PharmacyInventoryFieldKey =
  | 'brand_name'
  | 'barcode'
  | 'unit_price'
  | 'cost_price'
  | 'quantity'
  | 'expiry_date'
  | 'lot_number'
  | 'zone'
  | 'shelf'
  | 'bin';

export interface PharmacyInventoryFieldDescriptor {
  key: PharmacyInventoryFieldKey;
  label: string;
  required: boolean;
  description: string;
}

export const PHARMACY_INVENTORY_TARGET_FIELDS: readonly PharmacyInventoryFieldDescriptor[] = [
  {
    key: 'brand_name',
    label: 'Brand Name (brand_name)',
    required: true,
    description: 'Commercial medication name (used to match or create item)',
  },
  {
    key: 'barcode',
    label: 'Barcode (barcode)',
    required: false,
    description: 'Optional EAN/UPC barcode (checked first for matching)',
  },
  {
    key: 'unit_price',
    label: 'Unit Price in DA (unit_price)',
    required: false,
    description: 'Selling unit price as integer Algerian Dinar (DA)',
  },
  {
    key: 'cost_price',
    label: 'Cost Price in DA (cost_price)',
    required: false,
    description: 'Optional wholesale purchase price in integer DA',
  },
  {
    key: 'quantity',
    label: 'Stock Quantity (quantity)',
    required: false,
    description: 'Batch stock quantity to add (+qty initial_receipt)',
  },
  {
    key: 'expiry_date',
    label: 'Expiry Date (expiry_date)',
    required: false,
    description: 'Batch expiration date (YYYY-MM-DD)',
  },
  {
    key: 'lot_number',
    label: 'Lot Number (lot_number)',
    required: false,
    description: 'Manufacturer batch / lot identifier',
  },
  {
    key: 'zone',
    label: 'Zone (zone)',
    required: false,
    description: 'Dispensary storage zone (e.g., A, B, Fridge)',
  },
  {
    key: 'shelf',
    label: 'Shelf (shelf)',
    required: false,
    description: 'Shelf coordinate (e.g., A1, B2)',
  },
  {
    key: 'bin',
    label: 'Bin (bin)',
    required: false,
    description: 'Bin or drawer coordinate (e.g., 01, 04)',
  },
];

export type PharmacyColumnMapping = Partial<Record<PharmacyInventoryFieldKey, string>>;

export interface ParsedPharmacyCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export interface DryRunPreviewRow {
  rowNumber: number;
  brand_name: string;
  barcode: string | null;
  unit_price: number | null;
  cost_price: number | null;
  quantity: number;
  expiry_date: string | null;
  lot_number: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  validationError: string | null;
}

export interface PharmacyImportErrorDetail {
  rowNumber: number;
  brandName: string;
  message: string;
}

export interface PharmacyImportProgress {
  processed: number;
  total: number;
  updated: number;
  created: number;
  errorsCount: number;
  currentItem?: string;
}

export interface PharmacyImportExecutionResult {
  total: number;
  updated: number;
  created: number;
  errors: PharmacyImportErrorDetail[];
  summary: string;
}

const HEADER_SYNONYMS: Record<PharmacyInventoryFieldKey, readonly string[]> = {
  brand_name: [
    'brand_name',
    'brand',
    'brandname',
    'name',
    'medication',
    'nom_commercial',
    'nom',
    'produit',
    'designation',
  ],
  barcode: ['barcode', 'ean', 'ean13', 'upc', 'code_barre', 'code_barres', 'cip', 'gtin'],
  unit_price: [
    'unit_price',
    'unitprice',
    'price',
    'price_da',
    'unit_price_da',
    'selling_price',
    'prix',
    'prix_vente',
    'ppa',
    'tarif',
  ],
  cost_price: [
    'cost_price',
    'costprice',
    'cost',
    'cost_da',
    'purchase_price',
    'prix_achat',
    'pght',
  ],
  quantity: ['quantity', 'qty', 'stock', 'qte', 'quantite', 'initial_quantity', 'count', 'units'],
  expiry_date: [
    'expiry_date',
    'expiry',
    'exp_date',
    'exp',
    'expiration',
    'date_peremption',
    'peremption',
  ],
  lot_number: ['lot_number', 'lot', 'batch', 'batch_number', 'numero_lot', 'num_lot'],
  zone: ['zone', 'area', 'secteur', 'emplacement_zone'],
  shelf: ['shelf', 'rayon', 'etagere', 'rack'],
  bin: ['bin', 'bac', 'casier', 'tiroir', 'box'],
};

/**
 * Parses a CSV string using PapaParse and returns detected column headers and data rows.
 */
export function parsePharmacyInventoryCsv(csvText: string): ParsedPharmacyCsv {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return { headers: [], rows: [] };
  }

  const parsed = Papa.parse<Record<string, unknown>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  const headers = (parsed.meta.fields ?? []).map((h) => h.trim()).filter(Boolean);
  const rows: Record<string, string>[] = [];

  for (const rawRow of parsed.data) {
    if (!rawRow || typeof rawRow !== 'object') continue;
    const normalizedRow: Record<string, string> = {};
    let hasNonEmptyValue = false;
    for (const [k, v] of Object.entries(rawRow)) {
      const cleanKey = k.trim();
      const cleanVal = v === null || v === undefined ? '' : String(v).trim();
      normalizedRow[cleanKey] = cleanVal;
      if (cleanVal !== '') {
        hasNonEmptyValue = true;
      }
    }
    if (hasNonEmptyValue) {
      rows.push(normalizedRow);
    }
  }

  return { headers, rows };
}

/**
 * Automatically suggests a mapping from detected CSV headers to target database fields.
 */
export function autoSuggestInventoryMapping(headers: readonly string[]): PharmacyColumnMapping {
  const mapping: PharmacyColumnMapping = {};
  const usedHeaders = new Set<string>();

  for (const field of PHARMACY_INVENTORY_TARGET_FIELDS) {
    const candidates = HEADER_SYNONYMS[field.key];
    for (const candidate of candidates) {
      const match = headers.find(
        (h) =>
          !usedHeaders.has(h) &&
          h.toLowerCase().replace(/[\s_-]+/g, '_') ===
            candidate.toLowerCase().replace(/[\s_-]+/g, '_'),
      );
      if (match) {
        mapping[field.key] = match;
        usedHeaders.add(match);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Parses a price string in Algerian Dinar (DA) into a non-negative integer.
 * Returns `{ value: number | null, error: string | null }`.
 */
export function parseIntegerDaPrice(
  raw: string | null | undefined,
  fieldLabel: string,
): { value: number | null; error: string | null } {
  if (raw === null || raw === undefined) {
    return { value: null, error: null };
  }
  const cleaned = raw
    .replace(/\b(DA|DZD)\b/gi, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .trim();

  if (cleaned === '') {
    return { value: null, error: null };
  }

  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) {
    return {
      value: null,
      error: `Invalid ${fieldLabel} "${raw}" (must be a non-negative integer in DA)`,
    };
  }

  const rounded = Math.round(num);
  if (!Number.isSafeInteger(rounded)) {
    return {
      value: null,
      error: `Out-of-range ${fieldLabel} "${raw}"`,
    };
  }

  return { value: rounded, error: null };
}

/**
 * Parses a stock quantity string into a non-negative integer.
 */
export function parseIntegerQuantity(
  raw: string | null | undefined,
): { value: number; error: string | null } {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { value: 0, error: null };
  }
  const cleaned = raw.trim();
  const num = Number(cleaned);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
    return {
      value: 0,
      error: `Invalid quantity "${raw}" (must be a non-negative whole number)`,
    };
  }
  return { value: num, error: null };
}

/**
 * Maps a single raw CSV row using the provided column mapping and validates its fields.
 */
export function mapAndValidateInventoryRow(
  row: Record<string, string>,
  mapping: PharmacyColumnMapping,
  rowNumber: number,
): DryRunPreviewRow {
  const getVal = (key: PharmacyInventoryFieldKey): string => {
    const colName = mapping[key];
    if (!colName) return '';
    return (row[colName] ?? '').trim();
  };

  const brandName = getVal('brand_name');
  const barcode = getVal('barcode') || null;
  const rawUnitPrice = getVal('unit_price');
  const rawCostPrice = getVal('cost_price');
  const rawQuantity = getVal('quantity');
  const expiryDate = getVal('expiry_date') || null;
  const lotNumber = getVal('lot_number') || null;
  const zone = getVal('zone') || null;
  const shelf = getVal('shelf') || null;
  const bin = getVal('bin') || null;

  const errors: string[] = [];

  if (!brandName) {
    errors.push('Missing required brand_name');
  }

  const unitPriceParsed = parseIntegerDaPrice(rawUnitPrice, 'unit_price');
  if (unitPriceParsed.error) {
    errors.push(unitPriceParsed.error);
  }

  const costPriceParsed = parseIntegerDaPrice(rawCostPrice, 'cost_price');
  if (costPriceParsed.error) {
    errors.push(costPriceParsed.error);
  }

  const quantityParsed = parseIntegerQuantity(rawQuantity);
  if (quantityParsed.error) {
    errors.push(quantityParsed.error);
  }

  return {
    rowNumber,
    brand_name: brandName,
    barcode,
    unit_price: unitPriceParsed.value,
    cost_price: costPriceParsed.value,
    quantity: quantityParsed.value,
    expiry_date: expiryDate,
    lot_number: lotNumber,
    zone,
    shelf,
    bin,
    validationError: errors.length > 0 ? errors.join('; ') : null,
  };
}

/**
 * Builds the Dry-Run Preview for the first `limit` rows (default 5).
 */
export function buildDryRunPreview(
  rows: readonly Record<string, string>[],
  mapping: PharmacyColumnMapping,
  limit = 5,
): DryRunPreviewRow[] {
  return rows
    .slice(0, limit)
    .map((row, idx) => mapAndValidateInventoryRow(row, mapping, idx + 1));
}

/**
 * Finds an existing medication by exact barcode (if provided) or case-insensitive brand_name.
 */
async function findExistingMedication(
  tx: DatabasePort,
  brandName: string,
  barcode: string | null,
): Promise<Medication | null> {
  if (barcode) {
    const byBarcode = await tx.query<Record<string, SqlParam>>(
      'SELECT * FROM medication WHERE barcode = ? LIMIT 1',
      [barcode],
    );
    if (byBarcode.length > 0) {
      return byBarcode[0] as unknown as Medication;
    }
  }

  const byBrand = await tx.query<Record<string, SqlParam>>(
    'SELECT * FROM medication WHERE LOWER(TRIM(brand_name)) = LOWER(TRIM(?)) ORDER BY id ASC LIMIT 1',
    [brandName],
  );
  if (byBrand.length > 0) {
    return byBrand[0] as unknown as Medication;
  }

  return null;
}

/**
 * Executes the Pharmacy Inventory CSV import:
 * - Searches the database for an existing medication with the same `brand_name` (or `barcode` if provided).
 * - If found: Updates its price (integer DA), adds a new batch with quantity/expiry/lot, updates its location,
 *   and writes a `stock_movement` row (+qty, 'initial_receipt') and a `price_history` row.
 * - If NOT found: Creates a new medication with the mapped data, adds its initial batch, stock_movement, and price_history.
 */
export async function importPharmacyInventoryCsv(
  db: DatabasePort,
  rows: readonly Record<string, string>[],
  mapping: PharmacyColumnMapping,
  options?: {
    userId?: string;
    onProgress?: (progress: PharmacyImportProgress) => void;
  },
): Promise<PharmacyImportExecutionResult> {
  const total = rows.length;
  const userId = options?.userId?.trim() || 'Pharmacist';

  if (total === 0) {
    return {
      total: 0,
      updated: 0,
      created: 0,
      errors: [],
      summary: '0 items updated, 0 items created, 0 errors.',
    };
  }

  let updated = 0;
  let created = 0;
  const errors: PharmacyImportErrorDetail[] = [];

  for (let i = 0; i < total; i++) {
    const rowNumber = i + 1;
    const mapped = mapAndValidateInventoryRow(rows[i], mapping, rowNumber);

    if (mapped.validationError) {
      errors.push({
        rowNumber,
        brandName: mapped.brand_name || `Row #${rowNumber}`,
        message: `Row ${rowNumber} (${mapped.brand_name || 'Unknown'}): ${mapped.validationError}`,
      });
    } else {
      try {
        await db.transaction(async (tx) => {
          const nowIso = new Date().toISOString();
          const existing = await findExistingMedication(tx, mapped.brand_name, mapped.barcode);

          if (existing) {
            const medId = Number(existing.id);
            const nextUnitPrice =
              mapped.unit_price !== null
                ? mapped.unit_price
                : existing.unit_price_cents !== null && existing.unit_price_cents !== undefined
                  ? Number(existing.unit_price_cents)
                  : null;
            const nextCostPrice =
              mapped.cost_price !== null
                ? mapped.cost_price
                : existing.cost_price_cents !== null && existing.cost_price_cents !== undefined
                  ? Number(existing.cost_price_cents)
                  : null;
            const nextZone = mapped.zone ?? existing.zone ?? null;
            const nextShelf = mapped.shelf ?? existing.shelf ?? null;
            const nextBin = mapped.bin ?? existing.bin ?? null;
            const nextBarcode = existing.barcode || mapped.barcode || null;
            const nextPriceSource =
              mapped.unit_price !== null ? 'imported' : (existing.price_source ?? null);
            const nextPriceConfirmed =
              mapped.unit_price !== null ? 1 : Number(existing.price_confirmed ?? 0);
            const nextPriceUpdatedAt =
              mapped.unit_price !== null ? nowIso : (existing.price_updated_at ?? null);

            await tx.exec(
              `UPDATE medication
               SET unit_price_cents = ?,
                   cost_price_cents = ?,
                   price_source = ?,
                   price_confirmed = ?,
                   price_updated_at = ?,
                   zone = ?,
                   shelf = ?,
                   bin = ?,
                   barcode = ?,
                   is_archived = 0,
                   updated_at = ?
               WHERE id = ?`,
              [
                nextUnitPrice,
                nextCostPrice,
                nextPriceSource,
                nextPriceConfirmed,
                nextPriceUpdatedAt,
                nextZone,
                nextShelf,
                nextBin,
                nextBarcode,
                nowIso,
                medId,
              ],
            );

            const lotVal = mapped.lot_number || `LOT-${medId}-${rowNumber}`;
            const createdBatch = await insertBatch(tx, {
              medication_id: medId,
              lot_number: lotVal,
              quantity: mapped.quantity,
              expiry_date: mapped.expiry_date,
              received_at: nowIso,
            });

            await insertMovement(tx, {
              medication_id: medId,
              batch_id: createdBatch.id,
              delta: mapped.quantity,
              reason: 'initial_receipt',
              user_id: userId,
              created_at: nowIso,
            });

            await insertPriceHistory(tx, {
              medication_id: medId,
              unit_price_cents: nextUnitPrice,
              source: 'imported',
              changed_by: userId,
              created_at: nowIso,
            });

            updated++;
          } else {
            const newMed = await insertMedication(tx, {
              brand_name: mapped.brand_name,
              generic_name: mapped.brand_name,
              barcode: mapped.barcode,
              zone: mapped.zone ?? 'A',
              shelf: mapped.shelf ?? '1',
              bin: mapped.bin ?? '1',
              unit_price_cents: mapped.unit_price,
              cost_price_cents: mapped.cost_price,
              currency: 'DZD',
              currency_code: 'DZD',
              units_per_pack: 1,
              price_source: mapped.unit_price !== null ? 'imported' : null,
              price_confirmed: mapped.unit_price !== null ? 1 : 0,
              price_updated_at: mapped.unit_price !== null ? nowIso : null,
              updated_at: nowIso,
            });

            const lotVal = mapped.lot_number || `LOT-${newMed.id}-${rowNumber}`;
            const createdBatch = await insertBatch(tx, {
              medication_id: newMed.id,
              lot_number: lotVal,
              quantity: mapped.quantity,
              expiry_date: mapped.expiry_date,
              received_at: nowIso,
            });

            await insertMovement(tx, {
              medication_id: newMed.id,
              batch_id: createdBatch.id,
              delta: mapped.quantity,
              reason: 'initial_receipt',
              user_id: userId,
              created_at: nowIso,
            });

            if (mapped.unit_price !== null) {
              await insertPriceHistory(tx, {
                medication_id: newMed.id,
                unit_price_cents: mapped.unit_price,
                source: 'imported',
                changed_by: userId,
                created_at: nowIso,
              });
            }

            created++;
          }
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({
          rowNumber,
          brandName: mapped.brand_name || `Row #${rowNumber}`,
          message: `Row ${rowNumber} (${mapped.brand_name}): ${errMsg}`,
        });
      }
    }

    if (options?.onProgress) {
      options.onProgress({
        processed: i + 1,
        total,
        updated,
        created,
        errorsCount: errors.length,
        currentItem: mapped.brand_name || `Row #${rowNumber}`,
      });
    }

    // Yield periodically to keep UI progress bar responsive
    if (i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const errorDetailsSuffix =
    errors.length > 0 ? ` (${errors.map((e) => e.message).join(' | ')})` : '';
  const summary = `${updated} items updated, ${created} items created, ${errors.length} errors${errorDetailsSuffix}.`;

  return {
    total,
    updated,
    created,
    errors,
    summary,
  };
}

export const SAMPLE_PHARMACY_INVENTORY_CSV = `brand_name,barcode,unit_price,cost_price,quantity,expiry_date,lot_number,zone,shelf,bin
Amoxil,0300296008214,1320,860,40,2028-03-31,AMX-2028-09,A,A1,01
Doliprane,0340093595583,380,250,120,2028-06-30,DOL-2028-02,A,A1,02
Augmentin Adulte,6130044556677,950,680,35,2027-12-31,AUG-27-11,B,B1,03
Spasfon Lyoc,6130099887766,420,290,50,2028-05-15,SPS-28-05,A,A2,04
Smecta Orange,6130011223344,540,370,60,2028-09-30,SMC-28-09,C,C1,02
Flagyl 500mg,6130055443322,310,210,45,2027-10-31,FLG-27-10,B,B2,01`;
