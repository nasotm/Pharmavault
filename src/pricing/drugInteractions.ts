import type { MedicationWithAliases } from '../db/repository';

export interface DrugInteractionInputItem {
  medicationId?: number;
  brandName?: string | null;
  genericName: string | null;
  atcCode?: string | null;
}

export interface DetectedDrugInteraction {
  drugA: string;
  drugB: string;
  atcA: string | null;
  atcB: string | null;
  severity: 'major' | 'severe';
  bannerMessage: string;
  clinicalSummary: string;
  disclaimer: string;
}

export interface DrugInteractionCheckResult {
  checkedCount: number;
  has_interaction: boolean;
  warning_message: string;
  hasMajorInteraction: boolean;
  interactions: DetectedDrugInteraction[];
  primaryWarningBanner: string | null;
  disclaimer: string;
  source: 'gemini-pharmacist' | 'deterministic-clinical-rules';
}

export const AI_INTERACTION_DISCLAIMER = 'This is an AI-assisted warning, not medical advice.';
export const DRUG_INTERACTION_DISCLAIMER = 'This is an AI-assisted warning, not medical advice.';

export const DRUG_INTERACTION_SYSTEM_PROMPT = `You are a pharmacist. Analyze this list of medications: [list]. Identify any major or severe drug-drug interactions. Return a JSON object: { has_interaction: boolean, warning_message: string }.
If the local database doesn't have the generic names, infer them from the brand names.`;

/**
 * Formats the user-specified prominent red alert banner string:
 * "⚠️ Warning: Potential interaction detected. [AI warning message]. Please verify with the doctor."
 */
export function formatPotentialInteractionAlert(aiWarningMessage: string): string {
  const trimmed = (aiWarningMessage || '').trim();
  if (!trimmed) {
    return '⚠️ Warning: Potential interaction detected. Please verify with the doctor.';
  }
  const clean = trimmed.endsWith('.') ? trimmed.slice(0, -1).trim() : trimmed;
  return `⚠️ Warning: Potential interaction detected. ${clean}. Please verify with the doctor.`;
}

/**
 * Formats the deterministic red alert banner string:
 * "Warning: Potential interaction between [Drug A] and [Drug B]. Please verify."
 */
export function formatInteractionBannerMessage(drugA: string, drugB: string): string {
  const cleanA = drugA.trim() || 'Drug A';
  const cleanB = drugB.trim() || 'Drug B';
  return `Warning: Potential interaction between ${cleanA} and ${cleanB}. Please verify.`;
}

/**
 * Ensures the disclaimer explicitly states that this is an AI-assisted warning and not medical advice.
 */
export function ensureDisclaimerPresent(rawDisclaimer?: string | null): string {
  const trimmed = (rawDisclaimer ?? '').trim();
  if (
    trimmed &&
    /\bwarning\b/i.test(trimmed) &&
    /\bnot\s+medical\s+advice\b/i.test(trimmed)
  ) {
    return trimmed;
  }
  return AI_INTERACTION_DISCLAIMER;
}

/**
 * Resolves a human-readable display name for a drug in an interaction pair,
 * preferring the generic name (e.g. "Warfarin", "Aspirin") when available.
 */
export function resolveDrugDisplayName(item: DrugInteractionInputItem): string {
  const generic = item.genericName?.trim() ?? '';
  const brand = item.brandName?.trim() ?? '';
  if (generic) {
    // Keep concise clinical name (e.g., "Acetylsalicylic Acid (Aspirin)" -> "Aspirin" if matched)
    if (/\bwarfarin\b/i.test(generic)) return 'Warfarin';
    if (/\baspirin\b|\bacetylsalicylic\b/i.test(generic)) return 'Aspirin';
    return generic;
  }
  return brand || 'Unknown Medication';
}

interface ClinicalInteractionRule {
  id: string;
  severity: 'major' | 'severe';
  matchesDrug1: (text: string, atc: string) => boolean;
  matchesDrug2: (text: string, atc: string) => boolean;
  preferredLabel1?: string;
  preferredLabel2?: string;
  clinicalSummary: string;
}

