import Papa from 'papaparse';
import type { DatabasePort } from '../db/port';
import { insertMedication } from '../db/repository';

export interface AlgerianNomenclatureRow {
  brand_name?: string;
  inn?: string;
  dosage?: string;
  form?: string;
  laboratory?: string;
  [key: string]: unknown;
}

export interface AlgerianNomenclatureProgress {
  processed: number;
  total: number;
  imported: number;
  skipped: number;
  currentItem?: string;
}

export interface AlgerianNomenclatureImportResult {
  total: number;
  imported: number;
  skipped: number;
  summary: string;
}

/**
 * Extracts a field value from a row using multiple possible column names (case-insensitive).
 */
export function extractColumnValue(
  row: Record<string, unknown>,
  candidateNames: readonly string[],
): string | null {
  for (const candidate of candidateNames) {
    const val = row[candidate];
    if (val !== undefined && val !== null) {
      const str = String(val).trim();
      if (str !== '') return str;
    }
    const lowerCandidate = candidate.toLowerCase();
    for (const [key, value] of Object.entries(row)) {
      if (key.trim().toLowerCase() === lowerCandidate && value !== undefined && value !== null) {
        const str = String(value).trim();
        if (str !== '') return str;
      }
    }
  }
  return null;
}

/**
 * Parses raw CSV content using PapaParse into records.
 */
export function parseNomenclatureCsv(csvText: string): Record<string, unknown>[] {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  return parsed.data.filter((row) => row && typeof row === 'object');
}

/**
 * Imports Algerian drug nomenclature records from CSV into the SQLite database.
 * Enforces:
 * - brand_name = brand_name
 * - generic_name = inn
 * - strength = dosage
 * - dosage_form = form
 * - manufacturer = laboratory
 * - price, stock, location left NULL or empty
 * - skips duplicates (existing brand_name + dosage + form) and invalid rows
 * - yields progress updates with progress bar metrics
 */
export async function importAlgerianNomenclatureCsv(
  db: DatabasePort,
  csvContent: string,
  onProgress?: (progress: AlgerianNomenclatureProgress) => void,
): Promise<AlgerianNomenclatureImportResult> {
  const rows = parseNomenclatureCsv(csvContent);
  const total = rows.length;

  if (total === 0) {
    return {
      total: 0,
      imported: 0,
      skipped: 0,
      summary: '0 medications imported successfully, 0 skipped (duplicates or errors).',
    };
  }

  // Pre-load existing medications to detect duplicates
  const existingRows = await db.query<{
    brand_name: string;
    strength: string | null;
    dosage_form: string | null;
  }>('SELECT brand_name, strength, dosage_form FROM medication');

  const existingSet = new Set<string>();
  for (const r of existingRows) {
    const key = `${r.brand_name.trim().toLowerCase()}|${(r.strength ?? '').trim().toLowerCase()}|${(r.dosage_form ?? '').trim().toLowerCase()}`;
    existingSet.add(key);
  }

  let imported = 0;
  let skipped = 0;
  const CHUNK_SIZE = 50;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    await db.transaction(async (tx) => {
      for (const row of chunk) {
        const brandName = extractColumnValue(row, [
          'brand_name',
          'commercial_name',
          'brand',
          'nom_commercial',
          'name',
        ]);

        if (!brandName) {
          skipped++;
          continue;
        }

        const inn = extractColumnValue(row, [
          'inn',
          'dci',
          'generic_name',
          'generic',
          'molecule',
        ]);
        const dosage = extractColumnValue(row, [
          'dosage',
          'strength',
          'dosage_strength',
          'concentration',
          'dose',
        ]);
        const form = extractColumnValue(row, [
          'form',
          'dosage_form',
          'forme',
          'galenic_form',
        ]);
        const laboratory = extractColumnValue(row, [
          'laboratory',
          'manufacturer',
          'lab',
          'laboratoire',
          'titulaire',
        ]);

        const dedupeKey = `${brandName.toLowerCase()}|${(dosage ?? '').toLowerCase()}|${(form ?? '').toLowerCase()}`;

        if (existingSet.has(dedupeKey)) {
          skipped++;
          continue;
        }

        existingSet.add(dedupeKey);

        try {
          await insertMedication(tx, {
            brand_name: brandName,
            generic_name: inn ?? brandName,
            strength: dosage,
            dosage_form: form,
            manufacturer: laboratory,
            category: 'Essential',
            // CRITICAL: prices left strictly NULL (historical prices not imported)
            unit_price_cents: null,
            cost_price_cents: null,
            price_source: null,
            price_confirmed: 0,
            price_updated_at: null,
            // Location left empty for pharmacist to assign later
            zone: null,
            shelf: null,
            bin: null,
            location_note: null,
            reorder_level: 10,
            lead_time_days: 7,
            currency: 'DZD',
            currency_code: 'DZD',
            units_per_pack: 1,
          });
          imported++;
        } catch {
          skipped++;
        }
      }
    });

    const processed = Math.min(i + CHUNK_SIZE, total);
    if (onProgress) {
      onProgress({
        processed,
        total,
        imported,
        skipped,
        currentItem: extractColumnValue(chunk[chunk.length - 1] ?? {}, ['brand_name']) ?? undefined,
      });
    }

    // Yield to the event loop so the browser updates progress animations smoothly
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const summary = `${imported} medications imported successfully, ${skipped} skipped (duplicates or errors).`;

  return {
    total,
    imported,
    skipped,
    summary,
  };
}

/**
 * Sample test CSV mimicking the Hugging Face tkawen/algerian-drug-nomenclature dataset.
 */
export const SAMPLE_HUGGINGFACE_ALGERIAN_CSV = `brand_name,inn,dosage,form,laboratory
Amoxil,Amoxicilline,500 mg,Gélule,GSK
Clamoxyl,Amoxicilline,1 g,Poudre pour suspension,GlaxoSmithKline
Doliprane,Paracétamol,1000 mg,Comprimé,Sanofi
Doliprane,Paracétamol,500 mg,Gélule,Sanofi
Efferalgan,Paracétamol,1 g,Comprimé effervescent,UPSA
Augmentin,Amoxicilline / Acide clavulanique,1 g / 125 mg,Poudre pour suspension buvable,GSK
Ventoline,Salbutamol,100 mcg/dose,Aérosol doseur,GlaxoSmithKline
Spasfon,Phloroglucinol,80 mg,Comprimé enrobé,Teva
Glucophage,Metformine,850 mg,Comprimé pelliculé,Merck
Tahor,Atorvastatine,20 mg,Comprimé pelliculé,Pfizer
Novalgine,Métamizole,500 mg,Gélule,Biopharm
Aspegic,Acide acétylsalicylique,500 mg,Poudre pour solution buvable,Sanofi
Profenid,Kétoprofène,100 mg,Comprimé pelliculé,Sanofi
Cataflam,Diclofénac potassium,50 mg,Comprimé enrobé,Novartis
Flagyl,Métronidazole,500 mg,Comprimé,Sanofi
Inexium,Esoméprazole,40 mg,Comprimé gastro-résistant,AstraZeneca
Zitromax,Azithromycine,250 mg,Gélule,Pfizer
Zyrtec,Cétirizine,10 mg,Comprimé pelliculé sécable,UCB
Loxen,Nicardipine,20 mg,Comprimé sécable,Astellas
Kardegic,Acide acétylsalicylique,75 mg,Poudre pour solution buvable,Sanofi`;
