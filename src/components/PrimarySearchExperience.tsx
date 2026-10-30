import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Globe, Plus, Sparkles, TrendingUp } from 'lucide-react';
import {
  generateQuickAccessAiTrends,
  NO_RECENT_SALES_TREND_MESSAGE,
  type TopDispensedMedicationRow,
} from '../assistant';
import { getRepositoryDatabase, hasRepositoryDatabase } from '../db/repository';
import { formatMoneyDisplay } from '../pricing';
import { searchBdpm, getBdpmComposition, type BdpmSearchResult } from '../services/bdpmService';
import { getFdaDrugLabel } from '../services/openFdaService';
import { searchGlobalDrug, type RxNormSearchResult } from '../services/rxnormService';
import { ManualMedicationModal, type ManualMedicationPrefill } from './ManualMedicationModal';
import {
  findGenericEquivalentsInStock,
  getMedicationDetailForSearch,
  isEligibleForGenericSubstitution,
  searchMedications,
  type GenericSubstitutionResult,
  type LayeredSearchResponse,
  type SearchMedicationDetail,
  type SearchResultItem,
} from '../search';
import {
  LOW_STOCK_BADGE_PULSE_ANIMATE,
  LOW_STOCK_BADGE_PULSE_TRANSITION,
} from '../utils/animations';
import {
  SEARCH_HERO_CARD_CLASSES,
  SEARCH_RESULT_GLASS_CARD_CLASSES,
  SEARCH_SECONDARY_GLASS_CARD_CLASSES,
} from '../utils/glassmorphism';
import { BarcodeCameraModal } from './BarcodeCameraModal';
import { ScanPrescriptionModal } from './ScanPrescriptionModal';
import { useVoiceSearch } from '../hooks/useVoiceSearch';

interface PrimarySearchExperienceProps {
  totalCatalogCount: number;
  refreshTrigger?: unknown;
  onSelectMedication: (medicationId: number, preloadedDetail?: SearchMedicationDetail | null) => void;
  onDatabaseMutated?: () => Promise<void> | void;
}

