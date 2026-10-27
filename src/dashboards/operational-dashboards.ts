import type { DatabasePort } from '../db/port';
import { formatLocationString } from '../search';

export interface LowStockDashboardRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  barcode: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  location_label: string;
  current_qty: number;
  reorder_level: number;
  /**
   * Deterministic SQL ratio:
   * CASE WHEN reorder_level <= 0 THEN 0.0 ELSE CAST(current_qty AS REAL) / CAST(reorder_level AS REAL) END
   */
  stock_to_reorder_ratio: number;
  /** Per-medication field, default 7 in SQL if NULL or <= 0 */
  lead_time_days: number;
  /** Total negative movement units over the last 90 days from SQL */
  total_outflow_90d: number;
  /** Number of negative stock_movement records in the last 90 days from SQL */
  outflow_movement_count_90d: number;
  /** Deterministic SQL: CAST(total_outflow_90d AS REAL) / 90.0 */
  avg_daily_usage: number;
  /**
   * Unclamped SQL formula value:
   * ceil(avg_daily_usage * lead_time_days * 1.3) - current_qty
   */
  formula_suggested_qty: number;
  /**
   * Positive reorder suggestion when sufficient 90-day movement history exists,
   * or null when falling back to the plain "low" badge.
   */
  suggested_qty: number | null;
  has_sufficient_history: 0 | 1;
  reorder_badge: 'suggested' | 'low';
}

export interface ExpiringBatchRow {
  batch_id: number;
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  location_label: string;
  lot_number: string;
  quantity: number;
  expiry_date: string;
  days_remaining: number;
}

export interface ExpiringMedicationGroup {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  location_label: string;
  earliest_expiry_date: string;
  min_days_remaining: number;
  total_expiring_qty: number;
  batches: ExpiringBatchRow[];
}

export interface ExpiringSoonDashboardResult {
  referenceDate: string;
  horizonDays: number;
  batches: ExpiringBatchRow[];
  groups: ExpiringMedicationGroup[];
}

export interface LowStockQueryOptions {
  /**
   * ISO timestamp or YYYY-MM-DD reference point for the 90-day stock_movement window.
   * Defaults to current UTC timestamp (`new Date().toISOString()`).
   */
  referenceTimestamp?: string;
}

export interface ExpiringSoonQueryOptions {
  /**
   * Reference date (YYYY-MM-DD or ISO timestamp) for computing days_remaining in SQL.
   * Defaults to current UTC date (`new Date().toISOString().slice(0, 10)`).
   */
  referenceDate?: string;
  /**
   * Number of days ahead to include. Defaults to 90.
   */
  withinDays?: number;
}

export interface TopDispensedMedicationRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  location_label: string;
  reorder_level: number;
  current_qty: number;
  /**
   * Sum of negative deltas (-delta) with reason 'dispense' over the last 7 days from SQL.
   */
  dispensed_7d: number;
  /**
   * Count of dispense movements over the last 7 days from SQL.
   */
  dispense_count_7d: number;
  /**
   * Sum of negative deltas (-delta) with reason 'dispense' in the prior 7-day window (-14d to -7d) from SQL.
   */
  dispensed_prev_7d: number;
  /**
   * Deterministic SQL percentage change vs. prior 7 days:
   * ROUND(((CAST(dispensed_7d - dispensed_prev_7d AS REAL) / CAST(dispensed_prev_7d AS REAL)) * 100.0), 0)
   * or null when dispensed_prev_7d == 0.
   */
  pct_change_vs_prev_7d: number | null;
}

export interface TopDispensedQueryOptions {
  /**
   * ISO timestamp reference point for the 7-day stock_movement window.
   * Defaults to current UTC timestamp.
   */
  referenceTimestamp?: string;
  /**
   * Maximum rows to return. Defaults to 5.
   */
  limit?: number;
}

