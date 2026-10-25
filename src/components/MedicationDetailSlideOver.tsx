import React, { useCallback, useEffect, useState } from 'react';
import { getRepositoryDatabase } from '../db/repository';
import { type CurrentUserProfile } from '../movements';
import { formatMoneyDisplay } from '../pricing';
import { getMedicationDetailForSearch, type SearchMedicationDetail } from '../search';
import { MedicationPriceEditorPanel } from './MedicationPriceEditorPanel';
import { StockMovementPanel } from './StockMovementPanel';

export interface MedicationDetailSlideOverProps {
  medicationId: number | null;
  initialDetail?: SearchMedicationDetail | null;
  currentUser: CurrentUserProfile;
  onClose: () => void;
  onMutated: () => Promise<void> | void;
}

export const MedicationDetailSlideOver: React.FC<MedicationDetailSlideOverProps> = ({
  medicationId,
  initialDetail = null,
  currentUser,
  onClose,
  onMutated,
}) => {
  const [detail, setDetail] = useState<SearchMedicationDetail | null>(initialDetail);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const db = getRepositoryDatabase();
      const fresh = await getMedicationDetailForSearch(db, id);
      setDetail(fresh);
    } catch {
      // Ignore transient load error
    }
  }, []);

  useEffect(() => {
    if (medicationId === null) {
      setDetail(null);
      return;
    }
    if (initialDetail && initialDetail.medication.id === medicationId) {
      setDetail(initialDetail);
    }
    void loadDetail(medicationId);
  }, [medicationId, initialDetail, loadDetail]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && medicationId !== null) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [medicationId, onClose]);

  if (medicationId === null || !detail) {
    return null;
  }

  const { medication } = detail;
  const isLowStock = detail.totalStock <= medication.reorder_level;

  const handleRefreshAfterMutation = async () => {
    await loadDetail(medication.id);
    await onMutated();
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-slate-900/25 backdrop-blur-[2px] flex justify-end transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-label={`Medication details for ${medication.brand_name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        data-testid="search-result-detail-card"
        className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
      >
        {/* Top Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4 bg-white shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-sky-600">Medication Profile</span>
              {medication.atc_code && (
                <span className="px-2 py-0.5 text-[11px] font-mono text-slate-600 bg-slate-100 rounded-md">
                  ATC {medication.atc_code}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 mt-1">
              {medication.brand_name}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {medication.generic_name ?? 'Standard formulation'} · {medication.strength ?? '—'} ·{' '}
              {medication.dosage_form ?? '—'}
            </p>
          </div>

          <button
            type="button"
            data-testid="close-detail-slideover-btn"
            onClick={onClose}
            aria-label="Close medication details"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Physical Location Banner */}
          <div className="p-5 bg-sky-50/70 border border-sky-200/80 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-800">
                Dispensary Location
              </span>
              {medication.storage && (
                <span className="px-2.5 py-0.5 text-xs font-medium bg-white text-sky-900 border border-sky-200 rounded-md">
                  {medication.storage}
                </span>
              )}
            </div>
            <div
              data-testid="detail-card-location"
              className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-slate-900"
            >
              {detail.locationDisplay}
            </div>
            <div data-testid="detail-card-location-note" className="text-xs text-slate-600">
              {medication.location_note ? (
                <>
                   Shelf Note: <strong className="text-slate-800">{medication.location_note}</strong>
                </>
              ) : (
                'Standard shelf placement'
              )}
              {medication.barcode && (
                <span className="ml-2 font-mono text-slate-500">· Barcode {medication.barcode}</span>
              )}
            </div>
          </div>

          {/* Stock & Unit Price Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Available Stock</span>
                <span
                  className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${
                    isLowStock
                      ? 'bg-orange-50 text-orange-800 border border-orange-200'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {isLowStock ? 'Low Stock' : 'In Stock'}
                </span>
              </div>
              <div
                data-testid="detail-card-total-stock"
                className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900"
              >
                {detail.totalStock} units
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Reorder threshold: <span className="font-mono">{medication.reorder_level}</span> units
              </div>
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
              <div className="text-xs font-medium text-slate-500">Unit Price</div>
              <div
                data-testid="detail-card-unit-price"
                className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
                  medication.unit_price_cents === null
                    ? 'text-red-700 text-lg'
                    : medication.price_confirmed === 0
                      ? 'text-slate-400 line-through'
                      : 'text-slate-900'
                }`}
              >
                {formatMoneyDisplay(medication.unit_price_cents, medication.currency)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {medication.unit_price_cents === null
                  ? 'Not entered yet'
                  : medication.price_confirmed === 1
                    ? 'Verified price'
                    : 'Awaiting pharmacist confirmation'}
              </div>
            </div>
          </div>

          {/* Active Batches & Expiry Dates */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Batches &amp; Expiry ({detail.batches.length})
              </h3>
              <span className="text-xs text-slate-400">Sorted by earliest expiry</span>
            </div>

            {detail.batches.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
                No active batches recorded for this medication.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table
                  data-testid="detail-card-batches-table"
                  className="w-full text-left text-xs border-collapse"
                >
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2.5 px-3.5 font-medium">Lot Number</th>
                      <th className="py-2.5 px-3.5 text-right font-medium">Quantity</th>
                      <th className="py-2.5 px-3.5 font-medium">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {detail.batches.map((b) => {
                      const isFefo = detail.fefoBatchId === b.id;
                      return (
                        <tr
                          key={b.id}
                          data-testid={`detail-card-batch-row-${b.id}`}
                          className={isFefo ? 'bg-emerald-50/40' : ''}
                        >
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                            {b.lot_number ?? '—'}
                            {isFefo && (
                              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-sans font-semibold bg-emerald-100 text-emerald-800 rounded">
                                Dispense First
                              </span>
                            )}
                          </td>
                          <td
                            data-testid={`detail-card-batch-qty-${b.id}`}
                            className="py-2.5 px-3.5 text-right font-semibold text-slate-900"
                          >
                            {b.quantity}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600">
                            {b.expiry_date ?? 'No expiry'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Dispense / Receive Toggle & Collapsible Movement History */}
          <StockMovementPanel
            idPrefix="search-detail"
            medicationId={medication.id}
            medicationBrandName={medication.brand_name}
            totalStock={detail.totalStock}
            batches={detail.batches}
            movements={detail.movements}
            currentUser={currentUser}
            onMovementCommitted={handleRefreshAfterMutation}
          />

          {/* Price Editor & Collapsible Price History */}
          <MedicationPriceEditorPanel
            idPrefix="search-detail-price"
            medication={medication}
            priceHistory={detail.priceHistory}
            currentUser={currentUser}
            onPriceUpdated={handleRefreshAfterMutation}
          />

          {/* Known Aliases & Manufacturer */}
          {(detail.aliases.length > 0 || medication.manufacturer) && (
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 space-y-1">
              {medication.manufacturer && (
                <div>
                  Manufacturer: <strong className="text-slate-800">{medication.manufacturer}</strong>
                </div>
              )}
              {detail.aliases.length > 0 && (
                <div>
                  Alternative Names:{' '}
                  <span className="text-slate-800">{detail.aliases.join(' · ')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
