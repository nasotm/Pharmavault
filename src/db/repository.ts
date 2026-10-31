/**
 * =============================================================================
 * ARCHITECTURAL BOUNDARY — AI LAYER WRITE RESTRICTIONS (ENFORCED)
 * =============================================================================
 * The AI layer (built later) must NEVER write to price (`unit_price_cents`,
 * `cost_price_cents`, `currency`, `units_per_pack`, `price_source`,
 * `price_confirmed`, `price_updated_at`), `atc_code`, `generic_name`,
 * `manufacturer`, `brand_name`, `strength`, `dosage_form`, `category`,
 * `barcode`, `storage`, or any catalog field.
 *
 * - LAYER 1 (Catalog / Reference): Imported from authoritative reference
 *   catalogs only; never mutated by the AI layer.
 * - LAYER 2 (Local Inventory): Managed by the pharmacist (`zone`, `shelf`,
 *   `bin`, `location_note`, `reorder_level`, `lead_time_days`).
 * - LAYER 3 (Price): Confirmed by the pharmacist (`unit_price_cents` is
 *   strictly INTEGER cents or NULL for unknown; never 0 by default, never
 *   coerced from NULL to 0, and never fetched or written silently by AI).
 * - `stock_movement` and `price_history` are strictly APPEND-ONLY ledgers:
 *   no update or delete functions exist in this repository module.
 * =============================================================================
 */

import type { DatabasePort, SqlParam } from './port';

export type PriceSource = 'manual' | 'official_tariff' | 'imported';

export interface CurrencyRecord {
  code: string;
  name: string;
  symbol: string;
  rate_to_da: number;
}

export const DEFAULT_CURRENCIES: readonly CurrencyRecord[] = [
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'DA', rate_to_da: 1 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate_to_da: 146.5 },
  { code: 'USD', name: 'US Dollar', symbol: '$', rate_to_da: 134.5 },
  { code: 'GBP', name: 'British Pound', symbol: '£', rate_to_da: 171.0 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', rate_to_da: 98.5 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', rate_to_da: 152.0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', rate_to_da: 18.8 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', rate_to_da: 4.1 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', rate_to_da: 36.6 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', rate_to_da: 35.8 },
];

export interface Medication {
  id: number;
  // LAYER 1: catalog / reference (imported, not typed by hand)
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  category: string | null;
  atc_code: string | null;
  manufacturer: string | null;
  barcode: string | null;
  storage: string | null;
  // Detailed medical information
  posology?: string | null;
  interactions?: string | null;
  composition?: string | null;
  therapeutic_class?: string | null;
  indications?: string | null;
  precautions?: string | null;
  route?: string | null;
  side_effects?: string | null;
  // LAYER 2: local inventory (pharmacist only)
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  reorder_level: number;
  lead_time_days: number;
  // LAYER 3: price (pharmacist confirms; never fetched silently)
  unit_price_cents: number | null; // NULL = unknown, NOT 0
  cost_price_cents: number | null;
  currency: string;
  currency_code?: string;
  units_per_pack: number;
  price_source: PriceSource | null;
  price_confirmed: 0 | 1;
  price_updated_at: string | null;
  updated_at: string | null;
  is_archived?: 0 | 1;
}

export interface MedicationAlias {
  id: number;
  medication_id: number;
  alias: string;
}

export interface MedicationWithAliases extends Medication {
  aliases: string[];
  alias_records: MedicationAlias[];
}

export interface Batch {
  id: number;
  medication_id: number;
  lot_number: string | null;
  quantity: number;
  expiry_date: string | null;
  received_at: string | null;
}

export interface StockMovement {
  id: number;
  medication_id: number;
  batch_id: number | null;
  delta: number;
  reason: string | null;
  user_id: string | null;
  created_at: string;
}

export interface PriceHistory {
  id: number;
  medication_id: number;
  unit_price_cents: number | null;
  source: PriceSource | null;
  changed_by: string | null;
  created_at: string;
}

export interface CreateMedicationInput {
  id?: number;
  brand_name: string;
  generic_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  category?: string | null;
  atc_code?: string | null;
  manufacturer?: string | null;
  barcode?: string | null;
  storage?: string | null;
  posology?: string | null;
  interactions?: string | null;
  composition?: string | null;
  therapeutic_class?: string | null;
  indications?: string | null;
  precautions?: string | null;
  route?: string | null;
  side_effects?: string | null;
  zone?: string | null;
  shelf?: string | null;
  bin?: string | null;
  location_note?: string | null;
  reorder_level?: number;
  lead_time_days?: number;
  unit_price_cents?: number | null; // NULL = unknown, never defaulted to 0
  cost_price_cents?: number | null;
  currency?: string;
  currency_code?: string;
  units_per_pack?: number;
  price_source?: PriceSource | null;
  price_confirmed?: 0 | 1 | boolean;
  price_updated_at?: string | null;
  updated_at?: string | null;
  is_archived?: 0 | 1 | boolean;
}

export interface UpdateMedicationLocalInventoryInput {
  zone?: string | null;
  shelf?: string | null;
  bin?: string | null;
  location_note?: string | null;
  reorder_level?: number;
  lead_time_days?: number;
}

export interface UpdateMedicationMedicalInfoInput {
  posology?: string | null;
  interactions?: string | null;
  composition?: string | null;
  therapeutic_class?: string | null;
  indications?: string | null;
  precautions?: string | null;
  route?: string | null;
  side_effects?: string | null;
}

export interface CreateBatchInput {
  id?: number;
  medication_id: number;
  lot_number?: string | null;
  quantity: number;
  expiry_date?: string | null;
  received_at?: string | null;
}

export interface InsertMovementInput {
  medication_id?: number;
  medicationId?: number;
  batch_id?: number | null;
  batchId?: number | null;
  delta: number;
  reason?: string | null;
  user_id?: string | null;
  userId?: string | null;
  created_at?: string;
  createdAt?: string;
}

export interface InsertPriceHistoryInput {
  medication_id: number;
  unit_price_cents: number | null;
  source: PriceSource;
  changed_by?: string | null;
  created_at?: string;
}

const VALID_PRICE_SOURCES: ReadonlySet<string> = new Set(['manual', 'official_tariff', 'imported']);

/**
 * Validates that a money value is strictly a safe integer number of cents or null.
 * Rejects floats, NaN, Infinity, strings, and negative numbers.
 * Never coerces null/undefined to 0.
 */
export function assertNullableIntegerCents(
  value: unknown,
  fieldName = 'unit_price_cents',
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new TypeError(
      `${fieldName} must be an integer number of cents or null (received ${typeof value}: ${String(value)})`,
    );
  }
  if (value < 0) {
    throw new RangeError(`${fieldName} cannot be negative (received ${value})`);
  }
  return value;
}

export function assertValidPriceSource(source: unknown, allowNull = false): PriceSource | null {
  if ((source === null || source === undefined) && allowNull) {
    return null;
  }
  if (typeof source !== 'string' || !VALID_PRICE_SOURCES.has(source)) {
    throw new TypeError(
      `Invalid price source "${String(source)}". Expected 'manual' | 'official_tariff' | 'imported'.`,
    );
  }
  return source as PriceSource;
}

