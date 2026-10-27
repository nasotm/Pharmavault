import React, { useRef, useState } from 'react';
import {
  downloadJsonFile,
  exportDatabaseBackup,
  restoreDatabaseBackup,
  validateBackupJson,
  type BackupData,
} from '../db/backup';
import { getRepositoryDatabase } from '../db/repository';

export interface DatabaseBackupRestorePanelProps {
  onRestoreCommitted: () => Promise<void> | void;
}

export const DatabaseBackupRestorePanel: React.FC<DatabaseBackupRestorePanelProps> = ({
  onRestoreCommitted,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);

  const [statusNotice, setStatusNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 1. Export Backup Action
  const handleExportBackup = async () => {
    setIsExporting(true);
    setStatusNotice(null);
    try {
      const db = getRepositoryDatabase();
      const backup = await exportDatabaseBackup(db);
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `pharmavault_backup_${dateStr}.json`;
      const jsonStr = JSON.stringify(backup, null, 2);

      downloadJsonFile(filename, jsonStr);

      setStatusNotice({
        type: 'success',
        message: `Backup exported successfully as ${filename} (${backup.counts.medications} medications, ${backup.counts.batches} batches, ${backup.counts.movements} movement logs).`,
      });
    } catch (err: unknown) {
      setStatusNotice({
        type: 'error',
        message: `Failed to export backup: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 2. File Selected Handler
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusNotice(null);
    setPendingFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed: unknown = JSON.parse(text);
        const validation = validateBackupJson(parsed);

        if (!validation.ok) {
          const errText = 'error' in validation ? validation.error : 'Invalid backup format';
          setStatusNotice({
            type: 'error',
            message: `Invalid backup file format: ${errText} Your current database was not modified.`,
          });
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // Prompt confirmation modal
        setPendingBackup(validation.backup);
        setIsConfirmModalOpen(true);
      } catch (err: unknown) {
        setStatusNotice({
          type: 'error',
          message: `Malformed JSON backup file: ${
            err instanceof Error ? err.message : String(err)
          }. Your current database was not modified.`,
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setStatusNotice({
        type: 'error',
        message: 'Failed to read the selected backup file. Your current database was not modified.',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsText(file);
  };

  // 3. Confirm Restore Execution
  const handleConfirmRestore = async () => {
    if (!pendingBackup) return;

    setIsImporting(true);
    setStatusNotice(null);
    try {
      const db = getRepositoryDatabase();
      const res = await restoreDatabaseBackup(db, pendingBackup);

      await onRestoreCommitted();

      setStatusNotice({
        type: 'success',
        message: `Database restored successfully from "${pendingFileName}"! Replaced local state with ${res.restoredCounts.medications} medications, ${res.restoredCounts.batches} batches, and ${res.restoredCounts.movements} movement records.`,
      });
    } catch (err: unknown) {
      setStatusNotice({
        type: 'error',
        message: `Restore failed: ${
          err instanceof Error ? err.message : String(err)
        }. Your database transaction was rolled back safely.`,
      });
    } finally {
      setIsImporting(false);
      setIsConfirmModalOpen(false);
      setPendingBackup(null);
      setPendingFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section
      id="database-backup-restore"
      data-testid="database-backup-restore-section"
      className="p-6 bg-white border border-slate-200/90 rounded-2xl shadow-2xs space-y-5"
    >
      <div>
        <h2 className="text-base font-bold text-slate-900">Database Backup &amp; Restore</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Export your complete local SQLite database (catalog, shelf locations, batches, audit log) to move data between devices or keep offline backups.
        </p>
      </div>

      {statusNotice && (
        <div
          role={statusNotice.type === 'error' ? 'alert' : 'status'}
          data-testid="backup-status-notice"
          className={`p-3.5 border rounded-xl text-xs font-medium flex items-start justify-between gap-3 ${
            statusNotice.type === 'error'
              ? 'bg-red-50 text-red-900 border-red-200'
              : 'bg-emerald-50 text-emerald-900 border-emerald-200'
          }`}
        >
          <span>{statusNotice.message}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-[11px] font-semibold underline shrink-0 opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Export Card */}
        <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-xl space-y-3 flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span>📥</span>
              <span>Export Full Backup</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Creates a downloadable JSON file containing all current medications, batch stock levels, stock movement ledgers, and price history.
            </p>
          </div>

          <button
            type="button"
            data-testid="export-full-backup-btn"
            disabled={isExporting}
            onClick={() => void handleExportBackup()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 disabled:opacity-50 rounded-xl transition-all shadow-xs"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>{isExporting ? 'Exporting JSON...' : 'Export Full Backup'}</span>
          </button>
        </div>

        {/* Import Card */}
        <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-xl space-y-3 flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span>📤</span>
              <span>Import Backup File</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Select a previously exported JSON backup file (`pharmavault_backup_*.json`) to restore your database on this browser.
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              data-testid="import-backup-file-input"
              onChange={handleFileSelected}
              className="hidden"
              id="import-backup-file-input-field"
            />
            <button
              type="button"
              data-testid="trigger-import-backup-btn"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50 rounded-xl transition-all shadow-xs"
            >
              <svg
                className="w-4 h-4 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              <span>Select Backup File to Import...</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal before overwriting */}
      {isConfirmModalOpen && pendingBackup && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="backup-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-lg font-bold text-slate-900">Confirm Database Restore</h3>
            </div>

            <p className="text-xs text-slate-700 font-medium leading-relaxed">
              Are you sure? This will replace all current data with the backup file.
            </p>

            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-mono space-y-1.5 text-slate-700">
              <div>
                <strong>Backup File:</strong> {pendingFileName}
              </div>
              <div>
                <strong>Exported At:</strong>{' '}
                {new Date(pendingBackup.exportedAt).toLocaleString()}
              </div>
              <div className="pt-1 text-[11px] text-slate-500 border-t border-slate-200/60">
                Contains: {pendingBackup.counts.medications} medications, {pendingBackup.counts.batches} batches, {pendingBackup.counts.movements} movement logs, {pendingBackup.counts.priceHistory} price entries.
              </div>
            </div>

            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium">
              Notice: All existing local medications, batches, and movements in this browser will be permanently overwritten with the records from this file.
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                data-testid="cancel-restore-btn"
                disabled={isImporting}
                onClick={() => {
                  setIsConfirmModalOpen(false);
                  setPendingBackup(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                data-testid="confirm-restore-btn"
                disabled={isImporting}
                onClick={() => void handleConfirmRestore()}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
              >
                {isImporting ? 'Restoring Database...' : 'Confirm &amp; Overwrite Database'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
