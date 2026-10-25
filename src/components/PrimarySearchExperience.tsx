import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getRepositoryDatabase } from '../db/repository';
import { formatMoneyDisplay } from '../pricing';
import {
  getMedicationDetailForSearch,
  searchMedications,
  type LayeredSearchResponse,
  type SearchMedicationDetail,
  type SearchResultItem,
} from '../search';

interface PrimarySearchExperienceProps {
  totalCatalogCount: number;
  refreshTrigger?: unknown;
  onSelectMedication: (medicationId: number, preloadedDetail?: SearchMedicationDetail | null) => void;
}

export function PrimarySearchExperience({
  totalCatalogCount,
  refreshTrigger,
  onSelectMedication,
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
      try {
        const db = getRepositoryDatabase();
        const res = await searchMedications(db, nextQuery);
        setSearchResponse(res);

        if (res.results.length > 0 && (autoOpenFirstResult || res.matchedLayer === 'barcode_exact')) {
          const freshDetail = await getMedicationDetailForSearch(db, res.results[0].medication.id);
          onSelectMedication(res.results[0].medication.id, freshDetail);
        }
      } catch {
        // Ignore transient pre-init calls
      }
    },
    [onSelectMedication],
  );

  // Re-run current search when catalog/stock mutates so stock & price numbers stay live
  useEffect(() => {
    if (query.trim().length > 0) {
      void executeSearch(query, false);
    }
  }, [refreshTrigger]);

  const routeToBarcodeSearch = useCallback(
    async (rawBarcode: string) => {
      const cleaned = rawBarcode.trim();
      if (!cleaned) return;
      setLastScannedBarcode(cleaned);
      setQuery(cleaned);
      await executeSearch(cleaned, true);
    },
    [executeSearch],
  );

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

      {/* Centered Hero Search Section */}
      <div className="max-w-3xl mx-auto text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Find Any Medication Instantly
          </h1>
          <p className="text-sm sm:text-base text-slate-500">
            Type a brand name, generic ingredient, or scan a barcode to see exact shelf and bin
            coordinates across {totalCatalogCount.toLocaleString()} medications.
          </p>
        </div>

        {/* Massive Google-Style Search Bar */}
        <div className="relative">
          <label htmlFor="primary-medication-search-input" className="sr-only">
            Search medications by name, generic ingredient, or barcode
          </label>
          <div className="relative flex items-center bg-white border border-slate-200/90 rounded-2xl shadow-lg shadow-slate-900/5 focus-within:border-sky-500 focus-within:ring-4 focus-within:ring-sky-500/15 transition-all">
            <div className="pl-5 pr-3 text-slate-400 pointer-events-none">
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
            <input
              ref={searchInputRef}
              id="primary-medication-search-input"
              data-testid="primary-medication-search-input"
              type="search"
              autoFocus
              value={query}
              onChange={handleQueryChange}
              placeholder="Search medication brand, generic name, or scan barcode..."
              className="w-full py-4 sm:py-5 pr-4 text-lg sm:text-xl font-medium text-slate-900 bg-transparent placeholder:text-slate-400 focus:outline-none"
            />
            {!isQueryEmpty && (
              <div className="pr-4 flex items-center gap-2 shrink-0">
                <button
                  type="button"
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
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Subtle Quick-Search Suggestions */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">Quick search:</span>
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
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200/90 rounded-lg hover:border-sky-300 hover:text-sky-700 hover:bg-sky-50/40 transition-colors shadow-2xs"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {lastScannedBarcode && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-800">
            <span>Barcode scanned:</span>
            <strong className="font-mono">{lastScannedBarcode}</strong>
          </div>
        )}
      </div>

      {/* Empty State */}
      {isQueryEmpty && (
        <div
          data-testid="search-empty-state"
          className="max-w-3xl mx-auto p-8 bg-white border border-slate-200/80 rounded-2xl text-center space-y-2 shadow-2xs"
        >
          <div className="text-sm font-semibold text-slate-800">
            Ready to locate dispensary stock
          </div>
          <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
            Begin typing a medication name above or scan a pack with your barcode reader to view its
            Zone, Shelf, and Bin location, current batch stock, and pricing.
          </p>
        </div>
      )}

      {/* No-Results State with Query Echoed Back */}
      {hasNoResults && (
        <div
          role="status"
          data-testid="search-no-results-state"
          className="max-w-3xl mx-auto p-8 bg-white border border-amber-200 rounded-2xl text-center space-y-2 shadow-2xs"
        >
          <div className="text-base font-semibold text-slate-900">
            No medications found matching &ldquo;{searchResponse.query}&rdquo;
          </div>
          <p className="text-xs text-slate-500">
            Check the spelling of <strong className="text-slate-700">&ldquo;{searchResponse.query}&rdquo;</strong> or
            scan the package barcode directly.
          </p>
        </div>
      )}

      {/* Search Results List */}
      {!isQueryEmpty && searchResponse.results.length > 0 && (
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-800">{searchResponse.results.length}</strong>{' '}
              matching medication{searchResponse.results.length === 1 ? '' : 's'} for{' '}
              <strong className="text-slate-800">&ldquo;{searchResponse.query}&rdquo;</strong>
            </span>
            <span className="font-mono text-slate-400 tabular-nums">
              {searchResponse.elapsedMs.toFixed(1)} ms · Click any item for details &amp; dispensing
            </span>
          </div>

          <div className="space-y-3.5" role="list" aria-label="Search Results">
            {searchResponse.results.map((item) => {
              const { medication } = item;
              const isLowStock = item.totalStock <= medication.reorder_level;

              return (
                <button
                  key={medication.id}
                  type="button"
                  role="listitem"
                  data-testid={`search-result-item-${medication.id}`}
                  onClick={() => void handleSelectResultItem(item)}
                  className="w-full text-left p-6 bg-white border border-slate-200/90 rounded-2xl shadow-xs hover:border-sky-400 hover:shadow-md transition-all group"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    {/* Left: HUGE Physical Location + Medication Identity */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-600">
                          Physical Location
                        </span>
                        {medication.location_note && (
                          <span className="text-xs text-slate-500">
                            · {medication.location_note}
                          </span>
                        )}
                      </div>

                      {/* HUGE, Bold Location Text */}
                      <div
                        data-testid={`result-location-${medication.id}`}
                        className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-slate-900 group-hover:text-sky-700 transition-colors"
                      >
                        {item.locationDisplay}
                      </div>

                      {/* Brand Name, Generic, Strength, Form */}
                      <div className="pt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-base font-bold text-slate-900">
                          {medication.brand_name}
                        </span>
                        <span className="text-sm font-medium text-slate-600">
                          {medication.generic_name ?? 'Standard'}
                        </span>
                        <span className="text-sm text-slate-500">
                          · {medication.strength ?? '—'} · {medication.dosage_form ?? '—'}
                        </span>
                      </div>
                    </div>

                    {/* Right: Calming Stock Indicator & Price */}
                    <div className="flex sm:flex-row md:flex-col items-start md:items-end justify-between gap-2 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                      <div
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          isLowStock
                            ? 'bg-orange-50 text-orange-800 border border-orange-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isLowStock ? 'bg-orange-500' : 'bg-emerald-500'
                          }`}
                        />
                        <span className="font-mono tabular-nums">{item.totalStock} units</span>
                        <span>{isLowStock ? 'Low Stock' : 'In Stock'}</span>
                      </div>

                      <div className="text-right">
                        <div
                          className={`text-sm font-bold font-mono tabular-nums ${
                            medication.unit_price_cents === null
                              ? 'text-red-600'
                              : medication.price_confirmed === 0
                                ? 'text-slate-400 line-through'
                                : 'text-slate-800'
                          }`}
                        >
                          {formatMoneyDisplay(medication.unit_price_cents, medication.currency)}
                        </div>
                        <div className="text-[11px] text-sky-600 font-medium mt-0.5 group-hover:underline">
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
    </section>
  );
}