function normalizeMedicationRow(row: Record<string, SqlParam>): Medication {
  return {
    id: Number(row.id),
    brand_name: String(row.brand_name),
    generic_name:
      row.generic_name === null || row.generic_name === undefined ? null : String(row.generic_name),
    strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
    dosage_form:
      row.dosage_form === null || row.dosage_form === undefined ? null : String(row.dosage_form),
    category: row.category === null || row.category === undefined ? null : String(row.category),
    atc_code: row.atc_code === null || row.atc_code === undefined ? null : String(row.atc_code),
    manufacturer:
      row.manufacturer === null || row.manufacturer === undefined ? null : String(row.manufacturer),
    barcode: row.barcode === null || row.barcode === undefined ? null : String(row.barcode),
    storage: row.storage === null || row.storage === undefined ? null : String(row.storage),
    posology: row.posology === null || row.posology === undefined ? null : String(row.posology),
    interactions:
      row.interactions === null || row.interactions === undefined ? null : String(row.interactions),
    composition:
      row.composition === null || row.composition === undefined ? null : String(row.composition),
    therapeutic_class:
      row.therapeutic_class === null || row.therapeutic_class === undefined
        ? null
        : String(row.therapeutic_class),
    indications:
      row.indications === null || row.indications === undefined ? null : String(row.indications),
    precautions:
      row.precautions === null || row.precautions === undefined ? null : String(row.precautions),
    route: row.route === null || row.route === undefined ? null : String(row.route),
    side_effects:
      row.side_effects === null || row.side_effects === undefined
        ? null
        : String(row.side_effects),
    zone: row.zone === null || row.zone === undefined ? null : String(row.zone),
    shelf: row.shelf === null || row.shelf === undefined ? null : String(row.shelf),
    bin: row.bin === null || row.bin === undefined ? null : String(row.bin),
    location_note:
      row.location_note === null || row.location_note === undefined
        ? null
        : String(row.location_note),
    reorder_level:
      row.reorder_level === null || row.reorder_level === undefined
        ? 10
        : Number(row.reorder_level),
    lead_time_days:
      row.lead_time_days === null || row.lead_time_days === undefined
        ? 7
        : Number(row.lead_time_days),
    // CRITICAL: Preserve NULL as null; NEVER coerce NULL to 0.
    unit_price_cents:
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents),
    cost_price_cents:
      row.cost_price_cents === null || row.cost_price_cents === undefined
        ? null
        : Number(row.cost_price_cents),
    currency:
      row.currency_code !== null &&
      row.currency_code !== undefined &&
      String(row.currency_code).trim() !== ''
        ? String(row.currency_code).trim().toUpperCase()
        : row.currency === null || row.currency === undefined
          ? 'DZD'
          : String(row.currency).trim().toUpperCase(),
    currency_code:
      row.currency_code !== null &&
      row.currency_code !== undefined &&
      String(row.currency_code).trim() !== ''
        ? String(row.currency_code).trim().toUpperCase()
        : row.currency === null || row.currency === undefined
          ? 'DZD'
          : String(row.currency).trim().toUpperCase(),
    units_per_pack:
      row.units_per_pack === null || row.units_per_pack === undefined
        ? 1
        : Number(row.units_per_pack),
    price_source:
      row.price_source === null || row.price_source === undefined
        ? null
        : (String(row.price_source) as PriceSource),
    price_confirmed: Number(row.price_confirmed) === 1 ? 1 : 0,
    price_updated_at:
      row.price_updated_at === null || row.price_updated_at === undefined
        ? null
        : String(row.price_updated_at),
    updated_at:
      row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
    is_archived: Number(row.is_archived) === 1 ? 1 : 0,
  };
}

function isDatabasePort(candidate: unknown): candidate is DatabasePort {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'query' in candidate &&
    typeof (candidate as DatabasePort).query === 'function' &&
    'exec' in candidate &&
    typeof (candidate as DatabasePort).exec === 'function' &&
    'transaction' in candidate &&
    typeof (candidate as DatabasePort).transaction === 'function'
  );
}

let defaultDatabasePort: DatabasePort | null = null;

/**
 * Sets the active DatabasePort used when top-level repository functions are called
 * without passing an explicit DatabasePort as the first argument.
 */
export function setRepositoryDatabase(db: DatabasePort | null): void {
  defaultDatabasePort = db;
}

export function hasRepositoryDatabase(): boolean {
  return defaultDatabasePort !== null;
}

export function getRepositoryDatabase(): DatabasePort {
  if (!defaultDatabasePort) {
    throw new Error(
      'No DatabasePort configured. Pass a DatabasePort instance or call setRepositoryDatabase(db) first.',
    );
  }
  return defaultDatabasePort;
}

// =============================================================================
// MEDICATION CRUD
// =============================================================================

