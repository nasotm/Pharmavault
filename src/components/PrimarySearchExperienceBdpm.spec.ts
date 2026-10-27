import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchBdpm, getBdpmComposition, formatBdpmCompositionText } from '../services/bdpmService';
import type { ManualMedicationPrefill } from './ManualMedicationModal';

describe('BDPM (Base de Données Publique des Médicaments) Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('searches for French medications and returns valid CIS codes', async () => {
    const results = await searchBdpm('doliprane');
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top.cis).toBeDefined();
    expect(top.name.toLowerCase()).toContain('doliprane');
  });

  it('fetches full composition (active ingredients + excipients) and presentations by CIS', async () => {
    const dolipraneCis = '60234100'; // DOLIPRANE 1000 mg
    const comp = await getBdpmComposition(dolipraneCis);
    expect(comp).not.toBeNull();
    expect(comp!.activeIngredients.length).toBeGreaterThan(0);
    expect(comp!.activeIngredients.some((a) => a.toLowerCase().includes('paracétamol'))).toBe(true);
    expect(comp!.excipients.length).toBeGreaterThan(0);
    expect(comp!.presentations.length).toBeGreaterThan(0);
    expect(comp!.compositionText).toContain('Substance(s) active(s)');
    expect(comp!.compositionText).toContain('Excipients');
  });

  it('formats composition text properly without empty sections', () => {
    const text = formatBdpmCompositionText(['Amoxicilline (500 mg)'], ['Talc', 'Stéarate de magnésium']);
    expect(text).toBe(
      'Substance(s) active(s) : Amoxicilline (500 mg)\nExcipients : Talc, Stéarate de magnésium',
    );
  });

  it('correctly builds ManualMedicationPrefill with composition and presentations for pharmacist review', async () => {
    const item = { cis: '61453272', name: 'CLAMOXYL 500 mg, gélule' };
    const comp = await getBdpmComposition(item.cis);

    const prefill: ManualMedicationPrefill = {
      name: item.name,
      cis: item.cis,
      composition: comp?.compositionText || '',
      presentations: comp?.presentations || [],
      sourceType: 'bdpm',
    };

    expect(prefill.name).toBe('CLAMOXYL 500 mg, gélule');
    expect(prefill.cis).toBe('61453272');
    expect(prefill.composition).toContain('Amoxicilline');
    expect(prefill.presentations!.length).toBeGreaterThan(0);
    expect(prefill.sourceType).toBe('bdpm');
  });
});
