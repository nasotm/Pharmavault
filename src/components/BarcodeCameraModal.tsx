import React, { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';

export interface BarcodeCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}

export const BarcodeCameraModal: React.FC<BarcodeCameraModalProps> = ({
  isOpen,
  onClose,
  onDetected,
}) => {
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isStoppingRef = useRef<boolean>(false);

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

  // Handle detection from camera
  const handleScanSuccess = async (decodedText: string) => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current?.clear();
    } catch {
      // Ignore stop errors on unmount
    }
    onDetected(decodedText);
  };

  // Initialize camera scanner when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    isStoppingRef.current = false;
    setIsInitializing(true);
    setErrorMessage(null);
    setManualInput('');

    const scannerElementId = 'camera-barcode-viewport';

    const startCamera = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (!isMounted) return;

        const html5QrCode = new Html5Qrcode(scannerElementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        });

        scannerRef.current = html5QrCode;

        const scanConfig = {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const width = Math.min(Math.floor(viewfinderWidth * 0.85), 320);
            const height = Math.min(Math.floor(viewfinderHeight * 0.45), 180);
            return { width, height };
          },
          aspectRatio: 1.333334,
        };

        await html5QrCode.start(
          { facingMode: 'environment' },
          scanConfig,
          (decodedText: string) => {
            if (isMounted) {
              void handleScanSuccess(decodedText);
            }
          },
          () => {
            // Ignore frame scan failures while scanning
          },
        );

        if (isMounted) {
          setIsInitializing(false);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setIsInitializing(false);
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (
          rawMsg.toLowerCase().includes('permission') ||
          rawMsg.toLowerCase().includes('notallowed') ||
          rawMsg.toLowerCase().includes('denied')
        ) {
          setErrorMessage(
            'Camera permission was denied. Please allow camera access in your browser address bar settings to scan barcodes directly.',
          );
        } else if (
          rawMsg.toLowerCase().includes('notfound') ||
          rawMsg.toLowerCase().includes('device')
        ) {
          setErrorMessage(
            'No camera device was detected on your system. You can test barcode detection by typing or pasting the barcode number below.',
          );
        } else {
          setErrorMessage(
            `Unable to access camera: ${rawMsg}. Please ensure camera access is enabled in your browser.`,
          );
        }
      }
    };

    const timer = setTimeout(() => {
      void startCamera();
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            void scannerRef.current.stop().then(() => {
              scannerRef.current?.clear();
            });
          } else {
            scannerRef.current.clear();
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (trimmed) {
      onDetected(trimmed);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-scanner-modal-title"
      data-testid="camera-scanner-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-4 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center border border-sky-100">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div>
              <h2
                id="camera-scanner-modal-title"
                className="text-lg font-bold tracking-tight text-slate-900"
              >
                Scan Medication Barcode
              </h2>
              <p className="text-xs text-slate-500">
                Hold product barcode inside the camera targeting box
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-camera-modal-btn"
            onClick={onClose}
            aria-label="Close camera scanner"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Modal Body / Camera Viewport */}
        <div className="p-6 space-y-4">
          {/* Camera Container */}
          <div className="relative w-full aspect-4/3 bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-inner">
            <div
              id="camera-barcode-viewport"
              data-testid="camera-barcode-viewport"
              className="w-full h-full overflow-hidden"
            />

            {/* Scanning Guide Reticle */}
            {!errorMessage && (
              <div
                className="pointer-events-none absolute inset-x-8 inset-y-12 border-2 border-dashed border-sky-400/80 rounded-xl flex flex-col items-center justify-center bg-sky-500/5 shadow-2xs"
                aria-hidden="true"
              >
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-sky-400 to-transparent animate-pulse" />
                <span className="mt-auto mb-2 px-2.5 py-0.5 text-[10px] font-semibold text-sky-200 bg-slate-900/80 rounded-md backdrop-blur-xs">
                  Align Barcode Here
                </span>
              </div>
            )}

            {/* Initializing Spinner */}
            {isInitializing && !errorMessage && (
              <div
                data-testid="camera-initializing-state"
                className="absolute inset-0 bg-slate-900/80 backdrop-blur-xs flex flex-col items-center justify-center gap-3 text-white"
              >
                <div className="w-8 h-8 border-3 border-sky-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-medium text-slate-300">Activating camera...</span>
              </div>
            )}

            {/* Error Message if Camera Blocked or Unavailable */}
            {errorMessage && (
              <div
                data-testid="camera-error-state"
                className="absolute inset-0 bg-slate-900/95 p-6 flex flex-col items-center justify-center text-center space-y-3 text-white"
              >
                <div className="w-10 h-10 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white">Camera Access Notice</h3>
                  <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed">
                    {errorMessage}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Formats Badge Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Supported: EAN-13, EAN-8, UPC-A, UPC-E, Code 128
            </span>
            <span className="font-mono text-slate-400">Autofocus enabled</span>
          </div>

          {/* Manual Input Fallback */}
          <form
            onSubmit={handleManualSubmit}
            className="pt-2 border-t border-slate-100 flex items-center gap-2"
          >
            <div className="relative flex-1">
              <label htmlFor="manual-barcode-input" className="sr-only">
                Enter Barcode Digits
              </label>
              <input
                id="manual-barcode-input"
                data-testid="manual-barcode-input"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Or type/paste barcode digits (e.g. 0300296008214)..."
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 font-mono"
              />
            </div>
            <button
              type="submit"
              data-testid="submit-manual-barcode-btn"
              disabled={!manualInput.trim()}
              className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 disabled:opacity-40 rounded-xl transition-colors shrink-0"
            >
              Search Barcode
            </button>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Camera stream stops automatically once detected</span>
          <button
            type="button"
            data-testid="cancel-camera-modal-btn"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