async function insertMedicationWithPort(
  db: DatabasePort,
  input: CreateMedicationInput,
): Promise<Medication> {
  const unitPriceCents = assertNullableIntegerCents(input.unit_price_cents, 'unit_price_cents');
  const costPriceCents = assertNullableIntegerCents(input.cost_price_cents, 'cost_price_cents');
  const priceSource = assertValidPriceSource(input.price_source ?? null, true);
  const priceConfirmed: 0 | 1 = input.price_confirmed ? 1 : 0;
  const nowIso = new Date().toISOString();
  const updatedAt = input.updated_at ?? nowIso;
  const priceUpdatedAt =
    input.price_updated_at !== undefined
      ? input.price_updated_at
      : unitPriceCents !== null
        ? nowIso
        : null;

  const resolvedCurrency = (input.currency_code ?? input.currency ?? 'DZD').trim().toUpperCase() || 'DZD';

  const columns = [
    ...(input.id !== undefined ? ['id'] : []),
    'brand_name',
    'generic_name',
    'strength',
    'dosage_form',
    'category',
    'atc_code',
    'manufacturer',
    'barcode',
    'storage',
    'posology',
    'interactions',
    'composition',
    'therapeutic_class',
    'indications',
    'precautions',
    'route',
    'side_effects',
    'zone',
    'shelf',
    'bin',
    'location_note',
    'reorder_level',
    'lead_time_days',
    'unit_price_cents',
    'cost_price_cents',
    'currency',
    'currency_code',
    'units_per_pack',
    'price_source',
    'price_confirmed',
    'price_updated_at',
    'updated_at',
    'is_archived',
  ];

  const values: SqlParam[] = [
    ...(input.id !== undefined ? [input.id] : []),
    input.brand_name,
    input.generic_name ?? null,
    input.strength ?? null,
    input.dosage_form ?? null,
    input.category ?? null,
    input.atc_code ?? null,
    input.manufacturer ?? null,
    input.barcode ?? null,
    input.storage ?? null,
    input.posology ?? null,
    input.interactions ?? null,
    input.composition ?? null,
    input.therapeutic_class ?? null,
    input.indications ?? null,
    input.precautions ?? null,
    input.route ?? null,
    input.side_effects ?? null,
    input.zone ?? null,
    input.shelf ?? null,
    input.bin ?? null,
    input.location_note ?? null,
    input.reorder_level ?? 10,
    input.lead_time_days ?? 7,
    unitPriceCents,
    costPriceCents,
    resolvedCurrency,
    resolvedCurrency,
    input.units_per_pack ?? 1,
    priceSource,
    priceConfirmed,
    priceUpdatedAt,
    updatedAt,
    input.is_archived ? 1 : 0,
  ];

  const placeholders = columns.map(() => '?').join(', ');
  const rows = await db.query<Record<string, SqlParam>>(
    `INSERT INTO medication (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return normalizeMedicationRow(rows[0]);
}

async function getMedicationByIdWithPort(db: DatabasePort, id: number): Promise<Medication | null> {
  const rows = await db.query<Record<string, SqlParam>>('SELECT * FROM medication WHERE id = ?', [
    id,
  ]);
  if (rows.length === 0) return null;
  return normalizeMedicationRow(rows[0]);
}

async function getMedicationByBarcodeWithPort(
  db: DatabasePort,
  barcode: string,
): Promise<Medication | null> {
  const rows = await db.query<Record<string, SqlParam>>(
    'SELECT * FROM medication WHERE barcode = ?',
    [barcode],
  );
  if (rows.length === 0) return null;
  return normalizeMedicationRow(rows[0]);
}

async function listMedicationsWithPort(
  db: DatabasePort,
  options?: { includeArchived?: boolean },
): Promise<Medication[]> {
  const whereClause = options?.includeArchived ? '' : 'WHERE COALESCE(is_archived, 0) = 0';
  const rows = await db.query<Record<string, SqlParam>>(
    `SELECT * FROM medication ${whereClause} ORDER BY id ASC`,
  );
  return rows.map(normalizeMedicationRow);
}

async function updateMedicationLocalInventoryWithPort(
  db: DatabasePort,
  id: number,
  input: UpdateMedicationLocalInventoryInput,
): Promise<Medication> {
  const existing = await getMedicationByIdWithPort(db, id);
  if (!existing) {
    throw new Error(`Medication with id ${id} not found`);
  }

  const nowIso = new Date().toISOString();
  const rows = await db.query<Record<string, SqlParam>>(
    `UPDATE medication
     SET zone = ?,
         shelf = ?,
         bin = ?,
         location_note = ?,
         reorder_level = ?,
         lead_time_days = ?,
         updated_at = ?
     WHERE id = ?
     RETURNING *`,
    [
      input.zone !== undefined ? input.zone : existing.zone,
      input.shelf !== undefined ? input.shelf : existing.shelf,
      input.bin !== undefined ? input.bin : existing.bin,
      input.location_note !== undefined ? input.location_note : existing.location_note,
      input.reorder_level !== undefined ? input.reorder_level : existing.reorder_level,
      input.lead_time_days !== undefined ? input.lead_time_days : existing.lead_time_days,
      nowIso,
      id,
    ],
  );

  return normalizeMedicationRow(rows[0]);
}

async function updateMedicationMedicalInfoWithPort(
  db: DatabasePort,
  id: number,
  input: UpdateMedicationMedicalInfoInput,
): Promise<Medication> {
  const existing = await getMedicationByIdWithPort(db, id);
  if (!existing) {
    throw new Error(`Medication with id ${id} not found`);
  }

  const nowIso = new Date().toISOString();
  const rows = await db.query<Record<string, SqlParam>>(
    `UPDATE medication
     SET posology = ?,
         interactions = ?,
         composition = ?,
         therapeutic_class = ?,
         indications = ?,
         precautions = ?,
         route = ?,
         side_effects = ?,
         updated_at = ?
     WHERE id = ?
     RETURNING *`,
    [
      input.posology !== undefined ? input.posology : (existing.posology ?? null),
      input.interactions !== undefined ? input.interactions : (existing.interactions ?? null),
      input.composition !== undefined ? input.composition : (existing.composition ?? null),
      input.therapeutic_class !== undefined
        ? input.therapeutic_class
        : (existing.therapeutic_class ?? null),
      input.indications !== undefined ? input.indications : (existing.indications ?? null),
      input.precautions !== undefined ? input.precautions : (existing.precautions ?? null),
      input.route !== undefined ? input.route : (existing.route ?? null),
      input.side_effects !== undefined ? input.side_effects : (existing.side_effects ?? null),
      nowIso,
      id,
    ],
  );

  return normalizeMedicationRow(rows[0]);
}

/**
 * Updates an existing medication during a bulk import transaction.
 * Preserves existing fields when a field in `input` is undefined.
 * Enforces that imported prices are strictly integer cents (or null) and are
 * NEVER marked confirmed (`price_confirmed = 0`).
 */
async function updateMedicationFromImportWithPort(
  db: DatabasePort,
  id: number,
  input: Partial<CreateMedicationInput>,
): Promise<Medication> {
  const existing = await getMedicationByIdWithPort(db, id);
  if (!existing) {
    throw new Error(`Medication with id ${id} not found`);
  }

  const nowIso = new Date().toISOString();
  const unitPriceCents =
    input.unit_price_cents !== undefined
      ? assertNullableIntegerCents(input.unit_price_cents, 'unit_price_cents')
      : existing.unit_price_cents;
  const costPriceCents =
    input.cost_price_cents !== undefined
      ? assertNullableIntegerCents(input.cost_price_cents, 'cost_price_cents')
      : existing.cost_price_cents;
  const priceSource =
    input.price_source !== undefined
      ? assertValidPriceSource(input.price_source, true)
      : existing.price_source;
  // Imported prices are NEVER marked confirmed (only setPrice by pharmacist sets price_confirmed=1)
  const priceConfirmed: 0 | 1 =
    input.unit_price_cents !== undefined
      ? 0
      : input.price_confirmed !== undefined
        ? input.price_confirmed
          ? 1
          : 0
        : existing.price_confirmed;
  const priceUpdatedAt =
    input.price_updated_at !== undefined
      ? input.price_updated_at
      : input.unit_price_cents !== undefined
        ? nowIso
        : existing.price_updated_at;

  const rows = await db.query<Record<string, SqlParam>>(
    `UPDATE medication
     SET brand_name = ?,
         generic_name = ?,
         strength = ?,
         dosage_form = ?,
         category = ?,
         atc_code = ?,
         manufacturer = ?,
         barcode = ?,
         storage = ?,
         posology = ?,
         interactions = ?,
         composition = ?,
         therapeutic_class = ?,
         indications = ?,
         precautions = ?,
         route = ?,
         side_effects = ?,
         zone = ?,
         shelf = ?,
         bin = ?,
         location_note = ?,
         reorder_level = ?,
         lead_time_days = ?,
         unit_price_cents = ?,
         cost_price_cents = ?,
         currency = ?,
         currency_code = ?,
         units_per_pack = ?,
         price_source = ?,
         price_confirmed = ?,
         price_updated_at = ?,
         updated_at = ?
     WHERE id = ?
     RETURNING *`,
    [
      input.brand_name !== undefined ? input.brand_name : existing.brand_name,
      input.generic_name !== undefined ? input.generic_name : existing.generic_name,
      input.strength !== undefined ? input.strength : existing.strength,
      input.dosage_form !== undefined ? input.dosage_form : existing.dosage_form,
      input.category !== undefined ? input.category : existing.category,
      input.atc_code !== undefined ? input.atc_code : existing.atc_code,
      input.manufacturer !== undefined ? input.manufacturer : existing.manufacturer,
      input.barcode !== undefined ? input.barcode : existing.barcode,
      input.storage !== undefined ? input.storage : existing.storage,
      input.posology !== undefined ? input.posology : (existing.posology ?? null),
      input.interactions !== undefined ? input.interactions : (existing.interactions ?? null),
      input.composition !== undefined ? input.composition : (existing.composition ?? null),
      input.therapeutic_class !== undefined
        ? input.therapeutic_class
        : (existing.therapeutic_class ?? null),
      input.indications !== undefined ? input.indications : (existing.indications ?? null),
      input.precautions !== undefined ? input.precautions : (existing.precautions ?? null),
      input.route !== undefined ? input.route : (existing.route ?? null),
      input.side_effects !== undefined ? input.side_effects : (existing.side_effects ?? null),
      input.zone !== undefined ? input.zone : existing.zone,
      input.shelf !== undefined ? input.shelf : existing.shelf,
      input.bin !== undefined ? input.bin : existing.bin,
      input.location_note !== undefined ? input.location_note : existing.location_note,
      input.reorder_level !== undefined ? input.reorder_level : existing.reorder_level,
      input.lead_time_days !== undefined ? input.lead_time_days : existing.lead_time_days,
      unitPriceCents,
      costPriceCents,
      (input.currency_code ?? input.currency ?? existing.currency_code ?? existing.currency ?? 'DZD')
        .trim()
        .toUpperCase(),
      (input.currency_code ?? input.currency ?? existing.currency_code ?? existing.currency ?? 'DZD')
        .trim()
        .toUpperCase(),
      input.units_per_pack !== undefined ? input.units_per_pack : existing.units_per_pack,
      priceSource,
      priceConfirmed,
      priceUpdatedAt,
      input.updated_at ?? nowIso,
      id,
    ],
  );

  return normalizeMedicationRow(rows[0]);
}

export interface DeletionEligibilityResult {
  canDelete: boolean;
  canArchive: boolean;
  hasStock: boolean;
  totalStock: number;
  hasHistory: boolean;
  movementCount: number;
  priceHistoryCount: number;
  blockReason: string | null;
}

async function checkMedicationDeletionEligibilityWithPort(
  db: DatabasePort,
  id: number,
): Promise<DeletionEligibilityResult> {
  const stockRows = await db.query<{ total: number; positive_batches: number }>(
    `SELECT
       COALESCE(SUM(quantity), 0) AS total,
       COALESCE(SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END), 0) AS positive_batches
     FROM batch
     WHERE medication_id = ?`,
    [id],
  );
  const totalStock = Number(stockRows[0]?.total ?? 0);
  const positiveBatches = Number(stockRows[0]?.positive_batches ?? 0);
  const hasStock = totalStock > 0 || positiveBatches > 0;

  const histRows = await db.query<{ movements: number; prices: number }>(
    `SELECT
       (SELECT COUNT(*) FROM stock_movement WHERE medication_id = ?) AS movements,
       (SELECT COUNT(*) FROM price_history WHERE medication_id = ?) AS prices`,
    [id, id],
  );
  const movementCount = Number(histRows[0]?.movements ?? 0);
  const priceHistoryCount = Number(histRows[0]?.prices ?? 0);
  const hasHistory = movementCount > 0 || priceHistoryCount > 0;

  let blockReason: string | null = null;
  if (hasStock) {
    blockReason =
      'Cannot delete: there is still stock in the pharmacy. Please dispense or adjust stock to 0 first.';
  } else if (hasHistory) {
    blockReason =
      'Cannot delete: this medication has sales or price history. You can only archive it.';
  }

  return {
    canDelete: !hasStock && !hasHistory,
    canArchive: true,
    hasStock,
    totalStock,
    hasHistory,
    movementCount,
    priceHistoryCount,
    blockReason,
  };
}

async function deleteMedicationWithPort(db: DatabasePort, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Stock check
    const stockRows = await tx.query<{ total: number; positive_batches: number }>(
      `SELECT
         COALESCE(SUM(quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END), 0) AS positive_batches
       FROM batch
       WHERE medication_id = ?`,
      [id],
    );
    const totalStock = Number(stockRows[0]?.total ?? 0);
    const positiveBatches = Number(stockRows[0]?.positive_batches ?? 0);
    if (totalStock > 0 || positiveBatches > 0) {
      throw new Error(
        'Cannot delete: there is still stock in the pharmacy. Please dispense or adjust stock to 0 first.',
      );
    }

    // 2. History check
    const histRows = await tx.query<{ movements: number; prices: number }>(
      `SELECT
         (SELECT COUNT(*) FROM stock_movement WHERE medication_id = ?) AS movements,
         (SELECT COUNT(*) FROM price_history WHERE medication_id = ?) AS prices`,
      [id, id],
    );
    const movementCount = Number(histRows[0]?.movements ?? 0);
    const priceHistoryCount = Number(histRows[0]?.prices ?? 0);
    if (movementCount > 0 || priceHistoryCount > 0) {
      throw new Error(
        'Cannot delete: this medication has sales or price history. You can only archive it.',
      );
    }

    // 3. Remove aliases
    await tx.exec('DELETE FROM medication_alias WHERE medication_id = ?', [id]);

    // 4. Remove empty batches
    await tx.exec('DELETE FROM batch WHERE medication_id = ?', [id]);

    // 5. Remove medication record
    await tx.exec('DELETE FROM medication WHERE id = ?', [id]);
  });
}

async function archiveMedicationWithPort(db: DatabasePort, id: number): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.exec('UPDATE medication SET is_archived = 1, updated_at = ? WHERE id = ?', [
    nowIso,
    id,
  ]);
}

async function unarchiveMedicationWithPort(db: DatabasePort, id: number): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.exec('UPDATE medication SET is_archived = 0, updated_at = ? WHERE id = ?', [
    nowIso,
    id,
  ]);
}

// =============================================================================
// MEDICATION ALIAS CRUD & getMedicationWithAliases
// =============================================================================

async function insertAliasWithPort(
  db: DatabasePort,
  medicationId: number,
  alias: string,
): Promise<MedicationAlias> {
  const rows = await db.query<MedicationAlias>(
    'INSERT INTO medication_alias (medication_id, alias) VALUES (?, ?) RETURNING id, medication_id, alias',
    [medicationId, alias],
  );
  return {
    id: Number(rows[0].id),
    medication_id: Number(rows[0].medication_id),
    alias: String(rows[0].alias),
  };
}

async function listAliasesForMedicationWithPort(
  db: DatabasePort,
  medicationId: number,
): Promise<MedicationAlias[]> {
  const rows = await db.query<MedicationAlias>(
    'SELECT id, medication_id, alias FROM medication_alias WHERE medication_id = ? ORDER BY id ASC',
    [medicationId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    medication_id: Number(r.medication_id),
    alias: String(r.alias),
  }));
}

async function deleteAliasWithPort(db: DatabasePort, aliasId: number): Promise<void> {
  await db.exec('DELETE FROM medication_alias WHERE id = ?', [aliasId]);
}

async function getMedicationWithAliasesWithPort(
  db: DatabasePort,
  id: number,
): Promise<MedicationWithAliases | null> {
  const medication = await getMedicationByIdWithPort(db, id);
  if (!medication) {
    return null;
  }
  const aliasRecords = await listAliasesForMedicationWithPort(db, id);
  return {
    ...medication,
    aliases: aliasRecords.map((record) => record.alias),
    alias_records: aliasRecords,
  };
}

// =============================================================================
// BATCH CRUD & getTotalStock
// =============================================================================

async function insertBatchWithPort(db: DatabasePort, input: CreateBatchInput): Promise<Batch> {
  if (!Number.isInteger(input.quantity)) {
    throw new TypeError(`Batch quantity must be an integer (received ${input.quantity})`);
  }
  const nowIso = new Date().toISOString();
  const columns = [
    ...(input.id !== undefined ? ['id'] : []),
    'medication_id',
    'lot_number',
    'quantity',
    'expiry_date',
    'received_at',
  ];
  const values: SqlParam[] = [
    ...(input.id !== undefined ? [input.id] : []),
    input.medication_id,
    input.lot_number ?? null,
    input.quantity,
    input.expiry_date ?? null,
    input.received_at ?? nowIso,
  ];
  const placeholders = columns.map(() => '?').join(', ');
  const rows = await db.query<Batch>(
    `INSERT INTO batch (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id, medication_id, lot_number, quantity, expiry_date, received_at`,
    values,
  );
  return {
    id: Number(rows[0].id),
    medication_id: Number(rows[0].medication_id),
    lot_number: rows[0].lot_number === null ? null : String(rows[0].lot_number),
    quantity: Number(rows[0].quantity),
    expiry_date: rows[0].expiry_date === null ? null : String(rows[0].expiry_date),
    received_at: rows[0].received_at === null ? null : String(rows[0].received_at),
  };
}

async function getBatchByIdWithPort(db: DatabasePort, batchId: number): Promise<Batch | null> {
  const rows = await db.query<Batch>(
    'SELECT id, medication_id, lot_number, quantity, expiry_date, received_at FROM batch WHERE id = ?',
    [batchId],
  );
  if (rows.length === 0) return null;
  return {
    id: Number(rows[0].id),
    medication_id: Number(rows[0].medication_id),
    lot_number: rows[0].lot_number === null ? null : String(rows[0].lot_number),
    quantity: Number(rows[0].quantity),
    expiry_date: rows[0].expiry_date === null ? null : String(rows[0].expiry_date),
    received_at: rows[0].received_at === null ? null : String(rows[0].received_at),
  };
}

async function listBatchesForMedicationWithPort(
  db: DatabasePort,
  medicationId: number,
): Promise<Batch[]> {
  const rows = await db.query<Batch>(
    'SELECT id, medication_id, lot_number, quantity, expiry_date, received_at FROM batch WHERE medication_id = ? ORDER BY expiry_date ASC, id ASC',
    [medicationId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    medication_id: Number(row.medication_id),
    lot_number: row.lot_number === null ? null : String(row.lot_number),
    quantity: Number(row.quantity),
    expiry_date: row.expiry_date === null ? null : String(row.expiry_date),
    received_at: row.received_at === null ? null : String(row.received_at),
  }));
}

async function updateBatchQuantityWithPort(
  db: DatabasePort,
  batchId: number,
  quantity: number,
): Promise<Batch> {
  if (!Number.isInteger(quantity)) {
    throw new TypeError(`Batch quantity must be an integer (received ${quantity})`);
  }
  const rows = await db.query<Batch>(
    'UPDATE batch SET quantity = ? WHERE id = ? RETURNING id, medication_id, lot_number, quantity, expiry_date, received_at',
    [quantity, batchId],
  );
  if (rows.length === 0) {
    throw new Error(`Batch with id ${batchId} not found`);
  }
  return {
    id: Number(rows[0].id),
    medication_id: Number(rows[0].medication_id),
    lot_number: rows[0].lot_number === null ? null : String(rows[0].lot_number),
    quantity: Number(rows[0].quantity),
    expiry_date: rows[0].expiry_date === null ? null : String(rows[0].expiry_date),
    received_at: rows[0].received_at === null ? null : String(rows[0].received_at),
  };
}

async function deleteBatchWithPort(db: DatabasePort, batchId: number): Promise<void> {
  await db.exec('DELETE FROM batch WHERE id = ?', [batchId]);
}

async function getTotalStockWithPort(db: DatabasePort, medicationId: number): Promise<number> {
  const rows = await db.query<{ total_stock: number | null }>(
    'SELECT COALESCE(SUM(quantity), 0) AS total_stock FROM batch WHERE medication_id = ?',
    [medicationId],
  );
  if (rows.length === 0 || rows[0].total_stock === null) {
    return 0;
  }
  return Number(rows[0].total_stock);
}

// =============================================================================
// STOCK MOVEMENT (APPEND-ONLY — NO UPDATE OR DELETE FUNCTIONS EXIST)
// =============================================================================

async function insertMovementWithPort(
  db: DatabasePort,
  inputOrMedicationId: InsertMovementInput | number,
  batchId?: number | null,
  delta?: number,
  reason?: string | null,
  userId?: string | null,
  createdAt?: string,
): Promise<StockMovement> {
  let resolvedMedicationId: number;
  let resolvedBatchId: number | null;
  let resolvedDelta: number;
  let resolvedReason: string | null;
  let resolvedUserId: string | null;
  let resolvedCreatedAt: string;

  if (typeof inputOrMedicationId === 'number') {
    resolvedMedicationId = inputOrMedicationId;
    resolvedBatchId = batchId ?? null;
    if (typeof delta !== 'number') {
      throw new TypeError('insertMovement requires an integer delta');
    }
    resolvedDelta = delta;
    resolvedReason = reason ?? null;
    resolvedUserId = userId ?? null;
    resolvedCreatedAt = createdAt ?? new Date().toISOString();
  } else {
    const medId = inputOrMedicationId.medication_id ?? inputOrMedicationId.medicationId;
    if (typeof medId !== 'number' || !Number.isInteger(medId)) {
      throw new TypeError('insertMovement requires an integer medication_id');
    }
    resolvedMedicationId = medId;
    resolvedBatchId =
      inputOrMedicationId.batch_id !== undefined
        ? inputOrMedicationId.batch_id
        : (inputOrMedicationId.batchId ?? null);
    resolvedDelta = inputOrMedicationId.delta;
    resolvedReason = inputOrMedicationId.reason ?? null;
    resolvedUserId =
      inputOrMedicationId.user_id !== undefined
        ? inputOrMedicationId.user_id
        : (inputOrMedicationId.userId ?? null);
    resolvedCreatedAt =
      inputOrMedicationId.created_at ?? inputOrMedicationId.createdAt ?? new Date().toISOString();
  }

  if (!Number.isInteger(resolvedDelta)) {
    throw new TypeError(`Stock movement delta must be an integer (received ${resolvedDelta})`);
  }

  const rows = await db.query<StockMovement>(
    `INSERT INTO stock_movement (medication_id, batch_id, delta, reason, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, medication_id, batch_id, delta, reason, user_id, created_at`,
    [
      resolvedMedicationId,
      resolvedBatchId,
      resolvedDelta,
      resolvedReason,
      resolvedUserId,
      resolvedCreatedAt,
    ],
  );

  return {
    id: Number(rows[0].id),
    medication_id: Number(rows[0].medication_id),
    batch_id: rows[0].batch_id === null ? null : Number(rows[0].batch_id),
    delta: Number(rows[0].delta),
    reason: rows[0].reason === null ? null : String(rows[0].reason),
    user_id: rows[0].user_id === null ? null : String(rows[0].user_id),
    created_at: String(rows[0].created_at),
  };
}

async function listMovementsForMedicationWithPort(
  db: DatabasePort,
  medicationId: number,
): Promise<StockMovement[]> {
  const rows = await db.query<StockMovement>(
    'SELECT id, medication_id, batch_id, delta, reason, user_id, created_at FROM stock_movement WHERE medication_id = ? ORDER BY id ASC',
    [medicationId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    medication_id: Number(row.medication_id),
    batch_id: row.batch_id === null ? null : Number(row.batch_id),
    delta: Number(row.delta),
    reason: row.reason === null ? null : String(row.reason),
    user_id: row.user_id === null ? null : String(row.user_id),
    created_at: String(row.created_at),
  }));
}

// =============================================================================
// PRICE & PRICE HISTORY (APPEND-ONLY — NO UPDATE OR DELETE FUNCTIONS EXIST)
// =============================================================================

export interface SetPriceMetadataOptions {
  cost_price_cents?: number | null;
  currency?: string;
  currency_code?: string;
  units_per_pack?: number;
}

/**
 * Updates medication price fields AND appends a record to price_history
 * atomically in a single SQLite transaction.
 *
 * - `cents` must be an integer number of cents or `null` (unknown). Never coerced to 0.
 * - `source` must be 'manual' | 'official_tariff' | 'imported'.
 * - `confirmed` is converted to 1 (true) or 0 (false).
 * - Optional `options` updates `cost_price_cents`, `currency`, `currency_code`, and `units_per_pack`
 *   in the same transaction so `setPrice` is the sole code path that writes Layer 3 price fields.
 */
async function setPriceWithPort(
  db: DatabasePort,
  medicationId: number,
  cents: number | null,
  source: PriceSource,
  confirmed: boolean | 0 | 1,
  userId: string,
  options?: SetPriceMetadataOptions,
): Promise<Medication> {
  const validatedCents = assertNullableIntegerCents(cents, 'unit_price_cents');
  const validatedCostCents =
    options?.cost_price_cents !== undefined
      ? assertNullableIntegerCents(options.cost_price_cents, 'cost_price_cents')
      : undefined;
  if (
    options?.units_per_pack !== undefined &&
    (!Number.isInteger(options.units_per_pack) || options.units_per_pack <= 0)
  ) {
    throw new RangeError(
      `units_per_pack must be a positive integer (received ${String(options.units_per_pack)})`,
    );
  }
  const validatedSource = assertValidPriceSource(source, false)!;
  const confirmedFlag: 0 | 1 = confirmed ? 1 : 0;
  const nowIso = new Date().toISOString();

  return db.transaction(async (tx) => {
    const existingRows = await tx.query<Record<string, SqlParam>>(
      'SELECT * FROM medication WHERE id = ?',
      [medicationId],
    );
    if (existingRows.length === 0) {
      throw new Error(`Medication with id ${medicationId} not found`);
    }
    const existing = normalizeMedicationRow(existingRows[0]);

    const nextCostCents =
      validatedCostCents !== undefined ? validatedCostCents : existing.cost_price_cents;
    const rawRequestedCurrency = options?.currency_code ?? options?.currency;
    const nextCurrency =
      rawRequestedCurrency !== undefined && rawRequestedCurrency.trim() !== ''
        ? rawRequestedCurrency.trim().toUpperCase()
        : existing.currency_code || existing.currency || 'DZD';
    const nextUnitsPerPack =
      options?.units_per_pack !== undefined ? options.units_per_pack : existing.units_per_pack;

    const updatedRows = await tx.query<Record<string, SqlParam>>(
      `UPDATE medication
       SET unit_price_cents = ?,
           cost_price_cents = ?,
           currency = ?,
           currency_code = ?,
           units_per_pack = ?,
           price_source = ?,
           price_confirmed = ?,
           price_updated_at = ?,
           updated_at = ?
       WHERE id = ?
       RETURNING *`,
      [
        validatedCents,
        nextCostCents,
        nextCurrency,
        nextCurrency,
        nextUnitsPerPack,
        validatedSource,
        confirmedFlag,
        nowIso,
        nowIso,
        medicationId,
      ],
    );

    await tx.exec(
      `INSERT INTO price_history (medication_id, unit_price_cents, source, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [medicationId, validatedCents, validatedSource, userId, nowIso],
    );

    return normalizeMedicationRow(updatedRows[0]);
  });
}

