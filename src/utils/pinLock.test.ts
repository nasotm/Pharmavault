import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SECURITY_PIN,
  PIN_STORAGE_KEY,
  UNLOCKED_SESSION_KEY,
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

test('ensureDefaultPin initializes localStorage with default PIN 1234 when empty', () => {
  const localStore = createMemoryStorage();
  const pin = ensureDefaultPin(localStore);
  assert.equal(pin, DEFAULT_SECURITY_PIN);
  assert.equal(localStore.getItem(PIN_STORAGE_KEY), '1234');
});

test('ensureDefaultPin preserves existing valid 4-digit PIN in localStorage', () => {
  const localStore = createMemoryStorage({ [PIN_STORAGE_KEY]: '5678' });
  const pin = ensureDefaultPin(localStore);
  assert.equal(pin, '5678');
  assert.equal(localStore.getItem(PIN_STORAGE_KEY), '5678');
});

test('verifyPin validates default PIN 1234 and rejects wrong PINs', () => {
  const localStore = createMemoryStorage();
  assert.equal(verifyPin('1234', localStore), true);
  assert.equal(verifyPin('0000', localStore), false);
  assert.equal(verifyPin('123', localStore), false);
  assert.equal(verifyPin('abcd', localStore), false);
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
  ensureDefaultPin(localStore);

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
