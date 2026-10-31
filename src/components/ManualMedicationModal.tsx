import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  DollarSign,
  FileText,
  MapPin,
  Pill,
  X,
} from 'lucide-react';
import {
  getRepositoryDatabase,
  insertMedication,
  insertBatch,
  insertMovement,
  insertPriceHistory,
} from '../db/repository';
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
  // CATALOG Fields
  const [brandName, setBrandName] = useState<string>('');
  const [genericName, setGenericName] = useState<string>('');
  const [strength, setStrength] = useState<string>('');
  const [dosageForm, setDosageForm] = useState<string>('Oral Tablet');
  const [category, setCategory] = useState<string>('Essential');
  const [barcode, setBarcode] = useState<string>('');
  const [rxcuiCode, setRxcuiCode] = useState<string>('');
  const [manufacturer, setManufacturer] = useState<string>('');
  const [therapeuticClass, setTherapeuticClass] = useState<string>('');

  // INVENTORY Fields
  const [zone, setZone] = useState<string>('A');
  const [shelf, setShelf] = useState<string>('1');
  const [bin, setBin] = useState<string>('1');
  const [locationNote, setLocationNote] = useState<string>('');
  const [initialQuantity, setInitialQuantity] = useState<string>('10');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [batchNumber, setBatchNumber] = useState<string>('');

  // PRICE Fields
  const [unitPriceDa, setUnitPriceDa] = useState<string>('');
  const [costPriceDa, setCostPriceDa] = useState<string>('');
  const [reorderLevel, setReorderLevel] = useState<string>('10');
  const [unitsPerPack, setUnitsPerPack] = useState<string>('1');

  // Medical Info (Optional / for BDPM & RxNorm)
  const [composition, setComposition] = useState<string>('');
  const [posology, setPosology] = useState<string>('');
  const [indications, setIndications] = useState<string>('');
  const [precautions, setPrecautions] = useState<string>('');
  const [sideEffects, setSideEffects] = useState<string>('');
  const [interactionsText, setInteractionsText] = useState<string>('');
  const [showMedicalSection, setShowMedicalSection] = useState<boolean>(false);

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

      const defaultBatchNum = `BATCH-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;
      const defaultExpDate = new Date();
      defaultExpDate.setFullYear(defaultExpDate.getFullYear() + 2);
      const defaultExpStr = defaultExpDate.toISOString().slice(0, 10);

      setZone('A');
      setShelf('1');
      setBin('1');
      setLocationNote('');
      setInitialQuantity('10');
      setBatchNumber(defaultBatchNum);
      setExpiryDate(defaultExpStr);
      setReorderLevel('10');
      setUnitsPerPack('1');
      setUnitPriceDa('');
      setCostPriceDa('');

      if (prefill) {
        setShowMedicalSection(true);
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

        const match = prefill.name.match(/(\d+(?:\.\d+)?\s*(?:MG|G|MCG|ML|MG\/ML))/i);
        if (match) {
          setStrength(match[1]);
        } else {
          setStrength('');
        }

        if (/capsule|gélule/i.test(prefill.name)) setDosageForm('Capsule');
        else if (/syrup|sirop|solution/i.test(prefill.name)) setDosageForm('Syrup');
        else if (/injection|injectable/i.test(prefill.name)) setDosageForm('Injection');
        else if (/comprimé/i.test(prefill.name)) setDosageForm('Oral Tablet');
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
        setShowMedicalSection(false);
        setBrandName('');
        setGenericName('');
        setStrength('');
        setDosageForm('Oral Tablet');
        setCategory('Essential');
        setBarcode('');
        setRxcuiCode('');
        setManufacturer('');
        setTherapeuticClass('');
        setComposition('');
        setPosology('');
        setIndications('');
        setPrecautions('');
        setSideEffects('');
        setInteractionsText('');
        setFdaLabelFound(null);
        setFdaLabelMessage(null);
      }
    }
  }, [isOpen, prefill]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Validate Brand Name
    const cleanBrand = brandName.trim();
    if (!cleanBrand) {
      setErrorMessage('Brand Name is required.');
      return;
    }

    // 2. Validate Initial Quantity
    const cleanInitQty = initialQuantity.trim();
    if (!cleanInitQty) {
      setErrorMessage('Initial Quantity is required.');
      return;
    }
    const initQtyNum = Number(cleanInitQty);
    if (!Number.isInteger(initQtyNum) || initQtyNum < 0) {
      setErrorMessage('Initial Quantity must be a non-negative whole number (e.g. 0, 10, 50).');
      return;
    }

    // 3. Validate Unit Price (optional; if entered, must be non-negative integer DA)
    let priceDaNum: number | null = null;
    if (unitPriceDa.trim()) {
      const parsedPrice = Number(unitPriceDa.trim());
      if (!Number.isInteger(parsedPrice) || parsedPrice < 0) {
        setErrorMessage('Unit Price must be a non-negative whole number in Algerian Dinar (DA).');
        return;
      }
      priceDaNum = parsedPrice;
    }

    // 4. Validate Cost Price (optional; if entered, must be non-negative integer DA)
    let costDaNum: number | null = null;
    if (costPriceDa.trim()) {
      const parsedCost = Number(costPriceDa.trim());
      if (!Number.isInteger(parsedCost) || parsedCost < 0) {
        setErrorMessage('Cost Price must be a valid non-negative integer in DA.');
        return;
      }
      costDaNum = parsedCost;
    }

    // 5. Validate Reorder Level (optional, defaults to 10)
    const reorderLevelNum = reorderLevel.trim() ? Number(reorderLevel.trim()) : 10;
    if (!Number.isInteger(reorderLevelNum) || reorderLevelNum < 0) {
      setErrorMessage('Reorder Level must be a non-negative whole number.');
      return;
    }

    setIsSubmitting(true);
    try {
      const db = getRepositoryDatabase();
      const nowIso = new Date().toISOString();

      // Step 1: Insert a new medication row
      const newMed = await insertMedication(db, {
        brand_name: cleanBrand,
        generic_name: genericName.trim() || cleanBrand,
        strength: strength.trim() || null,
        dosage_form: dosageForm.trim() || null,
        category: category.trim() || 'Essential',
        therapeutic_class: therapeuticClass.trim() || null,
        barcode:
          barcode.trim() ||
          (prefill?.cis ? `CIS-${prefill.cis}` : rxcuiCode ? `RX-${rxcuiCode}` : null),
        manufacturer: manufacturer.trim() || null,
        zone: zone.trim() || 'A',
        shelf: shelf.trim() || '1',
        bin: bin.trim() || '1',
        location_note: locationNote.trim() || null,
        reorder_level: reorderLevelNum,
        lead_time_days: 7,
        unit_price_cents: priceDaNum, // In DZD, stored as integer DA
        cost_price_cents: costDaNum,
        currency: 'DZD',
        currency_code: 'DZD',
        units_per_pack: Number(unitsPerPack) || 1,
        price_source: priceDaNum !== null ? 'manual' : (prefill ? 'imported' : null),
        price_confirmed: priceDaNum !== null ? 1 : 0,
        price_updated_at: priceDaNum !== null ? nowIso : null,
        composition: composition.trim() || null,
        posology: posology.trim() || null,
        indications: indications.trim() || null,
        precautions: precautions.trim() || null,
        side_effects: sideEffects.trim() || null,
        interactions: interactionsText.trim() || null,
      });

      // Step 2: Insert a new batch row with the initial quantity and expiry date
      const lotVal = batchNumber.trim() || `BATCH-${newMed.id}`;
      const expiryVal = expiryDate.trim() || null;
      const newBatch = await insertBatch(db, {
        medication_id: newMed.id,
        lot_number: lotVal,
        quantity: initQtyNum,
        expiry_date: expiryVal,
        received_at: nowIso,
      });

      // Step 3: If a price is provided, insert a price_history row (source='manual', confirmed=1)
      if (priceDaNum !== null) {
        await insertPriceHistory(db, {
          medication_id: newMed.id,
          unit_price_cents: priceDaNum,
          source: 'manual',
          changed_by: 'Pharmacist',
          created_at: nowIso,
        });
      }

      // Step 4: Insert an initial stock_movement row (delta = +quantity, reason = 'initial_receipt')
      await insertMovement(db, {
        medication_id: newMed.id,
        batch_id: newBatch.id,
        delta: initQtyNum,
        reason: 'initial_receipt',
        user_id: 'Pharmacist',
        created_at: nowIso,
      });

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
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 my-6 overflow-hidden flex flex-col max-h-[92vh]">
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
                    : 'Add Medication to Inventory'}
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
                Enter medication catalog specifications, inventory storage location &amp; batch, and pricing in Algerian Dinar (DA).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
            data-testid="manual-med-cancel-button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational banner when prefilled from BDPM or RxNorm */}
        {prefill && (
          <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Pharmacist Review Required:</span>{' '}
              {prefill.cis ? 'French BDPM' : 'Global RxNorm'} data is pre-filled below for verification.
              Review and confirm details to save into dispensary inventory.
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

          {/* SECTION 1: CATALOG */}
          <div className="space-y-4 rounded-2xl p-4 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>CATALOG</span>
              </span>
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                Reference &amp; Product Identification
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Brand Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. Amoxil 500mg, Doliprane 1000mg"
                  data-testid="manual-med-brand-name"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Generic Name (DCI)
                </label>
                <input
                  type="text"
                  value={genericName}
                  onChange={(e) => setGenericName(e.target.value)}
                  placeholder="e.g. Amoxicillin, Paracetamol"
                  data-testid="manual-med-generic-name"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                  placeholder="e.g. 500mg, 1g, 10mg/ml"
                  data-testid="manual-med-strength"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                  placeholder="e.g. Oral Tablet, Syrup, Injection, Capsule"
                  data-testid="manual-med-dosage-form"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  data-testid="manual-med-category"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="Essential">Essential</option>
                  <option value="Antibiotic">Antibiotic</option>
                  <option value="Analgesic">Analgesic</option>
                  <option value="Cardiovascular">Cardiovascular</option>
                  <option value="Respiratory">Respiratory</option>
                  <option value="Gastrointestinal">Gastrointestinal</option>
                  <option value="Dermatological">Dermatological</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Barcode
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="e.g. 613123456789 or EAN-13"
                  data-testid="manual-med-barcode"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: INVENTORY */}
          <div className="space-y-4 rounded-2xl p-4 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>INVENTORY</span>
              </span>
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                Dispensary Location &amp; Initial Stock Batch
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Zone
                </label>
                <input
                  type="text"
                  value={zone}
                  onChange={(e) => setZone(e.target.value.toUpperCase())}
                  placeholder="e.g. A"
                  data-testid="manual-med-zone"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                  data-testid="manual-med-shelf"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                  data-testid="manual-med-bin"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="sm:col-span-3 space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Location Note
                </label>
                <input
                  type="text"
                  value={locationNote}
                  onChange={(e) => setLocationNote(e.target.value)}
                  placeholder="e.g. Top rack, refrigerated drawer, front counter"
                  data-testid="manual-med-location-note"
                  className="w-full px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Initial Quantity <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={initialQuantity}
                  onChange={(e) => setInitialQuantity(e.target.value)}
                  placeholder="10"
                  data-testid="manual-med-init-qty"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-bold"
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
                  data-testid="manual-med-expiry-date"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Lot Number
                </label>
                <input
                  type="text"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  placeholder="e.g. BATCH-240101"
                  data-testid="manual-med-lot-number"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: PRICE */}
          <div className="space-y-4 rounded-2xl p-4 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60">
            <div className="text-xs font-bold uppercase tracking-wider text-sky-900 dark:text-sky-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>PRICE</span>
              </span>
              <span className="text-[11px] font-bold text-sky-700 dark:text-sky-400">
                Currency: Algerian Dinar (DA)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  Unit Price (in DA)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={unitPriceDa}
                    onChange={(e) => setUnitPriceDa(e.target.value)}
                    placeholder="e.g. 1250"
                    data-testid="manual-med-price-da"
                    className="w-full pl-3.5 pr-12 py-2 rounded-xl text-sm font-mono font-bold bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="absolute right-3 top-2 text-xs font-bold font-mono text-sky-700 dark:text-sky-400">
                    DA
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Retail selling price to patient.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Cost Price (optional)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={costPriceDa}
                    onChange={(e) => setCostPriceDa(e.target.value)}
                    placeholder="e.g. 980"
                    data-testid="manual-med-cost-price-da"
                    className="w-full pl-3.5 pr-12 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="absolute right-3 top-2 text-xs font-semibold font-mono text-slate-500 dark:text-slate-400">
                    DA
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Purchase cost from distributor.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Reorder Level
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={reorderLevel}
                  onChange={(e) => setReorderLevel(e.target.value)}
                  placeholder="10"
                  data-testid="manual-med-reorder-level"
                  className="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Threshold for low stock warnings.
                </p>
              </div>
            </div>
          </div>

          {/* Optional: Medical Info & Interactions (collapsible for cleaner manual entry) */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowMedicalSection(!showMedicalSection)}
              className="w-full px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between text-left text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-slate-800/60 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <span>Medical Info, Indications &amp; Interactions (Optional)</span>
              </span>
              {showMedicalSection ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showMedicalSection && (
              <div className="p-4 space-y-3.5 border-t border-slate-200 dark:border-slate-800">
                {isLoadingFdaLabel && (
                  <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-xs flex items-center gap-2 animate-pulse">
                    <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0" />
                    <span>Fetching FDA drug label from OpenFDA...</span>
                  </div>
                )}

                {!isLoadingFdaLabel && fdaLabelFound === true && (
                  <div
                    role="status"
                    data-testid="fda-label-found-banner"
                    className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{fdaLabelMessage ?? 'FDA Drug Label loaded from OpenFDA.'}</span>
                  </div>
                )}

                {!isLoadingFdaLabel && fdaLabelFound === false && (
                  <div
                    role="status"
                    data-testid="fda-label-not-found-banner"
                    className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{fdaLabelMessage ?? 'No FDA label available. Please fill manually.'}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Composition &amp; Active Ingredients
                  </label>
                  <textarea
                    rows={2}
                    value={composition}
                    onChange={(e) => setComposition(e.target.value)}
                    placeholder="e.g. Amoxicilline trihydratée équivalente à amoxicilline 500 mg..."
                    data-testid="manual-med-composition"
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
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
                      placeholder="e.g. 1 gélule 3 fois par jour"
                      className="w-full px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
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
                      placeholder="e.g. Angines, sinusites, bronchites"
                      className="w-full px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
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
                      placeholder="e.g. Allergie aux pénicillines"
                      className="w-full px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
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
                      placeholder="e.g. Nausées, diarrhée, éruptions cutanées"
                      className="w-full px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Known Drug Interactions
                    </label>
                    {isLoadingInteractions && (
                      <span className="text-[11px] text-sky-600 dark:text-sky-400 animate-pulse">
                        Querying RxNorm...
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={interactionsText}
                    onChange={(e) => setInteractionsText(e.target.value)}
                    placeholder="Significant drug interactions..."
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}
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
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400 shadow-md shadow-sky-600/20 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'Saving...' : 'Save Medication'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
