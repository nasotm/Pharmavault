import React, { useState } from 'react';
import { KeyRound, Lock, CheckCircle2, AlertCircle, X } from 'lucide-react';
import {
  changeSecurityPin,
  disablePinLock,
  enablePinLock,
  isPinLockEnabled,
} from '../utils/pinLock';

interface ChangePinSectionProps {
  onLockNow: () => void;
  onPinToggled?: (enabled: boolean) => void;
}

export const ChangePinSection: React.FC<ChangePinSectionProps> = ({
  onLockNow,
  onPinToggled,
}) => {
  const [isEnabled, setIsEnabled] = useState<boolean>(() => isPinLockEnabled());
  const [showSetupModal, setShowSetupModal] = useState<boolean>(false);
  const [setupPin, setSetupPin] = useState('');
  const [setupConfirmPin, setSetupConfirmPin] = useState('');

  // Change PIN state
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');

  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleToggleClick = () => {
    setStatusMessage(null);
    if (!isEnabled) {
      // Prompt user to set a 4-digit PIN and confirm it
      setSetupPin('');
      setSetupConfirmPin('');
      setShowSetupModal(true);
    } else {
      // Turning OFF: delete PIN from localStorage and unlock app permanently
      disablePinLock();
      setIsEnabled(false);
      onPinToggled?.(false);
      setStatusMessage({
        type: 'success',
        text: 'PIN Lock disabled. Stored passcode deleted and app unlocked.',
      });
    }
  };

  const handleSetupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = enablePinLock(setupPin, setupConfirmPin);
    if (!result.ok) {
      setStatusMessage({
        type: 'error',
        text: result.error || 'Failed to enable PIN lock.',
      });
      return;
    }

    setIsEnabled(true);
    setShowSetupModal(false);
    setSetupPin('');
    setSetupConfirmPin('');
    onPinToggled?.(true);
    setStatusMessage({
      type: 'success',
      text: 'PIN Lock enabled successfully! Terminal will require this 4-digit PIN on startup.',
    });
  };

  const handleChangePinSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = changeSecurityPin({
      currentPin,
      newPin,
      confirmNewPin,
    });

    if (!result.ok) {
      setStatusMessage({
        type: 'error',
        text: result.error ?? 'Failed to update security PIN.',
      });
      return;
    }

    setCurrentPin('');
    setNewPin('');
    setConfirmNewPin('');
    setStatusMessage({
      type: 'success',
      text: 'Security PIN updated successfully.',
    });
  };

  return (
    <div
      data-testid="security-pin-settings-card"
      className="p-5 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600/10 dark:bg-sky-400/10 border border-sky-600/20 dark:border-sky-400/20 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
            <KeyRound className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Terminal Security &amp; PIN Lock
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Protect dispensary records, pricing, and stock movements with an optional 4-digit passcode.
            </p>
          </div>
        </div>

        {isEnabled && (
          <button
            type="button"
            data-testid="settings-lock-btn"
            onClick={onLockNow}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 self-start sm:self-auto cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span>Lock Terminal Now</span>
          </button>
        )}
      </div>

      {/* Main Toggle Switch: Enable PIN Lock (OFF by default) */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-4">
        <div>
          <label
            htmlFor="enable-pin-toggle"
            className="text-xs font-bold text-slate-900 dark:text-white cursor-pointer block"
          >
            Enable PIN Lock
          </label>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {isEnabled
              ? 'Active: The app prompts for your 4-digit passcode upon startup and when locked.'
              : 'Disabled (Default): The app opens directly without requesting a passcode.'}
          </span>
        </div>

        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            id="enable-pin-toggle"
            data-testid="enable-pin-lock-toggle"
            type="checkbox"
            checked={isEnabled}
            onChange={handleToggleClick}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-sky-500/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-sky-600"></div>
        </label>
      </div>

      {statusMessage && (
        <div
          role={statusMessage.type === 'error' ? 'alert' : 'status'}
          data-testid="change-pin-feedback"
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 border ${
            statusMessage.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
              : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
          }`}
        >
          {statusMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Setup Modal when turning PIN lock ON */}
      {showSetupModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-pin-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="setup-pin-title" className="text-base font-bold text-slate-900 dark:text-white">
                    Set Security Passcode
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Create a 4-digit PIN to lock your terminal
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSetupModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSetupSubmit} className="space-y-4 pt-1">
              <div>
                <label
                  htmlFor="setup-new-pin-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  New PIN (4 digits)
                </label>
                <input
                  id="setup-new-pin-input"
                  data-testid="setup-new-pin-input"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus
                  value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="w-full px-3 py-2 text-center text-base tracking-widest font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="setup-confirm-pin-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Confirm PIN
                </label>
                <input
                  id="setup-confirm-pin-input"
                  data-testid="setup-confirm-pin-input"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={setupConfirmPin}
                  onChange={(e) =>
                    setSetupConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="••••"
                  className="w-full px-3 py-2 text-center text-base tracking-widest font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  data-testid="cancel-enable-pin-btn"
                  onClick={() => setShowSetupModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="save-enable-pin-btn"
                  disabled={setupPin.length !== 4 || setupConfirmPin.length !== 4}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 rounded-xl transition-colors cursor-pointer shadow-xs"
                >
                  Enable PIN Lock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change PIN Form (Only visible when PIN lock is enabled) */}
      {isEnabled && (
        <form
          onSubmit={handleChangePinSubmit}
          data-testid="change-pin-form"
          className="pt-3 border-t border-slate-200/70 dark:border-slate-700/70 space-y-4"
        >
          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Change Current PIN
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label
                htmlFor="change-pin-current-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Current PIN
              </label>
              <input
                id="change-pin-current-input"
                data-testid="change-pin-current-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={currentPin}
                onChange={(e) => {
                  setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setStatusMessage(null);
                }}
                placeholder="••••"
                className="w-full px-3 py-2 text-xs font-mono tracking-widest bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>

            <div>
              <label
                htmlFor="change-pin-new-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                New PIN (4 digits)
              </label>
              <input
                id="change-pin-new-input"
                data-testid="change-pin-new-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setStatusMessage(null);
                }}
                placeholder="••••"
                className="w-full px-3 py-2 text-xs font-mono tracking-widest bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>

            <div>
              <label
                htmlFor="change-pin-confirm-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Confirm New PIN
              </label>
              <input
                id="change-pin-confirm-input"
                data-testid="change-pin-confirm-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmNewPin}
                onChange={(e) => {
                  setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setStatusMessage(null);
                }}
                placeholder="••••"
                className="w-full px-3 py-2 text-xs font-mono tracking-widest bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              data-testid="change-pin-submit-btn"
              disabled={!currentPin || newPin.length !== 4 || confirmNewPin.length !== 4}
              className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-40 transition-colors cursor-pointer"
            >
              Update PIN
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
