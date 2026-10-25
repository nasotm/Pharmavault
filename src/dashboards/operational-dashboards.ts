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
