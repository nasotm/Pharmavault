import React, { useEffect, useState } from 'react';
import {
  DEFAULT_CURRENCIES,
  getRepositoryDatabase,
  listCurrencies,
  updateCurrencyRate,
  type CurrencyRecord,
} from '../db/repository';
import { parseExchangeRateToScaledBigInt } from '../pricing';

export interface CurrencySettingsSectionProps {
  currencies?: CurrencyRecord[];
  onCurrenciesUpdated?: () => Promise<void> | void;
}

export const CurrencySettingsSection: React.FC<CurrencySettingsSectionProps> = ({
  currencies: initialCurrencies,
  onCurrenciesUpdated,
}) => {
  const [currencies, setCurrencies] = useState<CurrencyRecord[]>(
    () => (initialCurrencies && initialCurrencies.length > 0 ? initialCurrencies : [...DEFAULT_CURRENCIES]),
  );
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    const list =
      initialCurrencies && initialCurrencies.length > 0 ? initialCurrencies : DEFAULT_CURRENCIES;
    for (const c of list) {
      map[c.code] = String(c.rate_to_da);
    }
    return map;
  });
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [isSavingAll, setIsSavingAll] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialCurrencies && initialCurrencies.length > 0) {
      setCurrencies(initialCurrencies);
      setRateDrafts((prev) => {
        const next = { ...prev };
        for (const c of initialCurrencies) {
          if (next[c.code] === undefined) {
            next[c.code] = String(c.rate_to_da);
          }
        }
        return next;
      });
    }
  }, [initialCurrencies]);

  const reloadFromDb = async () => {
    try {
      const db = getRepositoryDatabase();
      const fresh = await listCurrencies(db);
      setCurrencies(fresh);
      const map: Record<string, string> = {};
      for (const c of fresh) {
        map[c.code] = String(c.rate_to_da);
      }
      setRateDrafts(map);
    } catch {
      // Ignore if DB not initialized
    }
  };

  const handleSaveSingleRate = async (code: string) => {
    if (code === 'DZD') return;
    setErrorMessage(null);
    setStatusMessage(null);

    const rawDraft = rateDrafts[code] ?? '';
    const parsed = parseExchangeRateToScaledBigInt(rawDraft);
    if (!parsed.ok || parsed.numericRate === undefined) {
      setErrorMessage(`${code}: ${parsed.error ?? 'Invalid exchange rate'}`);
      return;
    }

    setSavingCode(code);
    try {
      const db = getRepositoryDatabase();
      const updated = await updateCurrencyRate(db, code, parsed.numericRate);
      await reloadFromDb();
      if (onCurrenciesUpdated) {
        await onCurrenciesUpdated();
      }
      setStatusMessage(
        `Updated ${updated.code} (${updated.name}) exchange rate: 1 ${updated.code} = ${updated.rate_to_da} DA.`,
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCode(null);
    }
  };

  const handleSaveAllRates = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSavingAll(true);

    try {
      const db = getRepositoryDatabase();
      for (const cur of currencies) {
        if (cur.code === 'DZD') continue;
        const rawDraft = rateDrafts[cur.code] ?? String(cur.rate_to_da);
        const parsed = parseExchangeRateToScaledBigInt(rawDraft);
        if (!parsed.ok || parsed.numericRate === undefined) {
          throw new Error(`${cur.code}: ${parsed.error ?? 'Invalid exchange rate'}`);
        }
        await updateCurrencyRate(db, cur.code, parsed.numericRate);
      }
      await reloadFromDb();
      if (onCurrenciesUpdated) {
        await onCurrenciesUpdated();
      }
      setStatusMessage('All currency exchange rates to Algerian Dinar (DA) saved successfully.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingAll(false);
    }
  };

  return (
    <section
      id="currency-settings-section"
      data-testid="currency-settings-section"
      className="p-5 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Currency Settings &amp; Exchange Rates (Base: DZD / DA)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure exchange rates for up to 10 currencies relative to Algerian Dinar (1 Currency Unit = X DA).
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 text-xs font-mono font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 rounded-lg shrink-0">
          Base Currency: DZD (DA = 1)
        </span>
      </div>

      {errorMessage && (
        <div
          role="alert"
          data-testid="currency-settings-error"
          className="p-3 bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800 rounded-lg text-xs font-medium text-red-800 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          data-testid="currency-settings-status"
          className="p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium text-emerald-900 dark:text-emerald-200"
        >
          {statusMessage}
        </div>
      )}

      <form onSubmit={handleSaveAllRates} className="space-y-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <table
            data-testid="currency-settings-table"
            className="w-full text-left text-xs border-collapse"
          >
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2.5 px-4 font-medium">Code</th>
                <th className="py-2.5 px-4 font-medium">Currency Name</th>
                <th className="py-2.5 px-4 font-medium">Symbol</th>
                <th className="py-2.5 px-4 font-medium">Exchange Rate to DA (1 Unit = X DA)</th>
                <th className="py-2.5 px-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {currencies.map((cur) => {
                const isBase = cur.code === 'DZD';
                return (
                  <tr
                    key={cur.code}
                    data-testid={`currency-row-${cur.code}`}
                    className={isBase ? 'bg-sky-50/40 dark:bg-sky-950/20' : ''}
                  >
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                      {cur.code}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{cur.name}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {cur.symbol}
                    </td>
                    <td className="py-2.5 px-4">
                      {isBase ? (
                        <span
                          data-testid="currency-rate-base-dzd"
                          className="inline-block font-mono font-semibold text-slate-600 dark:text-slate-400"
                        >
                          1 (Base Currency)
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 max-w-[200px]">
                          <input
                            type="text"
                            aria-label={`Exchange rate to DA for ${cur.code}`}
                            data-testid={`currency-rate-input-${cur.code}`}
                            value={rateDrafts[cur.code] ?? String(cur.rate_to_da)}
                            onChange={(e) =>
                              setRateDrafts((prev) => ({
                                ...prev,
                                [cur.code]: e.target.value,
                              }))
                            }
                            className="w-28 px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                          />
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            DA
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {isBase ? (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">Locked</span>
                      ) : (
                        <button
                          type="button"
                          data-testid={`currency-rate-save-btn-${cur.code}`}
                          disabled={savingCode === cur.code || isSavingAll}
                          onClick={() => void handleSaveSingleRate(cur.code)}
                          className="px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {savingCode === cur.code ? 'Saving...' : 'Update Rate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Showing {currencies.length} of 10 supported currencies. All totals convert deterministically to Algerian Dinar (DA).
          </span>
          <button
            type="submit"
            data-testid="save-all-currencies-btn"
            disabled={isSavingAll}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSavingAll ? 'Saving Exchange Rates...' : 'Save All Exchange Rates'}
          </button>
        </div>
      </form>
    </section>
  );
};