/**
 * Deterministic SQL query for Deliverable 1 & Deliverable 3:
 * - Filters medications where SUM(batch.quantity) <= reorder_level
 * - Handles divide-by-zero when reorder_level is 0
 * - Sorts by (quantity / reorder_level) ascending
 * - Computes avg_daily_usage from stock_movement over the last 90 days
 * - Computes suggested_qty = ceil(avg_daily_usage * lead_time_days * 1.3) - current_qty
 *   entirely in SQL (using integer ceiling arithmetic that works on every SQLite build).
 */
export const LOW_STOCK_DASHBOARD_SQL = `
WITH batch_totals AS (
  SELECT
    b.medication_id,
    COALESCE(SUM(b.quantity), 0) AS current_qty
  FROM batch b
  GROUP BY b.medication_id
),
usage_90d AS (
  SELECT
    sm.medication_id,
    COALESCE(SUM(CASE WHEN sm.delta < 0 THEN -sm.delta ELSE 0 END), 0) AS total_outflow_90d,
    COALESCE(SUM(CASE WHEN sm.delta < 0 THEN 1 ELSE 0 END), 0) AS outflow_movement_count_90d
  FROM stock_movement sm
  WHERE datetime(sm.created_at) >= datetime(?, '-90 days')
    AND datetime(sm.created_at) <= datetime(?)
  GROUP BY sm.medication_id
),
computed AS (
  SELECT
    m.id AS medication_id,
    m.brand_name,
    m.generic_name,
    m.strength,
    m.dosage_form,
    m.barcode,
    m.zone,
    m.shelf,
    m.bin,
    m.location_note,
    COALESCE(bt.current_qty, 0) AS current_qty,
    m.reorder_level,
    CASE
      WHEN m.reorder_level <= 0 THEN 0.0
      ELSE CAST(COALESCE(bt.current_qty, 0) AS REAL) / CAST(m.reorder_level AS REAL)
    END AS stock_to_reorder_ratio,
    CASE
      WHEN m.lead_time_days IS NULL OR m.lead_time_days <= 0 THEN 7
      ELSE m.lead_time_days
    END AS lead_time_days,
    COALESCE(u.total_outflow_90d, 0) AS total_outflow_90d,
    COALESCE(u.outflow_movement_count_90d, 0) AS outflow_movement_count_90d,
    CAST(COALESCE(u.total_outflow_90d, 0) AS REAL) / 90.0 AS avg_daily_usage,
    (
      (CAST(COALESCE(u.total_outflow_90d, 0) AS REAL) / 90.0) *
      CAST(
        CASE
          WHEN m.lead_time_days IS NULL OR m.lead_time_days <= 0 THEN 7
          ELSE m.lead_time_days
        END AS REAL
      ) * 1.3
    ) AS raw_target_qty
  FROM medication m
  LEFT JOIN batch_totals bt ON bt.medication_id = m.id
  LEFT JOIN usage_90d u ON u.medication_id = m.id
  WHERE COALESCE(bt.current_qty, 0) <= m.reorder_level
),
final_calc AS (
  SELECT
    c.*,
    (
      CASE
        WHEN c.raw_target_qty > CAST(c.raw_target_qty AS INTEGER)
          THEN CAST(c.raw_target_qty AS INTEGER) + 1
        ELSE CAST(c.raw_target_qty AS INTEGER)
      END - c.current_qty
    ) AS formula_suggested_qty
  FROM computed c
)
SELECT
  fc.medication_id,
  fc.brand_name,
  fc.generic_name,
  fc.strength,
  fc.dosage_form,
  fc.barcode,
  fc.zone,
  fc.shelf,
  fc.bin,
  fc.location_note,
  fc.current_qty,
  fc.reorder_level,
  fc.stock_to_reorder_ratio,
  fc.lead_time_days,
  fc.total_outflow_90d,
  fc.outflow_movement_count_90d,
  fc.avg_daily_usage,
  fc.formula_suggested_qty,
  CASE
    WHEN fc.outflow_movement_count_90d > 0 AND fc.formula_suggested_qty > 0
      THEN fc.formula_suggested_qty
    ELSE NULL
  END AS suggested_qty,
  CASE
    WHEN fc.outflow_movement_count_90d > 0 AND fc.formula_suggested_qty > 0
      THEN 1
    ELSE 0
  END AS has_sufficient_history,
  CASE
    WHEN fc.outflow_movement_count_90d > 0 AND fc.formula_suggested_qty > 0
      THEN 'suggested'
    ELSE 'low'
  END AS reorder_badge
FROM final_calc fc
ORDER BY
  fc.stock_to_reorder_ratio ASC,
  fc.current_qty ASC,
  fc.medication_id ASC;
`;

