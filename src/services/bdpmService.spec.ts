import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatBdpmCompositionText,
  getBdpmComposition,
  searchBdpm,
} from './bdpmService';

describe('bdpmService (French Base de Données Publique des Médicaments)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when search query is empty', async () => {
    expect(await searchBdpm('')).toEqual([]);
    expect(await searchBdpm('   ')).toEqual([]);
  });

  it('correctly maps search results from remote API response', async () => {
    const mockApiResponse = [
      { codeCIS: '60234100', denomination: 'DOLIPRANE 1000 mg, comprimé' },
      { codeCIS: '66710461', denomination: 'DOLIPRANE 500 mg, gélule' },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    } as Response);

    const results = await searchBdpm('doliprane');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      cis: '60234100',
      name: 'DOLIPRANE 1000 mg, comprimé',
    });
  });

  it('falls back to local reference catalog when API is unreachable or network throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const results = await searchBdpm('clamoxyl');
    expect(results.length).toBeGreaterThan(0);
    const clamoxyl1g = results.find((r) => r.cis === '61453272');
    expect(clamoxyl1g).toBeDefined();
    expect(clamoxyl1g?.name).toContain('CLAMOXYL 1 g');
  });

  it('fetches composition and presentations via API', async () => {
    const mockDetail = {
      codeCIS: '60234100',
      denomination: 'DOLIPRANE 1000 mg, comprimé',
      compositions: [
        {
          substanceActive: { denomination: 'Paracétamol' },
          dosage: '1000 mg',
        },
      ],
      excipients: ['Povidone', 'Talc', 'Stéarate de magnésium'],
      presentations: [
        { libelle: 'Plaquette de 8 comprimés' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockDetail,
    } as Response);

    const comp = await getBdpmComposition('60234100');
    expect(comp.cis).toBe('60234100');
    expect(comp.activeIngredients).toContain('Paracétamol (1000 mg)');
    expect(comp.excipients).toContain('Povidone');
    expect(comp.presentations).toContain('Plaquette de 8 comprimés');
    expect(comp.compositionText).toContain('Substance(s) active(s) : Paracétamol (1000 mg)');
    expect(comp.compositionText).toContain('Excipients : Povidone, Talc, Stéarate de magnésium');
  });

  it('falls back to local reference catalog when composition API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

    const comp = await getBdpmComposition('61099684'); // Spasfon
    expect(comp.cis).toBe('61099684');
    expect(comp.denomination).toContain('SPASFON');
    expect(comp.activeIngredients.some((i) => i.includes('Phloroglucinol'))).toBe(true);
    expect(comp.excipients).toContain('Lactose monohydraté');
    expect(comp.presentations.length).toBeGreaterThan(0);
  });

  it('formats composition text properly when active ingredients or excipients are provided', () => {
    const text = formatBdpmCompositionText(
      ['Amoxicilline (1000 mg)', 'Acide clavulanique (125 mg)'],
      ['Crospovidone', 'Aspartam'],
    );
    expect(text).toBe(
      'Substance(s) active(s) : Amoxicilline (1000 mg), Acide clavulanique (125 mg)\nExcipients : Crospovidone, Aspartam',
    );
  });
});