export function PrimarySearchExperience({
  totalCatalogCount,
  refreshTrigger,
  onSelectMedication,
  onDatabaseMutated,
}: PrimarySearchExperienceProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hiddenScannerInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState<string>('');
  const [searchResponse, setSearchResponse] = useState<LayeredSearchResponse>({
    query: '',
    normalizedQuery: '',
    matchedLayer: null,
    elapsedMs: 0,
    results: [],
  });
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [hiddenScannerValue, setHiddenScannerValue] = useState<string>('');
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState<boolean>(false);
  const [topDispensed, setTopDispensed] = useState<TopDispensedMedicationRow[]>([]);
  const [aiTrendInsight, setAiTrendInsight] = useState<string>(NO_RECENT_SALES_TREND_MESSAGE);

  // Global Database states (RxNorm & BDPM)
  const [globalSource, setGlobalSource] = useState<'rxnorm' | 'bdpm'>('rxnorm');
  const [rxnormResults, setRxnormResults] = useState<RxNormSearchResult[]>([]);
  const [isSearchingRxNorm, setIsSearchingRxNorm] = useState<boolean>(false);
  const [isImportingRxcui, setIsImportingRxcui] = useState<string | null>(null);

  const [bdpmResults, setBdpmResults] = useState<BdpmSearchResult[]>([]);
  const [isSearchingBdpm, setIsSearchingBdpm] = useState<boolean>(false);
  const [isImportingCis, setIsImportingCis] = useState<string | null>(null);

  const [isManualModalOpen, setIsManualModalOpen] = useState<boolean>(false);
  const [manualModalPrefill, setManualModalPrefill] = useState<ManualMedicationPrefill | null>(null);
  const [findingGenericMedId, setFindingGenericMedId] = useState<number | null>(null);
  const [genericModalResult, setGenericModalResult] = useState<GenericSubstitutionResult | null>(
    null,
  );
  const rxnormSeqRef = useRef<number>(0);
  const bdpmSeqRef = useRef<number>(0);

  const handleFindGenericFromSearch = async (item: SearchResultItem) => {
    const { medication } = item;
    setFindingGenericMedId(medication.id);
    try {
      const db = getRepositoryDatabase();
      const result = await findGenericEquivalentsInStock(db, {
        medicationId: medication.id,
        brandName: medication.brand_name,
        genericName: medication.generic_name,
      });
      setGenericModalResult(result);
    } catch {
      setGenericModalResult({
        sourceMedicationId: medication.id,
        sourceBrandName: medication.brand_name,
        sourceGenericName: medication.generic_name ?? null,
        resolvedGenericName: medication.generic_name ?? null,
        inferredByAi: false,
        equivalents: [],
        summaryText: 'No generic equivalent in stock.',
      });
    } finally {
      setFindingGenericMedId(null);
    }
  };

  // Rapid keystroke buffer for hardware USB/Bluetooth wedge barcode scanners
  const scannerBufferRef = useRef<{ chars: string; lastKeyTime: number }>({
    chars: '',
    lastKeyTime: 0,
  });

  // Autofocus the primary search bar on load
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const executeSearch = useCallback(
    async (nextQuery: string, autoOpenFirstResult = false) => {
      const trimmed = nextQuery.trim();
      try {
        const db = getRepositoryDatabase();
        const res = await searchMedications(db, nextQuery);
        setSearchResponse(res);

        if (res.results.length > 0 && autoOpenFirstResult) {
          const freshDetail = await getMedicationDetailForSearch(db, res.results[0].medication.id);
          onSelectMedication(res.results[0].medication.id, freshDetail);
        }

        // If local search returns no results, automatically query external databases (RxNorm and BDPM)
        if (res.results.length === 0 && trimmed.length >= 2) {
          // 1. Query RxNorm
          const currentRxSeq = ++rxnormSeqRef.current;
          setIsSearchingRxNorm(true);
          searchGlobalDrug(trimmed)
            .then((globalResults) => {
              if (rxnormSeqRef.current === currentRxSeq) {
                setRxnormResults(globalResults);
              }
            })
            .catch(() => {
              if (rxnormSeqRef.current === currentRxSeq) {
                setRxnormResults([]);
              }
            })
            .finally(() => {
              if (rxnormSeqRef.current === currentRxSeq) {
                setIsSearchingRxNorm(false);
              }
            });

          // 2. Query French BDPM
          const currentBdpmSeq = ++bdpmSeqRef.current;
          setIsSearchingBdpm(true);
          searchBdpm(trimmed)
            .then((frenchResults) => {
              if (bdpmSeqRef.current === currentBdpmSeq) {
                setBdpmResults(frenchResults);
              }
            })
            .catch(() => {
              if (bdpmSeqRef.current === currentBdpmSeq) {
                setBdpmResults([]);
              }
            })
            .finally(() => {
              if (bdpmSeqRef.current === currentBdpmSeq) {
                setIsSearchingBdpm(false);
              }
            });
        } else {
          rxnormSeqRef.current++;
          bdpmSeqRef.current++;
          setRxnormResults([]);
          setBdpmResults([]);
          setIsSearchingRxNorm(false);
          setIsSearchingBdpm(false);
        }
      } catch {
        // Ignore transient pre-init calls
      }
    },
    [onSelectMedication],
  );

  const loadQuickAccessTrends = useCallback(async () => {
    if (!hasRepositoryDatabase()) return;
    try {
      const db = getRepositoryDatabase();
      const trends = await generateQuickAccessAiTrends(db, {
        limit: 5,
        useRemoteModelEndpoint: true,
      });
      setTopDispensed(trends.topDispensed);
      setAiTrendInsight(trends.insightText);
    } catch {
      setTopDispensed([]);
      setAiTrendInsight(NO_RECENT_SALES_TREND_MESSAGE);
    }
  }, []);

  // Re-run current search & Quick Access / AI Trends when catalog/stock mutates
  useEffect(() => {
    if (query.trim().length > 0) {
      void executeSearch(query, false);
    }
    void loadQuickAccessTrends();
  }, [refreshTrigger, loadQuickAccessTrends]);

  const routeToBarcodeSearch = useCallback(
    async (rawBarcode: string, autoOpen = true) => {
      const cleaned = rawBarcode.trim();
      if (!cleaned) return;
      setLastScannedBarcode(cleaned);
      setQuery(cleaned);
      await executeSearch(cleaned, autoOpen);
    },
    [executeSearch],
  );

  const handleCameraBarcodeDetected = useCallback(
    (scannedBarcode: string) => {
      setIsCameraModalOpen(false);
      const cleaned = scannedBarcode.trim();
      if (!cleaned) return;
      setLastScannedBarcode(cleaned);
      setQuery(cleaned);
      void executeSearch(cleaned, false);
    },
    [executeSearch],
  );

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      const cleaned = transcript.trim();
      if (!cleaned) return;
      setLastScannedBarcode(null);
      setQuery(cleaned);
      void executeSearch(cleaned, false);
    },
    [executeSearch],
  );

  const {
    isSupported: isSpeechSupported,
    isListening,
    errorMessage: speechError,
    startListening,
    stopListening,
    clearError: clearSpeechError,
  } = useVoiceSearch(handleVoiceTranscript, 'fr-FR');

  // Global rapid-keystroke listener for hardware barcode scanners ending in Enter
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isSearchInput = target === searchInputRef.current;
      const isHiddenScanner = target === hiddenScannerInputRef.current;

      if (
        target &&
        !isSearchInput &&
        !isHiddenScanner &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }

      const now = performance.now();
      const deltaMs = now - scannerBufferRef.current.lastKeyTime;

      if (e.key === 'Enter') {
        if (scannerBufferRef.current.chars.length >= 6 && deltaMs < 80) {
          e.preventDefault();
          const scanned = scannerBufferRef.current.chars;
          scannerBufferRef.current = { chars: '', lastKeyTime: 0 };
          void routeToBarcodeSearch(scanned);
        } else if (isSearchInput && query.trim().length > 0) {
          e.preventDefault();
          void executeSearch(query, true);
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (deltaMs < 50) {
          scannerBufferRef.current.chars += e.key;
        } else {
          scannerBufferRef.current.chars = e.key;
        }
        scannerBufferRef.current.lastKeyTime = now;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [routeToBarcodeSearch, executeSearch, query]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setQuery(nextValue);
    setLastScannedBarcode(null);
    void executeSearch(nextValue, false);
  };

  const handleSelectResultItem = async (item: SearchResultItem) => {
    const db = getRepositoryDatabase();
    const freshDetail = await getMedicationDetailForSearch(db, item.medication.id);
    onSelectMedication(item.medication.id, freshDetail);
  };

  const handleSelectTopDispensedMedication = async (medicationId: number) => {
    try {
      const db = getRepositoryDatabase();
      const freshDetail = await getMedicationDetailForSearch(db, medicationId);
      onSelectMedication(medicationId, freshDetail);
    } catch {
      onSelectMedication(medicationId);
    }
  };

  const handleImportRxNormDrug = async (item: RxNormSearchResult) => {
    setIsImportingRxcui(item.rxcui);
    try {
      const fdaLabel = await getFdaDrugLabel(item.rxcui);
      setManualModalPrefill({
        name: item.name,
        rxcui: item.rxcui,
        fdaLabel,
        fdaChecked: true,
      });
      setIsManualModalOpen(true);
    } catch {
      setManualModalPrefill({
        name: item.name,
        rxcui: item.rxcui,
        fdaLabel: null,
        fdaChecked: true,
      });
      setIsManualModalOpen(true);
    } finally {
      setIsImportingRxcui(null);
    }
  };

  const handleImportBdpmDrug = async (item: BdpmSearchResult) => {
    setIsImportingCis(item.cis);
    try {
      const bdpmComp = await getBdpmComposition(item.cis);
      setManualModalPrefill({
        name: item.name,
        cis: item.cis,
        composition: bdpmComp?.compositionText || '',
        presentations: bdpmComp?.presentations || [],
        sourceType: 'bdpm',
      });
      setIsManualModalOpen(true);
    } catch {
      setManualModalPrefill({
        name: item.name,
        cis: item.cis,
        composition: '',
        presentations: [],
        sourceType: 'bdpm',
      });
      setIsManualModalOpen(true);
    } finally {
      setIsImportingCis(null);
    }
  };

  const handleHiddenScannerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = hiddenScannerValue.trim();
      setHiddenScannerValue('');
      if (code) {
        void routeToBarcodeSearch(code);
      }
    }
  };

  const isQueryEmpty = query.trim() === '';
  const hasNoResults = !isQueryEmpty && searchResponse.results.length === 0;

  return (
    <section
      id="primary-search"
      aria-label="Medication & Dispensary Location Search"
      className="py-6 sm:py-10 space-y-10"
    >
      {/* Hardware-scanner-friendly hidden input */}
      <div className="sr-only">
        <label htmlFor="hardware-barcode-scanner-input">Hardware Barcode Scanner Input</label>
        <input
          ref={hiddenScannerInputRef}
          id="hardware-barcode-scanner-input"
          data-testid="hardware-barcode-scanner-input"
          type="text"
          tabIndex={-1}
          aria-label="Hardware Barcode Scanner Input"
          value={hiddenScannerValue}
          onChange={(e) => setHiddenScannerValue(e.target.value)}
          onKeyDown={handleHiddenScannerKeyDown}
        />
      </div>

      {/* Centered Glassmorphic Hero Search Card */}
      <div
        data-testid="search-hero-card"
        className={SEARCH_HERO_CARD_CLASSES}
      >
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Find Any Medication Instantly
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300">
            Type a brand name, generic ingredient, or scan a barcode to see exact shelf and bin
            coordinates across {totalCatalogCount.toLocaleString()} medications.
          </p>
        </div>

        {/* Massive Google-Style Search Bar + Scan with Camera Button */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          <div className="relative flex-1 flex items-center bg-white/90 dark:bg-slate-900/85 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-sm shadow-sky-950/5 focus-within:border-sky-500 dark:focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-500/15 transition-all">
            <div className="pl-5 pr-3 text-slate-400 dark:text-slate-400 pointer-events-none">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
            </div>
            <label htmlFor="primary-medication-search-input" className="sr-only">
              Search medications by name, generic ingredient, or barcode
            </label>
            <input
              ref={searchInputRef}
              id="primary-medication-search-input"
              data-testid="primary-medication-search-input"
              type="search"
              autoFocus
              value={query}
              onChange={handleQueryChange}
              placeholder="Search medication brand, generic name, or scan barcode..."
              className="w-full py-4 sm:py-5 pr-4 text-base sm:text-lg font-medium text-slate-900 dark:text-white bg-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
            />

            {/* Native Voice Search Button (Microphone) */}
            {isSpeechSupported && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                data-testid="voice-search-mic-btn"
                aria-label={isListening ? 'Arrêter écoute vocale' : 'Recherche vocale'}
                title={isListening ? 'Listening... click to stop' : 'Requires Chrome/Edge and a stable connection'}
                onClick={() => {
                  if (isListening) {
                    stopListening();
                  } else {
                    startListening();
                  }
                }}
                className={`p-2.5 rounded-xl transition-all shrink-0 mr-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500/20 min-h-[44px] min-w-[44px] flex items-center justify-center ${
                  isListening
                    ? 'text-white bg-red-500 hover:bg-red-600 animate-pulse shadow-md shadow-red-500/30'
                    : 'text-slate-400 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 active:bg-sky-100'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              </motion.button>
            )}

            {!isQueryEmpty && (
              <div className="pr-4 flex items-center gap-2 shrink-0">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  data-testid="clear-search-btn"
                  onClick={() => {
                    setQuery('');
                    setLastScannedBarcode(null);
                    setSearchResponse({
                      query: '',
                      normalizedQuery: '',
                      matchedLayer: null,
                      elapsedMs: 0,
                      results: [],
                    });
                    searchInputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 min-h-[44px] text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center justify-center"
                >
                  Clear
                </motion.button>
              </div>
            )}
          </div>

          {/* Camera Scan Button & Scan Prescription Button */}
          <div className="flex flex-col sm:flex-row items-stretch gap-2.5 shrink-0">
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              data-testid="scan-barcode-camera-btn"
              onClick={() => setIsCameraModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-3.5 min-h-[48px] text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-2xl shadow-md shadow-sky-600/20 hover:shadow-lg transition-all shrink-0 focus:outline-none focus:ring-4 focus:ring-sky-500/25 cursor-pointer"
            >
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span>Scan Barcode</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              data-testid="scan-prescription-btn"
              onClick={() => setIsPrescriptionModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-3.5 min-h-[48px] text-sm font-semibold text-sky-900 dark:text-sky-100 bg-sky-100/90 dark:bg-sky-950/90 hover:bg-sky-200/90 dark:hover:bg-sky-900 border border-sky-300/80 dark:border-sky-700/80 rounded-2xl shadow-sm hover:shadow-md transition-all shrink-0 focus:outline-none focus:ring-4 focus:ring-sky-500/25 cursor-pointer"
            >
              <FileText className="w-5 h-5 text-sky-700 dark:text-sky-300" aria-hidden="true" />
              <span>Scan Prescription</span>
            </motion.button>
          </div>
        </div>

        {/* Active Speech Recognition Banner */}
        {isListening && (
          <div
            data-testid="voice-search-listening-indicator"
            className="flex items-center justify-center gap-2 py-2 px-4 bg-red-50 border border-red-200 rounded-2xl text-xs font-semibold text-red-700 animate-pulse shadow-2xs"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <span>Listening for medication name (fr-FR)... Speak clearly now</span>
            <button
              type="button"
              data-testid="stop-voice-search-btn"
              onClick={stopListening}
              className="ml-2 px-2.5 py-0.5 text-[11px] font-bold text-red-800 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
            >
              Stop
            </button>
          </div>
        )}

        {/* Voice Search Error / Permission Notice */}
        {speechError && (
          <div
            role="alert"
            data-testid="voice-search-error-toast"
            className="flex items-center justify-between gap-3 p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs shadow-2xs"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">🎙️</span>
              <span>{speechError}</span>
            </div>
            <button
              type="button"
              data-testid="dismiss-voice-error-btn"
              onClick={clearSpeechError}
              className="text-amber-700 hover:text-amber-900 font-semibold px-2 py-1 rounded-md text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Subtle Quick-Search Suggestions */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400 font-medium">Quick search:</span>
          {[
            { label: 'Amoxil', value: 'Amoxil' },
            { label: 'amox', value: 'amox' },
            { label: 'Lantus SoloStar', value: 'Lantus SoloStar' },
            { label: 'Clamoxyl Equivalent', value: 'Clamoxyl Equivalent' },
            { label: 'Barcode 0300296008214', value: '0300296008214' },
          ].map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => {
                setQuery(preset.value);
                void executeSearch(preset.value, false);
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 hover:border-sky-300 hover:text-sky-700 dark:hover:text-sky-300 rounded-lg transition-all shadow-2xs backdrop-blur-xs"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {lastScannedBarcode && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-emerald-50/90 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/80 rounded-lg text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <span>Barcode scanned:</span>
            <strong className="font-mono">{lastScannedBarcode}</strong>
          </div>
        )}
      </div>

      {/* Quick Access & AI Trends Section (Top 5 Most Dispensed + Grounded AI Insight) */}
      <section
        aria-label="Quick Access & AI Trends"
        data-testid="quick-access-ai-trends-section"
        className="max-w-3xl mx-auto p-6 sm:p-7 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/80 rounded-3xl shadow-lg shadow-sky-950/5 dark:shadow-slate-950/30 space-y-5 transition-all"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200/70 dark:border-slate-700/70 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-100/90 dark:bg-sky-900/50 border border-sky-200/80 dark:border-sky-800/70 flex items-center justify-center text-sky-700 dark:text-sky-300 shrink-0">
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                Quick Access &amp; AI Trends
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Top 5 Most Dispensed medications over the last 7 days &amp; SQL-verified sales insight
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-sky-50/90 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/70 dark:border-sky-800/60 w-fit">
            Last 7 Days · Reason: dispense
          </span>
        </div>

        {/* 1. Top 5 Most Dispensed List */}
        <div className="space-y-2.5" data-testid="top-dispensed-container">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span>Top 5 Most Dispensed</span>
            <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
              Click any medication to open details &amp; dispense
            </span>
          </div>

          {topDispensed.length === 0 ? (
            <div
              data-testid="top-dispensed-empty-state"
              className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70 text-xs text-slate-600 dark:text-slate-300 text-center"
            >
              No medications dispensed in the last 7 days. Dispense stock from any medication card to
              populate your Top 5 fast-moving items here.
            </div>
          ) : (
            <div
              role="list"
              aria-label="Top 5 Most Dispensed Medications"
              data-testid="top-dispensed-list"
              className="grid grid-cols-1 gap-2"
            >
              {topDispensed.map((item, idx) => {
                const isLow = item.current_qty <= item.reorder_level;
                return (
                  <button
                    key={item.medication_id}
                    type="button"
                    role="listitem"
                    data-testid={`top-dispensed-item-${item.medication_id}`}
                    onClick={() => void handleSelectTopDispensedMedication(item.medication_id)}
                    className="w-full text-left px-4 py-3 rounded-2xl bg-white/85 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 hover:border-sky-400 dark:hover:border-sky-500/70 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 group shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-lg bg-sky-600/10 dark:bg-sky-400/15 text-sky-700 dark:text-sky-300 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                            {item.brand_name}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {item.generic_name ?? 'Standard'}
                            {item.strength ? ` · ${item.strength}` : ''}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {item.location_label}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 sm:justify-end">
                      <span
                        data-testid={`top-dispensed-qty-${item.medication_id}`}
                        className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold tabular-nums bg-sky-50 dark:bg-sky-950/80 text-sky-800 dark:text-sky-200 border border-sky-200/80 dark:border-sky-800/60"
                      >
                        {item.dispensed_7d} {item.dispensed_7d === 1 ? 'unit' : 'units'} dispensed
                      </span>
                      <span
                        className={`px-2 py-1 rounded-lg text-[11px] font-mono font-semibold tabular-nums border ${
                          isLow
                            ? 'bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60'
                            : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                        }`}
                      >
                        {item.current_qty} in stock
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. Grounded AI Trends Insight */}
        <div
          data-testid="ai-trends-insight-card"
          className="p-4 rounded-2xl bg-sky-50/80 dark:bg-slate-900/85 border border-sky-200/80 dark:border-sky-900/70 flex items-start gap-3"
        >
          <div className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                AI Sales Trend Insight
              </span>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                SQL Read-Only Grounded
              </span>
            </div>
            <p
              data-testid="ai-trends-insight-text"
              className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed"
            >
              {aiTrendInsight}
            </p>
          </div>
        </div>
      </section>

      {/* Empty State */}
      {isQueryEmpty && (
        <div
          data-testid="search-empty-state"
          className={SEARCH_SECONDARY_GLASS_CARD_CLASSES}
        >
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Ready to locate dispensary stock
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-lg mx-auto leading-relaxed">
            Begin typing a medication name above or scan a pack with your barcode reader to view its
            Zone, Shelf, and Bin location, current batch stock, and pricing.
          </p>
        </div>
      )}

      {/* No-Results State with Query Echoed Back & Global Database (RxNorm) */}
      {hasNoResults && (
        <div className="space-y-6 max-w-4xl mx-auto">
          <div
            role="status"
            data-testid="search-no-results-state"
            className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-3xl text-center space-y-2 shadow-lg shadow-sky-950/5 dark:shadow-slate-950/30"
          >
            <div className="text-base font-semibold text-slate-900 dark:text-white">
              No local medications found matching &ldquo;{searchResponse.query}&rdquo;
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              This medication is not currently recorded in your local dispensary inventory.
            </p>
          </div>

          {/* Section: Global Database (RxNorm & French BDPM) */}
          <div
            data-testid="rxnorm-section"
            className="p-6 rounded-3xl bg-white/85 dark:bg-slate-800/85 backdrop-blur-md border border-sky-200/80 dark:border-sky-800/80 shadow-xl shadow-sky-950/5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 shadow-sm ${
                  globalSource === 'bdpm' ? 'bg-emerald-600' : 'bg-sky-600'
                }`}>
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>
                      {globalSource === 'bdpm'
                        ? 'French Database (BDPM / ANSM)'
                        : 'Global Database (RxNorm)'}
                    </span>
                    {(globalSource === 'bdpm' ? isSearchingBdpm : isSearchingRxNorm) && (
                      <span className="text-xs font-normal text-sky-600 dark:text-sky-400 animate-pulse">
                        Searching catalog...
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {globalSource === 'bdpm'
                      ? 'French Public Drug Database with full composition (active ingredients + excipients)'
                      : 'Standardized drug definitions from the National Library of Medicine'}
                  </p>
                </div>
              </div>

              {/* Source Toggle (RxNorm vs BDPM) & Count */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <div
                  role="tablist"
                  aria-label="Database Source Toggle"
                  className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={globalSource === 'rxnorm'}
                    data-testid="toggle-source-rxnorm"
                    onClick={() => setGlobalSource('rxnorm')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      globalSource === 'rxnorm'
                        ? 'bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    RxNorm (US / Global)
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={globalSource === 'bdpm'}
                    data-testid="toggle-source-bdpm"
                    onClick={() => setGlobalSource('bdpm')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      globalSource === 'bdpm'
                        ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    BDPM (France / ANSM)
                  </button>
                </div>

                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-mono font-semibold bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/70 w-fit">
                  {globalSource === 'bdpm' ? bdpmResults.length : rxnormResults.length} match
                  {(globalSource === 'bdpm' ? bdpmResults.length : rxnormResults.length) === 1 ? '' : 'es'}
                </span>
              </div>
            </div>

            {/* TAB 1: RxNorm Results */}
            {globalSource === 'rxnorm' && (
              <>
                {isSearchingRxNorm ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                    <span>Searching Global Database (RxNorm) for &ldquo;{searchResponse.query}&rdquo;...</span>
                  </div>
                ) : rxnormResults.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
                    <p>No global records found in RxNorm for &ldquo;{searchResponse.query}&rdquo;.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualModalPrefill({ name: searchResponse.query, rxcui: '' });
                        setIsManualModalOpen(true);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add &ldquo;{searchResponse.query}&rdquo; Manually</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
                    {rxnormResults.map((item) => (
                      <div
                        key={item.rxcui}
                        data-testid={`rxnorm-result-${item.rxcui}`}
                        className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-all"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                              {item.name}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800">
                              RXCUI: {item.rxcui}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Not in local inventory · Review and manually set price in DA before saving
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`rxnorm-import-${item.rxcui}`}
                          disabled={isImportingRxcui === item.rxcui}
                          onClick={() => void handleImportRxNormDrug(item)}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 active:bg-sky-700 shadow-sm shrink-0 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isImportingRxcui === item.rxcui ? 'Loading...' : 'Import'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* TAB 2: French BDPM Results */}
            {globalSource === 'bdpm' && (
              <>
                {isSearchingBdpm ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span>Searching French Database (BDPM) for &ldquo;{searchResponse.query}&rdquo;...</span>
                  </div>
                ) : bdpmResults.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
                    <p>No French records found in BDPM for &ldquo;{searchResponse.query}&rdquo;.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualModalPrefill({
                          name: searchResponse.query,
                          cis: '',
                          composition: '',
                          sourceType: 'bdpm',
                        });
                        setIsManualModalOpen(true);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add &ldquo;{searchResponse.query}&rdquo; Manually</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
                    {bdpmResults.map((item) => (
                      <div
                        key={item.cis}
                        data-testid={`bdpm-result-${item.cis}`}
                        className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-all"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                              {item.name}
                            </span>
                            <span
                              data-testid={`bdpm-cis-${item.cis}`}
                              className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800"
                            >
                              CIS: {item.cis}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            French Public Drug Database (BDPM) · Active substance &amp; excipient composition available
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`bdpm-import-${item.cis}`}
                          disabled={isImportingCis === item.cis}
                          onClick={() => void handleImportBdpmDrug(item)}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 shadow-sm shrink-0 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isImportingCis === item.cis ? 'Loading Composition...' : 'Import'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Search Results List */}
      {!isQueryEmpty && searchResponse.results.length > 0 && (
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-xl shadow-2xs">
            <span>
              Showing <strong className="text-slate-900 dark:text-white">{searchResponse.results.length}</strong>{' '}
              matching medication{searchResponse.results.length === 1 ? '' : 's'} for{' '}
              <strong className="text-slate-900 dark:text-white">&ldquo;{searchResponse.query}&rdquo;</strong>
            </span>
            <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              {searchResponse.elapsedMs.toFixed(1)} ms · Click any item for details &amp; dispensing
            </span>
          </div>

          <div className="space-y-3.5" role="list" aria-label="Search Results">
            {searchResponse.results.map((item) => {
              const { medication } = item;
              const isLowStock = isEligibleForGenericSubstitution(
                item.totalStock,
                medication.reorder_level,
              );

              return (
                <button
                  key={medication.id}
                  type="button"
                  role="listitem"
                  data-testid={`search-result-item-${medication.id}`}
                  onClick={() => void handleSelectResultItem(item)}
                  className={SEARCH_RESULT_GLASS_CARD_CLASSES}
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    {/* Left: HUGE Physical Location + Medication Identity */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                          Physical Location
                        </span>
                        {medication.location_note && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            · {medication.location_note}
                          </span>
                        )}
                      </div>

                      {/* HUGE, Bold Location Text */}
                      <div
                        data-testid={`result-location-${medication.id}`}
                        className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:text-sky-400 transition-colors"
                      >
                        {item.locationDisplay}
                      </div>

                      {/* Brand Name, Generic, Strength, Form */}
                      <div className="pt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-base font-bold text-slate-900 dark:text-white">
                          {medication.brand_name}
                        </span>
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                          {medication.generic_name ?? 'Standard'}
                        </span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          · {medication.strength ?? '—'} · {medication.dosage_form ?? '—'}
                        </span>
                      </div>
                    </div>

                    {/* Right: Calming Stock Indicator & Price */}
                    <div className="flex sm:flex-row md:flex-col items-start md:items-end justify-between gap-2 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                      {isLowStock ? (
                        <div className="flex flex-col items-start md:items-end gap-1.5">
                          <motion.div
                            data-testid={`search-low-stock-badge-${medication.id}`}
                            animate={LOW_STOCK_BADGE_PULSE_ANIMATE}
                            transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60"
                          >
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="font-mono tabular-nums">{item.totalStock} units</span>
                            <span>Low Stock</span>
                          </motion.div>

                          <span
                            role="button"
                            tabIndex={0}
                            data-testid={`search-find-generic-btn-${medication.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleFindGenericFromSearch(item);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                void handleFindGenericFromSearch(item);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/80 hover:bg-sky-100 dark:hover:bg-sky-900/80 border border-sky-200 dark:border-sky-800 transition-colors cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                            <span>
                              {findingGenericMedId === medication.id
                                ? 'Searching generics...'
                                : 'Find Generic Equivalent'}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="font-mono tabular-nums">{item.totalStock} units</span>
                          <span>In Stock</span>
                        </div>
                      )}

                      <div className="text-right">
                        <div
                          className={`text-sm font-bold font-mono tabular-nums ${
                            medication.unit_price_cents === null
                              ? 'text-red-600 dark:text-red-400'
                              : medication.price_confirmed === 0
                                ? 'text-slate-400 dark:text-slate-500 line-through'
                                : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {formatMoneyDisplay(
                            medication.unit_price_cents,
                            medication.currency_code || medication.currency,
                          )}
                        </div>
                        <div className="text-[11px] text-sky-600 dark:text-sky-400 font-medium mt-0.5 group-hover:underline">
                          View details &amp; dispense &rarr;
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Generic Substitution Modal (from Search Results List) */}
      {genericModalResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Generic equivalents for ${genericModalResult.sourceBrandName}`}
          data-testid="search-generic-substitution-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setGenericModalResult(null);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3.5">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generic Substitution</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Alternatives for {genericModalResult.sourceBrandName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Active molecule (DCI):{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {genericModalResult.resolvedGenericName ?? 'Unknown'}
                  </strong>
                  {genericModalResult.inferredByAi ? ' (inferred by AI Assistant)' : ''}
                </p>
              </div>
              <button
                type="button"
                data-testid="close-generic-modal-btn"
                onClick={() => setGenericModalResult(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>

            {genericModalResult.equivalents.length === 0 ? (
              <div
                data-testid="search-generic-empty-message"
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 text-center"
              >
                No generic equivalent in stock.
              </div>
            ) : (
              <div className="space-y-2.5">
                <div
                  data-testid="search-generic-summary-heading"
                  className="text-xs font-bold text-slate-900 dark:text-white"
                >
                  Generics available in stock:
                </div>
                <ul
                  data-testid="search-generic-list"
                  className="space-y-2 max-h-64 overflow-y-auto pr-1"
                >
                  {genericModalResult.equivalents.map((eq) => (
                    <li
                      key={eq.medicationId}
                      data-testid={`search-generic-item-${eq.medicationId}`}
                      className="p-3 rounded-xl bg-sky-50/70 dark:bg-slate-800/90 border border-sky-200/80 dark:border-sky-800/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                    >
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {eq.formattedLine}
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        Available alternative
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Read-only lookup · Medication and stock are not automatically modified.</span>
            </div>
          </div>
        </div>
      )}

      {/* Camera Barcode Scanner Modal */}
      <BarcodeCameraModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onDetected={handleCameraBarcodeDetected}
      />

      {/* AI Vision Prescription Scanner Modal */}
      <ScanPrescriptionModal
        isOpen={isPrescriptionModalOpen}
        onClose={() => setIsPrescriptionModalOpen(false)}
        onSelectMedication={onSelectMedication}
        onDatabaseMutated={async () => {
          await onDatabaseMutated?.();
          await loadQuickAccessTrends();
          if (query.trim().length > 0) {
            await executeSearch(query, false);
          }
        }}
      />

      {/* Manual Medication Entry / RxNorm Review & Import Modal */}
      <ManualMedicationModal
        isOpen={isManualModalOpen}
        onClose={() => {
          setIsManualModalOpen(false);
          setManualModalPrefill(null);
        }}
        prefill={manualModalPrefill}
        onMedicationSaved={async (newMedId) => {
          if (onDatabaseMutated) {
            await onDatabaseMutated();
          }
          await loadQuickAccessTrends();
          if (query.trim().length > 0) {
            await executeSearch(query, false);
          }
          const db = getRepositoryDatabase();
          const detail = await getMedicationDetailForSearch(db, newMedId);
          onSelectMedication(newMedId, detail);
        }}
        onDatabaseMutated={onDatabaseMutated}
      />
    </section>
  );
}
