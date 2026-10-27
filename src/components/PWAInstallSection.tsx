import React, { useState } from 'react';
import { CheckCircle2, Download, Smartphone, Wifi, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallSection: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isOnline, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);

  const handleInstallClick = async () => {
    setInstallFeedback(null);
    if (isInstallable) {
      const outcome = await install();
      if (outcome === 'accepted') {
        setInstallFeedback('PharmaVault installation accepted.');
      } else if (outcome === 'dismissed') {
        setInstallFeedback('Installation prompt dismissed. You can install anytime.');
      }
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <div
      data-testid="pwa-install-card"
      className="p-5 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-4 flex flex-col justify-between"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Progressive Web App (Offline &amp; Install)
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                isOnline
                  ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                  : 'bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3 h-3" />
                  Offline Ready
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  Offline Mode
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Install PharmaVault on your Android phone, iPad, or desktop computer to launch in
            standalone full-screen mode and access local SQLite inventory offline.
          </p>
        </div>
      </div>

      {installFeedback && (
        <div
          role="status"
          className="p-2.5 bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800 rounded-lg text-xs font-medium text-sky-900 dark:text-sky-200"
        >
          {installFeedback}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Smartphone className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <span>
            {isInstalled
              ? 'Running in standalone installed app mode'
              : isInstallable
                ? 'Native browser install prompt ready'
                : 'Supports Android, iPadOS/iOS, macOS & Windows'}
          </span>
        </div>

        {isInstalled ? (
          <span
            data-testid="pwa-installed-badge"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 rounded-lg"
          >
            <CheckCircle2 className="w-4 h-4" />
            App Installed
          </span>
        ) : (
          <button
            type="button"
            data-testid="pwa-install-btn"
            onClick={() => void handleInstallClick()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Install App
          </button>
        )}
      </div>

      {showGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  +
                </div>
                <div>
                  <h3
                    id="pwa-install-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-white"
                  >
                    Install PharmaVault App
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Standalone offline-capable dispensary app
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Close install instructions"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 p-4 rounded-xl border border-slate-200/70 dark:border-slate-700">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Install on iPad or iPhone (Safari):
                </p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Tap the <strong>Share</strong> button in the Safari toolbar.
                  </li>
                  <li>
                    Scroll down and select <strong>Add to Home Screen</strong>.
                  </li>
                  <li>
                    Tap <strong>Add</strong> to launch PharmaVault in full-screen standalone mode.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
                <div className="bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200/70 dark:border-slate-700 space-y-1.5">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Android / Desktop (Chrome or Edge):
                  </p>
                  <p>
                    Open PharmaVault in a top-level browser tab and click the{' '}
                    <strong>Install PharmaVault</strong> icon in the address bar, or open the
                    browser menu (⋮) and select <strong>Install app</strong> /{' '}
                    <strong>Add to Home screen</strong>.
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200/70 dark:border-slate-700 space-y-1.5">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    iPad / iPhone (Safari):
                  </p>
                  <p>
                    Tap the <strong>Share</strong> button in Safari and choose{' '}
                    <strong>Add to Home Screen</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                data-testid="close-pwa-guide-btn"
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
