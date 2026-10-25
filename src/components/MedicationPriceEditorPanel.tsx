import React, { useEffect, useState } from 'react';
import { getRepositoryDatabase, type Medication, type PriceHistory } from '../db/repository';
import { formatCurrentUserIdentifier, type CurrentUserProfile } from '../movements';
import {
  computeDerivedPriceDisplays,
  confirmExistingMedicationPrice,
  formatCentsToMajor,
  formatMoneyDisplay,
  getMedicationPriceVisualState,
  savePharmacistManualPrice,
} from '../pricing';

export interface MedicationPriceEditorPanelProps {
  idPrefix?: string;
  medication: Medication;
  priceHistory: PriceHistory[];
  currentUser: CurrentUserProfile;
  onPriceUpdated: () => Promise<void> | void;
}

export const MedicationPriceEditorPanel: React.FC<MedicationPriceEditorPanelProps> = ({
  idPrefix = 'detail-price',
  medication,
  priceHistory,
  currentUser,
  onPriceUpdated,
}) => {
  const [unitPriceInput, setUnitPriceInput] = useState<string>(() =>
    medication.unit_price_cents !== null ? formatCentsToMajor(medication.unit_price_cents) : '',
  );
  const [costPriceInput, setCostPriceInput] = useState<string>(() =>
    medication.cost_price_cents !== null ? formatCentsToMajor(medication.cost_price_cents) : '',
  );
  const [currencyInput, setCurrencyInput] = useState<string>(() => medication.currency || 'USD');
  const [unitsPerPackInput, setUnitsPerPackInput] = useState<string>(() =>
    String(medication.units_per_pack || 1),
  );
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(
    () => medication.unit_price_cents === null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setUnitPriceInput(
      medication.unit_price_cents !== null ? formatCentsToMajor(medication.unit_price_cents) : '',
    );
    setCostPriceInput(
      medication.cost_price_cents !== null ? formatCentsToMajor(medication.cost_price_cents) : '',
    );
    setCurrencyInput(medication.currency || 'USD');
    setUnitsPerPackInput(String(medication.units_per_pack || 1));
    setErrorMessage(null);
    setStatusMessage(null);
  }, [
    medication.id,
    medication.unit_price_cents,
    medication.cost_price_cents,
    medication.currency,
    medication.units_per_pack,
    medication.price_confirmed,
    medication.price_source,
  ]);

  const visualState = getMedicationPriceVisualState(medication);
  const derived = computeDerivedPriceDisplays({
    unitPriceCents: medication.unit_price_cents,
    costPriceCents: medication.cost_price_cents,
    unitsPerPack: medication.units_per_pack,
    currency: medication.currency,
  });

  const handleConfirmExistingPrice = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSaving(true);
    try {
      const db = getRepositoryDatabase();
      const userId = formatCurrentUserIdentifier(currentUser);
      const res = await confirmExistingMedicationPrice(db, medication.id, userId);
      setStatusMessage(
        `Confirmed ${res.medication.brand_name} price at ${formatMoneyDisplay(
          res.medication.unit_price_cents,
          res.medication.currency,
        )}.`,
      );
      await onPriceUpdated();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveManualPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSaving(true);
    try {
      const db = getRepositoryDatabase();
      const userId = formatCurrentUserIdentifier(currentUser);
      const res = await savePharmacistManualPrice(db, {
        medicationId: medication.id,
        unitPriceInput,
        costPriceInput,
        currency: currencyInput,
        unitsPerPack: unitsPerPackInput,
        userId,
      });
      setStatusMessage(
        `Updated ${res.medication.brand_name} price to ${formatMoneyDisplay(
          res.medication.unit_price_cents,
          res.medication.currency,
        )}.`,
      );
      await onPriceUpdated();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div data-testid={`${idPrefix}-panel`} className="space-y-4">
      {/* Pricing Summary & Confirmation Card */}
      <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500">Pricing &amp; Verification</div>

            {visualState.status === 'null_unentered' && (
              <div className="mt-1 space-y-1.5">
                <div
                  data-testid={`${idPrefix}-visual-value`}
                  className="text-lg font-bold text-red-700"
                >
                  price not entered
                </div>
                <span
                  data-testid={`${idPrefix}-status-badge`}
                  className="inline-block px-2 py-0.5 text-[11px] font-medium bg-red-50 text-red-800 border border-red-200 rounded-md"
                >
                  Requires pharmacist price entry
                </span>
              </div>
            )}

            {visualState.status === 'unconfirmed' && (
              <div className="mt-1 space-y-2">
                <div
                  data-testid={`${idPrefix}-visual-value`}
                  className="text-xl font-bold font-mono tabular-nums text-slate-400 line-through decoration-slate-300"
                >
                  {formatMoneyDisplay(medication.unit_price_cents, medication.currency)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid={`${idPrefix}-status-badge`}
                    className="inline-block px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-md"
                  >
                    Unconfirmed ({visualState.priceSource ?? 'imported'})
                  </span>
                  <button
                    type="button"
                    data-testid={`${idPrefix}-confirm-price-btn`}
                    disabled={isSaving}
                    onClick={handleConfirmExistingPrice}
                    className="px-3 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors disabled:opacity-50"
                  >
                    Confirm price
                  </button>
                </div>
              </div>
            )}

            {visualState.status === 'confirmed' && (
              <div className="mt-1 space-y-1">
                <div
                  data-testid={`${idPrefix}-visual-value`}
                  className="text-xl font-bold font-mono tabular-nums text-slate-900"
                >
                  {formatMoneyDisplay(medication.unit_price_cents, medication.currency)}
                </div>
                <span
                  data-testid={`${idPrefix}-status-badge`}
                  className="inline-block px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md"
                >
                  Verified ({visualState.priceSource ?? 'manual'})
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              data-testid={`${idPrefix}-toggle-editor-btn`}
              onClick={() => setIsEditorOpen((prev) => !prev)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors shadow-2xs"
            >
              {isEditorOpen ? 'Hide Price Editor' : 'Edit Price'}
            </button>
            <div className="text-right text-xs text-slate-500 space-y-0.5">
              <div>
                Cost:{' '}
                <strong className="font-mono text-slate-800">
                  {formatMoneyDisplay(medication.cost_price_cents, medication.currency)}
                </strong>
              </div>
              <div>
                Pack: <strong className="font-mono text-slate-800">{medication.units_per_pack}</strong>{' '}
                units/pack
              </div>
            </div>
          </div>
        </div>

        {/* Derived displays (read-only): price per dose & margin % */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/80">
          <div className="p-3 bg-white border border-slate-200/80 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Price per Dose</div>
            <div
              data-testid={`${idPrefix}-price-per-dose`}
              className="mt-0.5 text-sm font-bold font-mono tabular-nums text-slate-900"
            >
              {derived.pricePerDoseFormatted}
            </div>
          </div>

          <div className="p-3 bg-white border border-slate-200/80 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Gross Margin</div>
            <div
              data-testid={`${idPrefix}-margin-pct`}
              className="mt-0.5 text-sm font-bold font-mono tabular-nums text-slate-900"
            >
              {derived.marginFormatted}
            </div>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          data-testid={`${idPrefix}-error-alert`}
          className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          data-testid={`${idPrefix}-status-banner`}
          className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-900"
        >
          {statusMessage}
        </div>
      )}

      {/* Pharmacist Price Editor Form */}
      {isEditorOpen && (
        <form
          onSubmit={handleSaveManualPrice}
          data-testid={`${idPrefix}-editor-form`}
          className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-900">Update Medication Pricing</h4>
            <span className="text-[11px] text-slate-500">e.g. 12.50, 12,50, or 12</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${idPrefix}-unit-price-input`}
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Unit Selling Price
              </label>
              <input
                id={`${idPrefix}-unit-price-input`}
                data-testid={`${idPrefix}-unit-price-input`}
                type="text"
                value={unitPriceInput}
                onChange={(e) => setUnitPriceInput(e.target.value)}
                placeholder="e.g. 12.50"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-cost-price-input`}
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Wholesale Cost (Optional)
              </label>
              <input
                id={`${idPrefix}-cost-price-input`}
                data-testid={`${idPrefix}-cost-price-input`}
                type="text"
                value={costPriceInput}
                onChange={(e) => setCostPriceInput(e.target.value)}
                placeholder="e.g. 8.20"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-currency-input`}
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Currency
              </label>
              <select
                id={`${idPrefix}-currency-input`}
                data-testid={`${idPrefix}-currency-input`}
                value={currencyInput}
                onChange={(e) => setCurrencyInput(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-units-per-pack-input`}
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Units per Pack
              </label>
              <input
                id={`${idPrefix}-units-per-pack-input`}
                data-testid={`${idPrefix}-units-per-pack-input`}
                type="number"
                min={1}
                step={1}
                value={unitsPerPackInput}
                onChange={(e) => setUnitsPerPackInput(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-500">
              Verified by {formatCurrentUserIdentifier(currentUser)}
            </span>
            <button
              type="submit"
              data-testid={`${idPrefix}-save-btn`}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save & Confirm Price'}
            </button>
          </div>
        </form>
      )}

      {/* Collapsible Price History */}
      <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white">
        <button
          type="button"
          data-testid={`${idPrefix}-toggle-price-history-btn`}
          onClick={() => setIsHistoryOpen((prev) => !prev)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800">Price History</span>
            <span
              data-testid={`${idPrefix}-history-count`}
              className="px-2 py-0.5 text-[11px] font-mono font-medium bg-slate-100 text-slate-600 rounded-md"
            >
              {priceHistory.length}
            </span>
          </div>
          <span className="text-xs font-medium text-sky-600">
            {isHistoryOpen ? 'Hide' : 'Show history'}
          </span>
        </button>

        {isHistoryOpen && (
          <div className="border-t border-slate-200">
            {priceHistory.length === 0 ? (
              <div
                data-testid={`${idPrefix}-history-empty`}
                className="p-4 text-xs text-slate-500"
              >
                No price changes recorded yet (price not entered).
              </div>
            ) : (
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table
                  data-testid={`${idPrefix}-history-table`}
                  className="w-full text-left text-xs border-collapse"
                >
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Unit Price</th>
                      <th className="py-2.5 px-3 font-medium">Source</th>
                      <th className="py-2.5 px-3 font-medium">Updated By</th>
                      <th className="py-2.5 px-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {[...priceHistory].reverse().map((ph) => (
                      <tr key={ph.id} data-testid={`${idPrefix}-history-row-${ph.id}`}>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {ph.unit_price_cents === null
                            ? 'price not entered'
                            : formatMoneyDisplay(ph.unit_price_cents, medication.currency)}
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <span className="px-2 py-0.5 text-[11px] bg-slate-100 text-slate-700 rounded-md">
                            {ph.source ?? '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 font-sans">
                          {ph.changed_by ?? '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {ph.created_at.replace('T', ' ').slice(0, 16)}
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
};
