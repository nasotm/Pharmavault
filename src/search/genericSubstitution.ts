import type { DatabasePort } from '../db/port';
import { formatLocationString } from './search';

export const GENERIC_DCI_INFERENCE_PROMPT =
  'Look at the brand name and find its DCI (molecule).';

export interface GenericEquivalentItem {
  medicationId: number;
  brandName: string;
  genericName: string;
  strength: string | null;
  dosageForm: string | null;
  locationDisplay: string;
  totalStock: number;
  unitPriceCents: number | null;
  currency: string;
  formattedLine: string;
}

export interface GenericSubstitutionResult {
  sourceMedicationId: number;
  sourceBrandName: string;
  sourceGenericName: string | null;
  resolvedGenericName: string | null;
  inferredByAi: boolean;
  equivalents: GenericEquivalentItem[];
  summaryText: string;
}

export type DciInferenceFunction = (
  brandName: string,
) => Promise<{ dci: string | null; source: 'ai' | 'deterministic' }>;

/**
 * Known brand-to-DCI (active molecule) dictionary used as a deterministic fallback
 * when offline or when the AI endpoint is unavailable, and to ground common brand names.
 */
const KNOWN_BRAND_TO_DCI_MAP: Record<string, string> = {
  amoxil: 'Amoxicillin',
  clamoxyl: 'Amoxicillin',
  biomox: 'Amoxicillin',
  penamox: 'Amoxicillin',
  augmentin: 'Amoxicillin',
  ventolin: 'Salbutamol',
  'ventolin hfa': 'Salbutamol',
  ventoline: 'Salbutamol',
  asthalin: 'Salbutamol',
  salbumol: 'Salbutamol',
  albuterol: 'Salbutamol',
  lantus: 'Insulin Glargine',
  'lantus solostar': 'Insulin Glargine',
  abasaglar: 'Insulin Glargine',
  toujeo: 'Insulin Glargine',
  lipitor: 'Atorvastatin Calcium',
  tahor: 'Atorvastatin Calcium',
  ator: 'Atorvastatin Calcium',
  vastatin: 'Atorvastatin Calcium',
  doliprane: 'Paracetamol',
  efferalgan: 'Paracetamol',
  dafalgan: 'Paracetamol',
  paralgan: 'Paracetamol',
  panadol: 'Paracetamol',
  tylenol: 'Paracetamol',
  advil: 'Ibuprofen',
  nurofen: 'Ibuprofen',
  upfen: 'Ibuprofen',
  voltaren: 'Diclofenac',
  voltarene: 'Diclofenac',
  flagyl: 'Metronidazole',
  zithromax: 'Azithromycin',
  ciproxine: 'Ciprofloxacin',
  glucophage: 'Metformin',
  stagid: 'Metformin',
  cozaar: 'Losartan',
  mopral: 'Omeprazole',
  inexium: 'Esomeprazole',
  gastroshield: 'Pantoprazole Sodium',
  eupantol: 'Pantoprazole Sodium',
  inipomp: 'Pantoprazole Sodium',
  cardiovasc: 'Bisoprolol Fumarate',
  cardensiel: 'Bisoprolol Fumarate',
  detensiel: 'Bisoprolol Fumarate',
  neurocalm: 'Pregabalin',
  lyrica: 'Pregabalin',
  dermaclear: 'Betamethasone Valerate',
  celestene: 'Betamethasone Valerate',
  diprosone: 'Betamethasone Valerate',
  pulmofree: 'Budesonide',
  pulmicort: 'Budesonide',
  glucostab: 'Empagliflozin',
  jardiance: 'Empagliflozin',
  osteofort: 'Alendronic Acid',
  fosamax: 'Alendronic Acid',
  ophtaldrop: 'Latanoprost',
  xalatan: 'Latanoprost',
  vascutens: 'Telmisartan',
  micardis: 'Telmisartan',
  rhumalgin: 'Meloxicam',
  mobic: 'Meloxicam',
};

const COMMON_SALT_SUFFIXES = [
  'calcium',
  'sodium',
  'potassium',
  'fumarate',
  'sulfate',
  'sulphate',
  'hydrochloride',
  'hcl',
  'valerate',
  'trihydrate',
  'dihydrate',
  'monohydrate',
  'maleate',
  'besylate',
  'tartrate',
  'mesylate',
  'acetate',
  'phosphate',
  'citrate',
];

/**
 * Checks whether a medication is eligible to show the "Find Generic Equivalent" action.
 * Triggered when total stock is 0 or at/below reorder_level.
 */
export function isEligibleForGenericSubstitution(
  totalStock: number,
  reorderLevel: number,
): boolean {
  return totalStock <= 0 || totalStock <= reorderLevel;
}