async function listPriceHistoryForMedicationWithPort(
  db: DatabasePort,
  medicationId: number,
): Promise<PriceHistory[]> {
  const rows = await db.query<PriceHistory>(
    'SELECT id, medication_id, unit_price_cents, source, changed_by, created_at FROM price_history WHERE medication_id = ? ORDER BY id ASC',
    [medicationId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    medication_id: Number(row.medication_id),
    unit_price_cents:
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents),
    source: row.source === null ? null : (String(row.source) as PriceSource),
    changed_by: row.changed_by === null ? null : String(row.changed_by),
    created_at: String(row.created_at),
  }));
}

async function insertPriceHistoryWithPort(
  db: DatabasePort,
  input: InsertPriceHistoryInput,
): Promise<PriceHistory> {
  const validatedCents = assertNullableIntegerCents(input.unit_price_cents, 'unit_price_cents');
  const validatedSource = assertValidPriceSource(input.source, false)!;
  const nowIso = input.created_at ?? new Date().toISOString();
  const rows = await db.query<PriceHistory>(
    `INSERT INTO price_history (medication_id, unit_price_cents, source, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, medication_id, unit_price_cents, source, changed_by, created_at`,
    [input.medication_id, validatedCents, validatedSource, input.changed_by ?? null, nowIso],
  );
  return {
    id: Number(rows[0].id),
    medication_id: Number(rows[0].medication_id),
    unit_price_cents:
      rows[0].unit_price_cents === null || rows[0].unit_price_cents === undefined
        ? null
        : Number(rows[0].unit_price_cents),
    source: rows[0].source === null ? null : (String(rows[0].source) as PriceSource),
    changed_by: rows[0].changed_by === null ? null : String(rows[0].changed_by),
    created_at: String(rows[0].created_at),
  };
}

