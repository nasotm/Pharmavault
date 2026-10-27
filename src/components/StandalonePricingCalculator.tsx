import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_CURRENCIES,
  getRepositoryDatabase,
  type CurrencyRecord,
  type MedicationWithAliases,
} from '../db/repository';
import { formatCurrentUserIdentifier, type CurrentUserProfile } from '../movements';
import {
  buildDispensaryInvoicePdf,
  CALCULATOR_INTERACTION_REFERENCE_MEDICATIONS,
  checkCartDrugInteractions,
  evaluateDeterministicDrugInteractions,
  evaluateStandaloneCalculator,
  formatMoneyDisplay,
  isDzdCurrency,
  savePharmacistManualPrice,
  type CalculatorLineInput,
  type DrugInteractionCheckResult,
  type DrugInteractionInputItem,
} from '../pricing';

export interface StandalonePricingCalculatorProps {
  medications: MedicationWithAliases[];
  currencies?: CurrencyRecord[];
  currentUser: CurrentUserProfile;
  onMedicationPriceUpdated: () => Promise<void> | void;
}

interface SelectedBasketLine {
  medicationId: number;
  quantity: number;
}

export const StandalonePricingCalculator: React.FC<StandalonePricingCalculatorProps> = ({
  medications,
  currencies = DEFAULT_CURRENCIES,
  currentUser,
  onMedicationPriceUpdated,
}) => {
  const activeCurrencies = useMemo<readonly CurrencyRecord[]>(
    () => (currencies && currencies.length > 0 ? currencies : DEFAULT_CURRENCIES),
    [currencies],
  );
  const [selectedCurrency, setSelectedCurrency] = useState<string>('DZD');

  const availableMedications = useMemo<MedicationWithAliases[]>(() => {
    const existingIds = new Set(medications.map((m) => m.id));
    const extras = CALCULATOR_INTERACTION_REFERENCE_MEDICATIONS.filter(
      (ref) => !existingIds.has(ref.id),
    );
    return [...medications, ...extras];
  }, [medications]);

  const [basket, setBasket] = useState<SelectedBasketLine[]>(() => {
    try {
      const raw =
        typeof window !== 'undefined' && window.localStorage
          ? window.localStorage.getItem('pharmavault_prescription_cart_v1')
          : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ medicationId: number; quantity: number }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item) => ({
            medicationId: Number(item.medicationId),
            quantity: Math.max(1, Number(item.quantity) || 1),
          }));
        }
      }
    } catch {
      // Ignore storage read errors
    }
    return [{ medicationId: 1, quantity: 3 }];
  });
  const [discountInput, setDiscountInput] = useState<string>('10');
  const [taxInput, setTaxInput] = useState<string>('5');
  const [medicationIdToAdd, setMedicationIdToAdd] = useState<number>(() => medications[1]?.id ?? 2);
  const [quantityToAdd, setQuantityToAdd] = useState<string>('1');

  const [patientNameInput, setPatientNameInput] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [pdfExportNotice, setPdfExportNotice] = useState<string | null>(null);

  const [inlinePriceDrafts, setInlinePriceDrafts] = useState<Record<number, string>>({});
  const [inlineSavingMedId, setInlineSavingMedId] = useState<number | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineSuccess, setInlineSuccess] = useState<string | null>(null);

  const calculatorInputItems = useMemo<CalculatorLineInput[]>(() => {
    const result: CalculatorLineInput[] = [];
    for (const entry of basket) {
      const med = availableMedications.find((m) => m.id === entry.medicationId);
      if (!med) continue;
      result.push({
        medicationId: med.id,
        brandName: med.brand_name,
        genericName: med.generic_name,
        strength: med.strength,
        dosageForm: med.dosage_form,
        unitPriceCents: med.unit_price_cents,
        currency: med.currency_code || med.currency || 'DZD',
        quantity: entry.quantity,
      });
    }
    return result;
  }, [basket, availableMedications]);

  const interactionCheckItems = useMemo<DrugInteractionInputItem[]>(() => {
    const result: DrugInteractionInputItem[] = [];
    for (const entry of basket) {
      const med = availableMedications.find((m) => m.id === entry.medicationId);
      if (!med) continue;
      result.push({
        medicationId: med.id,
        brandName: med.brand_name,
        genericName: med.generic_name,
        atcCode: med.atc_code,
      });
    }
    return result;
  }, [basket, availableMedications]);

  const [interactionResult, setInteractionResult] = useState<DrugInteractionCheckResult>(() =>
    evaluateDeterministicDrugInteractions([]),
  );
  const [isCheckingInteractions, setIsCheckingInteractions] = useState<boolean>(false);

  useEffect(() => {
    if (interactionCheckItems.length < 2) {
      setInteractionResult(evaluateDeterministicDrugInteractions(interactionCheckItems));
      setIsCheckingInteractions(false);
      return;
    }

    // Immediate deterministic check for zero-latency safety, followed by background AI pharmacist verification
    const immediate = evaluateDeterministicDrugInteractions(interactionCheckItems);
    setInteractionResult(immediate);

    const controller = new AbortController();
    setIsCheckingInteractions(true);

    void checkCartDrugInteractions(interactionCheckItems, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          setInteractionResult(res);
          setIsCheckingInteractions(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsCheckingInteractions(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [interactionCheckItems]);

  const evaluation = useMemo(
    () =>
      evaluateStandaloneCalculator({
        items: calculatorInputItems,
        discountPercent: discountInput,
        taxPercent: taxInput,
        currency: selectedCurrency,
        currencies: activeCurrencies,
      }),
    [calculatorInputItems, discountInput, taxInput, selectedCurrency, activeCurrencies],
  );

  const handleAddMedicationToBasket = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(quantityToAdd.trim());
    if (!Number.isInteger(qty) || qty <= 0) return;

    setBasket((prev) => {
      const existing = prev.find((item) => item.medicationId === medicationIdToAdd);
      if (existing) {
        return prev.map((item) =>
          item.medicationId === medicationIdToAdd
            ? { ...item, quantity: item.quantity + qty }
            : item,
        );
      }
      return [...prev, { medicationId: medicationIdToAdd, quantity: qty }];
    });
  };

  const handleUpdateLineQuantity = (medicationId: number, nextQty: number) => {
    if (!Number.isInteger(nextQty) || nextQty <= 0) {
      setBasket((prev) => prev.filter((item) => item.medicationId !== medicationId));
      return;
    }
    setBasket((prev) =>
      prev.map((item) =>
        item.medicationId === medicationId ? { ...item, quantity: nextQty } : item,
      ),
    );
  };

  const handleRemoveLine = (medicationId: number) => {
    setBasket((prev) => prev.filter((item) => item.medicationId !== medicationId));
  };

  const handleInlineSetPrice = async (medicationId: number) => {
    setInlineError(null);
    setInlineSuccess(null);
    const rawDraft = inlinePriceDrafts[medicationId] ?? '';
    setInlineSavingMedId(medicationId);
    try {
      const db = getRepositoryDatabase();
      const userId = formatCurrentUserIdentifier(currentUser);
      const res = await savePharmacistManualPrice(db, {
        medicationId,
        unitPriceInput: rawDraft,
        userId,
      });
      setInlineSuccess(
        `Saved unit price for ${res.medication.brand_name} (${formatMoneyDisplay(
          res.medication.unit_price_cents,
          res.medication.currency,
        )}).`,
      );
      await onMedicationPriceUpdated();
    } catch (err: unknown) {
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setInlineSavingMedId(null);
    }
  };

  const handleExportPdfInvoice = () => {
    if (!evaluation.canComputeGrandTotal || calculatorInputItems.length === 0) {
      return;
    }
    setIsExportingPdf(true);
    setPdfExportNotice(null);
    try {
      const doc = buildDispensaryInvoicePdf({
        evaluation,
        currentUser,
        patientName: patientNameInput,
      });
      const filename = `pharmavault-invoice-${Date.now().toString().slice(-6)}.pdf`;
      doc.save(filename);
      setPdfExportNotice(`Invoice exported successfully as ${filename}`);
    } catch (err: unknown) {
      setPdfExportNotice(
        `Failed to generate PDF: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <section
      id="standalone-pricing-calculator"
      data-testid="standalone-pricing-calculator"
      className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden"
    >
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            Prescription Price Calculator
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Calculate multi-item dispensing totals with optional discount, tax percentages, and AI pharmacist interaction screening.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="calc-preset-3x1250-btn"
            onClick={() => {
              setBasket([{ medicationId: 1, quantity: 3 }]);
              setDiscountInput('10');
              setTaxInput('5');
              setInlineError(null);
              setInlineSuccess(null);
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Sample: 3 &times; 1,250 DA (10% off, 5% tax)
          </button>
          <button
            type="button"
            data-testid="calc-preset-warfarin-aspirin-btn"
            onClick={() => {
              setBasket([
                { medicationId: 9001, quantity: 1 },
                { medicationId: 9002, quantity: 1 },
              ]);
              setInlineError(null);
              setInlineSuccess(null);
            }}
            className="px-3 py-1.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
          >
            Sample: Warfarin + Aspirin Interaction
          </button>
          <button
            type="button"
            data-testid="calc-add-null-med-btn"
            onClick={() => {
              const nullMed = medications.find((m) => m.unit_price_cents === null) ?? medications[2];
              if (!nullMed) return;
              setBasket((prev) => {
                if (prev.some((i) => i.medicationId === nullMed.id)) return prev;
                return [...prev, { medicationId: nullMed.id, quantity: 1 }];
              });
            }}
            className="px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
          >
            + Add Unpriced Medication
          </button>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column: Medication picker & Line Items */}
        <div className="lg:col-span-7 space-y-4">
          <form
            onSubmit={handleAddMedicationToBasket}
            className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[220px]">
              <label
                htmlFor="calc-medication-select"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Select Medication
              </label>
              <select
                id="calc-medication-select"
                data-testid="calc-medication-select"
                value={medicationIdToAdd}
                onChange={(e) => setMedicationIdToAdd(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              >
                {availableMedications.map((med) => (
                  <option key={med.id} value={med.id}>
                    {med.brand_name} ({med.generic_name} · {med.strength ?? '—'}) —{' '}
                    {med.unit_price_cents === null
                      ? 'price not entered'
                      : formatMoneyDisplay(
                          med.unit_price_cents,
                          med.currency_code || med.currency || 'DZD',
                          { currencies: activeCurrencies },
                        )}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-24">
              <label
                htmlFor="calc-add-qty-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Qty
              </label>
              <input
                id="calc-add-qty-input"
                data-testid="calc-add-qty-input"
                type="number"
                min={1}
                step={1}
                value={quantityToAdd}
                onChange={(e) => setQuantityToAdd(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>

            <button
              type="submit"
              data-testid="calc-add-line-btn"
              className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
            >
              Add Item
            </button>
          </form>

          {/* AI Pharmacist Drug Interaction Red Alert Banner (above the cart) */}
          {interactionCheckItems.length >= 2 && interactionResult.hasMajorInteraction && (
            <div
              role="alert"
              aria-live="assertive"
              data-testid="calculator-drug-interaction-banner"
              className="p-4 bg-red-50 border-2 border-red-300 rounded-xl shadow-2xs space-y-2.5"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-red-800">
                      AI Pharmacist Interaction Alert
                    </span>
                    {isCheckingInteractions && (
                      <span className="text-[11px] font-medium text-red-700">
                        Verifying with AI Assistant...
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {interactionResult.interactions.map((interaction, idx) => (
                      <div
                        key={`${interaction.drugA}-${interaction.drugB}-${idx}`}
                        data-testid={`calculator-interaction-item-${idx}`}
                        className="space-y-0.5"
                      >
                        <p
                          data-testid="calculator-interaction-warning-text"
                          className="text-xs font-bold text-red-950"
                        >
                          {interaction.bannerMessage}
                        </p>
                        {interaction.clinicalSummary && (
                          <p className="text-xs text-red-800 leading-relaxed">
                            {interaction.clinicalSummary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  <p
                    data-testid="calculator-interaction-disclaimer"
                    className="pt-1.5 border-t border-red-200/80 text-[11px] font-medium text-red-900"
                  >
                    {interactionResult.disclaimer}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Selected Line Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table
              data-testid="calculator-lines-table"
              className="w-full text-left text-xs border-collapse"
            >
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Medication</th>
                  <th className="py-2.5 px-3.5 text-right font-medium">Unit Price</th>
                  <th className="py-2.5 px-3.5 text-right font-medium">Qty</th>
                  <th className="py-2.5 px-3.5 text-right font-medium">Subtotal</th>
                  <th className="py-2.5 px-3.5 text-right font-medium">Line Total</th>
                  <th className="py-2.5 px-3.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {evaluation.lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 px-4 text-center text-slate-500 font-sans">
                      No medications added yet.
                    </td>
                  </tr>
                ) : (
                  evaluation.lines.map((line) => (
                    <tr
                      key={line.medicationId}
                      data-testid={`calc-line-row-${line.medicationId}`}
                      className={line.hasNullPrice ? 'bg-red-50/40' : ''}
                    >
                      <td className="py-3 px-3.5 font-sans">
                        <div className="font-semibold text-slate-900">{line.brandName}</div>
                        <div className="text-[11px] text-slate-500">
                          {line.genericName} · {line.strength ?? '—'} · {line.dosageForm ?? '—'}
                        </div>
                      </td>

                      <td
                        data-testid={`calc-line-unit-price-${line.medicationId}`}
                        className={`py-3 px-3.5 text-right font-semibold ${
                          line.hasNullPrice ? 'text-red-700 font-sans' : 'text-slate-900'
                        }`}
                      >
                        {line.unitPriceFormatted}
                      </td>

                      <td className="py-3 px-3.5 text-right">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          aria-label={`Quantity for ${line.brandName}`}
                          data-testid={`calc-line-qty-input-${line.medicationId}`}
                          value={line.quantity}
                          onChange={(e) =>
                            handleUpdateLineQuantity(line.medicationId, Number(e.target.value))
                          }
                          className="w-16 px-2 py-1 text-right text-xs font-mono bg-white border border-slate-200 rounded-md"
                        />
                      </td>

                      <td
                        data-testid={`calc-line-subtotal-${line.medicationId}`}
                        className={`py-3 px-3.5 text-right ${
                          line.hasNullPrice ? 'text-red-700 font-semibold font-sans' : 'text-slate-600'
                        }`}
                      >
                        {line.lineSubtotalFormatted}
                      </td>

                      <td
                        data-testid={`calc-line-final-${line.medicationId}`}
                        className={`py-3 px-3.5 text-right font-bold ${
                          line.hasNullPrice ? 'text-red-700 font-sans' : 'text-slate-900'
                        }`}
                      >
                        {line.lineFinalTotalFormatted}
                      </td>

                      <td className="py-3 px-3.5 text-right font-sans">
                        <button
                          type="button"
                          data-testid={`calc-line-remove-btn-${line.medicationId}`}
                          onClick={() => handleRemoveLine(line.medicationId)}
                          className="px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* NULL-price refusal & inline price entry */}
          {evaluation.hasNullPriceItems && (
            <div
              role="alert"
              data-testid="calculator-null-price-blocker"
              className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3"
            >
              <div className="text-xs font-bold text-red-900">
                price not entered — set price to include in total
              </div>
              <p className="text-xs text-red-800">
                A grand total cannot be calculated while an item has no unit price entered. Enter a
                price below or remove the item from the quote:
              </p>

              {inlineError && (
                <div className="p-2.5 bg-white border border-red-200 rounded-lg text-xs text-red-800">
                  {inlineError}
                </div>
              )}

              <div className="space-y-2">
                {evaluation.nullPriceItems.map((missing) => (
                  <div
                    key={missing.medicationId}
                    data-testid={`calculator-null-item-${missing.medicationId}`}
                    className="p-3 bg-white border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        {missing.brandName}
                      </div>
                      <div className="text-[11px] text-red-700">
                        price not entered · Qty {missing.quantity}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        aria-label={`Inline unit price for ${missing.brandName}`}
                        data-testid={`calculator-inline-price-input-${missing.medicationId}`}
                        value={inlinePriceDrafts[missing.medicationId] ?? ''}
                        onChange={(e) =>
                          setInlinePriceDrafts((prev) => ({
                            ...prev,
                            [missing.medicationId]: e.target.value,
                          }))
                        }
                        placeholder="e.g. 46.50"
                        className="w-32 px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                      <button
                        type="button"
                        data-testid={`calculator-inline-price-save-btn-${missing.medicationId}`}
                        disabled={inlineSavingMedId === missing.medicationId}
                        onClick={() => void handleInlineSetPrice(missing.medicationId)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50"
                      >
                        {inlineSavingMedId === missing.medicationId ? 'Saving...' : 'Set Price'}
                      </button>
                      <button
                        type="button"
                        data-testid={`calculator-remove-null-item-${missing.medicationId}`}
                        onClick={() => handleRemoveLine(missing.medicationId)}
                        className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inlineSuccess && (
            <div
              role="status"
              data-testid="calculator-inline-price-success"
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-900"
            >
              {inlineSuccess}
            </div>
          )}
        </div>

        {/* Right column: Currency Selector, Discount %, Tax %, and Summary Totals */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-5">
          <div>
            <label
              htmlFor="calc-currency-select"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Calculator Currency (Base: Algerian Dinar DA)
            </label>
            <select
              id="calc-currency-select"
              data-testid="calc-currency-select"
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
            >
              {activeCurrencies.map((cur) => (
                <option key={cur.code} value={cur.code}>
                  {cur.code} — {cur.name} ({cur.symbol})
                  {cur.code === 'DZD' ? ' [Base]' : ` [1 ${cur.code} = ${cur.rate_to_da} DA]`}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label
                htmlFor="calc-discount-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Discount (%)
              </label>
              <input
                id="calc-discount-input"
                data-testid="calc-discount-input"
                type="text"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="calc-tax-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Tax (%)
              </label>
              <input
                id="calc-tax-input"
                data-testid="calc-tax-input"
                type="text"
                value={taxInput}
                onChange={(e) => setTaxInput(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-2.5 font-mono text-xs tabular-nums">
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-sans">Subtotal</span>
              <strong data-testid="calc-subtotal-value" className="text-slate-900">
                {evaluation.subtotalFormatted}
              </strong>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span className="font-sans">Discount ({evaluation.discountPercentDisplay}%)</span>
              <strong data-testid="calc-discount-value" className="text-slate-900">
                {evaluation.canComputeGrandTotal
                  ? `-${evaluation.discountAmountFormatted}`
                  : evaluation.discountAmountFormatted}
              </strong>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span className="font-sans">Tax ({evaluation.taxPercentDisplay}%)</span>
              <strong data-testid="calc-tax-value" className="text-slate-900">
                {evaluation.canComputeGrandTotal
                  ? `+${evaluation.taxAmountFormatted}`
                  : evaluation.taxAmountFormatted}
              </strong>
            </div>

            <div className="border-t border-slate-200 pt-3.5 space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <span className="text-sm font-bold text-slate-900 font-sans block">
                    Grand Total
                  </span>
                  {!isDzdCurrency(evaluation.currency) && evaluation.canComputeGrandTotal && (
                    <span className="text-[11px] font-sans text-slate-500">
                      Rate: 1 {evaluation.currency} = {evaluation.exchangeRateToDa} DA
                    </span>
                  )}
                </div>
                {evaluation.canComputeGrandTotal ? (
                  <div className="text-right space-y-1">
                    <div
                      data-testid="calc-grand-total-dzd"
                      className="text-2xl font-bold text-slate-900"
                    >
                      {evaluation.grandTotalDzdFormatted}
                    </div>
                    <div
                      data-testid="calc-grand-total-value"
                      className={
                        isDzdCurrency(evaluation.currency)
                          ? 'text-xs font-semibold text-sky-700 font-sans'
                          : 'text-sm font-bold text-sky-700'
                      }
                    >
                      {isDzdCurrency(evaluation.currency)
                        ? `${evaluation.grandTotalFormatted} (DZD)`
                        : `${evaluation.grandTotalFormatted} (${evaluation.currency})`}
                    </div>
                    <div
                      data-testid="calc-grand-total-major"
                      className="sr-only"
                    >
                      {evaluation.grandTotalMajor}
                    </div>
                  </div>
                ) : (
                  <div
                    data-testid="calc-grand-total-refused"
                    className="text-xs font-semibold text-red-700 font-sans text-right max-w-[220px]"
                  >
                    price not entered — set price to include in total
                  </div>
                )}
              </div>

              {/* Patient Name field & Export PDF Invoice button */}
              <div className="pt-2 border-t border-slate-200/80 space-y-2.5 font-sans">
                <div>
                  <label
                    htmlFor="calc-patient-name-input"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Patient / Customer Name (Optional for Invoice)
                  </label>
                  <input
                    id="calc-patient-name-input"
                    data-testid="calc-patient-name-input"
                    type="text"
                    value={patientNameInput}
                    onChange={(e) => setPatientNameInput(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>

                <button
                  type="button"
                  data-testid="export-pdf-invoice-btn"
                  onClick={handleExportPdfInvoice}
                  disabled={!evaluation.canComputeGrandTotal || calculatorInputItems.length === 0 || isExportingPdf}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-xs hover:shadow transition-all"
                >
                  <svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span>{isExportingPdf ? 'Generating PDF...' : 'Export PDF Invoice'}</span>
                </button>

                {pdfExportNotice && (
                  <div
                    data-testid="pdf-export-notice"
                    className="text-[11px] p-2 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-center"
                  >
                    {pdfExportNotice}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
