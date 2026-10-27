import type { Medication, PriceSource } from '../db/repository';

export type DataLayerGroup = 'CATALOG' | 'INVENTORY' | 'PRICE';

export type CatalogFieldKey =
  | 'brand_name'
  | 'generic_name'
  | 'strength'
  | 'dosage_form'
  | 'category'
  | 'atc_code'
  | 'manufacturer'
  | 'barcode'
  | 'storage'
  | 'posology'
  | 'interactions'
  | 'composition'
  | 'therapeutic_class'
  | 'indications'
  | 'precautions'
  | 'route'
  | 'side_effects';

export type InventoryFieldKey =
  | 'zone'
  | 'shelf'
  | 'bin'
  | 'location_note'
  | 'quantity'
  | 'expiry_date'
  | 'lot_number'
  | 'reorder_level'
  | 'lead_time_days';

export type PriceFieldKey = 'unit_price_cents' | 'cost_price_cents' | 'currency' | 'units_per_pack';

export type TargetFieldKey = CatalogFieldKey | InventoryFieldKey | PriceFieldKey;

export interface TargetFieldDescriptor {
  key: TargetFieldKey;
  label: string;
  layer: DataLayerGroup;
  description: string;
  required?: boolean;
}

export const CATALOG_FIELDS: readonly TargetFieldDescriptor[] = [
  {
    key: 'brand_name',
    label: 'brand_name',
    layer: 'CATALOG',
    description: 'Normalized & title-cased commercial brand name (fuzzy duplicate checked)',
    required: true,
  },
  {
    key: 'generic_name',
    label: 'generic_name',
    layer: 'CATALOG',
    description: 'INN / active pharmaceutical ingredient',
  },
  {
    key: 'strength',
    label: 'strength',
    layer: 'CATALOG',
    description: 'Concentration or dosage strength (e.g. 500 mg, 100 mcg)',
  },
  {
    key: 'dosage_form',
    label: 'dosage_form',
    layer: 'CATALOG',
    description: 'Galenic form (e.g. Tablet, Capsule, Inhaler, Pen)',
  },
  {
    key: 'category',
    label: 'category',
    layer: 'CATALOG',
    description: 'General category',
  },
  {
    key: 'atc_code',
    label: 'atc_code',
    layer: 'CATALOG',
    description: 'WHO Anatomical Therapeutic Chemical code',
  },
  {
    key: 'manufacturer',
    label: 'manufacturer',
    layer: 'CATALOG',
    description: 'Marketing authorization holder / manufacturer',
  },
  {
    key: 'barcode',
    label: 'barcode',
    layer: 'CATALOG',
    description: 'Unique EAN-13 / GTIN barcode (primary deduplication key)',
  },
  {
    key: 'storage',
    label: 'storage',
    layer: 'CATALOG',
    description: 'Storage condition (e.g. Ambient 15-25C, Refrigerated 2-8C)',
  },
  {
    key: 'posology',
    label: 'posology',
    layer: 'CATALOG',
    description: 'Dosage instructions and administration schedule',
  },
  {
    key: 'interactions',
    label: 'interactions',
    layer: 'CATALOG',
    description: 'Known drug-drug or clinical interactions',
  },
  {
    key: 'composition',
    label: 'composition',
    layer: 'CATALOG',
    description: 'Active molecule and excipients',
  },
  {
    key: 'therapeutic_class',
    label: 'therapeutic_class',
    layer: 'CATALOG',
    description: 'Pharmacological / therapeutic class (e.g. Antibiotic, Antihypertensive)',
  },
  {
    key: 'indications',
    label: 'indications',
    layer: 'CATALOG',
    description: 'Clinical indications (what it treats)',
  },
  {
    key: 'precautions',
    label: 'precautions',
    layer: 'CATALOG',
    description: 'Clinical warnings, contraindications, and precautions',
  },
  {
    key: 'route',
    label: 'route',
    layer: 'CATALOG',
    description: 'Route of administration (e.g. Oral, IV, Topical, Inhalation)',
  },
  {
    key: 'side_effects',
    label: 'side_effects',
    layer: 'CATALOG',
    description: 'Adverse effects and known side effects',
  },
] as const;

