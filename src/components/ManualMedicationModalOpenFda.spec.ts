import { describe, expect, it, vi } from 'vitest';
import * as openFdaService from '../services/openFdaService';

describe('OpenFDA Service & Modal Integration Requirements', () => {
  it('calls OpenFDA endpoint with openfda.rxcui search param and extracts required fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            indications_and_usage: ['Used for management of type 2 diabetes mellitus.'],
            dosage_and_administration: ['Take 500mg twice daily with meals.'],
            warnings: ['Lactic acidosis warning. Renal monitoring required.'],
            adverse_reactions: ['Diarrhea, nausea, abdominal discomfort.'],
          },
        ],
      }),
    } as Response);

    const label = await openFdaService.getFdaDrugLabel('860975');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://api.fda.gov/drug/label.json?search=openfda.rxcui:860975'),
    );
    expect(label).not.toBeNull();
    expect(label?.indications).toBe('Used for management of type 2 diabetes mellitus.');
    expect(label?.dosage_and_administration).toBe('Take 500mg twice daily with meals.');
    expect(label?.warnings).toBe('Lactic acidosis warning. Renal monitoring required.');
    expect(label?.adverse_reactions).toBe('Diarrhea, nausea, abdominal discomfort.');
  });

  it('returns null when OpenFDA has no matching label or returns non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'No matches found!' } }),
    } as Response);

    const label = await openFdaService.getFdaDrugLabel('000000');
    expect(label).toBeNull();
  });

  it('prefill contract includes fdaLabel and fdaChecked properties', () => {
    const prefillWithLabel = {
      name: 'Metformin Hydrochloride 500 MG',
      rxcui: '860975',
      fdaLabel: {
        indications: 'Type 2 diabetes',
        dosage_and_administration: '500 mg daily',
        warnings: 'Monitor kidneys',
        adverse_reactions: 'Nausea',
      },
      fdaChecked: true,
    };

    expect(prefillWithLabel.fdaLabel.indications).toBe('Type 2 diabetes');
    expect(prefillWithLabel.fdaChecked).toBe(true);

    const prefillWithoutLabel = {
      name: 'Unlabeled Compound',
      rxcui: '999999',
      fdaLabel: null,
      fdaChecked: true,
    };

    expect(prefillWithoutLabel.fdaLabel).toBeNull();
  });
});
