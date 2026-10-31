import { getDrugInteractions, type RxNormInteractionInfo } from './rxnormService';

export interface OpenFdaMedicalInfo {
  indications: string;
  dosage_and_administration: string;
  warnings: string;
  adverse_reactions: string;
}

function extractSection(val: unknown): string {
  if (Array.isArray(val)) {
    return val.filter(Boolean).map(String).join('\n\n').trim();
  }
  if (typeof val === 'string') {
    return val.trim();
  }
  return '';
}

function parseOpenFdaLabel(label: Record<string, unknown>): OpenFdaMedicalInfo | null {
  const indications =
    extractSection(label.indications_and_usage) ||
    extractSection(label.indications);

  const dosage_and_administration =
    extractSection(label.dosage_and_administration) ||
    extractSection(label.dosage_and_administration_table);

  const warnings =
    extractSection(label.warnings) ||
    extractSection(label.warnings_and_cautions) ||
    extractSection(label.boxed_warning) ||
    extractSection(label.precautions);

  const adverse_reactions =
    extractSection(label.adverse_reactions) ||
    extractSection(label.adverse_reactions_table);

  if (!indications && !dosage_and_administration && !warnings && !adverse_reactions) {
    return null;
  }

  return {
    indications,
    dosage_and_administration,
    warnings,
    adverse_reactions,
  };
}

/**
 * Queries OpenFDA drug label API for a given generic name (DCI).
 * Endpoint: https://api.fda.gov/drug/label.json?search=openfda.generic_name:"{genericName}"
 * Returns the first result's indications, dosage_and_administration, warnings, and adverse_reactions.
 * Returns null if not found or if the network/API is unavailable (offline fallback).
 */
export async function fetchFromOpenFDA(genericName: string): Promise<OpenFdaMedicalInfo | null> {
  const cleaned = genericName?.trim();
  if (!cleaned) {
    return null;
  }

  // Sanitize double quotes and slashes for safe query string
  const cleanTerm = cleaned.replace(/["\\]/g, '');

  try {
    const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(cleanTerm)}"&limit=1`;
    const res = await fetch(url, { mode: 'cors' });

    if (!res.ok) {
      // Fallback: If generic name contains accents or multiple substances (e.g. "Paracétamol" -> "Paracetamol")
      const normalized = cleanTerm.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalized !== cleanTerm) {
        try {
          const fallbackUrl = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(normalized)}"&limit=1`;
          const fallbackRes = await fetch(fallbackUrl, { mode: 'cors' });
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            const firstResult = fallbackData?.results?.[0];
            if (firstResult && typeof firstResult === 'object') {
              return parseOpenFdaLabel(firstResult as Record<string, unknown>);
            }
          }
        } catch {
          // Ignore fallback error
        }
      }
      return null;
    }

    const data = await res.json();
    const firstResult = data?.results?.[0];
    if (!firstResult || typeof firstResult !== 'object') {
      return null;
    }

    return parseOpenFdaLabel(firstResult as Record<string, unknown>);
  } catch (err) {
    console.warn('OpenFDA enrichment error:', err);
    return null;
  }
}

/**
 * Queries RxNorm using genericName to resolve its RXCUI, then fetches drug-drug interactions.
 * Returns an array of RxNormInteractionInfo (or empty array if not found / offline).
 */
export async function fetchInteractionsFromRxNorm(
  genericName: string,
): Promise<RxNormInteractionInfo[]> {
  const cleaned = genericName?.trim();
  if (!cleaned) {
    return [];
  }

  try {
    // 1. Resolve RXCUI via RxNav REST endpoint
    let rxcui: string | null = null;
    try {
      const rxcuiUrl = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(cleaned)}`;
      const res = await fetch(rxcuiUrl, { mode: 'cors' });
      if (res.ok) {
        const data = await res.json();
        const rxnormIds = data?.idGroup?.rxnormId;
        if (Array.isArray(rxnormIds) && rxnormIds.length > 0) {
          rxcui = String(rxnormIds[0]);
        }
      }
    } catch {
      // Ignore and attempt approximateTerm fallback
    }

    // Fallback: approximateTerm lookup if direct rxcui.json returned nothing
    if (!rxcui) {
      try {
        const approxUrl = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(cleaned)}&maxEntries=1`;
        const approxRes = await fetch(approxUrl, { mode: 'cors' });
        if (approxRes.ok) {
          const approxData = await approxRes.json();
          const candidate = approxData?.approximateGroup?.candidate?.[0];
          if (candidate?.rxcui) {
            rxcui = String(candidate.rxcui);
          }
        }
      } catch {
        // Ignore fallback error
      }
    }

    if (!rxcui) {
      return [];
    }

    // 2. Fetch drug-drug interactions using the resolved RXCUI
    return await getDrugInteractions(rxcui);
  } catch (err) {
    console.warn('RxNorm interaction enrichment error:', err);
    return [];
  }
}
