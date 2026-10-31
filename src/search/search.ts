import type { DatabasePort, SqlParam } from '../db/port';
import {
  getMedicationWithAliases,
  getTotalStock,
  listBatchesForMedication,
  listPriceHistoryForMedication,
  type Batch,
  type Medication,
  type PriceHistory,
  type PriceSource,
} from '../db/repository';
import { seedDatabase } from '../db/seed';
import { collapseWhitespace, wRatio } from '../import/normalization';
import {
  getMovementHistoryForMedication,
  selectFefoBatch,
  sortBatchesFefo,
  type StockMovementHistoryEntry,
} from '../movements';
import { formatMoneyDisplay } from '../pricing';

export type SearchMatchLayer = 'barcode_exact' | 'brand_prefix' | 'fuzzy_wratio';

export interface SearchResultItem {
  medication: Medication;
  aliases: string[];
  totalStock: number;
  locationDisplay: string;
  unitPriceDisplay: string;
  matchedLayer: SearchMatchLayer;
  matchedField: 'barcode' | 'brand_name' | 'generic_name' | 'alias';
  wRatioScore: number;
}

export interface LayeredSearchResponse {
  query: string;
  normalizedQuery: string;
  matchedLayer: SearchMatchLayer | null;
  elapsedMs: number;
  results: SearchResultItem[];
}

export interface SearchMedicationDetail {
  medication: Medication;
  aliases: string[];
  locationDisplay: string;
  unitPriceDisplay: string;
  totalStock: number;
  batches: Batch[];
  fefoBatchId: number | null;
  movements: StockMovementHistoryEntry[];
  priceHistory: PriceHistory[];
  fetchedAtIso: string;
}

export const FUZZY_SEARCH_WRATIO_THRESHOLD = 70;
export const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Deliverable 3: Formats the prominent location string ("Zone A · Shelf 03 · Bin 2").
 */
export function formatLocationString(med: {
  zone?: string | null;
  shelf?: string | null;
  bin?: string | null;
}): string {
  const rawZone = med.zone?.trim() || 'Unassigned';
  const rawShelf = med.shelf?.trim() || '—';
  const rawBin = med.bin?.trim() || '—';

  const zoneLabel = /^zone\b/i.test(rawZone) ? rawZone : `Zone ${rawZone}`;
  const shelfLabel = /^shelf\b/i.test(rawShelf) ? rawShelf : `Shelf ${rawShelf}`;
  const binLabel = /^bin\b/i.test(rawBin) ? rawBin : `Bin ${rawBin}`;

  return `${zoneLabel} · ${shelfLabel} · ${binLabel}`;
}

/**
 * Deliverable 4: Formats unit_price_cents for display using the shared integer-cents pricing module.
 * If unit_price_cents IS NULL, returns "price not entered" — NEVER 0.00.
 */
export function formatUnitPriceDisplay(
  unitPriceCents: number | null | undefined,
  currency = 'USD',
): string {
  return formatMoneyDisplay(unitPriceCents, currency, { includeCentsSuffix: true });
}

