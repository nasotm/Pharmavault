import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  scanMedicationLeaflet,
  type ScannedLeafletData,
} from '../services/scanLeafletService';

export interface ScanLeafletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtracted: (data: ScannedLeafletData) => void;
  initialMedicationName?: string;
}

/**
 * Generates a clean synthetic medication box / leaflet canvas data URL for demo testing.
 */
function createSampleLeafletDataUrl(brand = 'Amoxil', dosage = '500 mg'): string {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Border & header bar
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 8;
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(16, 16, canvas.width - 32, 70);

  // Header text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('NOTICE / MEDICATION LEAFLET', 40, 60);

  // Brand Name & Strength
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`${brand.toUpperCase()} ${dosage}`, 40, 140);

  // Generic molecule
  ctx.fillStyle = '#475569';
  ctx.font = 'italic 22px sans-serif';
  ctx.fillText('Amoxicillin (as trihydrate) · Oral Capsule', 40, 180);

  // Divider
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, 205);
  ctx.lineTo(760, 205);
  ctx.stroke();

  // Clinical text sections
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('COMPOSITION:', 40, 240);
  ctx.font = '16px sans-serif';
  ctx.fillText('Active: Amoxicillin trihydrate equivalent to 500 mg amoxicillin.', 40, 265);
  ctx.fillText('Excipients: Magnesium stearate, microcrystalline cellulose, gelatin, titanium dioxide.', 40, 290);

  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('INDICATIONS:', 40, 330);
  ctx.font = '16px sans-serif';
  ctx.fillText('Treatment of acute bacterial infections: sinusitis, otitis media, community-acquired pneumonia.', 40, 355);

  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('POSOLOGY & METHOD OF ADMINISTRATION:', 40, 395);
  ctx.font = '16px sans-serif';
  ctx.fillText('Adults: 500 mg to 1000 mg every 8 hours. Oral route. Swallow whole with water.', 40, 420);

  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('PRECAUTIONS & CONTRAINDICATIONS:', 40, 460);
  ctx.font = '16px sans-serif';
  ctx.fillText('Contraindicated in patients with known hypersensitivity to beta-lactam antibiotics (penicillins).', 40, 485);

  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('SIDE EFFECTS:', 40, 525);
  ctx.font = '16px sans-serif';
  ctx.fillText('Common: Diarrhea, nausea, skin rash, pruritus. Discontinue if allergic reaction occurs.', 40, 550);

  return canvas.toDataURL('image/png');
}