const CLINICAL_INTERACTION_RULES: readonly ClinicalInteractionRule[] = [
  {
    id: 'warfarin_aspirin_nsaid',
    severity: 'severe',
    matchesDrug1: (text, atc) =>
      /\b(warfarin|coumadin|acenocoumarol)\b/i.test(text) || atc.startsWith('B01AA'),
    matchesDrug2: (text, atc) =>
      /\b(aspirin|acetylsalicylic|ibuprofen|naproxen|diclofenac|meloxicam|ketoprofen|celecoxib)\b/i.test(
        text,
      ) ||
      atc.startsWith('B01AC06') ||
      atc.startsWith('N02BA') ||
      atc.startsWith('M01A'),
    clinicalSummary:
      'Concurrent use of an oral anticoagulant (Warfarin) with Aspirin or NSAIDs markedly increases the risk of severe gastrointestinal and systemic bleeding.',
  },
  {
    id: 'maoi_ssri',
    severity: 'severe',
    matchesDrug1: (text, atc) =>
      /\b(maoi|phenelzine|nardil|tranylcypromine|parnate|isocarboxazid|selegiline|rasagiline|moclobemide|linezolid)\b/i.test(
        text,
      ) ||
      atc.startsWith('N06AF') ||
      atc.startsWith('N06AG') ||
      atc.startsWith('N04BD'),
    matchesDrug2: (text, atc) =>
      /\b(ssri|fluoxetine|prozac|sertraline|zoloft|paroxetine|paxil|citalopram|escitalopram|lexapro|fluvoxamine|venlafaxine|duloxetine)\b/i.test(
        text,
      ) ||
      atc.startsWith('N06AB') ||
      atc.startsWith('N06AX16') ||
      atc.startsWith('N06AX21'),
    clinicalSummary:
      'Contraindicated combination (MAOIs + SSRIs/SNRIs): high risk of life-threatening serotonin syndrome, hyperthermia, and hypertensive crisis.',
  },
  {
    id: 'warfarin_amoxicillin',
    severity: 'major',
    matchesDrug1: (text, atc) =>
      /\b(warfarin|coumadin)\b/i.test(text) || atc.startsWith('B01AA'),
    matchesDrug2: (text, atc) =>
      /\b(amoxicillin|amoxil|augmentin|ampicillin)\b/i.test(text) || atc.startsWith('J01CA'),
    clinicalSummary:
      'Broad-spectrum penicillins (Amoxicillin) may potentiate Warfarin anticoagulation and elevate INR and bleeding risk.',
  },
  {
    id: 'warfarin_paracetamol',
    severity: 'major',
    matchesDrug1: (text, atc) =>
      /\b(warfarin|coumadin)\b/i.test(text) || atc.startsWith('B01AA'),
    matchesDrug2: (text, atc) =>
      /\b(paracetamol|acetaminophen|doliprane)\b/i.test(text) || atc.startsWith('N02BE01'),
    clinicalSummary:
      'Regular or high-dose Paracetamol (Acetaminophen) alongside Warfarin can increase INR and bleeding risk; monitor coagulation closely.',
  },
  {
    id: 'betablocker_salbutamol',
    severity: 'major',
    matchesDrug1: (text, atc) =>
      /\b(propranolol|bisoprolol|carvedilol|metoprolol|atenolol|timolol|sotalol)\b/i.test(text) ||
      atc.startsWith('C07A'),
    matchesDrug2: (text, atc) =>
      /\b(salbutamol|albuterol|ventolin|terbutaline|formoterol|salmeterol)\b/i.test(text) ||
      atc.startsWith('R03AC'),
    clinicalSummary:
      'Beta-blockers may antagonize beta-2 agonist bronchodilation (Salbutamol) and provoke severe bronchospasm in patients with asthma or COPD.',
  },
  {
    id: 'statin_macrolide_fibrate',
    severity: 'severe',
    matchesDrug1: (text, atc) =>
      /\b(atorvastatin|lipitor|simvastatin|lovastatin|rosuvastatin)\b/i.test(text) ||
      atc.startsWith('C10AA'),
    matchesDrug2: (text, atc) =>
      /\b(clarithromycin|erythromycin|gemfibrozil|fenofibrate|itraconazole|ketoconazole)\b/i.test(
        text,
      ) ||
      atc.startsWith('J01FA') ||
      atc.startsWith('C10AB'),
    clinicalSummary:
      'Concurrent use inhibits statin metabolism, significantly increasing plasma statin levels and the risk of myopathy or rhabdomyolysis.',
  },
];

