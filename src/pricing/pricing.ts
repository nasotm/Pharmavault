import type { DatabasePort } from '../db/port';
import {
  getMedicationById,
  listPriceHistoryForMedication,
  setPrice,
  type Medication,
  type PriceHistory,
  type PriceSource,
} from '../db/repository';
import { parsePriceToCents, type PriceParseResult } from '../import/normalization';

/**
 * 100% = 1,000,000 scaled units (i.e. 1% = 10,000 scaled units, allowing up to 4 decimal places on percentages).
 */
const PERCENT_DENOM = 1_000_000n;
const ONE_PERCENT_SCALE = 10_000n;

export type PriceVisualStatus = 'null_unentered' | 'unconfirmed' | 'confirmed';

export interface MedicationPriceVisualState {
  status: PriceVisualStatus;
  unitPriceCents: number | null;
  unitPriceMajor: string;
  unitPriceFormatted: string;
  priceSource: PriceSource | null;
  priceConfirmed: 0 | 1;
  isGreyedOut: boolean;
  showConfirmButton: boolean;
  canIncludeInTotal: boolean;
  statusLabel: string;
}

export interface DerivedPriceDisplays {
  pricePerDoseCents: number | null;
  pricePerDoseMajor: string;
  pricePerDoseFormatted: string;
  marginBasisPoints: number | null;
  marginFormatted: string;
}

export interface CalculatorLineInput {
  medicationId: number;
  brandName: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  unitPriceCents: number | null;
  currency?: string;
  quantity: number;
}

export interface CalculatorLineEvaluation {
  medicationId: number;
  brandName: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  currency: string;
  quantity: number;
  unitPriceCents: number | null;
  unitPriceMajor: string;
  unitPriceFormatted: string;
  hasNullPrice: boolean;
  /** quantity * unitPriceCents (null when unitPriceCents is null) */
  lineSubtotalCents: number | null;
  lineSubtotalMajor: string;
  lineSubtotalFormatted: string;
  /**
   * Final line total after discount % and tax %, rounded ONCE with ROUND_HALF_UP
   * (null when unitPriceCents is null).
   */
  lineFinalTotalCents: number | null;
  lineFinalTotalMajor: string;
  lineFinalTotalFormatted: string;
}

export interface CalculatorEvaluation {
  lines: CalculatorLineEvaluation[];
  nullPriceItems: CalculatorLineEvaluation[];
  hasNullPriceItems: boolean;
  canComputeGrandTotal: boolean;
  blockingMessage: string | null;
  discountPercentDisplay: string;
  taxPercentDisplay: string;
  subtotalCents: number | null;
  subtotalMajor: string;
  subtotalFormatted: string;
  discountAmountCents: number | null;
  discountAmountMajor: string;
  discountAmountFormatted: string;
  taxAmountCents: number | null;
  taxAmountMajor: string;
  taxAmountFormatted: string;
  grandTotalCents: number | null;
  grandTotalMajor: string;
  grandTotalFormatted: string;
  currency: string;
}

/**
 * Exact rational division `numerator / denominator` with ROUND_HALF_UP (ties round away from 0).
 * Uses strictly BigInt integer arithmetic — zero floating-point operations.
 */
export function roundHalfUpRational(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero in roundHalfUpRational');
  }
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  const quotient = absNum / absDen;
  const remainder = absNum % absDen;

  // ROUND_HALF_UP: if remainder * 2 >= absDen, round up
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return sign < 0n ? -rounded : rounded;
}

/**
 * Currency symbol helper.
 */
export function getCurrencySymbol(currency = 'USD'): string {
  const code = (currency || 'USD').trim().toUpperCase();
  if (code === 'EUR') return '€';
  if (code === 'GBP') return '£';
  return '$';
}

/**
 * Formats integer cents to a 2-decimal-place major unit string (e.g. `1250` -> `"12.50"`)
 * using strictly BigInt integer division and modulo.
 * If `cents` is `null` or `undefined`, returns `"price not entered"` — never `"0.00"`.
 */
