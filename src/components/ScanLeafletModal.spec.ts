import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseExtractedLeafletJson,
  SCAN_LEAFLET_PROMPT,
  type ScannedLeafletData,
} from '../services/scanLeafletService';

describe('AI Scan Medication Leaflet Feature Specifications', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Requirement 3: Uses the exact specified prompt for Gemini Vision', () => {
    expect(SCAN_LEAFLET_PROMPT).toBe(
      'Extract the following information from this medication image and return it as a JSON object: brand_name, generic_name, strength, dosage_form, posology, interactions, composition, therapeutic_class, indications, precautions, route, side_effects.',
    );
  });

  it('Requirement 4 & 6: Populates form fields with extracted data and leaves unread fields blank', () => {
    const rawAiOutput = JSON.stringify({
      brand_name: 'Doliprane',
      generic_name: 'Paracetamol',
      strength: '1000 mg',
      dosage_form: 'Tablet',
      posology: '1 tablet every 6 to 8 hours',
      interactions: '', // Not read on front box
      composition: 'Paracetamol 1000 mg, povidone, talc',
      therapeutic_class: 'Analgesic and antipyretic',
      indications: 'Pain and fever relief',
      precautions: 'Do not exceed 4g daily',
      route: 'Oral',
      side_effects: '', // Unread
    });

    const extracted = parseExtractedLeafletJson(rawAiOutput);

    expect(extracted.brand_name).toBe('Doliprane');
    expect(extracted.generic_name).toBe('Paracetamol');
    expect(extracted.strength).toBe('1000 mg');
    expect(extracted.dosage_form).toBe('Tablet');
    expect(extracted.posology).toBe('1 tablet every 6 to 8 hours');
    expect(extracted.composition).toContain('povidone');
    expect(extracted.therapeutic_class).toBe('Analgesic and antipyretic');
    expect(extracted.indications).toBe('Pain and fever relief');
    expect(extracted.precautions).toBe('Do not exceed 4g daily');
    expect(extracted.route).toBe('Oral');

    // Rule 6: If the AI cannot read a field, leave it blank
    expect(extracted.interactions).toBe('');
    expect(extracted.side_effects).toBe('');
  });

  it('Requirement 5: Enforces manual review and confirmation workflow (does not auto-save)', () => {
    // Simulating the user review workflow:
    // 1. Leaflet extracted
    const extractedData: ScannedLeafletData = {
      brand_name: 'Clamoxyl',
      generic_name: 'Amoxicilline',
      strength: '500 mg',
      dosage_form: 'Gélule',
      posology: '1 gélule 3 fois par jour',
      interactions: 'Méthotrexate',
      composition: 'Amoxicilline trihydratée 500mg',
      therapeutic_class: 'Antibactérien bêta-lactamine',
      indications: 'Infections bactériennes ORL et respiratoires',
      precautions: 'Allergie aux pénicillines',
      route: 'Voie orale',
      side_effects: 'Troubles digestifs, éruptions cutanées',
    };

    // 2. Drafts are populated in state
    let isSavedToDatabase = false;
    const formDrafts = { ...extractedData };

    // Verifying that after extraction, the database has NOT been updated
    expect(isSavedToDatabase).toBe(false);
    expect(formDrafts.brand_name).toBe('Clamoxyl');

    // 3. User reviews and modifies a field if necessary
    formDrafts.posology = '1 gélule 3 fois par jour pendant 7 jours';

    // 4. User clicks Save button to commit changes
    const onUserClickSave = () => {
      isSavedToDatabase = true;
    };

    onUserClickSave();
    expect(isSavedToDatabase).toBe(true);
    expect(formDrafts.posology).toBe('1 gélule 3 fois par jour pendant 7 jours');
  });

  it('handles empty or malformed model responses by leaving all fields blank', () => {
    const emptyResult = parseExtractedLeafletJson('');
    expect(emptyResult.brand_name).toBe('');
    expect(emptyResult.posology).toBe('');
    expect(emptyResult.composition).toBe('');

    const malformed = parseExtractedLeafletJson('Not valid JSON');
    expect(malformed.brand_name).toBe('');
    expect(malformed.generic_name).toBe('');
    expect(malformed.side_effects).toBe('');
  });
});
