import type { DatabasePort } from '../db/port';
import type { Medication } from '../db/repository';
import {
  searchMedications,
  type LayeredSearchResponse,
  type SearchResultItem,
} from '../search';

/**
 * Exact prompt required for Gemini Vision prescription extraction.
 */
export const SCAN_PRESCRIPTION_PROMPT =
  'Extract only the medication names and dosages from this image as a JSON array.';

export interface ExtractedPrescriptionItem {
  name: string;
  dosage: string;
}

export interface PrescriptionScanMatchResult {
  id: string;
  extractedName: string;
  extractedDosage: string;
  searchQueryUsed: string;
  matchedMedication: Medication | null;
  matchedResult: SearchResultItem | null;
  matchedLayer: LayeredSearchResponse['matchedLayer'];
  inStock: boolean;
  totalStock: number;
  locationDisplay: string;
  unitPriceDisplay: string;
  /**
   * Explicit manual confirmation flag.
   * Always starts as `false` after scanning; must be manually confirmed by the user
   * before the item can be added to the cart or dispensed.
   */
  isManuallyConfirmed: boolean;
  addedToCartCount: number;
  dispensedCount: number;
}

export interface ManualConfirmationValidation {
  allowed: boolean;
  error: string | null;
}

export const SAMPLE_HANDWRITTEN_PRESCRIPTION_ITEMS: readonly ExtractedPrescriptionItem[] = [
  { name: 'Amoxil', dosage: '500 mg' },
  { name: 'Doliprane', dosage: '1000 mg' },
  { name: 'Ventolin HFA', dosage: '100 mcg/actuation' },
];

/**
 * Creates a realistic handwritten prescription SVG data URL for instant camera/upload testing.
 */
export function createSampleHandwrittenPrescriptionDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="460" viewBox="0 0 680 460">
    <rect width="680" height="460" rx="16" fill="#fffdf7" stroke="#cbd5e1" stroke-width="3"/>
    <line x1="40" y1="92" x2="640" y2="92" stroke="#0284c7" stroke-width="2"/>
    <text x="45" y="48" font-family="Georgia, serif" font-size="20" font-weight="bold" fill="#0f172a">Dr. Henri Moreau — Médecine Générale</text>
    <text x="45" y="72" font-family="Georgia, serif" font-size="13" fill="#475569">24 Rue de la République · RPPS 10003849201 · Tél: 01 42 68 55 10</text>
    <text x="515" y="52" font-family="monospace" font-size="13" fill="#334155">Date: 26/10/2026</text>
    <text x="45" y="135" font-family="Georgia, serif" font-size="28" font-weight="bold" fill="#0284c7">Rx</text>
    <g font-family="'Brush Script MT', 'Comic Sans MS', cursive, serif" font-size="24" fill="#1e293b" font-style="italic">
      <text x="75" y="185">1. Amoxil 500 mg — 1 gélule x 3 / jour (7 jours)</text>
      <text x="75" y="250">2. Doliprane 1000 mg — 1 comprimé si douleur (max 3/j)</text>
      <text x="75" y="315">3. Ventolin HFA 100 mcg/actuation — 1 à 2 bouffées</text>
    </g>
    <line x1="75" y1="195" x2="580" y2="195" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4"/>
    <line x1="75" y1="260" x2="580" y2="260" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4"/>
    <line x1="75" y1="325" x2="580" y2="325" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4"/>
    <text x="440" y="395" font-family="Georgia, serif" font-size="13" fill="#64748b">Signature du médecin:</text>
    <path d="M445 422 C475 398, 505 435, 540 408 C565 392, 590 420, 615 405" fill="none" stroke="#1e3a8a" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Splits a plain string like "Amoxil 500 mg" into `{ name: "Amoxil", dosage: "500 mg" }`.
 */