export function formatCentsToMajor(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return 'price not entered';
  }
  if (!Number.isInteger(cents) || !Number.isSafeInteger(cents)) {
    throw new TypeError(`Expected integer cents or null, received: ${String(cents)}`);
  }
  const n = BigInt(cents);
  const isNegative = n < 0n;
  const abs = isNegative ? -n : n;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Formats integer cents with currency symbol (and optional minor cents label).
 * Returns `"price not entered"` when `cents` is `null` or `undefined` — never `"0.00"`.
 */
export function formatMoneyDisplay(
  cents: number | null | undefined,
  currency = 'USD',
  options: { includeCentsSuffix?: boolean } = {},
): string {
  if (cents === null || cents === undefined) {
    return 'price not entered';
  }
  const major = formatCentsToMajor(cents);
  const symbol = getCurrencySymbol(currency);
  if (options.includeCentsSuffix) {
    return `${symbol}${major} (${cents} ¢)`;
  }
  return `${symbol}${major}`;
}

/**
 * Parses money input strings ("12.50", "12,50", "12", "$12.50") to integer cents.
 * Delegates to the shared string-based parser without any floating-point math.
 * Empty input returns `{ ok: true, cents: null }`.
 */
export function parseMoneyInputToCents(
  raw: string | null | undefined,
  options: { allowZero?: boolean } = {},
): PriceParseResult {
  if (raw === null || raw === undefined) {
    return { ok: true, cents: null };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, cents: null };
  }
  if (options.allowZero && /^(?:USD|EUR|GBP|CAD|CHF|\$|€|£)?\s*0(?:[.,]0{1,2})?\s*$/i.test(trimmed)) {
    return { ok: true, cents: 0 };
  }
  return parsePriceToCents(trimmed);
}

/**
 * Parses a percentage input (e.g. "10", "5", "12.5", "12,5", 10) into a scaled BigInt
 * where 1% = 10,000n and 100% = 1,000,000n.
 * Uses pure string-to-BigInt parsing — zero floating-point operations.
 */
export function parsePercentToScaledBigInt(
  raw: string | number | null | undefined,
  fieldName = 'percentage',
): { ok: true; scaled: bigint; displayPercent: string } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, scaled: 0n, displayPercent: '0' };
  }
  const cleaned = String(raw).trim().replace(/%$/g, '').trim();
  if (cleaned === '') {
    return { ok: true, scaled: 0n, displayPercent: '0' };
  }
  if (cleaned.includes('-')) {
    return { ok: false, error: `${fieldName} cannot be negative ("${String(raw)}")` };
  }

  const normalized = cleaned.replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) {
    return { ok: false, error: `Invalid ${fieldName} "${String(raw)}"` };
  }

  const [wholeStr, fracStr = ''] = normalized.split('.');
  const paddedFrac = fracStr.padEnd(4, '0');
  const scaled = BigInt(wholeStr) * ONE_PERCENT_SCALE + BigInt(paddedFrac);

  if (scaled < 0n || scaled > PERCENT_DENOM) {
    return {
      ok: false,
      error: `${fieldName} must be between 0% and 100% (received "${String(raw)}")`,
    };
  }

  const trimmedDisplay =
    fracStr.replace(/0+$/g, '').length > 0
      ? `${BigInt(wholeStr).toString()}.${fracStr.replace(/0+$/g, '')}`
      : BigInt(wholeStr).toString();

  return { ok: true, scaled, displayPercent: trimmedDisplay };
}

/**
 * Deliverable 2: Computes visual state driven by `unit_price_cents`, `price_confirmed`, and `price_source`.
 * - `unit_price_cents IS NULL` -> "price not entered", no total shown
 * - `price_confirmed = 0`      -> greyed price + "Confirm price" button
 * - `price_confirmed = 1`      -> normal price, editable
 */
