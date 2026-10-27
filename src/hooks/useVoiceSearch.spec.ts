import { describe, expect, it } from 'vitest';
import { formatSpeechErrorMessage, isWebSpeechSupported } from './useVoiceSearch';

describe('useVoiceSearch Speech Utilities', () => {
  it('detects when Web Speech API is present or absent', () => {
    // Both undefined
    expect(isWebSpeechSupported({})).toBe(false);
    expect(isWebSpeechSupported(null)).toBe(false);

    // SpeechRecognition defined
    expect(isWebSpeechSupported({ SpeechRecognition: class {} })).toBe(true);

    // webkitSpeechRecognition defined
    expect(isWebSpeechSupported({ webkitSpeechRecognition: class {} })).toBe(true);
  });

  it('formats user-friendly error messages for common microphone permissions and errors', () => {
    // Permission denied
    const deniedMsg = formatSpeechErrorMessage('not-allowed');
    expect(deniedMsg).toContain('Microphone access was denied');
    expect(deniedMsg).toContain('permissions in your browser');

    // Service not allowed
    const serviceDeniedMsg = formatSpeechErrorMessage('service-not-allowed');
    expect(serviceDeniedMsg).toContain('Microphone access was denied');

    // No speech detected
    const noSpeechMsg = formatSpeechErrorMessage('no-speech');
    expect(noSpeechMsg).toContain('No speech was detected');

    // Network error
    const networkMsg = formatSpeechErrorMessage('network');
    expect(networkMsg).toContain('Voice search is unavailable on this network or browser');

    // Generic error
    const genericMsg = formatSpeechErrorMessage('audio-capture');
    expect(genericMsg).toContain('Voice recognition notice: audio-capture');
  });
});