/**
 * Normalizes a molecule / DCI string for comparison by lowercasing, collapsing whitespace,
 * and stripping common pharmaceutical salt suffixes when comparing base active molecules.
 */
export function normalizeMoleculeForMatch(molecule: string | null | undefined): string {
  if (!molecule) return '';
  const cleaned = molecule
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const tokens = cleaned.split(' ').filter((token) => !COMMON_SALT_SUFFIXES.includes(token));
  return (tokens.length > 0 ? tokens.join(' ') : cleaned).trim();
}

/**
 * Returns true if two generic/molecule strings refer to the same active ingredient.
 */
export function areGenericMoleculesEquivalent(
  moleculeA: string | null | undefined,
  moleculeB: string | null | undefined,
): boolean {
  if (!moleculeA || !moleculeB) return false;
  const rawA = moleculeA.trim().toLowerCase();
  const rawB = moleculeB.trim().toLowerCase();
  if (!rawA || !rawB) return false;
  if (rawA === rawB) return true;

  const normA = normalizeMoleculeForMatch(rawA);
  const normB = normalizeMoleculeForMatch(rawB);
  return normA.length > 0 && normA === normB;
}

/**
 * Deterministically infers the DCI (molecule) from a brand name when known.
 */
export function inferDciFromBrandNameDeterministic(brandName: string): string | null {
  const cleaned = brandName
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(mg|g|mcg|ml|iu|ui|%)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  if (KNOWN_BRAND_TO_DCI_MAP[cleaned]) {
    return KNOWN_BRAND_TO_DCI_MAP[cleaned];
  }

  for (const [key, dci] of Object.entries(KNOWN_BRAND_TO_DCI_MAP)) {
    if (cleaned.startsWith(key) || cleaned.includes(key)) {
      return dci;
    }
  }

  return null;
}

/**
 * Calls the backend AI Assistant endpoint `/api/ai/infer-dci` with the strict prompt:
 * "Look at the brand name and find its DCI (molecule)."
 * Falls back to deterministic inference if offline or in unit test environments.
 */
export async function inferDciWithAiAssistant(
  brandName: string,
): Promise<{ dci: string | null; source: 'ai' | 'deterministic' }> {
  const trimmedBrand = brandName.trim();
  if (!trimmedBrand) {
    return { dci: null, source: 'deterministic' };
  }

  if (typeof fetch === 'function') {
    try {
      const response = await fetch('/api/ai/infer-dci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: trimmedBrand,
          prompt: GENERIC_DCI_INFERENCE_PROMPT,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          dci?: string | null;
          source?: 'ai' | 'deterministic';
        };
        if (typeof data.dci === 'string' && data.dci.trim().length > 0) {
          return {
            dci: data.dci.trim(),
            source: data.source === 'ai' ? 'ai' : 'deterministic',
          };
        }
      }
    } catch {
      // Fallback to deterministic lookup when server is unreachable or in Node unit tests
    }
  }

  return {
    dci: inferDciFromBrandNameDeterministic(trimmedBrand),
    source: 'deterministic',
  };
}

/**
 * Formats a single generic equivalent row:
 * "[Brand Name] - [Location] - [Stock]"
 */
export function formatGenericEquivalentLine(item: {
  brandName: string;
  locationDisplay: string;
  totalStock: number;
}): string {
  return `${item.brandName} - ${item.locationDisplay} - ${item.totalStock} units`;
}

/**
 * Formats the overall Generic Substitution summary message:
 * - "Generics available in stock: [Brand Name] - [Location] - [Stock]"
 * - or "No generic equivalent in stock."
 */
export function formatGenericSubstitutionSummary(
  equivalents: ReadonlyArray<{
    brandName: string;
    locationDisplay: string;
    totalStock: number;
  }>,
): string {
  if (equivalents.length === 0) {
    return 'No generic equivalent in stock.';
  }
  const formattedItems = equivalents.map((eq) => formatGenericEquivalentLine(eq)).join('; ');
  return `Generics available in stock: ${formattedItems}`;
}

/**
 * Read-only local database search for in-stock generic equivalents (same active molecule / generic_name,
 * different brand_name, total_stock > 0).
 *
 * Does NOT modify the medication catalog or stock.
 */