export function getMedicationPriceVisualState(
  medication: Pick<
    Medication,
    'unit_price_cents' | 'price_confirmed' | 'price_source' | 'currency'
  >,
): MedicationPriceVisualState {
  const currency = medication.currency || 'USD';
  if (medication.unit_price_cents === null || medication.unit_price_cents === undefined) {
    return {
      status: 'null_unentered',
      unitPriceCents: null,
      unitPriceMajor: 'price not entered',
      unitPriceFormatted: 'price not entered',
      priceSource: medication.price_source ?? null,
      priceConfirmed: 0,
      isGreyedOut: false,
      showConfirmButton: false,
      canIncludeInTotal: false,
      statusLabel: 'price not entered',
    };
  }

  const isConfirmed = Number(medication.price_confirmed) === 1;
  const major = formatCentsToMajor(medication.unit_price_cents);
  const formatted = formatMoneyDisplay(medication.unit_price_cents, currency, {
    includeCentsSuffix: true,
  });

  if (!isConfirmed) {
    return {
      status: 'unconfirmed',
      unitPriceCents: medication.unit_price_cents,
      unitPriceMajor: major,
      unitPriceFormatted: formatted,
      priceSource: medication.price_source ?? 'imported',
      priceConfirmed: 0,
      isGreyedOut: true,
      showConfirmButton: true,
      canIncludeInTotal: true,
      statusLabel: `Unconfirmed (${medication.price_source ?? 'imported'}) — Confirmation Required`,
    };
  }

  return {
    status: 'confirmed',
    unitPriceCents: medication.unit_price_cents,
    unitPriceMajor: major,
    unitPriceFormatted: formatted,
    priceSource: medication.price_source ?? 'manual',
    priceConfirmed: 1,
    isGreyedOut: false,
    showConfirmButton: false,
    canIncludeInTotal: true,
    statusLabel: `Confirmed (${medication.price_source ?? 'manual'})`,
  };
}

/**
 * Deliverable 3: Derived displays (read-only) using integer cents & BigInt ROUND_HALF_UP:
 * - `price per dose = unit_price / units_per_pack` (2 dp)
 * - `margin % = (sell - cost) / sell` when cost present (2 dp)
 */
export function computeDerivedPriceDisplays(input: {
  unitPriceCents: number | null | undefined;
  costPriceCents: number | null | undefined;
  unitsPerPack: number | null | undefined;
  currency?: string;
}): DerivedPriceDisplays {
  const currency = input.currency || 'USD';
  const unitsPerPack =
    input.unitsPerPack !== null &&
    input.unitsPerPack !== undefined &&
    Number.isInteger(input.unitsPerPack) &&
    input.unitsPerPack > 0
      ? input.unitsPerPack
      : 1;

  if (input.unitPriceCents === null || input.unitPriceCents === undefined) {
    return {
      pricePerDoseCents: null,
      pricePerDoseMajor: 'price not entered',
      pricePerDoseFormatted: 'price not entered',
      marginBasisPoints: null,
      marginFormatted: 'price not entered',
    };
  }

  const sellCentsBig = BigInt(input.unitPriceCents);
  const packBig = BigInt(unitsPerPack);

  // price per dose in cents = roundHalfUp(unit_price_cents / units_per_pack)
  const doseCentsBig = roundHalfUpRational(sellCentsBig, packBig);
  const doseCents = Number(doseCentsBig);
  const doseMajor = formatCentsToMajor(doseCents);
  const doseFormatted = `${ getCurrencySymbol(currency) }${doseMajor} / dose`;

  let marginBasisPoints: number | null = null;
  let marginFormatted = 'cost not entered';

  if (
    input.costPriceCents !== null &&
    input.costPriceCents !== undefined &&
    input.unitPriceCents > 0
  ) {
    const costCentsBig = BigInt(input.costPriceCents);
    // margin % in basis points (100.00% = 10000 bps) = roundHalfUp((sell - cost) * 10000 / sell)
    const bpsBig = roundHalfUpRational((sellCentsBig - costCentsBig) * 10_000n, sellCentsBig);
    marginBasisPoints = Number(bpsBig);
    const isNeg = bpsBig < 0n;
    const absBps = isNeg ? -bpsBig : bpsBig;
    const wholePct = absBps / 100n;
    const fracPct = (absBps % 100n).toString().padStart(2, '0');
    marginFormatted = `${isNeg ? '-' : ''}${wholePct.toString()}.${fracPct}%`;
  }

  return {
    pricePerDoseCents: doseCents,
    pricePerDoseMajor: doseMajor,
    pricePerDoseFormatted: doseFormatted,
    marginBasisPoints,
    marginFormatted,
  };
}