/**
 * Deterministic SQL query for Deliverable 2:
 * - Batches expiring within 90 days (0 <= days_remaining <= withinDays, quantity > 0)
 * - Sorted by expiry_date ascending, then medication_id and batch_id
 * - Computes days_remaining directly in SQL via julianday()
 */
export const EXPIRING_SOON_DASHBOARD_SQL = `
SELECT
  b.id AS batch_id,
  b.medication_id,
  m.brand_name,
  m.generic_name,
  m.strength,
  m.dosage_form,
  m.zone,
  m.shelf,
  m.bin,
  m.location_note,
  b.lot_number,
  b.quantity,
  b.expiry_date,
  CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) AS days_remaining
FROM batch b
INNER JOIN medication m ON m.id = b.medication_id
WHERE b.quantity > 0
  AND date(b.expiry_date) IS NOT NULL
  AND CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) >= 0
  AND CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) <= ?
ORDER BY
  date(b.expiry_date) ASC,
  b.id ASC;
`;

interface RawLowStockSqlRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  barcode: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  current_qty: number;
  reorder_level: number;
  stock_to_reorder_ratio: number;
  lead_time_days: number;
  total_outflow_90d: number;
  outflow_movement_count_90d: number;
  avg_daily_usage: number;
  formula_suggested_qty: number;
  suggested_qty: number | null;
  has_sufficient_history: number;
  reorder_badge: 'suggested' | 'low';
}

interface RawExpiringBatchSqlRow {
  batch_id: number;
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  lot_number: string;
  quantity: number;
  expiry_date: string;
  days_remaining: number;
}

/**
 * Queries the low-stock list and reorder suggestions using deterministic SQL.
 */
export async function queryLowStockDashboard(
  db: DatabasePort,
  options: LowStockQueryOptions = {},
): Promise<LowStockDashboardRow[]> {
  const referenceTimestamp = options.referenceTimestamp ?? new Date().toISOString();

  const rawRows = await db.query<RawLowStockSqlRow>(LOW_STOCK_DASHBOARD_SQL, [
    referenceTimestamp,
    referenceTimestamp,
  ]);

  return rawRows.map((row) => ({
    medication_id: Number(row.medication_id),
    brand_name: row.brand_name,
    generic_name: row.generic_name,
    strength: row.strength,
    dosage_form: row.dosage_form,
    barcode: row.barcode,
    zone: row.zone,
    shelf: row.shelf,
    bin: row.bin,
    location_note: row.location_note,
    location_label: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
    current_qty: Number(row.current_qty),
    reorder_level: Number(row.reorder_level),
    stock_to_reorder_ratio: Number(row.stock_to_reorder_ratio),
    lead_time_days: Number(row.lead_time_days),
    total_outflow_90d: Number(row.total_outflow_90d),
    outflow_movement_count_90d: Number(row.outflow_movement_count_90d),
    avg_daily_usage: Number(row.avg_daily_usage),
    formula_suggested_qty: Number(row.formula_suggested_qty),
    suggested_qty: row.suggested_qty === null ? null : Number(row.suggested_qty),
    has_sufficient_history: Number(row.has_sufficient_history) === 1 ? 1 : 0,
    reorder_badge: row.reorder_badge === 'suggested' ? 'suggested' : 'low',
  }));
}

/**
 * Queries batches expiring within 90 days, sorted by expiry date and grouped by medication.
 */
