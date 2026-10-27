export interface FdaDrugLabel {
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

/**
 * Fetches full medication label from OpenFDA using the RXCUI from RxNorm.
 * Endpoint: https://api.fda.gov/drug/label.json?search=openfda.rxcui:{rxcui}
 * Returns the first matching label with: indications, dosage_and_administration, warnings, adverse_reactions.
 * Returns null if no label is found.
 */
export async function getFdaDrugLabel(rxcui: string): Promise<FdaDrugLabel | null> {
  const cleaned = rxcui?.trim();
  if (!cleaned) {
    return null;
  }

  try {
    const url = `https://api.fda.gov/drug/label.json?search=openfda.rxcui:${encodeURIComponent(cleaned)}&limit=1`;
    const res = await fetch(url);

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const label = data?.results?.[0];

    if (!label) {
      return null;
    }

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
  } catch (err) {
    console.warn('OpenFDA drug label fetch error:', err);
    return null;
  }
}
