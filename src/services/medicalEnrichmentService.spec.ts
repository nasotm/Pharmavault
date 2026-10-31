import { describe, expect, it, vi } from 'vitest';
import {
  fetchFromOpenFDA,
  fetchInteractionsFromRxNorm,
} from './medicalEnrichmentService';
import * as rxnormService from './rxnormService';

describe('medicalEnrichmentService', () => {
  it('fetchFromOpenFDA queries openfda.generic_name:"{genericName}" and extracts required fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            indications_and_usage: ['Treatment of infections caused by susceptible strains.'],
            dosage_and_administration: ['Adults: 500 mg every 8 hours or 875 mg every 12 hours.'],
            warnings: ['Serious and occasionally fatal hypersensitivity reactions reported.'],
            adverse_reactions: ['Nausea, vomiting, diarrhea, and skin rash.'],
          },
        ],
      }),
    } as Response);

    const result = await fetchFromOpenFDA('amoxicillin');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://api.fda.gov/drug/label.json?search=openfda.generic_name:"amoxicillin"'),
      { mode: 'cors' },
    );
    expect(result).not.toBeNull();
    expect(result?.indications).toBe('Treatment of infections caused by susceptible strains.');
    expect(result?.dosage_and_administration).toBe('Adults: 500 mg every 8 hours or 875 mg every 12 hours.');
    expect(result?.warnings).toBe('Serious and occasionally fatal hypersensitivity reactions reported.');
    expect(result?.adverse_reactions).toBe('Nausea, vomiting, diarrhea, and skin rash.');
  });

  it('fetchFromOpenFDA returns null when molecule is not found or API returns 404 (offline fallback)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'No matches found' } }),
    } as Response);

    const result = await fetchFromOpenFDA('unknown-molecule-xyz');
    expect(result).toBeNull();
  });

  it('fetchFromOpenFDA returns null and does not throw on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await fetchFromOpenFDA('amoxicillin');
    expect(result).toBeNull();
  });

  it('fetchFromOpenFDA returns null when genericName is empty', async () => {
    const result = await fetchFromOpenFDA('   ');
    expect(result).toBeNull();
  });

  it('fetchInteractionsFromRxNorm queries RxNorm to get RXCUI and fetches interactions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        idGroup: {
          rxnormId: ['723'],
        },
      }),
    } as Response);

    const mockInteractions: rxnormService.RxNormInteractionInfo[] = [
      {
        interactionDrug: 'Methotrexate',
        severity: 'high',
        description: 'Penicillins may reduce the excretion of methotrexate.',
      },
    ];

    vi.spyOn(rxnormService, 'getDrugInteractions').mockResolvedValueOnce(mockInteractions);

    const interactions = await fetchInteractionsFromRxNorm('amoxicillin');
    expect(interactions).toHaveLength(1);
    expect(interactions[0].interactionDrug).toBe('Methotrexate');
  });

  it('fetchInteractionsFromRxNorm returns empty array on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

    const interactions = await fetchInteractionsFromRxNorm('unknown-drug');
    expect(interactions).toEqual([]);
  });
});