export async function queryExpiringSoonDashboard(
  db: DatabasePort,
  options: ExpiringSoonQueryOptions = {},
): Promise<ExpiringSoonDashboardResult> {
  const referenceDate = (options.referenceDate ?? new Date().toISOString()).slice(0, 10);
  const horizonDays = options.withinDays ?? 90;

  const rawRows = await db.query<RawExpiringBatchSqlRow>(EXPIRING_SOON_DASHBOARD_SQL, [
    referenceDate,
    referenceDate,
    referenceDate,
    horizonDays,
  ]);

  const batches: ExpiringBatchRow[] = rawRows.map((row) => ({
    batch_id: Number(row.batch_id),
    medication_id: Number(row.medication_id),
    brand_name: row.brand_name,
    generic_name: row.generic_name,
    strength: row.strength,
    dosage_form: row.dosage_form,
    zone: row.zone,
    shelf: row.shelf,
    bin: row.bin,
    location_note: row.location_note,
    location_label: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
    lot_number: row.lot_number,
    quantity: Number(row.quantity),
    expiry_date: row.expiry_date,
    days_remaining: Number(row.days_remaining),
  }));

  // Group by medication while preserving the SQL expiry_date ascending order:
  // Since `batches` is already sorted by `expiry_date ASC, batch_id ASC`, the first time a
  // medication appears is guaranteed to be its earliest expiring batch.
  const groupMap = new Map<number, ExpiringMedicationGroup>();
  for (const batch of batches) {
    const existing = groupMap.get(batch.medication_id);
    if (!existing) {
      groupMap.set(batch.medication_id, {
        medication_id: batch.medication_id,
        brand_name: batch.brand_name,
        generic_name: batch.generic_name,
        strength: batch.strength,
        dosage_form: batch.dosage_form,
        zone: batch.zone,
        shelf: batch.shelf,
        bin: batch.bin,
        location_note: batch.location_note,
        location_label: batch.location_label,
        earliest_expiry_date: batch.expiry_date,
        min_days_remaining: batch.days_remaining,
        total_expiring_qty: batch.quantity,
        batches: [batch],
      });
    } else {
      existing.total_expiring_qty += batch.quantity;
      existing.batches.push(batch);
    }
  }

  return {
    referenceDate,
    horizonDays,
    batches,
    groups: Array.from(groupMap.values()),
  };
}

/**
 * Escapes a single CSV cell according to RFC 4180.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Deliverable 4: Exports the Low-Stock dashboard list to CSV.
 */
export function exportLowStockToCsv(rows: readonly LowStockDashboardRow[]): string {
  const headers = [
    'medication_id',
    'brand_name',
    'generic_name',
    'strength',
    'dosage_form',
    'zone',
    'shelf',
    'bin',
    'location_note',
    'current_qty',
    'reorder_level',
    'stock_to_reorder_ratio',
    'lead_time_days',
    'avg_daily_usage',
    'suggested_qty',
    'reorder_status',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const record = [
      row.medication_id,
      row.brand_name,
      row.generic_name ?? '',
      row.strength ?? '',
      row.dosage_form ?? '',
      row.zone ?? '',
      row.shelf ?? '',
      row.bin ?? '',
      row.location_note ?? '',
      row.current_qty,
      row.reorder_level,
      Number(row.stock_to_reorder_ratio.toFixed(4)),
      row.lead_time_days,
      Number(row.avg_daily_usage.toFixed(4)),
      row.suggested_qty !== null ? row.suggested_qty : '',
      row.reorder_badge === 'suggested' ? `Reorder ${row.suggested_qty}` : 'low',
    ];
    lines.push(record.map(escapeCsvCell).join(','));
  }

  return lines.join('\n');
}

/**
 * Deliverable 4: Exports the Expiring-Soon dashboard list to CSV.
 */