/**
 * Deterministically evaluates a list of cart medications (by generic name, brand name, and ATC code)
 * for common major/severe drug-drug interactions.
 */
export function evaluateDeterministicDrugInteractions(
  items: readonly DrugInteractionInputItem[],
): DrugInteractionCheckResult {
  // Deduplicate medications by normalized generic/brand/ATC key
  const uniqueItems: DrugInteractionInputItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of items) {
    const key = `${(item.genericName ?? '').trim().toLowerCase()}|${(item.brandName ?? '')
      .trim()
      .toLowerCase()}|${(item.atcCode ?? '').trim().toUpperCase()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueItems.push(item);
    }
  }

  if (uniqueItems.length < 2) {
    return {
      checkedCount: uniqueItems.length,
      has_interaction: false,
      warning_message: '',
      hasMajorInteraction: false,
      interactions: [],
      primaryWarningBanner: null,
      disclaimer: AI_INTERACTION_DISCLAIMER,
      source: 'deterministic-clinical-rules',
    };
  }

  const interactions: DetectedDrugInteraction[] = [];
  const recordedPairs = new Set<string>();

  for (let i = 0; i < uniqueItems.length; i++) {
    for (let j = i + 1; j < uniqueItems.length; j++) {
      const item1 = uniqueItems[i];
      const item2 = uniqueItems[j];

      const text1 = `${item1.genericName ?? ''} ${item1.brandName ?? ''}`.toLowerCase();
      const atc1 = (item1.atcCode ?? '').trim().toUpperCase();
      const text2 = `${item2.genericName ?? ''} ${item2.brandName ?? ''}`.toLowerCase();
      const atc2 = (item2.atcCode ?? '').trim().toUpperCase();

      for (const rule of CLINICAL_INTERACTION_RULES) {
        const forwardMatch = rule.matchesDrug1(text1, atc1) && rule.matchesDrug2(text2, atc2);
        const reverseMatch = rule.matchesDrug1(text2, atc2) && rule.matchesDrug2(text1, atc1);

        if (forwardMatch || reverseMatch) {
          const firstItem = forwardMatch ? item1 : item2;
          const secondItem = forwardMatch ? item2 : item1;
          const drugA = resolveDrugDisplayName(firstItem);
          const drugB = resolveDrugDisplayName(secondItem);
          const pairKey = [drugA.toLowerCase(), drugB.toLowerCase()].sort().join('::');

          if (!recordedPairs.has(pairKey)) {
            recordedPairs.add(pairKey);
            interactions.push({
              drugA,
              drugB,
              atcA: firstItem.atcCode ?? null,
              atcB: secondItem.atcCode ?? null,
              severity: rule.severity,
              bannerMessage: formatInteractionBannerMessage(drugA, drugB),
              clinicalSummary: rule.clinicalSummary,
              disclaimer: AI_INTERACTION_DISCLAIMER,
            });
          }
        }
      }
    }
  }

  const hasInteraction = interactions.length > 0;
  const warningMessage = hasInteraction
    ? interactions.map((it) => it.clinicalSummary).filter(Boolean).join(' ')
    : '';

  return {
    checkedCount: uniqueItems.length,
    has_interaction: hasInteraction,
    warning_message: warningMessage,
    hasMajorInteraction: hasInteraction,
    interactions,
    primaryWarningBanner: interactions[0]?.bannerMessage ?? null,
    disclaimer: AI_INTERACTION_DISCLAIMER,
    source: 'deterministic-clinical-rules',
  };
}

/**
 * Normalizes and merges AI pharmacist interaction output with deterministic clinical rules.
 */
export function normalizeAiInteractionResponse(
  items: readonly DrugInteractionInputItem[],
  rawAiPayload: {
    has_interaction?: boolean;
    warning_message?: string;
    hasMajorInteraction?: boolean;
    interactions?: Array<{
      drugA?: string;
      drugB?: string;
      severity?: string;
      clinicalSummary?: string;
    }>;
    disclaimer?: string;
  } | null,
): DrugInteractionCheckResult {
  const baseline = evaluateDeterministicDrugInteractions(items);
  if (items.length < 2) {
    return baseline;
  }

  if (!rawAiPayload) {
    return baseline;
  }

  const disclaimer = ensureDisclaimerPresent(rawAiPayload.disclaimer);

  const aiHasInteraction =
    typeof rawAiPayload.has_interaction === 'boolean'
      ? rawAiPayload.has_interaction
      : typeof rawAiPayload.hasMajorInteraction === 'boolean'
        ? rawAiPayload.hasMajorInteraction
        : undefined;

  const rawWarningMsg = (rawAiPayload.warning_message ?? '').trim();

  const merged: DetectedDrugInteraction[] = [...baseline.interactions];
  const existingKeys = new Set(
    merged.map((m) => [m.drugA.toLowerCase(), m.drugB.toLowerCase()].sort().join('::')),
  );

  if (Array.isArray(rawAiPayload.interactions)) {
    for (const candidate of rawAiPayload.interactions) {
      const drugA = String(candidate.drugA ?? '').trim();
      const drugB = String(candidate.drugB ?? '').trim();
      if (!drugA || !drugB || drugA.toLowerCase() === drugB.toLowerCase()) {
        continue;
      }
      const pairKey = [drugA.toLowerCase(), drugB.toLowerCase()].sort().join('::');
      if (existingKeys.has(pairKey)) {
        continue;
      }
      existingKeys.add(pairKey);
      merged.push({
        drugA,
        drugB,
        atcA: null,
        atcB: null,
        severity: candidate.severity === 'severe' ? 'severe' : 'major',
        bannerMessage: formatInteractionBannerMessage(drugA, drugB),
        clinicalSummary:
          String(candidate.clinicalSummary ?? '').trim() ||
          'Potential clinically significant drug-drug interaction identified.',
        disclaimer,
      });
    }
  }

  const finalHasInteraction =
    aiHasInteraction !== undefined
      ? aiHasInteraction || merged.length > 0
      : merged.length > 0;

  let finalWarningMessage = rawWarningMsg;
  if (!finalWarningMessage && merged.length > 0) {
    finalWarningMessage =
      merged.map((m) => m.clinicalSummary).filter(Boolean).join(' ') ||
      `${merged[0].drugA} interacts with ${merged[0].drugB}.`;
  } else if (!finalWarningMessage && baseline.warning_message) {
    finalWarningMessage = baseline.warning_message;
  }

  return {
    checkedCount: baseline.checkedCount,
    has_interaction: finalHasInteraction,
    warning_message: finalHasInteraction ? finalWarningMessage : '',
    hasMajorInteraction: finalHasInteraction,
    interactions: merged,
    primaryWarningBanner: merged[0]?.bannerMessage ?? null,
    disclaimer,
    source: 'gemini-pharmacist',
  };
}

/**
 * Sends the cart's generic names and ATC codes to the background AI pharmacist endpoint
 * (`/api/ai/drug-interactions`) when 2 or more medications are in the calculator cart.
 */
export async function checkCartDrugInteractions(
  items: readonly DrugInteractionInputItem[],
  options: {
    useRemoteEndpoint?: boolean;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<DrugInteractionCheckResult> {
  const baseline = evaluateDeterministicDrugInteractions(items);
  if (baseline.checkedCount < 2) {
    return baseline;
  }

  const useRemote = options.useRemoteEndpoint ?? true;
  const fetchFn = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (useRemote && fetchFn) {
    try {
      const response = await fetchFn('/api/ai/drug-interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          medications: items.map((item) => ({
            medicationId: item.medicationId,
            brandName: item.brandName ?? '',
            genericName: item.genericName,
            atcCode: item.atcCode ?? null,
          })),
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as Partial<DrugInteractionCheckResult> & {
          has_interaction?: boolean;
          warning_message?: string;
          interactions?: Array<{
            drugA?: string;
            drugB?: string;
            severity?: string;
            clinicalSummary?: string;
          }>;
        };
        if (
          data &&
          (typeof data.has_interaction === 'boolean' ||
            typeof data.hasMajorInteraction === 'boolean')
        ) {
          return normalizeAiInteractionResponse(items, data);
        }
      }
    } catch {
      // Fall back to deterministic clinical rules below
    }
  }

  return baseline;
}

/**
 * Built-in clinical reference medications available in the Calculator selector so
 * pharmacists can price and screen common interaction pairs (e.g. Warfarin + Aspirin,
 * MAOIs + SSRIs) alongside the local SQLite catalog without mutating database tables.
 */
export const CALCULATOR_INTERACTION_REFERENCE_MEDICATIONS: readonly MedicationWithAliases[] = [
  {
    id: 9001,
    brand_name: 'Coumadin (Warfarin)',
    generic_name: 'Warfarin',
    strength: '5 mg',
    dosage_form: 'Tablet',
    category: 'Anticoagulant',
    atc_code: 'B01AA03',
    manufacturer: 'Bristol Myers Squibb',
    barcode: '0300560172701',
    storage: 'Room temperature (15-25°C)',
    zone: 'A',
    shelf: 'A2',
    bin: '03',
    location_note: 'Anticoagulant bay',
    reorder_level: 20,
    lead_time_days: 5,
    unit_price_cents: 1450,
    cost_price_cents: 900,
    currency: 'DZD',
    currency_code: 'DZD',
    units_per_pack: 30,
    price_source: 'official_tariff',
    price_confirmed: 1,
    price_updated_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    aliases: ['Warfarin Sodium 5mg', 'Coumadin 5mg'],
    alias_records: [],
  },
  {
    id: 9002,
    brand_name: 'Aspirin Cardio',
    generic_name: 'Aspirin',
    strength: '100 mg',
    dosage_form: 'Enteric-Coated Tablet',
    category: 'Antiplatelet / NSAID',
    atc_code: 'B01AC06',
    manufacturer: 'Bayer Healthcare',
    barcode: '4008500012345',
    storage: 'Room temperature (15-25°C)',
    zone: 'A',
    shelf: 'A2',
    bin: '04',
    location_note: 'Cardiovascular / antiplatelet bay',
    reorder_level: 30,
    lead_time_days: 5,
    unit_price_cents: 650,
    cost_price_cents: 380,
    currency: 'DZD',
    currency_code: 'DZD',
    units_per_pack: 28,
    price_source: 'official_tariff',
    price_confirmed: 1,
    price_updated_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    aliases: ['Acetylsalicylic Acid 100mg', 'ASA 100mg'],
    alias_records: [],
  },
  {
    id: 9003,
    brand_name: 'Nardil (Phenelzine)',
    generic_name: 'Phenelzine (MAOI)',
    strength: '15 mg',
    dosage_form: 'Film-Coated Tablet',
    category: 'Antidepressant (MAOI)',
    atc_code: 'N06AF03',
    manufacturer: 'Pfizer',
    barcode: '0300710400150',
    storage: 'Refrigerated or cool dry place',
    zone: 'B',
    shelf: 'B3',
    bin: '07',
    location_note: 'CNS / MAOI section',
    reorder_level: 10,
    lead_time_days: 7,
    unit_price_cents: 3200,
    cost_price_cents: 2100,
    currency: 'DZD',
    currency_code: 'DZD',
    units_per_pack: 60,
    price_source: 'official_tariff',
    price_confirmed: 1,
    price_updated_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    aliases: ['Phenelzine Sulfate', 'MAOI Antidepressant'],
    alias_records: [],
  },
  {
    id: 9004,
    brand_name: 'Prozac (Fluoxetine)',
    generic_name: 'Fluoxetine (SSRI)',
    strength: '20 mg',
    dosage_form: 'Capsule',
    category: 'Antidepressant (SSRI)',
    atc_code: 'N06AB03',
    manufacturer: 'Eli Lilly',
    barcode: '0300023107304',
    storage: 'Room temperature (15-25°C)',
    zone: 'B',
    shelf: 'B3',
    bin: '08',
    location_note: 'CNS / SSRI section',
    reorder_level: 25,
    lead_time_days: 5,
    unit_price_cents: 1950,
    cost_price_cents: 1200,
    currency: 'DZD',
    currency_code: 'DZD',
    units_per_pack: 30,
    price_source: 'official_tariff',
    price_confirmed: 1,
    price_updated_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    aliases: ['Fluoxetine HCl 20mg', 'SSRI Antidepressant'],
    alias_records: [],
  },
];
