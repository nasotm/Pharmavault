import type { DatabasePort } from '../db/port';
import { createRepository, type Medication, type PriceSource } from '../db/repository';
import {
  buildMedicationMatchKey,
  normalizeBrandName,
  normalizeTextField,
  parsePriceToCents,
  wRatio,
} from './normalization';
import {
  ALL_TARGET_FIELDS,
  IMPORT_SOURCE_TYPES,
  type BulkImportExecutionResult,
  type BulkImportPreviewResult,
  type ColumnMapping,
  type CsvColumnMeta,
  type DuplicateCandidate,
  type DuplicateResolutionAction,
  type ImportRowIssue,
  type ImportSourceType,
  type NormalizedImportRow,
  type ParsedCsvDocument,
  type SavedMappingProfile,
  type TargetFieldKey,
} from './types';

export const WRATIO_DUPLICATE_THRESHOLD = 85;
const MAPPING_PROFILES_STORAGE_KEY = 'pharmavault.mapping_profiles.v1';

/**
 * Header-agnostic convenience helper that suggests initial column mappings if any
 * column header or sample resembles a known field, while allowing full user remapping.
 */
export function autoSuggestColumnMapping(columns: CsvColumnMeta[]): ColumnMapping {
  const synonyms: Record<TargetFieldKey, string[]> = {
    brand_name: [
      'brand_name',
      'brand',
      'trade_name',
      'product_name',
      'medication',
      'nom_commercial',
      'drug_name',
    ],
    generic_name: ['generic_name', 'generic', 'inn', 'dci', 'active_ingredient'],
    strength: ['strength', 'dosage', 'concentration', 'dose'],
    dosage_form: ['dosage_form', 'form', 'galenic_form', 'presentation'],
    category: ['category', 'class'],
    atc_code: ['atc_code', 'atc'],
    manufacturer: ['manufacturer', 'maker', 'lab', 'laboratory', 'mah'],
    barcode: ['barcode', 'ean', 'ean13', 'gtin', 'upc', 'cip'],
    storage: ['storage', 'storage_condition', 'temperature'],
    posology: ['posology', 'dosage_instructions', 'posologie', 'dosing'],
    interactions: ['interactions', 'drug_interactions', 'interactions_medicamenteuses'],
    composition: ['composition', 'excipients', 'active_molecule', 'ingredients'],
    therapeutic_class: ['therapeutic_class', 'classe_therapeutique', 'pharmacological_class'],
    indications: ['indications', 'indication', 'treats', 'therapeutic_indications'],
    precautions: ['precautions', 'warnings', 'contraindications', 'mise_en_garde'],
    route: ['route', 'route_of_administration', 'administration_route', 'voie'],
    side_effects: ['side_effects', 'adverse_effects', 'effets_indesirables', 'adverse_reactions'],
    zone: ['zone', 'dispensary_zone', 'room'],
    shelf: ['shelf', 'bay', 'rack'],
    bin: ['bin', 'drawer', 'slot'],
    location_note: ['location_note', 'location_notes', 'note', 'notes'],
    quantity: ['quantity', 'qty', 'stock', 'on_hand', 'units'],
    expiry_date: ['expiry_date', 'expiry', 'exp_date', 'expiration'],
    lot_number: ['lot_number', 'lot', 'batch_number', 'batch'],
    reorder_level: ['reorder_level', 'reorder', 'min_stock', 'threshold'],
    lead_time_days: ['lead_time_days', 'lead_time', 'lead_days'],
    unit_price_cents: [
      'unit_price_cents',
      'unit_price',
      'price',
      'selling_price',
      'tariff_price',
      'retail_price',
    ],
    cost_price_cents: ['cost_price_cents', 'cost_price', 'cost', 'wholesale_price'],
    currency: ['currency', 'curr'],
    units_per_pack: ['units_per_pack', 'pack_size', 'pack_units'],
  };

  const mapping: ColumnMapping = {};
  const usedIndices = new Set<number>();

  for (const field of ALL_TARGET_FIELDS) {
    const candidates = synonyms[field.key] ?? [field.key];
    const match = columns.find((col) => {
      if (usedIndices.has(col.index)) return false;
      const normalizedHeader = col.rawHeader
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return candidates.includes(normalizedHeader);
    });

    if (match) {
      mapping[field.key] = match.index;
      usedIndices.add(match.index);
    }
  }

  return mapping;
}