function mapRawRowToMedication(row: Record<string, SqlParam>): {
  medication: Medication;
  totalStock: number;
  aliases: string[];
} {
  const medication: Medication = {
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
    currency: row.currency === null || row.currency === undefined ? 'USD' : String(row.currency),
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

  const totalStock =
    row.total_stock === null || row.total_stock === undefined ? 0 : Number(row.total_stock);

  const joinedAliases =
    row.joined_aliases === null || row.joined_aliases === undefined
      ? ''
      : String(row.joined_aliases);
  const aliases = joinedAliases
    ? joinedAliases
        .split('|||')
        .map((a) => a.trim())
        .filter(Boolean)
    : [];

  return { medication, totalStock, aliases };
}

function escapeSqlLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Extracts up to 6 representative trigrams (or bigrams for 2-char queries)
 * from a lowercased query to pre-filter and rank SQLite `search_text` candidates in C/Wasm.
 */
function extractQueryNgrams(normalizedLowerQuery: string): string[] {
  const clean = normalizedLowerQuery.replace(/[^a-z0-9]/g, '');
  if (clean.length === 0) return [];
  if (clean.length <= 2) return [clean];

  const gramLen = clean.length >= 5 ? 3 : 2;
  const allGrams: string[] = [];
  for (let i = 0; i <= clean.length - gramLen; i++) {
    const g = clean.slice(i, i + gramLen);
    if (!allGrams.includes(g)) {
      allGrams.push(g);
    }
  }

  if (allGrams.length <= 6) {
    return allGrams;
  }

  const sampled: string[] = [];
  const step = (allGrams.length - 1) / 5;
  for (let i = 0; i < 6; i++) {
    const idx = Math.round(i * step);
    if (!sampled.includes(allGrams[idx])) {
      sampled.push(allGrams[idx]);
    }
  }
  return sampled;
}

/**
 * Deliverable 2: Layered search in strict order, stopping at the first hit:
 *   a. exact barcode match
 *   b. brand_name prefix match
 *   c. fuzzy match (rapidfuzz WRatio > 70) across brand_name + generic_name + all aliases, returning top 10
 *
 * Constraints:
 * - Runs against local SQLite only via DatabasePort — no network call.
 * - Sub-100ms response for 5,000 medications using indexed barcode, NOCASE brand_name index,
 *   and precomputed indexed `search_text`.
 * - Every returned stock and price value is read from the SQLite DB in this request.
 */
export async function searchMedications(
  db: DatabasePort,
  rawQuery: string,
  options?: { limit?: number; fuzzyThreshold?: number },
): Promise<LayeredSearchResponse> {
  const startTime = performance.now();
  const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
  const fuzzyThreshold = options?.fuzzyThreshold ?? FUZZY_SEARCH_WRATIO_THRESHOLD;
  const trimmed = collapseWhitespace(rawQuery);

  if (trimmed === '') {
    return {
      query: rawQuery,
      normalizedQuery: '',
      matchedLayer: null,
      elapsedMs: 0,
      results: [],
    };
  }

  // ===========================================================================
  // LAYER 2a: Exact Barcode Match
  // ===========================================================================
  const barcodeRows = await db.query<Record<string, SqlParam>>(
    `SELECT m.*,
            COALESCE((SELECT SUM(b.quantity) FROM batch b WHERE b.medication_id = m.id), 0) AS total_stock,
            (SELECT GROUP_CONCAT(ma.alias, '|||') FROM medication_alias ma WHERE ma.medication_id = m.id) AS joined_aliases
     FROM medication m
     WHERE m.barcode = ?
       AND COALESCE(m.is_archived, 0) = 0
     LIMIT ?`,
    [trimmed, limit],
  );

  if (barcodeRows.length > 0) {
    const results: SearchResultItem[] = barcodeRows.map((row) => {
      const { medication, totalStock, aliases } = mapRawRowToMedication(row);
      return {
        medication,
        aliases,
        totalStock,
        locationDisplay: formatLocationString(medication),
        unitPriceDisplay: formatUnitPriceDisplay(medication.unit_price_cents, medication.currency),
        matchedLayer: 'barcode_exact',
        matchedField: 'barcode',
        wRatioScore: 100,
      };
    });

    return {
      query: rawQuery,
      normalizedQuery: trimmed,
      matchedLayer: 'barcode_exact',
      elapsedMs: Math.round((performance.now() - startTime) * 100) / 100,
      results,
    };
  }

  // ===========================================================================
  // LAYER 2b: brand_name Prefix Match
  // ===========================================================================
  const escapedPrefix = `${escapeSqlLikePattern(trimmed)}%`;
  const prefixRows = await db.query<Record<string, SqlParam>>(
    `SELECT m.*,
            COALESCE((SELECT SUM(b.quantity) FROM batch b WHERE b.medication_id = m.id), 0) AS total_stock,
            (SELECT GROUP_CONCAT(ma.alias, '|||') FROM medication_alias ma WHERE ma.medication_id = m.id) AS joined_aliases
     FROM medication m
     WHERE m.brand_name LIKE ? ESCAPE '\\' COLLATE NOCASE
       AND COALESCE(m.is_archived, 0) = 0
     ORDER BY
       CASE WHEN LOWER(m.brand_name) = LOWER(?) THEN 0 ELSE 1 END ASC,
       m.brand_name COLLATE NOCASE ASC,
       m.id ASC
     LIMIT ?`,
    [escapedPrefix, trimmed, limit],
  );

  if (prefixRows.length > 0) {
    const results: SearchResultItem[] = prefixRows.map((row) => {
      const { medication, totalStock, aliases } = mapRawRowToMedication(row);
      return {
        medication,
        aliases,
        totalStock,
        locationDisplay: formatLocationString(medication),
        unitPriceDisplay: formatUnitPriceDisplay(medication.unit_price_cents, medication.currency),
        matchedLayer: 'brand_prefix',
        matchedField: 'brand_name',
        wRatioScore: wRatio(trimmed, medication.brand_name),
      };
    });

    return {
      query: rawQuery,
      normalizedQuery: trimmed,
      matchedLayer: 'brand_prefix',
      elapsedMs: Math.round((performance.now() - startTime) * 100) / 100,
      results,
    };
  }

  // ===========================================================================
  // LAYER 2c: Fuzzy Match (rapidfuzz WRatio > 70) across brand_name + generic_name + all aliases
  // ===========================================================================
  const lowerQuery = trimmed.toLowerCase();
  const ngrams = extractQueryNgrams(lowerQuery);

  let candidateRows: {
    id: number;
    brand_name: string;
    generic_name: string | null;
    search_text: string | null;
  }[];

  if (ngrams.length > 0) {
    const scoreTerms = ngrams
      .map(() => '(CASE WHEN search_text LIKE ? THEN 1 ELSE 0 END)')
      .join(' + ');
    const whereTerms = ngrams.map(() => 'search_text LIKE ?').join(' OR ');
    const patternParams = ngrams.map((g) => `%${g}%`);
    candidateRows = await db.query<{
      id: number;
      brand_name: string;
      generic_name: string | null;
      search_text: string | null;
    }>(
      `SELECT id, brand_name, generic_name, search_text
       FROM medication
       WHERE (${whereTerms})
         AND COALESCE(is_archived, 0) = 0
       ORDER BY (${scoreTerms}) DESC, id ASC
       LIMIT 120`,
      [...patternParams, ...patternParams],
    );
  } else {
    candidateRows = await db.query<{
      id: number;
      brand_name: string;
      generic_name: string | null;
      search_text: string | null;
    }>('SELECT id, brand_name, generic_name, search_text FROM medication WHERE COALESCE(is_archived, 0) = 0 LIMIT 120');
  }

  const scoredCandidates: {
    id: number;
    brand_name: string;
    score: number;
    matchedField: 'brand_name' | 'generic_name' | 'alias';
  }[] = [];

  for (const cand of candidateRows) {
    let bestScore = wRatio(lowerQuery, cand.brand_name);
    let bestField: 'brand_name' | 'generic_name' | 'alias' = 'brand_name';

    if (cand.generic_name) {
      const genericScore = wRatio(lowerQuery, cand.generic_name);
      if (genericScore > bestScore) {
        bestScore = genericScore;
        bestField = 'generic_name';
      }
    }

    if (cand.search_text) {
      // search_text format: lower(brand)|||lower(generic)|||lower(alias1)|||lower(alias2)...
      const segments = cand.search_text.split('|||');
      for (let i = 2; i < segments.length; i++) {
        const aliasSegment = segments[i]?.trim();
        if (!aliasSegment) continue;
        const aliasScore = wRatio(lowerQuery, aliasSegment);
        if (aliasScore > bestScore) {
          bestScore = aliasScore;
          bestField = 'alias';
        }
      }
    }

    if (bestScore > fuzzyThreshold) {
      scoredCandidates.push({
        id: Number(cand.id),
        brand_name: String(cand.brand_name),
        score: bestScore,
        matchedField: bestField,
      });
    }
  }

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.brand_name.localeCompare(b.brand_name, 'en', { sensitivity: 'base' });
  });

  const topWinners = scoredCandidates.slice(0, limit);
  if (topWinners.length === 0) {
    return {
      query: rawQuery,
      normalizedQuery: trimmed,
      matchedLayer: null,
      elapsedMs: Math.round((performance.now() - startTime) * 100) / 100,
      results: [],
    };
  }

  const winnerIds = topWinners.map((w) => w.id);
  const placeholders = winnerIds.map(() => '?').join(', ');
  const fullWinnerRows = await db.query<Record<string, SqlParam>>(
    `SELECT m.*,
            COALESCE((SELECT SUM(b.quantity) FROM batch b WHERE b.medication_id = m.id), 0) AS total_stock,
            (SELECT GROUP_CONCAT(ma.alias, '|||') FROM medication_alias ma WHERE ma.medication_id = m.id) AS joined_aliases
     FROM medication m
     WHERE m.id IN (${placeholders})`,
    winnerIds,
  );

  const rowById = new Map<number, Record<string, SqlParam>>();
  for (const r of fullWinnerRows) {
    rowById.set(Number(r.id), r);
  }

  const results: SearchResultItem[] = [];
  for (const winner of topWinners) {
    const rawRow = rowById.get(winner.id);
    if (!rawRow) continue;
    const { medication, totalStock, aliases } = mapRawRowToMedication(rawRow);
    results.push({
      medication,
      aliases,
      totalStock,
      locationDisplay: formatLocationString(medication),
      unitPriceDisplay: formatUnitPriceDisplay(medication.unit_price_cents, medication.currency),
      matchedLayer: 'fuzzy_wratio',
      matchedField: winner.matchedField,
      wRatioScore: winner.score,
    });
  }

  return {
    query: rawQuery,
    normalizedQuery: trimmed,
    matchedLayer: 'fuzzy_wratio',
    elapsedMs: Math.round((performance.now() - startTime) * 100) / 100,
    results,
  };
}