export const ScanLeafletModal: React.FC<ScanLeafletModalProps> = ({
  isOpen,
  onClose,
  onExtracted,
  initialMedicationName = 'Medication',
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'camera'>('upload');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extractedResult, setExtractedResult] = useState<ScannedLeafletData | null>(null);

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCameraStream = useCallback(async () => {
    stopCameraStream();
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera streaming is not supported on this device/browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Unable to access camera. Please allow camera permissions or upload an image file.',
      );
    }
  }, [stopCameraStream]);

  // Clean up on open/close
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setExtractedResult(null);
      setIsProcessing(false);
      setPreviewImage(null);
      setActiveTab('upload');
    } else {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [isOpen, stopCameraStream]);

  // Handle switching tabs
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'camera') {
      void startCameraStream();
    } else {
      stopCameraStream();
    }
  }, [activeTab, isOpen, startCameraStream, stopCameraStream]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (PNG, JPEG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setPreviewImage(result);
        setErrorMessage(null);
        setExtractedResult(null);
      }
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read the selected file.');
    };
    reader.readAsDataURL(file);
  };

  const handleCaptureFromCamera = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setPreviewImage(dataUrl);
    setErrorMessage(null);
    setExtractedResult(null);
    stopCameraStream();
  };

  const handleUseSampleLeaflet = () => {
    const sample = createSampleLeafletDataUrl(initialMedicationName || 'Amoxil', '500 mg');
    setPreviewImage(sample);
    setErrorMessage(null);
    setExtractedResult(null);
    stopCameraStream();
  };

  const handleAnalyzeLeaflet = async () => {
    if (!previewImage) {
      setErrorMessage('Please capture or upload an image of the medication leaflet first.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setExtractedResult(null);

    try {
      const match = previewImage.match(/^data:([^;,]+);base64,(.+)$/);
      const mimeType = match ? match[1] : 'image/png';
      const base64 = match ? match[2] : previewImage;

      const scanRes = await scanMedicationLeaflet(base64, mimeType);

      if (!scanRes.success && scanRes.error) {
        setErrorMessage(scanRes.error);
        setIsProcessing(false);
        return;
      }

      setExtractedResult(scanRes.data);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An error occurred while analyzing the leaflet.',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAndApply = () => {
    if (!extractedResult) return;
    onExtracted(extractedResult);
    onClose();
  };

  const filledCount = extractedResult
    ? Object.values(extractedResult).filter((v) => Boolean(v && v.trim())).length
    : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-leaflet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 my-8 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-sky-950/80 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-100 dark:border-sky-800">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="scan-leaflet-modal-title"
                className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"
              >
                AI Scan Medication Leaflet
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                  Gemini Vision
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extract posology, composition, indications, warnings &amp; medical details automatically
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational banner: Pharmacist review required */}
        <div className="mx-6 mt-4 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong>Manual Review Required:</strong> Extracted data will pre-fill the form fields for your inspection.
            It will <strong>NOT</strong> be saved automatically until you review and confirm.
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 text-xs text-red-700 dark:text-red-300 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Mode Switcher */}
          {!previewImage && !extractedResult && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div
                role="tablist"
                aria-label="Leaflet Input Mode"
                className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'upload'}
                  onClick={() => setActiveTab('upload')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'upload'
                      ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Photo</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'camera'}
                  onClick={() => setActiveTab('camera')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'camera'
                      ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Use Camera</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleUseSampleLeaflet}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-sky-600" />
                <span>Use Sample Leaflet</span>
              </button>
            </div>
          )}

          {/* Area 1: Camera Stream */}
          {!previewImage && activeTab === 'camera' && (
            <div className="space-y-3">
              {cameraError ? (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-900 dark:text-amber-200 text-xs space-y-2">
                  <p>{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('upload')}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold text-xs"
                  >
                    Switch to File Upload
                  </button>
                </div>
              ) : (
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border border-slate-700">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-4 flex justify-center">
                    <button
                      type="button"
                      data-testid="capture-leaflet-camera-btn"
                      onClick={handleCaptureFromCamera}
                      className="px-5 py-2.5 rounded-2xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-600/30 flex items-center gap-2 cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Take Photo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Area 2: File Upload Box */}
          {!previewImage && activeTab === 'upload' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl p-8 text-center hover:border-sky-500 hover:bg-sky-50/40 dark:hover:bg-sky-950/20 transition-all cursor-pointer space-y-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="leaflet-file-input"
                onChange={handleFileUpload}
              />
              <div className="w-12 h-12 rounded-2xl bg-sky-50 dark:bg-sky-950/80 text-sky-600 dark:text-sky-400 mx-auto flex items-center justify-center border border-sky-100 dark:border-sky-800">
                <Upload className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Click to choose a leaflet or packaging photo
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  PNG, JPG, or WebP up to 15MB
                </p>
              </div>
            </div>
          )}

          {/* Area 3: Preview & Analyze Button */}
          {previewImage && !extractedResult && (
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-800 max-h-64 flex items-center justify-center">
                <img
                  src={previewImage}
                  alt="Medication Leaflet Preview"
                  className="max-h-64 w-auto object-contain"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPreviewImage(null);
                    setExtractedResult(null);
                    if (activeTab === 'camera') void startCameraStream();
                  }}
                  className="absolute top-3 right-3 p-2 rounded-xl bg-slate-950/70 text-white hover:bg-slate-950 transition-colors cursor-pointer"
                  title="Choose another image"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewImage(null);
                    setExtractedResult(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Discard Image
                </button>

                <button
                  type="button"
                  data-testid="process-leaflet-btn"
                  disabled={isProcessing}
                  onClick={handleAnalyzeLeaflet}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 shadow-md shadow-sky-600/20 flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-all"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Extracting with Gemini Vision...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Extract Information</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Area 4: Extracted Results Review before Populating */}
          {extractedResult && (
            <div className="space-y-4" data-testid="leaflet-extracted-summary">
              <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200 space-y-1">
                <div className="flex items-center gap-2 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Leaflet Extracted Successfully ({filledCount} of 12 fields detected)</span>
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                  Review the extracted fields below. Clicking &ldquo;Review &amp; Populate Form&rdquo; will pre-fill the edit form. You must verify all values and click &ldquo;Save&rdquo; to confirm.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Brand Name:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white">
                    {extractedResult.brand_name || <em className="text-slate-400">Not detected</em>}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Generic Name:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white">
                    {extractedResult.generic_name || <em className="text-slate-400">Not detected</em>}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Strength:</span>{' '}
                  <span className="text-slate-900 dark:text-white">
                    {extractedResult.strength || <em className="text-slate-400">Not detected</em>}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Dosage Form:</span>{' '}
                  <span className="text-slate-900 dark:text-white">
                    {extractedResult.dosage_form || <em className="text-slate-400">Not detected</em>}
                  </span>
                </div>

                <div className="sm:col-span-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Posology:</span>{' '}
                  <span className="text-slate-900 dark:text-white">
                    {extractedResult.posology || <em className="text-slate-400">Not detected</em>}
                  </span>
                </div>

                <div className="sm:col-span-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Composition:</span>{' '}
                  <span className="text-slate-900 dark:text-white">
                    {extractedResult.composition || <em className="text-slate-400">Not detected</em>}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setExtractedResult(null);
                    setPreviewImage(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Scan Another Leaflet
                </button>

                <button
                  type="button"
                  data-testid="apply-leaflet-btn"
                  onClick={handleConfirmAndApply}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Review &amp; Populate Form</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
