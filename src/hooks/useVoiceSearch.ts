import { useCallback, useEffect, useRef, useState } from 'react';
import { queryDevicePermission } from '../utils/permissions';

// Web Speech API interfaces
interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: {
    readonly transcript: string;
    readonly confidence: number;
  };
}

interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
  };
}

interface SpeechRecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}

export interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
}

export function isWebSpeechSupported(win?: unknown): boolean {
  const target = win ?? (typeof window !== 'undefined' ? window : null);
  if (!target) return false;
  const anyWin = target as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(anyWin.SpeechRecognition || anyWin.webkitSpeechRecognition);
}

export function formatSpeechErrorMessage(errorCode: string): string {
  if (errorCode === 'network') {
    return 'Voice search is unavailable on this network or browser. Please type the medication name or use the barcode scanner instead.';
  }
  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
    return 'Microphone access was denied. Please allow microphone permissions in your browser address bar (click the lock or tune icon and set Microphone to Allow).';
  }
  if (errorCode === 'no-speech') {
    return 'No speech was detected. Please try speaking closer to the microphone.';
  }
  return `Voice recognition notice: ${errorCode}`;
}

export interface UseVoiceSearchResult {
  isSupported: boolean;
  isListening: boolean;
  errorMessage: string | null;
  startListening: () => void;
  stopListening: () => void;
  clearError: () => void;
}

export function useVoiceSearch(
  onTranscript: (text: string) => void,
  defaultLang = 'fr-FR',
): UseVoiceSearchResult {
  const [isSupported, setIsSupported] = useState<boolean>(() => isWebSpeechSupported());
  const [isListening, setIsListening] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    setIsSupported(isWebSpeechSupported());
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    setErrorMessage(null);

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setErrorMessage('Web Speech API is not supported in this browser.');
      return;
    }

    // Pre-check permission state
    void queryDevicePermission('microphone').then((micState) => {
      if (micState === 'denied') {
        setIsListening(false);
        setErrorMessage(
          'Microphone access is blocked in your browser settings. To use voice search: click the site settings or lock icon in your address bar, set Microphone to Allow, and try again.',
        );
      }
    });

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }

      const recognition = new SpeechRecognitionClass();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = defaultLang;

      recognition.onstart = () => {
        setIsListening(true);
        setErrorMessage(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (event.results && event.results.length > 0) {
          const firstResult = event.results[0];
          if (firstResult && firstResult[0]) {
            const transcript = firstResult[0].transcript?.trim() || '';
            if (transcript) {
              onTranscriptRef.current(transcript);
            }
          }
        }
        setIsListening(false);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        setIsListening(false);
        if (event.error !== 'aborted') {
          setErrorMessage(formatSpeechErrorMessage(event.error));
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: unknown) {
      setIsListening(false);
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to activate microphone.',
      );
    }
  }, [defaultLang]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  return {
    isSupported,
    isListening,
    errorMessage,
    startListening,
    stopListening,
    clearError,
  };
}
