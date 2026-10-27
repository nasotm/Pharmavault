import type { DatabasePort } from '../db/port';
import { createRepository, type Medication } from '../db/repository';
import { getFdaDrugLabel, type FdaDrugLabel } from './openFdaService';
import { searchGlobalDrug, type RxNormSearchResult } from './rxnormService';
import { parsePriceToCents } from '../import/normalization';

export interface AlgerianMedicationCsvRow {
  commercial_name: string;
  dci: string;
  strength: string;
  dosage_form: string;
  laboratory: string;
  ppa_da: number | null;
  raw_ppa_da: string;
}

export interface AlgerianImportParsedItem {
  rowNumber: number;
  commercial_name: string;
  dci: string;
  strength: string;
  dosage_form: string;
  laboratory: string;
  ppa_da: number | null;
  unit_price_cents: number | null;
  rxcui: string | null;
  rxcuiDrugName: string | null;
  medicalData: {
    indications: string;
    posology: string;
    precautions: string;
    side_effects: string;
  } | null;
  status: 'found_with_label' | 'found_no_label' | 'dci_not_found';
  hasIncompleteMedicalData: boolean;
}

export const SAMPLE_ALGERIAN_CSV = `commercial_name,dci,strength,dosage_form,laboratory,ppa_da
Amoxil,Amoxicilline,500 mg,Gélule,GSK,350
Doliprane,Paracétamol,1000 mg,Comprimé,Sanofi,180
Glucophage,Metformine,850 mg,Comprimé,Merck,420
Tahor,Atorvastatine,20 mg,Comprimé,Pfizer,950
Spasfon,Phloroglucinol,80 mg,Lyophilisat,Teva,280
Novalgine,Métamizole,500 mg,Gélule,Biopharm,210`;

/**
 * Normalizes French DCI names to maximize RxNorm query hits.
 * e.g., "Amoxicilline" -> "Amoxicillin", "Paracétamol" -> "Paracetamol"
 */
export function normalizeDciQuery(dci: string): string[] {
  const trimmed = dci.trim();
  if (!trimmed) return [];
  const candidates: string[] = [trimmed];

  // Strip French diacritics
  const unaccented = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (unaccented !== trimmed && !candidates.includes(unaccented)) {
    candidates.push(unaccented);
  }

  // Common French to English INN suffix adjustments
  // e.g. "Amoxicilline" -> "Amoxicillin", "Metformine" -> "Metformin"
  if (/ine$/i.test(unaccented)) {
    const stripped = unaccented.replace(/ine$/i, 'in');
    if (!candidates.includes(stripped)) {
      candidates.push(stripped);
    }
  }

  // e.g. "Paracetamol" -> also USAN "Acetaminophen"
  if (/paracetamol/i.test(unaccented) && !candidates.includes('Acetaminophen')) {
    candidates.push('Acetaminophen');
  }

  return candidates;
}

/**
 * Parses raw CSV lines with support for quoted cells and explicit delimiter.
 */
function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses CSV text with required Algerian medication columns:
 * commercial_name, dci, strength, dosage_form, laboratory, ppa_da
 */
