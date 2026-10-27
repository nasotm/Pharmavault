import React, { useEffect, useMemo, useState } from 'react';
import { getRepositoryDatabase } from '../db/repository';
import {
  autoSuggestColumnMapping,
  buildCatalogOnlySampleCsv,
  buildOfficialTariff10RowCsv,
  buildPharmacy50RowCsv,
  CATALOG_FIELDS,
  executeBulkImport,
  IMPORT_SOURCE_TYPES,
  INVENTORY_FIELDS,
  listMappingProfiles,
  parseCsvDocument,
  prepareBulkImportPreview,
  PRICE_FIELDS,
  saveMappingProfile,
  TARGET_FIELD_BY_KEY,
  type BulkImportExecutionResult,
  type BulkImportPreviewResult,
  type ColumnMapping,
  type DataLayerGroup,
  type DuplicateResolutionAction,
  type ImportSourceType,
  type SavedMappingProfile,
  type TargetFieldDescriptor,
  type TargetFieldKey,
} from '../import';

import { formatCentsToMajor } from '../pricing';

interface BulkImportFlowProps {
  onImportCommitted: () => Promise<void>;
  onOpenAlgerianImport?: () => void;
}

function formatCents(cents: number | null): string {
  if (cents === null) return 'price not entered (NULL)';
  return `${cents} ¢ ($${formatCentsToMajor(cents)})`;
}