/**
 * Deliverable 4 & 5: Standalone Calculator evaluation.
 * - All money math via integer cents / BigInt rational arithmetic with ROUND_HALF_UP to 2 dp.
 * - Rounding happens ONCE, on the final line total, not per step:
 *   `finalLineTotalCents = roundHalfUp(qty * unitPriceCents * (1 - discountRate) * (1 + taxRate))`
 * - REFUSES to compute a grand total if any selected item has NULL price; lists those items
 *   under `"price not entered — set price to include in total"`.
 */
export function evaluateStandaloneCalculator(input: {
  items: readonly CalculatorLineInput[];
  discountPercent?: string | number | null;
  taxPercent?: string | number | null;
  currency?: string;
}): CalculatorEvaluation {
  const defaultCurrency = input.currency || input.items[0]?.currency || 'USD';

  const parsedDiscount = parsePercentToScaledBigInt(input.discountPercent ?? '0', 'Discount %');
  const discountScaled = parsedDiscount.ok ? parsedDiscount.scaled : 0n;
  const discountPercentDisplay = parsedDiscount.ok ? parsedDiscount.displayPercent : '0';

  const parsedTax = parsePercentToScaledBigInt(input.taxPercent ?? '0', 'Tax %');
  const taxScaled = parsedTax.ok ? parsedTax.scaled : 0n;
  const taxPercentDisplay = parsedTax.ok ? parsedTax.displayPercent : '0';

  const lines: CalculatorLineEvaluation[] = [];
  const nullPriceItems: CalculatorLineEvaluation[] = [];

  for (const item of input.items) {
    const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    if (qty <= 0) {
      continue;
    }

    const currency = item.currency || defaultCurrency;
    if (item.unitPriceCents === null || item.unitPriceCents === undefined) {
      const nullLine: CalculatorLineEvaluation = {
        medicationId: item.medicationId,
        brandName: item.brandName,
        genericName: item.genericName ?? null,
        strength: item.strength ?? null,
        dosageForm: item.dosageForm ?? null,
        currency,
        quantity: qty,
        unitPriceCents: null,
        unitPriceMajor: 'price not entered',
        unitPriceFormatted: 'price not entered',
        hasNullPrice: true,
        lineSubtotalCents: null,
        lineSubtotalMajor: 'price not entered',
        lineSubtotalFormatted: 'price not entered',
        lineFinalTotalCents: null,
        lineFinalTotalMajor: 'price not entered',
        lineFinalTotalFormatted: 'price not entered',
      };
      lines.push(nullLine);
      nullPriceItems.push(nullLine);
      continue;
    }

    const unitCentsBig = BigInt(item.unitPriceCents);
    const qtyBig = BigInt(qty);
    const lineSubBig = qtyBig * unitCentsBig;

    // Single-step exact rational calculation for final line total:
    // lineFinal = roundHalfUp(lineSub * (1 - discount) * (1 + tax))
    const finalNum =
      lineSubBig * (PERCENT_DENOM - discountScaled) * (PERCENT_DENOM + taxScaled);
    const finalDen = PERCENT_DENOM * PERCENT_DENOM;
    const lineFinalBig = roundHalfUpRational(finalNum, finalDen);

    const lineSubtotalCents = Number(lineSubBig);
    const lineFinalTotalCents = Number(lineFinalBig);

    lines.push({
      medicationId: item.medicationId,
      brandName: item.brandName,
      genericName: item.genericName ?? null,
      strength: item.strength ?? null,
      dosageForm: item.dosageForm ?? null,
      currency,
      quantity: qty,
      unitPriceCents: item.unitPriceCents,
      unitPriceMajor: formatCentsToMajor(item.unitPriceCents),
      unitPriceFormatted: formatMoneyDisplay(item.unitPriceCents, currency),
      hasNullPrice: false,
      lineSubtotalCents,
      lineSubtotalMajor: formatCentsToMajor(lineSubtotalCents),
      lineSubtotalFormatted: formatMoneyDisplay(lineSubtotalCents, currency),
      lineFinalTotalCents,
      lineFinalTotalMajor: formatCentsToMajor(lineFinalTotalCents),
      lineFinalTotalFormatted: formatMoneyDisplay(lineFinalTotalCents, currency),
    });
  }

  if (nullPriceItems.length > 0) {
    const missingNames = nullPriceItems.map((i) => i.brandName).join(', ');
    return {
      lines,
      nullPriceItems,
      hasNullPriceItems: true,
      canComputeGrandTotal: false,
      blockingMessage: `price not entered — set price to include in total (${missingNames})`,
      discountPercentDisplay,
      taxPercentDisplay,
      subtotalCents: null,
      subtotalMajor: 'price not entered',
      subtotalFormatted: 'price not entered',
      discountAmountCents: null,
      discountAmountMajor: 'price not entered',
      discountAmountFormatted: 'price not entered',
      taxAmountCents: null,
      taxAmountMajor: 'price not entered',
      taxAmountFormatted: 'price not entered',
      grandTotalCents: null,
      grandTotalMajor: 'price not entered',
      grandTotalFormatted: 'price not entered — set price to include in total',
      currency: defaultCurrency,
    };
  }

  if (lines.length === 0) {
    return {
      lines: [],
      nullPriceItems: [],
      hasNullPriceItems: false,
      canComputeGrandTotal: false,
      blockingMessage: null,
      discountPercentDisplay,
      taxPercentDisplay,
      subtotalCents: 0,
      subtotalMajor: '0.00',
      subtotalFormatted: formatMoneyDisplay(0, defaultCurrency),
      discountAmountCents: 0,
      discountAmountMajor: '0.00',
      discountAmountFormatted: formatMoneyDisplay(0, defaultCurrency),
      taxAmountCents: 0,
      taxAmountMajor: '0.00',
      taxAmountFormatted: formatMoneyDisplay(0, defaultCurrency),
      grandTotalCents: 0,
      grandTotalMajor: '0.00',
      grandTotalFormatted: formatMoneyDisplay(0, defaultCurrency),
      currency: defaultCurrency,
    };
  }

  let subtotalBig = 0n;
  let grandTotalBig = 0n;
  for (const line of lines) {
    subtotalBig += BigInt(line.lineSubtotalCents!);
    grandTotalBig += BigInt(line.lineFinalTotalCents!);
  }

  const discountBig = roundHalfUpRational(subtotalBig * discountScaled, PERCENT_DENOM);
  const discountedSubtotalBig = subtotalBig - discountBig;
  const taxBig = grandTotalBig - discountedSubtotalBig;

  const subtotalCents = Number(subtotalBig);
  const discountAmountCents = Number(discountBig);
  const taxAmountCents = Number(taxBig);
  const grandTotalCents = Number(grandTotalBig);

  return {
    lines,
    nullPriceItems: [],
    hasNullPriceItems: false,
    canComputeGrandTotal: true,
    blockingMessage: null,
    discountPercentDisplay,
    taxPercentDisplay,
    subtotalCents,
    subtotalMajor: formatCentsToMajor(subtotalCents),
    subtotalFormatted: formatMoneyDisplay(subtotalCents, defaultCurrency),
    discountAmountCents,
    discountAmountMajor: formatCentsToMajor(discountAmountCents),
    discountAmountFormatted: formatMoneyDisplay(discountAmountCents, defaultCurrency),
    taxAmountCents,
    taxAmountMajor: formatCentsToMajor(taxAmountCents),
    taxAmountFormatted: formatMoneyDisplay(taxAmountCents, defaultCurrency),
    grandTotalCents,
    grandTotalMajor: formatCentsToMajor(grandTotalCents),
    grandTotalFormatted: formatMoneyDisplay(grandTotalCents, defaultCurrency),
    currency: defaultCurrency,
  };
}

