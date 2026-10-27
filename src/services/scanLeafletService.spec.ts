import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseExtractedLeafletJson,
  scanMedicationLeaflet,
  SCAN_LEAFLET_PROMPT,
  EMPTY_SCANNED_LEAFLET_DATA,
} from './scanLeafletService';

describe('scanLeafletService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('contains the exact user prompt required by specifications', () => {
    expect(SCAN_LEAFLET_PROMPT).toBe(
      'Extract the following information from this medication image and return it as a JSON object: brand_name, generic_name, strength, dosage_form, posology, interactions, composition, therapeutic_class, indications, precautions, route, side_effects.',
    );
  });

  it('parses valid JSON response from Gemini Vision into structured leaflet data', () => {
    const raw = JSON.stringify({
      brand_name: 'Amoxil',
      generic_name: 'Amoxicillin',
      strength: '500 mg',
      dosage_form: 'Capsule',
      posology: '1 capsule three times daily',
      interactions: 'Allopurinol, Methotrexate',
      composition: 'Amoxicilline trihydrate 500mg, magnesium stearate',
      therapeutic_class: 'Beta-lactam antibacterial',
      indications: 'Upper and lower respiratory tract infections',
      precautions: 'Penicillin hypersensitivity',
      route: 'Oral',
      side_effects: 'Nausea, diarrhea, skin rash',
    });

    const parsed = parseExtractedLeafletJson(raw);
    expect(parsed.brand_name).toBe('Amoxil');
    expect(parsed.generic_name).toBe('Amoxicillin');
    expect(parsed.strength).toBe('500 mg');
    expect(parsed.dosage_form).toBe('Capsule');
    expect(parsed.posology).toBe('1 capsule three times daily');
    expect(parsed.composition).toContain('Amoxicilline trihydrate');
    expect(parsed.route).toBe('Oral');
    expect(parsed.side_effects).toContain('Nausea');
  });

  it('leaves fields blank if AI cannot read them or returns null/missing', () => {
    const partial = JSON.stringify({
      brand_name: 'Spasfon',
      strength: '80 mg',
      posology: '2 tablets as needed',
      // other fields omitted or null
      side_effects: null,
      route: undefined,
    });

    const parsed = parseExtractedLeafletJson(partial);
    expect(parsed.brand_name).toBe('Spasfon');
    expect(parsed.strength).toBe('80 mg');
    expect(parsed.posology).toBe('2 tablets as needed');
    expect(parsed.generic_name).toBe('');
    expect(parsed.dosage_form).toBe('');
    expect(parsed.interactions).toBe('');
    expect(parsed.composition).toBe('');
    expect(parsed.therapeutic_class).toBe('');
    expect(parsed.indications).toBe('');
    expect(parsed.precautions).toBe('');
    expect(parsed.route).toBe('');
    expect(parsed.side_effects).toBe('');
  });

  it('handles markdown code block wrappers gracefully', () => {
    const wrapped = '```json\n{"brand_name": "Dafalgan", "generic_name": "Paracetamol"}\n```';
    const parsed = parseExtractedLeafletJson(wrapped);
    expect(parsed.brand_name).toBe('Dafalgan');
    expect(parsed.generic_name).toBe('Paracetamol');
    expect(parsed.strength).toBe('');
  });

  it('calls /api/leaflets/scan and returns parsed data on success', async () => {
    const mockData = {
      brand_name: 'Augmentin',
      generic_name: 'Amoxicillin / Clavulanic acid',
      strength: '1g / 125mg',
      dosage_form: 'Dispersible tablet',
      posology: '1 tablet twice daily',
      interactions: '',
      composition: 'Amoxicilline, acide clavulanique',
      therapeutic_class: 'Antibiotic',
      indications: 'Bacterial sinusitis',
      precautions: '',
      route: 'Oral',
      side_effects: '',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: 'gemini-vision',
        data: mockData,
      }),
    } as Response);

    const result = await scanMedicationLeaflet('base64image...', 'image/jpeg');
    expect(result.success).toBe(true);
    expect(result.source).toBe('gemini-vision');
    expect(result.data.brand_name).toBe('Augmentin');
    expect(result.data.generic_name).toBe('Amoxicillin / Clavulanic acid');
    expect(result.data.strength).toBe('1g / 125mg');
  });

  it('handles network or server failures safely returning empty fields and error message', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    const result = await scanMedicationLeaflet('base64...');
    expect(result.success).toBe(false);
    expect(result.data).toEqual(EMPTY_SCANNED_LEAFLET_DATA);
    expect(result.error).toBe('Network offline');
  });
});
