import type { DatabasePort, SqlParam } from '../db/port';
import {
  getBatchById,
  getMedicationById,
  getTotalStock,
  insertBatch,
  insertMovement,
  listBatchesForMedication,
  updateBatchQuantity,
  type Batch,
  type StockMovement,
} from '../db/repository';

export const CURRENT_USER_STORAGE_KEY = 'pharmavault_current_user_v1';

export interface CurrentUserProfile {
  name: string;
  pin: string;
}

export const DEFAULT_CURRENT_USER: CurrentUserProfile = {
  name: 'Claire Dupont',
  pin: '4821',
};

export interface ReceiveStockInput {
  medicationId: number;
  /**
   * Optional existing batch ID to receive stock into.
   * When omitted or null, creates a new batch using `lotNumber` and `expiryDate`.
   */
  batchId?: number | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  reason?: string | null;
  userId: string;
  createdAt?: string;
}

export interface DispenseStockInput {
  medicationId: number;
  /**
   * Optional manual batch override.
   * When omitted or null, defaults to FEFO (earliest expiry batch with quantity > 0).
   */
  batchId?: number | null;
  quantity: number;
  reason?: string | null;
  userId: string;
  createdAt?: string;
}

export interface OffsetMovementInput {
  medicationId: number;
  batchId: number;
  delta: number;
  reason: string;
  userId: string;
  createdAt?: string;
}

export interface StockMovementOperationResult {
  medicationId: number;
  batch: Batch;
  movement: StockMovement;
  totalStock: number;
  resultingBatchQuantity: number;
}

export interface StockMovementHistoryEntry {
  id: number;
  medication_id: number;
  batch_id: number | null;
  lot_number: string | null;
  expiry_date: string | null;
  delta: number;
  reason: string | null;
  user_id: string | null;
  created_at: string;
  resulting_quantity: number;
  resulting_batch_quantity: number | null;
}

/**
 * Formats a CurrentUserProfile into the traceable user_id string stored on stock_movement rows.
 */
export function formatCurrentUserIdentifier(profile: CurrentUserProfile): string {
  const cleanName = profile.name.trim();
  const cleanPin = profile.pin.trim();
  if (cleanName && cleanPin) {
    return `${cleanName} (PIN: ${cleanPin})`;
  }
  if (cleanName) {
    return cleanName;
  }
  if (cleanPin) {
    return `PIN:${cleanPin}`;
  }
  return `${DEFAULT_CURRENT_USER.name} (PIN: ${DEFAULT_CURRENT_USER.pin})`;
}

/**
 * Reads the lightweight "current user" (name or PIN) from localStorage.
 */
export function loadCurrentUserProfile(): CurrentUserProfile {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CURRENT_USER };
    }
    const raw = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CURRENT_USER };
    }
    const parsed = JSON.parse(raw) as Partial<CurrentUserProfile>;
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const pin = typeof parsed.pin === 'string' ? parsed.pin.trim() : '';
    if (!name && !pin) {
      return { ...DEFAULT_CURRENT_USER };
    }
    return { name, pin };
  } catch {
    return { ...DEFAULT_CURRENT_USER };
  }
}

/**
 * Persists the lightweight "current user" (name or PIN) to localStorage.
 */
export function saveCurrentUserProfile(profile: CurrentUserProfile): CurrentUserProfile {
  const normalized: CurrentUserProfile = {
    name: profile.name.trim(),
    pin: profile.pin.trim(),
  };
  const effective = normalized.name || normalized.pin ? normalized : { ...DEFAULT_CURRENT_USER };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(effective));
    }
  } catch {
    // Ignore storage quota errors in restricted environments
  }
  return effective;
}

/**
 * Sorts batches in FEFO order (First-Expired, First-Out):
 * 1. Batches with non-empty expiry_date come before NULL/empty expiry_date.
 * 2. Earlier expiry_date (ISO-8601 YYYY-MM-DD) comes first.
 * 3. Ties broken by batch id ASC.
 */