export function exportExpiringSoonToCsv(
  input: readonly ExpiringMedicationGroup[] | readonly ExpiringBatchRow[],
): string {
  const headers = [
    'medication_id',
    'brand_name',
    'generic_name',
    'strength',
    'dosage_form',
    'lot_number',
    'quantity',
    'expiry_date',
    'days_remaining',
    'zone',
    'shelf',
    'bin',
  ];

  const flatBatches: ExpiringBatchRow[] = [];
  for (const item of input) {
    if ('batches' in item) {
      flatBatches.push(...item.batches);
    } else {
      flatBatches.push(item);
    }
  }

  const lines = [headers.join(',')];
  for (const batch of flatBatches) {
    const record = [
      batch.medication_id,
      batch.brand_name,
      batch.generic_name ?? '',
      batch.strength ?? '',
      batch.dosage_form ?? '',
      batch.lot_number,
      batch.quantity,
      batch.expiry_date,
      batch.days_remaining,
      batch.zone ?? '',
      batch.shelf ?? '',
      batch.bin ?? '',
    ];
    lines.push(record.map(escapeCsvCell).join(','));
  }

  return lines.join('\n');
}

/**
 * Triggers a browser file download for a CSV string.
 */
export function triggerCsvDownload(filename: string, csvContent: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return;
  }
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', filename);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Deterministic SQL query for "Top 5 Most Dispensed" over the last 7 days:
 * - Sums negative deltas (`-sm.delta` where `sm.delta < 0`) with reason `'dispense'`
 *   over the last 7 days (`datetime(sm.created_at) >= datetime(?, '-7 days') AND datetime(sm.created_at) <= datetime(?)`).
 * - Also computes the prior 7-day window (`-14 days` to `-7 days`) and exact percentage change
 *   entirely in SQL so the AI Assistant never performs arithmetic or invents numbers.
 */
export const TOP_DISPENSED_7D_SQL = `
WITH batch_totals AS (
  SELECT
    b.medication_id,
    COALESCE(SUM(b.quantity), 0) AS current_qty
  FROM batch b
  GROUP BY b.medication_id
),
dispense_windows AS (
  SELECT
    sm.medication_id,
    COALESCE(
      SUM(
        CASE
          WHEN sm.delta < 0
            AND (
              LOWER(TRIM(COALESCE(sm.reason, ''))) = 'dispense'
              OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE 'dispense:%'
              OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE '%dispense%'
            )
            AND datetime(sm.created_at) >= datetime(?, '-7 days')
            AND datetime(sm.created_at) <= datetime(?)
          THEN -sm.delta
          ELSE 0
        END
      ),
      0
    ) AS dispensed_7d,
    COALESCE(
      SUM(
        CASE
          WHEN sm.delta < 0
            AND (
              LOWER(TRIM(COALESCE(sm.reason, ''))) = 'dispense'
              OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE 'dispense:%'
              OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE '%dispense%'
            )
            AND datetime(sm.created_at) >= datetime(?, '-7 days')
            AND datetime(sm.created_at) <= datetime(?)
          THEN 1
          ELSE 0
        END
      ),
      0
    ) AS dispense_count_7d,
    COALESCE(
      SUM(
        CASE
          WHEN sm.delta < 0
            AND (
              LOWER(TRIM(COALESCE(sm.reason, ''))) = 'dispense'
              OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE 'dispense:%'
              OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE '%dispense%'
            )
            AND datetime(sm.created_at) >= datetime(?, '-14 days')
            AND datetime(sm.created_at) < datetime(?, '-7 days')
          THEN -sm.delta
          ELSE 0
        END
      ),
      0
    ) AS dispensed_prev_7d
  FROM stock_movement sm
  GROUP BY sm.medication_id
)
SELECT
  m.id AS medication_id,
  m.brand_name,
  m.generic_name,
  m.strength,
  m.dosage_form,
  m.zone,
  m.shelf,
  m.bin,
  m.location_note,
  m.reorder_level,
  COALESCE(bt.current_qty, 0) AS current_qty,
  dw.dispensed_7d,
  dw.dispense_count_7d,
  dw.dispensed_prev_7d,
  CASE
    WHEN dw.dispensed_prev_7d > 0
      THEN ROUND(((CAST(dw.dispensed_7d - dw.dispensed_prev_7d AS REAL) / CAST(dw.dispensed_prev_7d AS REAL)) * 100.0), 0)
    ELSE NULL
  END AS pct_change_vs_prev_7d
FROM dispense_windows dw
INNER JOIN medication m ON m.id = dw.medication_id
LEFT JOIN batch_totals bt ON bt.medication_id = m.id
WHERE dw.dispensed_7d > 0
ORDER BY
  dw.dispensed_7d DESC,
  m.brand_name ASC,
  m.id ASC
LIMIT ?;
`;