/**
 * Deliverable 4: Reads full detail card state directly from SQLite in this request
 * when tapping a search result (full location with location_note, total stock across batches,
 * per-batch expiry list, and unit price / "price not entered").
 */
export async function getMedicationDetailForSearch(
  db: DatabasePort,
  medicationId: number,
): Promise<SearchMedicationDetail | null> {
  const [withAliases, totalStock, rawBatches, movements, priceHistory] = await Promise.all([
    getMedicationWithAliases(db, medicationId),
    getTotalStock(db, medicationId),
    listBatchesForMedication(db, medicationId),
    getMovementHistoryForMedication(db, medicationId),
    listPriceHistoryForMedication(db, medicationId),
  ]);

  if (!withAliases) {
    return null;
  }

  const batches = sortBatchesFefo(rawBatches);
  const fefoBatch = selectFefoBatch(batches);

  return {
    medication: withAliases,
    aliases: withAliases.aliases,
    locationDisplay: formatLocationString(withAliases),
    unitPriceDisplay: formatUnitPriceDisplay(withAliases.unit_price_cents, withAliases.currency),
    totalStock,
    batches,
    fefoBatchId: fefoBatch?.id ?? null,
    movements,
    priceHistory,
    fetchedAtIso: new Date().toISOString(),
  };
}