export function sortBatchesFefo(batches: readonly Batch[]): Batch[] {
  return [...batches].sort((a, b) => {
    const aExp = a.expiry_date?.trim() || null;
    const bExp = b.expiry_date?.trim() || null;
    if (aExp !== null && bExp !== null) {
      if (aExp !== bExp) {
        return aExp.localeCompare(bExp);
      }
    } else if (aExp !== null && bExp === null) {
      return -1;
    } else if (aExp === null && bExp !== null) {
      return 1;
    }
    return a.id - b.id;
  });
}

/**
 * Deliverable 3: Selects the default FEFO batch (earliest expiry batch with quantity > 0).
 */
export function selectFefoBatch(batches: readonly Batch[]): Batch | null {
  const available = sortBatchesFefo(batches).filter((b) => b.quantity > 0);
  return available[0] ?? null;
}

/**
 * Deliverable 2: Receive stock.
 * Picks an existing batch OR creates a new batch (lot_number, expiry_date, quantity)
 * and writes a positive stock_movement row atomically in a single SQLite transaction.
 */
export async function receiveStock(
  db: DatabasePort,
  input: ReceiveStockInput,
): Promise<StockMovementOperationResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError(
      `Receive quantity must be a positive integer greater than 0 (received ${String(input.quantity)}).`,
    );
  }

  const cleanUser = input.userId.trim();
  if (!cleanUser) {
    throw new Error('A current user (name or PIN) is required to record stock movements.');
  }

  const nowIso = input.createdAt ?? new Date().toISOString();
  const cleanReason = input.reason?.trim() || 'receive:supplier_delivery';

  return db.transaction(async (tx) => {
    const med = await getMedicationById(tx, input.medicationId);
    if (!med) {
      throw new Error(`Medication #${input.medicationId} not found.`);
    }

    let updatedBatch: Batch;

    if (input.batchId !== undefined && input.batchId !== null) {
      const existingBatch = await getBatchById(tx, input.batchId);
      if (!existingBatch || existingBatch.medication_id !== input.medicationId) {
        throw new Error(`Batch #${input.batchId} does not exist for medication ${med.brand_name}.`);
      }
      const nextQuantity = existingBatch.quantity + input.quantity;
      updatedBatch = await updateBatchQuantity(tx, existingBatch.id, nextQuantity);
    } else {
      const cleanLot = input.lotNumber?.trim() || null;
      if (!cleanLot) {
        throw new Error('Lot number is required when creating a new batch on stock receipt.');
      }
      const cleanExpiry = input.expiryDate?.trim() || null;
      updatedBatch = await insertBatch(tx, {
        medication_id: input.medicationId,
        lot_number: cleanLot,
        quantity: input.quantity,
        expiry_date: cleanExpiry,
        received_at: nowIso,
      });
    }

    const movement = await insertMovement(tx, {
      medication_id: input.medicationId,
      batch_id: updatedBatch.id,
      delta: input.quantity,
      reason: cleanReason,
      user_id: cleanUser,
      created_at: nowIso,
    });

    const totalStock = await getTotalStock(tx, input.medicationId);

    return {
      medicationId: input.medicationId,
      batch: updatedBatch,
      movement,
      totalStock,
      resultingBatchQuantity: updatedBatch.quantity,
    };
  });
}

/**
 * Deliverable 3: Dispense stock.
 * - Defaults to FEFO (earliest expiry batch first with quantity > 0) when `batchId` is omitted/null.
 * - Allows manual batch override via `batchId`.
 * - Blocks dispensing more than the batch holds with a clear error message.
 * - Decrements `batch.quantity` and inserts a negative `stock_movement` row in a single transaction.
 */
