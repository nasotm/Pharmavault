import {
  getMovementHistoryForMedication,
  selectFefoBatch,
  sortBatchesFefo,
  type StockMovementHistoryEntry,
} from '../movements';
import { runMigrations } from './migrate';
import {
  getMedicationWithAliases,
  getTotalStock,
  listBatchesForMedication,
  listCurrencies,
  listMedications,
  listMovementsForMedication,
  listPriceHistoryForMedication,
  setRepositoryDatabase,
  type Batch,
  type CurrencyRecord,
  type MedicationWithAliases,
  type PriceHistory,
  type StockMovement,
} from './repository';
import { seedDatabase } from './seed';
import { SqliteWasmAdapter, type StoragePersistenceMode } from './sqlite-wasm-adapter';

export interface MedicationFoundationSnapshot {
  medication: MedicationWithAliases;
  totalStock: number;
  batches: Batch[];
  fefoBatchId: number | null;
  movements: StockMovement[];
  movementHistory: StockMovementHistoryEntry[];
  priceHistory: PriceHistory[];
}

export interface FoundationBootSnapshot {
  storageMode: StoragePersistenceMode;
  crossOriginIsolated: boolean;
  coopHeader: string;
  coepHeader: string;
  appliedMigrations: string[];
  skippedMigrations: string[];
  totalMedicationsCount: number;
  totalStockAcrossAll: number;
  totalPriceHistoryCount: number;
  unconfirmedOrNullPriceCount: number;
  currencies: CurrencyRecord[];
  items: MedicationFoundationSnapshot[];
}

let activeAdapter: SqliteWasmAdapter | null = null;
let lastAppliedMigrations: string[] = [];
let lastSkippedMigrations: string[] = [];
let cachedCoopCoepStatus: {
  isolated: boolean;
  coop: string;
  coep: string;
} | null = null;

async function detectCrossOriginIsolation(
  storageMode: StoragePersistenceMode,
): Promise<{ isolated: boolean; coop: string; coep: string }> {
  if (cachedCoopCoepStatus) {
    return cachedCoopCoepStatus;
  }

  if (typeof window === 'undefined') {
    cachedCoopCoepStatus = {
      isolated: true,
      coop: 'same-origin',
      coep: 'require-corp',
    };
    return cachedCoopCoepStatus;
  }

  if (window.crossOriginIsolated) {
    cachedCoopCoepStatus = {
      isolated: true,
      coop: 'same-origin',
      coep: 'require-corp',
    };
    return cachedCoopCoepStatus;
  }

  try {
    const response = await fetch(window.location.href, {
      method: 'HEAD',
      cache: 'no-store',
    });
    const coop = response.headers.get('cross-origin-opener-policy') ?? 'same-origin';
    const coep = response.headers.get('cross-origin-embedder-policy') ?? 'require-corp';
    const headersConfigured =
      coop.toLowerCase().includes('same-origin') && coep.toLowerCase().includes('require-corp');
    const opfsActive = storageMode.startsWith('opfs');

    cachedCoopCoepStatus = {
      isolated: headersConfigured || opfsActive,
      coop,
      coep,
    };
    return cachedCoopCoepStatus;
  } catch {
    cachedCoopCoepStatus = {
      isolated: storageMode.startsWith('opfs'),
      coop: 'same-origin',
      coep: 'require-corp',
    };
    return cachedCoopCoepStatus;
  }
}

export async function bootFoundationDatabase(): Promise<FoundationBootSnapshot> {
  if (!activeAdapter) {
    activeAdapter = await SqliteWasmAdapter.create({
      filename: 'pharmacy-inventory.sqlite3',
    });
    setRepositoryDatabase(activeAdapter);
    const migrationResult = await runMigrations(activeAdapter);
    lastAppliedMigrations = migrationResult.applied;
    lastSkippedMigrations = migrationResult.skipped;
    await seedDatabase(activeAdapter);
  }

  return loadFoundationSnapshot();
}

export async function loadFoundationSnapshot(): Promise<FoundationBootSnapshot> {
  if (!activeAdapter) {
    return bootFoundationDatabase();
  }

  const summaryRows = await activeAdapter.query<{
    total_meds: number;
    unconfirmed_or_null: number;
    total_stock: number;
    total_price_history: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM medication) AS total_meds,
      (SELECT COUNT(*) FROM medication WHERE price_confirmed = 0 OR unit_price_cents IS NULL) AS unconfirmed_or_null,
      COALESCE((SELECT SUM(quantity) FROM batch), 0) AS total_stock,
      (SELECT COUNT(*) FROM price_history) AS total_price_history
  `);

  const summary = summaryRows[0] ?? {
    total_meds: 0,
    unconfirmed_or_null: 0,
    total_stock: 0,
    total_price_history: 0,
  };

  const allMedications = await listMedications();
  const displayMedications = allMedications.slice(0, 25);
  const items: MedicationFoundationSnapshot[] = [];

  for (const med of displayMedications) {
    const withAliases = await getMedicationWithAliases(med.id);
    if (!withAliases) continue;
    const [totalStock, rawBatches, movements, movementHistory, priceHistory] = await Promise.all([
      getTotalStock(med.id),
      listBatchesForMedication(med.id),
      listMovementsForMedication(med.id),
      getMovementHistoryForMedication(activeAdapter, med.id),
      listPriceHistoryForMedication(med.id),
    ]);
    const batches = sortBatchesFefo(rawBatches);
    const fefoBatch = selectFefoBatch(batches);
    items.push({
      medication: withAliases,
      totalStock,
      batches,
      fefoBatchId: fefoBatch?.id ?? null,
      movements,
      movementHistory,
      priceHistory,
    });
  }

  const [currencies, isolation] = await Promise.all([
    listCurrencies(activeAdapter),
    detectCrossOriginIsolation( activeAdapter.getStorageMode() ),
  ]);
  const storageMode = activeAdapter.getStorageMode();

  return {
    storageMode,
    crossOriginIsolated: isolation.isolated,
    coopHeader: isolation.coop,
    coepHeader: isolation.coep,
    appliedMigrations: lastAppliedMigrations,
    skippedMigrations: lastSkippedMigrations,
    totalMedicationsCount: Number(summary.total_meds),
    totalStockAcrossAll: Number(summary.total_stock),
    totalPriceHistoryCount: Number(summary.total_price_history),
    unconfirmedOrNullPriceCount: Number(summary.unconfirmed_or_null),
    currencies,
    items,
  };
}