interface RawTopDispensedSqlRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  reorder_level: number;
  current_qty: number;
  dispensed_7d: number;
  dispense_count_7d: number;
  dispensed_prev_7d: number;
  pct_change_vs_prev_7d: number | null;
}

/**
 * Queries the Top 5 Most Dispensed medications over the last 7 days based on `stock_movement`
 * (sum of negative deltas with reason 'dispense').
 */
export async function queryTopDispensedMedications(
  db: DatabasePort,
  options: TopDispensedQueryOptions = {},
): Promise<TopDispensedMedicationRow[]> {
  const referenceTimestamp =
    options.referenceTimestamp ?? new Date(Date.now() + 1000).toISOString();
  const limit =
    typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : 5;

  const rawRows = await db.query<RawTopDispensedSqlRow>(TOP_DISPENSED_7D_SQL, [
    referenceTimestamp,
    referenceTimestamp,
    referenceTimestamp,
    referenceTimestamp,
    referenceTimestamp,
    referenceTimestamp,
    limit,
  ]);

  return rawRows.map((row) => ({
    medication_id: Number(row.medication_id),
    brand_name: String(row.brand_name),
    generic_name:
      row.generic_name === null || row.generic_name === undefined
        ? null
        : String(row.generic_name),
    strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
    dosage_form:
      row.dosage_form === null || row.dosage_form === undefined ? null : String(row.dosage_form),
    zone: row.zone === null || row.zone === undefined ? null : String(row.zone),
    shelf: row.shelf === null || row.shelf === undefined ? null : String(row.shelf),
    bin: row.bin === null || row.bin === undefined ? null : String(row.bin),
    location_note:
      row.location_note === null || row.location_note === undefined
        ? null
        : String(row.location_note),
    location_label: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
    reorder_level: Number(row.reorder_level),
    current_qty: Number(row.current_qty),
    dispensed_7d: Number(row.dispensed_7d),
    dispense_count_7d: Number(row.dispense_count_7d),
    dispensed_prev_7d: Number(row.dispensed_prev_7d),
    pct_change_vs_prev_7d:
      row.pct_change_vs_prev_7d === null || row.pct_change_vs_prev_7d === undefined
        ? null
        : Number(row.pct_change_vs_prev_7d),
  }));
}

export interface StockoutPredictionRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  location_label: string;
  current_stock: number;
  reorder_level: number;
  /** Total negative stock movement units (-delta where delta < 0) over the last 30 days */
  total_outflow_30d: number;
  /** Count of negative stock movement records over the last 30 days */
  outflow_movement_count_30d: number;
  /** Deterministic average daily usage over 30 days: total_outflow_30d / 30 */
  avg_daily_usage: number;
  /** Deterministic Days Remaining = Current Stock / Avg Daily Usage (null if avg_daily_usage <= 0) */
  days_remaining: number | null;
  /** True when negative stock movement history exists in the last 30 days */
  has_sufficient_history: boolean;
  /** True when Days Remaining < 7 and has_sufficient_history is true */
  is_critical_prediction: boolean;
  /** Human-readable deterministic status label */
  prediction_label: 'Critical Prediction' | 'Stable' | 'Insufficient History';
}

export interface StockoutPredictionQueryOptions {
  /**
   * ISO timestamp reference point for the 30-day stock_movement window.
   * Defaults to current UTC timestamp.
   */
  referenceTimestamp?: string;
  /**
   * When true, filters to only medications with sufficient 30-day movement history.
   * Defaults to false so all medications and their deterministic metrics are returned.
   */
  onlyWithHistory?: boolean;
}

