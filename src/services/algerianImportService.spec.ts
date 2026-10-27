import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  enrichAlgerianMedicationRow,
  hasIncompleteMedicalData,
  normalizeDciQuery,
  parseAlgerianMedicationCsv,
  SAMPLE_ALGERIAN_CSV,
} from './algerianImportService';
import * as rxnormService from './rxnormService';
import * as openFdaService from './openFdaService';
import type { Medication } from '../db/repository';

describe('Algerian Medication Import Service (algerianImportService)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseAlgerianMedicationCsv', () => {
    it('parses SAMPLE_ALGERIAN_CSV correctly into 6 rows', () => {
      const rows = parseAlgerianMedicationCsv(SAMPLE_ALGERIAN_CSV);
      expect(rows).toHaveLength(6);

      const first = rows[0];
      expect(first.commercial_name).toBe('Amoxil');
      expect(first.dci).toBe('Amoxicilline');
      expect(first.strength).toBe('500 mg');
      expect(first.dosage_form).toBe('Gélule');
      expect(first.laboratory).toBe('GSK');
      expect(first.ppa_da).toBe(350);

      const second = rows[1];
      expect(second.commercial_name).toBe('Doliprane');
      expect(second.dci).toBe('Paracétamol');
      expect(second.ppa_da).toBe(180);
    });

    it('returns empty array for empty or single-header CSV', () => {
      expect(parseAlgerianMedicationCsv('')).toEqual([]);
      expect(parseAlgerianMedicationCsv('   ')).toEqual([]);
      expect(
        parseAlgerianMedicationCsv('commercial_name,dci,strength,dosage_form,laboratory,ppa_da'),
      ).toEqual([]);
    });

    it('handles alternative French column headers and semicolon delimiters', () => {
      const csv = `nom_commercial;molecule;dosage;forme;labo;prix
Clamoxyl;Amoxicilline;1 g;Comprimé;Glaxo;420,50`;
      const rows = parseAlgerianMedicationCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].commercial_name).toBe('Clamoxyl');
      expect(rows[0].dci).toBe('Amoxicilline');
      expect(rows[0].strength).toBe('1 g');
      expect(rows[0].dosage_form).toBe('Comprimé');
      expect(rows[0].laboratory).toBe('Glaxo');
      expect(rows[0].ppa_da).toBe(420.5);
    });
  });

  describe('normalizeDciQuery', () => {
    it('generates unaccented and INN English variants', () => {
      const amoxVariants = normalizeDciQuery('Amoxicilline');
      expect(amoxVariants).toContain('Amoxicilline');
      expect(amoxVariants).toContain('Amoxicillin');

      const paraVariants = normalizeDciQuery('Paracétamol');
      expect(paraVariants).toContain('Paracetamol');
      expect(paraVariants).toContain('Acetaminophen');
    });
  });

  describe('enrichAlgerianMedicationRow', () => {
    it('automatically queries searchGlobalDrug(dci) and fetches OpenFDA label when found', async () => {
      vi.spyOn(rxnormService, 'searchGlobalDrug').mockResolvedValueOnce([
        { rxcui: '723', name: 'amoxicillin' },
      ]);
      vi.spyOn(openFdaService, 'getFdaDrugLabel').mockResolvedValueOnce({
        indications: 'Treatment of bacterial infections.',
        dosage_and_administration: '500 mg every 8 hours.',
        warnings: 'Contraindicated in penicillin allergy.',
        adverse_reactions: 'Nausea, diarrhea, rash.',
      });

      const row = {
        commercial_name: 'Amoxil',
        dci: 'Amoxicilline',
        strength: '500 mg',
        dosage_form: 'Gélule',
        laboratory: 'GSK',
        ppa_da: 350,
        raw_ppa_da: '350',
      };

      const result = await enrichAlgerianMedicationRow(row, 1);

      expect(result.rowNumber).toBe(1);
      expect(result.commercial_name).toBe('Amoxil');
      expect(result.rxcui).toBe('723');
      expect(result.status).toBe('found_with_label');
      expect(result.unit_price_cents).toBe(35000);
      expect(result.medicalData?.indications).toBe('Treatment of bacterial infections.');
      expect(result.medicalData?.posology).toBe('500 mg every 8 hours.');
      expect(result.medicalData?.precautions).toBe('Contraindicated in penicillin allergy.');
      expect(result.medicalData?.side_effects).toBe('Nausea, diarrhea, rash.');
      expect(result.hasIncompleteMedicalData).toBe(false);
    });

    it('leaves medical data blank and marks incomplete when OpenFDA has no label', async () => {
      vi.spyOn(rxnormService, 'searchGlobalDrug').mockResolvedValueOnce([
        { rxcui: '99999', name: 'Some Drug' },
      ]);
      vi.spyOn(openFdaService, 'getFdaDrugLabel').mockResolvedValueOnce(null);

      const row = {
        commercial_name: 'Spasfon',
        dci: 'Phloroglucinol',
        strength: '80 mg',
        dosage_form: 'Lyophilisat',
        laboratory: 'Teva',
        ppa_da: 280,
        raw_ppa_da: '280',
      };

      const result = await enrichAlgerianMedicationRow(row, 2);

      expect(result.rxcui).toBe('99999');
      expect(result.status).toBe('found_no_label');
      expect(result.medicalData).toBeNull();
      expect(result.hasIncompleteMedicalData).toBe(true);
    });

    it('leaves medical data blank when DCI is not found in RxNorm', async () => {
      vi.spyOn(rxnormService, 'searchGlobalDrug').mockResolvedValue([]);

      const row = {
        commercial_name: 'Novalgine',
        dci: 'Métamizole',
        strength: '500 mg',
        dosage_form: 'Gélule',
        laboratory: 'Biopharm',
        ppa_da: 210,
        raw_ppa_da: '210',
      };

      const result = await enrichAlgerianMedicationRow(row, 3);

      expect(result.rxcui).toBeNull();
      expect(result.status).toBe('dci_not_found');
      expect(result.medicalData).toBeNull();
      expect(result.hasIncompleteMedicalData).toBe(true);
      expect(result.unit_price_cents).toBe(21000);
    });
  });

  describe('hasIncompleteMedicalData', () => {
    it('returns true if any core clinical field is empty or missing', () => {
      const incompleteMed = {
        id: 1,
        brand_name: 'Novalgine',
        generic_name: 'Métamizole',
        posology: '',
        indications: null,
        side_effects: 'Rash',
        precautions: '',
      } as unknown as Medication;

      expect(hasIncompleteMedicalData(incompleteMed)).toBe(true);
    });

    it('returns false when all core clinical fields are provided', () => {
      const completeMed = {
        id: 2,
        brand_name: 'Amoxil',
        generic_name: 'Amoxicillin',
        posology: '500 mg TID',
        indications: 'Bacterial sinusitis',
        side_effects: 'Diarrhea',
        precautions: 'Penicillin allergy',
      } as unknown as Medication;

      expect(hasIncompleteMedicalData(completeMed)).toBe(false);
    });
  });
});
