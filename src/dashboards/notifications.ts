import type { DatabasePort } from '../db/port';
import {
  queryLowStockDashboard,
  queryExpiringSoonDashboard,
  type LowStockDashboardRow,
  type ExpiringBatchRow,
} from './operational-dashboards';

export interface ExpiredBatchRow {
  batch_id: number;
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  lot_number: string;
  quantity: number;
  expiry_date: string;
  days_remaining: number;
}

export interface NotificationAlerts {
  lowStockItems: LowStockDashboardRow[];
  expiringSoonBatches: ExpiringBatchRow[];
  expiredBatches: ExpiredBatchRow[];
  totalAlertsCount: number;
}

export const EXPIRED_BATCHES_SQL = `
SELECT
  b.id AS batch_id,
  b.medication_id,
  m.brand_name,
  m.generic_name,
  b.lot_number,
  b.quantity,
  b.expiry_date,
  CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) AS days_remaining
FROM batch b
INNER JOIN medication m ON m.id = b.medication_id
WHERE b.quantity > 0
  AND date(b.expiry_date) IS NOT NULL
  AND CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) < 0
ORDER BY date(b.expiry_date) ASC, b.id ASC;
`;

export async function queryNotificationAlerts(
  db: DatabasePort,
  referenceDateStr?: string,
): Promise<NotificationAlerts> {
  const refDate = (referenceDateStr ?? new Date().toISOString()).slice(0, 10);

  // 1. Low stock items (stock <= reorder_level)
  const lowStockItems = await queryLowStockDashboard(db, {
    referenceTimestamp: referenceDateStr,
  });

  // 2. Batches expiring in next 30 days (0 <= days_remaining <= 30)
  const expiringSoonResult = await queryExpiringSoonDashboard(db, {
    referenceDate: refDate,
    withinDays: 30,
  });
  const expiringSoonBatches = expiringSoonResult.batches;

  // 3. Expired batches (days_remaining < 0)
  const rawExpiredRows = await db.query<{
    batch_id: number;
    medication_id: number;
    brand_name: string;
    generic_name: string | null;
    lot_number: string;
    quantity: number;
    expiry_date: string;
    days_remaining: number;
  }>(EXPIRED_BATCHES_SQL, [refDate, refDate]);

  const expiredBatches: ExpiredBatchRow[] = rawExpiredRows.map((row) => ({
    batch_id: Number(row.batch_id),
    medication_id: Number(row.medication_id),
    brand_name: row.brand_name,
    generic_name: row.generic_name,
    lot_number: row.lot_number,
    quantity: Number(row.quantity),
    expiry_date: row.expiry_date,
    days_remaining: Number(row.days_remaining),
  }));

  const totalAlertsCount =
    lowStockItems.length + expiringSoonBatches.length + expiredBatches.length;

  return {
    lowStockItems,
    expiringSoonBatches,
    expiredBatches,
    totalAlertsCount,
  };
}