// =============================================================================
// NAMED MAPPING PROFILE PERSISTENCE (PER SOURCE FILE)
// =============================================================================

const inMemoryProfiles = new Map<string, SavedMappingProfile>();

function readAllProfilesFromStorage(): SavedMappingProfile[] {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(MAPPING_PROFILES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedMappingProfile[];
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to in-memory store
    }
  }
  return Array.from(inMemoryProfiles.values());
}

function writeAllProfilesToStorage(profiles: SavedMappingProfile[]): void {
  inMemoryProfiles.clear();
  for (const p of profiles) {
    inMemoryProfiles.set(p.id, p);
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(MAPPING_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    } catch {
      // Ignore storage quota errors in restricted contexts
    }
  }
}

export function saveMappingProfile(input: {
  profileName: string;
  sourceFileName: string;
  hasHeaderRow: boolean;
  mapping: ColumnMapping;
}): SavedMappingProfile {
  const trimmedName = input.profileName.trim() || 'Default Mapping Profile';
  const trimmedSource = input.sourceFileName.trim() || 'uploaded.csv';
  const id = `${trimmedSource.toLowerCase()}::${trimmedName.toLowerCase()}`;
  const profile: SavedMappingProfile = {
    id,
    profileName: trimmedName,
    sourceFileName: trimmedSource,
    hasHeaderRow: input.hasHeaderRow,
    mapping: { ...input.mapping },
    updatedAt: new Date().toISOString(),
  };

  const existing = readAllProfilesFromStorage().filter((p) => p.id !== id);
  existing.unshift(profile);
  writeAllProfilesToStorage(existing);
  return profile;
}

export function listMappingProfiles(sourceFileName?: string): SavedMappingProfile[] {
  const all = readAllProfilesFromStorage();
  if (!sourceFileName) return all;
  const normalized = sourceFileName.trim().toLowerCase();
  return all.filter((p) => p.sourceFileName.toLowerCase() === normalized);
}

export function deleteMappingProfile(id: string): void {
  const remaining = readAllProfilesFromStorage().filter((p) => p.id !== id);
  writeAllProfilesToStorage(remaining);
}

// =============================================================================
// DRY-RUN PREVIEW & TRANSACTIONAL BULK IMPORT ENGINE
// =============================================================================

export interface BulkImportOptions {
  parsedCsv: ParsedCsvDocument;
  mapping: ColumnMapping;
  sourceType: ImportSourceType;
  duplicateResolutions?: Record<number, DuplicateResolutionAction>;
  requireBarcodeWhenMapped?: boolean;
  userId?: string;
}

function getCellValue(cells: string[], colIndex: number | null | undefined): string {
  if (colIndex === null || colIndex === undefined || colIndex < 0 || colIndex >= cells.length) {
    return '';
  }
  return cells[colIndex] ?? '';
}

function parseOptionalPositiveOrZeroInt(
  raw: string,
  allowZero: boolean,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `Expected integer value, received "${raw}"` };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || (!allowZero && parsed <= 0)) {
    return { ok: false, error: `Invalid integer value "${raw}"` };
  }
  return { ok: true, value: parsed };
}

/**
 * Runs a complete dry-run analysis of the CSV import against the current database state.
 * Collects per-row errors, normalizes names, detects fuzzy duplicates (`wRatio > 85` on `brand_name`),
 * and builds the execution plan without writing to the database.
 */
