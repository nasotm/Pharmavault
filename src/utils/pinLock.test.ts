import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SECURITY_PIN,
  PIN_STORAGE_KEY,
  PIN_ENABLED_STORAGE_KEY,
  UNLOCKED_SESSION_KEY,
  isPinLockEnabled,
  shouldShowLockScreen,
  enablePinLock,
  disablePinLock,
  ensureDefaultPin,
  verifyPin,
  isSessionUnlocked,
  setSessionUnlocked,
  changeSecurityPin,
  isValidPinFormat,
  type StorageAdapter,
} from './pinLock';

function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
    removeItem(key: string): void {
      map.delete(key);
    },
  };
}

test('isPinLockEnabled returns false by default for fresh storage', () => {
  const localStore = createMemoryStorage();
  assert.equal(isPinLockEnabled(localStore), false);
  assert.equal(shouldShowLockScreen(localStore), false);
});

test('enablePinLock validates 4-digit format and confirmation, then enables lock', () => {
  const localStore = createMemoryStorage();
  const sessionStore = createMemoryStorage();

  // Mismatched PIN
  const mismatch = enablePinLock('1234', '1235', localStore, sessionStore);
  assert.equal(mismatch.ok, false);
  assert.equal(isPinLockEnabled(localStore), false);

  // Invalid length
  const badLen = enablePinLock('12', '12', localStore, sessionStore);
  assert.equal(badLen.ok, false);
  assert.equal(isPinLockEnabled(localStore), false);

  // Valid setup
  const ok = enablePinLock('4821', '4821', localStore, sessionStore);
  assert.equal(ok.ok, true);
  assert.equal(isPinLockEnabled(localStore), true);
  assert.equal(localStore.getItem(PIN_STORAGE_KEY), '4821');
  assert.equal(localStore.getItem(PIN_ENABLED_STORAGE_KEY), 'true');
  assert.equal(isSessionUnlocked(sessionStore), true);

  // If session is locked afterwards, shouldShowLockScreen returns true
  setSessionUnlocked(false, sessionStore);
  assert.equal(shouldShowLockScreen(localStore, sessionStore), true);
});

test('disablePinLock removes stored PIN, disables lock, and permanently unlocks session', () => {
  const localStore = createMemoryStorage({
    [PIN_STORAGE_KEY]: '9999',
    [PIN_ENABLED_STORAGE_KEY]: 'true',
  });
  const sessionStore = createMemoryStorage({
    [UNLOCKED_SESSION_KEY]: 'false',
  });

  assert.equal(isPinLockEnabled(localStore), true);

  disablePinLock(localStore, sessionStore);

  assert.equal(isPinLockEnabled(localStore), false);
  assert.equal(localStore.getItem(PIN_STORAGE_KEY), null);
  assert.equal(localStore.getItem(PIN_ENABLED_STORAGE_KEY), 'false');
  assert.equal(isSessionUnlocked(sessionStore), true);
  assert.equal(shouldShowLockScreen(localStore, sessionStore), false);
});

test('verifyPin validates correct PIN when enabled and returns true when disabled', () => {
  const localStore = createMemoryStorage();
  // Disabled by default -> verifyPin returns true (always unlocked)
  assert.equal(verifyPin('anything', localStore), true);

  // Enabled with PIN 7788
  enablePinLock('7788', '7788', localStore);
  assert.equal(verifyPin('7788', localStore), true);
  assert.equal(verifyPin('0000', localStore), false);
  assert.equal(verifyPin('1234', localStore), false);
});

test('ensureDefaultPin initializes localStorage with default PIN 1234 when called directly', () => {
  const localStore = createMemoryStorage();
  const pin = ensureDefaultPin(localStore);
  assert.equal(pin, DEFAULT_SECURITY_PIN);
  assert.equal(localStore.getItem(PIN_STORAGE_KEY), '1234');
});

test('session unlock state persists in sessionStorage and clears on lock', () => {
  const sessionStore = createMemoryStorage();
  assert.equal(isSessionUnlocked(sessionStore), false);

  setSessionUnlocked(true, sessionStore);
  assert.equal(isSessionUnlocked(sessionStore), true);
  assert.equal(sessionStore.getItem(UNLOCKED_SESSION_KEY), 'true');

  setSessionUnlocked(false, sessionStore);
  assert.equal(isSessionUnlocked(sessionStore), false);
  assert.equal(sessionStore.getItem(UNLOCKED_SESSION_KEY), null);
});

test('changeSecurityPin validates current PIN, 4-digit format, and confirmation match', () => {
  const localStore = createMemoryStorage();
  enablePinLock('1234', '1234', localStore);

  // Wrong current PIN
  const wrongCurrent = changeSecurityPin(
    { currentPin: '9999', newPin: '4321', confirmNewPin: '4321' },
    localStore,
  );
  assert.equal(wrongCurrent.ok, false);
  assert.match(wrongCurrent.error ?? '', /Incorrect PIN/i);

  // Non-4-digit new PIN
  const badFormat = changeSecurityPin(
    { currentPin: '1234', newPin: '43', confirmNewPin: '43' },
    localStore,
  );
  assert.equal(badFormat.ok, false);
  assert.match(badFormat.error ?? '', /4 digits/i);

  // Mismatched confirmation
  const mismatch = changeSecurityPin(
    { currentPin: '1234', newPin: '4321', confirmNewPin: '4322' },
    localStore,
  );
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error ?? '', /do not match/i);

  // Valid change
  const success = changeSecurityPin(
    { currentPin: '1234', newPin: '4321', confirmNewPin: '4321' },
    localStore,
  );
  assert.equal(success.ok, true);
  assert.equal(localStore.getItem(PIN_STORAGE_KEY), '4321');
  assert.equal(verifyPin('4321', localStore), true);
  assert.equal(verifyPin('1234', localStore), false);
});

test('isValidPinFormat accepts only 4 numeric digits', () => {
  assert.equal(isValidPinFormat('0000'), true);
  assert.equal(isValidPinFormat('1234'), true);
  assert.equal(isValidPinFormat('123'), false);
  assert.equal(isValidPinFormat('12345'), false);
  assert.equal(isValidPinFormat('12a4'), false);
});