async function listAllPriceHistoryWithPort(db: DatabasePort): Promise<PriceHistory[]> {
  const rows = await db.query<PriceHistory>(
    'SELECT id, medication_id, unit_price_cents, source, changed_by, created_at FROM price_history ORDER BY id ASC',
  );
  return rows.map((row) => ({
    id: Number(row.id),
    medication_id: Number(row.medication_id),
    unit_price_cents:
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents),
    source: row.source === null ? null : (String(row.source) as PriceSource),
    changed_by: row.changed_by === null ? null : String(row.changed_by),
    created_at: String(row.created_at),
  }));
}

async function listAllBatchesWithPort(db: DatabasePort): Promise<Batch[]> {
  const rows = await db.query<Batch>(
    'SELECT id, medication_id, lot_number, quantity, expiry_date, received_at FROM batch ORDER BY id ASC',
  );
  return rows.map((row) => ({
    id: Number(row.id),
    medication_id: Number(row.medication_id),
    lot_number: row.lot_number === null ? null : String(row.lot_number),
    quantity: Number(row.quantity),
    expiry_date: row.expiry_date === null ? null : String(row.expiry_date),
    received_at: row.received_at === null ? null : String(row.received_at),
  }));
}

// =============================================================================
// CURRENCIES & EXCHANGE RATES (UP TO 10 CURRENCIES, BASE = DZD)
// =============================================================================

