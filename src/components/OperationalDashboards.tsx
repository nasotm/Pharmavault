import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle } from 'lucide-react';
import {
  exportExpiringSoonToCsv,
  exportLowStockToCsv,
  queryExpiringSoonDashboard,
  queryLowStockDashboard,
  queryStockoutPredictions,
  triggerCsvDownload,
  type ExpiringSoonDashboardResult,
  type LowStockDashboardRow,
  type StockoutPredictionRow,
} from '../dashboards';
import { getRepositoryDatabase } from '../db/repository';
import {
  dispenseStock,
  formatCurrentUserIdentifier,
  receiveStock,
  type CurrentUserProfile,
} from '../movements';
import {
  LOW_STOCK_BADGE_PULSE_ANIMATE,
  LOW_STOCK_BADGE_PULSE_TRANSITION,
} from '../utils/animations';
import { getExpiryVisualBadge } from '../utils/expiry';

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
  const [stockoutPredictions, setStockoutPredictions] = useState<StockoutPredictionRow[]>([]);
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
      const [lowStock, expiringSoon, predictions] = await Promise.all([
        queryLowStockDashboard(db),
        queryExpiringSoonDashboard(db),
        queryStockoutPredictions(db),
      ]);
      setLowStockRows(lowStock);
      setExpiringResult(expiringSoon);
      setStockoutPredictions(predictions);
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

  const handleRecordUsageCycle = async (medicationId: number) => {
    setIsRecordingSample(medicationId);
    setError(null);
    try {
      const db = getRepositoryDatabase();
      const actor = formatCurrentUserIdentifier(currentUser);
      const receiptResult = await receiveStock(db, {
        medicationId,
        lotNumber: `USAGE-CYCLE-${medicationId}`,
        expiryDate: '2027-06-30',
        quantity: 90,
        reason: 'Restock for 30d/90d demand cycle',
        userId: actor,
      });
      await dispenseStock(db, {
        medicationId,
        batchId: receiptResult.batch.id,
        quantity: 90,
        reason: 'dispense:30d_patient_cycle',
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

  const criticalPredictionsCount = stockoutPredictions.filter(
    (row) => row.is_critical_prediction,
  ).length;

  return (
    <section
      id="operational-dashboards"
      data-testid="operational-dashboards-section"
      className="space-y-8"
    >
      {/* Dashboard Header & Export Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-2xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Pharmacy Operations Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Monitor predicted stockouts, medications below reorder threshold, and batches expiring
            within the next 90 days.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="export-low-stock-csv-btn"
            onClick={handleExportLowStockCsv}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
          >
            Export Low-Stock CSV ({lowStockRows.length})
          </button>
          <button
            type="button"
            data-testid="export-expiring-soon-csv-btn"
            onClick={handleExportExpiringSoonCsv}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
          >
            Export Expiring CSV ({expiringResult?.batches.length ?? 0})
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800 rounded-xl text-xs font-medium text-red-800 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {csvPreview && (
        <div
          data-testid="csv-export-preview"
          className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs space-y-3"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              {csvPreview.title}{' '}
              <span className="font-mono font-normal text-slate-500 dark:text-slate-400">
                ({csvPreview.filename})
              </span>
            </div>
            <button
              type="button"
              data-testid="close-csv-preview-btn"
              onClick={() => setCsvPreview(null)}
              className="px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Close Preview
            </button>
          </div>
          <pre
            data-testid="csv-export-preview-content"
            className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 overflow-x-auto"
          >
            {csvPreview.content}
          </pre>
        </div>
      )}

      {/* AI Stockout Prediction Card ("Predicted Stockouts") - Deterministic SQL & TypeScript Math */}
      <div
        data-testid="predicted-stockouts-card"
        className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-2xs space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200/80 dark:border-rose-800/70 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
              <Activity className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  Predicted Stockouts
                </h2>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border border-sky-200/70 dark:border-sky-800/60">
                  AI Stockout Prediction
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Deterministic 30-day SQL usage model · Days Remaining = Current Stock / Avg Daily
                Usage
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {criticalPredictionsCount > 0 ? (
              <motion.span
                data-testid="predicted-stockouts-critical-count-badge"
                animate={LOW_STOCK_BADGE_PULSE_ANIMATE}
                transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60 rounded-lg"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                {criticalPredictionsCount} Critical Prediction
                {criticalPredictionsCount === 1 ? '' : 's'} (&lt; 7d)
              </motion.span>
            ) : (
              <span
                data-testid="predicted-stockouts-status-badge"
                className="px-3 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
              >
                0 Critical Predictions (&lt; 7d)
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Calculating 30-day stockout predictions...
          </div>
        ) : stockoutPredictions.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No medications available for stockout prediction.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              data-testid="predicted-stockouts-table"
              className="w-full text-left border-collapse"
            >
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Medication</th>
                  <th className="py-3 px-4 text-right">Current Stock</th>
                  <th className="py-3 px-4 text-right">30d Avg Daily Usage</th>
                  <th className="py-3 px-4 text-right">Days Remaining</th>
                  <th className="py-3 px-4">Prediction Flag</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {stockoutPredictions.map((pred) => {
                  const daysDisplay =
                    pred.days_remaining !== null
                      ? `${pred.days_remaining.toFixed(1)} days`
                      : '— (No 30d outflow)';

                  return (
                    <tr
                      key={pred.medication_id}
                      data-testid={`predicted-stockout-row-${pred.medication_id}`}
                      className={`transition-colors ${
                        pred.is_critical_prediction
                          ? 'bg-red-50/30 dark:bg-red-950/20 hover:bg-red-50/60 dark:hover:bg-red-950/40'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {pred.brand_name}{' '}
                          <span className="font-normal text-xs text-slate-500 dark:text-slate-400">
                            · {pred.strength ?? '—'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {pred.generic_name ?? 'Standard'} &middot;{' '}
                          <span className="font-mono">{pred.location_label}</span>
                        </div>
                      </td>

                      <td
                        data-testid={`predicted-stockout-current-stock-${pred.medication_id}`}
                        className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap"
                      >
                        {pred.current_stock} units
                      </td>

                      <td
                        data-testid={`predicted-stockout-avg-usage-${pred.medication_id}`}
                        className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap"
                      >
                        {pred.avg_daily_usage.toFixed(2)} / day
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                          ({pred.total_outflow_30d} units / 30d)
                        </span>
                      </td>

                      <td
                        data-testid={`predicted-stockout-days-remaining-${pred.medication_id}`}
                        className={`py-3.5 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                          pred.is_critical_prediction
                            ? 'text-red-700 dark:text-red-400'
                            : pred.has_sufficient_history
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-400 dark:text-slate-500 font-normal text-xs'
                        }`}
                      >
                        {daysDisplay}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {pred.is_critical_prediction ? (
                          <motion.span
                            data-testid={`critical-prediction-badge-${pred.medication_id}`}
                            animate={LOW_STOCK_BADGE_PULSE_ANIMATE}
                            transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap bg-red-50 dark:bg-red-950/90 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/70"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse shrink-0" />
                            Critical Prediction
                          </motion.span>
                        ) : pred.has_sufficient_history ? (
                          <span
                            data-testid={`stable-prediction-badge-${pred.medication_id}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            Stable (&ge; 7d)
                          </span>
                        ) : (
                          <span
                            data-testid={`insufficient-history-badge-${pred.medication_id}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                          >
                            Insufficient History
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          {!pred.has_sufficient_history && (
                            <button
                              type="button"
                              data-testid={`simulate-30d-usage-btn-${pred.medication_id}`}
                              disabled={isRecordingSample === pred.medication_id}
                              onClick={() => void handleRecordUsageCycle(pred.medication_id)}
                              className="px-2.5 py-1 text-xs font-medium whitespace-nowrap text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {isRecordingSample === pred.medication_id
                                ? 'Simulating...'
                                : 'Simulate 30d Usage'}
                            </button>
                          )}
                          {onSelectMedication && (
                            <button
                              type="button"
                              data-testid={`predicted-stockout-inspect-btn-${pred.medication_id}`}
                              onClick={() => onSelectMedication(pred.medication_id)}
                              className="px-3 py-1 text-xs font-semibold whitespace-nowrap text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-200/70 dark:border-sky-800/60 rounded-lg transition-colors"
                            >
                              Details
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Two-Column Card Layout: Low Stock Alerts & Expiring Soon */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Column 1: Low-Stock Medication Cards (Red/Orange Warning Indicator) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Low Stock Alerts</h2>
            </div>
            <motion.span
              data-testid="low-stock-count-badge"
              animate={lowStockRows.length > 0 ? LOW_STOCK_BADGE_PULSE_ANIMATE : undefined}
              transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
              className="px-2.5 py-1 text-xs font-semibold bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60 rounded-lg"
            >
              {lowStockRows.length} {lowStockRows.length === 1 ? 'item requires' : 'items require'}{' '}
              attention
            </motion.span>
          </div>

          {isLoading ? (
            <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-500 dark:text-slate-400 text-center">
              Loading low-stock alerts...
            </div>
          ) : lowStockRows.length === 0 ? (
            <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm text-slate-500 dark:text-slate-400 text-center">
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
                    className="p-5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xs hover:border-orange-300 dark:hover:border-orange-600 transition-all space-y-4"
                  >
                    {/* Card Top: Warning Indicator + Brand + Location */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <motion.span
                            data-testid={`dashboard-low-stock-badge-${row.medication_id}`}
                            animate={LOW_STOCK_BADGE_PULSE_ANIMATE}
                            transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-md bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                            {isZeroStock ? 'Out of Stock' : 'Low Stock'}
                          </motion.span>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white">{row.brand_name}</h3>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {row.generic_name ?? 'Standard'} · {row.strength ?? '—'} ·{' '}
                          {row.dosage_form ?? '—'}
                        </p>
                      </div>

                      {/* Prominent Shelf Coordinates */}
                      <div
                        data-testid={`low-stock-location-${row.medication_id}`}
                        className="sm:text-right shrink-0"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Shelf Location
                        </div>
                        <div className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                          {row.location_label}
                        </div>
                        {row.location_note && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{row.location_note}</div>
                        )}
                      </div>
                    </div>

                    {/* Card Middle: Metrics & Reorder Suggestion */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 rounded-xl">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Current Stock</div>
                        <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
                          <strong
                            data-testid={`low-stock-current-qty-${row.medication_id}`}
                            className={`text-base font-bold ${
                              isZeroStock ? 'text-red-700 dark:text-red-400' : 'text-orange-700 dark:text-orange-400'
                            }`}
                          >
                            {row.current_qty} units
                          </strong>
                          <span
                            data-testid={`low-stock-reorder-level-${row.medication_id}`}
                            className="text-xs text-slate-500 dark:text-slate-400"
                          >
                            / min {row.reorder_level}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Stock Level</div>
                        <div
                          data-testid={`low-stock-ratio-${row.medication_id}`}
                          className="mt-0.5 text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-200"
                        >
                          {(row.stock_to_reorder_ratio * 100).toFixed(0)}% of target
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Suggested Reorder
                        </div>
                        <div className="mt-0.5">
                          {row.reorder_badge === 'suggested' && row.suggested_qty !== null ? (
                            <div className="space-y-0.5">
                              <span
                                data-testid={`low-stock-suggestion-${row.medication_id}`}
                                className="inline-block px-2 py-0.5 text-xs font-mono font-bold text-emerald-900 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 rounded-md tabular-nums"
                              >
                                Order +{row.suggested_qty} units
                              </span>
                              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                {row.avg_daily_usage.toFixed(1)}/day · {row.lead_time_days}d lead
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span
                                data-testid={`low-stock-fallback-badge-${row.medication_id}`}
                                className="inline-block px-2 py-0.5 text-xs font-mono font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/80 border border-orange-200 dark:border-orange-800/60 rounded-md"
                              >
                                low
                              </span>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
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
                        onClick={() => void handleRecordUsageCycle(row.medication_id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isRecordingSample === row.medication_id
                          ? 'Updating usage...'
                          : 'Simulate 90d Usage'}
                      </button>

                      {onSelectMedication && (
                        <button
                          type="button"
                          onClick={() => onSelectMedication(row.medication_id)}
                          className="px-3.5 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800/60 rounded-lg transition-colors"
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
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Expiring Within 90 Days</h2>
            </div>
            <span
              data-testid="expiring-soon-count-badge"
              className="px-2.5 py-1 text-xs font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 rounded-lg"
            >
              {expiringResult?.batches.length ?? 0} batch
              {(expiringResult?.batches.length ?? 0) === 1 ? '' : 'es'}
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-500 dark:text-slate-400 text-center">
              Checking batch expiry dates...
            </div>
          ) : !expiringResult || expiringResult.groups.length === 0 ? (
            <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm text-slate-500 dark:text-slate-400 text-center">
              No active batches are expiring within the next 90 days.
            </div>
          ) : (
            <div data-testid="expiring-soon-groups" className="space-y-4">
              {expiringResult.groups.map((group) => (
                <div
                  key={group.medication_id}
                  data-testid={`expiring-group-${group.medication_id}`}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xs hover:border-amber-300 dark:hover:border-amber-600 transition-all space-y-4"
                >
                  {/* Group Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 rounded-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Expiring Soon
                        </span>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">{group.brand_name}</h3>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {group.generic_name ?? 'Standard'} · {group.strength ?? '—'}
                      </p>
                      <p className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 mt-1">
                        {group.location_label}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="px-2.5 py-1 text-xs font-mono font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 rounded-lg tabular-nums">
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
                        className="p-3 bg-amber-50/40 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50 rounded-xl flex items-center justify-between gap-3 text-xs font-mono tabular-nums"
                      >
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white">Lot {batch.lot_number}</div>
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">Expires {batch.expiry_date}</div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            data-testid={`expiring-batch-qty-${batch.lot_number}`}
                            className="font-semibold text-slate-800 dark:text-slate-200 mr-1"
                          >
                            {batch.quantity} units
                          </span>
                          <span
                            data-testid={`expiring-batch-badge-${batch.lot_number}`}
                            className={getExpiryVisualBadge(batch.days_remaining).className}
                          >
                            {getExpiryVisualBadge(batch.days_remaining).label}
                          </span>
                          <span
                            data-testid={`expiring-batch-days-${batch.lot_number}`}
                            className="text-xs text-slate-500 dark:text-slate-400 font-mono"
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
                        className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 hover:underline"
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
