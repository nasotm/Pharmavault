import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  AlertTriangle,
  Clock,
  AlertOctagon,
  CheckCircle2,
  X,
  ChevronRight,
} from 'lucide-react';
import { getRepositoryDatabase, hasRepositoryDatabase } from '../db/repository';
import {
  queryNotificationAlerts,
  type NotificationAlerts,
} from '../dashboards/notifications';

export interface NotificationCenterProps {
  refreshTrigger?: unknown;
  onSelectMedication: (medicationId: number) => void;
}

export function NotificationCenter({
  refreshTrigger,
  onSelectMedication,
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<NotificationAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    async function loadAlerts() {
      if (!hasRepositoryDatabase()) {
        return;
      }
      try {
        const db = getRepositoryDatabase();
        const data = await queryNotificationAlerts(db);
        if (mounted) {
          setAlerts(data);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load notification alerts:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadAlerts();

    return () => {
      mounted = false;
    };
  }, [refreshTrigger]);

  // Handle clicking outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const totalCount = alerts?.totalAlertsCount ?? 0;
  const lowStock = alerts?.lowStockItems ?? [];
  const expiringSoon = alerts?.expiringSoonBatches ?? [];
  const expired = alerts?.expiredBatches ?? [];

  const handleItemClick = (medicationId: number) => {
    onSelectMedication(medicationId);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Bell Icon Button */}
      <button
        type="button"
        data-testid="notification-bell-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        title="Notifications & Alerts"
        aria-label={`Notifications & Alerts (${totalCount} active alerts)`}
        className="relative p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      >
        <Bell className="w-5 h-5" />
        {totalCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[20px] h-[20px] px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center shadow-xs border-2 border-white dark:border-slate-900 leading-none"
          >
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          data-testid="notification-dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200/90 dark:border-slate-800 z-50 overflow-hidden text-left transform transition-all duration-150 animate-in fade-in slide-in-from-top-2"
        >
          {/* Header */}
          <div className="p-4 bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm tracking-tight">
                Notifications & Alerts
              </h3>
              {totalCount > 0 ? (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300">
                  {totalCount} active
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                  All good
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
              aria-label="Close notifications"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List Content */}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Loading alerts...
              </div>
            ) : totalCount === 0 ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No active alerts
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Stock levels and batch expiration dates are looking healthy.
                </p>
              </div>
            ) : (
              <>
                {/* 1. Critically Low Stock */}
                <div className="p-3">
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2 px-1">
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      Critically Low Stock ({lowStock.length})
                    </span>
                  </div>

                  {lowStock.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic px-2 py-1">
                      No low stock items
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {lowStock.map((item) => (
                        <button
                          key={`low-${item.medication_id}`}
                          type="button"
                          data-testid={`notification-item-${item.medication_id}`}
                          onClick={() => handleItemClick(item.medication_id)}
                          className="w-full text-left p-2.5 rounded-xl hover:bg-amber-50/70 dark:hover:bg-amber-950/40 border border-transparent hover:border-amber-200/60 dark:hover:border-amber-800/60 transition-all flex items-center justify-between group"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-amber-900 dark:group-hover:text-amber-300">
                              {item.brand_name}
                            </div>
                            {item.generic_name && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {item.generic_name}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              Stock:{' '}
                              <span className="font-semibold text-amber-700 dark:text-amber-400">
                                {item.current_qty}
                              </span>{' '}
                              / Reorder Level: {item.reorder_level}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-amber-600 dark:group-hover:text-amber-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Expiring Soon (<30 days) */}
                <div className="p-3">
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2 px-1">
                    <span className="flex items-center gap-1.5 text-orange-700 dark:text-orange-400">
                      <Clock className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                      Expiring Soon ({expiringSoon.length})
                    </span>
                  </div>

                  {expiringSoon.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic px-2 py-1">
                      No batches expiring within 30 days
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {expiringSoon.map((batch) => (
                        <button
                          key={`exp-soon-${batch.batch_id}`}
                          type="button"
                          data-testid={`notification-item-${batch.medication_id}`}
                          onClick={() => handleItemClick(batch.medication_id)}
                          className="w-full text-left p-2.5 rounded-xl hover:bg-orange-50/70 dark:hover:bg-orange-950/40 border border-transparent hover:border-orange-200/60 dark:hover:border-orange-800/60 transition-all flex items-center justify-between group"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-orange-900 dark:group-hover:text-orange-300">
                              {batch.brand_name}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              Lot:{' '}
                              <span className="font-mono font-medium">
                                {batch.lot_number}
                              </span>{' '}
                              • Qty: {batch.quantity}
                            </div>
                            <div className="text-[11px] text-orange-700 dark:text-orange-400 font-medium">
                              Expires in {batch.days_remaining} days ({batch.expiry_date})
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-orange-600 dark:group-hover:text-orange-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Expired Batches */}
                <div className="p-3">
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2 px-1">
                    <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertOctagon className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                      Expired Batches ({expired.length})
                    </span>
                  </div>

                  {expired.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic px-2 py-1">
                      No expired batches
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {expired.map((batch) => (
                        <button
                          key={`expired-${batch.batch_id}`}
                          type="button"
                          data-testid={`notification-item-${batch.medication_id}`}
                          onClick={() => handleItemClick(batch.medication_id)}
                          className="w-full text-left p-2.5 rounded-xl hover:bg-red-50/70 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200/60 dark:hover:border-red-800/60 transition-all flex items-center justify-between group"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-red-900 dark:group-hover:text-red-300">
                              {batch.brand_name}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              Lot:{' '}
                              <span className="font-mono font-medium">
                                {batch.lot_number}
                              </span>{' '}
                              • Qty: {batch.quantity}
                            </div>
                            <div className="text-[11px] text-red-700 dark:text-red-400 font-semibold">
                              EXPIRED ({batch.expiry_date})
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-red-600 dark:group-hover:text-red-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer note */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200/80 dark:border-slate-800 text-center">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Click any medication to view details &amp; manage stock
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