function splitMedicationAndDosageString(raw: string): ExtractedPrescriptionItem | null {
  const trimmed = raw.trim().replace(/^[-*•\d.)\s]+/, '').trim();
  if (!trimmed) return null;

  const dosageRegex =
    /\b(\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|µg|ug|ml|mL|iu|IU|units\/mL|mcg\/actuation|%)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|µg|ug|ml|mL))?)\b/i;
  const match = trimmed.match(dosageRegex);
  if (match && match.index !== undefined) {
    const dosage = match[1].trim();
    const before = trimmed.slice(0, match.index).trim();
    const after = trimmed.slice(match.index + match[0].length).trim();
    const name = (before || after || trimmed).replace(/[-–—,:]+$/, '').trim();
    return {
      name: name || trimmed,
      dosage,
    };
  }

  return {
    name: trimmed,
    dosage: 'As prescribed',
  };
}

/**
 * Parses and normalizes the JSON array returned by Gemini Vision into structured
 * `{ name, dosage }` items.
 */
export function parseExtractedPrescriptionJson(rawInput: unknown): ExtractedPrescriptionItem[] {
  let parsed: unknown = rawInput;

  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) return [];

    // Strip optional markdown code fences if present
    const stripped = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      parsed = JSON.parse(stripped);
    } catch {
      // Attempt to extract a JSON array substring [...]
      const startIdx = stripped.indexOf('[');
      const endIdx = stripped.lastIndexOf(']');
      if (startIdx !== -1 && endIdx > startIdx) {
        try {
          parsed = JSON.parse(stripped.slice(startIdx, endIdx + 1));
        } catch {
          return [];
        }
      } else {
        return [];
      }
    }
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as Record<string, unknown>).medications)
  ) {
    parsed = (parsed as Record<string, unknown>).medications;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as Record<string, unknown>).items)
  ) {
    parsed = (parsed as Record<string, unknown>).items;
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalized: ExtractedPrescriptionItem[] = [];

  for (const entry of parsed) {
    if (typeof entry === 'string') {
      const split = splitMedicationAndDosageString(entry);
      if (split && split.name) {
        normalized.push(split);
      }
      continue;
    }

    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const rawName =
        obj.name ??
        obj.medication ??
        obj.medication_name ??
        obj.medicationName ??
        obj.brand_name ??
        obj.brandName ??
        obj.drug ??
        '';
      const rawDosage =
        obj.dosage ??
        obj.strength ??
        obj.dose ??
        obj.dosage_strength ??
        '';

      const name = String(rawName ?? '').trim();
      const dosage = String(rawDosage ?? '').trim();

      if (!name) continue;

      if (!dosage) {
        const split = splitMedicationAndDosageString(name);
        if (split) {
          normalized.push(split);
        }
      } else {
        normalized.push({
          name,
          dosage,
        });
      }
    }
  }

  return normalized;
}

