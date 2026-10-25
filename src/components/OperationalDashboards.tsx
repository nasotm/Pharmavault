import React, { useCallback, useEffect, useState } from 'react';
import {
  exportExpiringSoonToCsv,
  exportLowStockToCsv,
  queryExpiringSoonDashboard,
  queryLowStockDashboard,
  triggerCsvDownload,
  type ExpiringSoonDashboardResult,
  type LowStockDashboardRow,
} from '../dashboards';
import { getRepositoryDatabase } from '../db/repository';
import {
  dispenseStock,
  formatCurrentUserIdentifier,
  receiveStock,
  type CurrentUserProfile,
} from '../movements';

export interface OperationalDashboardsProps {
  refreshTrigger?: unknown;
  currentUser: CurrentUserProfile;
  onSelectMedication?: (medicationId: number) => void;
  onDatabaseMutated?: () => Promise<void> | void;
}

export const OperationalDashboards: React.FC<OperationalDashboardsProps> = ({
  refreshTrigger,
  currentUser,
  onSelectMedication,
  onDatabaseMutated,
}) => {
  const [lowStockRows, setLowStockRows] = useState<LowStockDashboardRow[]>([]);
  const [expiringResult, setExpiringResult] = useState<ExpiringSoonDashboardResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<{
    title: string;
    filename: string;
    content: string;
  } | null>(null);
  const [isRecordingSample, setIsRecordingSample] = useState<number | null>(null);

  const loadDashboards = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const db = getRepositoryDatabase();
      const [lowStock, expiringSoon] = await Promise.all([
        queryLowStockDashboard(db),
        queryExpiringSoonDashboard(db),
      ]);
      setLowStockRows(lowStock);
      setExpiringResult(expiringSoon);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboards();
  }, [loadDashboards, refreshTrigger]);

  const handleExportLowStockCsv = () => {
    const csv = exportLowStockToCsv(lowStockRows);
    const filename = `low-stock-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    triggerCsvDownload(filename, csv);
    setCsvPreview({
      title: 'Low-Stock Report CSV',
      filename,
      content: csv,
    });
  };

  const handleExportExpiringSoonCsv = () => {
    if (!expiringResult) return;
    const csv = exportExpiringSoonToCsv(expiringResult.groups);
    const filename = `expiring-soon-90d-${expiringResult.referenceDate}.csv`;
    triggerCsvDownload(filename, csv);
    setCsvPreview({
      title: 'Expiring-Soon (90 Days) CSV',
      filename,
      content: csv,
    });
  };

  const handleRecordUsageCycle = async (row: LowStockDashboardRow) => {
    setIsRecordingSample(row.medication_id);
    setError(null);
    try {
      const db = getRepositoryDatabase();
      const actor = formatCurrentUserIdentifier(currentUser);
      const receiptResult = await receiveStock(db, {
        medicationId: row.medication_id,
        lotNumber: `USAGE-CYCLE-${row.medication_id}`,
        expiryDate: '2027-06-30',
        quantity: 90,
        reason: 'Restock for 90-day demand cycle',
        userId: actor,
      });
      await dispenseStock(db, {
        medicationId: row.medication_id,
        batchId: receiptResult.batch.id,
        quantity: 90,
        reason: '90-day patient dispensing cycle',
        userId: actor,
      });
      await loadDashboards();
      if (onDatabaseMutated) {
        await onDatabaseMutated();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRecordingSample(null);
    }
  };

  return (
    <section
      id="operational-dashboards"
      data-testid="operational-dashboards-section"
      className="space-y-8"
    >
      {/* Dashboard Header & Export Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Pharmacy Operations Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitor medications below reorder threshold and batches expiring within the next 90
            days.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="export-low-stock-csv-btn"
            onClick={handleExportLowStockCsv}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
          >
            Export Low-Stock CSV ({lowStockRows.length})
          </button>
          <button
            type="button"
            data-testid="export-expiring-soon-csv-btn"
            onClick={handleExportExpiringSoonCsv}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
          >
            Export Expiring CSV ({expiringResult?.batches.length ?? 0})
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-800"
        >
          {error}
        </div>
      )}

      {csvPreview && (
        <div
          data-testid="csv-export-preview"
          className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-3"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs font-semibold text-slate-900">
              {csvPreview.title}{' '}
              <span className="font-mono font-normal text-slate-500">({csvPreview.filename})</span>
            </div>
            <button
              type="button"
              data-testid="close-csv-preview-btn"
              onClick={() => setCsvPreview(null)}
              className="px-3 py-1 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Close Preview
            </button>
          </div>
          <pre
            data-testid="csv-export-preview-content"
            className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 overflow-x-auto"
          >
            {csvPreview.content}
          </pre>
        </div>
      )}

      {/* Two-Column Card Layout: Low Stock Alerts & Expiring Soon */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Column 1: Low-Stock Medication Cards (Red/Orange Warning Indicator) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <h2 className="text-base font-bold text-slate-900">Low Stock Alerts</h2>
            </div>
            <span
              data-testid="low-stock-count-badge"
              className="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 rounded-lg"
            >
              {lowStockRows.length} {lowStockRows.length === 1 ? 'item requires' : 'items require'}{' '}
              attention
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-xs text-slate-500 text-center">
              Loading low-stock alerts...
            </div>
          ) : lowStockRows.length === 0 ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-sm text-slate-500 text-center">
              All medications are currently stocked above their reorder threshold.
            </div>
          ) : (
            <div data-testid="low-stock-table" className="space-y-4">
              {lowStockRows.map((row) => {
                const isZeroStock = row.current_qty === 0;
                return (
                  <div
                    key={row.medication_id}
                    data-testid={`low-stock-row-${row.medication_id}`}
                    className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-2xs hover:border-orange-300 transition-all space-y-4"
                  >
                    {/* Card Top: Warning Indicator + Brand + Location */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-md ${
                              isZeroStock
                                ? 'bg-red-50 text-red-800 border border-red-200'
                                : 'bg-orange-50 text-orange-800 border border-orange-200'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isZeroStock ? 'bg-red-600' : 'bg-orange-500'
                              }`}
                            />
                            {isZeroStock ? 'Out of Stock' : 'Low Stock'}
                          </span>
                          <h3 className="text-base font-bold text-slate-900">{row.brand_name}</h3>
                        </div>
                        <p className="text-xs text-slate-500">
                          {row.generic_name ?? 'Standard'} · {row.strength ?? '—'} ·{' '}
                          {row.dosage_form ?? '—'}
                        </p>
                      </div>

                      {/* Prominent Shelf Coordinates */}
                      <div
                        data-testid={`low-stock-location-${row.medication_id}`}
                        className="sm:text-right shrink-0"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Shelf Location
                        </div>
                        <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">
                          {row.location_label}
                        </div>
                        {row.location_note && (
                          <div className="text-[11px] text-slate-500">{row.location_note}</div>
                        )}
                      </div>
                    </div>

                    {/* Card Middle: Metrics & Reorder Suggestion */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50/80 border border-slate-200/70 rounded-xl">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">Current Stock</div>
                        <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
                          <strong
                            data-testid={`low-stock-current-qty-${row.medication_id}`}
                            className={`text-base font-bold ${
                              isZeroStock ? 'text-red-700' : 'text-orange-700'
                            }`}
                          >
                            {row.current_qty} units
                          </strong>
                          <span
                            data-testid={`low-stock-reorder-level-${row.medication_id}`}
                            className="text-xs text-slate-500"
                          >
                            / min {row.reorder_level}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-medium text-slate-500">Stock Level</div>
                        <div
                          data-testid={`low-stock-ratio-${row.medication_id}`}
                          className="mt-0.5 text-sm font-bold font-mono tabular-nums text-slate-800"
                        >
                          {(row.stock_to_reorder_ratio * 100).toFixed(0)}% of target
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-medium text-slate-500">
                          Suggested Reorder
                        </div>
                        <div className="mt-0.5">
                          {row.reorder_badge === 'suggested' && row.suggested_qty !== null ? (
                            <div className="space-y-0.5">
                              <span
                                data-testid={`low-stock-suggestion-${row.medication_id}`}
                                className="inline-block px-2 py-0.5 text-xs font-mono font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md tabular-nums"
                              >
                                Order +{row.suggested_qty} units
                              </span>
                              <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                                {row.avg_daily_usage.toFixed(1)}/day · {row.lead_time_days}d lead
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span
                                data-testid={`low-stock-fallback-badge-${row.medication_id}`}
                                className="inline-block px-2 py-0.5 text-xs font-mono font-semibold uppercase tracking-wide text-orange-800 bg-orange-50 border border-orange-200 rounded-md"
                              >
                                low
                              </span>
                              <div className="text-[10px] text-slate-500">
                                {row.outflow_movement_count_90d === 0
                                  ? 'Insufficient 90d usage history'
                                  : `${row.avg_daily_usage.toFixed(1)}/day · ${row.lead_time_days}d lead`}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card Bottom Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        data-testid={`low-stock-log-usage-btn-${row.medication_id}`}
                        disabled={isRecordingSample === row.medication_id}
                        onClick={() => void handleRecordUsageCycle(row)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isRecordingSample === row.medication_id
                          ? 'Updating usage...'
                          : 'Simulate 90d Usage'}
                      </button>

                      {onSelectMedication && (
                        <button
                          type="button"
                          onClick={() => onSelectMedication(row.medication_id)}
                          className="px-3.5 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors"
                        >
                          Open Medication &amp; Restock &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 2: Expiring-Soon Batch Cards (Yellow/Amber Warning Indicator) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <h2 className="text-base font-bold text-slate-900">Expiring Within 90 Days</h2>
            </div>
            <span
              data-testid="expiring-soon-count-badge"
              className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 rounded-lg"
            >
              {expiringResult?.batches.length ?? 0} batch
              {(expiringResult?.batches.length ?? 0) === 1 ? '' : 'es'}
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-xs text-slate-500 text-center">
              Checking batch expiry dates...
            </div>
          ) : !expiringResult || expiringResult.groups.length === 0 ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-sm text-slate-500 text-center">
              No active batches are expiring within the next 90 days.
            </div>
          ) : (
            <div data-testid="expiring-soon-groups" className="space-y-4">
              {expiringResult.groups.map((group) => (
                <div
                  key={group.medication_id}
                  data-testid={`expiring-group-${group.medication_id}`}
                  className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-2xs hover:border-amber-300 transition-all space-y-4"
                >
                  {/* Group Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 rounded-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Expiring Soon
                        </span>
                        <h3 className="text-base font-bold text-slate-900">{group.brand_name}</h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {group.generic_name ?? 'Standard'} · {group.strength ?? '—'}
                      </p>
                      <p className="text-xs font-mono font-semibold text-slate-700 mt-1">
                        {group.location_label}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="px-2.5 py-1 text-xs font-mono font-semibold bg-amber-50 text-amber-900 border border-amber-200 rounded-lg tabular-nums">
                        {group.total_expiring_qty} units
                      </span>
                    </div>
                  </div>

                  {/* Expiring Batches List */}
                  <div className="space-y-2">
                    {group.batches.map((batch) => (
                      <div
                        key={batch.batch_id}
                        data-testid={`expiring-batch-row-${batch.lot_number}`}
                        className="p-3 bg-amber-50/40 border border-amber-200/70 rounded-xl flex items-center justify-between gap-3 text-xs font-mono tabular-nums"
                      >
                        <div>
                          <div className="font-bold text-slate-900">Lot {batch.lot_number}</div>
                          <div className="text-slate-500 mt-0.5">Expires {batch.expiry_date}</div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span
                            data-testid={`expiring-batch-qty-${batch.lot_number}`}
                            className="font-semibold text-slate-800"
                          >
                            {batch.quantity} units
                          </span>
                          <span
                            data-testid={`expiring-batch-days-${batch.lot_number}`}
                            className={
                              batch.days_remaining <= 30
                                ? 'px-2 py-0.5 text-red-900 bg-red-100 border border-red-200 rounded-md font-semibold'
                                : 'px-2 py-0.5 text-amber-900 bg-amber-100 border border-amber-200 rounded-md font-semibold'
                            }
                          >
                            {batch.days_remaining}d left
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {onSelectMedication && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => onSelectMedication(group.medication_id)}
                        className="text-xs font-semibold text-sky-700 hover:text-sky-800 hover:underline"
                      >
                        Inspect batches &amp; dispense &rarr;
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