export async function findGenericEquivalentsInStock(
  db: DatabasePort,
  input: {
    medicationId: number;
    brandName: string;
    genericName: string | null | undefined;
  },
  options?: {
    inferDciFn?: DciInferenceFunction;
  },
): Promise<GenericSubstitutionResult> {
  const sourceBrandName = input.brandName.trim();
  const trimmedGeneric = typeof input.genericName === 'string' ? input.genericName.trim() : '';
  const rawGeneric =
    trimmedGeneric.length > 0 &&
    trimmedGeneric.toLowerCase() !== 'standard' &&
    trimmedGeneric.toLowerCase() !== sourceBrandName.toLowerCase()
      ? trimmedGeneric
      : null;

  let resolvedGenericName: string | null = rawGeneric;
  let inferredByAi = false;

  if (!resolvedGenericName) {
    const inferFn = options?.inferDciFn ?? inferDciWithAiAssistant;
    const inference = await inferFn(sourceBrandName);
    if (inference.dci && inference.dci.trim().length > 0) {
      resolvedGenericName = inference.dci.trim();
      inferredByAi = true;
    }
  }

  if (!resolvedGenericName) {
    return {
      sourceMedicationId: input.medicationId,
      sourceBrandName,
      sourceGenericName: rawGeneric,
      resolvedGenericName: null,
      inferredByAi,
      equivalents: [],
      summaryText: 'No generic equivalent in stock.',
    };
  }

  const baseNormalized = normalizeMoleculeForMatch(resolvedGenericName);

  // Query all medications with positive total stock and different brand_name
  // where generic_name matches (exact or normalized active molecule).
  const candidateRows = await db.query<{
    id: number;
    brand_name: string;
    generic_name: string | null;
    strength: string | null;
    dosage_form: string | null;
    zone: string | null;
    shelf: string | null;
    bin: string | null;
    unit_price_cents: number | null;
    currency: string | null;
    currency_code: string | null;
    total_stock: number;
  }>(
    `SELECT
       m.id,
       m.brand_name,
       m.generic_name,
       m.strength,
       m.dosage_form,
       m.zone,
       m.shelf,
       m.bin,
       m.unit_price_cents,
       m.currency,
       m.currency_code,
       COALESCE(SUM(b.quantity), 0) AS total_stock
     FROM medication m
     LEFT JOIN batch b ON b.medication_id = m.id
     WHERE m.id != ?
       AND COALESCE(m.is_archived, 0) = 0
       AND LOWER(TRIM(m.brand_name)) != LOWER(TRIM(?))
       AND m.generic_name IS NOT NULL
       AND TRIM(m.generic_name) != ''
       AND (
         LOWER(TRIM(m.generic_name)) = LOWER(TRIM(?))
         OR LOWER(TRIM(m.generic_name)) LIKE '%' || LOWER(TRIM(?)) || '%'
         OR LOWER(TRIM(?)) LIKE '%' || LOWER(TRIM(m.generic_name)) || '%'
       )
     GROUP BY m.id
     HAVING COALESCE(SUM(b.quantity), 0) > 0
     ORDER BY total_stock DESC, m.brand_name ASC`,
    [
      input.medicationId,
      sourceBrandName,
      resolvedGenericName,
      baseNormalized || resolvedGenericName,
      resolvedGenericName,
    ],
  );

  const equivalents: GenericEquivalentItem[] = [];

  for (const row of candidateRows) {
    const candidateGeneric = row.generic_name ? String(row.generic_name).trim() : '';
    if (!areGenericMoleculesEquivalent(candidateGeneric, resolvedGenericName)) {
      continue;
    }

    const totalStock = Number(row.total_stock ?? 0);
    if (totalStock <= 0) {
      continue;
    }

    const brandName = String(row.brand_name);
    const locationDisplay = formatLocationString({
      zone: row.zone === null || row.zone === undefined ? null : String(row.zone),
      shelf: row.shelf === null || row.shelf === undefined ? null : String(row.shelf),
      bin: row.bin === null || row.bin === undefined ? null : String(row.bin),
    });

    const formattedLine = formatGenericEquivalentLine({
      brandName,
      locationDisplay,
      totalStock,
    });

    equivalents.push({
      medicationId: Number(row.id),
      brandName,
      genericName: candidateGeneric,
      strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
      dosageForm:
        row.dosage_form === null || row.dosage_form === undefined ? null : String(row.dosage_form),
      locationDisplay,
      totalStock,
      unitPriceCents:
        row.unit_price_cents === null || row.unit_price_cents === undefined
          ? null
          : Number(row.unit_price_cents),
      currency:
        row.currency_code !== null && row.currency_code !== undefined
          ? String(row.currency_code)
          : row.currency !== null && row.currency !== undefined
            ? String(row.currency)
            : 'DZD',
      formattedLine,
    });
  }

  return {
    sourceMedicationId: input.medicationId,
    sourceBrandName,
    sourceGenericName: rawGeneric,
    resolvedGenericName,
    inferredByAi,
    equivalents,
    summaryText: formatGenericSubstitutionSummary(equivalents),
  };
}