export const INVENTORY_FIELDS: readonly TargetFieldDescriptor[] = [
  {
    key: 'zone',
    label: 'zone',
    layer: 'INVENTORY',
    description: 'Dispensary zone or room code',
  },
  {
    key: 'shelf',
    label: 'shelf',
    layer: 'INVENTORY',
    description: 'Bay or shelf identifier',
  },
  {
    key: 'bin',
    label: 'bin',
    layer: 'INVENTORY',
    description: 'Drawer or bin slot',
  },
  {
    key: 'location_note',
    label: 'location_note',
    layer: 'INVENTORY',
    description: 'Pharmacist physical location notes',
  },
  {
    key: 'quantity',
    label: 'quantity',
    layer: 'INVENTORY',
    description: 'Batch stock quantity (INTEGER; ignored in catalog-only mode)',
  },
  {
    key: 'expiry_date',
    label: 'expiry_date',
    layer: 'INVENTORY',
    description: 'Batch expiration date (ISO-8601 YYYY-MM-DD)',
  },
  {
    key: 'lot_number',
    label: 'lot_number',
    layer: 'INVENTORY',
    description: 'Manufacturer batch / lot number',
  },
  {
    key: 'reorder_level',
    label: 'reorder_level',
    layer: 'INVENTORY',
    description: 'Low-stock threshold (INTEGER, default 10)',
  },
  {
    key: 'lead_time_days',
    label: 'lead_time_days',
    layer: 'INVENTORY',
    description: 'Supplier replenishment lead time in days (INTEGER, default 7)',
  },
] as const;

export const PRICE_FIELDS: readonly TargetFieldDescriptor[] = [
  {
    key: 'unit_price_cents',
    label: 'unit_price_cents',
    layer: 'PRICE',
    description: 'Unit price ("12,50", "12.50", "$12.50" -> integer cents; unconfirmed)',
  },
  {
    key: 'cost_price_cents',
    label: 'cost_price_cents',
    layer: 'PRICE',
    description: 'Wholesale acquisition cost parsed to integer cents',
  },
  {
    key: 'currency',
    label: 'currency',
    layer: 'PRICE',
    description: 'ISO 4217 currency code (default USD)',
  },
  {
    key: 'units_per_pack',
    label: 'units_per_pack',
    layer: 'PRICE',
    description: 'Dispensing units per pack (INTEGER, default 1)',
  },
] as const;

export const ALL_TARGET_FIELDS: readonly TargetFieldDescriptor[] = [
  ...CATALOG_FIELDS,
  ...INVENTORY_FIELDS,
  ...PRICE_FIELDS,
];

export const TARGET_FIELD_BY_KEY: Readonly<Record<TargetFieldKey, TargetFieldDescriptor>> =
  Object.fromEntries(ALL_TARGET_FIELDS.map((f) => [f.key, f])) as Record<
    TargetFieldKey,
    TargetFieldDescriptor
  >;

/**
 * Source type selector before import:
 * - 'pharmacy_spreadsheet' ("Pharmacy's own spreadsheet") -> price_source='manual', price_confirmed=0
 * - 'official_tariff'      ("Official tariff file")       -> price_source='official_tariff', price_confirmed=0
 * - 'catalog_only'         ("Catalog only (no prices)")   -> price columns ignored, no batch rows created
 */
export type ImportSourceType = 'pharmacy_spreadsheet' | 'official_tariff' | 'catalog_only';

export interface ImportSourceTypeDescriptor {
  value: ImportSourceType;
  label: string;
  mappedPriceSource: PriceSource | null;
  createsBatches: boolean;
  description: string;
}

export const IMPORT_SOURCE_TYPES: readonly ImportSourceTypeDescriptor[] = [
  {
    value: 'pharmacy_spreadsheet',
    label: "Pharmacy's own spreadsheet",
    mappedPriceSource: 'manual',
    createsBatches: true,
    description:
      "Imports catalog, inventory batches, and prices with price_source='manual' and price_confirmed=0 (pharmacist confirmation required after import).",
  },
  {
    value: 'official_tariff',
    label: 'Official tariff file',
    mappedPriceSource: 'official_tariff',
    createsBatches: true,
    description:
      "Imports or updates prices with price_source='official_tariff' and price_confirmed=0, appending a price_history record per priced medication.",
  },
  {
    value: 'catalog_only',
    label: 'Catalog only (no prices)',
    mappedPriceSource: null,
    createsBatches: false,
    description:
      'Imports reference catalog metadata only. Price columns are ignored entirely and no batch rows are created.',
  },
] as const;

