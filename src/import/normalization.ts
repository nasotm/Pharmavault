/**
 * Name normalization, price parsing to integer cents, and RapidFuzz WRatio
 * fuzzy duplicate matching (`wRatio > 85` on normalized `brand_name`).
 */

const TRAILING_PUNCTUATION_RE = /[.,;:!?'"`~_\-\\/]+$/g;
const LEADING_PUNCTUATION_RE = /^[.,;:!?'"`~_\-\\/]+/g;

/**
 * Trims leading/trailing whitespace and collapses internal runs of whitespace to a single space.
 */
export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Strips trailing punctuation (and re-trims) from a string.
 */
export function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(TRAILING_PUNCTUATION_RE, '').trim();
}

/**
 * Converts a string to Title Case word-by-word while keeping dosage suffixes or
 * hyphenated segments readable.
 */
export function toTitleCase(value: string): string {
  if (!value) return '';
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word
        .split('-')
        .map((segment) => {
          if (!segment) return '';
          return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
        })
        .join('-'),
    )
    .join(' ');
}

/**
 * Deliverable 4: Name normalization:
 * trim, collapse whitespace, title-case brand names, strip trailing punctuation.
 */
export function normalizeBrandName(raw: string | null | undefined): string {
  if (!raw) return '';
  const stripped = stripTrailingPunctuation(raw).replace(LEADING_PUNCTUATION_RE, '');
  const collapsed = collapseWhitespace(stripped);
  return toTitleCase(collapsed);
}

/**
 * Normalizes a non-brand catalog/inventory text field:
 * trims, strips trailing punctuation, collapses whitespace, and returns null if empty.
 */
export function normalizeTextField(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = collapseWhitespace(stripTrailingPunctuation(raw));
  return cleaned === '' ? null : cleaned;
}

/**
 * Canonical normalized key for matching on (brand_name + strength + dosage_form)
 * when barcode is not matched.
 */
export function buildMedicationMatchKey(
  brandName: string | null | undefined,
  strength?: string | null | undefined,
  dosageForm?: string | null | undefined,
): string {
  const normBrand = normalizeBrandName(brandName ?? '').toLowerCase();
  const normStrength = (normalizeTextField(strength) ?? '').toLowerCase().replace(/\s+/g, '');
  const normForm = (normalizeTextField(dosageForm) ?? '').toLowerCase();
  return `${normBrand}|${normStrength}|${normForm}`;
}

export type PriceParseResult =
  | { ok: true; cents: number | null; error?: undefined }
  | { ok: false; cents?: undefined; error: string };

/**
 * Parses spreadsheet price strings such as "12,50", "12.50", "$12.50", "€ 12,50", "1,250.50"
 * strictly into integer minor units (cents).
 *
 * Constraints:
 * - Empty string / null / undefined -> `{ ok: true, cents: null }` (NULL = unknown, NEVER 0).
 * - Ambiguous or non-numeric values (e.g. "abc", "TBD", "12.345", "12.5.0", "-4.00", "$--")
 *   become per-row errors (`{ ok: false, error }`), NEVER coerced to 0.
 */
