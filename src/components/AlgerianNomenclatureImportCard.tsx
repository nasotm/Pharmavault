import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { getRepositoryDatabase } from '../db/repository';
import {
  importAlgerianNomenclatureCsv,
  SAMPLE_HUGGINGFACE_ALGERIAN_CSV,
  type AlgerianNomenclatureProgress,
} from '../services/algerianNomenclatureService';

interface AlgerianNomenclatureImportCardProps {
  onImportCommitted: () => Promise<void> | void;
}

export function AlgerianNomenclatureImportCard({
  onImportCommitted,
}: AlgerianNomenclatureImportCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<AlgerianNomenclatureProgress | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleButtonClick = () => {
    setErrorMessage(null);
    setSummaryMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const processCsvText = async (text: string, fileName: string) => {
    setSelectedFileName(fileName);
    setIsImporting(true);
    setProgress({ processed: 0, total: 0, imported: 0, skipped: 0 });
    setSummaryMessage(null);
    setErrorMessage(null);

    try {
      const db = getRepositoryDatabase();
      const result = await importAlgerianNomenclatureCsv(db, text, (p) => {
        setProgress(p);
      });

      setSummaryMessage(result.summary);
      if (onImportCommitted) {
        await onImportCommitted();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      await processCsvText(content, file.name);
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read the selected CSV file.');
    };
    reader.readAsText(file);
  };

  const handleLoadSample = async () => {
    await processCsvText(SAMPLE_HUGGINGFACE_ALGERIAN_CSV, 'tkawen_sample_nomenclature.csv');
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <div
      data-testid="algerian-nomenclature-import-card"
      className="p-5 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xs space-y-4"
    >
      {/* Hidden file input opened by the primary button */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".csv,text/csv"
        className="hidden"
        data-testid="algerian-nomenclature-file-input"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-200/80 dark:border-emerald-800">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Algerian Drug Nomenclature
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                Hugging Face
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Source dataset: <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300">tkawen/algerian-drug-nomenclature</code> (columns: <span className="font-mono">brand_name</span>, <span className="font-mono">inn</span>, <span className="font-mono">dosage</span>, <span className="font-mono">form</span>, <span className="font-mono">laboratory</span>).
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleButtonClick}
            disabled={isImporting}
            data-testid="import-algerian-nomenclature-btn"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Import Algerian Drug Nomenclature (CSV)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Informational Guidance */}
      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-start sm:items-center gap-2">
          <Database className="w-4 h-4 text-slate-500 shrink-0 mt-0.5 sm:mt-0" />
          <span>
            Prices, locations, and initial stock batches are left empty for pharmacist verification. Duplicates are automatically detected and skipped.
          </span>
        </div>
        <button
          type="button"
          onClick={handleLoadSample}
          disabled={isImporting}
          data-testid="load-sample-nomenclature-btn"
          className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline shrink-0 inline-flex items-center gap-1 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Load 20-item sample</span>
        </button>
      </div>

      {/* Progress Bar View */}
      {isImporting && progress && (
        <div
          data-testid="import-nomenclature-progress"
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

          {/* Progress bar line */}
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
                <>Processing: <span className="font-medium text-slate-700 dark:text-slate-300">{progress.currentItem}</span></>
              ) : (
                'Parsing records...'
              )}
            </span>
            <span className="font-mono">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{progress.imported} imported</span>
              {progress.skipped > 0 && (
                <span className="text-amber-600 dark:text-amber-400 ml-2">({progress.skipped} skipped)</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Summary Message Banner */}
      {summaryMessage && (
        <div
          role="status"
          data-testid="import-nomenclature-summary"
          className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center justify-between shadow-xs animate-in fade-in"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold text-sm">{summaryMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSummaryMessage(null)}
            className="p-1 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
            aria-label="Dismiss summary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="import-nomenclature-error"
          className="p-4 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-200 text-xs flex items-center justify-between shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 rounded-lg text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