/**
 * Maps each target schema field to a 0-based CSV column index (or null/undefined if unmapped).
 */
export type ColumnMapping = Partial<Record<TargetFieldKey, number | null>>;

export interface SavedMappingProfile {
  id: string;
  profileName: string;
  sourceFileName: string;
  hasHeaderRow: boolean;
  mapping: ColumnMapping;
  updatedAt: string;
}

export interface CsvColumnMeta {
  index: number;
  rawHeader: string;
  displayLabel: string;
  sampleValues: string[];
}

export interface CsvDataRow {
  rowNumber: number; // 1-based data row index (1..N)
  sourceLineNumber: number; // 1-based file line number
  cells: string[];
}

export interface ParsedCsvDocument {
  delimiter: ',' | ';' | '\t';
  hasHeaderRow: boolean;
  columns: CsvColumnMeta[];
  rows: CsvDataRow[];
}

export type DuplicateResolutionAction = 'merge' | 'keep_separate';

export interface DuplicateRowSnapshot {
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  barcode: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
}

export interface DuplicateCandidate {
  id: string;
  rowNumber: number;
  incomingBrandRaw: string;
  incomingBrandNormalized: string;
  matchedBrandName: string;
  matchedBrandNormalized: string;
  wRatioScore: number;
  matchOrigin: 'csv_row' | 'existing_db';
  matchedRowNumber?: number;
  matchedMedicationId?: number;
  incomingSnapshot: DuplicateRowSnapshot;
  matchedSnapshot: DuplicateRowSnapshot;
  resolution: DuplicateResolutionAction;
}

export type ImportIssueCode =
  | 'PROBABLE_DUPLICATE'
  | 'INVALID_PRICE'
  | 'INVALID_COST_PRICE'
  | 'MISSING_BARCODE'
  | 'MISSING_BRAND_NAME'
  | 'INVALID_QUANTITY'
  | 'INVALID_INTEGER_FIELD';

export interface ImportRowIssue {
  rowNumber: number;
  code: ImportIssueCode;
  field: TargetFieldKey;
  rawValue: string;
  message: string;
  wRatioScore?: number;
  matchedBrandName?: string;
}

export interface NormalizedImportRow {
  rowNumber: number;
  action: 'insert' | 'update';
  matchedBy: 'barcode' | 'brand_strength_form' | null;
  existingMedicationId: number | null;
  // Layer 1: Catalog
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  category: string | null;
  atc_code: string | null;
  manufacturer: string | null;
  barcode: string | null;
  storage: string | null;
  posology: string | null;
  interactions: string | null;
  composition: string | null;
  therapeutic_class: string | null;
  indications: string | null;
  precautions: string | null;
  route: string | null;
  side_effects: string | null;
  // Layer 2: Inventory
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  quantity: number | null;
  expiry_date: string | null;
  lot_number: string | null;
  reorder_level: number | undefined;
  lead_time_days: number | undefined;
  // Layer 3: Price
  unit_price_cents: number | null;
  cost_price_cents: number | null;
  currency: string | undefined;
  units_per_pack: number | undefined;
  price_source: PriceSource | null;
  price_confirmed: 0;
  willCreateOrUpdateBatch: boolean;
  willWritePriceHistory: boolean;
}

export interface BulkImportPreviewResult {
  sourceType: ImportSourceType;
  totalRows: number;
  validRowCount: number;
  errorCount: number;
  issues: ImportRowIssue[];
  duplicates: DuplicateCandidate[];
  validRows: NormalizedImportRow[];
  summary: {
    medicationsToInsert: number;
    medicationsToUpdate: number;
    batchesToWrite: number;
    priceHistoryToAppend: number;
    duplicateIssueCount: number;
    badPriceIssueCount: number;
    missingBarcodeIssueCount: number;
  };
}

export interface BulkImportExecutionResult extends BulkImportPreviewResult {
  dryRun: boolean;
  importedCount: number;
  insertedMedicationCount: number;
  updatedMedicationCount: number;
  batchesWrittenCount: number;
  priceHistoryWrittenCount: number;
  importedMedications: Medication[];
}
