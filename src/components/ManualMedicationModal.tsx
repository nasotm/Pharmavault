import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  DollarSign,
  FileText,
  MapPin,
  Pill,
  X,
} from 'lucide-react';
import { getRepositoryDatabase } from '../db/repository';
import { insertMedication } from '../db/repository';
import { receiveStock } from '../movements';
import { getFdaDrugLabel, type FdaDrugLabel } from '../services/openFdaService';
import { getDrugInteractions } from '../services/rxnormService';

export interface ManualMedicationPrefill {
  name: string;
  rxcui?: string;
  cis?: string;
  composition?: string;
  presentations?: string[];
  fdaLabel?: FdaDrugLabel | null;
  fdaChecked?: boolean;
  sourceType?: 'rxnorm' | 'bdpm' | 'manual';
}

interface ManualMedicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefill?: ManualMedicationPrefill | null;
  onMedicationSaved: (medicationId: number) => void;
  onDatabaseMutated?: () => Promise<void> | void;
}

export function ManualMedicationModal({
  isOpen,
  onClose,
  prefill,
  onMedicationSaved,
  onDatabaseMutated,
}: ManualMedicationModalProps) {
  const [brandName, setBrandName] = useState<string>('');
  const [genericName, setGenericName] = useState<string>('');
  const [rxcuiCode, setRxcuiCode] = useState<string>('');
  const [strength, setStrength] = useState<string>('');
  const [dosageForm, setDosageForm] = useState<string>('Tablet');
  const [category, setCategory] = useState<string>('Essential');
  const [therapeuticClass, setTherapeuticClass] = useState<string>('');
  const [barcode, setBarcode] = useState<string>('');
  const [manufacturer, setManufacturer] = useState<string>('');
  const [composition, setComposition] = useState<string>('');

  // Location fields
  const [zone, setZone] = useState<string>('A');
  const [shelf, setShelf] = useState<string>('1');
  const [bin, setBin] = useState<string>('1');
  const [locationNote, setLocationNote] = useState<string>('');

  // Algerian Dinar (DA) Price - Required Manual Entry
  const [unitPriceDa, setUnitPriceDa] = useState<string>('');
  const [costPriceDa, setCostPriceDa] = useState<string>('');
  const [unitsPerPack, setUnitsPerPack] = useState<string>('1');
  const [reorderLevel, setReorderLevel] = useState<string>('10');

  // Medical Info
  const [posology, setPosology] = useState<string>('');
  const [indications, setIndications] = useState<string>('');
  const [precautions, setPrecautions] = useState<string>('');
  const [sideEffects, setSideEffects] = useState<string>('');
  const [interactionsText, setInteractionsText] = useState<string>('');

  // Optional Initial Batch Stock
  const [initialQuantity, setInitialQuantity] = useState<string>('0');
  const [batchNumber, setBatchNumber] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');

  // Status & Validation
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingInteractions, setIsLoadingInteractions] = useState<boolean>(false);
  const [isLoadingFdaLabel, setIsLoadingFdaLabel] = useState<boolean>(false);
  const [fdaLabelFound, setFdaLabelFound] = useState<boolean | null>(null);
  const [fdaLabelMessage, setFdaLabelMessage] = useState<string | null>(null);

  // Reset or pre-fill form when opened
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setIsSubmitting(false);
      setIsLoadingFdaLabel(false);
      setFdaLabelFound(null);
      setFdaLabelMessage(null);

      if (prefill) {
        setBrandName(prefill.name);
        setRxcuiCode(prefill.rxcui || '');
        if (prefill.cis) {
          setBarcode(`CIS-${prefill.cis}`);
        } else if (prefill.rxcui) {
          setBarcode(`RX-${prefill.rxcui}`);
        } else {
          setBarcode('');
        }
        setComposition(prefill.composition || '');

        // Attempt to extract strength/form heuristic if available in name
        const match = prefill.name.match(/(\d+(?:\.\d+)?\s*(?:MG|G|MCG|ML|MG\/ML))/i);
        if (match) {
          setStrength(match[1]);
        }
        if (/capsule|gélule/i.test(prefill.name)) setDosageForm('Capsule');
        else if (/syrup|sirop|solution/i.test(prefill.name)) setDosageForm('Syrup');
        else if (/injection|injectable/i.test(prefill.name)) setDosageForm('Injection');
        else if (/comprimé/i.test(prefill.name)) setDosageForm('Tablet');
        else setDosageForm('Oral Tablet');

        // Check OpenFDA drug label prefill
        if (prefill.fdaChecked !== undefined) {
          if (prefill.fdaLabel) {
            setIndications(prefill.fdaLabel.indications || '');
            setPosology(prefill.fdaLabel.dosage_and_administration || '');
            setPrecautions(prefill.fdaLabel.warnings || '');
            setSideEffects(prefill.fdaLabel.adverse_reactions || '');
            setFdaLabelFound(true);
            setFdaLabelMessage('FDA drug label loaded from OpenFDA.');
          } else {
            setIndications('');
            setPosology('');
            setPrecautions('');
            setSideEffects('');
            setFdaLabelFound(false);
            setFdaLabelMessage('No FDA label available. Please fill manually.');
          }
        } else if (prefill.rxcui) {
          setIsLoadingFdaLabel(true);
          getFdaDrugLabel(prefill.rxcui)
            .then((label) => {
              if (label) {
                setIndications(label.indications || '');
                setPosology(label.dosage_and_administration || '');
                setPrecautions(label.warnings || '');
                setSideEffects(label.adverse_reactions || '');
                setFdaLabelFound(true);
                setFdaLabelMessage('FDA drug label loaded from OpenFDA.');
              } else {
                setIndications('');
                setPosology('');
                setPrecautions('');
                setSideEffects('');
                setFdaLabelFound(false);
                setFdaLabelMessage('No FDA label available. Please fill manually.');
              }
            })
            .catch(() => {
              setIndications('');
              setPosology('');
              setPrecautions('');
              setSideEffects('');
              setFdaLabelFound(false);
              setFdaLabelMessage('No FDA label available. Please fill manually.');
            })
            .finally(() => {
              setIsLoadingFdaLabel(false);
            });
        }

        // Fetch RxNorm interactions in background to assist the pharmacist
        if (prefill.rxcui) {
          setIsLoadingInteractions(true);
          getDrugInteractions(prefill.rxcui)
            .then((res) => {
              if (res.length > 0) {
                const summary = res
                  .slice(0, 5)
                  .map((i) => `• ${i.interactionDrug}: ${i.description}`)
                  .join('\n');
                setInteractionsText(summary);
              }
            })
            .catch(() => {})
            .finally(() => setIsLoadingInteractions(false));
        }
      } else {
        setBrandName('');
        setGenericName('');
        setRxcuiCode('');
        setBarcode('');
        setStrength('');
        setComposition('');
        setDosageForm('Tablet');
        setCategory('Essential');
        setTherapeuticClass('');
        setInteractionsText('');
        setIndications('');
        setPosology('');
        setPrecautions('');
        setSideEffects('');
        setFdaLabelFound(null);
        setFdaLabelMessage(null);
      }

      setUnitPriceDa('');
      setCostPriceDa('');
      setUnitsPerPack('1');
      setReorderLevel('10');
      setZone('A');
      setShelf('1');
      setBin('1');
      setLocationNote('');
      setInitialQuantity('0');
      setBatchNumber(`BATCH-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`);
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 2);
      setExpiryDate(nextYear.toISOString().slice(0, 10));
    }
  }, [isOpen, prefill]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanBrand = brandName.trim();
    if (!cleanBrand) {
      setErrorMessage('Medication Name is required.');
      return;
    }

    const cleanPriceDa = unitPriceDa.trim();
    if (!cleanPriceDa) {
      setErrorMessage('Retail Unit Price in Algerian Dinar (DA) is required.');
      return;
    }

    const priceDaNum = Number(cleanPriceDa);
    if (!Number.isInteger(priceDaNum) || priceDaNum <= 0) {
      setErrorMessage('Unit Price must be a positive whole number in Algerian Dinar (e.g. 1250).');
      return;
    }

    const costDaNum = costPriceDa.trim() ? Number(costPriceDa.trim()) : null;
    if (costDaNum !== null && (!Number.isInteger(costDaNum) || costDaNum < 0)) {
      setErrorMessage('Cost Price must be a valid positive integer in DA.');
      return;
    }

    const initQtyNum = Number(initialQuantity) || 0;
    if (initQtyNum < 0 || !Number.isInteger(initQtyNum)) {
      setErrorMessage('Initial stock quantity must be a non-negative integer.');
      return;
    }

    setIsSubmitting(true);
    try {
      const db = getRepositoryDatabase();
      const newMed = await insertMedication(db, {
        brand_name: cleanBrand,
        generic_name: genericName.trim() || cleanBrand,
        strength: strength.trim() || null,
        dosage_form: dosageForm.trim() || null,
        category: category.trim() || null,
        therapeutic_class: therapeuticClass.trim() || null,
        barcode: barcode.trim() || (prefill?.cis ? `CIS-${prefill.cis}` : rxcuiCode ? `RX-${rxcuiCode}` : null),
        manufacturer: manufacturer.trim() || null,
        zone: zone.trim() || 'A',
        shelf: shelf.trim() || '1',
        bin: bin.trim() || '1',
        location_note: locationNote.trim() || null,
        reorder_level: Number(reorderLevel) || 10,
        lead_time_days: 7,
        unit_price_cents: priceDaNum, // In DZD, stored as integer DA
        cost_price_cents: costDaNum,
        currency: 'DZD',
        currency_code: 'DZD',
        units_per_pack: Number(unitsPerPack) || 1,
        price_source: prefill ? 'imported' : 'manual',
        price_confirmed: 1,
        price_updated_at: new Date().toISOString(),
        composition: composition.trim() || null,
        posology: posology.trim() || null,
        indications: indications.trim() || null,
        precautions: precautions.trim() || null,
        side_effects: sideEffects.trim() || null,
        interactions: interactionsText.trim() || null,
      });

      // If initial stock quantity specified, receive stock
      if (initQtyNum > 0) {
        await receiveStock(db, {
          medicationId: newMed.id,
          lotNumber: batchNumber.trim() || `INIT-${newMed.id}`,
          quantity: initQtyNum,
          expiryDate: expiryDate.trim() || '2028-12-31',
          userId: 'Pharmacist Reviewer',
          reason: prefill?.cis
            ? `Imported from French BDPM (CIS: ${prefill.cis})`
            : prefill?.rxcui
              ? `Imported from RxNorm (RxCUI: ${prefill.rxcui})`
              : 'Manual stock entry',
        });
      }

      if (onDatabaseMutated) {
        await onDatabaseMutated();
      }

      onMedicationSaved(newMed.id);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-medication-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 my-8 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-sky-950/80 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-100 dark:border-sky-800">
              <Pill className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="manual-medication-title"
                className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"
              >
                {prefill?.cis
                  ? 'Import from French BDPM'
                  : prefill?.rxcui
                    ? 'Import from RxNorm'
                    : 'Add Medication'}
                {prefill?.cis && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    CIS: {prefill.cis}
                  </span>
                )}
                {prefill?.rxcui && !prefill?.cis && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    RXCUI: {prefill.rxcui}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {prefill
                  ? 'Review medication details, assign shelf location, and set local price in Algerian Dinar (DA)'
                  : 'Enter medication parameters to save into dispensary database'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational banner: Pharmacist review required, no auto-save */}
        {prefill && (
          <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Pharmacist Review Required:</span>{' '}
              {prefill.cis ? 'French BDPM' : 'Global RxNorm'} data is pre-filled below for
              verification. It will <strong>NOT</strong> be saved to inventory until you enter the
              retail price in <strong>Algerian Dinar (DA)</strong> and click confirm.
            </div>
          </div>
        )}

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 text-xs text-red-700 dark:text-red-300 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Section 1: Identification */}
          <div className="space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />
              <span>Medication Identification</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Brand / Medication Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. Amoxil 500mg"
                  data-testid="manual-med-brand-name"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Generic Molecule Name
                </label>
                <input
                  type="text"
                  value={genericName}
                  onChange={(e) => setGenericName(e.target.value)}
                  placeholder="e.g. Amoxicillin"
                  data-testid="manual-med-generic-name"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Barcode / Package Code
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="e.g. 613123456789"
                  data-testid="manual-med-barcode"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Strength
                </label>
                <input
                  type="text"
                  value={strength}
                  onChange={(e) => setStrength(e.target.value)}
                  placeholder="e.g. 500mg, 10mg/ml"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Dosage Form
                </label>
                <input
                  type="text"
                  value={dosageForm}
                  onChange={(e) => setDosageForm(e.target.value)}
                  placeholder="e.g. Oral Tablet, Syrup, Injection"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Manufacturer / Laboratory
                </label>
                <input
                  type="text"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="e.g. Saidal, Sanofi, Pfizer"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Pricing & Packaging (Highlighting Algerian Dinar DA) */}
          <div className="p-4 rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" />
                <span>Pricing &amp; Units (Algerian Dinar)</span>
              </span>
              <span className="text-[11px] font-bold text-sky-700 dark:text-sky-400">
                Base Currency: DZD (DA)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  Unit Retail Price (DA) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={unitPriceDa}
                    onChange={(e) => setUnitPriceDa(e.target.value)}
                    placeholder="e.g. 1250"
                    data-testid="manual-med-price-da"
                    className="w-full pl-3.5 pr-14 py-2.5 rounded-xl text-sm font-mono font-bold bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-bold font-mono text-sky-700 dark:text-sky-300">
                    DA
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Exact integer DZD without cents (e.g. 1,250 DA).
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Units Per Pack
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={unitsPerPack}
                  onChange={(e) => setUnitsPerPack(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Physical Location */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              <span>Physical Shelf Location</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Zone
                </label>
                <input
                  type="text"
                  value={zone}
                  onChange={(e) => setZone(e.target.value.toUpperCase())}
                  placeholder="e.g. A"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono text-center bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Shelf
                </label>
                <input
                  type="text"
                  value={shelf}
                  onChange={(e) => setShelf(e.target.value)}
                  placeholder="e.g. 1"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono text-center bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Bin
                </label>
                <input
                  type="text"
                  value={bin}
                  onChange={(e) => setBin(e.target.value)}
                  placeholder="e.g. 1"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono text-center bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Initial Stock Batch (Optional) */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span>Initial Stock Receiving (Optional)</span>
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Creates initial inventory batch
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Initial Quantity
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={initialQuantity}
                  onChange={(e) => setInitialQuantity(e.target.value)}
                  placeholder="0"
                  data-testid="manual-med-init-qty"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Batch Number
                </label>
                <input
                  type="text"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  placeholder="e.g. BATCH-01"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Expiry Date
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Medical Information & RxNorm Insights */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>Medical Information &amp; Interactions</span>
              </span>
              {isLoadingInteractions && (
                <span className="text-[11px] text-sky-600 dark:text-sky-400 animate-pulse">
                  Querying RxNorm interactions...
                </span>
              )}
            </div>

            {/* OpenFDA Drug Label Status Banner */}
            {isLoadingFdaLabel && (
              <div
                data-testid="fda-label-loading-banner"
                className="p-3.5 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-xs flex items-center gap-2 animate-pulse"
              >
                <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Fetching FDA drug label (indications, posology, warnings, side effects) from OpenFDA...</span>
              </div>
            )}

            {!isLoadingFdaLabel && fdaLabelFound === false && (
              <div
                role="status"
                data-testid="fda-label-not-found-banner"
                className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/90 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="font-semibold">{fdaLabelMessage ?? 'No FDA label available. Please fill manually.'}</span>
              </div>
            )}

            {!isLoadingFdaLabel && fdaLabelFound === true && (
              <div
                role="status"
                data-testid="fda-label-found-banner"
                className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="font-semibold">
                  Full FDA Drug Label Loaded: Indications, posology, precautions &amp; adverse reactions pre-filled from OpenFDA.
                </span>
              </div>
            )}

            <div className="space-y-3">
              {/* Composition (Active Substance & Excipients) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Composition (Active Substance &amp; Excipients)
                  </label>
                  {prefill?.cis && (
                    <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      Source: French BDPM (CIS {prefill.cis})
                    </span>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={composition}
                  onChange={(e) => setComposition(e.target.value)}
                  placeholder="Active substance and excipients (e.g. Paracétamol 1000mg, Povidone, Talc...)"
                  data-testid="manual-med-composition"
                  className="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              {prefill?.presentations && prefill.presentations.length > 0 && (
                <div className="p-3 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    ANSM Official Presentation(s):
                  </span>
                  <ul className="text-[11px] text-slate-600 dark:text-slate-400 list-disc list-inside space-y-0.5">
                    {prefill.presentations.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Known Drug-Drug Interactions
                </label>
                <textarea
                  rows={2}
                  value={interactionsText}
                  onChange={(e) => setInteractionsText(e.target.value)}
                  placeholder="Significant drug interactions or contraindications..."
                  className="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Posology / Dosage Instructions
                  </label>
                  <input
                    type="text"
                    value={posology}
                    onChange={(e) => setPosology(e.target.value)}
                    placeholder="e.g. 1 tablet every 8 hours"
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Indications
                  </label>
                  <input
                    type="text"
                    value={indications}
                    onChange={(e) => setIndications(e.target.value)}
                    placeholder="e.g. Bacterial respiratory infections"
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Precautions &amp; Warnings
                  </label>
                  <input
                    type="text"
                    value={precautions}
                    onChange={(e) => setPrecautions(e.target.value)}
                    placeholder="e.g. Hepatic impairment, pregnancy"
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Adverse Side Effects
                  </label>
                  <input
                    type="text"
                    value={sideEffects}
                    onChange={(e) => setSideEffects(e.target.value)}
                    placeholder="e.g. Nausea, headache, skin rash"
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Footer actions */}
        <div className="px-6 py-4 bg-slate-50/80 dark:bg-slate-900/90 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            data-testid="manual-med-save-button"
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400 shadow-md shadow-sky-600/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'Saving...' : 'Confirm & Save Medication'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
