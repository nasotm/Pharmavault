import { RxNorm } from '@ncbijs/rxnorm';

export interface RxNormSearchResult {
  rxcui: string;
  name: string;
}

export interface RxNormInteractionInfo {
  interactionDrug: string;
  severity?: string;
  description: string;
}

/**
 * Extended RxNorm class that wraps @ncbijs/rxnorm and adds drug interaction lookup.
 */
export class ExtendedRxNorm extends RxNorm {
  /**
   * Calls RxNav interaction endpoint for a specific RxCUI.
   */
  async interaction(rxcui: string): Promise<RxNormInteractionInfo[]> {
    if (!rxcui || !rxcui.trim()) {
      return [];
    }
    try {
      const url = `https://rxnav.nlm.nih.gov/REST/interaction/interaction.json?rxcui=${encodeURIComponent(
        rxcui.trim(),
      )}`;
      const res = await fetch(url);
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      const typeGroups = data?.interactionTypeGroup ?? [];
      const interactions: RxNormInteractionInfo[] = [];

      for (const group of typeGroups) {
        for (const it of group.interactionType ?? []) {
          for (const pair of it.interactionPair ?? []) {
            const secondDrug =
              pair.interactionConcept?.[1]?.minConceptItem?.name ||
              pair.interactionConcept?.[0]?.minConceptItem?.name ||
              'Interacting agent';
            interactions.push({
              interactionDrug: secondDrug,
              severity: pair.severity ?? 'N/A',
              description: pair.description ?? '',
            });
          }
        }
      }
      return interactions;
    } catch {
      return [];
    }
  }
}

/**
 * Singleton instance of RxNorm client for global drug queries.
 */
export const rxnorm = new ExtendedRxNorm();

/**
 * Searches the global RxNorm database using @ncbijs/rxnorm.
 * 1. Calls rxnorm.drugs(query) to find matching drugs.
 * 2. Returns a list of { rxcui, name } for display.
 * 3. Falls back to approximateTerm if drugs() returns empty for brand names (e.g. Lipitor, Amoxil).
 */
export async function searchGlobalDrug(query: string): Promise<RxNormSearchResult[]> {
  const cleaned = query.trim();
  if (!cleaned) {
    return [];
  }

  const results: RxNormSearchResult[] = [];
  const seenRxcuis = new Set<string>();

  try {
    // 1. Primary lookup via rxnorm.drugs(query)
    const drugGroup = await rxnorm.drugs(cleaned);
    const groups = drugGroup.conceptGroup ?? [];

    for (const group of groups) {
      for (const concept of group.conceptProperties ?? []) {
        if (concept.rxcui && !seenRxcuis.has(concept.rxcui)) {
          seenRxcuis.add(concept.rxcui);
          results.push({
            rxcui: concept.rxcui,
            name: concept.name,
          });
        }
      }
    }

    // 2. If drugs() yielded no concepts (e.g. brand names), search approximateTerm
    if (results.length === 0) {
      const approx = await rxnorm.approximateTerm(cleaned, { maxEntries: 10 });
      for (const cand of approx) {
        if (cand.rxcui && !seenRxcuis.has(cand.rxcui) && cand.name) {
          seenRxcuis.add(cand.rxcui);
          results.push({
            rxcui: cand.rxcui,
            name: cand.name,
          });
        }
      }
    }
  } catch (err) {
    console.warn('RxNorm global search error:', err);
  }

  return results;
}

/**
 * Fetches drug-drug interactions for an RxCUI using rxnorm.interaction(rxcui).
 */
export async function getDrugInteractions(rxcui: string): Promise<RxNormInteractionInfo[]> {
  const cleaned = rxcui?.trim();
  if (!cleaned) return [];
  try {
    return await rxnorm.interaction(cleaned);
  } catch (err) {
    console.warn('RxNorm interaction error:', err);
    return [];
  }
}
