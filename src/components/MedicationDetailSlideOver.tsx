import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Stethoscope,
} from 'lucide-react';
import {
  getRepositoryDatabase,
  updateMedicationFromImport,
  updateMedicationLocalInventory,
  updateMedicationMedicalInfo,
} from '../db/repository';
import { type CurrentUserProfile } from '../movements';
import { formatMedicationPriceInDa } from '../pricing';
import { getMedicationDetailForSearch, type SearchMedicationDetail } from '../search';
import { ScanLeafletModal } from './ScanLeafletModal';
import { type ScannedLeafletData } from '../services/scanLeafletService';
import {
  LOW_STOCK_BADGE_PULSE_ANIMATE,
  LOW_STOCK_BADGE_PULSE_TRANSITION,
  SLIDE_OVER_BACKDROP_TRANSITION,
  SLIDE_OVER_BACKDROP_VARIANTS,
  SLIDE_OVER_PANEL_TRANSITION,
  SLIDE_OVER_PANEL_VARIANTS,
} from '../utils/animations';
import { getExpiryVisualBadge } from '../utils/expiry';
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

  // Edit location state
  const [isEditingLocation, setIsEditingLocation] = useState<boolean>(false);
  const [zoneDraft, setZoneDraft] = useState<string>('');
  const [shelfDraft, setShelfDraft] = useState<string>('');
  const [binDraft, setBinDraft] = useState<string>('');
  const [locationNoteDraft, setLocationNoteDraft] = useState<string>('');
  const [isSavingLocation, setIsSavingLocation] = useState<boolean>(false);
  const [locationFeedback, setLocationFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Collapsible Medical Information & Manual Edit state
  const [isMedicalInfoOpen, setIsMedicalInfoOpen] = useState<boolean>(true);
  const [isEditingMedicalInfo, setIsEditingMedicalInfo] = useState<boolean>(false);
  const [isScanLeafletModalOpen, setIsScanLeafletModalOpen] = useState<boolean>(false);
  const [scannedNotification, setScannedNotification] = useState<string | null>(null);

  // Leaflet / Medical Draft Fields
  const [brandNameDraft, setBrandNameDraft] = useState<string>('');
  const [genericNameDraft, setGenericNameDraft] = useState<string>('');
  const [strengthDraft, setStrengthDraft] = useState<string>('');
  const [dosageFormDraft, setDosageFormDraft] = useState<string>('');
  const [posologyDraft, setPosologyDraft] = useState<string>('');
  const [interactionsDraft, setInteractionsDraft] = useState<string>('');
  const [compositionDraft, setCompositionDraft] = useState<string>('');
  const [therapeuticClassDraft, setTherapeuticClassDraft] = useState<string>('');
  const [indicationsDraft, setIndicationsDraft] = useState<string>('');
  const [precautionsDraft, setPrecautionsDraft] = useState<string>('');
  const [routeDraft, setRouteDraft] = useState<string>('');
  const [sideEffectsDraft, setSideEffectsDraft] = useState<string>('');
  const [isSavingMedicalInfo, setIsSavingMedicalInfo] = useState<boolean>(false);
  const [medicalInfoFeedback, setMedicalInfoFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

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
      setIsEditingLocation(false);
      setLocationFeedback(null);
      setIsEditingMedicalInfo(false);
      setMedicalInfoFeedback(null);
      return;
    }
    setIsEditingLocation(false);
    setLocationFeedback(null);
    setIsEditingMedicalInfo(false);
    setMedicalInfoFeedback(null);
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

  const isOpen = medicationId !== null && detail !== null;
  const medication = detail?.medication;
  const isLowStock = detail && medication ? detail.totalStock <= medication.reorder_level : false;

  const handleRefreshAfterMutation = async () => {
    if (!medication) return;
    await loadDetail(medication.id);
    await onMutated();
  };

  const handleOpenEditLocation = () => {
    if (!medication) return;
    setZoneDraft(medication.zone ?? '');
    setShelfDraft(medication.shelf ?? '');
    setBinDraft(medication.bin ?? '');
    setLocationNoteDraft(medication.location_note ?? '');
    setLocationFeedback(null);
    setIsEditingLocation(true);
  };

  const handleCancelEditLocation = () => {
    setIsEditingLocation(false);
    setLocationFeedback(null);
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medication) return;
    setIsSavingLocation(true);
    setLocationFeedback(null);
    try {
      const db = getRepositoryDatabase();
      await updateMedicationLocalInventory(db, medication.id, {
        zone: zoneDraft.trim() || null,
        shelf: shelfDraft.trim() || null,
        bin: binDraft.trim() || null,
        location_note: locationNoteDraft.trim() || null,
      });
      await loadDetail(medication.id);
      await onMutated();
      setIsEditingLocation(false);
      setLocationFeedback({
        type: 'success',
        message: 'Dispensary location updated successfully.',
      });
    } catch (err: unknown) {
      setLocationFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update location.',
      });
    } finally {
      setIsSavingLocation(false);
    }
  };

  const handleOpenEditMedicalInfo = () => {
    if (!medication) return;
    setBrandNameDraft(medication.brand_name ?? '');
    setGenericNameDraft(medication.generic_name ?? '');
    setStrengthDraft(medication.strength ?? '');
    setDosageFormDraft(medication.dosage_form ?? '');
    setPosologyDraft(medication.posology ?? '');
    setInteractionsDraft(medication.interactions ?? '');
    setCompositionDraft(medication.composition ?? '');
    setTherapeuticClassDraft(medication.therapeutic_class ?? '');
    setIndicationsDraft(medication.indications ?? '');
    setPrecautionsDraft(medication.precautions ?? '');
    setRouteDraft(medication.route ?? '');
    setSideEffectsDraft(medication.side_effects ?? '');
    setMedicalInfoFeedback(null);
    setScannedNotification(null);
    setIsMedicalInfoOpen(true);
    setIsEditingMedicalInfo(true);
  };

  const handleCancelEditMedicalInfo = () => {
    setIsEditingMedicalInfo(false);
    setMedicalInfoFeedback(null);
    setScannedNotification(null);
  };

  const handleLeafletExtracted = (data: ScannedLeafletData) => {
    if (!medication) return;
    // Populate form fields with extracted data; leave blank if not detected
    setBrandNameDraft(data.brand_name || medication.brand_name || '');
    setGenericNameDraft(data.generic_name || medication.generic_name || '');
    setStrengthDraft(data.strength || medication.strength || '');
    setDosageFormDraft(data.dosage_form || medication.dosage_form || '');
    setPosologyDraft(data.posology || '');
    setInteractionsDraft(data.interactions || '');
    setCompositionDraft(data.composition || '');
    setTherapeuticClassDraft(data.therapeutic_class || '');
    setIndicationsDraft(data.indications || '');
    setPrecautionsDraft(data.precautions || '');
    setRouteDraft(data.route || '');
    setSideEffectsDraft(data.side_effects || '');

    setScannedNotification(
      'Leaflet details extracted with Gemini Vision! Please review each field below and click "Save Medical Information" to confirm.',
    );
    setMedicalInfoFeedback(null);
    setIsMedicalInfoOpen(true);
    setIsEditingMedicalInfo(true);
  };

  const handleSaveMedicalInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medication) return;
    setIsSavingMedicalInfo(true);
    setMedicalInfoFeedback(null);
    try {
      const db = getRepositoryDatabase();
      await updateMedicationMedicalInfo(db, medication.id, {
        posology: posologyDraft.trim() || null,
        interactions: interactionsDraft.trim() || null,
        composition: compositionDraft.trim() || null,
        therapeutic_class: therapeuticClassDraft.trim() || null,
        indications: indicationsDraft.trim() || null,
        precautions: precautionsDraft.trim() || null,
        route: routeDraft.trim() || null,
        side_effects: sideEffectsDraft.trim() || null,
      });

      const nextBrand = brandNameDraft.trim() || medication.brand_name;
      const nextGeneric = genericNameDraft.trim() || null;
      const nextStrength = strengthDraft.trim() || null;
      const nextDosageForm = dosageFormDraft.trim() || null;

      if (
        nextBrand !== medication.brand_name ||
        nextGeneric !== (medication.generic_name ?? null) ||
        nextStrength !== (medication.strength ?? null) ||
        nextDosageForm !== (medication.dosage_form ?? null)
      ) {
        await updateMedicationFromImport(db, medication.id, {
          brand_name: nextBrand,
          generic_name: nextGeneric,
          strength: nextStrength,
          dosage_form: nextDosageForm,
        });
      }

      await loadDetail(medication.id);
      await onMutated();
      setIsEditingMedicalInfo(false);
      setScannedNotification(null);
      setMedicalInfoFeedback({
        type: 'success',
        message: 'Medical information reviewed and saved to local database.',
      });
    } catch (err: unknown) {
      setMedicalInfoFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update medical information.',
      });
    } finally {
      setIsSavingMedicalInfo(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && detail && medication && (
        <motion.div
          key="medication-detail-backdrop"
          initial={SLIDE_OVER_BACKDROP_VARIANTS.initial}
          animate={SLIDE_OVER_BACKDROP_VARIANTS.animate}
          exit={SLIDE_OVER_BACKDROP_VARIANTS.exit}
          transition={SLIDE_OVER_BACKDROP_TRANSITION}
          className="fixed inset-0 z-50 overflow-hidden bg-slate-900/25 dark:bg-slate-950/60 backdrop-blur-[2px] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={`Medication details for ${medication.brand_name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.aside
            key="medication-detail-panel"
            data-testid="search-result-detail-card"
            initial={SLIDE_OVER_PANEL_VARIANTS.initial}
            animate={SLIDE_OVER_PANEL_VARIANTS.animate}
            exit={SLIDE_OVER_PANEL_VARIANTS.exit}
            transition={SLIDE_OVER_PANEL_TRANSITION}
            className="w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
          >
        {/* Top Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4 bg-white dark:bg-slate-900 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-sky-600 dark:text-sky-400">Medication Profile</span>
              {medication.atc_code && (
                <span className="px-2 py-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-md">
                  ATC {medication.atc_code}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white mt-1">
              {medication.brand_name}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {medication.generic_name ?? 'Standard formulation'} · {medication.strength ?? '—'} ·{' '}
              {medication.dosage_form ?? '—'}
            </p>
          </div>

          <button
            type="button"
            data-testid="close-detail-slideover-btn"
            onClick={onClose}
            aria-label="Close medication details"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Physical Location Banner */}
          <div className="p-5 bg-sky-50/70 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                Dispensary Location
              </span>
              <div className="flex items-center gap-2">
                {medication.storage && (
                  <span className="px-2.5 py-0.5 text-xs font-medium bg-white dark:bg-slate-800 text-sky-900 dark:text-sky-200 border border-sky-200 dark:border-sky-800/80 rounded-md">
                    {medication.storage}
                  </span>
                )}
                {!isEditingLocation ? (
                  <button
                    type="button"
                    data-testid="edit-location-btn"
                    onClick={handleOpenEditLocation}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-white dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-slate-700 border border-sky-300 dark:border-sky-700 rounded-lg shadow-2xs transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                    Edit Location
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="cancel-location-btn"
                    onClick={handleCancelEditLocation}
                    className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {!isEditingLocation ? (
              <>
                <div
                  data-testid="detail-card-location"
                  className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-slate-900 dark:text-white"
                >
                  {detail.locationDisplay}
                </div>
                <div data-testid="detail-card-location-note" className="text-xs text-slate-600 dark:text-slate-400">
                  {medication.location_note ? (
                    <>
                      Shelf Note: <strong className="text-slate-800 dark:text-slate-200">{medication.location_note}</strong>
                    </>
                  ) : (
                    'Standard shelf placement'
                  )}
                  {medication.barcode && (
                    <span className="ml-2 font-mono text-slate-500 dark:text-slate-400">· Barcode {medication.barcode}</span>
                  )}
                </div>
              </>
            ) : (
              <form
                data-testid="edit-location-form"
                onSubmit={handleSaveLocation}
                className="space-y-3 pt-1"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label
                      htmlFor="edit-location-zone-input"
                      className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Zone
                    </label>
                    <input
                      id="edit-location-zone-input"
                      data-testid="edit-location-zone-input"
                      type="text"
                      value={zoneDraft}
                      onChange={(e) => setZoneDraft(e.target.value)}
                      placeholder="e.g. Zone A"
                      className="w-full px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 shadow-2xs"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="edit-location-shelf-input"
                      className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Shelf
                    </label>
                    <input
                      id="edit-location-shelf-input"
                      data-testid="edit-location-shelf-input"
                      type="text"
                      value={shelfDraft}
                      onChange={(e) => setShelfDraft(e.target.value)}
                      placeholder="e.g. Shelf 1"
                      className="w-full px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 shadow-2xs"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="edit-location-bin-input"
                      className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Bin
                    </label>
                    <input
                      id="edit-location-bin-input"
                      data-testid="edit-location-bin-input"
                      type="text"
                      value={binDraft}
                      onChange={(e) => setBinDraft(e.target.value)}
                      placeholder="e.g. Bin 3"
                      className="w-full px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 shadow-2xs"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="edit-location-note-input"
                    className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Shelf Note / Placement Details (Optional)
                  </label>
                  <input
                    id="edit-location-note-input"
                    data-testid="edit-location-note-input"
                    type="text"
                    value={locationNoteDraft}
                    onChange={(e) => setLocationNoteDraft(e.target.value)}
                    placeholder="e.g. Top shelf, amber bottle, keep upright"
                    className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 shadow-2xs"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Physical coordinates for pharmacy stock picking.
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="cancel-location-btn-inner"
                      onClick={handleCancelEditLocation}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="save-location-btn"
                      disabled={isSavingLocation}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isSavingLocation ? 'Saving...' : 'Save Location'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {locationFeedback && (
              <div
                data-testid="location-status-message"
                className={`text-xs px-3 py-2 rounded-lg ${
                  locationFeedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                    : 'bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60'
                }`}
              >
                {locationFeedback.message}
              </div>
            )}
          </div>

          {/* Stock & Unit Price Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Available Stock</span>
                {isLowStock ? (
                  <motion.span
                    data-testid="detail-card-low-stock-badge"
                    animate={LOW_STOCK_BADGE_PULSE_ANIMATE}
                    transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
                    className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60"
                  >
                    Low Stock
                  </motion.span>
                ) : (
                  <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                    In Stock
                  </span>
                )}
              </div>
              <div
                data-testid="detail-card-total-stock"
                className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white"
              >
                {detail.totalStock} units
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Reorder threshold: <span className="font-mono">{medication.reorder_level}</span> units
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-2xs">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Unit Price</div>
              <div
                data-testid="detail-card-unit-price"
                className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
                  medication.unit_price_cents === null
                    ? 'text-red-700 dark:text-red-400 text-lg'
                    : medication.price_confirmed === 0
                      ? 'text-slate-400 dark:text-slate-500 line-through'
                      : 'text-slate-900 dark:text-white'
                }`}
              >
                {formatMedicationPriceInDa(
                  medication.unit_price_cents,
                  medication.currency_code || medication.currency || 'DZD',
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {medication.unit_price_cents === null
                  ? 'Not entered yet'
                  : medication.price_confirmed === 1
                    ? 'Verified price'
                    : 'Awaiting pharmacist confirmation'}
              </div>
            </div>
          </div>

          {/* Collapsible Detailed Medical Information Section */}
          <div
            data-testid="detail-medical-info-section"
            className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xs overflow-hidden"
          >
            <div className="px-4 py-3.5 bg-slate-50/80 dark:bg-slate-800/90 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3">
              <button
                type="button"
                data-testid="toggle-medical-info-btn"
                aria-expanded={isMedicalInfoOpen}
                onClick={() => setIsMedicalInfoOpen((prev) => !prev)}
                className="flex items-center gap-2.5 text-left flex-1 focus:outline-none group cursor-pointer"
              >
                <span className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
                  <Stethoscope className="w-4 h-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100 group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                    Medical Information
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Posology, indications, composition, interactions, precautions &amp; side effects
                  </p>
                </div>
                <span className="ml-auto text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200">
                  {isMedicalInfoOpen ? (
                    <ChevronUp className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  )}
                </span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="scan-leaflet-btn"
                  onClick={() => setIsScanLeafletModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/80 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-300 dark:border-sky-700 rounded-lg shadow-2xs transition-colors shrink-0 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Scan Leaflet</span>
                </button>

                {!isEditingMedicalInfo ? (
                  <button
                    type="button"
                    data-testid="edit-medical-info-btn"
                    onClick={handleOpenEditMedicalInfo}
                    className="px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-sky-950/60 border border-sky-200 dark:border-sky-800 rounded-lg transition-colors shrink-0 cursor-pointer"
                  >
                    Edit Medical Info
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="cancel-medical-info-header-btn"
                    onClick={handleCancelEditMedicalInfo}
                    className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors shrink-0 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {medicalInfoFeedback && (
              <div
                role="status"
                data-testid="medical-info-status-message"
                className={`mx-4 mt-3 text-xs px-3 py-2 rounded-lg ${
                  medicalInfoFeedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                    : 'bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60'
                }`}
              >
                {medicalInfoFeedback.message}
              </div>
            )}

            {isMedicalInfoOpen && (
              <div
                data-testid="medical-info-collapsible-content"
                className="p-4 space-y-4 text-xs"
              >
                {!isEditingMedicalInfo ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Therapeutic Class
                        </div>
                        <div
                          data-testid="medical-info-therapeutic-class"
                          className="mt-1 font-semibold text-slate-900 dark:text-slate-100"
                        >
                          {medication.therapeutic_class || 'Not specified'}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Route of Administration
                        </div>
                        <div
                          data-testid="medical-info-route"
                          className="mt-1 font-semibold text-slate-900 dark:text-slate-100"
                        >
                          {medication.route || 'Not specified'}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Indications
                      </div>
                      <div
                        data-testid="medical-info-indications"
                        className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed"
                      >
                        {medication.indications || 'Not specified'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-sky-50/60 dark:bg-sky-950/30 border border-sky-200/70 dark:border-sky-800/60">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                        Posology (Dosage Instructions)
                      </div>
                      <div
                        data-testid="medical-info-posology"
                        className="mt-1 text-slate-900 dark:text-slate-100 leading-relaxed font-medium"
                      >
                        {medication.posology || 'Not specified'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Composition (Active Molecule &amp; Excipients)
                      </div>
                      <div
                        data-testid="medical-info-composition"
                        className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed"
                      >
                        {medication.composition || 'Not specified'}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-800/50">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          Drug Interactions
                        </div>
                        <div
                          data-testid="medical-info-interactions"
                          className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed"
                        >
                          {medication.interactions || 'Not specified'}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-800/50">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          Precautions &amp; Warnings
                        </div>
                        <div
                          data-testid="medical-info-precautions"
                          className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed"
                        >
                          {medication.precautions || 'Not specified'}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Side Effects (Adverse Effects)
                      </div>
                      <div
                        data-testid="medical-info-side-effects"
                        className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed"
                      >
                        {medication.side_effects || 'Not specified'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <form
                    data-testid="edit-medical-info-form"
                    onSubmit={handleSaveMedicalInfo}
                    className="space-y-4"
                  >
                    {/* Scan Leaflet Action Banner inside Form */}
                    <div className="p-3.5 rounded-2xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-xs text-sky-950 dark:text-sky-200 min-w-0">
                        <Sparkles className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                        <div>
                          <span className="font-bold">AI Scan Leaflet:</span>{' '}
                          <span className="text-[11px] text-slate-600 dark:text-slate-400">
                            Auto-fill all medical details from box or leaflet image
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="scan-leaflet-form-banner-btn"
                        onClick={() => setIsScanLeafletModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 rounded-xl shadow-2xs transition-colors shrink-0 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Scan Leaflet</span>
                      </button>
                    </div>

                    {/* Notice when leaflet data was extracted */}
                    {scannedNotification && (
                      <div
                        role="status"
                        data-testid="scanned-leaflet-review-alert"
                        className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start justify-between gap-2"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <strong>Review Extracted Details:</strong> {scannedNotification}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setScannedNotification(null)}
                          className="text-amber-700 dark:text-amber-400 hover:text-amber-900 text-sm font-bold leading-none cursor-pointer"
                          aria-label="Dismiss notification"
                        >
                          &times;
                        </button>
                      </div>
                    )}

                    {/* Basic Identification extracted from leaflet or box */}
                    <div className="p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Medication Identification
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor="edit-medical-brand-name-input"
                            className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Brand Name
                          </label>
                          <input
                            id="edit-medical-brand-name-input"
                            data-testid="edit-medical-brand-name-input"
                            type="text"
                            value={brandNameDraft}
                            onChange={(e) => setBrandNameDraft(e.target.value)}
                            placeholder="e.g. Amoxil"
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="edit-medical-generic-name-input"
                            className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Generic Molecule
                          </label>
                          <input
                            id="edit-medical-generic-name-input"
                            data-testid="edit-medical-generic-name-input"
                            type="text"
                            value={genericNameDraft}
                            onChange={(e) => setGenericNameDraft(e.target.value)}
                            placeholder="e.g. Amoxicillin"
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="edit-medical-strength-input"
                            className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Strength
                          </label>
                          <input
                            id="edit-medical-strength-input"
                            data-testid="edit-medical-strength-input"
                            type="text"
                            value={strengthDraft}
                            onChange={(e) => setStrengthDraft(e.target.value)}
                            placeholder="e.g. 500 mg"
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="edit-medical-dosage-form-input"
                            className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Dosage Form
                          </label>
                          <input
                            id="edit-medical-dosage-form-input"
                            data-testid="edit-medical-dosage-form-input"
                            type="text"
                            value={dosageFormDraft}
                            onChange={(e) => setDosageFormDraft(e.target.value)}
                            placeholder="e.g. Capsule, Tablet, Syrup"
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="edit-medical-therapeutic-class-input"
                          className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Therapeutic Class
                        </label>
                        <input
                          id="edit-medical-therapeutic-class-input"
                          data-testid="edit-medical-therapeutic-class-input"
                          type="text"
                          value={therapeuticClassDraft}
                          onChange={(e) => setTherapeuticClassDraft(e.target.value)}
                          placeholder="e.g. Antibiotic, Antihypertensive"
                          className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="edit-medical-route-input"
                          className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Route
                        </label>
                        <input
                          id="edit-medical-route-input"
                          data-testid="edit-medical-route-input"
                          type="text"
                          value={routeDraft}
                          onChange={(e) => setRouteDraft(e.target.value)}
                          placeholder="e.g. Oral, IV, Topical, Inhalation"
                          className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="edit-medical-indications-input"
                        className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Indications (What it treats)
                      </label>
                      <textarea
                        id="edit-medical-indications-input"
                        data-testid="edit-medical-indications-input"
                        rows={2}
                        value={indicationsDraft}
                        onChange={(e) => setIndicationsDraft(e.target.value)}
                        placeholder="e.g. Acute bacterial sinusitis, community-acquired pneumonia..."
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="edit-medical-posology-input"
                        className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Posology (Dosage Instructions)
                      </label>
                      <textarea
                        id="edit-medical-posology-input"
                        data-testid="edit-medical-posology-input"
                        rows={2}
                        value={posologyDraft}
                        onChange={(e) => setPosologyDraft(e.target.value)}
                        placeholder="e.g. 500 mg every 8 hours for 7 days..."
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="edit-medical-composition-input"
                        className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Composition (Active Molecule + Excipients)
                      </label>
                      <textarea
                        id="edit-medical-composition-input"
                        data-testid="edit-medical-composition-input"
                        rows={2}
                        value={compositionDraft}
                        onChange={(e) => setCompositionDraft(e.target.value)}
                        placeholder="e.g. Active: Amoxicillin 500 mg. Excipients: Magnesium stearate..."
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="edit-medical-interactions-input"
                        className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Interactions (Drug Interactions)
                      </label>
                      <textarea
                        id="edit-medical-interactions-input"
                        data-testid="edit-medical-interactions-input"
                        rows={2}
                        value={interactionsDraft}
                        onChange={(e) => setInteractionsDraft(e.target.value)}
                        placeholder="e.g. Oral anticoagulants, Methotrexate, Allopurinol..."
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="edit-medical-precautions-input"
                        className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Precautions (Warnings)
                      </label>
                      <textarea
                        id="edit-medical-precautions-input"
                        data-testid="edit-medical-precautions-input"
                        rows={2}
                        value={precautionsDraft}
                        onChange={(e) => setPrecautionsDraft(e.target.value)}
                        placeholder="e.g. Contraindicated in penicillin allergy; adjust dose in renal impairment..."
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="edit-medical-side-effects-input"
                        className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Side Effects (Adverse Effects)
                      </label>
                      <textarea
                        id="edit-medical-side-effects-input"
                        data-testid="edit-medical-side-effects-input"
                        rows={2}
                        value={sideEffectsDraft}
                        onChange={(e) => setSideEffectsDraft(e.target.value)}
                        placeholder="e.g. Nausea, diarrhea, skin rash..."
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        data-testid="cancel-medical-info-btn"
                        onClick={handleCancelEditMedicalInfo}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        data-testid="save-medical-info-btn"
                        disabled={isSavingMedicalInfo}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                      >
                        {isSavingMedicalInfo ? 'Saving...' : 'Save Medical Information'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* Active Batches & Expiry Dates */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Batches &amp; Expiry ({detail.batches.length})
              </h3>
              <span className="text-xs text-slate-400 dark:text-slate-500">Sorted by earliest expiry</span>
            </div>

            {detail.batches.length === 0 ? (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-500 dark:text-slate-400">
                No active batches recorded for this medication.
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl overflow-hidden shadow-2xs">
                <table
                  data-testid="detail-card-batches-table"
                  className="w-full text-left text-xs border-collapse"
                >
                  <thead className="bg-slate-50 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3.5 font-medium">Lot Number</th>
                      <th className="py-2.5 px-3.5 text-right font-medium">Quantity</th>
                      <th className="py-2.5 px-3.5 font-medium">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                    {detail.batches.map((b) => {
                      const isFefo = detail.fefoBatchId === b.id;
                      return (
                        <tr
                          key={b.id}
                          data-testid={`detail-card-batch-row-${b.id}`}
                          className={isFefo ? 'bg-emerald-50/40 dark:bg-emerald-950/30' : ''}
                        >
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900 dark:text-white">
                            {b.lot_number ?? '—'}
                            {isFefo && (
                              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-sans font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 rounded">
                                Dispense First
                              </span>
                            )}
                          </td>
                          <td
                            data-testid={`detail-card-batch-qty-${b.id}`}
                            className="py-2.5 px-3.5 text-right font-semibold text-slate-900 dark:text-white"
                          >
                            {b.quantity}
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-300">
                            <div className="flex items-center gap-2">
                              <span>{b.expiry_date ?? 'No expiry'}</span>
                              {b.expiry_date && (
                                <span
                                  data-testid={`batch-expiry-badge-${b.id}`}
                                  className={getExpiryVisualBadge(b.expiry_date).className}
                                >
                                  {getExpiryVisualBadge(b.expiry_date).label}
                                </span>
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
          </motion.aside>
        </motion.div>
      )}

      {medication && (
        <ScanLeafletModal
          isOpen={isScanLeafletModalOpen}
          onClose={() => setIsScanLeafletModalOpen(false)}
          onExtracted={handleLeafletExtracted}
          initialMedicationName={medication.brand_name}
        />
      )}
    </AnimatePresence>
  );
};
