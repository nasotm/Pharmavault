import React, { useEffect, useState } from 'react';
import { getRepositoryDatabase, type Batch } from '../db/repository';
import {
  dispenseStock,
  formatCurrentUserIdentifier,
  postOffsetMovement,
  receiveStock,
  selectFefoBatch,
  sortBatchesFefo,
  type CurrentUserProfile,
  type StockMovementHistoryEntry,
} from '../movements';

interface StockMovementPanelProps {
  medicationId: number;
  medicationBrandName: string;
  totalStock: number;
  batches: Batch[];
  movements: StockMovementHistoryEntry[];
  currentUser: CurrentUserProfile;
  onMovementCommitted: () => Promise<void>;
  idPrefix?: string;
  defaultOpenActions?: boolean;
}

type ActionTab = 'dispense' | 'receive' | 'offset';
type ReceiveBatchMode = 'new_batch' | 'existing_batch';

function formatTimestampShort(iso: string): string {
  if (!iso) return '—';
  const cleaned = iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
  return cleaned.length > 16 ? cleaned.slice(0, 16) : cleaned;
}

export function StockMovementPanel({
  medicationId,
  medicationBrandName,
  totalStock,
  batches,
  movements,
  currentUser,
  onMovementCommitted,
  idPrefix = 'detail',
  defaultOpenActions = false,
}: StockMovementPanelProps) {
  const sortedBatches = sortBatchesFefo(batches);
  const fefoBatch = selectFefoBatch(sortedBatches);

  const [isActionsOpen, setIsActionsOpen] = useState<boolean>(defaultOpenActions);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActionTab>('dispense');

  // Dispense state
  const [dispenseBatchSelection, setDispenseBatchSelection] = useState<string>('FEFO_AUTO');
  const [dispenseQuantity, setDispenseQuantity] = useState<string>('3');
  const [dispenseReason, setDispenseReason] = useState<string>('Prescription dispense');

  // Receive state
  const [receiveMode, setReceiveMode] = useState<ReceiveBatchMode>('new_batch');
  const [receiveExistingBatchId, setReceiveExistingBatchId] = useState<string>(
    fefoBatch ? String(fefoBatch.id) : sortedBatches[0] ? String(sortedBatches[0].id) : '',
  );
  const [receiveLotNumber, setReceiveLotNumber] = useState<string>('LOT-2026-NEW');
  const [receiveExpiryDate, setReceiveExpiryDate] = useState<string>('2028-06-30');
  const [receiveQuantity, setReceiveQuantity] = useState<string>('20');
  const [receiveReason, setReceiveReason] = useState<string>('Supplier delivery');

  // Offset / Correction state
  const [offsetBatchId, setOffsetBatchId] = useState<string>(
    fefoBatch ? String(fefoBatch.id) : sortedBatches[0] ? String(sortedBatches[0].id) : '',
  );
  const [offsetDelta, setOffsetDelta] = useState<string>('-1');
  const [offsetReason, setOffsetReason] = useState<string>('Damaged packaging count adjustment');

  // Feedback state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    setDispenseBatchSelection('FEFO_AUTO');
    const defaultBatchId = fefoBatch
      ? String(fefoBatch.id)
      : sortedBatches[0]
        ? String(sortedBatches[0].id)
        : '';
    setReceiveExistingBatchId(defaultBatchId);
    setOffsetBatchId(defaultBatchId);
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [medicationId]);

  const effectiveDispenseBatch: Batch | null =
    dispenseBatchSelection === 'FEFO_AUTO'
      ? fefoBatch
      : (sortedBatches.find((b) => String(b.id) === dispenseBatchSelection) ?? null);

  const activeUserString = formatCurrentUserIdentifier(currentUser);

  const handleDispenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsedQty = Number(dispenseQuantity.trim());
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      setErrorMessage('Dispense quantity must be a positive whole number greater than 0.');
      return;
    }

    const manualBatchId =
      dispenseBatchSelection === 'FEFO_AUTO' ? null : Number(dispenseBatchSelection);

    setIsSubmitting(true);
    try {
      const db = getRepositoryDatabase();
      const result = await dispenseStock(db, {
        medicationId,
        batchId: manualBatchId,
        quantity: parsedQty,
        reason: dispenseReason.trim() || 'Prescription dispense',
        userId: activeUserString,
      });

      await onMovementCommitted();
      setSuccessMessage(
        `Dispensed ${parsedQty} unit(s) of ${medicationBrandName} from lot ${
          result.batch.lot_number ?? `#${result.batch.id}`
        } (${result.resultingBatchQuantity} left in lot · ${result.totalStock} total in stock).`,
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsedQty = Number(receiveQuantity.trim());
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      setErrorMessage('Receive quantity must be a positive whole number greater than 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const db = getRepositoryDatabase();
      const result = await receiveStock(db, {
        medicationId,
        batchId:
          receiveMode === 'existing_batch' && receiveExistingBatchId
            ? Number(receiveExistingBatchId)
            : null,
        lotNumber: receiveMode === 'new_batch' ? receiveLotNumber.trim() : null,
        expiryDate: receiveMode === 'new_batch' ? receiveExpiryDate.trim() || null : null,
        quantity: parsedQty,
        reason: receiveReason.trim() || 'Supplier delivery',
        userId: activeUserString,
      });

      await onMovementCommitted();
      setSuccessMessage(
        `Received +${parsedQty} unit(s) of ${medicationBrandName} into lot ${
          result.batch.lot_number ?? `#${result.batch.id}`
        } (${result.resultingBatchQuantity} in lot · ${result.totalStock} total in stock).`,
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOffsetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsedDelta = Number(offsetDelta.trim());
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setErrorMessage('Adjustment quantity must be a non-zero whole number (e.g. -2 or +2).');
      return;
    }
    if (!offsetBatchId) {
      setErrorMessage('Select a target batch for the stock adjustment.');
      return;
    }
    if (!offsetReason.trim()) {
      setErrorMessage('Please provide a reason for this stock adjustment.');
      return;
    }

    setIsSubmitting(true);
    try {
      const db = getRepositoryDatabase();
      const result = await postOffsetMovement(db, {
        medicationId,
        batchId: Number(offsetBatchId),
        delta: parsedDelta,
        reason: offsetReason.trim(),
        userId: activeUserString,
      });

      await onMovementCommitted();
      setSuccessMessage(
        `Recorded adjustment (${parsedDelta > 0 ? `+${parsedDelta}` : parsedDelta}) on lot ${
          result.batch.lot_number ?? `#${result.batch.id}`
        } (${result.resultingBatchQuantity} in lot · ${result.totalStock} total in stock).`,
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid={`${idPrefix}-stock-movement-panel`} className="space-y-4">
      {/* Primary Action Bar: Simple "Dispense / Receive" button */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 border border-slate-200/80 rounded-xl">
        <div>
          <div className="text-sm font-semibold text-slate-900">Inventory Actions</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Logged by{' '}
            <span
              data-testid={`${idPrefix}-movement-active-user`}
              className="font-medium text-slate-700"
            >
              {activeUserString}
            </span>{' '}
            · Available:{' '}
            <strong
              data-testid={`${idPrefix}-movement-live-stock`}
              className="font-mono text-slate-900 tabular-nums"
            >
              {totalStock} units
            </strong>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={`${idPrefix}-toggle-actions-btn`}
            onClick={() => setIsActionsOpen((prev) => !prev)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all shadow-xs ${
              isActionsOpen
                ? 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                : 'bg-sky-600 text-white hover:bg-sky-700'
            }`}
          >
            {isActionsOpen ? 'Close Dispense / Receive' : 'Dispense / Receive'}
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {errorMessage && (
        <div
          role="alert"
          data-testid={`${idPrefix}-movement-error`}
          className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          data-testid={`${idPrefix}-movement-success`}
          className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-900"
        >
          {successMessage}
        </div>
      )}

      {/* Collapsible Stock Movement Actions Form */}
      {isActionsOpen && (
        <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4">
          <div
            role="group"
            aria-label="Stock movement actions"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit"
          >
            <button
              type="button"
              data-testid={`${idPrefix}-tab-dispense`}
              onClick={() => {
                setActiveTab('dispense');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'dispense'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Dispense
            </button>
            <button
              type="button"
              data-testid={`${idPrefix}-tab-receive`}
              onClick={() => {
                setActiveTab('receive');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'receive'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Receive Stock
            </button>
            <button
              type="button"
              data-testid={`${idPrefix}-tab-offset`}
              onClick={() => {
                setActiveTab('offset');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'offset'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Stock Adjustment
            </button>
          </div>

          {/* DISPENSE FORM */}
          {activeTab === 'dispense' && (
            <form
              onSubmit={handleDispenseSubmit}
              data-testid={`${idPrefix}-dispense-form`}
              className="space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                <span className="font-medium text-slate-700">
                  Earliest-expiring lot selected automatically (FEFO)
                </span>
                <span className="font-mono text-slate-500">
                  {effectiveDispenseBatch
                    ? `Selected lot available: ${effectiveDispenseBatch.quantity} units`
                    : 'No stock available'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`${idPrefix}-dispense-batch-select`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Batch / Lot
                  </label>
                  <select
                    id={`${idPrefix}-dispense-batch-select`}
                    data-testid={`${idPrefix}-dispense-batch-select`}
                    value={dispenseBatchSelection}
                    onChange={(e) => setDispenseBatchSelection(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  >
                    <option value="FEFO_AUTO">
                      {fefoBatch
                        ? `Automatic (Earliest Expiry): ${fefoBatch.lot_number ?? `#${fefoBatch.id}`} (${fefoBatch.quantity} units · Exp ${fefoBatch.expiry_date ?? 'N/A'})`
                        : 'No batches with available stock'}
                    </option>
                    {sortedBatches.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        Lot {b.lot_number ?? `#${b.id}`} ({b.quantity} units · Exp{' '}
                        {b.expiry_date ?? 'N/A'}){fefoBatch?.id === b.id ? ' — Earliest Expiry' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${idPrefix}-dispense-quantity-input`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Quantity to Dispense
                  </label>
                  <input
                    id={`${idPrefix}-dispense-quantity-input`}
                    data-testid={`${idPrefix}-dispense-quantity-input`}
                    type="number"
                    min={1}
                    step={1}
                    value={dispenseQuantity}
                    onChange={(e) => setDispenseQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${idPrefix}-dispense-reason-input`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Note / Reason
                  </label>
                  <input
                    id={`${idPrefix}-dispense-reason-input`}
                    data-testid={`${idPrefix}-dispense-reason-input`}
                    type="text"
                    value={dispenseReason}
                    onChange={(e) => setDispenseReason(e.target.value)}
                    placeholder="Prescription dispense"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid={`${idPrefix}-dispense-submit-btn`}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Dispensing...' : 'Confirm Dispense'}
                </button>
              </div>
            </form>
          )}

          {/* RECEIVE STOCK FORM */}
          {activeTab === 'receive' && (
            <form
              onSubmit={handleReceiveSubmit}
              data-testid={`${idPrefix}-receive-form`}
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  Add incoming shipment to inventory
                </span>
                <div className="flex items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`${idPrefix}-receive-mode`}
                      checked={receiveMode === 'new_batch'}
                      onChange={() => setReceiveMode('new_batch')}
                    />
                    <span>New Batch Lot</span>
                  </label>
                  {sortedBatches.length > 0 && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name={`${idPrefix}-receive-mode`}
                        checked={receiveMode === 'existing_batch'}
                        onChange={() => setReceiveMode('existing_batch')}
                      />
                      <span>Existing Batch Lot</span>
                    </label>
                  )}
                </div>
              </div>

              {receiveMode === 'new_batch' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor={`${idPrefix}-receive-lot-input`}
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Lot Number
                    </label>
                    <input
                      id={`${idPrefix}-receive-lot-input`}
                      data-testid={`${idPrefix}-receive-lot-input`}
                      type="text"
                      value={receiveLotNumber}
                      onChange={(e) => setReceiveLotNumber(e.target.value)}
                      placeholder="e.g. AMX-2026-12"
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${idPrefix}-receive-expiry-input`}
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Expiry Date (YYYY-MM-DD)
                    </label>
                    <input
                      id={`${idPrefix}-receive-expiry-input`}
                      data-testid={`${idPrefix}-receive-expiry-input`}
                      type="text"
                      value={receiveExpiryDate}
                      onChange={(e) => setReceiveExpiryDate(e.target.value)}
                      placeholder="2028-06-30"
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor={`${idPrefix}-receive-existing-batch-select`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Select Existing Batch
                  </label>
                  <select
                    id={`${idPrefix}-receive-existing-batch-select`}
                    data-testid={`${idPrefix}-receive-existing-batch-select`}
                    value={receiveExistingBatchId}
                    onChange={(e) => setReceiveExistingBatchId(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  >
                    {sortedBatches.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.lot_number ?? `#${b.id}`} (Current: {b.quantity} units · Exp{' '}
                        {b.expiry_date ?? 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor={`${idPrefix}-receive-quantity-input`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Quantity Received
                  </label>
                  <input
                    id={`${idPrefix}-receive-quantity-input`}
                    data-testid={`${idPrefix}-receive-quantity-input`}
                    type="number"
                    min={1}
                    step={1}
                    value={receiveQuantity}
                    onChange={(e) => setReceiveQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${idPrefix}-receive-reason-input`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Supplier / Delivery Reference
                  </label>
                  <input
                    id={`${idPrefix}-receive-reason-input`}
                    data-testid={`${idPrefix}-receive-reason-input`}
                    type="text"
                    value={receiveReason}
                    onChange={(e) => setReceiveReason(e.target.value)}
                    placeholder="Supplier delivery"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid={`${idPrefix}-receive-submit-btn`}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Receiving...' : 'Confirm Receive Stock'}
                </button>
              </div>
            </form>
          )}

          {/* STOCK ADJUSTMENT / OFFSET FORM */}
          {activeTab === 'offset' && (
            <form
              onSubmit={handleOffsetSubmit}
              data-testid={`${idPrefix}-offset-form`}
              className="space-y-4"
            >
              <p className="text-xs text-slate-600">
                Record a stock count correction with a reason to keep the inventory history complete.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`${idPrefix}-offset-batch-select`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Batch / Lot
                  </label>
                  <select
                    id={`${idPrefix}-offset-batch-select`}
                    data-testid={`${idPrefix}-offset-batch-select`}
                    value={offsetBatchId}
                    onChange={(e) => setOffsetBatchId(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  >
                    {sortedBatches.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.lot_number ?? `#${b.id}`} (Current: {b.quantity} units · Exp{' '}
                        {b.expiry_date ?? 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${idPrefix}-offset-delta-input`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Adjustment Quantity (+ or -)
                  </label>
                  <input
                    id={`${idPrefix}-offset-delta-input`}
                    data-testid={`${idPrefix}-offset-delta-input`}
                    type="number"
                    step={1}
                    value={offsetDelta}
                    onChange={(e) => setOffsetDelta(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${idPrefix}-offset-reason-input`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Reason for Adjustment
                  </label>
                  <input
                    id={`${idPrefix}-offset-reason-input`}
                    data-testid={`${idPrefix}-offset-reason-input`}
                    type="text"
                    value={offsetReason}
                    onChange={(e) => setOffsetReason(e.target.value)}
                    placeholder="e.g. Damaged packaging"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || sortedBatches.length === 0}
                  data-testid={`${idPrefix}-offset-submit-btn`}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Saving...' : 'Record Adjustment'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Collapsible Movement History */}
      <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white">
        <button
          type="button"
          data-testid={`${idPrefix}-toggle-movement-history-btn`}
          onClick={() => setIsHistoryOpen((prev) => !prev)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800">Movement History</span>
            <span className="px-2 py-0.5 text-[11px] font-mono font-medium bg-slate-100 text-slate-600 rounded-md">
              {movements.length}
            </span>
          </div>
          <span className="text-xs font-medium text-sky-600">
            {isHistoryOpen ? 'Hide' : 'Show history'}
          </span>
        </button>

        {isHistoryOpen && (
          <div className="border-t border-slate-200">
            {movements.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">
                No stock movements recorded yet for this medication.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table
                  data-testid={`${idPrefix}-movement-history-table`}
                  className="w-full text-left text-xs border-collapse"
                >
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Date &amp; Time</th>
                      <th className="py-2.5 px-3 text-right font-medium">Change</th>
                      <th className="py-2.5 px-3 font-medium">Reason &amp; Lot</th>
                      <th className="py-2.5 px-3 font-medium">Pharmacist</th>
                      <th className="py-2.5 px-3 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {movements.map((mv) => (
                      <tr key={mv.id} data-testid={`${idPrefix}-movement-row-${mv.id}`}>
                        <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                          {formatTimestampShort(mv.created_at)}
                        </td>
                        <td
                          data-testid={`${idPrefix}-movement-delta-${mv.id}`}
                          className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                            mv.delta < 0 ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {mv.delta > 0 ? `+${mv.delta}` : mv.delta}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800 font-sans">
                          <div>{mv.reason ?? '—'}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            Lot: {mv.lot_number ?? (mv.batch_id ? `#${mv.batch_id}` : '—')}
                          </div>
                        </td>
                        <td
                          data-testid={`${idPrefix}-movement-user-${mv.id}`}
                          className="py-2.5 px-3 text-slate-600 font-sans"
                        >
                          {mv.user_id ?? '—'}
                        </td>
                        <td
                          data-testid={`${idPrefix}-movement-resulting-qty-${mv.id}`}
                          className="py-2.5 px-3 text-right font-semibold text-slate-900 whitespace-nowrap"
                        >
                          <div>{mv.resulting_quantity} total</div>
                          {mv.resulting_batch_quantity !== null && (
                            <div className="text-[11px] text-slate-400 font-normal">
                              {mv.resulting_batch_quantity} in lot
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