async function seedCurrenciesWithPort(db: DatabasePort): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      rate_to_da REAL NOT NULL DEFAULT 1
    );
  `);

  for (const cur of DEFAULT_CURRENCIES) {
    await db.exec(
      'INSERT OR IGNORE INTO currencies (code, name, symbol, rate_to_da) VALUES (?, ?, ?, ?)',
      [cur.code, cur.name, cur.symbol, cur.rate_to_da],
    );
  }
}

async function listCurrenciesWithPort(db: DatabasePort): Promise<CurrencyRecord[]> {
  try {
    const rows = await db.query<Record<string, SqlParam>>(
      `SELECT code, name, symbol, rate_to_da FROM currencies
       ORDER BY CASE WHEN code = 'DZD' THEN 0 ELSE 1 END ASC, code ASC
       LIMIT 10`,
    );
    if (rows.length === 0) {
      return [...DEFAULT_CURRENCIES];
    }
    const orderIndex = new Map(DEFAULT_CURRENCIES.map((c, idx) => [c.code, idx]));
    return rows
      .map((r) => ({
        code: String(r.code).trim().toUpperCase(),
        name: String(r.name),
        symbol: String(r.symbol),
        rate_to_da: String(r.code).trim().toUpperCase() === 'DZD' ? 1 : Number(r.rate_to_da),
      }))
      .sort((a, b) => (orderIndex.get(a.code) ?? 99) - (orderIndex.get(b.code) ?? 99));
  } catch {
    return [...DEFAULT_CURRENCIES];
  }
}

async function getCurrencyByCodeWithPort(
  db: DatabasePort,
  code: string,
): Promise<CurrencyRecord | null> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return null;
  const rows = await db.query<Record<string, SqlParam>>(
    'SELECT code, name, symbol, rate_to_da FROM currencies WHERE code = ?',
    [normalizedCode],
  );
  if (rows.length === 0) {
    return DEFAULT_CURRENCIES.find((c) => c.code === normalizedCode) ?? null;
  }
  const r = rows[0];
  return {
    code: String(r.code).trim().toUpperCase(),
    name: String(r.name),
    symbol: String(r.symbol),
    rate_to_da: normalizedCode === 'DZD' ? 1 : Number(r.rate_to_da),
  };
}

async function updateCurrencyRateWithPort(
  db: DatabasePort,
  code: string,
  rateToDa: number,
): Promise<CurrencyRecord> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Currency code is required.');
  }
  if (normalizedCode === 'DZD') {
    await db.exec('UPDATE currencies SET rate_to_da = 1 WHERE code = ?', ['DZD']);
    return { code: 'DZD', name: 'Algerian Dinar', symbol: 'DA', rate_to_da: 1 };
  }
  if (typeof rateToDa !== 'number' || !Number.isFinite(rateToDa) || rateToDa <= 0) {
    throw new RangeError(
      `Exchange rate to DA for ${normalizedCode} must be a positive number (received ${String(rateToDa)}).`,
    );
  }

  await seedCurrenciesWithPort(db);
  const rows = await db.query<Record<string, SqlParam>>(
    'UPDATE currencies SET rate_to_da = ? WHERE code = ? RETURNING code, name, symbol, rate_to_da',
    [rateToDa, normalizedCode],
  );
  if (rows.length === 0) {
    throw new Error(`Currency "${normalizedCode}" not found.`);
  }
  return {
    code: String(rows[0].code).trim().toUpperCase(),
    name: String(rows[0].name),
    symbol: String(rows[0].symbol),
    rate_to_da: Number(rows[0].rate_to_da),
  };
}

// =============================================================================
// TOP-LEVEL OVERLOADED EXPORTS & REPOSITORY FACTORY
// =============================================================================

export function getMedicationWithAliases(id: number): Promise<MedicationWithAliases | null>;
export function getMedicationWithAliases(
  db: DatabasePort,
  id: number,
): Promise<MedicationWithAliases | null>;
export function getMedicationWithAliases(
  dbOrId: DatabasePort | number,
  maybeId?: number,
): Promise<MedicationWithAliases | null> {
  if (isDatabasePort(dbOrId)) {
    return getMedicationWithAliasesWithPort(dbOrId, maybeId as number);
  }
  return getMedicationWithAliasesWithPort(getRepositoryDatabase(), dbOrId);
}

export function getTotalStock(medicationId: number): Promise<number>;
export function getTotalStock(db: DatabasePort, medicationId: number): Promise<number>;
export function getTotalStock(
  dbOrMedicationId: DatabasePort | number,
  maybeMedicationId?: number,
): Promise<number> {
  if (isDatabasePort(dbOrMedicationId)) {
    return getTotalStockWithPort(dbOrMedicationId, maybeMedicationId as number);
  }
  return getTotalStockWithPort(getRepositoryDatabase(), dbOrMedicationId);
}

export function insertMovement(input: InsertMovementInput): Promise<StockMovement>;
export function insertMovement(
  medicationId: number,
  batchId: number | null,
  delta: number,
  reason: string | null,
  userId: string | null,
  createdAt?: string,
): Promise<StockMovement>;
export function insertMovement(
  db: DatabasePort,
  input: InsertMovementInput,
): Promise<StockMovement>;
export function insertMovement(
  db: DatabasePort,
  medicationId: number,
  batchId: number | null,
  delta: number,
  reason: string | null,
  userId: string | null,
  createdAt?: string,
): Promise<StockMovement>;
export function insertMovement(
  arg1: DatabasePort | InsertMovementInput | number,
  arg2?: InsertMovementInput | number | null,
  arg3?: number | null,
  arg4?: string | number | null,
  arg5?: string | null,
  arg6?: string | null,
  arg7?: string,
): Promise<StockMovement> {
  if (isDatabasePort(arg1)) {
    if (typeof arg2 === 'object' && arg2 !== null) {
      return insertMovementWithPort(arg1, arg2);
    }
    return insertMovementWithPort(
      arg1,
      arg2 as number,
      arg3 as number | null,
      arg4 as number,
      arg5 as string | null,
      arg6 as string | null,
      arg7,
    );
  }
  if (typeof arg1 === 'object' && arg1 !== null) {
    return insertMovementWithPort(getRepositoryDatabase(), arg1);
  }
  return insertMovementWithPort(
    getRepositoryDatabase(),
    arg1,
    arg2 as number | null,
    arg3 as number,
    arg4 as string | null,
    arg5 as string | null,
    arg6 ?? undefined,
  );
}

export function setPrice(
  medicationId: number,
  cents: number | null,
  source: PriceSource,
  confirmed: boolean | 0 | 1,
  userId: string,
  options?: SetPriceMetadataOptions,
): Promise<Medication>;
export function setPrice(
  db: DatabasePort,
  medicationId: number,
  cents: number | null,
  source: PriceSource,
  confirmed: boolean | 0 | 1,
  userId: string,
  options?: SetPriceMetadataOptions,
): Promise<Medication>;
export function setPrice(
  arg1: DatabasePort | number,
  arg2: number | null,
  arg3: PriceSource | number | null,
  arg4: PriceSource | boolean | 0 | 1,
  arg5: boolean | 0 | 1 | string,
  arg6?: string | SetPriceMetadataOptions,
  arg7?: SetPriceMetadataOptions,
): Promise<Medication> {
  if (isDatabasePort(arg1)) {
    return setPriceWithPort(
      arg1,
      arg2 as number,
      arg3 as number | null,
      arg4 as PriceSource,
      arg5 as boolean | 0 | 1,
      arg6 as string,
      arg7,
    );
  }
  return setPriceWithPort(
    getRepositoryDatabase(),
    arg1,
    arg2,
    arg3 as PriceSource,
    arg4 as boolean | 0 | 1,
    arg5 as string,
    arg6 as SetPriceMetadataOptions | undefined,
  );
}

export function insertMedication(input: CreateMedicationInput): Promise<Medication>;
export function insertMedication(
  db: DatabasePort,
  input: CreateMedicationInput,
): Promise<Medication>;
export function insertMedication(
  dbOrInput: DatabasePort | CreateMedicationInput,
  maybeInput?: CreateMedicationInput,
): Promise<Medication> {
  if (isDatabasePort(dbOrInput)) {
    return insertMedicationWithPort(dbOrInput, maybeInput as CreateMedicationInput);
  }
  return insertMedicationWithPort(getRepositoryDatabase(), dbOrInput);
}

export function getMedicationById(id: number): Promise<Medication | null>;
export function getMedicationById(db: DatabasePort, id: number): Promise<Medication | null>;
export function getMedicationById(
  dbOrId: DatabasePort | number,
  maybeId?: number,
): Promise<Medication | null> {
  if (isDatabasePort(dbOrId)) {
    return getMedicationByIdWithPort(dbOrId, maybeId as number);
  }
  return getMedicationByIdWithPort(getRepositoryDatabase(), dbOrId);
}

export function getMedicationByBarcode(barcode: string): Promise<Medication | null>;
export function getMedicationByBarcode(
  db: DatabasePort,
  barcode: string,
): Promise<Medication | null>;
export function getMedicationByBarcode(
  dbOrBarcode: DatabasePort | string,
  maybeBarcode?: string,
): Promise<Medication | null> {
  if (isDatabasePort(dbOrBarcode)) {
    return getMedicationByBarcodeWithPort(dbOrBarcode, maybeBarcode as string);
  }
  return getMedicationByBarcodeWithPort(getRepositoryDatabase(), dbOrBarcode);
}

export function listMedications(options?: { includeArchived?: boolean }): Promise<Medication[]>;
export function listMedications(db: DatabasePort, options?: { includeArchived?: boolean }): Promise<Medication[]>;
export function listMedications(
  dbOrOptions?: DatabasePort | { includeArchived?: boolean },
  maybeOptions?: { includeArchived?: boolean },
): Promise<Medication[]> {
  if (isDatabasePort(dbOrOptions)) {
    return listMedicationsWithPort(dbOrOptions, maybeOptions);
  }
  return listMedicationsWithPort(getRepositoryDatabase(), dbOrOptions);
}

export function updateMedicationLocalInventory(
  id: number,
  input: UpdateMedicationLocalInventoryInput,
): Promise<Medication>;
export function updateMedicationLocalInventory(
  db: DatabasePort,
  id: number,
  input: UpdateMedicationLocalInventoryInput,
): Promise<Medication>;
export function updateMedicationLocalInventory(
  dbOrId: DatabasePort | number,
  idOrInput: number | UpdateMedicationLocalInventoryInput,
  maybeInput?: UpdateMedicationLocalInventoryInput,
): Promise<Medication> {
  if (isDatabasePort(dbOrId)) {
    return updateMedicationLocalInventoryWithPort(
      dbOrId,
      idOrInput as number,
      maybeInput as UpdateMedicationLocalInventoryInput,
    );
  }
  return updateMedicationLocalInventoryWithPort(
    getRepositoryDatabase(),
    dbOrId,
    idOrInput as UpdateMedicationLocalInventoryInput,
  );
}

export function updateMedicationMedicalInfo(
  id: number,
  input: UpdateMedicationMedicalInfoInput,
): Promise<Medication>;
export function updateMedicationMedicalInfo(
  db: DatabasePort,
  id: number,
  input: UpdateMedicationMedicalInfoInput,
): Promise<Medication>;
export function updateMedicationMedicalInfo(
  dbOrId: DatabasePort | number,
  idOrInput: number | UpdateMedicationMedicalInfoInput,
  maybeInput?: UpdateMedicationMedicalInfoInput,
): Promise<Medication> {
  if (isDatabasePort(dbOrId)) {
    return updateMedicationMedicalInfoWithPort(
      dbOrId,
      idOrInput as number,
      maybeInput as UpdateMedicationMedicalInfoInput,
    );
  }
  return updateMedicationMedicalInfoWithPort(
    getRepositoryDatabase(),
    dbOrId,
    idOrInput as UpdateMedicationMedicalInfoInput,
  );
}

export function updateMedicationFromImport(
  id: number,
  input: Partial<CreateMedicationInput>,
): Promise<Medication>;
export function updateMedicationFromImport(
  db: DatabasePort,
  id: number,
  input: Partial<CreateMedicationInput>,
): Promise<Medication>;
export function updateMedicationFromImport(
  dbOrId: DatabasePort | number,
  idOrInput: number | Partial<CreateMedicationInput>,
  maybeInput?: Partial<CreateMedicationInput>,
): Promise<Medication> {
  if (isDatabasePort(dbOrId)) {
    return updateMedicationFromImportWithPort(
      dbOrId,
      idOrInput as number,
      maybeInput as Partial<CreateMedicationInput>,
    );
  }
  return updateMedicationFromImportWithPort(
    getRepositoryDatabase(),
    dbOrId,
    idOrInput as Partial<CreateMedicationInput>,
  );
}

export function checkMedicationDeletionEligibility(
  id: number,
): Promise<DeletionEligibilityResult>;
export function checkMedicationDeletionEligibility(
  db: DatabasePort,
  id: number,
): Promise<DeletionEligibilityResult>;
export function checkMedicationDeletionEligibility(
  dbOrId: DatabasePort | number,
  maybeId?: number,
): Promise<DeletionEligibilityResult> {
  if (isDatabasePort(dbOrId)) {
    return checkMedicationDeletionEligibilityWithPort(dbOrId, maybeId as number);
  }
  return checkMedicationDeletionEligibilityWithPort(getRepositoryDatabase(), dbOrId);
}

export function deleteMedication(id: number): Promise<void>;
export function deleteMedication(db: DatabasePort, id: number): Promise<void>;
export function deleteMedication(dbOrId: DatabasePort | number, maybeId?: number): Promise<void> {
  if (isDatabasePort(dbOrId)) {
    return deleteMedicationWithPort(dbOrId, maybeId as number);
  }
  return deleteMedicationWithPort(getRepositoryDatabase(), dbOrId);
}

export function archiveMedication(id: number): Promise<void>;
export function archiveMedication(db: DatabasePort, id: number): Promise<void>;
export function archiveMedication(dbOrId: DatabasePort | number, maybeId?: number): Promise<void> {
  if (isDatabasePort(dbOrId)) {
    return archiveMedicationWithPort(dbOrId, maybeId as number);
  }
  return archiveMedicationWithPort(getRepositoryDatabase(), dbOrId);
}

export function unarchiveMedication(id: number): Promise<void>;
export function unarchiveMedication(db: DatabasePort, id: number): Promise<void>;
export function unarchiveMedication(dbOrId: DatabasePort | number, maybeId?: number): Promise<void> {
  if (isDatabasePort(dbOrId)) {
    return unarchiveMedicationWithPort(dbOrId, maybeId as number);
  }
  return unarchiveMedicationWithPort(getRepositoryDatabase(), dbOrId);
}

export function insertAlias(medicationId: number, alias: string): Promise<MedicationAlias>;
export function insertAlias(
  db: DatabasePort,
  medicationId: number,
  alias: string,
): Promise<MedicationAlias>;
export function insertAlias(
  dbOrMedId: DatabasePort | number,
  medIdOrAlias: number | string,
  maybeAlias?: string,
): Promise<MedicationAlias> {
  if (isDatabasePort(dbOrMedId)) {
    return insertAliasWithPort(dbOrMedId, medIdOrAlias as number, maybeAlias as string);
  }
  return insertAliasWithPort(getRepositoryDatabase(), dbOrMedId, medIdOrAlias as string);
}

export function listAliasesForMedication(medicationId: number): Promise<MedicationAlias[]>;
export function listAliasesForMedication(
  db: DatabasePort,
  medicationId: number,
): Promise<MedicationAlias[]>;
export function listAliasesForMedication(
  dbOrMedId: DatabasePort | number,
  maybeMedId?: number,
): Promise<MedicationAlias[]> {
  if (isDatabasePort(dbOrMedId)) {
    return listAliasesForMedicationWithPort(dbOrMedId, maybeMedId as number);
  }
  return listAliasesForMedicationWithPort(getRepositoryDatabase(), dbOrMedId);
}

export function deleteAlias(aliasId: number): Promise<void>;
export function deleteAlias(db: DatabasePort, aliasId: number): Promise<void>;
export function deleteAlias(
  dbOrAliasId: DatabasePort | number,
  maybeAliasId?: number,
): Promise<void> {
  if (isDatabasePort(dbOrAliasId)) {
    return deleteAliasWithPort(dbOrAliasId, maybeAliasId as number);
  }
  return deleteAliasWithPort(getRepositoryDatabase(), dbOrAliasId);
}

export function insertBatch(input: CreateBatchInput): Promise<Batch>;
export function insertBatch(db: DatabasePort, input: CreateBatchInput): Promise<Batch>;
export function insertBatch(
  dbOrInput: DatabasePort | CreateBatchInput,
  maybeInput?: CreateBatchInput,
): Promise<Batch> {
  if (isDatabasePort(dbOrInput)) {
    return insertBatchWithPort(dbOrInput, maybeInput as CreateBatchInput);
  }
  return insertBatchWithPort(getRepositoryDatabase(), dbOrInput);
}

export function getBatchById(batchId: number): Promise<Batch | null>;
export function getBatchById(db: DatabasePort, batchId: number): Promise<Batch | null>;
export function getBatchById(
  dbOrBatchId: DatabasePort | number,
  maybeBatchId?: number,
): Promise<Batch | null> {
  if (isDatabasePort(dbOrBatchId)) {
    return getBatchByIdWithPort(dbOrBatchId, maybeBatchId as number);
  }
  return getBatchByIdWithPort(getRepositoryDatabase(), dbOrBatchId);
}

export function listBatchesForMedication(medicationId: number): Promise<Batch[]>;
export function listBatchesForMedication(db: DatabasePort, medicationId: number): Promise<Batch[]>;
export function listBatchesForMedication(
  dbOrMedId: DatabasePort | number,
  maybeMedId?: number,
): Promise<Batch[]> {
  if (isDatabasePort(dbOrMedId)) {
    return listBatchesForMedicationWithPort(dbOrMedId, maybeMedId as number);
  }
  return listBatchesForMedicationWithPort(getRepositoryDatabase(), dbOrMedId);
}

export function updateBatchQuantity(batchId: number, quantity: number): Promise<Batch>;
export function updateBatchQuantity(
  db: DatabasePort,
  batchId: number,
  quantity: number,
): Promise<Batch>;
export function updateBatchQuantity(
  dbOrBatchId: DatabasePort | number,
  batchIdOrQuantity: number,
  maybeQuantity?: number,
): Promise<Batch> {
  if (isDatabasePort(dbOrBatchId)) {
    return updateBatchQuantityWithPort(dbOrBatchId, batchIdOrQuantity, maybeQuantity as number);
  }
  return updateBatchQuantityWithPort(getRepositoryDatabase(), dbOrBatchId, batchIdOrQuantity);
}

export function deleteBatch(batchId: number): Promise<void>;
export function deleteBatch(db: DatabasePort, batchId: number): Promise<void>;
export function deleteBatch(
  dbOrBatchId: DatabasePort | number,
  maybeBatchId?: number,
): Promise<void> {
  if (isDatabasePort(dbOrBatchId)) {
    return deleteBatchWithPort(dbOrBatchId, maybeBatchId as number);
  }
  return deleteBatchWithPort(getRepositoryDatabase(), dbOrBatchId);
}

export function listMovementsForMedication(medicationId: number): Promise<StockMovement[]>;
export function listMovementsForMedication(
  db: DatabasePort,
  medicationId: number,
): Promise<StockMovement[]>;
export function listMovementsForMedication(
  dbOrMedId: DatabasePort | number,
  maybeMedId?: number,
): Promise<StockMovement[]> {
  if (isDatabasePort(dbOrMedId)) {
    return listMovementsForMedicationWithPort(dbOrMedId, maybeMedId as number);
  }
  return listMovementsForMedicationWithPort(getRepositoryDatabase(), dbOrMedId);
}

export function insertPriceHistory(input: InsertPriceHistoryInput): Promise<PriceHistory>;
export function insertPriceHistory(
  db: DatabasePort,
  input: InsertPriceHistoryInput,
): Promise<PriceHistory>;
export function insertPriceHistory(
  dbOrInput: DatabasePort | InsertPriceHistoryInput,
  maybeInput?: InsertPriceHistoryInput,
): Promise<PriceHistory> {
  if (isDatabasePort(dbOrInput)) {
    return insertPriceHistoryWithPort(dbOrInput, maybeInput as InsertPriceHistoryInput);
  }
  return insertPriceHistoryWithPort(getRepositoryDatabase(), dbOrInput);
}

export function listPriceHistoryForMedication(medicationId: number): Promise<PriceHistory[]>;
export function listPriceHistoryForMedication(
  db: DatabasePort,
  medicationId: number,
): Promise<PriceHistory[]>;
export function listPriceHistoryForMedication(
  dbOrMedId: DatabasePort | number,
  maybeMedId?: number,
): Promise<PriceHistory[]> {
  if (isDatabasePort(dbOrMedId)) {
    return listPriceHistoryForMedicationWithPort(dbOrMedId, maybeMedId as number);
  }
  return listPriceHistoryForMedicationWithPort(getRepositoryDatabase(), dbOrMedId);
}

export function listCurrencies(): Promise<CurrencyRecord[]>;
export function listCurrencies(db: DatabasePort): Promise<CurrencyRecord[]>;
export function listCurrencies(db?: DatabasePort): Promise<CurrencyRecord[]> {
  return listCurrenciesWithPort(db ?? getRepositoryDatabase());
}

export function getCurrencyByCode(code: string): Promise<CurrencyRecord | null>;
export function getCurrencyByCode(db: DatabasePort, code: string): Promise<CurrencyRecord | null>;
export function getCurrencyByCode(
  dbOrCode: DatabasePort | string,
  maybeCode?: string,
): Promise<CurrencyRecord | null> {
  if (isDatabasePort(dbOrCode)) {
    return getCurrencyByCodeWithPort(dbOrCode, maybeCode as string);
  }
  return getCurrencyByCodeWithPort(getRepositoryDatabase(), dbOrCode);
}

export function updateCurrencyRate(code: string, rateToDa: number): Promise<CurrencyRecord>;
export function updateCurrencyRate(
  db: DatabasePort,
  code: string,
  rateToDa: number,
): Promise<CurrencyRecord>;
export function updateCurrencyRate(
  dbOrCode: DatabasePort | string,
  codeOrRate: string | number,
  maybeRate?: number,
): Promise<CurrencyRecord> {
  if (isDatabasePort(dbOrCode)) {
    return updateCurrencyRateWithPort(dbOrCode, codeOrRate as string, maybeRate as number);
  }
  return updateCurrencyRateWithPort(getRepositoryDatabase(), dbOrCode, codeOrRate as number);
}

export function seedCurrencies(): Promise<void>;
export function seedCurrencies(db: DatabasePort): Promise<void>;
export function seedCurrencies(db?: DatabasePort): Promise<void> {
  return seedCurrenciesWithPort(db ?? getRepositoryDatabase());
}

/**
 * Bound repository instance exposing typed CRUD per table over a specific DatabasePort.
 * Note: stock_movement and price_history are strictly append-only (no update or delete methods).
 */
export function createRepository(db: DatabasePort) {
  return {
    // Required core domain operations
    getMedicationWithAliases: (id: number) => getMedicationWithAliasesWithPort(db, id),
    getTotalStock: (medicationId: number) => getTotalStockWithPort(db, medicationId),
    insertMovement: (
      inputOrMedicationId: InsertMovementInput | number,
      batchId?: number | null,
      delta?: number,
      reason?: string | null,
      userId?: string | null,
      createdAt?: string,
    ) => insertMovementWithPort(db, inputOrMedicationId, batchId, delta, reason, userId, createdAt),
    setPrice: (
      medicationId: number,
      cents: number | null,
      source: PriceSource,
      confirmed: boolean | 0 | 1,
      userId: string,
      options?: SetPriceMetadataOptions,
    ) => setPriceWithPort(db, medicationId, cents, source, confirmed, userId, options),

    // Currencies & Exchange Rates
    seedCurrencies: () => seedCurrenciesWithPort(db),
    listCurrencies: () => listCurrenciesWithPort(db),
    getCurrencyByCode: (code: string) => getCurrencyByCodeWithPort(db, code),
    updateCurrencyRate: (code: string, rateToDa: number) =>
      updateCurrencyRateWithPort(db, code, rateToDa),

    // Medication CRUD
    insertMedication: (input: CreateMedicationInput) => insertMedicationWithPort(db, input),
    getMedicationById: (id: number) => getMedicationByIdWithPort(db, id),
    getMedicationByBarcode: (barcode: string) => getMedicationByBarcodeWithPort(db, barcode),
    listMedications: (options?: { includeArchived?: boolean }) =>
      listMedicationsWithPort(db, options),
    updateMedicationLocalInventory: (id: number, input: UpdateMedicationLocalInventoryInput) =>
      updateMedicationLocalInventoryWithPort(db, id, input),
    updateMedicationMedicalInfo: (id: number, input: UpdateMedicationMedicalInfoInput) =>
      updateMedicationMedicalInfoWithPort(db, id, input),
    updateMedicationFromImport: (id: number, input: Partial<CreateMedicationInput>) =>
      updateMedicationFromImportWithPort(db, id, input),
    checkMedicationDeletionEligibility: (id: number) =>
      checkMedicationDeletionEligibilityWithPort(db, id),
    deleteMedication: (id: number) => deleteMedicationWithPort(db, id),
    archiveMedication: (id: number) => archiveMedicationWithPort(db, id),
    unarchiveMedication: (id: number) => unarchiveMedicationWithPort(db, id),

    // Medication Alias CRUD
    insertAlias: (medicationId: number, alias: string) =>
      insertAliasWithPort(db, medicationId, alias),
    listAliasesForMedication: (medicationId: number) =>
      listAliasesForMedicationWithPort(db, medicationId),
    deleteAlias: (aliasId: number) => deleteAliasWithPort(db, aliasId),

    // Batch CRUD
    insertBatch: (input: CreateBatchInput) => insertBatchWithPort(db, input),
    getBatchById: (batchId: number) => getBatchByIdWithPort(db, batchId),
    listBatchesForMedication: (medicationId: number) =>
      listBatchesForMedicationWithPort(db, medicationId),
    listAllBatches: () => listAllBatchesWithPort(db),
    updateBatchQuantity: (batchId: number, quantity: number) =>
      updateBatchQuantityWithPort(db, batchId, quantity),
    deleteBatch: (batchId: number) => deleteBatchWithPort(db, batchId),

    // Append-only ledgers (read + append only; no update or delete)
    insertPriceHistory: (input: InsertPriceHistoryInput) => insertPriceHistoryWithPort(db, input),
    listMovementsForMedication: (medicationId: number) =>
      listMovementsForMedicationWithPort(db, medicationId),
    listPriceHistoryForMedication: (medicationId: number) =>
      listPriceHistoryForMedicationWithPort(db, medicationId),
    listAllPriceHistory: () => listAllPriceHistoryWithPort(db),
  };
}

export type PharmacyRepository = ReturnType<typeof createRepository>;
