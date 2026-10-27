import type { DatabasePort } from '../db/port';
import {
  DEFAULT_CURRENCIES,
  getMedicationById,
  listPriceHistoryForMedication,
  setPrice,
  type CurrencyRecord,
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

/**
 * Exchange rate scale: 1 unit = 1,000,000n (allowing up to 6 decimal places on exchange rates without floating-point math).
 */
const RATE_SCALE = 1_000_000n;

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
  /** Grand total converted to integer Algerian Dinar (DA) via the exchange rate */
  grandTotalDzd: number | null;
  /** Formatted Grand Total in Algerian Dinar, e.g. "3,544 DA" */
  grandTotalDzdFormatted: string;
  /** Active exchange rate to DA for the selected calculator currency */
  exchangeRateToDa: number;
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
 * Returns true if the currency code represents Algerian Dinar ('DZD' or 'DA').
 */
export function isDzdCurrency(currency?: string | null): boolean {
  const code = (currency ?? 'DZD').trim().toUpperCase();
  return code === 'DZD' || code === 'DA';
}

/**
 * Currency symbol helper supporting the 10 seeded currencies (base DZD -> 'DA').
 */
export function getCurrencySymbol(
  currency = 'DZD',
  currencies?: readonly CurrencyRecord[],
): string {
  const code = (currency || 'DZD').trim().toUpperCase();
  if (code === 'DZD' || code === 'DA') return 'DA';
  if (currencies && currencies.length > 0) {
    const found = currencies.find((c) => c.code.toUpperCase() === code);
    if (found) return found.symbol;
  }
  if (code === 'EUR') return '€';
  if (code === 'USD') return '$';
  if (code === 'GBP') return '£';
  if (code === 'CAD') return 'CA$';
  if (code === 'CHF') return 'CHF';
  if (code === 'CNY') return '¥';
  if (code === 'TRY') return '₺';
  if (code === 'AED') return 'AED';
  if (code === 'SAR') return 'SAR';
  const def = DEFAULT_CURRENCIES.find((c) => c.code === code);
  return def ? def.symbol : '$';
}

/**
 * Resolves the exchange rate to DA for a currency code from a currency list (or DEFAULT_CURRENCIES).
 */
export function getExchangeRateToDa(
  currency = 'DZD',
  currencies?: readonly CurrencyRecord[],
): number {
  const code = (currency || 'DZD').trim().toUpperCase();
  if (code === 'DZD' || code === 'DA') return 1;
  const sourceList = currencies && currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
  const found = sourceList.find((c) => c.code.toUpperCase() === code);
  return found && found.rate_to_da > 0 ? found.rate_to_da : 1;
}

export interface ExchangeRateParseResult {
  ok: boolean;
  scaled?: bigint;
  numericRate?: number;
  error?: string;
}

/**
 * Parses an exchange rate (e.g. `1`, `146.5`, `"134.50"`, `"150,25"`) into a scaled BigInt
 * where `1.0 = 1_000_000n` using pure string-to-BigInt arithmetic (zero parseFloat).
 */
export function parseExchangeRateToScaledBigInt(
  rawRate: number | string | null | undefined,
): ExchangeRateParseResult {
  if (rawRate === null || rawRate === undefined) {
    return { ok: false, error: 'Exchange rate is required' };
  }
  const cleaned = String(rawRate).trim().replace(',', '.');
  if (cleaned === '' || cleaned.includes('-')) {
    return { ok: false, error: `Exchange rate must be a positive number ("${String(rawRate)}")` };
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(cleaned)) {
    return {
      ok: false,
      error: `Invalid exchange rate "${String(rawRate)}" (up to 6 decimal places allowed)`,
    };
  }
  const [wholeStr, fracStr = ''] = cleaned.split('.');
  const paddedFrac = fracStr.padEnd(6, '0').slice(0, 6);
  const scaled = BigInt(wholeStr) * RATE_SCALE + BigInt(paddedFrac);
  if (scaled <= 0n) {
    return { ok: false, error: `Exchange rate must be greater than 0 ("${String(rawRate)}")` };
  }
  return {
    ok: true,
    scaled,
    numericRate: Number(cleaned),
  };
}

/**
 * Formats an integer DZD amount with comma thousands separators (e.g. `1250` -> `"1,250"`).
 * Uses strictly string/BigInt manipulation.
 */
export function formatDzdInteger(amountDzd: number | null | undefined): string {
  if (amountDzd === null || amountDzd === undefined) {
    return 'price not entered';
  }
  if (!Number.isInteger(amountDzd) || !Number.isSafeInteger(amountDzd)) {
    throw new TypeError(`Expected integer DZD or null, received: ${String(amountDzd)}`);
  }
  const n = BigInt(amountDzd);
  const isNegative = n < 0n;
  const absStr = (isNegative ? -n : n).toString();
  const withCommas = absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${isNegative ? '-' : ''}${withCommas}`;
}

/**
 * Formats integer cents to a 2-decimal-place major unit string (e.g. `1250` -> `"12.50"`)
 * using strictly BigInt integer division and modulo.
 * If `cents` is `null` or `undefined`, returns `"price not entered"` — never `"0.00"`.
 */
export function formatCentsToMajor(
  cents: number | null | undefined,
  currency?: string,
): string {
  if (cents === null || cents === undefined) {
    return 'price not entered';
  }
  if (!Number.isInteger(cents) || !Number.isSafeInteger(cents)) {
    throw new TypeError(`Expected integer cents or null, received: ${String(cents)}`);
  }
  if (currency && isDzdCurrency(currency)) {
    return BigInt(cents).toString();
  }
  const n = BigInt(cents);
  const isNegative = n < 0n;
  const abs = isNegative ? -n : n;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Formats integer price units with currency symbol:
 * - For DZD ('DZD' or 'DA'): `cents` is an integer DZD amount (no cents) and displays as `"1,250 DA"`.
 * - For foreign currencies ('USD', 'EUR', 'GBP', etc.): `cents` is integer cents and displays as `"$12.50"`, `"€21.50"`, etc.
 * Returns `"price not entered"` when `cents` is `null` or `undefined` — never `"0.00"`.
 */
export function formatMoneyDisplay(
  cents: number | null | undefined,
  currency = 'DZD',
  options: { includeCentsSuffix?: boolean; currencies?: readonly CurrencyRecord[] } = {},
): string {
  if (cents === null || cents === undefined) {
    return 'price not entered';
  }
  if (isDzdCurrency(currency)) {
    return `${formatDzdInteger(cents)} DA`;
  }
  const major = formatCentsToMajor(cents);
  const symbol = getCurrencySymbol(currency, options.currencies);
  const prefix =
    symbol.length > 2 && !symbol.endsWith('$') ? `${symbol} ${major}` : `${symbol}${major}`;
  if (options.includeCentsSuffix) {
    return `${prefix} (${cents} ¢)`;
  }
  return prefix;
}

/**
 * Converts a stored currency amount into integer Algerian Dinar (DZD) using ROUND_HALF_UP:
 * - If `currencyCode` is `'DZD'`, `amountUnits` is already integer DZD -> returns `amountUnits`.
 * - If `currencyCode` is a foreign currency, `amountUnits` is in integer cents (100 cents = 1 major unit = `rateToDa` DA) ->
 *   returns `roundHalfUp(amountUnits * rateToDa / 100)`.
 */
export function convertCurrencyUnitsToDzd(
  amountUnits: number | null | undefined,
  currencyCode = 'DZD',
  rateToDa: number | string = 1,
): number | null {
  if (amountUnits === null || amountUnits === undefined) {
    return null;
  }
  if (isDzdCurrency(currencyCode)) {
    return amountUnits;
  }
  const parsedRate = parseExchangeRateToScaledBigInt(rateToDa);
  const rateScaled =
    parsedRate.ok && parsedRate.scaled !== undefined ? parsedRate.scaled : RATE_SCALE;
  const dzdBig = roundHalfUpRational(BigInt(amountUnits) * rateScaled, 100n * RATE_SCALE);
  return Number(dzdBig);
}

/**
 * Converts an amount from `fromCurrency` units (integer DZD for DZD, or integer cents for foreign)
 * into `toCurrency` units (integer DZD for DZD, or integer cents for foreign) via DA exchange rates.
 */
export function convertCurrencyUnitsBetween(
  amountUnits: number | null | undefined,
  fromCurrency: string,
  fromRateToDa: number | string,
  toCurrency: string,
  toRateToDa: number | string,
): number | null {
  if (amountUnits === null || amountUnits === undefined) {
    return null;
  }
  const normFrom = (fromCurrency || 'DZD').trim().toUpperCase();
  const normTo = (toCurrency || 'DZD').trim().toUpperCase();
  if (normFrom === normTo) {
    return amountUnits;
  }

  const fromParsed = parseExchangeRateToScaledBigInt(isDzdCurrency(normFrom) ? 1 : fromRateToDa);
  const toParsed = parseExchangeRateToScaledBigInt(isDzdCurrency(normTo) ? 1 : toRateToDa);
  const fromRateScaled =
    fromParsed.ok && fromParsed.scaled !== undefined ? fromParsed.scaled : RATE_SCALE;
  const toRateScaled =
    toParsed.ok && toParsed.scaled !== undefined ? toParsed.scaled : RATE_SCALE;

  // Step 1: express value in scaled DA (where 1 DA = 100n * RATE_SCALE)
  // - If from is DZD: amountUnits is integer DA -> scaledDa = amountUnits * 100 * RATE_SCALE
  // - If from is foreign: amountUnits is cents -> scaledDa = amountUnits * fromRateScaled
  const scaledDa100 = isDzdCurrency(normFrom)
    ? BigInt(amountUnits) * 100n * RATE_SCALE
    : BigInt(amountUnits) * fromRateScaled;

  // Step 2: convert from scaledDa100 to target units
  // - If to is DZD: integer DA = roundHalfUp(scaledDa100 / (100 * RATE_SCALE))
  // - If to is foreign: target cents = roundHalfUp(scaledDa100 / toRateScaled)
  if (isDzdCurrency(normTo)) {
    return Number(roundHalfUpRational(scaledDa100, 100n * RATE_SCALE));
  }
  return Number(roundHalfUpRational(scaledDa100, toRateScaled));
}

/**
 * Formats a medication's unit price for the Inventory and Detail screens with the "DA" symbol
 * (e.g. "1,250 DA"). If the medication's stored currency is a foreign currency, converts it
 * to DA using its exchange rate and displays the DA amount (with the foreign amount in parentheses).
 */
export function formatMedicationPriceInDa(
  unitPriceCents: number | null | undefined,
  currencyCode = 'DZD',
  currencies?: readonly CurrencyRecord[],
): string {
  if (unitPriceCents === null || unitPriceCents === undefined) {
    return 'price not entered';
  }
  const code = (currencyCode || 'DZD').trim().toUpperCase();
  if (isDzdCurrency(code)) {
    return formatMoneyDisplay(unitPriceCents, 'DZD');
  }
  const rate = getExchangeRateToDa(code, currencies);
  const dzdAmount = convertCurrencyUnitsToDzd(unitPriceCents, code, rate);
  if (dzdAmount === null) {
    return 'price not entered';
  }
  return `${formatMoneyDisplay(dzdAmount, 'DZD')} (${formatMoneyDisplay(unitPriceCents, code, { currencies })})`;
}

/**
 * Parses money input strings:
 * - When `options.currency` is `'DZD'` (or `'DA'`), since DZD has no cents (it's a whole number),
 *   whole integer inputs like `"1250"`, `"1,250"`, `"1250 DA"` are stored directly as integer DZD (`1250`).
 * - For foreign currencies (or when `options.currency` is omitted), delegates to `parsePriceToCents`
 *   (`"12.50"` -> `1250`, `"12,50"` -> `1250`, `"12"` -> `1200`).
 * Empty input returns `{ ok: true, cents: null }`.
 */
export function parseMoneyInputToCents(
  raw: string | null | undefined,
  optionsOrCurrency: { allowZero?: boolean; currency?: string } | string = {},
): PriceParseResult {
  const options =
    typeof optionsOrCurrency === 'string'
      ? { currency: optionsOrCurrency }
      : optionsOrCurrency;

  if (raw === null || raw === undefined) {
    return { ok: true, cents: null };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, cents: null };
  }
  if (
    options.allowZero &&
    /^(?:DZD|DA|USD|EUR|GBP|CAD|CHF|CNY|TRY|AED|SAR|CA\$|\$|€|£|¥|₺)?\s*0(?:[.,]0{1,2})?\s*(?:DZD|DA)?$/i.test(
      trimmed,
    )
  ) {
    return { ok: true, cents: 0 };
  }

  if (options.currency && isDzdCurrency(options.currency)) {
    if (trimmed.includes('-')) {
      return { ok: false, error: `Invalid negative or malformed price "${raw}"` };
    }
    const withoutDzd = trimmed
      .replace(/^(?:DZD|DA)\s*/i, '')
      .replace(/\s*(?:DZD|DA)$/i, '')
      .trim();

    // Whole integer DZD or comma-grouped thousands (e.g. "1250", "1,250", "1250.00")
    const normalizedInt = withoutDzd.replace(/^(?:(\d{1,3})(?:,\d{3})+)$/, (m) =>
      m.replace(/,/g, ''),
    );
    const strippedZeroDec = normalizedInt.replace(/[.,]00?$/, '');
    if (/^\d+$/.test(strippedZeroDec)) {
      const val = Number(strippedZeroDec);
      if (!Number.isSafeInteger(val) || (val <= 0 && !options.allowZero)) {
        return {
          ok: false,
          error: `Price "${raw}" must be a positive integer DZD amount`,
        };
      }
      return { ok: true, cents: val };
    }
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
    'unit_price_cents' | 'price_confirmed' | 'price_source' | 'currency' | 'currency_code'
  >,
): MedicationPriceVisualState {
  const currency = medication.currency_code || medication.currency || 'DZD';
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
  const major = isDzdCurrency(currency)
    ? formatDzdInteger(medication.unit_price_cents)
    : formatCentsToMajor(medication.unit_price_cents);
  const formatted = formatMoneyDisplay(medication.unit_price_cents, currency, {
    includeCentsSuffix: !isDzdCurrency(currency),
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
 * Deliverable 3: Derived displays (read-only) using integer cents/DZD & BigInt ROUND_HALF_UP:
 * - `price per dose = unit_price / units_per_pack`
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

  // price per dose = roundHalfUp(unit_price_cents / units_per_pack)
  const doseCentsBig = roundHalfUpRational(sellCentsBig, packBig);
  const doseCents = Number(doseCentsBig);
  const doseMajor = isDzdCurrency(currency)
    ? formatDzdInteger(doseCents)
    : formatCentsToMajor(doseCents);
  const doseFormatted = isDzdCurrency(currency)
    ? `${doseMajor} DA / dose`
    : `${getCurrencySymbol(currency)}${doseMajor} / dose`;

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
 * - All money math via integer DZD (for 'DZD') or integer cents (for foreign currencies)
 *   using BigInt rational arithmetic with ROUND_HALF_UP.
 * - Rounding happens ONCE, on the final line total, not per step:
 *   `finalLineTotalCents = roundHalfUp(qty * unitPriceCents * (1 - discountRate) * (1 + taxRate))`
 * - Always computes `grandTotalDzd` and `grandTotalDzdFormatted` (converted via `rate_to_da`)
 *   alongside the selected currency's `grandTotalFormatted`.
 * - REFUSES to compute a grand total if any selected item has NULL price; lists those items
 *   under `"price not entered — set price to include in total"`.
 */
export function evaluateStandaloneCalculator(input: {
  items: readonly CalculatorLineInput[];
  discountPercent?: string | number | null;
  taxPercent?: string | number | null;
  currency?: string;
  rateToDa?: number | string;
  currencies?: readonly CurrencyRecord[];
}): CalculatorEvaluation {
  const defaultCurrency = input.currency || input.items[0]?.currency || 'USD';
  const activeRateToDa =
    input.rateToDa !== undefined
      ? Number(String(input.rateToDa).replace(',', '.')) || 1
      : getExchangeRateToDa(defaultCurrency, input.currencies);

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

    const itemSourceCurrency = item.currency || defaultCurrency;
    const lineDisplayCurrency = input.currency || itemSourceCurrency;

    if (item.unitPriceCents === null || item.unitPriceCents === undefined) {
      const nullLine: CalculatorLineEvaluation = {
        medicationId: item.medicationId,
        brandName: item.brandName,
        genericName: item.genericName ?? null,
        strength: item.strength ?? null,
        dosageForm: item.dosageForm ?? null,
        currency: lineDisplayCurrency,
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

    // If a calculator target currency was explicitly chosen and differs from the item's currency,
    // convert the unit price into the selected calculator currency using exact BigInt rational math.
    let effectiveUnitPriceCents = item.unitPriceCents;
    if (
      input.currency &&
      item.currency &&
      input.currency.trim().toUpperCase() !== item.currency.trim().toUpperCase()
    ) {
      const fromRate = getExchangeRateToDa(item.currency, input.currencies);
      const converted = convertCurrencyUnitsBetween(
        item.unitPriceCents,
        item.currency,
        fromRate,
        lineDisplayCurrency,
        activeRateToDa,
      );
      if (converted !== null) {
        effectiveUnitPriceCents = converted;
      }
    }

    const unitCentsBig = BigInt(effectiveUnitPriceCents);
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
      currency: lineDisplayCurrency,
      quantity: qty,
      unitPriceCents: effectiveUnitPriceCents,
      unitPriceMajor: isDzdCurrency(lineDisplayCurrency)
        ? formatDzdInteger(effectiveUnitPriceCents)
        : formatCentsToMajor(effectiveUnitPriceCents),
      unitPriceFormatted: formatMoneyDisplay(effectiveUnitPriceCents, lineDisplayCurrency, {
        currencies: input.currencies,
      }),
      hasNullPrice: false,
      lineSubtotalCents,
      lineSubtotalMajor: isDzdCurrency(lineDisplayCurrency)
        ? formatDzdInteger(lineSubtotalCents)
        : formatCentsToMajor(lineSubtotalCents),
      lineSubtotalFormatted: formatMoneyDisplay(lineSubtotalCents, lineDisplayCurrency, {
        currencies: input.currencies,
      }),
      lineFinalTotalCents,
      lineFinalTotalMajor: isDzdCurrency(lineDisplayCurrency)
        ? formatDzdInteger(lineFinalTotalCents)
        : formatCentsToMajor(lineFinalTotalCents),
      lineFinalTotalFormatted: formatMoneyDisplay(lineFinalTotalCents, lineDisplayCurrency, {
        currencies: input.currencies,
      }),
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
      grandTotalDzd: null,
      grandTotalDzdFormatted: 'price not entered — set price to include in total',
      exchangeRateToDa: activeRateToDa,
      currency: defaultCurrency,
    };
  }

  if (lines.length === 0) {
    const zeroMajor = isDzdCurrency(defaultCurrency) ? '0' : '0.00';
    return {
      lines: [],
      nullPriceItems: [],
      hasNullPriceItems: false,
      canComputeGrandTotal: false,
      blockingMessage: null,
      discountPercentDisplay,
      taxPercentDisplay,
      subtotalCents: 0,
      subtotalMajor: zeroMajor,
      subtotalFormatted: formatMoneyDisplay(0, defaultCurrency, { currencies: input.currencies }),
      discountAmountCents: 0,
      discountAmountMajor: zeroMajor,
      discountAmountFormatted: formatMoneyDisplay(0, defaultCurrency, {
        currencies: input.currencies,
      }),
      taxAmountCents: 0,
      taxAmountMajor: zeroMajor,
      taxAmountFormatted: formatMoneyDisplay(0, defaultCurrency, { currencies: input.currencies }),
      grandTotalCents: 0,
      grandTotalMajor: zeroMajor,
      grandTotalFormatted: formatMoneyDisplay(0, defaultCurrency, { currencies: input.currencies }),
      grandTotalDzd: 0,
      grandTotalDzdFormatted: formatMoneyDisplay(0, 'DZD'),
      exchangeRateToDa: activeRateToDa,
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

  const grandTotalDzd = convertCurrencyUnitsToDzd(
    grandTotalCents,
    defaultCurrency,
    activeRateToDa,
  );

  return {
    lines,
    nullPriceItems: [],
    hasNullPriceItems: false,
    canComputeGrandTotal: true,
    blockingMessage: null,
    discountPercentDisplay,
    taxPercentDisplay,
    subtotalCents,
    subtotalMajor: isDzdCurrency(defaultCurrency)
      ? formatDzdInteger(subtotalCents)
      : formatCentsToMajor(subtotalCents),
    subtotalFormatted: formatMoneyDisplay(subtotalCents, defaultCurrency, {
      currencies: input.currencies,
    }),
    discountAmountCents,
    discountAmountMajor: isDzdCurrency(defaultCurrency)
      ? formatDzdInteger(discountAmountCents)
      : formatCentsToMajor(discountAmountCents),
    discountAmountFormatted: formatMoneyDisplay(discountAmountCents, defaultCurrency, {
      currencies: input.currencies,
    }),
    taxAmountCents,
    taxAmountMajor: isDzdCurrency(defaultCurrency)
      ? formatDzdInteger(taxAmountCents)
      : formatCentsToMajor(taxAmountCents),
    taxAmountFormatted: formatMoneyDisplay(taxAmountCents, defaultCurrency, {
      currencies: input.currencies,
    }),
    grandTotalCents,
    grandTotalMajor: isDzdCurrency(defaultCurrency)
      ? formatDzdInteger(grandTotalCents)
      : formatCentsToMajor(grandTotalCents),
    grandTotalFormatted: formatMoneyDisplay(grandTotalCents, defaultCurrency, {
      currencies: input.currencies,
    }),
    grandTotalDzd,
    grandTotalDzdFormatted: formatMoneyDisplay(grandTotalDzd, 'DZD'),
    exchangeRateToDa: activeRateToDa,
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
  const requestedCurrency = input.currency?.trim().toUpperCase();

  let unitPriceCents: number | null;
  if (typeof input.unitPriceInput === 'number') {
    if (!Number.isInteger(input.unitPriceInput) || input.unitPriceInput <= 0) {
      throw new Error(
        `unit_price_cents must be a positive integer (received ${input.unitPriceInput})`,
      );
    }
    unitPriceCents = input.unitPriceInput;
  } else {
    const parsedUnit = parseMoneyInputToCents(input.unitPriceInput, {
      currency: requestedCurrency,
    });
    if (!parsedUnit.ok) {
      throw new Error(parsedUnit.error);
    }
    if (parsedUnit.cents === null) {
      throw new Error('Please enter a valid unit price (e.g. "1250", "12.50", or "12,50").');
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
      const parsedCost = parseMoneyInputToCents(input.costPriceInput, {
        allowZero: true,
        currency: requestedCurrency,
      });
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
      currency: requestedCurrency || undefined,
      currency_code: requestedCurrency || undefined,
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