export async function dispenseStock(
  db: DatabasePort,
  input: DispenseStockInput,
): Promise<StockMovementOperationResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError(
      `Dispense quantity must be a positive integer greater than 0 (received ${String(input.quantity)}).`,
    );
  }

  const cleanUser = input.userId.trim();
  if (!cleanUser) {
    throw new Error('A current user (name or PIN) is required to dispense stock.');
  }

  const nowIso = input.createdAt ?? new Date().toISOString();
  const cleanReason = input.reason?.trim() || 'dispense:prescription';

  return db.transaction(async (tx) => {
    const med = await getMedicationById(tx, input.medicationId);
    if (!med) {
      throw new Error(`Medication #${input.medicationId} not found.`);
    }

    const batches = await listBatchesForMedication(tx, input.medicationId);
    let targetBatch: Batch | null;

    if (input.batchId !== undefined && input.batchId !== null) {
      targetBatch = batches.find((b) => b.id === input.batchId) ?? null;
      if (!targetBatch) {
        throw new Error(`Batch #${input.batchId} was not found for medication ${med.brand_name}.`);
      }
    } else {
      targetBatch = selectFefoBatch(batches);
      if (!targetBatch) {
        const fallbackBatch = sortBatchesFefo(batches)[0] ?? null;
        if (fallbackBatch) {
          throw new Error(
            `Cannot dispense ${input.quantity} units of ${med.brand_name}: all batches have 0 units available.`,
          );
        }
        throw new Error(
          `Cannot dispense ${input.quantity} units of ${med.brand_name}: no batches exist in stock.`,
        );
      }
    }

    if (input.quantity > targetBatch.quantity) {
      const lotLabel = targetBatch.lot_number ?? `#${targetBatch.id}`;
      throw new Error(
        `Cannot dispense ${input.quantity} units from batch ${lotLabel}: only ${targetBatch.quantity} unit${
          targetBatch.quantity === 1 ? '' : 's'
        } available.`,
      );
    }

    const nextQuantity = targetBatch.quantity - input.quantity;
    const updatedBatch = await updateBatchQuantity(tx, targetBatch.id, nextQuantity);

    const movement = await insertMovement(tx, {
      medication_id: input.medicationId,
      batch_id: updatedBatch.id,
      delta: -input.quantity,
      reason: cleanReason,
      user_id: cleanUser,
      created_at: nowIso,
    });

    const totalStock = await getTotalStock(tx, input.medicationId);

    return {
      medicationId: input.medicationId,
      batch: updatedBatch,
      movement,
      totalStock,
      resultingBatchQuantity: updatedBatch.quantity,
    };
  });
}

/**
 * Posts an offsetting stock movement with a mandatory reason to correct inventory
 * without ever editing or deleting existing stock_movement rows.
 */
export async function postOffsetMovement(
  db: DatabasePort,
  input: OffsetMovementInput,
): Promise<StockMovementOperationResult> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new RangeError('Offset movement delta must be a non-zero integer.');
  }

  const cleanReason = input.reason.trim();
  if (!cleanReason) {
    throw new Error('A reason is required when posting an offsetting correction movement.');
  }

  const cleanUser = input.userId.trim();
  if (!cleanUser) {
    throw new Error('A current user (name or PIN) is required to post an offsetting movement.');
  }

  const nowIso = input.createdAt ?? new Date().toISOString();

  return db.transaction(async (tx) => {
    const med = await getMedicationById(tx, input.medicationId);
    if (!med) {
      throw new Error(`Medication #${input.medicationId} not found.`);
    }

    const batch = await getBatchById(tx, input.batchId);
    if (!batch || batch.medication_id !== input.medicationId) {
      throw new Error(`Batch #${input.batchId} not found for ${med.brand_name}.`);
    }

    const nextQuantity = batch.quantity + input.delta;
    if (nextQuantity < 0) {
      const lotLabel = batch.lot_number ?? `#${batch.id}`;
      throw new Error(
        `Cannot apply offset ${input.delta} to batch ${lotLabel}: batch only holds ${batch.quantity} units.`,
      );
    }

    const updatedBatch = await updateBatchQuantity(tx, batch.id, nextQuantity);
    const formattedReason = cleanReason.startsWith('correction:')
      ? cleanReason
      : `correction:${cleanReason}`;

    const movement = await insertMovement(tx, {
      medication_id: input.medicationId,
      batch_id: updatedBatch.id,
      delta: input.delta,
      reason: formattedReason,
      user_id: cleanUser,
      created_at: nowIso,
    });

    const totalStock = await getTotalStock(tx, input.medicationId);

    return {
      medicationId: input.medicationId,
      batch: updatedBatch,
      movement,
      totalStock,
      resultingBatchQuantity: updatedBatch.quantity,
    };
  });
}