/**
 * Pure deterministic TypeScript calculation for stockout prediction metrics.
 * Never uses the LLM for any arithmetic.
 * - avgDailyUsage = totalOutflow30d / 30
 * - daysRemaining = currentStock / avgDailyUsage (when hasSufficientHistory)
 * - isCriticalPrediction = hasSufficientHistory && daysRemaining < 7
 */
export function calculateStockoutPredictionMetrics(input: {
  currentStock: number;
  totalOutflow30d: number;
  outflowMovementCount30d: number;
}): {
  avgDailyUsage: number;
  daysRemaining: number | null;
  hasSufficientHistory: boolean;
  isCriticalPrediction: boolean;
  predictionLabel: 'Critical Prediction' | 'Stable' | 'Insufficient History';
} {
  const safeStock = Math.max(0, Number(input.currentStock) || 0);
  const safeOutflow = Math.max(0, Number(input.totalOutflow30d) || 0);
  const safeCount = Math.max(0, Math.trunc(Number(input.outflowMovementCount30d) || 0));

  const hasSufficientHistory = safeCount > 0 && safeOutflow > 0;
  const avgDailyUsage = safeOutflow / 30.0;
  const daysRemaining =
    hasSufficientHistory && avgDailyUsage > 0 ? safeStock / avgDailyUsage : null;
  const isCriticalPrediction =
    hasSufficientHistory && daysRemaining !== null && daysRemaining < 7.0;

  const predictionLabel: 'Critical Prediction' | 'Stable' | 'Insufficient History' =
    !hasSufficientHistory
      ? 'Insufficient History'
      : isCriticalPrediction
        ? 'Critical Prediction'
        : 'Stable';

  return {
    avgDailyUsage,
    daysRemaining,
    hasSufficientHistory,
    isCriticalPrediction,
    predictionLabel,
  };
}

/**
 * Deterministic SQL query for AI Stockout Prediction over the last 30 days:
 * 1. Calculates average daily usage (based on negative stock movements over the last 30 days) for each medication.
 * 2. Calculates Days Remaining = Current Stock / Avg Daily Usage.
 * 3. Flags Critical Prediction when Days Remaining < 7 and there is enough 30-day movement history.
 */
export const STOCKOUT_PREDICTION_30D_SQL = `
WITH batch_totals AS (
  SELECT
    b.medication_id,
    COALESCE(SUM(b.quantity), 0) AS current_stock
  FROM batch b
  GROUP BY b.medication_id
),
usage_30d AS (
  SELECT
    sm.medication_id,
    COALESCE(SUM(CASE WHEN sm.delta < 0 THEN -sm.delta ELSE 0 END), 0) AS total_outflow_30d,
    COALESCE(SUM(CASE WHEN sm.delta < 0 THEN 1 ELSE 0 END), 0) AS outflow_movement_count_30d
  FROM stock_movement sm
  WHERE datetime(sm.created_at) >= datetime(?, '-30 days')
    AND datetime(sm.created_at) <= datetime(?)
  GROUP BY sm.medication_id
),
computed AS (
  SELECT
    m.id AS medication_id,
    m.brand_name,
    m.generic_name,
    m.strength,
    m.dosage_form,
    m.zone,
    m.shelf,
    m.bin,
    m.location_note,
    m.reorder_level,
    COALESCE(bt.current_stock, 0) AS current_stock,
    COALESCE(u.total_outflow_30d, 0) AS total_outflow_30d,
    COALESCE(u.outflow_movement_count_30d, 0) AS outflow_movement_count_30d,
    CAST(COALESCE(u.total_outflow_30d, 0) AS REAL) / 30.0 AS avg_daily_usage,
    CASE
      WHEN COALESCE(u.outflow_movement_count_30d, 0) > 0 AND COALESCE(u.total_outflow_30d, 0) > 0
        THEN CAST(COALESCE(bt.current_stock, 0) AS REAL) / (CAST(COALESCE(u.total_outflow_30d, 0) AS REAL) / 30.0)
      ELSE NULL
    END AS days_remaining,
    CASE
      WHEN COALESCE(u.outflow_movement_count_30d, 0) > 0 AND COALESCE(u.total_outflow_30d, 0) > 0
        THEN 1
      ELSE 0
    END AS has_sufficient_history
  FROM medication m
  LEFT JOIN batch_totals bt ON bt.medication_id = m.id
  LEFT JOIN usage_30d u ON u.medication_id = m.id
)
SELECT
  c.medication_id,
  c.brand_name,
  c.generic_name,
  c.strength,
  c.dosage_form,
  c.zone,
  c.shelf,
  c.bin,
  c.location_note,
  c.reorder_level,
  c.current_stock,
  c.total_outflow_30d,
  c.outflow_movement_count_30d,
  c.avg_daily_usage,
  c.days_remaining,
  c.has_sufficient_history,
  CASE
    WHEN c.has_sufficient_history = 1 AND c.days_remaining IS NOT NULL AND c.days_remaining < 7.0
      THEN 1
    ELSE 0
  END AS is_critical_prediction
FROM computed c
ORDER BY
  c.has_sufficient_history DESC,
  CASE WHEN c.days_remaining IS NULL THEN 999999.0 ELSE c.days_remaining END ASC,
  c.current_stock ASC,
  c.medication_id ASC;
`;

interface RawStockoutPredictionSqlRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  reorder_level: number;
  current_stock: number;
  total_outflow_30d: number;
  outflow_movement_count_30d: number;
  avg_daily_usage: number;
  days_remaining: number | null;
  has_sufficient_history: number;
  is_critical_prediction: number;
}

/**
 * Queries deterministic 30-day stockout predictions for each medication.
 * Strictly uses SQL and TypeScript math — never invokes the LLM.
 */
export async function queryStockoutPredictions(
  db: DatabasePort,
  options: StockoutPredictionQueryOptions = {},
): Promise<StockoutPredictionRow[]> {
  const referenceTimestamp =
    options.referenceTimestamp ?? new Date(Date.now() + 1000).toISOString();

  const rawRows = await db.query<RawStockoutPredictionSqlRow>(STOCKOUT_PREDICTION_30D_SQL, [
    referenceTimestamp,
    referenceTimestamp,
  ]);

  const mapped = rawRows.map((row) => {
    const currentStock = Number(row.current_stock);
    const totalOutflow30d = Number(row.total_outflow_30d);
    const outflowMovementCount30d = Number(row.outflow_movement_count_30d);

    const metrics = calculateStockoutPredictionMetrics({
      currentStock,
      totalOutflow30d,
      outflowMovementCount30d,
    });

    return {
      medication_id: Number(row.medication_id),
      brand_name: String(row.brand_name),
      generic_name:
        row.generic_name === null || row.generic_name === undefined
          ? null
          : String(row.generic_name),
      strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
      dosage_form:
        row.dosage_form === null || row.dosage_form === undefined ? null : String(row.dosage_form),
      zone: row.zone === null || row.zone === undefined ? null : String(row.zone),
      shelf: row.shelf === null || row.shelf === undefined ? null : String(row.shelf),
      bin: row.bin === null || row.bin === undefined ? null : String(row.bin),
      location_note:
        row.location_note === null || row.location_note === undefined
          ? null
          : String(row.location_note),
      location_label: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
      current_stock: currentStock,
      reorder_level: Number(row.reorder_level),
      total_outflow_30d: totalOutflow30d,
      outflow_movement_count_30d: outflowMovementCount30d,
      avg_daily_usage: metrics.avgDailyUsage,
      days_remaining: metrics.daysRemaining,
      has_sufficient_history: metrics.hasSufficientHistory,
      is_critical_prediction: metrics.isCriticalPrediction,
      prediction_label: metrics.predictionLabel,
    };
  });

  if (options.onlyWithHistory) {
    return mapped.filter((row) => row.has_sufficient_history);
  }

  return mapped;
}


