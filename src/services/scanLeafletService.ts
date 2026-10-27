/**
 * AI Scan Medication Leaflet Service
 * Uses Gemini Vision to extract medication attributes from leaflets and packaging images.
 */

export const SCAN_LEAFLET_PROMPT =
  'Extract the following information from this medication image and return it as a JSON object: brand_name, generic_name, strength, dosage_form, posology, interactions, composition, therapeutic_class, indications, precautions, route, side_effects.';

export interface ScannedLeafletData {
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form: string;
  posology: string;
  interactions: string;
  composition: string;
  therapeutic_class: string;
  indications: string;
  precautions: string;
  route: string;
  side_effects: string;
}

export const EMPTY_SCANNED_LEAFLET_DATA: ScannedLeafletData = {
  brand_name: '',
  generic_name: '',
  strength: '',
  dosage_form: '',
  posology: '',
  interactions: '',
  composition: '',
  therapeutic_class: '',
  indications: '',
  precautions: '',
  route: '',
  side_effects: '',
};

export const SAMPLE_FALLBACK_LEAFLET_DATA: ScannedLeafletData = {
  brand_name: 'Amoxil',
  generic_name: 'Amoxicillin',
  strength: '500 mg',
  dosage_form: 'Capsule',
  posology: 'Adults: 500 mg to 1000 mg every 8 hours. Oral route. Swallow whole with water.',
  interactions: '', // unread/unmentioned field left blank
  composition: 'Active: Amoxicillin trihydrate eq. 500 mg amoxicillin. Excipients: Magnesium stearate, microcrystalline cellulose, gelatin, titanium dioxide.',
  therapeutic_class: 'Beta-lactam antibiotic',
  indications: 'Treatment of acute bacterial infections: sinusitis, otitis media, community-acquired pneumonia.',
  precautions: 'Contraindicated in patients with known hypersensitivity to beta-lactam antibiotics (penicillins).',
  route: 'Oral route',
  side_effects: 'Common: Diarrhea, nausea, skin rash, pruritus. Discontinue if allergic reaction occurs.',
};

/**
 * Parses and sanitizes raw JSON returned by Gemini Vision.
 * If a field cannot be read or is missing/null, leaves it blank ('').
 */
export function parseExtractedLeafletJson(rawText: string): ScannedLeafletData {
  const result: ScannedLeafletData = { ...EMPTY_SCANNED_LEAFLET_DATA };
  if (!rawText || !rawText.trim()) {
    return result;
  }

  try {
    let clean = rawText.trim();
    // Strip markdown code block wrappers if present
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object') {
      return result;
    }

    const sanitizeField = (val: unknown): string => {
      if (typeof val === 'string') return val.trim();
      if (Array.isArray(val)) {
        return val
          .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
          .filter(Boolean)
          .join('\n• ');
      }
      if (val !== null && val !== undefined && typeof val === 'object') {
        return JSON.stringify(val);
      }
      return '';
    };

    result.brand_name = sanitizeField(parsed.brand_name);
    result.generic_name = sanitizeField(parsed.generic_name);
    result.strength = sanitizeField(parsed.strength);
    result.dosage_form = sanitizeField(parsed.dosage_form);
    result.posology = sanitizeField(parsed.posology);
    result.interactions = sanitizeField(parsed.interactions);
    result.composition = sanitizeField(parsed.composition);
    result.therapeutic_class = sanitizeField(parsed.therapeutic_class);
    result.indications = sanitizeField(parsed.indications);
    result.precautions = sanitizeField(parsed.precautions);
    result.route = sanitizeField(parsed.route);
    result.side_effects = sanitizeField(parsed.side_effects);

    return result;
  } catch {
    return result;
  }
}

/**
 * Sends image data to server endpoint /api/leaflets/scan for Gemini Vision processing.
 */
export async function scanMedicationLeaflet(
  imageBase64: string,
  mimeType = 'image/png',
): Promise<{
  success: boolean;
  data: ScannedLeafletData;
  source: 'gemini-vision' | 'vision-fallback';
  error?: string;
}> {
  try {
    const res = await fetch('/api/leaflets/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageBase64,
        mimeType,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}: Failed to scan medication leaflet.`);
    }

    const json = await res.json();
    const data = parseExtractedLeafletJson(
      typeof json.data === 'string' ? json.data : JSON.stringify(json.data ?? {}),
    );

    return {
      success: true,
      data,
      source: json.source === 'gemini-vision' ? 'gemini-vision' : 'vision-fallback',
    };
  } catch (err) {
    return {
      success: false,
      data: { ...EMPTY_SCANNED_LEAFLET_DATA },
      source: 'vision-fallback',
      error: err instanceof Error ? err.message : 'Unknown error during leaflet scan.',
    };
  }
}
