import React, { useState } from 'react';
import { KeyRound, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { changeSecurityPin } from '../utils/pinLock';

interface ChangePinSectionProps {
  onLockNow: () => void;
}

export const ChangePinSection: React.FC<ChangePinSectionProps> = ({ onLockNow }) => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
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
              Security Lock &amp; Change PIN
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Protect sensitive pharmacy pricing, stock levels, and audit history when leaving the
              terminal.
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="settings-lock-btn"
          onClick={onLockNow}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 self-start sm:self-auto"
        >
          <Lock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
          <span>Lock Terminal Now</span>
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        data-testid="change-pin-form"
        className="pt-3 border-t border-slate-200/70 dark:border-slate-700/70 space-y-4"
      >
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-h-[1.25rem] flex items-center">
            {statusMessage ? (
              <div
                role={statusMessage.type === 'error' ? 'alert' : 'status'}
                data-testid="change-pin-feedback"
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  statusMessage.type === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {statusMessage.type === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            ) : (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Enter your current 4-digit PIN and confirm the new PIN twice.
              </span>
            )}
          </div>

          <button
            type="submit"
            data-testid="change-pin-submit-btn"
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors self-start sm:self-auto shrink-0"
          >
            Change PIN
          </button>
        </div>
      </form>
    </div>
  );
};
