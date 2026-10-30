export const DEFAULT_SECURITY_PIN = '1234';
export const PIN_STORAGE_KEY = 'pharmavault_security_pin';
export const PIN_ENABLED_STORAGE_KEY = 'pharmavault_pin_enabled';
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
 * Checks whether the PIN Lock is enabled by the user in settings.
 * PIN Lock is DISABLED (false) by default.
 */
export function isPinLockEnabled(
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
): boolean {
  if (!localStore) {
    return false;
  }
  try {
    const isEnabled = localStore.getItem(PIN_ENABLED_STORAGE_KEY) === 'true';
    if (!isEnabled) {
      return false;
    }
    const storedPin = localStore.getItem(PIN_STORAGE_KEY);
    return Boolean(storedPin && isValidPinFormat(storedPin));
  } catch {
    return false;
  }
}

/**
 * Gets the stored 4-digit PIN if PIN lock is enabled, or null if disabled.
 */
export function getStoredPin(
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
): string | null {
  if (!localStore || !isPinLockEnabled(localStore)) {
    return null;
  }
  try {
    const pin = localStore.getItem(PIN_STORAGE_KEY);
    return pin && isValidPinFormat(pin) ? pin.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether the Lock Screen should be displayed.
 * Only returns true if PIN Lock is enabled AND current session is not unlocked.
 * Defaults to false (unlocked) on fresh load.
 */
export function shouldShowLockScreen(
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
  sessionStore: StorageAdapter | null = getDefaultSessionStorage(),
): boolean {
  if (!isPinLockEnabled(localStore)) {
    return false;
  }
  return !isSessionUnlocked(sessionStore);
}

/**
 * Enables PIN Lock with a user-specified 4-digit PIN and confirmation.
 * Marks the current session as unlocked so user isn't immediately locked out while in settings.
 */
export function enablePinLock(
  newPin: string,
  confirmNewPin: string,
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
  sessionStore: StorageAdapter | null = getDefaultSessionStorage(),
): { ok: boolean; error?: string } {
  const pinClean = newPin.trim();
  const confirmClean = confirmNewPin.trim();

  if (!isValidPinFormat(pinClean)) {
    return { ok: false, error: 'PIN must be exactly 4 digits (0–9).' };
  }

  if (pinClean !== confirmClean) {
    return { ok: false, error: 'PIN and confirmation do not match.' };
  }

  if (localStore) {
    try {
      localStore.setItem(PIN_STORAGE_KEY, pinClean);
      localStore.setItem(PIN_ENABLED_STORAGE_KEY, 'true');
    } catch {
      return { ok: false, error: 'Unable to save PIN to local storage.' };
    }
  }

  // Ensure current session is marked as unlocked
  setSessionUnlocked(true, sessionStore);

  return { ok: true };
}

/**
 * Disables PIN Lock, deletes the PIN from localStorage, and permanently unlocks the app session.
 */
export function disablePinLock(
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
  sessionStore: StorageAdapter | null = getDefaultSessionStorage(),
): void {
  if (localStore) {
    try {
      localStore.removeItem(PIN_STORAGE_KEY);
      localStore.setItem(PIN_ENABLED_STORAGE_KEY, 'false');
    } catch {
      // ignore
    }
  }
  setSessionUnlocked(true, sessionStore);
}

/**
 * Helper to ensure a PIN exists for backward compatibility and test suites.
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
 * Verifies whether the entered PIN matches the stored PIN.
 * If PIN Lock is not enabled, returns true (always unlocked).
 */
export function verifyPin(
  inputPin: string,
  localStore: StorageAdapter | null = getDefaultLocalStorage(),
): boolean {
  if (!isPinLockEnabled(localStore)) {
    return true;
  }
  const currentPin = localStore ? localStore.getItem(PIN_STORAGE_KEY) : null;
  return inputPin.trim() === (currentPin?.trim() || '');
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

  if (!isPinLockEnabled(localStore)) {
    return { ok: false, error: 'PIN Lock is currently disabled. Enable it first.' };
  }

  if (!currentPinClean) {
    return { ok: false, error: 'Please enter your current PIN.' };
  }

  const storedPin = localStore?.getItem(PIN_STORAGE_KEY) || '';
  if (currentPinClean !== storedPin) {
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
      localStore.setItem(PIN_ENABLED_STORAGE_KEY, 'true');
    } catch {
      return { ok: false, error: 'Unable to save new PIN to local storage.' };
    }
  }

  return { ok: true };
}
