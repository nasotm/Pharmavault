import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Unlock, Delete, ShieldAlert } from 'lucide-react';
import { verifyPin } from '../utils/pinLock';

interface LockScreenProps {
  isLocked: boolean;
  onUnlockSuccess: () => void;
}

const KEYPAD_BUTTONS: Array<{ digit: string; letters: string }> = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
];

export const LockScreen: React.FC<LockScreenProps> = ({ isLocked, onUnlockSuccess }) => {
  const [pin, setPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);
  const unlockTimerRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);

  // Reset state whenever the screen becomes locked again
  useEffect(() => {
    if (isLocked) {
      setPin('');
      setErrorMsg(null);
      setIsShaking(false);
      setIsUnlocking(false);
    }
  }, [isLocked]);

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
      if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current);
    };
  }, []);

  const triggerWrongPinFeedback = useCallback(() => {
    setErrorMsg('Incorrect PIN');
    setIsShaking(false);
    // Re-trigger shake animation frame
    window.requestAnimationFrame(() => {
      setIsShaking(true);
    });
    if (shakeTimerRef.current) {
      window.clearTimeout(shakeTimerRef.current);
    }
    shakeTimerRef.current = window.setTimeout(() => {
      setIsShaking(false);
      setPin('');
    }, 440);
  }, []);

  const attemptUnlockWithPin = useCallback(
    (candidatePin: string) => {
      if (isUnlocking) return;

      if (candidatePin.length < 4) {
        triggerWrongPinFeedback();
        return;
      }

      if (verifyPin(candidatePin)) {
        setErrorMsg(null);
        setIsUnlocking(true);
        if (unlockTimerRef.current) {
          window.clearTimeout(unlockTimerRef.current);
        }
        unlockTimerRef.current = window.setTimeout(() => {
          onUnlockSuccess();
        }, 280);
      } else {
        triggerWrongPinFeedback();
      }
    },
    [isUnlocking, onUnlockSuccess, triggerWrongPinFeedback],
  );

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (isUnlocking) return;
      if (errorMsg) {
        setErrorMsg(null);
      }
      setPin((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + digit;
        if (next.length === 4) {
          if (verifyPin(next)) {
            setErrorMsg(null);
            setIsUnlocking(true);
            if (unlockTimerRef.current) {
              window.clearTimeout(unlockTimerRef.current);
            }
            unlockTimerRef.current = window.setTimeout(() => {
              onUnlockSuccess();
            }, 280);
          } else {
            window.setTimeout(() => {
              triggerWrongPinFeedback();
            }, 60);
          }
        }
        return next;
      });
    },
    [errorMsg, isUnlocking, onUnlockSuccess, triggerWrongPinFeedback],
  );

  const handleBackspace = useCallback(() => {
    if (isUnlocking) return;
    setErrorMsg(null);
    setPin((prev) => prev.slice(0, -1));
  }, [isUnlocking]);

  const handleUnlockButtonClick = useCallback(() => {
    if (isUnlocking) {
      // Complete unlock immediately if already verified and fading out
      if (unlockTimerRef.current) {
        window.clearTimeout(unlockTimerRef.current);
      }
      onUnlockSuccess();
      return;
    }
    attemptUnlockWithPin(pin);
  }, [attemptUnlockWithPin, isUnlocking, onUnlockSuccess, pin]);

  // Keyboard support (0-9, Backspace, Enter)
  useEffect(() => {
    if (!isLocked) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        handleDigitPress(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleUnlockButtonClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, handleDigitPress, handleBackspace, handleUnlockButtonClick]);

  if (!isLocked) {
    return null;
  }

  return (
    <div
      data-testid="lock-screen-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Security Lock Screen"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 py-8 select-none bg-slate-950/95 backdrop-blur-2xl text-white transition-opacity duration-300 ${
        isUnlocking ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden flex items-center justify-center"
      >
        <div className="w-[28rem] h-[28rem] rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-xs flex flex-col items-center">
        {/* Padlock Icon Header */}
        <div
          className={`w-16 h-16 rounded-2xl flex items-center justify-center border shadow-lg transition-all duration-300 ${
            isUnlocking
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300 scale-105'
              : errorMsg
                ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                : 'bg-slate-900/90 border-slate-700/80 text-sky-400'
          }`}
        >
          {isUnlocking ? (
            <Unlock className="w-7 h-7" aria-hidden="true" />
          ) : (
            <Lock className="w-7 h-7" aria-hidden="true" />
          )}
        </div>

        {/* Title & Subtitle */}
        <div className="mt-5 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400/90">
            PharmaVault Terminal
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Enter Passcode</h1>
          <p className="mt-1 text-xs text-slate-400">
            Enter your 4-digit security PIN to access pharmacy records
          </p>
        </div>

        {/* 4-Dot PIN Display */}
        <div
          data-testid="pin-dots-container"
          aria-label={`PIN progress: ${pin.length} of 4 digits entered`}
          className={`mt-7 flex items-center justify-center gap-5 ${
            isShaking ? 'animate-pin-shake' : ''
          }`}
        >
          {[0, 1, 2, 3].map((index) => {
            const isFilled = index < pin.length;
            return (
              <span
                key={index}
                data-testid={`pin-dot-${index}`}
                data-filled={isFilled ? 'true' : 'false'}
                className={`w-4 h-4 rounded-full border-2 transition-transform duration-150 ${
                  errorMsg
                    ? isFilled
                      ? 'bg-rose-500 border-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.6)] scale-110'
                      : 'bg-rose-500/20 border-rose-400/70'
                    : isUnlocking
                      ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.6)] scale-110'
                      : isFilled
                        ? 'bg-white border-white shadow-[0_0_12px_rgba(255,255,255,0.5)] scale-110'
                        : 'bg-transparent border-slate-600'
                }`}
              />
            );
          })}
        </div>

        {/* Error Message Area (Fixed Height to avoid layout shift) */}
        <div className="mt-4 h-7 flex items-center justify-center">
          {errorMsg && (
            <div
              role="alert"
              data-testid="pin-error-message"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-xs font-semibold text-rose-300"
            >
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Numeric Keypad (0-9, Backspace, Unlock) */}
        <div className="mt-4 grid grid-cols-3 gap-3.5 sm:gap-4 w-full justify-items-center">
          {KEYPAD_BUTTONS.map(({ digit, letters }) => (
            <button
              key={digit}
              type="button"
              data-testid={`pin-key-${digit}`}
              onClick={() => handleDigitPress(digit)}
              className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full bg-slate-900/80 hover:bg-slate-800 active:bg-slate-700 active:scale-95 border border-slate-700/70 flex flex-col items-center justify-center transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-sky-500/50 cursor-pointer"
            >
              <span className="text-2xl font-bold font-mono leading-none text-white">{digit}</span>
              {letters ? (
                <span className="mt-1 text-[9px] font-semibold tracking-[0.18em] text-slate-400">
                  {letters}
                </span>
              ) : (
                <span className="mt-1 text-[9px] opacity-0 select-none">•</span>
              )}
            </button>
          ))}

          {/* Bottom Row: Backspace | 0 | Unlock */}
          <button
            type="button"
            data-testid="pin-key-backspace"
            onClick={handleBackspace}
            aria-label="Backspace"
            title="Backspace"
            className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full bg-slate-900/50 hover:bg-slate-800/80 active:bg-slate-700 active:scale-95 border border-slate-800 flex flex-col items-center justify-center text-slate-300 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-sky-500/50 cursor-pointer"
          >
            <Delete className="w-5 h-5" aria-hidden="true" />
            <span className="mt-1 text-[10px] font-semibold text-slate-400">Delete</span>
          </button>

          <button
            type="button"
            data-testid="pin-key-0"
            onClick={() => handleDigitPress('0')}
            className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full bg-slate-900/80 hover:bg-slate-800 active:bg-slate-700 active:scale-95 border border-slate-700/70 flex flex-col items-center justify-center transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-sky-500/50 cursor-pointer"
          >
            <span className="text-2xl font-bold font-mono leading-none text-white">0</span>
            <span className="mt-1 text-[9px] font-semibold tracking-[0.18em] text-slate-400">
              +
            </span>
          </button>

          <button
            type="button"
            data-testid="pin-unlock-btn"
            onClick={handleUnlockButtonClick}
            className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full bg-sky-600 hover:bg-sky-500 active:bg-sky-700 active:scale-95 border border-sky-400/40 flex flex-col items-center justify-center text-white font-semibold transition-all shadow-lg shadow-sky-900/40 focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
          >
            <Unlock className="w-5 h-5" aria-hidden="true" />
            <span className="mt-1 text-[11px] font-bold tracking-wide">Unlock</span>
          </button>
        </div>
      </div>
    </div>
  );
};