/**
 * Deliverable 4: Movement history view per medication:
 * Returns timestamp (`created_at`), `delta`, `reason`, `user` (`user_id`),
 * and `resulting_quantity` (both total medication stock and batch stock after each movement).
 */
export async function getMovementHistoryForMedication(
  db: DatabasePort,
  medicationId: number,
): Promise<StockMovementHistoryEntry[]> {
  const [totalStock, batches, rawMovements] = await Promise.all([
    getTotalStock(db, medicationId),
    listBatchesForMedication(db, medicationId),
    db.query<Record<string, SqlParam>>(
      `SELECT sm.id,
              sm.medication_id,
              sm.batch_id,
              sm.delta,
              sm.reason,
              sm.user_id,
              sm.created_at,
              b.lot_number,
              b.expiry_date
       FROM stock_movement sm
       LEFT JOIN batch b ON b.id = sm.batch_id
       WHERE sm.medication_id = ?
       ORDER BY sm.id ASC`,
      [medicationId],
    ),
  ]);

  if (rawMovements.length === 0) {
    return [];
  }

  const parsedMovements = rawMovements.map((row) => ({
    id: Number(row.id),
    medication_id: Number(row.medication_id),
    batch_id: row.batch_id === null || row.batch_id === undefined ? null : Number(row.batch_id),
    lot_number:
      row.lot_number === null || row.lot_number === undefined ? null : String(row.lot_number),
    expiry_date:
      row.expiry_date === null || row.expiry_date === undefined ? null : String(row.expiry_date),
    delta: Number(row.delta),
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    user_id: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    created_at: String(row.created_at),
  }));

  // Anchor running total so the final movement always reconciles to live SUM(batch.quantity)
  const totalDeltaSum = parsedMovements.reduce((sum, m) => sum + m.delta, 0);
  let runningTotalStock = totalStock - totalDeltaSum;

  // Also track per-batch running quantity anchored to each batch's current live quantity
  const batchDeltaSums = new Map<number, number>();
  for (const m of parsedMovements) {
    if (m.batch_id !== null) {
      batchDeltaSums.set(m.batch_id, (batchDeltaSums.get(m.batch_id) ?? 0) + m.delta);
    }
  }

  const runningBatchStock = new Map<number, number>();
  for (const b of batches) {
    const sumForBatch = batchDeltaSums.get(b.id) ?? 0;
    runningBatchStock.set(b.id, b.quantity - sumForBatch);
  }

  const historyChronological: StockMovementHistoryEntry[] = [];
  for (const m of parsedMovements) {
    runningTotalStock += m.delta;
    let resultingBatchQty: number | null = null;
    if (m.batch_id !== null) {
      const prevBatchQty = runningBatchStock.get(m.batch_id) ?? 0;
      const nextBatchQty = prevBatchQty + m.delta;
      runningBatchStock.set(m.batch_id, nextBatchQty);
      resultingBatchQty = nextBatchQty;
    }

    historyChronological.push({
      ...m,
      resulting_quantity: runningTotalStock,
      resulting_batch_quantity: resultingBatchQty,
    });
  }

  // Return newest movements first so the pharmacist immediately sees the latest action at the top
  return historyChronological.reverse();
}