export async function prepareBulkImportPreview(
  db: DatabasePort,
  options: BulkImportOptions,
): Promise<BulkImportPreviewResult> {
  const repo = createRepository(db);
  const existingMedications = await repo.listMedications();

  const existingByBarcode = new Map<string, Medication>();
  const existingByMatchKey = new Map<string, Medication>();

  for (const med of existingMedications) {
    if (med.barcode) {
      existingByBarcode.set(med.barcode.trim(), med);
    }
    const key = buildMedicationMatchKey(med.brand_name, med.strength, med.dosage_form);
    existingByMatchKey.set(key, med);
  }

  const sourceDescriptor =
    IMPORT_SOURCE_TYPES.find((s) => s.value === options.sourceType) ?? IMPORT_SOURCE_TYPES[0];
  const isCatalogOnly = options.sourceType === 'catalog_only';
  const mappedPriceSource: PriceSource | null = sourceDescriptor.mappedPriceSource;

  const isBarcodeMapped = options.mapping.barcode !== null && options.mapping.barcode !== undefined;
  const requireBarcode = options.requireBarcodeWhenMapped ?? isBarcodeMapped;

  const issues: ImportRowIssue[] = [];
  const duplicates: DuplicateCandidate[] = [];
  const validRows: NormalizedImportRow[] = [];

  // Track earlier rows in the same CSV to detect in-file fuzzy duplicates on brand_name
  const seenCsvRows: {
    rowNumber: number;
    brandRaw: string;
    brandNormalized: string;
    barcode: string | null;
    matchKey: string;
    snapshot: DuplicateCandidate['incomingSnapshot'];
  }[] = [];

  for (const row of options.parsedCsv.rows) {
    const rowNumber = row.rowNumber;
    const rawBrand = getCellValue(row.cells, options.mapping.brand_name);
    const normalizedBrand = normalizeBrandName(rawBrand);

    const rawGeneric = getCellValue(row.cells, options.mapping.generic_name);
    const genericName = normalizeTextField(rawGeneric);

    const rawStrength = getCellValue(row.cells, options.mapping.strength);
    const strength = normalizeTextField(rawStrength);

    const rawForm = getCellValue(row.cells, options.mapping.dosage_form);
    const dosageForm = normalizeTextField(rawForm);

    const category = normalizeTextField(getCellValue(row.cells, options.mapping.category));
    const atcCode = normalizeTextField(getCellValue(row.cells, options.mapping.atc_code));
    const manufacturer = normalizeTextField(getCellValue(row.cells, options.mapping.manufacturer));
    const rawBarcode = getCellValue(row.cells, options.mapping.barcode);
    const barcode = normalizeTextField(rawBarcode);
    const storage = normalizeTextField(getCellValue(row.cells, options.mapping.storage));
    const posology = normalizeTextField(getCellValue(row.cells, options.mapping.posology));
    const interactions = normalizeTextField(getCellValue(row.cells, options.mapping.interactions));
    const composition = normalizeTextField(getCellValue(row.cells, options.mapping.composition));
    const therapeuticClass = normalizeTextField(
      getCellValue(row.cells, options.mapping.therapeutic_class),
    );
    const indications = normalizeTextField(getCellValue(row.cells, options.mapping.indications));
    const precautions = normalizeTextField(getCellValue(row.cells, options.mapping.precautions));
    const route = normalizeTextField(getCellValue(row.cells, options.mapping.route));
    const sideEffects = normalizeTextField(getCellValue(row.cells, options.mapping.side_effects));

    // Layer 2: Inventory
    const zone = normalizeTextField(getCellValue(row.cells, options.mapping.zone));
    const shelf = normalizeTextField(getCellValue(row.cells, options.mapping.shelf));
    const bin = normalizeTextField(getCellValue(row.cells, options.mapping.bin));
    const locationNote = normalizeTextField(getCellValue(row.cells, options.mapping.location_note));
    const rawQuantity = getCellValue(row.cells, options.mapping.quantity);
    const expiryDate = normalizeTextField(getCellValue(row.cells, options.mapping.expiry_date));
    const lotNumber = normalizeTextField(getCellValue(row.cells, options.mapping.lot_number));
    const rawReorderLevel = getCellValue(row.cells, options.mapping.reorder_level);
    const rawLeadTimeDays = getCellValue(row.cells, options.mapping.lead_time_days);

    // Layer 3: Price (ignored completely when sourceType === 'catalog_only')
    const rawUnitPrice = isCatalogOnly
      ? ''
      : getCellValue(row.cells, options.mapping.unit_price_cents);
    const rawCostPrice = isCatalogOnly
      ? ''
      : getCellValue(row.cells, options.mapping.cost_price_cents);
    const rawCurrency = isCatalogOnly ? '' : getCellValue(row.cells, options.mapping.currency);
    const rawUnitsPerPack = isCatalogOnly
      ? ''
      : getCellValue(row.cells, options.mapping.units_per_pack);

    let rowHasError = false;

    // 1. Validate brand_name presence
    if (!normalizedBrand) {
      issues.push({
        rowNumber,
        code: 'MISSING_BRAND_NAME',
        field: 'brand_name',
        rawValue: rawBrand,
        message: `Row ${rowNumber}: Missing required brand_name.`,
      });
      rowHasError = true;
    }

    // 2. Validate barcode presence when barcode column is mapped
    if (requireBarcode && !barcode) {
      issues.push({
        rowNumber,
        code: 'MISSING_BARCODE',
        field: 'barcode',
        rawValue: rawBarcode,
        message: `Row ${rowNumber} (${normalizedBrand || 'Unnamed'}): Missing barcode.`,
      });
      rowHasError = true;
    }

    // 3. Validate unit_price_cents and cost_price_cents (when not catalog_only)
    let parsedUnitPriceCents: number | null = null;
    if (
      !isCatalogOnly &&
      options.mapping.unit_price_cents !== null &&
      options.mapping.unit_price_cents !== undefined
    ) {
      const priceResult = parsePriceToCents(rawUnitPrice);
      if (!priceResult.ok) {
        issues.push({
          rowNumber,
          code: 'INVALID_PRICE',
          field: 'unit_price_cents',
          rawValue: rawUnitPrice,
          message: `Row ${rowNumber} (${normalizedBrand || 'Unnamed'}): ${priceResult.error}`,
        });
        rowHasError = true;
      } else {
        parsedUnitPriceCents = priceResult.cents;
      }
    }

    let parsedCostPriceCents: number | null = null;
    if (
      !isCatalogOnly &&
      options.mapping.cost_price_cents !== null &&
      options.mapping.cost_price_cents !== undefined
    ) {
      const costResult = parsePriceToCents(rawCostPrice);
      if (!costResult.ok) {
        issues.push({
          rowNumber,
          code: 'INVALID_COST_PRICE',
          field: 'cost_price_cents',
          rawValue: rawCostPrice,
          message: `Row ${rowNumber} (${normalizedBrand || 'Unnamed'}): ${costResult.error}`,
        });
        rowHasError = true;
      } else {
        parsedCostPriceCents = costResult.cents;
      }
    }

    // 4. Validate inventory integer fields
    let parsedQuantity: number | null = null;
    if (
      !isCatalogOnly &&
      options.mapping.quantity !== null &&
      options.mapping.quantity !== undefined
    ) {
      const qtyResult = parseOptionalPositiveOrZeroInt(rawQuantity, true);
      if (!qtyResult.ok) {
        issues.push({
          rowNumber,
          code: 'INVALID_QUANTITY',
          field: 'quantity',
          rawValue: rawQuantity,
          message: `Row ${rowNumber} (${normalizedBrand || 'Unnamed'}): Invalid quantity "${rawQuantity}"`,
        });
        rowHasError = true;
      } else {
        parsedQuantity = qtyResult.value;
      }
    }

    let parsedReorderLevel: number | undefined = undefined;
    if (options.mapping.reorder_level !== null && options.mapping.reorder_level !== undefined) {
      const reorderResult = parseOptionalPositiveOrZeroInt(rawReorderLevel, true);
      if (!reorderResult.ok) {
        issues.push({
          rowNumber,
          code: 'INVALID_INTEGER_FIELD',
          field: 'reorder_level',
          rawValue: rawReorderLevel,
          message: `Row ${rowNumber}: Invalid reorder_level "${rawReorderLevel}"`,
        });
        rowHasError = true;
      } else if (reorderResult.value !== null) {
        parsedReorderLevel = reorderResult.value;
      }
    }

    let parsedLeadTimeDays: number | undefined = undefined;
    if (options.mapping.lead_time_days !== null && options.mapping.lead_time_days !== undefined) {
      const leadResult = parseOptionalPositiveOrZeroInt(rawLeadTimeDays, true);
      if (!leadResult.ok) {
        issues.push({
          rowNumber,
          code: 'INVALID_INTEGER_FIELD',
          field: 'lead_time_days',
          rawValue: rawLeadTimeDays,
          message: `Row ${rowNumber}: Invalid lead_time_days "${rawLeadTimeDays}"`,
        });
        rowHasError = true;
      } else if (leadResult.value !== null) {
        parsedLeadTimeDays = leadResult.value;
      }
    }

    let parsedUnitsPerPack: number | undefined = undefined;
    if (
      !isCatalogOnly &&
      options.mapping.units_per_pack !== null &&
      options.mapping.units_per_pack !== undefined
    ) {
      const packResult = parseOptionalPositiveOrZeroInt(rawUnitsPerPack, false);
      if (!packResult.ok) {
        issues.push({
          rowNumber,
          code: 'INVALID_INTEGER_FIELD',
          field: 'units_per_pack',
          rawValue: rawUnitsPerPack,
          message: `Row ${rowNumber}: Invalid units_per_pack "${rawUnitsPerPack}"`,
        });
        rowHasError = true;
      } else if (packResult.value !== null) {
        parsedUnitsPerPack = packResult.value;
      }
    }

    const matchKey = buildMedicationMatchKey(normalizedBrand, strength, dosageForm);

    // Check if this row matches an existing DB medication by barcode first, then brand+strength+form
    let existingMatch: Medication | undefined = barcode
      ? existingByBarcode.get(barcode)
      : undefined;
    let matchedBy: 'barcode' | 'brand_strength_form' | null = existingMatch ? 'barcode' : null;

    if (!existingMatch && normalizedBrand) {
      existingMatch = existingByMatchKey.get(matchKey);
      if (existingMatch) {
        matchedBy = 'brand_strength_form';
      }
    }

    // 5. Fuzzy Duplicate Detection (rapidfuzz WRatio > 85 on brand_name)
    // Check against earlier rows in this CSV first
    const incomingSnapshot: DuplicateCandidate['incomingSnapshot'] = {
      brand_name: normalizedBrand || rawBrand,
      generic_name: genericName,
      strength,
      dosage_form: dosageForm,
      barcode,
      quantity: parsedQuantity,
      unit_price_cents: parsedUnitPriceCents,
    };

    if (normalizedBrand) {
      let bestCsvDup: {
        row: (typeof seenCsvRows)[number];
        score: number;
      } | null = null;

      for (const prev of seenCsvRows) {
        const score = wRatio(normalizedBrand, prev.brandNormalized);
        if (score > WRATIO_DUPLICATE_THRESHOLD) {
          if (!bestCsvDup || score > bestCsvDup.score) {
            bestCsvDup = { row: prev, score };
          }
        }
      }

      if (bestCsvDup) {
        const resolution: DuplicateResolutionAction =
          options.duplicateResolutions?.[rowNumber] ?? 'merge';

        duplicates.push({
          id: `dup-row-${rowNumber}`,
          rowNumber,
          incomingBrandRaw: rawBrand,
          incomingBrandNormalized: normalizedBrand,
          matchedBrandName: bestCsvDup.row.brandNormalized,
          matchedBrandNormalized: bestCsvDup.row.brandNormalized,
          wRatioScore: bestCsvDup.score,
          matchOrigin: 'csv_row',
          matchedRowNumber: bestCsvDup.row.rowNumber,
          incomingSnapshot,
          matchedSnapshot: bestCsvDup.row.snapshot,
          resolution,
        });

        if (resolution === 'merge') {
          issues.push({
            rowNumber,
            code: 'PROBABLE_DUPLICATE',
            field: 'brand_name',
            rawValue: rawBrand,
            wRatioScore: bestCsvDup.score,
            matchedBrandName: bestCsvDup.row.brandNormalized,
            message: `Row ${rowNumber}: Probable duplicate "${normalizedBrand}" matches Row ${bestCsvDup.row.rowNumber} "${bestCsvDup.row.brandNormalized}" (WRatio ${bestCsvDup.score.toFixed(1)} > ${WRATIO_DUPLICATE_THRESHOLD}).`,
          });
          rowHasError = true;
        }
      } else if (!existingMatch) {
        // Also check against existing DB medications when not an exact barcode or brand+strength+form update match
        let bestDbDup: { med: Medication; score: number } | null = null;
        for (const med of existingMedications) {
          const score = wRatio(normalizedBrand, normalizeBrandName(med.brand_name));
          if (score > WRATIO_DUPLICATE_THRESHOLD) {
            if (!bestDbDup || score > bestDbDup.score) {
              bestDbDup = { med, score };
            }
          }
        }

        if (bestDbDup) {
          const resolution: DuplicateResolutionAction =
            options.duplicateResolutions?.[rowNumber] ?? 'merge';

          duplicates.push({
            id: `dup-db-${rowNumber}`,
            rowNumber,
            incomingBrandRaw: rawBrand,
            incomingBrandNormalized: normalizedBrand,
            matchedBrandName: bestDbDup.med.brand_name,
            matchedBrandNormalized: normalizeBrandName(bestDbDup.med.brand_name),
            wRatioScore: bestDbDup.score,
            matchOrigin: 'existing_db',
            matchedMedicationId: bestDbDup.med.id,
            incomingSnapshot,
            matchedSnapshot: {
              brand_name: bestDbDup.med.brand_name,
              generic_name: bestDbDup.med.generic_name,
              strength: bestDbDup.med.strength,
              dosage_form: bestDbDup.med.dosage_form,
              barcode: bestDbDup.med.barcode,
              quantity: null,
              unit_price_cents: bestDbDup.med.unit_price_cents,
            },
            resolution,
          });

          if (resolution === 'merge') {
            issues.push({
              rowNumber,
              code: 'PROBABLE_DUPLICATE',
              field: 'brand_name',
              rawValue: rawBrand,
              wRatioScore: bestDbDup.score,
              matchedBrandName: bestDbDup.med.brand_name,
              message: `Row ${rowNumber}: Probable duplicate "${normalizedBrand}" matches existing "${bestDbDup.med.brand_name}" (WRatio ${bestDbDup.score.toFixed(1)} > ${WRATIO_DUPLICATE_THRESHOLD}).`,
            });
            rowHasError = true;
          }
        }
      }
    }

    if (rowHasError) {
      continue;
    }

    seenCsvRows.push({
      rowNumber,
      brandRaw: rawBrand,
      brandNormalized: normalizedBrand,
      barcode,
      matchKey,
      snapshot: incomingSnapshot,
    });

    const currency = normalizeTextField(rawCurrency) ?? undefined;
    const willCreateOrUpdateBatch = !isCatalogOnly && parsedQuantity !== null;
    const willWritePriceHistory =
      !isCatalogOnly && parsedUnitPriceCents !== null && mappedPriceSource !== null;

    validRows.push({
      rowNumber,
      action: existingMatch ? 'update' : 'insert',
      matchedBy,
      existingMedicationId: existingMatch ? existingMatch.id : null,
      brand_name: normalizedBrand,
      generic_name: genericName,
      strength,
      dosage_form: dosageForm,
      category,
      atc_code: atcCode,
      manufacturer,
      barcode,
      storage,
      posology,
      interactions,
      composition,
      therapeutic_class: therapeuticClass,
      indications,
      precautions,
      route,
      side_effects: sideEffects,
      zone,
      shelf,
      bin,
      location_note: locationNote,
      quantity: isCatalogOnly ? null : parsedQuantity,
      expiry_date: isCatalogOnly ? null : expiryDate,
      lot_number: isCatalogOnly ? null : lotNumber,
      reorder_level: parsedReorderLevel,
      lead_time_days: parsedLeadTimeDays,
      unit_price_cents: isCatalogOnly ? null : parsedUnitPriceCents,
      cost_price_cents: isCatalogOnly ? null : parsedCostPriceCents,
      currency: isCatalogOnly ? undefined : currency,
      units_per_pack: isCatalogOnly ? undefined : parsedUnitsPerPack,
      price_source: willWritePriceHistory ? mappedPriceSource : null,
      price_confirmed: 0,
      willCreateOrUpdateBatch,
      willWritePriceHistory,
    });
  }

  const medicationsToInsert = validRows.filter((r) => r.action === 'insert').length;
  const medicationsToUpdate = validRows.filter((r) => r.action === 'update').length;
  const batchesToWrite = validRows.filter((r) => r.willCreateOrUpdateBatch).length;
  const priceHistoryToAppend = validRows.filter((r) => r.willWritePriceHistory).length;

  return {
    sourceType: options.sourceType,
    totalRows: options.parsedCsv.rows.length,
    validRowCount: validRows.length,
    errorCount: issues.length,
    issues,
    duplicates,
    validRows,
    summary: {
      medicationsToInsert,
      medicationsToUpdate,
      batchesToWrite,
      priceHistoryToAppend,
      duplicateIssueCount: issues.filter((i) => i.code === 'PROBABLE_DUPLICATE').length,
      badPriceIssueCount: issues.filter(
        (i) => i.code === 'INVALID_PRICE' || i.code === 'INVALID_COST_PRICE',
      ).length,
      missingBarcodeIssueCount: issues.filter((i) => i.code === 'MISSING_BARCODE').length,
    },
  };
}