export function parseAlgerianMedicationCsv(csvText: string): AlgerianMedicationCsvRow[] {
  if (!csvText || !csvText.trim()) {
    return [];
  }

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return [];
  }

  // Detect delimiter from first line: prefer semicolon if present in header
  const delimiter = lines[0].includes(';') ? ';' : ',';

  const headerCells = parseCsvLine(lines[0], delimiter).map((h) =>
    h.toLowerCase().replace(/[\s_-]+/g, '_'),
  );

  const colIdx = {
    commercial_name: headerCells.findIndex((h) =>
      ['commercial_name', 'commercial', 'brand_name', 'brand', 'nom_commercial', 'medicament'].includes(h),
    ),
    dci: headerCells.findIndex((h) => ['dci', 'generic_name', 'generic', 'molecule', 'inn'].includes(h)),
    strength: headerCells.findIndex((h) => ['strength', 'dosage', 'dosage_strength'].includes(h)),
    dosage_form: headerCells.findIndex((h) => ['dosage_form', 'form', 'forme', 'galenic_form'].includes(h)),
    laboratory: headerCells.findIndex((h) => ['laboratory', 'labo', 'manufacturer', 'lab'].includes(h)),
    ppa_da: headerCells.findIndex((h) => ['ppa_da', 'ppa', 'price', 'prix', 'unit_price', 'price_da'].includes(h)),
  };

  if (colIdx.commercial_name === -1 && colIdx.dci === -1) {
    // If headers cannot be matched by name, assume standard 6-column order
    colIdx.commercial_name = 0;
    colIdx.dci = 1;
    colIdx.strength = 2;
    colIdx.dosage_form = 3;
    colIdx.laboratory = 4;
    colIdx.ppa_da = 5;
  }

  const rows: AlgerianMedicationCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    if (cells.length === 0 || cells.every((c) => c === '')) {
      continue;
    }

    const commercial_name = (colIdx.commercial_name >= 0 ? cells[colIdx.commercial_name] : '') ?? '';
    const dci = (colIdx.dci >= 0 ? cells[colIdx.dci] : '') ?? '';
    const strength = (colIdx.strength >= 0 ? cells[colIdx.strength] : '') ?? '';
    const dosage_form = (colIdx.dosage_form >= 0 ? cells[colIdx.dosage_form] : '') ?? '';
    const laboratory = (colIdx.laboratory >= 0 ? cells[colIdx.laboratory] : '') ?? '';
    const raw_ppa = (colIdx.ppa_da >= 0 ? cells[colIdx.ppa_da] : '') ?? '';

    // Ignore completely empty rows
    if (!commercial_name && !dci) {
      continue;
    }

    // Parse PPA DA price into cents using integer math parser
    let ppa_da: number | null = null;
    if (raw_ppa) {
      const parsed = parsePriceToCents(raw_ppa);
      if (parsed.ok && parsed.cents !== null && parsed.cents >= 0) {
        ppa_da = Math.floor(parsed.cents / 100);
        // If there are sub-dinar cents, e.g. 420.50 DA:
        const remainder = parsed.cents % 100;
        if (remainder > 0) {
          ppa_da = Number((parsed.cents / 100).toFixed(2));
        }
      }
    }

    rows.push({
      commercial_name: commercial_name || dci,
      dci,
      strength,
      dosage_form,
      laboratory,
      ppa_da,
      raw_ppa_da: raw_ppa,
    });
  }

  return rows;
}

/**
 * For a given Algerian medication row, queries RxNorm with the DCI to find the RXCUI,
 * then queries OpenFDA to fetch indications, posology (dosage and administration),
 * precautions (warnings), and side effects (adverse reactions).
 *
 * If DCI is not found or OpenFDA has no label, medical fields are left blank.
 */
