import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
} from 'lucide-react';
import type { Medication } from '../db/repository';
import { hasIncompleteMedicalData } from '../services/algerianImportService';

export interface PendingMedicalReviewSectionProps {
  medications: Medication[];
  onOpenMedicationDetail: (id: number) => void;
  onOpenAlgerianImport?: () => void;
}

export function PendingMedicalReviewSection({
  medications,
  onOpenMedicationDetail,
  onOpenAlgerianImport,
}: PendingMedicalReviewSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const pendingItems = useMemo(() => {
    return medications.filter(hasIncompleteMedicalData);
  }, [medications]);

  const getMissingFields = (med: Medication): string[] => {
    const missing: string[] = [];
    if (!med.posology?.trim()) missing.push('Posology');
    if (!med.indications?.trim()) missing.push('Indications');
    if (!med.precautions?.trim()) missing.push('Precautions');
    if (!med.side_effects?.trim()) missing.push('Side Effects');
    return missing;
  };

  return (
    <section
      data-testid="pending-medical-review-section"
      className="bg-white dark:bg-slate-900 border border-amber-200/90 dark:border-amber-900/50 rounded-2xl shadow-2xs overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 bg-amber-50/70 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Pending Review: Incomplete Medical Data
              </h2>
              <span
                data-testid="pending-review-count-badge"
                className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200"
              >
                {pendingItems.length}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Imported medications requiring manual clinical details (indications, posology, or side effects).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {onOpenAlgerianImport && (
            <button
              type="button"
              onClick={onOpenAlgerianImport}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors cursor-pointer"
            >
              + Import Algerian CSV
            </button>
          )}
          <button
            type="button"
            data-testid="toggle-collapse-pending-review"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-amber-100/60 dark:hover:bg-amber-900/40 transition-colors"
            title={isCollapsed ? 'Expand section' : 'Collapse section'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-6">
          {pendingItems.length === 0 ? (
            <div
              data-testid="no-pending-review-items"
              className="py-8 text-center space-y-2 text-slate-500 dark:text-slate-400"
            >
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                All medications have complete medical information!
              </div>
              <p className="text-xs max-w-md mx-auto">
                No imported medications require clinical data review at this time.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-medium">
                    <th className="py-3 px-4">Medication</th>
                    <th className="py-3 px-4">DCI / Generic Molecule</th>
                    <th className="py-3 px-4">Galenic Form & Strength</th>
                    <th className="py-3 px-4">Missing Medical Fields</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {pendingItems.map((med) => {
                    const missing = getMissingFields(med);
                    return (
                      <tr
                        key={med.id}
                        data-testid={`pending-review-row-${med.id}`}
                        className="hover:bg-amber-50/30 dark:hover:bg-amber-950/20 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                          {med.brand_name}
                          {med.manufacturer && (
                            <div className="text-[11px] font-normal text-slate-500">
                              Lab: {med.manufacturer}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                          {med.generic_name || <span className="italic text-slate-400">Not set</span>}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                          {med.dosage_form || '—'} · {med.strength || '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1.5">
                            {missing.map((f) => (
                              <span
                                key={f}
                                className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            data-testid={`fill-medical-info-btn-${med.id}`}
                            onClick={() => onOpenMedicationDetail(med.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-2xs transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Fill Details Manually
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
