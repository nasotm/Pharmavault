import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  MapPin,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { getRepositoryDatabase } from '../db/repository';
import {
  dispenseStock,
  formatCurrentUserIdentifier,
  loadCurrentUserProfile,
} from '../movements';
import {
  createSampleHandwrittenPrescriptionDataUrl,
  matchExtractedPrescriptionWithCatalog,
  parseExtractedPrescriptionJson,
  SCAN_PRESCRIPTION_PROMPT,
  togglePrescriptionItemConfirmation,
  validateManualConfirmationBeforeAction,
  type ExtractedPrescriptionItem,
  type PrescriptionScanMatchResult,
} from '../prescriptions';
import {
  getMedicationDetailForSearch,
  type SearchMedicationDetail,
} from '../search';

export interface ScanPrescriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMedication: (
    medicationId: number,
    preloadedDetail?: SearchMedicationDetail | null,
  ) => void;
  onDatabaseMutated?: () => Promise<void> | void;
  onAddConfirmedToCart?: (medicationId: number, brandName: string, quantity: number) => void;
}

export const PRESCRIPTION_CART_STORAGE_KEY = 'pharmavault_prescription_cart_v1';

export interface StoredPrescriptionCartItem {
  medicationId: number;
  brandName: string;
  quantity: number;
  addedAt: string;
}

export function appendToStoredPrescriptionCart(
  medicationId: number,
  brandName: string,
  quantity = 1,
): StoredPrescriptionCartItem[] {
  try {
    const raw =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(PRESCRIPTION_CART_STORAGE_KEY)
        : null;
    const existing: StoredPrescriptionCartItem[] = raw ? JSON.parse(raw) : [];
    const found = existing.find((item) => item.medicationId === medicationId);
    let updated: StoredPrescriptionCartItem[];
    if (found) {
      updated = existing.map((item) =>
        item.medicationId === medicationId
          ? { ...item, quantity: item.quantity + quantity, addedAt: new Date().toISOString() }
          : item,
      );
    } else {
      updated = [
        ...existing,
        {
          medicationId,
          brandName,
          quantity,
          addedAt: new Date().toISOString(),
        },
      ];
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PRESCRIPTION_CART_STORAGE_KEY, JSON.stringify(updated));
    }
    return updated;
  } catch {
    return [];
  }
}

/**
 * Rasterizes an image URL or Data URL (including SVG) onto a canvas and exports
 * a clean PNG base64 string for Gemini Vision.
 */
async function rasterizeImageToPngDataUrl(srcUrl: string): Promise<{
  dataUrl: string;
  mimeType: string;
}> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const maxDim = 1280;
        let width = img.naturalWidth || 680;
        let height = img.naturalHeight || 460;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const pngUrl = canvas.toDataURL('image/png');
          resolve({ dataUrl: pngUrl, mimeType: 'image/png' });
          return;
        }
      } catch {
        // Fallback to original dataUrl if canvas fails
      }
      resolve({ dataUrl: srcUrl, mimeType: 'image/png' });
    };
    img.onerror = () => {
      resolve({ dataUrl: srcUrl, mimeType: 'image/png' });
    };
    img.src = srcUrl;
  });
}