export function BulkImportFlow({ onImportCommitted, onOpenAlgerianImport }: BulkImportFlowProps) {
  const [sourceFileName, setSourceFileName] = useState<string>('pharmacy_50_rows.csv');
  const [csvText, setCsvText] = useState<string>(() => buildPharmacy50RowCsv());
  const [hasHeaderRow, setHasHeaderRow] = useState<boolean>(true);
  const [sourceType, setSourceType] = useState<ImportSourceType>('pharmacy_spreadsheet');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [profileNameInput, setProfileNameInput] = useState<string>('Standard Pharmacy Sheet');
  const [savedProfiles, setSavedProfiles] = useState<SavedMappingProfile[]>(() =>
    listMappingProfiles(),
  );
  const [profileStatusMessage, setProfileStatusMessage] = useState<string | null>(null);

  const [duplicateResolutions, setDuplicateResolutions] = useState<
    Record<number, DuplicateResolutionAction>
  >({});
  const [previewResult, setPreviewResult] = useState<BulkImportPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<BulkImportExecutionResult | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const parsedCsv = useMemo(
    () => parseCsvDocument(csvText, { hasHeaderRow }),
    [csvText, hasHeaderRow],
  );

  // Auto-suggest initial column mapping whenever CSV columns change
  useEffect(() => {
    const existingProfilesForFile = listMappingProfiles(sourceFileName);
    if (existingProfilesForFile.length > 0) {
      setMapping(existingProfilesForFile[0].mapping);
      setProfileNameInput(existingProfilesForFile[0].profileName);
    } else {
      setMapping(autoSuggestColumnMapping(parsedCsv.columns));
    }
    setDuplicateResolutions({});
    setCommitResult(null);
  }, [parsedCsv.columns, sourceFileName]);

  // Run dry-run preview automatically whenever CSV, mapping, sourceType, or duplicateResolutions change
  useEffect(() => {
    let cancelled = false;
    async function runDryRun() {
      try {
        const db = getRepositoryDatabase();
        const preview = await prepareBulkImportPreview(db, {
          parsedCsv,
          mapping,
          sourceType,
          duplicateResolutions,
        });
        if (!cancelled) {
          setPreviewResult(preview);
          setErrorBanner(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorBanner(err instanceof Error ? err.message : String(err));
        }
      }
    }
    runDryRun();
    return () => {
      cancelled = true;
    };
  }, [parsedCsv, mapping, sourceType, duplicateResolutions]);

  // Map each CSV column index back to the target field & layer so every CSV column is labeled with its layer
  const columnLayerByIndex = useMemo(() => {
    const map = new Map<number, { field: TargetFieldKey; layer: DataLayerGroup }>();
    for (const [fieldKey, colIndex] of Object.entries(mapping)) {
      if (typeof colIndex === 'number' && colIndex >= 0) {
        const descriptor = TARGET_FIELD_BY_KEY[fieldKey as TargetFieldKey];
        if (descriptor) {
          map.set(colIndex, { field: descriptor.key, layer: descriptor.layer });
        }
      }
    }
    return map;
  }, [mapping]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSourceFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setCsvText(content);
      setProfileStatusMessage(null);
    };
    reader.readAsText(file);
  };

  const handleLoadSamplePreset = (preset: 'pharmacy_50' | 'tariff_10' | 'catalog_5') => {
    setProfileStatusMessage(null);
    setCommitResult(null);
    setDuplicateResolutions({});
    if (preset === 'pharmacy_50') {
      setSourceFileName('pharmacy_50_rows.csv');
      setSourceType('pharmacy_spreadsheet');
      setHasHeaderRow(true);
      setCsvText(buildPharmacy50RowCsv());
      setProfileNameInput('Pharmacy 50-Row Profile');
    } else if (preset === 'tariff_10') {
      setSourceFileName('official_tariff_10_rows.csv');
      setSourceType('official_tariff');
      setHasHeaderRow(true);
      setCsvText(buildOfficialTariff10RowCsv());
      setProfileNameInput('Official Tariff 10-Row Profile');
    } else {
      setSourceFileName('reference_catalog_5_rows.csv');
      setSourceType('catalog_only');
      setHasHeaderRow(true);
      setCsvText(buildCatalogOnlySampleCsv());
      setProfileNameInput('Catalog Reference Profile');
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = saveMappingProfile({
      profileName: profileNameInput,
      sourceFileName,
      hasHeaderRow,
      mapping,
    });
    setSavedProfiles(listMappingProfiles());
    setProfileStatusMessage(
      `Saved profile "${saved.profileName}" for source file "${saved.sourceFileName}".`,
    );
  };

  const handleLoadProfile = (profile: SavedMappingProfile) => {
    setHasHeaderRow(profile.hasHeaderRow);
    setMapping({ ...profile.mapping });
    setProfileNameInput(profile.profileName);
    setProfileStatusMessage(`Loaded profile "${profile.profileName}" (${profile.sourceFileName}).`);
  };

  const handleFieldMappingChange = (fieldKey: TargetFieldKey, rawValue: string) => {
    const nextIndex = rawValue === '' ? null : Number(rawValue);
    setMapping((prev) => ({
      ...prev,
      [fieldKey]: nextIndex,
    }));
    setCommitResult(null);
  };

  const handleResolutionChange = (rowNumber: number, resolution: DuplicateResolutionAction) => {
    setDuplicateResolutions((prev) => ({
      ...prev,
      [rowNumber]: resolution,
    }));
    setCommitResult(null);
  };

  const handleExecuteImport = async (dryRun: boolean) => {
    setIsBusy(true);
    setErrorBanner(null);
    try {
      const db = getRepositoryDatabase();
      const result = await executeBulkImport(db, {
        parsedCsv,
        mapping,
        sourceType,
        duplicateResolutions,
        dryRun,
      });
      setPreviewResult(result);
      if (!dryRun) {
        setCommitResult(result);
        await onImportCommitted();
      }
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const renderFieldGroupCard = (
    groupTitle: string,
    layerCode: DataLayerGroup,
    subtitle: string,
    fields: readonly TargetFieldDescriptor[],
    disabledOverlayMessage?: string,
  ) => (
    <div className="bg-slate-50/70 border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="border-b border-slate-200 pb-2.5 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{groupTitle}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-xs font-mono font-semibold text-slate-700 shrink-0">
          LAYER: {layerCode}
        </span>
      </div>

      {disabledOverlayMessage && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
          {disabledOverlayMessage}
        </div>
      )}

      <div className="space-y-2.5">
        {fields.map((field) => {
          const selectedColIdx = mapping[field.key];
          const samplePreview =
            typeof selectedColIdx === 'number' && parsedCsv.columns[selectedColIdx]
              ? parsedCsv.columns[selectedColIdx].sampleValues.slice(0, 2).join(', ')
              : '—';

          return (
            <div key={field.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor={`map-field-${field.key}`}
                  className="font-mono font-medium text-slate-800"
                >
                  {field.label}
                  {field.required ? ' *' : ''}
                </label>
                <span className="text-slate-500 truncate max-w-[180px]" title={samplePreview}>
                  Sample: <span className="font-mono text-slate-700">{samplePreview}</span>
                </span>
              </div>
              <select
                id={`map-field-${field.key}`}
                aria-label={`Map ${field.label} (${layerCode})`}
                value={
                  selectedColIdx !== null && selectedColIdx !== undefined
                    ? String(selectedColIdx)
                    : ''
                }
                onChange={(e) => handleFieldMappingChange(field.key, e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">-- Unmapped --</option>
                {parsedCsv.columns.map((col) => (
                  <option key={col.index} value={String(col.index)}>
                    {col.displayLabel} [{layerCode}]
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <section
      id="bulk-import-flow"
      aria-label="Bulk CSV Import Flow"
      className="bg-white border border-slate-200 rounded-lg p-6 space-y-8"
    >
      {/* Header & Quick Acceptance Dataset Presets */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            3-Layer Bulk Spreadsheet Importer (Catalog · Inventory · Price)
          </h2>
          <p className="mt-1 text-xs text-slate-600 max-w-3xl">
            Header-agnostic CSV parser with 3-layer column mapping, RapidFuzz{' '}
            <code className="font-mono">WRatio &gt; 85</code> brand duplicate detection, dry-run
            validation, and single-transaction persistence via{' '}
            <code className="font-mono">DatabasePort</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleLoadSamplePreset('pharmacy_50')}
            className="px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Load 50-Row Pharmacy CSV
          </button>
          <button
            type="button"
            onClick={() => handleLoadSamplePreset('tariff_10')}
            className="px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Load 10-Row Tariff CSV
          </button>
          <button
            type="button"
            onClick={() => handleLoadSamplePreset('catalog_5')}
            className="px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Load Catalog-Only CSV
          </button>
          {onOpenAlgerianImport && (
            <button
              type="button"
              data-testid="open-algerian-import-from-bulk-btn"
              onClick={onOpenAlgerianImport}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 border border-emerald-600 rounded-md hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              + Import Algerian CSV (DCI Link)
            </button>
          )}
        </div>
      </div>

      {errorBanner && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-md text-xs text-red-800"
        >
          {errorBanner}
        </div>
      )}

      {/* STEP 1: CSV Upload & Source-Type Selector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Step 1. CSV Upload &amp; Source-Type Selection
          </h3>

          <div>
            <label
              htmlFor="csv-file-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Upload Spreadsheet (.csv)
            </label>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="block w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-300 file:text-xs file:font-medium file:bg-slate-50 file:text-slate-800 hover:file:bg-slate-100"
            />
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>
                Active Source File:{' '}
                <strong className="font-mono text-slate-900">{sourceFileName}</strong>
              </span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasHeaderRow}
                  onChange={(e) => setHasHeaderRow(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900"
                />
                First row is header
              </label>
            </div>
          </div>

          {/* Source-Type Selector */}
          <fieldset className="space-y-2 pt-2">
            <legend className="text-xs font-semibold text-slate-800">
              Source Type Selector (Determines Price &amp; Batch Rules)
            </legend>
            {IMPORT_SOURCE_TYPES.map((st) => {
              const active = sourceType === st.value;
              return (
                <label
                  key={st.value}
                  className={`block p-3 border rounded-md cursor-pointer transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <input
                        type="radio"
                        name="import-source-type"
                        value={st.value}
                        checked={active}
                        onChange={() => {
                          setSourceType(st.value);
                          setCommitResult(null);
                        }}
                        className="text-slate-900 focus:ring-slate-900"
                      />
                      {st.label}
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      {st.mappedPriceSource
                        ? `source='${st.mappedPriceSource}' · confirmed=0`
                        : 'no prices · no batches'}
                    </span>
                  </div>
                  <p className="mt-1 pl-5 text-xs text-slate-600">{st.description}</p>
                </label>
              );
            })}
          </fieldset>
        </div>

        {/* Raw CSV Editor & Detected Columns */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="raw-csv-editor" className="text-xs font-semibold text-slate-800">
              Raw CSV Buffer ({parsedCsv.rows.length} data rows · {parsedCsv.columns.length} columns
              detected)
            </label>
            <span className="text-xs font-mono text-slate-500">
              Delimiter: {parsedCsv.delimiter === '\t' ? 'TAB' : `"${parsedCsv.delimiter}"`}
            </span>
          </div>
          <textarea
            id="raw-csv-editor"
            rows={7}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setCommitResult(null);
            }}
            className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
          />

          {/* Detected Columns with Layer Labels */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-700">
              Detected Source Columns &amp; Assigned Layer Labels
            </div>
            <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 text-xs font-mono">
              {parsedCsv.columns.map((col) => {
                const assigned = columnLayerByIndex.get(col.index);
                return (
                  <div
                    key={col.index}
                    className="px-3 py-1.5 flex items-center justify-between gap-4"
                  >
                    <span className="text-slate-800 truncate">{col.displayLabel}</span>
                    <span className="text-slate-500 truncate">
                      {assigned ? `${assigned.layer} -> ${assigned.field}` : 'UNMAPPED'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* STEP 2: Column Mapping Grouped into 3 Layers + Named Profile Persistence */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Step 2. Column Mapping by Data Layer (CATALOG · INVENTORY · PRICE)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Map your spreadsheet columns to our 3-layer schema fields and save as a reusable named
              profile per source file.
            </p>
          </div>

          <form onSubmit={handleSaveProfile} className="flex flex-wrap items-center gap-2">
            <label htmlFor="mapping-profile-name" className="sr-only">
              Mapping Profile Name
            </label>
            <input
              id="mapping-profile-name"
              type="text"
              value={profileNameInput}
              onChange={(e) => setProfileNameInput(e.target.value)}
              placeholder="Profile name..."
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Save Mapping Profile
            </button>
          </form>
        </div>

        {profileStatusMessage && (
          <div
            role="status"
            className="p-2.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800"
          >
            {profileStatusMessage}
          </div>
        )}

        {savedProfiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Saved Mapping Profiles:</span>
            {savedProfiles.map((prof) => (
              <button
                key={prof.id}
                type="button"
                onClick={() => handleLoadProfile(prof)}
                className="px-2.5 py-1 text-xs font-mono text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200 whitespace-nowrap shrink-0"
              >
                {prof.profileName} ({prof.sourceFileName})
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {renderFieldGroupCard(
            '1. CATALOG Layer',
            'CATALOG',
            'Reference product identity (normalized & deduplicated)',
            CATALOG_FIELDS,
          )}
          {renderFieldGroupCard(
            '2. INVENTORY Layer',
            'INVENTORY',
            'Dispensary bin coordinates & batch quantities',
            INVENTORY_FIELDS,
            sourceType === 'catalog_only'
              ? 'Catalog-only mode active: batch rows (quantity, lot_number, expiry_date) will NOT be created.'
              : undefined,
          )}
          {renderFieldGroupCard(
            '3. PRICE Layer',
            'PRICE',
            'Parsed to integer cents; always price_confirmed = 0 on import',
            PRICE_FIELDS,
            sourceType === 'catalog_only'
              ? 'Catalog-only mode active: all price columns are ignored.'
              : undefined,
          )}
        </div>
      </div>

      {/* STEP 3: Fuzzy Duplicate Detection (WRatio > 85) Side-by-Side Resolution */}
      {previewResult && (
        <div className="space-y-6 pt-4 border-t border-slate-200">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Step 3. Dry-Run Preview, Fuzzy Duplicate Review &amp; Per-Row Error Report
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Probable duplicates (<code className="font-mono">rapidfuzz WRatio &gt; 85</code> on
                normalized <code className="font-mono">brand_name</code>) are shown side-by-side for
                Merge or Keep Separate decision.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleExecuteImport(true)}
                className="px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                Run Dry-Run Preview
              </button>
              <button
                type="button"
                disabled={isBusy || previewResult.validRowCount === 0}
                onClick={() => handleExecuteImport(false)}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                Commit Import Transaction ({previewResult.validRowCount} Valid Rows)
              </button>
            </div>
          </div>

          {/* Dry-Run Summary Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono tabular-nums">
            <div>
              <div className="text-xs font-sans text-slate-500">Total CSV Rows</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {previewResult.totalRows}
              </div>
            </div>
            <div>
              <div className="text-xs font-sans text-slate-500">Valid Rows Ready</div>
              <div className="mt-1 text-xl font-semibold text-emerald-700">
                {previewResult.validRowCount}
              </div>
              <div className="text-xs font-sans text-slate-500">
                {previewResult.summary.medicationsToInsert} new ·{' '}
                {previewResult.summary.medicationsToUpdate} update
              </div>
            </div>
            <div>
              <div className="text-xs font-sans text-slate-500">Total Issues Found</div>
              <div className="mt-1 text-xl font-semibold text-red-700">
                {previewResult.errorCount}
              </div>
              <div className="text-xs font-sans text-slate-500">
                {previewResult.summary.duplicateIssueCount} dup ·{' '}
                {previewResult.summary.badPriceIssueCount} price ·{' '}
                {previewResult.summary.missingBarcodeIssueCount} barcode
              </div>
            </div>
            <div>
              <div className="text-xs font-sans text-slate-500">Batches to Write</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {previewResult.summary.batchesToWrite}
              </div>
              <div className="text-xs font-sans text-slate-500">
                {sourceType === 'catalog_only' ? 'Disabled (Catalog Only)' : 'Idempotent upsert'}
              </div>
            </div>
            <div>
              <div className="text-xs font-sans text-slate-500">price_history Rows</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {previewResult.summary.priceHistoryToAppend}
              </div>
              <div className="text-xs font-sans text-slate-500">Appended in transaction</div>
            </div>
            <div>
              <div className="text-xs font-sans text-slate-500">Confirmation State</div>
              <div className="mt-1 text-xl font-semibold text-amber-700">price_confirmed = 0</div>
              <div className="text-xs font-sans text-slate-500">Never confirmed on import</div>
            </div>
          </div>

          {/* Side-by-Side Probable Duplicates Review */}
          {previewResult.duplicates.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-800">
                Probable Brand Duplicates Side-by-Side Review ({previewResult.duplicates.length}{' '}
                detected via <code className="font-mono">WRatio &gt; 85</code>)
              </h4>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {previewResult.duplicates.map((dup) => (
                  <div
                    key={dup.id}
                    className="border border-amber-300 bg-amber-50/40 rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs border-b border-amber-200 pb-2">
                      <span className="font-semibold text-slate-900">CSV Row #{dup.rowNumber}</span>
                      <span className="font-mono text-amber-900 font-semibold tabular-nums">
                        WRatio: {dup.wRatioScore.toFixed(1)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-2.5 bg-white border border-slate-200 rounded">
                        <div className="text-slate-500 font-medium">
                          Incoming Row #{dup.rowNumber}
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {dup.incomingBrandNormalized}
                        </div>
                        <div className="text-slate-500 font-mono mt-0.5">
                          Raw: &quot;{dup.incomingBrandRaw}&quot;
                        </div>
                        <div className="text-slate-600 mt-1">
                          {dup.incomingSnapshot.strength ?? '—'} ·{' '}
                          {dup.incomingSnapshot.dosage_form ?? '—'}
                        </div>
                        <div className="font-mono text-slate-600 mt-0.5">
                          Barcode: {dup.incomingSnapshot.barcode ?? 'NULL'}
                        </div>
                      </div>

                      <div className="p-2.5 bg-white border border-slate-200 rounded">
                        <div className="text-slate-500 font-medium">
                          {dup.matchOrigin === 'csv_row'
                            ? `Matched CSV Row #${dup.matchedRowNumber}`
                            : `Existing DB #${dup.matchedMedicationId}`}
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {dup.matchedBrandNormalized}
                        </div>
                        <div className="text-slate-600 mt-1">
                          {dup.matchedSnapshot.strength ?? '—'} ·{' '}
                          {dup.matchedSnapshot.dosage_form ?? '—'}
                        </div>
                        <div className="font-mono text-slate-600 mt-0.5">
                          Barcode: {dup.matchedSnapshot.barcode ?? 'NULL'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-slate-600">Resolution:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleResolutionChange(dup.rowNumber, 'merge')}
                          className={`px-2.5 py-1 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${
                            dup.resolution === 'merge'
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          Merge (Skip Duplicate)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolutionChange(dup.rowNumber, 'keep_separate')}
                          className={`px-2.5 py-1 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${
                            dup.resolution === 'keep_separate'
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          Keep Separate
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-Row Error & Issue Report */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-800">
              Per-Row Error &amp; Validation Report ({previewResult.issues.length} issue(s)
              collected — non-fatal to valid rows)
            </h4>
            {previewResult.issues.length === 0 ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800">
                Zero validation or duplicate issues detected across all {previewResult.totalRows}{' '}
                rows.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Row #</th>
                      <th className="py-2 px-3">Issue Code</th>
                      <th className="py-2 px-3">Field</th>
                      <th className="py-2 px-3">Raw Value</th>
                      <th className="py-2 px-3">Diagnostic Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {previewResult.issues.map((issue, idx) => (
                      <tr key={`${issue.rowNumber}-${issue.code}-${idx}`} className="bg-red-50/30">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          Row #{issue.rowNumber}
                        </td>
                        <td className="py-2 px-3 text-red-700 font-semibold">{issue.code}</td>
                        <td className="py-2 px-3 text-slate-700">{issue.field}</td>
                        <td className="py-2 px-3 text-slate-600">
                          {issue.rawValue === '' ? '(empty)' : `"${issue.rawValue}"`}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-800">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Commit Result Banner */}
          {commitResult && !commitResult.dryRun && (
            <div
              role="status"
              data-testid="bulk-import-commit-banner"
              className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg text-xs text-emerald-900 space-y-1"
            >
              <div className="font-semibold text-sm">
                Transactional Import Committed Successfully
              </div>
              <div>
                Processed <strong>{commitResult.totalRows}</strong> rows: imported{' '}
                <strong>{commitResult.importedCount}</strong> medications (
                <strong>{commitResult.insertedMedicationCount}</strong> inserted,{' '}
                <strong>{commitResult.updatedMedicationCount}</strong> updated), wrote{' '}
                <strong>{commitResult.batchesWrittenCount}</strong> batch record(s), appended{' '}
                <strong>{commitResult.priceHistoryWrittenCount}</strong>{' '}
                <code className="font-mono">price_history</code> row(s), and isolated{' '}
                <strong>{commitResult.errorCount}</strong> per-row issue(s). All imported prices
                have <code className="font-mono">price_confirmed = 0</code>.
              </div>
            </div>
          )}

          {/* Dry-Run Valid Rows Table Preview */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-800">
              Dry-Run Valid Rows Preview (Showing first 15 of {previewResult.validRows.length} valid
              rows)
            </h4>
            <div className="border border-slate-200 rounded-md overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Operation</th>
                    <th className="py-2 px-3">Normalized Brand (Layer 1)</th>
                    <th className="py-2 px-3">Barcode</th>
                    <th className="py-2 px-3 text-right">Batch Qty (Layer 2)</th>
                    <th className="py-2 px-3 text-right">Unit Price Cents (Layer 3)</th>
                    <th className="py-2 px-3">Price Ledger Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                  {previewResult.validRows.slice(0, 15).map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="py-2 px-3">#{r.rowNumber}</td>
                      <td className="py-2 px-3">
                        {r.action === 'insert'
                          ? 'INSERT medication'
                          : `UPDATE #${r.existingMedicationId} (${r.matchedBy})`}
                      </td>
                      <td className="py-2 px-3 font-sans font-medium text-slate-900">
                        {r.brand_name}{' '}
                        <span className="font-normal text-slate-500">
                          · {r.strength ?? '—'} · {r.dosage_form ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-600">{r.barcode ?? 'NULL'}</td>
                      <td className="py-2 px-3 text-right">
                        {r.willCreateOrUpdateBatch ? `${r.quantity} units` : 'Skipped'}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold">
                        {formatCents(r.unit_price_cents)}
                      </td>
                      <td className="py-2 px-3 text-slate-600">
                        {r.willWritePriceHistory
                          ? `+1 price_history (${r.price_source}, confirmed=0)`
                          : 'No price history'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
