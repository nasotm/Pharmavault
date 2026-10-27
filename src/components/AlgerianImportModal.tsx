import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { getRepositoryDatabase } from '../db/repository';
import {
  commitAlgerianMedications,
  enrichAlgerianMedicationRow,
  parseAlgerianMedicationCsv,
  SAMPLE_ALGERIAN_CSV,
  type AlgerianImportParsedItem,
} from '../services/algerianImportService';

export interface AlgerianImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportCommitted: () => Promise<void>;
  currentUser: { name: string; id?: string };
  onNavigateToPendingReview?: () => void;
}

export function AlgerianImportModal({
  isOpen,
  onClose,
  onImportCommitted,
  currentUser,
  onNavigateToPendingReview,
}: AlgerianImportModalProps) {
  const [csvText, setCsvText] = useState<string>(SAMPLE_ALGERIAN_CSV);
  const [fileName, setFileName] = useState<string>('sample_algerian_meds.csv');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzedItems, setAnalyzedItems] = useState<AlgerianImportParsedItem[] | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitSuccess, setCommitSuccess] = useState<{
    total: number;
    withLabel: number;
    incomplete: number;
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number; name: string }>({
    current: 0,
    total: 0,
    name: '',
  });

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErrorBanner(null);
    setCommitSuccess(null);
    setAnalyzedItems(null);
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setCsvText(content);
    };
    reader.readAsText(file);
  };

  const handleLoadSample = () => {
    setFileName('sample_algerian_meds.csv');
    setCsvText(SAMPLE_ALGERIAN_CSV);
    setErrorBanner(null);
    setCommitSuccess(null);
    setAnalyzedItems(null);
  };

  const handleLoad100Sample = async () => {
    setFileName('algeria_drugs_sample.csv');
    setErrorBanner(null);
    setCommitSuccess(null);
    setAnalyzedItems(null);
    try {
      const res = await fetch('/algeria_drugs_sample.csv');
      if (res.ok) {
        const text = await res.text();
        setCsvText(text);
      } else {
        setCsvText(SAMPLE_ALGERIAN_CSV);
      }
    } catch {
      setCsvText(SAMPLE_ALGERIAN_CSV);
    }
  };

  const handleAnalyzeAndLink = async () => {
    setErrorBanner(null);
    setCommitSuccess(null);
    const rows = parseAlgerianMedicationCsv(csvText);

    if (rows.length === 0) {
      setErrorBanner(
        'No valid medication rows found. Please check your CSV format and make sure it has headers: commercial_name, dci, strength, dosage_form, laboratory, ppa_da.',
      );
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress({ current: 0, total: rows.length, name: '' });

    const enriched: AlgerianImportParsedItem[] = [];

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setAnalysisProgress({
          current: i + 1,
          total: rows.length,
          name: row.dci || row.commercial_name,
        });

        const item = await enrichAlgerianMedicationRow(row, i + 1);
        enriched.push(item);
      }

      setAnalyzedItems(enriched);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Error while querying RxNorm and OpenFDA.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleToggleRowExpand = (rowNumber: number) => {
    setExpandedRows((prev) => ({
      ...prev,
      [rowNumber]: !prev[rowNumber],
    }));
  };

  const handleConfirmImport = async () => {
    if (!analyzedItems || analyzedItems.length === 0) return;

    setIsCommitting(true);
    setErrorBanner(null);

    try {
      const db = getRepositoryDatabase();
      const created = await commitAlgerianMedications(db, analyzedItems, currentUser);

      const withLabel = analyzedItems.filter((i) => i.status === 'found_with_label').length;
      const incomplete = analyzedItems.filter((i) => i.hasIncompleteMedicalData).length;

      setCommitSuccess({
        total: created.length,
        withLabel,
        incomplete,
      });

      await onImportCommitted();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Database error while committing imported medications.');
    } finally {
      setIsCommitting(false);
    }
  };

  const withLabelCount = analyzedItems?.filter((i) => i.status === 'found_with_label').length ?? 0;
  const incompleteCount = analyzedItems?.filter((i) => i.hasIncompleteMedicalData).length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="algerian-import-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/60 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="algerian-import-modal-title"
                className="text-lg font-bold text-slate-900 dark:text-white"
              >
                Import Algerian Medications & Link DCI
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Import Algerian commercial names, auto-fetch RxNorm RXCUI, and pull OpenFDA clinical monographs.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-algerian-import-modal"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Format Specification Banner */}
          <div className="p-4 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-xl text-xs text-sky-900 dark:text-sky-200 space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5">
              <Info className="w-4 h-4 text-sky-600 shrink-0" />
              Required CSV Schema & Linking Workflow
            </div>
            <p>
              Expected CSV columns:{' '}
              <code className="px-1.5 py-0.5 bg-sky-100 dark:bg-sky-900/60 rounded font-mono font-medium">
                commercial_name, dci, strength, dosage_form, laboratory, ppa_da
              </code>
            </p>
            <p className="text-sky-700 dark:text-sky-300">
              For each row, the DCI is queried in RxNorm to obtain the RXCUI, then OpenFDA is called to retrieve indications, dosage, warnings, and adverse reactions.
              Medications with missing FDA labels will be flagged for review in the Inventory.
            </p>
          </div>

          {errorBanner && (
            <div
              data-testid="algerian-import-error-banner"
              className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 text-red-800 dark:text-red-200 text-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <div>{errorBanner}</div>
            </div>
          )}

          {commitSuccess ? (
            <div
              data-testid="algerian-import-success-card"
              className="p-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-center space-y-4"
            >
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-emerald-950 dark:text-emerald-100">
                  Import Confirmed & Written to Database!
                </h3>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Successfully imported{' '}
                  <strong className="font-bold">{commitSuccess.total} medications</strong> with prices in Algerian Dinars (DA).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 max-w-md mx-auto text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                  <div className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                    {commitSuccess.withLabel}
                  </div>
                  <div className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Complete OpenFDA Clinical Labels
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <div className="text-amber-600 dark:text-amber-400 font-bold text-lg">
                    {commitSuccess.incomplete}
                  </div>
                  <div className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Pending Manual Pharmacist Review
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-center gap-3">
                {onNavigateToPendingReview && commitSuccess.incomplete > 0 && (
                  <button
                    type="button"
                    data-testid="goto-pending-review-btn"
                    onClick={() => {
                      onClose();
                      onNavigateToPendingReview();
                    }}
                    className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs transition-colors"
                  >
                    View Pending Review Items in Inventory →
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* CSV Selection & Sample Load */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="algerian-csv-upload-input"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg cursor-pointer transition-colors border border-slate-200 dark:border-slate-700"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Choose CSV File
                      <input
                        id="algerian-csv-upload-input"
                        data-testid="algerian-csv-file-input"
                        type="file"
                        accept=".csv,text/csv,text/plain"
                        onChange={handleFileUpload}
                        className="sr-only"
                      />
                    </label>
                    <span className="text-xs text-slate-500 font-mono truncate max-w-xs">
                      {fileName}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      data-testid="load-sample-algerian-csv-btn"
                      onClick={handleLoadSample}
                      className="text-xs text-slate-600 dark:text-slate-400 font-semibold hover:underline"
                    >
                      Sample (6)
                    </button>
                    <button
                      type="button"
                      data-testid="load-100-algerian-csv-btn"
                      onClick={handleLoad100Sample}
                      className="text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex items-center gap-1"
                    >
                      Load Full 100 Algerian CSV
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="algerian-csv-textarea" className="sr-only">
                    Algerian CSV content
                  </label>
                  <textarea
                    id="algerian-csv-textarea"
                    data-testid="algerian-csv-textarea"
                    rows={6}
                    value={csvText}
                    onChange={(e) => {
                      setCsvText(e.target.value);
                      setAnalyzedItems(null);
                    }}
                    placeholder="commercial_name,dci,strength,dosage_form,laboratory,ppa_da&#10;Amoxil,Amoxicilline,500 mg,Gélule,GSK,350..."
                    className="w-full font-mono text-xs p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-900 dark:text-slate-100"
                  />
                </div>

                {!analyzedItems && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      data-testid="analyze-algerian-csv-btn"
                      disabled={isAnalyzing || !csvText.trim()}
                      onClick={handleAnalyzeAndLink}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Linking {analysisProgress.name} ({analysisProgress.current}/{analysisProgress.total})...
                        </>
                      ) : (
                        <>
                          <Database className="w-4 h-4" />
                          Analyze & Link DCI (RxNorm + OpenFDA)
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Analysis & Confirmation Review Section */}
              {analyzedItems && (
                <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl">
                      <div className="text-xs text-slate-500">Total Valid Rows</div>
                      <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                        {analyzedItems.length}
                      </div>
                    </div>
                    <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                      <div className="text-xs text-emerald-700 dark:text-emerald-300">
                        OpenFDA Clinical Data Linked
                      </div>
                      <div className="text-xl font-bold font-mono text-emerald-800 dark:text-emerald-200">
                        {withLabelCount}
                      </div>
                    </div>
                    <div className="p-3 bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl">
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        Pending Pharmacist Review
                      </div>
                      <div className="text-xl font-bold font-mono text-amber-800 dark:text-amber-200">
                        {incompleteCount}
                      </div>
                    </div>
                  </div>

                  {/* Pharmacist Confirmation Notice */}
                  <div className="p-3.5 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-semibold">Review Before Writing:</strong> The items below have been enriched and validated in memory.
                      Nothing has been written to the database yet. Please inspect the list and click{' '}
                      <strong className="font-semibold">“Confirm Import to Database”</strong> below to proceed.
                    </div>
                  </div>

                  {/* Review Table */}
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                          <tr>
                            <th className="py-2.5 px-3">Medication & DCI</th>
                            <th className="py-2.5 px-3">Form & Strength</th>
                            <th className="py-2.5 px-3">Laboratory</th>
                            <th className="py-2.5 px-3 text-right">PPA (DA)</th>
                            <th className="py-2.5 px-3">OpenFDA Status</th>
                            <th className="py-2.5 px-3 text-right">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {analyzedItems.map((item) => {
                            const isExpanded = Boolean(expandedRows[item.rowNumber]);
                            return (
                              <React.Fragment key={item.rowNumber}>
                                <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                  <td className="py-2.5 px-3">
                                    <div className="font-bold text-slate-900 dark:text-white">
                                      {item.commercial_name}
                                    </div>
                                    <div className="text-slate-500 text-[11px]">
                                      DCI: {item.dci || <span className="italic">None</span>}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                                    {item.dosage_form} · {item.strength}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                                    {item.laboratory || '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 dark:text-white">
                                    {item.ppa_da !== null ? `${item.ppa_da.toLocaleString()} DA` : '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {item.status === 'found_with_label' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 text-[11px] font-medium">
                                        <CheckCircle2 className="w-3 h-3" />
                                        Linked RXCUI {item.rxcui}
                                      </span>
                                    ) : item.status === 'found_no_label' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 text-[11px] font-medium">
                                        <AlertCircle className="w-3 h-3" />
                                        RXCUI {item.rxcui} (No FDA label)
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[11px] font-medium">
                                        DCI not found in RxNorm
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    {item.medicalData ? (
                                      <button
                                        type="button"
                                        onClick={() => handleToggleRowExpand(item.rowNumber)}
                                        className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-medium inline-flex items-center gap-0.5"
                                      >
                                        {isExpanded ? 'Hide' : 'View'}
                                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                      </button>
                                    ) : (
                                      <span className="text-slate-400 text-[11px]">Blank</span>
                                    )}
                                  </td>
                                </tr>
                                {isExpanded && item.medicalData && (
                                  <tr className="bg-slate-50/80 dark:bg-slate-800/80 text-[11px]">
                                    <td colSpan={6} className="p-3.5 space-y-2 border-b border-slate-200 dark:border-slate-700">
                                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                                        OpenFDA Retrieved Clinical Information:
                                      </div>
                                      {item.medicalData.indications && (
                                        <div>
                                          <span className="font-medium text-slate-700 dark:text-slate-300">Indications: </span>
                                          <span className="text-slate-600 dark:text-slate-400">{item.medicalData.indications}</span>
                                        </div>
                                      )}
                                      {item.medicalData.posology && (
                                        <div>
                                          <span className="font-medium text-slate-700 dark:text-slate-300">Posology: </span>
                                          <span className="text-slate-600 dark:text-slate-400">{item.medicalData.posology}</span>
                                        </div>
                                      )}
                                      {item.medicalData.precautions && (
                                        <div>
                                          <span className="font-medium text-slate-700 dark:text-slate-300">Precautions: </span>
                                          <span className="text-slate-600 dark:text-slate-400">{item.medicalData.precautions}</span>
                                        </div>
                                      )}
                                      {item.medicalData.side_effects && (
                                        <div>
                                          <span className="font-medium text-slate-700 dark:text-slate-300">Side Effects: </span>
                                          <span className="text-slate-600 dark:text-slate-400">{item.medicalData.side_effects}</span>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
                    <button
                      type="button"
                      onClick={() => setAnalyzedItems(null)}
                      className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    >
                      ← Re-edit CSV
                    </button>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-semibold border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid="confirm-algerian-import-btn"
                        disabled={isCommitting}
                        onClick={handleConfirmImport}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                      >
                        {isCommitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Writing to Database...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Confirm Import to Database ({analyzedItems.length} Medications)
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
