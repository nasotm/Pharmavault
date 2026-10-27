import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFdaDrugLabel } from './openFdaService';

describe('openFdaService (getFdaDrugLabel)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for empty or whitespace rxcui', async () => {
    expect(await getFdaDrugLabel('')).toBeNull();
    expect(await getFdaDrugLabel('   ')).toBeNull();
  });

  it('successfully fetches and extracts label fields from OpenFDA response', async () => {
    const mockResponse = {
      results: [
        {
          indications_and_usage: ['Treatment of acute bacterial infections.'],
          dosage_and_administration: ['Take 500 mg orally every 8 hours with food.'],
          warnings: ['Hypersensitivity reactions may occur. Use with caution in renal failure.'],
          adverse_reactions: ['Common side effects include nausea, vomiting, and diarrhea.'],
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const label = await getFdaDrugLabel('207106');

    expect(label).not.toBeNull();
    expect(label?.indications).toBe('Treatment of acute bacterial infections.');
    expect(label?.dosage_and_administration).toBe('Take 500 mg orally every 8 hours with food.');
    expect(label?.warnings).toContain('Hypersensitivity reactions');
    expect(label?.adverse_reactions).toContain('nausea, vomiting');
  });

  it('returns null when OpenFDA returns 404 / no matches found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'No matches found!' } }),
    } as Response);

    const label = await getFdaDrugLabel('9999999');
    expect(label).toBeNull();
  });

  it('returns null when fetch rejects with a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

    const label = await getFdaDrugLabel('207106');
    expect(label).toBeNull();
  });

  it('joins multiple string entries in label fields', async () => {
    const mockResponse = {
      results: [
        {
          indications: ['Indication 1.', 'Indication 2.'],
          dosage_and_administration: ['Initial dose: 10mg.', 'Maintenance: 20mg.'],
          warnings_and_cautions: ['Warning A.', 'Warning B.'],
          adverse_reactions: ['Reaction A.'],
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const label = await getFdaDrugLabel('12345');
    expect(label).not.toBeNull();
    expect(label?.indications).toBe('Indication 1.\n\nIndication 2.');
    expect(label?.dosage_and_administration).toBe('Initial dose: 10mg.\n\nMaintenance: 20mg.');
    expect(label?.warnings).toBe('Warning A.\n\nWarning B.');
    expect(label?.adverse_reactions).toBe('Reaction A.');
  });
});