/**
 * Executes the bulk import (or returns the dry-run preview when `dryRun: true`).
 * Writes all `medication`, `batch`, and `price_history` rows in ONE SQLite transaction.
 * Per-row errors are collected and returned, never fatal to valid rows.
 *
 * Enforced invariants:
 * - Re-importing the same file never doubles stock (matches medication on barcode first,
 *   then normalized brand+strength+form; upserts batch by lot_number).
 * - Catalog-only imports never create batch rows and ignore price columns completely.
 * - Imported prices are NEVER marked confirmed (`price_confirmed = 0`).
 * - Every medication that received a price appends one `price_history` row with
 *   `source` = the selected source type ('manual' or 'official_tariff').
 */
export async function executeBulkImport(
  db: DatabasePort,
  options: BulkImportOptions & { dryRun?: boolean },
): Promise<BulkImportExecutionResult> {
  const preview = await prepareBulkImportPreview(db, options);
  const dryRun = options.dryRun ?? false;

  if (dryRun || preview.validRows.length === 0) {
    return {
      ...preview,
      dryRun,
      importedCount: 0,
      insertedMedicationCount: 0,
      updatedMedicationCount: 0,
      batchesWrittenCount: 0,
      priceHistoryWrittenCount: 0,
      importedMedications: [],
    };
  }

  const changedBy = options.userId ?? `bulk_import:${options.sourceType}`;

  const txResult = await db.transaction(async (tx) => {
    const repo = createRepository(tx);
    const existingMeds = await repo.listMedications();
    const byBarcode = new Map<string, Medication>();
    const byMatchKey = new Map<string, Medication>();

    for (const m of existingMeds) {
      if (m.barcode) {
        byBarcode.set(m.barcode.trim(), m);
      }
      byMatchKey.set(buildMedicationMatchKey(m.brand_name, m.strength, m.dosage_form), m);
    }

    let insertedMedicationCount = 0;
    let updatedMedicationCount = 0;
    let batchesWrittenCount = 0;
    let priceHistoryWrittenCount = 0;
    const importedMedications: Medication[] = [];

    for (const row of preview.validRows) {
      const matchKey = buildMedicationMatchKey(row.brand_name, row.strength, row.dosage_form);
      let matchedMed = row.barcode ? byBarcode.get(row.barcode) : undefined;
      if (!matchedMed) {
        matchedMed = byMatchKey.get(matchKey);
      }

      let persistedMed: Medication;

      if (matchedMed) {
        persistedMed = await repo.updateMedicationFromImport(matchedMed.id, {
          brand_name: row.brand_name || matchedMed.brand_name,
          generic_name: row.generic_name ?? undefined,
          strength: row.strength ?? undefined,
          dosage_form: row.dosage_form ?? undefined,
          category: row.category ?? undefined,
          atc_code: row.atc_code ?? undefined,
          manufacturer: row.manufacturer ?? undefined,
          barcode: row.barcode ?? undefined,
          storage: row.storage ?? undefined,
          posology: row.posology ?? undefined,
          interactions: row.interactions ?? undefined,
          composition: row.composition ?? undefined,
          therapeutic_class: row.therapeutic_class ?? undefined,
          indications: row.indications ?? undefined,
          precautions: row.precautions ?? undefined,
          route: row.route ?? undefined,
          side_effects: row.side_effects ?? undefined,
          zone: row.zone ?? undefined,
          shelf: row.shelf ?? undefined,
          bin: row.bin ?? undefined,
          location_note: row.location_note ?? undefined,
          reorder_level: row.reorder_level,
          lead_time_days: row.lead_time_days,
          unit_price_cents: row.unit_price_cents !== null ? row.unit_price_cents : undefined,
          cost_price_cents: row.cost_price_cents !== null ? row.cost_price_cents : undefined,
          currency: row.currency,
          units_per_pack: row.units_per_pack,
          price_source: row.price_source !== null ? row.price_source : undefined,
          price_confirmed: 0,
        });
        updatedMedicationCount++;
      } else {
        persistedMed = await repo.insertMedication({
          brand_name: row.brand_name,
          generic_name: row.generic_name,
          strength: row.strength,
          dosage_form: row.dosage_form,
          category: row.category,
          atc_code: row.atc_code,
          manufacturer: row.manufacturer,
          barcode: row.barcode,
          storage: row.storage,
          posology: row.posology,
          interactions: row.interactions,
          composition: row.composition,
          therapeutic_class: row.therapeutic_class,
          indications: row.indications,
          precautions: row.precautions,
          route: row.route,
          side_effects: row.side_effects,
          zone: row.zone,
          shelf: row.shelf,
          bin: row.bin,
          location_note: row.location_note,
          reorder_level: row.reorder_level ?? 10,
          lead_time_days: row.lead_time_days ?? 7,
          unit_price_cents: row.unit_price_cents,
          cost_price_cents: row.cost_price_cents,
          currency: row.currency ?? 'USD',
          units_per_pack: row.units_per_pack ?? 1,
          price_source: row.price_source,
          price_confirmed: 0, // Imported prices are NEVER marked confirmed
        });
        insertedMedicationCount++;
      }

      if (persistedMed.barcode) {
        byBarcode.set(persistedMed.barcode.trim(), persistedMed);
      }
      byMatchKey.set(
        buildMedicationMatchKey(
          persistedMed.brand_name,
          persistedMed.strength,
          persistedMed.dosage_form,
        ),
        persistedMed,
      );
      importedMedications.push(persistedMed);

      // Deliverable 6: Catalog-only imports must NEVER create batch rows.
      // Constraint: Re-importing the same file must not double stock.
      if (row.willCreateOrUpdateBatch && row.quantity !== null) {
        const targetLot = row.lot_number ?? `IMP-LOT-${persistedMed.id}`;
        const existingBatches = await repo.listBatchesForMedication(persistedMed.id);
        const matchingBatch = existingBatches.find(
          (b) => (b.lot_number ?? `IMP-LOT-${persistedMed.id}`) === targetLot,
        );

        if (matchingBatch) {
          await repo.updateBatchQuantity(matchingBatch.id, row.quantity);
        } else {
          await repo.insertBatch({
            medication_id: persistedMed.id,
            lot_number: targetLot,
            quantity: row.quantity,
            expiry_date: row.expiry_date,
          });
        }
        batchesWrittenCount++;
      }

      // Constraint: Every import writes one price_history row per medication that got a price,
      // with source = the selected source type.
      if (row.willWritePriceHistory && row.unit_price_cents !== null && row.price_source !== null) {
        await repo.insertPriceHistory({
          medication_id: persistedMed.id,
          unit_price_cents: row.unit_price_cents,
          source: row.price_source,
          changed_by: changedBy,
        });
        priceHistoryWrittenCount++;
      }
    }

    return {
      insertedMedicationCount,
      updatedMedicationCount,
      batchesWrittenCount,
      priceHistoryWrittenCount,
      importedMedications,
    };
  });

  return {
    ...preview,
    dryRun: false,
    importedCount: txResult.insertedMedicationCount + txResult.updatedMedicationCount,
    insertedMedicationCount: txResult.insertedMedicationCount,
    updatedMedicationCount: txResult.updatedMedicationCount,
    batchesWrittenCount: txResult.batchesWrittenCount,
    priceHistoryWrittenCount: txResult.priceHistoryWrittenCount,
    importedMedications: txResult.importedMedications,
  };
}