export interface SavePharmacistPriceInput {
  medicationId: number;
  unitPriceInput: string | number | null;
  costPriceInput?: string | number | null;
  currency?: string;
  unitsPerPack?: number | string;
  userId: string;
}

export interface SavePharmacistPriceResult {
  medication: Medication;
  priceHistory: PriceHistory[];
}

/**
 * Deliverable 1: Saves a pharmacist-edited price via `repository.setPrice(...)`
 * with `source='manual'`, `confirmed=1`, and `userId`.
 * Writes `medication` + `price_history` in one transaction.
 */
export async function savePharmacistManualPrice(
  db: DatabasePort,
  input: SavePharmacistPriceInput,
): Promise<SavePharmacistPriceResult> {
  let unitPriceCents: number | null;
  if (typeof input.unitPriceInput === 'number') {
    if (!Number.isInteger(input.unitPriceInput) || input.unitPriceInput <= 0) {
      throw new Error(`unit_price_cents must be a positive integer (received ${input.unitPriceInput})`);
    }
    unitPriceCents = input.unitPriceInput;
  } else {
    const parsedUnit = parseMoneyInputToCents(input.unitPriceInput);
    if (!parsedUnit.ok) {
      throw new Error(parsedUnit.error);
    }
    if (parsedUnit.cents === null) {
      throw new Error('Please enter a valid unit price (e.g. "12.50", "12,50", or "12").');
    }
    unitPriceCents = parsedUnit.cents;
  }

  let costPriceCents: number | null | undefined = undefined;
  if (input.costPriceInput !== undefined) {
    if (typeof input.costPriceInput === 'number') {
      if (!Number.isInteger(input.costPriceInput) || input.costPriceInput < 0) {
        throw new Error(`cost_price_cents must be a non-negative integer`);
      }
      costPriceCents = input.costPriceInput;
    } else {
      const parsedCost = parseMoneyInputToCents(input.costPriceInput, { allowZero: true });
      if (!parsedCost.ok) {
        throw new Error(`Invalid cost price: ${parsedCost.error}`);
      }
      costPriceCents = parsedCost.cents;
    }
  }

  let unitsPerPack: number | undefined = undefined;
  if (input.unitsPerPack !== undefined && String(input.unitsPerPack).trim() !== '') {
    const parsedPack = Number(String(input.unitsPerPack).trim());
    if (!Number.isInteger(parsedPack) || parsedPack <= 0) {
      throw new Error('units_per_pack must be a positive integer (e.g. 1, 10, 30).');
    }
    unitsPerPack = parsedPack;
  }

  const updatedMedication = await setPrice(
    db,
    input.medicationId,
    unitPriceCents,
    'manual',
    1,
    input.userId.trim() || 'pharmacist:local',
    {
      cost_price_cents: costPriceCents,
      currency: input.currency?.trim().toUpperCase() || undefined,
      units_per_pack: unitsPerPack,
    },
  );

  const priceHistory = await listPriceHistoryForMedication(db, input.medicationId);
  return {
    medication: updatedMedication,
    priceHistory,
  };
}

/**
 * Deliverable 2: Confirms an existing unconfirmed price (`price_confirmed = 0`)
 * by calling `repository.setPrice` with `confirmed = 1` and preserving `price_source`
 * (`'official_tariff'` or `'imported'` or `'manual'`).
 */
export async function confirmExistingMedicationPrice(
  db: DatabasePort,
  medicationId: number,
  userId: string,
): Promise<SavePharmacistPriceResult> {
  const existing = await getMedicationById(db, medicationId);
  if (!existing) {
    throw new Error(`Medication #${medicationId} not found`);
  }
  if (existing.unit_price_cents === null) {
    throw new Error(
      `Cannot confirm price for ${existing.brand_name}: unit_price_cents is NULL (price not entered).`,
    );
  }

  const preservedSource: PriceSource = existing.price_source ?? 'imported';
  const updatedMedication = await setPrice(
    db,
    medicationId,
    existing.unit_price_cents,
    preservedSource,
    1,
    userId.trim() || 'pharmacist:local',
  );

  const priceHistory = await listPriceHistoryForMedication(db, medicationId);
  return {
    medication: updatedMedication,
    priceHistory,
  };
}