function normalizeStrengthComparison(val: string | null | undefined): string {
  return String(val ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Automatically runs the existing `searchMedications` function for each extracted
 * medication to determine if it is in stock and its exact shelf/bin location.
 *
 * All returned items have `isManuallyConfirmed: false` so nothing is added to cart
 * or dispensed without explicit pharmacist confirmation.
 */
export async function matchExtractedPrescriptionWithCatalog(
  db: DatabasePort,
  extractedItems: readonly ExtractedPrescriptionItem[],
): Promise<PrescriptionScanMatchResult[]> {
  const results: PrescriptionScanMatchResult[] = [];

  for (let i = 0; i < extractedItems.length; i++) {
    const item = extractedItems[i];
    const cleanName = item.name.trim();
    const cleanDosage = item.dosage.trim();
    const combinedQuery =
      cleanDosage && cleanDosage.toLowerCase() !== 'as prescribed'
        ? `${cleanName} ${cleanDosage}`.trim()
        : cleanName;

    // 1. Run existing searchMedications on the medication name (primary brand/generic/alias index)
    let searchRes = await searchMedications(db, cleanName);
    let queryUsed = cleanName;

    // 2. If name alone returned 0 results and we have a combined query, try combined query
    if (searchRes.results.length === 0 && combinedQuery !== cleanName) {
      const combinedRes = await searchMedications(db, combinedQuery);
      if (combinedRes.results.length > 0) {
        searchRes = combinedRes;
        queryUsed = combinedQuery;
      }
    }

    // 3. If name alone returned no results and has multiple words (e.g. "Amoxil Capsule"), try first token
    if (searchRes.results.length === 0 && cleanName.includes(' ')) {
      const firstToken = cleanName.split(/\s+/)[0];
      if (firstToken && firstToken.length >= 3) {
        const tokenRes = await searchMedications(db, firstToken);
        if (tokenRes.results.length > 0) {
          searchRes = tokenRes;
          queryUsed = firstToken;
        }
      }
    }

    let bestMatch: SearchResultItem | null = null;
    if (searchRes.results.length > 0) {
      const targetDosageNorm = normalizeStrengthComparison(cleanDosage);
      if (targetDosageNorm) {
        const exactStrengthCandidate = searchRes.results.find((candidate) => {
          const medStrengthNorm = normalizeStrengthComparison(candidate.medication.strength);
          return (
            medStrengthNorm.length > 0 &&
            (medStrengthNorm.includes(targetDosageNorm) ||
              targetDosageNorm.includes(medStrengthNorm))
          );
        });
        bestMatch = exactStrengthCandidate ?? searchRes.results[0];
      } else {
        bestMatch = searchRes.results[0];
      }
    }

    results.push({
      id: `rx-item-${i}`,
      extractedName: cleanName,
      extractedDosage: cleanDosage || '—',
      searchQueryUsed: queryUsed,
      matchedMedication: bestMatch ? bestMatch.medication : null,
      matchedResult: bestMatch,
      matchedLayer: searchRes.matchedLayer,
      inStock: bestMatch ? bestMatch.totalStock > 0 : false,
      totalStock: bestMatch ? bestMatch.totalStock : 0,
      locationDisplay: bestMatch ? bestMatch.locationDisplay : 'Not found in catalog',
      unitPriceDisplay: bestMatch ? bestMatch.unitPriceDisplay : '—',
      isManuallyConfirmed: false,
      addedToCartCount: 0,
      dispensedCount: 0,
    });
  }

  return results;
}

/**
 * Toggles or sets the manual confirmation state for a single extracted prescription row.
 */
export function togglePrescriptionItemConfirmation(
  items: readonly PrescriptionScanMatchResult[],
  itemId: string,
  nextConfirmed?: boolean,
): PrescriptionScanMatchResult[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    if (!item.matchedMedication) {
      return { ...item, isManuallyConfirmed: false };
    }
    const targetState =
      nextConfirmed !== undefined ? nextConfirmed : !item.isManuallyConfirmed;
    return {
      ...item,
      isManuallyConfirmed: targetState,
    };
  });
}

/**
 * Enforces manual user confirmation before any cart addition or stock dispensing can occur.
 */
export function validateManualConfirmationBeforeAction(
  item: PrescriptionScanMatchResult | null | undefined,
  actionType: 'cart' | 'dispense',
): ManualConfirmationValidation {
  if (!item) {
    return {
      allowed: false,
      error: 'Prescription item not found.',
    };
  }
  if (!item.matchedMedication) {
    return {
      allowed: false,
      error: `"${item.extractedName}" is not matched to a catalog medication.`,
    };
  }
  if (!item.isManuallyConfirmed) {
    return {
      allowed: false,
      error: `Manual confirmation required before "${item.matchedMedication.brand_name}" can be ${
        actionType === 'cart' ? 'added to the cart' : 'dispensed'
      }.`,
    };
  }
  if (actionType === 'dispense' && (!item.inStock || item.totalStock <= 0)) {
    return {
      allowed: false,
      error: `"${item.matchedMedication.brand_name}" is currently out of stock (0 units).`,
    };
  }
  return {
    allowed: true,
    error: null,
  };
}