export function parsePriceToCents(raw: string | null | undefined): PriceParseResult {
  if (raw === null || raw === undefined) {
    return { ok: true, cents: null };
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, cents: null };
  }

  // Reject negative values explicitly
  if (trimmed.includes('-')) {
    return {
      ok: false,
      error: `Invalid negative or malformed price "${raw}"`,
    };
  }

  // Strip allowed leading/trailing currency symbols or ISO codes
  const withoutCurrency = trimmed
    .replace(/^(?:DZD|DA|USD|EUR|GBP|CAD|CHF|CNY|TRY|AED|SAR|CA\$|\$|€|£|¥|₺)\s*/i, '')
    .replace(/\s*(?:DZD|DA|USD|EUR|GBP|CAD|CHF|CNY|TRY|AED|SAR|CA\$|\$|€|£|¥|₺)$/i, '')
    .trim();

  if (withoutCurrency === '' || !/^[0-9.,]+$/.test(withoutCurrency)) {
    return {
      ok: false,
      error: `Non-numeric or ambiguous price value "${raw}"`,
    };
  }

  const dotCount = (withoutCurrency.match(/\./g) ?? []).length;
  const commaCount = (withoutCurrency.match(/,/g) ?? []).length;

  let wholePart: string;
  let fractionPart: string;

  if (dotCount === 0 && commaCount === 0) {
    // Pure integer major units, e.g. "12" -> 1200 cents
    wholePart = withoutCurrency;
    fractionPart = '00';
  } else if (dotCount === 1 && commaCount === 0) {
    const [left, right] = withoutCurrency.split('.');
    if (!left || right.length === 0 || right.length > 2 || right.length === 3) {
      return {
        ok: false,
        error: `Ambiguous decimal format in price "${raw}"`,
      };
    }
    wholePart = left;
    fractionPart = right.padEnd(2, '0');
  } else if (commaCount === 1 && dotCount === 0) {
    const [left, right] = withoutCurrency.split(',');
    // In European decimals, "12,50" or "12,5" has 1 or 2 digits after comma.
    // A 3-digit suffix like "12,500" is ambiguous between 12.500 and 12500.
    if (!left || right.length === 0 || right.length > 2) {
      return {
        ok: false,
        error: `Ambiguous comma decimal/thousands format in price "${raw}"`,
      };
    }
    wholePart = left;
    fractionPart = right.padEnd(2, '0');
  } else if (dotCount === 1 && commaCount >= 1) {
    const lastDot = withoutCurrency.lastIndexOf('.');
    const lastComma = withoutCurrency.lastIndexOf(',');
    if (lastDot > lastComma) {
      // Format like "1,250.50"
      const [left, right] = withoutCurrency.split('.');
      if (!/^([0-9]{1,3})(,[0-9]{3})+$/.test(left) || right.length === 0 || right.length > 2) {
        return {
          ok: false,
          error: `Ambiguous thousands/decimal separator in price "${raw}"`,
        };
      }
      wholePart = left.replace(/,/g, '');
      fractionPart = right.padEnd(2, '0');
    } else {
      // Format like "1.250,50"
      const [left, right] = withoutCurrency.split(',');
      if (!/^([0-9]{1,3})(\.[0-9]{3})+$/.test(left) || right.length === 0 || right.length > 2) {
        return {
          ok: false,
          error: `Ambiguous thousands/decimal separator in price "${raw}"`,
        };
      }
      wholePart = left.replace(/\./g, '');
      fractionPart = right.padEnd(2, '0');
    }
  } else if (commaCount === 1 && dotCount > 1) {
    // Format like "1.250.000,50"
    const [left, right] = withoutCurrency.split(',');
    if (!/^([0-9]{1,3})(\.[0-9]{3})+$/.test(left) || right.length === 0 || right.length > 2) {
      return {
        ok: false,
        error: `Ambiguous separators in price "${raw}"`,
      };
    }
    wholePart = left.replace(/\./g, '');
    fractionPart = right.padEnd(2, '0');
  } else {
    return {
      ok: false,
      error: `Malformed price value "${raw}"`,
    };
  }

  if (!/^[0-9]+$/.test(wholePart) || !/^[0-9]{2}$/.test(fractionPart)) {
    return {
      ok: false,
      error: `Invalid numeric digits in price "${raw}"`,
    };
  }

  const cents = Number(wholePart) * 100 + Number(fractionPart);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return {
      ok: false,
      error: `Price "${raw}" must be a positive amount greater than 0 cents`,
    };
  }

  return { ok: true, cents };
}

// =============================================================================
// RAPIDFUZZ WRatio IMPLEMENTATION (0..100 scale)
// =============================================================================

let dpPrev = new Int32Array(512);
let dpCurr = new Int32Array(512);

/**
 * Computes the Levenshtein insertion/deletion (Indel) distance between two strings,
 * where substitutions cost 2 and insertions/deletions cost 1 (matching RapidFuzz `fuzz.ratio`).
 */
