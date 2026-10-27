import { describe, expect, it, vi } from 'vitest';
import * as rxnormService from '../services/rxnormService';

describe('RxNorm Integration Contract Verification', () => {
  it('searchGlobalDrug returns structured { rxcui, name } results', async () => {
    vi.spyOn(rxnormService.rxnorm, 'drugs').mockResolvedValueOnce({
      name: 'omeprazole',
      conceptGroup: [
        {
          tty: 'SCD',
          conceptProperties: [
            { rxcui: '312041', name: 'omeprazole 20 MG Oral Capsule', tty: 'SCD' },
          ],
        },
      ],
    });

    const results = await rxnormService.searchGlobalDrug('omeprazole');
    expect(results).toHaveLength(1);
    expect(results[0].rxcui).toBe('312041');
    expect(results[0].name).toBe('omeprazole 20 MG Oral Capsule');
  });

  it('getDrugInteractions safely fetches interaction metadata without throwing', async () => {
    vi.spyOn(rxnormService.rxnorm, 'interaction').mockResolvedValueOnce([
      {
        interactionDrug: 'Clopidogrel',
        severity: 'high',
        description: 'Reduced antiplatelet efficacy when combined.',
      },
    ]);

    const interactions = await rxnormService.getDrugInteractions('312041');
    expect(interactions).toHaveLength(1);
    expect(interactions[0].interactionDrug).toBe('Clopidogrel');
    expect(interactions[0].severity).toBe('high');
  });
});