export async function enrichAlgerianMedicationRow(
  row: AlgerianMedicationCsvRow,
  rowNumber: number,
): Promise<AlgerianImportParsedItem> {
  const dciClean = row.dci.trim();
  let rxcui: string | null = null;
  let rxcuiDrugName: string | null = null;
  let label: FdaDrugLabel | null = null;

  if (dciClean) {
    const queryVariants = normalizeDciQuery(dciClean);
    let searchResults: RxNormSearchResult[] = [];

    for (const q of queryVariants) {
      try {
        searchResults = await searchGlobalDrug(q);
        if (searchResults && searchResults.length > 0) {
          break;
        }
      } catch {
        // Continue to next query candidate
      }
    }

    if (searchResults && searchResults.length > 0) {
      rxcui = searchResults[0].rxcui;
      rxcuiDrugName = searchResults[0].name;

      // Query OpenFDA for label
      try {
        label = await getFdaDrugLabel(rxcui);
      } catch {
        label = null;
      }
    }
  }

  const unit_price_cents = row.ppa_da !== null ? Math.round(row.ppa_da * 100) : null;

  if (label) {
    return {
      rowNumber,
      commercial_name: row.commercial_name,
      dci: row.dci,
      strength: row.strength,
      dosage_form: row.dosage_form,
      laboratory: row.laboratory,
      ppa_da: row.ppa_da,
      unit_price_cents,
      rxcui,
      rxcuiDrugName,
      medicalData: {
        indications: label.indications || '',
        posology: label.dosage_and_administration || '',
        precautions: label.warnings || '',
        side_effects: label.adverse_reactions || '',
      },
      status: 'found_with_label',
      hasIncompleteMedicalData: !label.indications || !label.dosage_and_administration,
    };
  }

  if (rxcui) {
    return {
      rowNumber,
      commercial_name: row.commercial_name,
      dci: row.dci,
      strength: row.strength,
      dosage_form: row.dosage_form,
      laboratory: row.laboratory,
      ppa_da: row.ppa_da,
      unit_price_cents,
      rxcui,
      rxcuiDrugName,
      medicalData: null,
      status: 'found_no_label',
      hasIncompleteMedicalData: true,
    };
  }

  return {
    rowNumber,
    commercial_name: row.commercial_name,
    dci: row.dci,
    strength: row.strength,
    dosage_form: row.dosage_form,
    laboratory: row.laboratory,
    ppa_da: row.ppa_da,
    unit_price_cents,
    rxcui: null,
    rxcuiDrugName: null,
    medicalData: null,
    status: 'dci_not_found',
    hasIncompleteMedicalData: true,
  };
}

/**
 * Checks if a medication has incomplete medical data.
 * Used for the "Pending Review" section in the Inventory.
 */
export function hasIncompleteMedicalData(med: Medication): boolean {
  const posology = (med.posology ?? '').trim();
  const indications = (med.indications ?? '').trim();
  const sideEffects = (med.side_effects ?? '').trim();
  const precautions = (med.precautions ?? '').trim();

  // If any core clinical fields are missing, it requires pharmacist review
  return !posology || !indications || !sideEffects || !precautions;
}

/**
 * Commits the confirmed Algerian medication items to the database.
 * Strictly called only when the pharmacist clicks "Confirm Import".
 */
export async function commitAlgerianMedications(
  db: DatabasePort,
  items: AlgerianImportParsedItem[],
  currentUser: { name: string; id?: string },
): Promise<Medication[]> {
  const repo = createRepository(db);
  const created: Medication[] = [];

  for (const item of items) {
    const med = await repo.insertMedication({
      brand_name: item.commercial_name,
      generic_name: item.dci || null,
      strength: item.strength || null,
      dosage_form: item.dosage_form || null,
      manufacturer: item.laboratory || null,
      category: 'General Therapeutics',
      storage: 'Ambient 15-25C',
      zone: 'A',
      shelf: 'A1',
      bin: '01',
      reorder_level: 10,
      lead_time_days: 7,
      unit_price_cents: item.unit_price_cents,
      cost_price_cents: null,
      currency: 'DZD',
      units_per_pack: 1,
      price_source: item.unit_price_cents !== null ? 'imported' : null,
      price_confirmed: 0,
      // Medical information: populate from OpenFDA if found, else leave blank
      posology: item.medicalData?.posology || '',
      indications: item.medicalData?.indications || '',
      precautions: item.medicalData?.precautions || '',
      side_effects: item.medicalData?.side_effects || '',
      composition: item.dci ? `Active molecule: ${item.dci} ${item.strength}`.trim() : '',
      therapeutic_class: '',
      route: item.dosage_form?.toLowerCase().includes('gélule') ||
        item.dosage_form?.toLowerCase().includes('comprimé')
        ? 'Oral'
        : '',
    });

    // If a price was imported, log it to append-only price history
    if (item.unit_price_cents !== null) {
      await repo.insertPriceHistory({
        medication_id: med.id,
        unit_price_cents: item.unit_price_cents,
        source: 'imported',
        changed_by: currentUser.name,
      });
    }

    created.push(med);
  }

  return created;
}