export function indelDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  if (n + 1 > dpPrev.length) {
    dpPrev = new Int32Array(n + 64);
    dpCurr = new Int32Array(n + 64);
  }

  let prev = dpPrev;
  let curr = dpCurr;

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const charA = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      if (charA === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1];
      } else {
        const del = prev[j] + 1;
        const ins = curr[j - 1] + 1;
        const sub = prev[j - 1] + 2;
        const minDelIns = del < ins ? del : ins;
        curr[j] = minDelIns < sub ? minDelIns : sub;
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

/**
 * RapidFuzz `fuzz.ratio(s1, s2)` on a 0..100 scale.
 */
export function ratio(s1: string, s2: string): number {
  if (!s1 && !s2) return 100;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;
  const lensum = s1.length + s2.length;
  const dist = indelDistance(s1, s2);
  return ((lensum - dist) / lensum) * 100;
}

/**
 * RapidFuzz `fuzz.partial_ratio(s1, s2)` on a 0..100 scale.
 */
export function partialRatio(s1: string, s2: string): number {
  if (!s1 && !s2) return 100;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const shorter = s1.length <= s2.length ? s1 : s2;
  const longer = s1.length <= s2.length ? s2 : s1;
  const lenShort = shorter.length;
  const lenLong = longer.length;

  if (longer.includes(shorter)) {
    return 100;
  }

  let bestScore = 0;
  // Slide window across longer string (including partial overlaps at boundaries)
  for (let start = 0; start <= lenLong - 1; start++) {
    const sub = longer.slice(start, Math.min(lenLong, start + lenShort));
    const score = ratio(shorter, sub);
    if (score > bestScore) {
      bestScore = score;
      if (bestScore >= 100) break;
    }
  }

  return bestScore;
}

function tokenizeWords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * RapidFuzz `fuzz.token_sort_ratio(s1, s2)`.
 */
export function tokenSortRatio(s1: string, s2: string): number {
  const sorted1 = tokenizeWords(s1).sort().join(' ');
  const sorted2 = tokenizeWords(s2).sort().join(' ');
  return ratio(sorted1, sorted2);
}

/**
 * RapidFuzz `fuzz.partial_token_sort_ratio(s1, s2)`.
 */
export function partialTokenSortRatio(s1: string, s2: string): number {
  const sorted1 = tokenizeWords(s1).sort().join(' ');
  const sorted2 = tokenizeWords(s2).sort().join(' ');
  return partialRatio(sorted1, sorted2);
}

/**
 * RapidFuzz `fuzz.token_set_ratio(s1, s2)`.
 */
export function tokenSetRatio(s1: string, s2: string): number {
  const tokens1 = new Set(tokenizeWords(s1));
  const tokens2 = new Set(tokenizeWords(s2));

  if (tokens1.size === 0 && tokens2.size === 0) return 100;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  const intersection: string[] = [];
  const diff1: string[] = [];
  const diff2: string[] = [];

  for (const t of tokens1) {
    if (tokens2.has(t)) {
      intersection.push(t);
    } else {
      diff1.push(t);
    }
  }
  for (const t of tokens2) {
    if (!tokens1.has(t)) {
      diff2.push(t);
    }
  }

  intersection.sort();
  diff1.sort();
  diff2.sort();

  const sect = intersection.join(' ');
  const combined1 = [sect, diff1.join(' ')].filter(Boolean).join(' ');
  const combined2 = [sect, diff2.join(' ')].filter(Boolean).join(' ');

  const scores = [ratio(combined1, combined2)];
  if (sect.length > 0) {
    scores.push(ratio(sect, combined1), ratio(sect, combined2));
  }
  return Math.max(...scores);
}

/**
 * RapidFuzz `fuzz.partial_token_set_ratio(s1, s2)`.
 */
export function partialTokenSetRatio(s1: string, s2: string): number {
  const tokens1 = new Set(tokenizeWords(s1));
  const tokens2 = new Set(tokenizeWords(s2));

  if (tokens1.size === 0 && tokens2.size === 0) return 100;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  for (const t of tokens1) {
    if (tokens2.has(t)) {
      return 100;
    }
  }

  const diff1 = Array.from(tokens1).sort().join(' ');
  const diff2 = Array.from(tokens2).sort().join(' ');
  return partialRatio(diff1, diff2);
}

/**
 * RapidFuzz `fuzz.WRatio(s1, s2)` (Weighted Ratio, 0..100).
 * Compares normalized lowercased strings using base ratio, token_sort_ratio,
 * token_set_ratio, and length-scaled partial ratios.
 */
export function wRatio(raw1: string, raw2: string): number {
  const s1 = collapseWhitespace(raw1).toLowerCase();
  const s2 = collapseWhitespace(raw2).toLowerCase();

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const UNBASE_SCALE = 0.95;
  const lenRatio = Math.max(s1.length, s2.length) / Math.max(1, Math.min(s1.length, s2.length));

  let best = ratio(s1, s2);

  if (lenRatio < 1.5) {
    const tsr = tokenSortRatio(s1, s2) * UNBASE_SCALE;
    const tset = tokenSetRatio(s1, s2) * UNBASE_SCALE;
    best = Math.max(best, tsr, tset);
  } else {
    const partialScale = lenRatio > 8.0 ? 0.6 : 0.9;
    const pr = partialRatio(s1, s2) * partialScale;
    const ptsr = partialTokenSortRatio(s1, s2) * UNBASE_SCALE * partialScale;
    const ptset = partialTokenSetRatio(s1, s2) * UNBASE_SCALE * partialScale;
    best = Math.max(best, pr, ptsr, ptset);
  }

  return Math.round(best * 100) / 100;
}
