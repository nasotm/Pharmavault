import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Columns,
  Eye,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { getRepositoryDatabase } from '../db/repository';
import {
  autoSuggestInventoryMapping,
  buildDryRunPreview,
  importPharmacyInventoryCsv,
  parsePharmacyInventoryCsv,
  PHARMACY_INVENTORY_TARGET_FIELDS,
  SAMPLE_PHARMACY_INVENTORY_CSV,
  type PharmacyColumnMapping,
  type PharmacyImportExecutionResult,
  type PharmacyImportProgress,
  type PharmacyInventoryFieldKey,
} from '../services/pharmacyInventoryImportService';

interface PharmacyInventoryImportCardProps {
  currentUserIdentifier?: string;
  onImportCommitted: () => Promise<void> | void;
}

export function PharmacyInventoryImportCard({
  currentUserIdentifier = 'Pharmacist',
  onImportCommitted,
}: PharmacyInventoryImportCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [mapping, setMapping] = useState<PharmacyColumnMapping>({});
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<PharmacyImportProgress | null>(null);
  const [executionResult, setExecutionResult] = useState<PharmacyImportExecutionResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parsedCsv = useMemo(() => parsePharmacyInventoryCsv(csvText), [csvText]);

  const dryRunRows = useMemo(
    () => buildDryRunPreview(parsedCsv.rows, mapping, 5),
    [parsedCsv.rows, mapping],
  );

  const loadCsvContent = (content: string, fileName: string) => {
    setErrorMessage(null);
    setExecutionResult(null);
    setSelectedFileName(fileName);
    setCsvText(content);
    const parsed = parsePharmacyInventoryCsv(content);
    if (parsed.headers.length === 0) {
      setErrorMessage('No valid CSV headers or rows detected in the selected file.');
      setMapping({});
      return;
    }
    setMapping(autoSuggestInventoryMapping(parsed.headers));
  };

  const handleOpenFilePicker = () => {
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      loadCsvContent(content, file.name);
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read the selected CSV file.');
    };
    reader.readAsText(file);
  };

  const handleLoadSample = () => {
    loadCsvContent(SAMPLE_PHARMACY_INVENTORY_CSV, 'pharmacy_inventory_sample.csv');
  };

  const handleFieldMappingChange = (fieldKey: PharmacyInventoryFieldKey, csvHeader: string) => {
    setMapping((prev) => ({
      ...prev,
      [fieldKey]: csvHeader || undefined,
    }));
    setExecutionResult(null);
  };

  const handleConfirmImport = async () => {
    if (!mapping.brand_name) {
      setErrorMessage('Please map the required "brand_name" field before confirming the import.');
      return;
    }
    if (parsedCsv.rows.length === 0) {
      setErrorMessage('There are no rows to import.');
      return;
    }

    setErrorMessage(null);
    setExecutionResult(null);
    setIsImporting(true);
    setProgress({
      processed: 0,
      total: parsedCsv.rows.length,
      updated: 0,
      created: 0,
      errorsCount: 0,
    });

    try {
      const db = getRepositoryDatabase();
      const result = await importPharmacyInventoryCsv(db, parsedCsv.rows, mapping, {
        userId: currentUserIdentifier,
        onProgress: (p) => {
          setProgress(p);
        },
      });
      setExecutionResult(result);
      await onImportCommitted();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearWorkspace = () => {
    setCsvText('');
    setSelectedFileName(null);
    setMapping({});
    setExecutionResult(null);
    setErrorMessage(null);
    setProgress(null);
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <div
      data-testid="pharmacy-inventory-import-card"
      className="p-5 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xs space-y-5"
    >
      {/* Hidden CSV File Picker */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".csv,text/csv"
        className="hidden"
        data-testid="pharmacy-inventory-file-input"
        onChange={handleFileChange}
      />

      {/* Card Header & Primary Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-200/80 dark:border-sky-800 shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Pharmacy Inventory CSV Importer
              </h2>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300">
                Prices (DA) · Stock · Location
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Map your spreadsheet columns, preview the first 5 rows, and update existing stock/prices or create new medications in one pass.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenFilePicker}
            disabled={isImporting}
            data-testid="import-pharmacy-inventory-btn"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 active:bg-sky-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>Import Pharmacy Inventory (CSV)</span>
          </button>

          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isImporting}
            data-testid="load-sample-pharmacy-inventory-btn"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>Load Sample CSV</span>
          </button>

          {parsedCsv.headers.length > 0 && (
            <button
              type="button"
              onClick={handleClearWorkspace}
              disabled={isImporting}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Clear loaded CSV"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Step 1: Column Mapping & Detected Headers */}
      {parsedCsv.headers.length > 0 && (
        <div
          data-testid="pharmacy-csv-column-mapping-section"
          className="p-4 sm:p-5 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-700/70">
            <div className="flex items-center gap-2">
              <Columns className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Step 1 · Column Mapping ({parsedCsv.rows.length} rows in{' '}
                <span className="font-mono text-sky-700 dark:text-sky-300">
                  {selectedFileName ?? 'CSV'}
                </span>
                )
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              All prices are imported as integer Algerian Dinar (DA)
            </span>
          </div>

          {/* Detected CSV Headers */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Detected CSV Headers ({parsedCsv.headers.length}):
            </div>
            <div
              data-testid="detected-csv-headers"
              className="flex flex-wrap items-center gap-1.5"
            >
              {parsedCsv.headers.map((header) => (
                <span
                  key={header}
                  className="px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs"
                >
                  {header}
                </span>
              ))}
            </div>
          </div>

          {/* Mapping Selectors Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
            {PHARMACY_INVENTORY_TARGET_FIELDS.map((field) => {
              const selectedHeader = mapping[field.key] ?? '';
              return (
                <div
                  key={field.key}
                  className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 flex flex-col justify-between gap-2"
                >
                  <div>
                    <label
                      htmlFor={`map-field-${field.key}`}
                      className="flex items-center justify-between gap-1 text-xs font-bold text-slate-800 dark:text-slate-200"
                    >
                      <span className="font-mono">{field.key}</span>
                      {field.required ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 rounded">
                          Required
                        </span>
                      ) : (
                        <span className="text-[10px] font-normal text-slate-400">Optional</span>
                      )}
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                      {field.description}
                    </p>
                  </div>

                  <select
                    id={`map-field-${field.key}`}
                    data-testid={`map-select-${field.key}`}
                    value={selectedHeader}
                    onChange={(e) => handleFieldMappingChange(field.key, e.target.value)}
                    disabled={isImporting}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  >
                    <option value="">-- Not Mapped --</option>
                    {parsedCsv.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Dry-Run Preview (First 5 Rows) */}
      {parsedCsv.headers.length > 0 && (
        <div
          data-testid="pharmacy-csv-dry-run-preview"
          className="p-4 sm:p-5 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Step 2 · Dry-Run Preview (First {dryRunRows.length} of {parsedCsv.rows.length} rows)
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Verify how your mapped columns will be interpreted before writing to the database
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">brand_name</th>
                  <th className="py-2.5 px-3">barcode</th>
                  <th className="py-2.5 px-3 text-right">unit_price (DA)</th>
                  <th className="py-2.5 px-3 text-right">cost_price (DA)</th>
                  <th className="py-2.5 px-3 text-right">quantity</th>
                  <th className="py-2.5 px-3">expiry_date</th>
                  <th className="py-2.5 px-3">lot_number</th>
                  <th className="py-2.5 px-3">Location (zone · shelf · bin)</th>
                  <th className="py-2.5 px-3">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dryRunRows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    data-testid={`dry-run-row-${row.rowNumber}`}
                    className={
                      row.validationError
                        ? 'bg-rose-50/40 dark:bg-rose-950/20'
                        : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-2.5 px-3 font-mono text-slate-400">{row.rowNumber}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                      {row.brand_name || <span className="text-rose-500 italic">Missing</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                      {row.barcode ?? '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 dark:text-white">
                      {row.unit_price !== null ? `${row.unit_price} DA` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                      {row.cost_price !== null ? `${row.cost_price} DA` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      +{row.quantity}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                      {row.expiry_date ?? '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                      {row.lot_number ?? 'Auto'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                      {[row.zone || '—', row.shelf || '—', row.bin || '—'].join(' · ')}
                    </td>
                    <td className="py-2.5 px-3">
                      {row.validationError ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300">
                          {row.validationError}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                          Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Confirm Import Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Existing medications (matched by barcode or brand name) will have their price, batch stock (+qty <code className="font-mono">initial_receipt</code>), and location updated. Unmatched items will be created.
            </p>
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={isImporting || !mapping.brand_name}
              data-testid="confirm-pharmacy-inventory-import-btn"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Importing Inventory...</span>
                </>
              ) : (
                <>
                  <span>Confirm Import ({parsedCsv.rows.length} rows)</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {isImporting && progress && (
        <div
          data-testid="pharmacy-inventory-import-progress"
          className="p-4 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 space-y-2.5"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-sky-900 dark:text-sky-200">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400" />
              <span>Importing {selectedFileName}...</span>
            </span>
            <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
              {progress.processed} / {progress.total} ({percent}%)
            </span>
          </div>

          <div className="w-full h-2.5 bg-sky-200 dark:bg-sky-900/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-150 rounded-full"
              style={{ width: `${percent}%` }}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              {progress.currentItem ? (
                <>
                  Processing:{' '}
                  <strong className="text-slate-700 dark:text-slate-300">
                    {progress.currentItem}
                  </strong>
                </>
              ) : (
                'Processing rows...'
              )}
            </span>
            <span className="font-mono">
              <span className="text-sky-600 dark:text-sky-400 font-semibold">
                {progress.updated} updated
              </span>
              {' · '}
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                {progress.created} created
              </span>
              {progress.errorsCount > 0 && (
                <span className="text-rose-600 dark:text-rose-400 ml-2">
                  ({progress.errorsCount} errors)
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Final Import Summary Banner */}
      {executionResult && (
        <div
          role="status"
          data-testid="pharmacy-inventory-import-summary"
          className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs space-y-2 shadow-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-bold text-sm">
                {executionResult.updated} items updated, {executionResult.created} items created,{' '}
                {executionResult.errors.length} errors
                {executionResult.errors.length > 0 ? ' (with details below)' : '.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExecutionResult(null)}
              className="p-1 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer"
              aria-label="Dismiss summary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {executionResult.errors.length > 0 && (
            <ul
              data-testid="pharmacy-inventory-import-error-details"
              className="mt-2 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/70 space-y-1 text-rose-700 dark:text-rose-300 font-mono text-[11px] list-disc list-inside"
            >
              {executionResult.errors.map((err, idx) => (
                <li key={idx}>{err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="pharmacy-inventory-import-error"
          className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 rounded-lg text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