/**
 * Seeds up to `targetTotalCount` (default 5,000) medications with batches, aliases,
 * and precomputed `search_text` in a single fast transaction so sub-100ms 5,000-row
 * search acceptance criteria can be verified in tests and in the live UI.
 */
export async function seed5000Medications(
  db: DatabasePort,
  targetTotalCount = 5000,
): Promise<{ totalMedications: number; elapsedMs: number }> {
  const start = performance.now();
  await seedDatabase(db);

  const countRows = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM medication');
  const currentCount = Number(countRows[0]?.cnt ?? 0);

  if (currentCount >= targetTotalCount) {
    return {
      totalMedications: currentCount,
      elapsedMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  const maxIdRows = await db.query<{ max_id: number | null }>(
    'SELECT MAX(id) AS max_id FROM medication',
  );
  const startId = Number(maxIdRows[0]?.max_id ?? 0) + 1;
  const needed = targetTotalCount - currentCount;

  const baseFamilies = [
    {
      prefix: 'Cardiovasc',
      generic: 'Bisoprolol Fumarate',
      form: 'Tablet',
      cat: 'Cardiovascular',
      atc: 'C07AB07',
      zone: 'A',
    },
    {
      prefix: 'Neurocalm',
      generic: 'Pregabalin',
      form: 'Capsule',
      cat: 'Neurology',
      atc: 'N02BF02',
      zone: 'B',
    },
    {
      prefix: 'Gastroshield',
      generic: 'Pantoprazole Sodium',
      form: 'Tablet',
      cat: 'Gastrointestinal',
      atc: 'A02BC02',
      zone: 'C',
    },
    {
      prefix: 'Dermaclear',
      generic: 'Betamethasone Valerate',
      form: 'Cream',
      cat: 'Dermatology',
      atc: 'D07AC01',
      zone: 'D',
    },
    {
      prefix: 'Pulmofree',
      generic: 'Budesonide',
      form: 'Inhaler',
      cat: 'Respiratory',
      atc: 'R03BA02',
      zone: 'B',
    },
    {
      prefix: 'Glucostab',
      generic: 'Empagliflozin',
      form: 'Tablet',
      cat: 'Antidiabetic',
      atc: 'A10BK03',
      zone: 'A',
    },
    {
      prefix: 'Osteofort',
      generic: 'Alendronic Acid',
      form: 'Tablet',
      cat: 'Musculoskeletal',
      atc: 'M05BA04',
      zone: 'C',
    },
    {
      prefix: 'Ophtaldrop',
      generic: 'Latanoprost',
      form: 'Drops',
      cat: 'Ophthalmology',
      atc: 'S01EE01',
      zone: 'Cold-1',
    },
    {
      prefix: 'Vascutens',
      generic: 'Telmisartan',
      form: 'Tablet',
      cat: 'Cardiovascular',
      atc: 'C09CA07',
      zone: 'A',
    },
    {
      prefix: 'Rhumalgin',
      generic: 'Meloxicam',
      form: 'Tablet',
      cat: 'Anti-inflammatory',
      atc: 'M01AC06',
      zone: 'C',
    },
  ];

  const strengths = ['5 mg', '10 mg', '20 mg', '40 mg', '50 mg', '75 mg', '100 mg', '250 mg'];
  const nowIso = '2026-10-25T08:00:00.000Z';

  await db.transaction(async (tx) => {
    const chunkSize = 250;
    for (let offset = 0; offset < needed; offset += chunkSize) {
      const batchCount = Math.min(chunkSize, needed - offset);
      const medValuesSql: string[] = [];
      const batchValuesSql: string[] = [];

      for (let i = 0; i < batchCount; i++) {
        const seq = offset + i;
        const id = startId + seq;
        const fam = baseFamilies[seq % baseFamilies.length];
        const strength = strengths[seq % strengths.length];
        const brandName = `${fam.prefix}-${id} ${strength}`;
        const genericName = fam.generic;
        const barcode = `340099${String(id).padStart(7, '0')}`;
        const shelf = `${fam.zone}${String((seq % 12) + 1).padStart(2, '0')}`;
        const bin = String((seq % 20) + 1).padStart(2, '0');
        const locationNote = `Standard dispensary rack ${fam.zone}-${shelf}`;
        // Every 25th synthetic item has NULL unit_price_cents to exercise "price not entered"
        const unitPriceCents = seq % 25 === 0 ? 'NULL' : String(450 + (seq % 80) * 25);
        const costPriceCents = seq % 25 === 0 ? 'NULL' : String(250 + (seq % 80) * 15);
        const priceSource = seq % 25 === 0 ? 'NULL' : "'official_tariff'";
        const priceConfirmed = seq % 25 === 0 ? 0 : 1;
        const searchText = `${brandName.toLowerCase()}|||${genericName.toLowerCase()}|||${fam.prefix.toLowerCase()} ${id}`;

        medValuesSql.push(
          `(${id}, '${brandName}', '${genericName}', '${strength}', '${fam.form}', '${fam.cat}', '${fam.atc}', 'GenericLab Pharma', '${barcode}', 'Ambient 15-25C', '${fam.zone}', '${shelf}', '${bin}', '${locationNote}', 15, 7, ${unitPriceCents}, ${costPriceCents}, 'USD', 30, ${priceSource}, ${priceConfirmed}, '${nowIso}', '${nowIso}', '${searchText}')`,
        );

        const qty = 20 + (seq % 90);
        batchValuesSql.push(`(${id}, 'LOT-5K-${id}', ${qty}, '2028-06-30', '${nowIso}')`);
      }

      await tx.exec(
        `INSERT INTO medication (
          id, brand_name, generic_name, strength, dosage_form, category, atc_code,
          manufacturer, barcode, storage, zone, shelf, bin, location_note,
          reorder_level, lead_time_days, unit_price_cents, cost_price_cents,
          currency, units_per_pack, price_source, price_confirmed,
          price_updated_at, updated_at, search_text
        ) VALUES ${medValuesSql.join(', ')};`,
      );

      await tx.exec(
        `INSERT INTO batch (medication_id, lot_number, quantity, expiry_date, received_at)
         VALUES ${batchValuesSql.join(', ')};`,
      );
    }
  });

  const finalCountRows = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM medication');
  return {
    totalMedications: Number(finalCountRows[0]?.cnt ?? 0),
    elapsedMs: Math.round((performance.now() - start) * 100) / 100,
  };
}
