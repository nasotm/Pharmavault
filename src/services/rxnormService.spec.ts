import { describe, expect, it, vi } from 'vitest';
import {
  ExtendedRxNorm,
  getDrugInteractions,
  rxnorm,
  searchGlobalDrug,
} from './rxnormService';

describe('RxNorm Service (searchGlobalDrug & getDrugInteractions)', () => {
  it('instantiates ExtendedRxNorm and exposes rxnorm singleton', () => {
    expect(rxnorm).toBeInstanceOf(ExtendedRxNorm);
    expect(typeof rxnorm.drugs).toBe('function');
    expect(typeof rxnorm.interaction).toBe('function');
  });

  it('returns empty array if search query is whitespace or empty', async () => {
    const res1 = await searchGlobalDrug('');
    const res2 = await searchGlobalDrug('   ');
    expect(res1).toEqual([]);
    expect(res2).toEqual([]);
  });

  it('correctly maps rxnorm.drugs conceptProperties to { rxcui, name } list', async () => {
    const spy = vi.spyOn(rxnorm, 'drugs').mockResolvedValueOnce({
      name: 'aspirin',
      conceptGroup: [
        {
          tty: 'SCD',
          conceptProperties: [
            { rxcui: '1191', name: 'aspirin 325 MG Oral Tablet', tty: 'SCD' },
            { rxcui: '1192', name: 'aspirin 81 MG Oral Tablet', tty: 'SCD' },
          ],
        },
      ],
    });

    const results = await searchGlobalDrug('aspirin');
    expect(spy).toHaveBeenCalledWith('aspirin');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ rxcui: '1191', name: 'aspirin 325 MG Oral Tablet' });
    expect(results[1]).toEqual({ rxcui: '1192', name: 'aspirin 81 MG Oral Tablet' });
  });

  it('falls back to approximateTerm when drugs() returns no concepts', async () => {
    vi.spyOn(rxnorm, 'drugs').mockResolvedValueOnce({
      name: 'amoxil',
      conceptGroup: [],
    });

    const approxSpy = vi.spyOn(rxnorm, 'approximateTerm').mockResolvedValueOnce([
      { rxcui: '203169', name: 'Amoxil', score: 8.5, rank: 1 },
      { rxcui: '897049', name: 'Amoxi Drop', score: 8.3, rank: 2 },
    ]);

    const results = await searchGlobalDrug('amoxil');
    expect(approxSpy).toHaveBeenCalledWith('amoxil', { maxEntries: 10 });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ rxcui: '203169', name: 'Amoxil' });
  });

  it('calls rxnorm.interaction for getDrugInteractions and returns interaction info', async () => {
    const spy = vi.spyOn(rxnorm, 'interaction').mockResolvedValueOnce([
      {
        interactionDrug: 'Warfarin',
        severity: 'high',
        description: 'Increased bleeding risk when taken together.',
      },
    ]);

    const interactions = await getDrugInteractions('1191');
    expect(spy).toHaveBeenCalledWith('1191');
    expect(interactions).toHaveLength(1);
    expect(interactions[0].interactionDrug).toBe('Warfarin');
  });

  it('returns empty array when interaction fails or encounters network error', async () => {
    vi.spyOn(rxnorm, 'interaction').mockRejectedValueOnce(new Error('Network error'));
    const interactions = await getDrugInteractions('999999');
    expect(interactions).toEqual([]);
  });
});
