import React, { useState } from 'react';
import {
  Camera,
  Mic,
  RotateCw,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useDevicePermissions } from '../hooks/useDevicePermissions';
import { formatPermissionStateBadge, getPermissionBlockedGuide } from '../utils/permissions';

export const PermissionSettingsSection: React.FC = () => {
  const {
    cameraStatus,
    microphoneStatus,
    isChecking,
    actionFeedback,
    requestCamera,
    requestMicrophone,
    refresh,
    clearFeedback,
  } = useDevicePermissions();

  const [expandedGuide, setExpandedGuide] = useState<'camera' | 'microphone' | null>(null);

  const cameraBadge = formatPermissionStateBadge(cameraStatus);
  const microphoneBadge = formatPermissionStateBadge(microphoneStatus);

  const toggleGuide = (type: 'camera' | 'microphone') => {
    setExpandedGuide((prev) => (prev === type ? null : type));
  };

  return (
    <div
      data-testid="permission-settings-card"
      className="p-5 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600/10 dark:bg-sky-400/10 border border-sky-600/20 dark:border-sky-400/20 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Device Permissions (Camera &amp; Microphone)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Permissions granted here are permanently remembered by your browser for this domain.
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="refresh-permissions-btn"
          onClick={() => void refresh()}
          disabled={isChecking}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 self-start sm:self-auto disabled:opacity-60 cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Check Status</span>
        </button>
      </div>

      {actionFeedback && (
        <div
          role="status"
          data-testid="permission-feedback-banner"
          className="p-3 bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800 rounded-lg text-xs font-medium text-sky-900 dark:text-sky-200 flex items-center justify-between gap-2"
        >
          <span>{actionFeedback}</span>
          <button
            type="button"
            onClick={clearFeedback}
            className="text-sky-700 dark:text-sky-300 hover:text-sky-900 font-bold px-1"
          >
            &times;
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
        {/* Camera Permission Row */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Camera className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white block">
                  Camera Access
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Barcode scanner &amp; prescription capture
                </span>
              </div>
            </div>

            <span
              data-testid="camera-permission-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${cameraBadge.badgeClass}`}
            >
              {cameraBadge.label}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            {cameraStatus === 'granted' ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                ✓ Active &amp; Remembered
              </span>
            ) : (
              <button
                type="button"
                data-testid="request-camera-permission-btn"
                onClick={() => void requestCamera()}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
              >
                Request Camera
              </button>
            )}

            {cameraStatus === 'denied' && (
              <button
                type="button"
                data-testid="camera-unblock-guide-btn"
                onClick={() => toggleGuide('camera')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>How to Unblock</span>
                {expandedGuide === 'camera' ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          {expandedGuide === 'camera' && (
            <div
              data-testid="camera-guide-content"
              className="mt-2 p-3 bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/60 rounded-lg text-xs text-rose-900 dark:text-rose-200 space-y-1.5"
            >
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>{getPermissionBlockedGuide('camera').title}</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] pl-1">
                {getPermissionBlockedGuide('camera').steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Microphone Permission Row */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Mic className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white block">
                  Microphone Access
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Hands-free medication voice search
                </span>
              </div>
            </div>

            <span
              data-testid="microphone-permission-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${microphoneBadge.badgeClass}`}
            >
              {microphoneBadge.label}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            {microphoneStatus === 'granted' ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                ✓ Active &amp; Remembered
              </span>
            ) : (
              <button
                type="button"
                data-testid="request-microphone-permission-btn"
                onClick={() => void requestMicrophone()}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
              >
                Request Microphone
              </button>
            )}

            {microphoneStatus === 'denied' && (
              <button
                type="button"
                data-testid="microphone-unblock-guide-btn"
                onClick={() => toggleGuide('microphone')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>How to Unblock</span>
                {expandedGuide === 'microphone' ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          {expandedGuide === 'microphone' && (
            <div
              data-testid="microphone-guide-content"
              className="mt-2 p-3 bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/60 rounded-lg text-xs text-rose-900 dark:text-rose-200 space-y-1.5"
            >
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>{getPermissionBlockedGuide('microphone').title}</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] pl-1">
                {getPermissionBlockedGuide('microphone').steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