export const ScanPrescriptionModal: React.FC<ScanPrescriptionModalProps> = ({
  isOpen,
  onClose,
  onSelectMedication,
  onDatabaseMutated,
  onAddConfirmedToCart,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [imageLabel, setImageLabel] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [matchedItems, setMatchedItems] = useState<PrescriptionScanMatchResult[]>([]);
  const [hasCompletedScan, setHasCompletedScan] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [processingItemId, setProcessingItemId] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset feedback when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setScanError(null);
    setActionFeedback(null);
  }, [isOpen]);

  const analyzePrescriptionImage = useCallback(
    async (rawDataUrl: string, label: string) => {
      setPreviewImageUrl(rawDataUrl);
      setImageLabel(label);
      setIsScanning(true);
      setScanError(null);
      setActionFeedback(null);
      setHasCompletedScan(false);

      try {
        const { dataUrl, mimeType } = await rasterizeImageToPngDataUrl(rawDataUrl);

        const response = await fetch('/api/prescriptions/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageBase64: dataUrl,
            mimeType,
          }),
        });

        if (!response.ok) {
          const errPayload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errPayload.error || `Prescription scan failed (${response.status})`);
        }

        const payload = (await response.json()) as {
          prompt?: string;
          source?: string;
          medications?: ExtractedPrescriptionItem[];
        };

        const extractedList = parseExtractedPrescriptionJson(payload.medications ?? []);
        const db = getRepositoryDatabase();
        const catalogMatches = await matchExtractedPrescriptionWithCatalog(db, extractedList);

        setMatchedItems(catalogMatches);
        setHasCompletedScan(true);
      } catch (err: unknown) {
        setScanError(
          err instanceof Error ? err.message : 'Unable to analyze prescription image.',
        );
      } finally {
        setIsScanning(false);
      }
    },
    [],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void analyzePrescriptionImage(reader.result, file.name);
      }
    };
    reader.onerror = () => {
      setScanError('Failed to read the selected image file.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLoadSamplePrescription = () => {
    const sampleUrl = createSampleHandwrittenPrescriptionDataUrl();
    void analyzePrescriptionImage(sampleUrl, 'Sample Handwritten Rx (Dr. Moreau)');
  };

  const handleToggleItemConfirm = (itemId: string) => {
    setActionFeedback(null);
    setMatchedItems((prev) => togglePrescriptionItemConfirmation(prev, itemId));
  };

  const handleAddConfirmedItemToCart = (item: PrescriptionScanMatchResult) => {
    const check = validateManualConfirmationBeforeAction(item, 'cart');
    if (!check.allowed || !item.matchedMedication) {
      setActionFeedback({
        type: 'error',
        message: check.error ?? 'Please manually confirm this item first.',
      });
      return;
    }

    const med = item.matchedMedication;
    appendToStoredPrescriptionCart(med.id, med.brand_name, 1);
    onAddConfirmedToCart?.(med.id, med.brand_name, 1);

    setMatchedItems((prev) =>
      prev.map((row) =>
        row.id === item.id ? { ...row, addedToCartCount: row.addedToCartCount + 1 } : row,
      ),
    );

    setActionFeedback({
      type: 'success',
      message: `Confirmed & added 1 pack of ${med.brand_name} (${item.extractedDosage}) to the prescription cart.`,
    });
  };

  const handleDispenseConfirmedItem = async (item: PrescriptionScanMatchResult) => {
    const check = validateManualConfirmationBeforeAction(item, 'dispense');
    if (!check.allowed || !item.matchedMedication) {
      setActionFeedback({
        type: 'error',
        message: check.error ?? 'Please manually confirm this item before dispensing.',
      });
      return;
    }

    const med = item.matchedMedication;
    setProcessingItemId(item.id);
    setActionFeedback(null);

    try {
      const db = getRepositoryDatabase();
      const userProfile = loadCurrentUserProfile();
      const userId = formatCurrentUserIdentifier(userProfile);

      const movementResult = await dispenseStock(db, {
        medicationId: med.id,
        quantity: 1,
        reason: 'dispense',
        userId,
      });

      setMatchedItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                totalStock: movementResult.totalStock,
                inStock: movementResult.totalStock > 0,
                dispensedCount: row.dispensedCount + 1,
              }
            : row,
        ),
      );

      await onDatabaseMutated?.();

      setActionFeedback({
        type: 'success',
        message: `Dispensed 1 pack of ${med.brand_name} from ${item.locationDisplay}. Remaining stock: ${movementResult.totalStock} units.`,
      });
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to dispense medication.',
      });
    } finally {
      setProcessingItemId(null);
    }
  };

  const handleInspectMedication = async (item: PrescriptionScanMatchResult) => {
    if (!item.matchedMedication) return;
    try {
      const db = getRepositoryDatabase();
      const detail = await getMedicationDetailForSearch(db, item.matchedMedication.id);
      onClose();
      onSelectMedication(item.matchedMedication.id, detail);
    } catch {
      onClose();
      onSelectMedication(item.matchedMedication.id);
    }
  };

  if (!isOpen) return null;

  const confirmedCount = matchedItems.filter((i) => i.isManuallyConfirmed).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/65 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-prescription-modal-title"
      data-testid="scan-prescription-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 flex items-center justify-center border border-sky-200/70 dark:border-sky-800/70 shrink-0">
              <Sparkles className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="scan-prescription-modal-title"
                  className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white"
                >
                  Scan Prescription with AI Vision
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300 rounded-md shrink-0">
                  Gemini Vision
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate sm:whitespace-normal">
                Upload or photograph a handwritten prescription to extract medications, check stock,
                and locate bins
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-scan-prescription-modal-btn"
            onClick={onClose}
            aria-label="Close prescription scanner"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Hidden File & Camera Inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            data-testid="prescription-file-input"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Upload prescription image"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="prescription-camera-input"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Take photo of prescription"
          />

          {/* Upload / Capture Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              data-testid="upload-prescription-photo-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isScanning}
              className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-semibold text-xs sm:text-sm shadow-sm shadow-sky-600/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>Upload Rx Photo</span>
            </button>

            <button
              type="button"
              data-testid="capture-prescription-camera-btn"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isScanning}
              className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl bg-slate-800 dark:bg-slate-800 hover:bg-slate-900 dark:hover:bg-slate-700 text-white font-semibold text-xs sm:text-sm border border-slate-700 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Take Photo</span>
            </button>

            <button
              type="button"
              data-testid="load-sample-prescription-btn"
              onClick={handleLoadSamplePrescription}
              disabled={isScanning}
              className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl bg-sky-50 dark:bg-slate-800/90 hover:bg-sky-100/80 dark:hover:bg-slate-700 text-sky-800 dark:text-sky-300 font-semibold text-xs sm:text-sm border border-sky-200 dark:border-slate-700 transition-all disabled:opacity-50 cursor-pointer"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Scan Sample Handwritten Rx</span>
            </button>
          </div>

          {/* Prompt Transparency Strip */}
          <div className="px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              AI Vision Prompt:
            </span>
            <code
              data-testid="prescription-vision-prompt-text"
              className="font-mono text-[11px] text-sky-700 dark:text-sky-300 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200/70 dark:border-slate-700"
            >
              {SCAN_PRESCRIPTION_PROMPT}
            </code>
          </div>

          {/* Image Preview + Scanning State */}
          {previewImageUrl && (
            <div className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold truncate">
                  Prescription Image: <strong className="text-slate-900 dark:text-white">{imageLabel}</strong>
                </span>
                {isScanning && (
                  <span
                    data-testid="prescription-scanning-indicator"
                    className="inline-flex items-center gap-2 text-sky-700 dark:text-sky-300 font-semibold"
                  >
                    <span className="w-3.5 h-3.5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                    Extracting medications with Gemini Vision...
                  </span>
                )}
              </div>

              <div className="max-h-48 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white flex items-center justify-center">
                <img
                  src={previewImageUrl}
                  alt="Uploaded handwritten prescription"
                  data-testid="prescription-image-preview"
                  className="max-h-44 w-auto object-contain"
                />
              </div>
            </div>
          )}

          {/* Error Banner */}
          {scanError && (
            <div
              role="alert"
              data-testid="prescription-scan-error"
              className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800/80 text-xs text-red-800 dark:text-red-200 flex items-center gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          {/* Action Feedback Banner */}
          {actionFeedback && (
            <div
              role="status"
              data-testid="prescription-action-feedback"
              className={`p-3.5 rounded-2xl border text-xs font-medium flex items-center gap-2.5 ${
                actionFeedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200'
                  : 'bg-amber-50 dark:bg-amber-950/70 border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionFeedback.message}</span>
            </div>
          )}

          {/* Extracted Medications + Automatic Catalog Search Results */}
          {hasCompletedScan && (
            <div className="space-y-4" data-testid="prescription-extracted-results-section">
              {/* Mandatory Manual Confirmation Gate Notice */}
              <div
                data-testid="manual-confirmation-gate-banner"
                className="p-4 rounded-2xl bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200/90 dark:border-amber-800/70 flex items-start gap-3"
              >
                <ShieldCheck className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-amber-950 dark:text-amber-200">
                    Manual Pharmacist Confirmation Required ({confirmedCount} of {matchedItems.length}{' '}
                    confirmed)
                  </div>
                  <p className="text-amber-800 dark:text-amber-300/90 leading-relaxed">
                    Nothing is added to the cart or dispensed automatically. Verify each extracted
                    medication and check <strong>&ldquo;Confirm Item&rdquo;</strong> below to unlock
                    cart and dispensing actions.
                  </p>
                </div>
              </div>

              {matchedItems.length === 0 ? (
                <div
                  data-testid="prescription-empty-extraction"
                  className="p-6 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300"
                >
                  No medications were detected in this image. Please try a clearer photo.
                </div>
              ) : (
                <div
                  role="list"
                  aria-label="Extracted Prescription Medications"
                  data-testid="prescription-extracted-list"
                  className="space-y-3"
                >
                  {matchedItems.map((item, idx) => {
                    const med = item.matchedMedication;
                    const isLowStock = med ? item.totalStock <= med.reorder_level : false;

                    return (
                      <div
                        key={item.id}
                        role="listitem"
                        data-testid={`prescription-extracted-item-${idx}`}
                        className={`p-4 rounded-2xl border transition-all space-y-3 ${
                          item.isManuallyConfirmed
                            ? 'bg-sky-50/50 dark:bg-sky-950/30 border-sky-400 dark:border-sky-600 shadow-xs'
                            : 'bg-white dark:bg-slate-800/80 border-slate-200/90 dark:border-slate-700/80'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          {/* Extracted Medication Name & Dosage */}
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono text-[11px] font-bold">
                                Rx #{idx + 1}
                              </span>
                              <span
                                data-testid={`prescription-item-name-${idx}`}
                                className="text-base font-extrabold text-slate-900 dark:text-white"
                              >
                                {item.extractedName}
                              </span>
                              <span
                                data-testid={`prescription-item-dosage-${idx}`}
                                className="px-2.5 py-0.5 rounded-lg bg-sky-100/80 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 font-mono text-xs font-semibold"
                              >
                                {item.extractedDosage}
                              </span>
                            </div>

                            {med ? (
                              <div className="text-xs text-slate-600 dark:text-slate-300">
                                Matched Catalog:{' '}
                                <strong className="text-slate-900 dark:text-white">
                                  {med.brand_name}
                                </strong>{' '}
                                ({med.generic_name ?? 'Standard'} · {med.strength ?? '—'} ·{' '}
                                {med.dosage_form ?? '—'}) ·{' '}
                                <span className="font-mono font-semibold">{item.unitPriceDisplay}</span>
                              </div>
                            ) : (
                              <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                                No matching medication found in dispensary catalog
                              </div>
                            )}
                          </div>

                          {/* Stock Status + Exact Location */}
                          <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-1.5 shrink-0">
                            {med ? (
                              item.inStock ? (
                                <span
                                  data-testid={`prescription-item-stock-${idx}`}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${
                                    isLowStock
                                      ? 'bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60'
                                      : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                                  }`}
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      isLowStock ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
                                    }`}
                                  />
                                  <span>
                                    In Stock: {item.totalStock} units
                                    {isLowStock ? ' (Low)' : ''}
                                  </span>
                                </span>
                              ) : (
                                <span
                                  data-testid={`prescription-item-stock-${idx}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60"
                                >
                                  Out of Stock (0 units)
                                </span>
                              )
                            ) : (
                              <span
                                data-testid={`prescription-item-stock-${idx}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                              >
                                Not in Catalog
                              </span>
                            )}

                            {/* Exact Shelf Location */}
                            <div
                              data-testid={`prescription-item-location-${idx}`}
                              className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-100/90 dark:bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-700"
                            >
                              <MapPin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                              <span>{item.locationDisplay}</span>
                            </div>
                          </div>
                        </div>

                        {/* Manual Confirmation & Action Bar */}
                        {med && (
                          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <label
                              className="inline-flex items-center gap-2.5 cursor-pointer select-none text-xs font-semibold text-slate-800 dark:text-slate-200"
                              data-testid={`confirm-prescription-label-${idx}`}
                            >
                              <input
                                type="checkbox"
                                data-testid={`confirm-prescription-checkbox-${idx}`}
                                checked={item.isManuallyConfirmed}
                                onChange={() => handleToggleItemConfirm(item.id)}
                                className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                              />
                              <span>
                                Confirm Item ({med.brand_name} · {item.extractedDosage})
                              </span>
                            </label>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                data-testid={`prescription-add-to-cart-btn-${idx}`}
                                disabled={!item.isManuallyConfirmed}
                                onClick={() => handleAddConfirmedItemToCart(item)}
                                title={
                                  item.isManuallyConfirmed
                                    ? 'Add 1 pack to Prescription Cart'
                                    : 'Check "Confirm Item" first to enable adding to cart'
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                <span>
                                  {item.addedToCartCount > 0
                                    ? `Added to Cart (${item.addedToCartCount})`
                                    : 'Add to Cart'}
                                </span>
                              </button>

                              <button
                                type="button"
                                data-testid={`prescription-dispense-btn-${idx}`}
                                disabled={
                                  !item.isManuallyConfirmed ||
                                  !item.inStock ||
                                  processingItemId === item.id
                                }
                                onClick={() => void handleDispenseConfirmedItem(item)}
                                title={
                                  item.isManuallyConfirmed
                                    ? 'Dispense 1 pack from FEFO batch'
                                    : 'Check "Confirm Item" first to enable dispensing'
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                              >
                                <PackageCheck className="w-3.5 h-3.5" />
                                <span>
                                  {item.dispensedCount > 0
                                    ? `Dispensed (${item.dispensedCount})`
                                    : 'Dispense 1 Pack'}
                                </span>
                              </button>

                              <button
                                type="button"
                                data-testid={`prescription-inspect-btn-${idx}`}
                                onClick={() => void handleInspectMedication(item)}
                                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                              >
                                View Shelf &amp; Batches
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Initial Empty Guide when no image selected yet */}
          {!previewImageUrl && !isScanning && (
            <div
              data-testid="prescription-initial-empty-state"
              className="p-8 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center space-y-2 bg-slate-50/50 dark:bg-slate-800/30"
            >
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Ready to Scan Handwritten Prescription
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                Upload a photo of a handwritten prescription, capture one with your device camera, or
                click <strong>&ldquo;Scan Sample Handwritten Rx&rdquo;</strong> above to extract
                medications and verify dispensary stock and bin coordinates.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0">
          <span>
            Zero automatic stock changes — pharmacist confirmation required for every item
          </span>
          <button
            type="button"
            data-testid="done-scan-prescription-modal-btn"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
