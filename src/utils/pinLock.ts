export const DEFAULT_SECURITY_PIN = '1234';
export const PIN_STORAGE_KEY = 'pharmavault_security_pin';
export const UNLOCKED_SESSION_KEY = 'pharmavault_session_unlocked';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultLocalStorage(): StorageAdapter | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function getDefaultSessionStorage(): StorageAdapter | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return null;
}

/**
 * Validates that a PIN string is exactly 4 numeric digits (0-9).
 */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin.trim());
}

/**
 * Ensures a valid 4-digit PIN exists in localStorage.
 * If none is stored (or stored value is corrupted), initializes it to DEFAULT_SECURITY_PIN ("1234").
 */
export function ensureDefaultPin(
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
): string {
  if (!localStore) {
    return DEFAULT_SECURITY_PIN;
  }
  try {
    const existing = localStore.getItem(PIN_STORAGE_KEY);
    if (existing && isValidPinFormat(existing)) {
      return existing.trim();
    }
    localStore.setItem(PIN_STORAGE_KEY, DEFAULT_SECURITY_PIN);
    return DEFAULT_SECURITY_PIN;
  } catch {
    return DEFAULT_SECURITY_PIN;
  }
}

/**
 * Verifies whether the entered PIN matches the stored PIN in localStorage.
 */
export function verifyPin(
  inputPin: string,
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
): boolean {
  const currentPin = ensureDefaultPin(localStore);
  return inputPin.trim() === currentPin;
}

/**
 * Checks whether the current browser tab session is unlocked in sessionStorage.
 */
export function isSessionUnlocked(
  sessionStore: StorageAdapter | null = getDefaultSessionStorage(),
): boolean {
  if (!sessionStore) {
    return false;
  }
  try {
    return sessionStore.getItem(UNLOCKED_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists or clears the unlocked state in sessionStorage.
 */
export function setSessionUnlocked(
  unlocked: boolean,
  sessionStore: StorageAdapter | null = getDefaultSessionStorage(),
): void {
  if (!sessionStore) {
    return;
  }
  try {
    if (unlocked) {
      sessionStore.setItem(UNLOCKED_SESSION_KEY, 'true');
    } else {
      sessionStore.removeItem(UNLOCKED_SESSION_KEY);
    }
  } catch {
    // Ignore storage quota / security errors
  }
}

export interface ChangePinInput {
  currentPin: string;
  newPin: string;
  confirmNewPin: string;
}

export interface ChangePinResult {
  ok: boolean;
  error?: string;
}

/**
 * Validates the current PIN and updates the stored PIN in localStorage
 * when the new 4-digit PIN and confirmation match.
 */
export function changeSecurityPin(
  input: ChangePinInput,
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
): ChangePinResult {
  const currentPinClean = input.currentPin.trim();
  const newPinClean = input.newPin.trim();
  const confirmNewPinClean = input.confirmNewPin.trim();

  if (!currentPinClean) {
    return { ok: false, error: 'Please enter your current PIN.' };
  }

  if (!verifyPin(currentPinClean, localStore)) {
    return { ok: false, error: 'Incorrect PIN. Current PIN does not match.' };
  }

  if (!isValidPinFormat(newPinClean)) {
    return { ok: false, error: 'New PIN must be exactly 4 digits (0–9).' };
  }

  if (newPinClean !== confirmNewPinClean) {
    return { ok: false, error: 'New PIN and confirmation do not match.' };
  }

  if (localStore) {
    try {
      localStore.setItem(PIN_STORAGE_KEY, newPinClean);
    } catch {
      return { ok: false, error: 'Unable to save new PIN to local storage.' };
    }
  }

  return { ok: true };
}
