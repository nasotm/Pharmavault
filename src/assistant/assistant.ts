import {
  queryExpiringSoonDashboard,
  queryLowStockDashboard,
  queryTopDispensedMedications,
  type ExpiringBatchRow,
  type ExpiringMedicationGroup,
  type LowStockDashboardRow,
  type TopDispensedMedicationRow,
} from '../dashboards/operational-dashboards';
export { queryTopDispensedMedications, type TopDispensedMedicationRow };
import type { DatabasePort, SqlParam } from '../db/port';
import {
  getMedicationById,
  getTotalStock,
  listBatchesForMedication,
  type Medication,
} from '../db/repository';
import {
  evaluateStandaloneCalculator,
  formatMoneyDisplay,
  type CalculatorEvaluation,
  type CalculatorLineInput,
} from '../pricing/pricing';
import { formatLocationString, searchMedications } from '../search/search';

/**
 * Deliverable 3: Verbatim system prompt required by specification.
 */
export const PHARMACY_ASSISTANT_VERBATIM_PROMPT = `You are a pharmacy inventory assistant. You are read-only.
Never state a price, stock level, location, or expiry date unless it
came from a tool result. If a tool returns null for a price, say the
price is not entered — never substitute 0 or a guess.
Never populate, correct, or infer any catalog field: brand_name,
generic_name, strength, dosage_form, atc_code, manufacturer, barcode.
Never perform arithmetic yourself — always call calc_price.`;

export const PHARMACY_ASSISTANT_SYSTEM_PROMPT = `${PHARMACY_ASSISTANT_VERBATIM_PROMPT}

Additional operational rules:
- You may only call the read-only tools: search_medication, get_stock, list_low_stock, list_expiring, calc_price, get_revenue, find_by_symptom_or_category.
- Use get_revenue(date) to calculate total sales revenue for a specific day (e.g. "today" or "YYYY-MM-DD").
- Use list_expiring(days) to list medications expiring in N days (e.g. 30 or 31 for "this month").
- Use find_by_symptom_or_category(category) to find medications by category or symptom (e.g. "Antibacterial").
- Never invent data; only use tool results.
- Never call or attempt any write function (setPrice, insertMovement, insertMedication, updateMedicationFromImport, updateMedicationLocalInventory, etc.).
- When a user asks to edit, fix, populate, correct, or infer any catalog field (brand_name, generic_name, strength, dosage_form, atc_code, manufacturer, barcode) or modify stock/prices, decline clearly and state that catalog, stock, and price fields are not editable in the read-only assistant.`;

export type AllowedReadOnlyToolName =
  | 'search_medication'
  | 'get_stock'
  | 'list_low_stock'
  | 'list_expiring'
  | 'calc_price'
  | 'get_revenue'
  | 'find_by_symptom_or_category';

/**
 * Deliverable 2 & 4: Strict allow-list of read-only tools.
 * The AI has NO write tools. None.
 */
export const ALLOWED_READ_ONLY_TOOLS: ReadonlySet<string> = new Set<AllowedReadOnlyToolName>([
  'search_medication',
  'get_stock',
  'list_low_stock',
  'list_expiring',
  'calc_price',
  'get_revenue',
  'find_by_symptom_or_category',
]);

/**
 * Explicit list of write operations that must always be rejected and logged if attempted.
 */
export const FORBIDDEN_WRITE_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  'setPrice',
  'insertMovement',
  'receiveStock',
  'dispenseStock',
  'postOffsetMovement',
  'savePharmacistManualPrice',
  'confirmExistingMedicationPrice',
  'insertMedication',
  'updateMedicationLocalInventory',
  'updateMedicationFromImport',
  'deleteMedication',
  'insertBatch',
  'updateBatchQuantity',
  'deleteBatch',
  'insertAlias',
  'deleteAlias',
  'insertPriceHistory',
]);

export const CATALOG_IMMUTABLE_FIELDS = [
  'brand_name',
  'generic_name',
  'strength',
  'dosage_form',
  'atc_code',
  'manufacturer',
  'barcode',
] as const;

export interface SearchMedicationToolHit {
  id: number;
  name: string;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  location: string;
  location_note: string | null;
  total_qty: number;
  unit_price_cents: number | null;
  unit_price_display: string;
  currency: string;
  price_confirmed: 0 | 1;
  price_source: string | null;
}

export interface SearchMedicationToolOutput {
  query: string;
  matched_layer: string | null;
  results: SearchMedicationToolHit[];
}

export interface GetStockBatchEntry {
  batch_id: number;
  lot_number: string | null;
  quantity: number;
  expiry_date: string | null;
}

export interface GetStockToolOutput {
  medication_id: number;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  location: string;
  location_note: string | null;
  total_qty: number;
  unit_price_cents: number | null;
  unit_price_display: string;
  batches: GetStockBatchEntry[];
}

export interface ListLowStockToolOutput {
  count: number;
  rows: LowStockDashboardRow[];
}

export interface ListExpiringToolOutput {
  days: number;
  reference_date: string;
  count: number;
  batches: ExpiringBatchRow[];
  groups: ExpiringMedicationGroup[];
}

export interface CalcPriceItemInput {
  medication_id?: number;
  query?: string;
  quantity: number;
}

export interface CalcPriceToolOutput {
  evaluation: CalculatorEvaluation;
  unresolved_queries: string[];
}

export interface GetRevenueLineItem {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  units_sold: number;
  transaction_count: number;
  unit_price_cents: number | null;
  unit_price_display: string;
  line_revenue_cents: number | null;
  line_revenue_display: string;
  currency: string;
}

export interface GetRevenueToolOutput {
  date: string;
  requested_date: string;
  total_revenue_cents: number;
  total_revenue_display: string;
  total_units_sold: number;
  transaction_count: number;
  currency: string;
  has_unpriced_dispenses: boolean;
  unpriced_medications: string[];
  items: GetRevenueLineItem[];
}

export interface CategoryMedicationHit {
  id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  category: string | null;
  atc_code: string | null;
  location: string;
  location_note: string | null;
  total_qty: number;
  unit_price_cents: number | null;
  unit_price_display: string;
  currency: string;
}

export interface FindBySymptomOrCategoryToolOutput {
  category: string;
  matched_terms: string[];
  count: number;
  medications: CategoryMedicationHit[];
}

export interface AssistantToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ExecutedToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  allowed: boolean;
  status: 'executed' | 'rejected_by_guard' | 'error';
  result: unknown;
  error?: string;
  timestamp: string;
}

export interface AssistantRequestLogEntry {
  id: string;
  timestamp: string;
  userPrompt: string;
  responseText: string;
  toolCalls: ExecutedToolCallRecord[];
  status: 'ok' | 'declined_write' | 'rejected_tool_call' | 'rate_limited' | 'offline_error';
  durationMs: number;
}

export class AssistantModelUnreachableError extends Error {
  constructor(message = 'AI model endpoint is unreachable') {
    super(message);
    this.name = 'AssistantModelUnreachableError';
  }
}

export class AssistantRateLimitError extends Error {
  public readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'AssistantRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Defense-in-depth read-only wrapper around DatabasePort.
 * Even within an allowed tool call, `exec()`, `transaction()`, and any non-SELECT query are blocked.
 */
export function createReadOnlyDatabaseGuard(db: DatabasePort): DatabasePort {
  return {
    async query<T = Record<string, SqlParam>>(
      sql: string,
      params?: readonly SqlParam[],
    ): Promise<T[]> {
      const normalizedSql = sql.trim().replace(/^\/\*[\s\S]*?\*\/\s*/g, '').trim();
      if (!/^(SELECT|WITH)\b/i.test(normalizedSql)) {
        throw new Error(
          `[AI Read-Only Guard] Blocked non-SELECT SQL statement in assistant tool: ${normalizedSql.slice(0, 60)}`,
        );
      }
      if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE)\b/i.test(normalizedSql)) {
        throw new Error(
          `[AI Read-Only Guard] Blocked mutating SQL keyword in assistant tool: ${normalizedSql.slice(0, 60)}`,
        );
      }
      return db.query<T>(sql, params);
    },
    async exec(): Promise<void> {
      throw new Error('[AI Read-Only Guard] db.exec() is strictly prohibited in the AI layer.');
    },
    async transaction<T>(): Promise<T> {
      throw new Error(
        '[AI Read-Only Guard] db.transaction() is strictly prohibited in the AI layer.',
      );
    },
    async close(): Promise<void> {
      // No-op: assistant never closes the shared database port
    },
  };
}

const REQUEST_LOG_STORAGE_KEY = 'pharmavault_ai_request_logs_v1';
const GUARD_AUDIT_STORAGE_KEY = 'pharmavault_ai_guard_rejections_v1';

let inMemoryRequestLogs: AssistantRequestLogEntry[] = [];
let inMemoryGuardRejections: ExecutedToolCallRecord[] = [];

export function getAssistantRequestLogs(): AssistantRequestLogEntry[] {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(REQUEST_LOG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AssistantRequestLogEntry[];
        if (Array.isArray(parsed)) {
          inMemoryRequestLogs = parsed;
        }
      }
    } catch {
      // ignore storage parse issues
    }
  }
  return [...inMemoryRequestLogs];
}

export function appendAssistantRequestLog(entry: AssistantRequestLogEntry): void {
  inMemoryRequestLogs = [entry, ...inMemoryRequestLogs].slice(0, 100);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(REQUEST_LOG_STORAGE_KEY, JSON.stringify(inMemoryRequestLogs));
    } catch {
      // ignore quota issues
    }
  }
}

export function clearAssistantRequestLogs(): void {
  inMemoryRequestLogs = [];
  inMemoryGuardRejections = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(REQUEST_LOG_STORAGE_KEY);
      window.localStorage.removeItem(GUARD_AUDIT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function getGuardRejectionLogs(): ExecutedToolCallRecord[] {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(GUARD_AUDIT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExecutedToolCallRecord[];
        if (Array.isArray(parsed)) {
          inMemoryGuardRejections = parsed;
        }
      }
    } catch {
      // ignore
    }
  }
  return [...inMemoryGuardRejections];
}

function recordGuardRejection(record: ExecutedToolCallRecord): void {
  inMemoryGuardRejections = [record, ...inMemoryGuardRejections].slice(0, 100);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        GUARD_AUDIT_STORAGE_KEY,
        JSON.stringify(inMemoryGuardRejections),
      );
    } catch {
      // ignore
    }
  }
}

/**
 * Deliverable 6: Sliding-window local rate limiter.
 */
export class AssistantRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 12, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  public checkAndRecord(nowMs = Date.now()): {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
  } {
    const cutoff = nowMs - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);

    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldest + this.windowMs - nowMs);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
      };
    }

    this.timestamps.push(nowMs);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - this.timestamps.length),
      retryAfterMs: 0,
    };
  }

  public reset(): void {
    this.timestamps = [];
  }

  public getStatus(nowMs = Date.now()): { used: number; max: number; remaining: number } {
    const cutoff = nowMs - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
    return {
      used: this.timestamps.length,
      max: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - this.timestamps.length),
    };
  }
}

export const defaultAssistantRateLimiter = new AssistantRateLimiter(12, 60_000);

/**
 * Deliverable 2 & 4: Runtime Guard + Tool Execution.
 * Every tool call is checked against `ALLOWED_READ_ONLY_TOOLS`.
 * Any attempt to reach `setPrice`, `insertMovement`, or any catalog/stock/price write
 * is rejected and logged, NEVER executed.
 */
export async function executeGuardedToolCall(
  db: DatabasePort,
  toolCall: AssistantToolCallRequest,
  options: {
    referenceTimestamp?: string;
    referenceDate?: string;
  } = {},
): Promise<ExecutedToolCallRecord> {
  const timestamp = new Date().toISOString();
  const id = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const rawName = String(toolCall.name ?? '').trim();
  const args = toolCall.args ?? {};

  // Runtime Allow-List Guard Check
  if (!ALLOWED_READ_ONLY_TOOLS.has(rawName) || FORBIDDEN_WRITE_FUNCTIONS.has(rawName)) {
    const isWriteAttempt =
      FORBIDDEN_WRITE_FUNCTIONS.has(rawName) ||
      /^(set|insert|update|delete|create|remove|write|save|confirm|dispense|receive|fix|edit)/i.test(
        rawName,
      );

    const errorMsg = isWriteAttempt
      ? `Runtime Guard Blocked Write Tool "${rawName}": The AI assistant is strictly read-only and cannot call ${rawName} or modify price, stock, or catalog records.`
      : `Runtime Guard Blocked Unlisted Tool "${rawName}": Tool is not in the read-only allow-list (${Array.from(ALLOWED_READ_ONLY_TOOLS).join(', ')}).`;

    const rejectedRecord: ExecutedToolCallRecord = {
      id,
      name: rawName,
      args,
      allowed: false,
      status: 'rejected_by_guard',
      result: null,
      error: errorMsg,
      timestamp,
    };
    recordGuardRejection(rejectedRecord);
    return rejectedRecord;
  }

  // Wrap db in read-only guard so even allowed tools cannot execute mutating SQL
  const readOnlyDb = createReadOnlyDatabaseGuard(db);

  try {
    switch (rawName as AllowedReadOnlyToolName) {
      case 'search_medication': {
        const query = String(args.query ?? '').trim();
        const searchResp = await searchMedications(readOnlyDb, query);
        const results: SearchMedicationToolHit[] = searchResp.results.map((item) => ({
          id: item.medication.id,
          name: item.medication.brand_name,
          brand_name: item.medication.brand_name,
          generic_name: item.medication.generic_name,
          strength: item.medication.strength,
          dosage_form: item.medication.dosage_form,
          location: item.locationDisplay,
          location_note: item.medication.location_note,
          total_qty: item.totalStock,
          unit_price_cents: item.medication.unit_price_cents,
          unit_price_display:
            item.medication.unit_price_cents === null
              ? 'price not entered'
              : item.unitPriceDisplay,
          currency: item.medication.currency,
          price_confirmed: item.medication.price_confirmed,
          price_source: item.medication.price_source,
        }));

        const output: SearchMedicationToolOutput = {
          query,
          matched_layer: searchResp.matchedLayer,
          results,
        };

        return {
          id,
          name: rawName,
          args,
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'get_stock': {
        const medicationId = Number(args.medication_id);
        if (!Number.isInteger(medicationId) || medicationId <= 0) {
          throw new Error(`Invalid medication_id: ${String(args.medication_id)}`);
        }

        const [medication, totalQty, batches] = await Promise.all([
          getMedicationById(readOnlyDb, medicationId),
          getTotalStock(readOnlyDb, medicationId),
          listBatchesForMedication(readOnlyDb, medicationId),
        ]);

        if (!medication) {
          return {
            id,
            name: rawName,
            args,
            allowed: true,
            status: 'executed',
            result: {
              medication_id: medicationId,
              found: false,
              error: `Medication #${medicationId} not found`,
            },
            timestamp,
          };
        }

        const output: GetStockToolOutput = {
          medication_id: medication.id,
          name: medication.brand_name,
          strength: medication.strength,
          dosage_form: medication.dosage_form,
          location: formatLocationString(medication),
          location_note: medication.location_note,
          total_qty: totalQty,
          unit_price_cents: medication.unit_price_cents,
          unit_price_display:
            medication.unit_price_cents === null
              ? 'price not entered'
              : formatMoneyDisplay(medication.unit_price_cents, medication.currency, {
                  includeCentsSuffix: true,
                }),
          batches: batches.map((b) => ({
            batch_id: b.id,
            lot_number: b.lot_number,
            quantity: b.quantity,
            expiry_date: b.expiry_date,
          })),
        };

        return {
          id,
          name: rawName,
          args,
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'list_low_stock': {
        const rows = await queryLowStockDashboard(readOnlyDb, {
          referenceTimestamp: options.referenceTimestamp,
        });
        const output: ListLowStockToolOutput = {
          count: rows.length,
          rows,
        };
        return {
          id,
          name: rawName,
          args,
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'list_expiring': {
        const rawDays = args.days !== undefined && args.days !== null ? Number(args.days) : 30;
        const days = Number.isInteger(rawDays) && rawDays > 0 ? rawDays : 30;
        const expResult = await queryExpiringSoonDashboard(readOnlyDb, {
          withinDays: days,
          referenceDate: options.referenceDate,
        });
        const output: ListExpiringToolOutput = {
          days: expResult.horizonDays,
          reference_date: expResult.referenceDate,
          count: expResult.batches.length,
          batches: expResult.batches,
          groups: expResult.groups,
        };
        return {
          id,
          name: rawName,
          args: { ...args, days },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'calc_price': {
        const rawItems = Array.isArray(args.items) ? (args.items as CalcPriceItemInput[]) : [];
        const discountPct =
          args.discount_pct !== undefined && args.discount_pct !== null
            ? (args.discount_pct as number | string)
            : 0;
        const taxPct =
          args.tax_pct !== undefined && args.tax_pct !== null
            ? (args.tax_pct as number | string)
            : 0;

        const lineInputs: CalculatorLineInput[] = [];
        const unresolvedQueries: string[] = [];

        for (const item of rawItems) {
          const qty =
            typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0
              ? item.quantity
              : 1;

          let med: Medication | null = null;
          if (typeof item.medication_id === 'number' && Number.isInteger(item.medication_id)) {
            med = await getMedicationById(readOnlyDb, item.medication_id);
          } else if (typeof item.query === 'string' && item.query.trim() !== '') {
            const searched = await searchMedications(readOnlyDb, item.query.trim(), { limit: 1 });
            med = searched.results[0]?.medication ?? null;
          }

          if (!med) {
            unresolvedQueries.push(
              item.query ? String(item.query) : `medication_id:${String(item.medication_id)}`,
            );
            continue;
          }

          lineInputs.push({
            medicationId: med.id,
            brandName: med.brand_name,
            genericName: med.generic_name,
            strength: med.strength,
            dosageForm: med.dosage_form,
            // CRITICAL: Preserve NULL as null; never substitute 0
            unitPriceCents: med.unit_price_cents,
            currency: med.currency,
            quantity: qty,
          });
        }

        const evaluation = evaluateStandaloneCalculator({
          items: lineInputs,
          discountPercent: discountPct,
          taxPercent: taxPct,
        });

        const output: CalcPriceToolOutput = {
          evaluation,
          unresolved_queries: unresolvedQueries,
        };

        return {
          id,
          name: rawName,
          args: {
            items: rawItems,
            discount_pct: discountPct,
            tax_pct: taxPct,
          },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'get_revenue': {
        const requestedDate =
          args.date !== undefined && args.date !== null && String(args.date).trim() !== ''
            ? String(args.date).trim()
            : 'today';
        const resolvedDate = resolveRevenueTargetDate(
          requestedDate,
          options.referenceDate ?? options.referenceTimestamp,
        );
        const output = await queryDailyRevenue(readOnlyDb, resolvedDate, requestedDate);
        return {
          id,
          name: rawName,
          args: { ...args, date: resolvedDate, requested_date: requestedDate },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'find_by_symptom_or_category': {
        const category = String(args.category ?? args.symptom ?? '').trim();
        const output = await queryMedicationsBySymptomOrCategory(readOnlyDb, category);
        return {
          id,
          name: rawName,
          args: { ...args, category },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }
    }
  } catch (err) {
    return {
      id,
      name: rawName,
      args,
      allowed: true,
      status: 'error',
      result: null,
      error: err instanceof Error ? err.message : String(err),
      timestamp,
    };
  }
}

/**
 * Resolves a date argument ("today", "yesterday", or "YYYY-MM-DD") into a canonical YYYY-MM-DD date string.
 */
export function resolveRevenueTargetDate(
  dateArg: unknown,
  referenceDateOrTimestamp?: string,
): string {
  const refIso = (referenceDateOrTimestamp ?? new Date().toISOString()).slice(0, 10);
  const raw = typeof dateArg === 'string' ? dateArg.trim().toLowerCase() : '';

  if (!raw || raw === 'today' || raw === 'now') {
    return refIso;
  }

  if (raw === 'yesterday') {
    const baseDate = new Date(`${refIso}T12:00:00.000Z`);
    if (!Number.isNaN(baseDate.getTime())) {
      baseDate.setUTCDate(baseDate.getUTCDate() - 1);
      return baseDate.toISOString().slice(0, 10);
    }
    return refIso;
  }

  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  return refIso;
}

const DAILY_REVENUE_SQL = `
SELECT
  m.id AS medication_id,
  m.brand_name,
  m.generic_name,
  m.strength,
  m.dosage_form,
  m.unit_price_cents,
  m.currency,
  COALESCE(SUM(-sm.delta), 0) AS units_sold,
  COUNT(sm.id) AS transaction_count,
  CASE
    WHEN m.unit_price_cents IS NOT NULL
      THEN COALESCE(SUM(-sm.delta), 0) * m.unit_price_cents
    ELSE NULL
  END AS line_revenue_cents
FROM stock_movement sm
INNER JOIN medication m ON m.id = sm.medication_id
WHERE sm.delta < 0
  AND (
    LOWER(TRIM(COALESCE(sm.reason, ''))) = 'dispense'
    OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE 'dispense:%'
    OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE '%dispense%'
  )
  AND date(sm.created_at) = date(?)
GROUP BY m.id
ORDER BY
  COALESCE(line_revenue_cents, 0) DESC,
  units_sold DESC,
  m.brand_name ASC;
`;

interface RawDailyRevenueSqlRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  unit_price_cents: number | null;
  currency: string | null;
  units_sold: number;
  transaction_count: number;
  line_revenue_cents: number | null;
}

/**
 * Deterministic SQL query for `get_revenue(date)`:
 * Calculates total sales revenue and per-medication breakdown for a specific YYYY-MM-DD day
 * strictly from `stock_movement` (dispense movements) and `medication.unit_price_cents`.
 * Preserves NULL prices as "price not entered" and never substitutes 0 for an unentered price.
 */
export async function queryDailyRevenue(
  db: DatabasePort,
  resolvedDate: string,
  requestedDate = resolvedDate,
): Promise<GetRevenueToolOutput> {
  const rows = await db.query<RawDailyRevenueSqlRow>(DAILY_REVENUE_SQL, [resolvedDate]);

  let totalRevenueCents = 0;
  let totalUnitsSold = 0;
  let transactionCount = 0;
  let currency = 'USD';
  const unpricedMedications: string[] = [];

  const items: GetRevenueLineItem[] = rows.map((row) => {
    const unitsSold = Number(row.units_sold);
    const txCount = Number(row.transaction_count);
    const rowCurrency = row.currency ? String(row.currency) : 'USD';
    currency = rowCurrency;

    const unitPriceCents =
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents);
    const lineRevenueCents =
      row.line_revenue_cents === null || row.line_revenue_cents === undefined
        ? null
        : Number(row.line_revenue_cents);

    totalUnitsSold += unitsSold;
    transactionCount += txCount;

    if (lineRevenueCents !== null) {
      totalRevenueCents += lineRevenueCents;
    } else {
      unpricedMedications.push(String(row.brand_name));
    }

    return {
      medication_id: Number(row.medication_id),
      brand_name: String(row.brand_name),
      generic_name:
        row.generic_name === null || row.generic_name === undefined
          ? null
          : String(row.generic_name),
      strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
      dosage_form:
        row.dosage_form === null || row.dosage_form === undefined ? null : String(row.dosage_form),
      units_sold: unitsSold,
      transaction_count: txCount,
      unit_price_cents: unitPriceCents,
      unit_price_display:
        unitPriceCents === null
          ? 'price not entered'
          : formatMoneyDisplay(unitPriceCents, rowCurrency, { includeCentsSuffix: false }),
      line_revenue_cents: lineRevenueCents,
      line_revenue_display:
        lineRevenueCents === null
          ? 'price not entered'
          : formatMoneyDisplay(lineRevenueCents, rowCurrency, { includeCentsSuffix: false }),
      currency: rowCurrency,
    };
  });

  return {
    date: resolvedDate,
    requested_date: requestedDate,
    total_revenue_cents: totalRevenueCents,
    total_revenue_display: formatMoneyDisplay(totalRevenueCents, currency, {
      includeCentsSuffix: false,
    }),
    total_units_sold: totalUnitsSold,
    transaction_count: transactionCount,
    currency,
    has_unpriced_dispenses: unpricedMedications.length > 0,
    unpriced_medications: unpricedMedications,
    items,
  };
}

const SYMPTOM_OR_CATEGORY_SYNONYMS: readonly {
  triggers: readonly string[];
  categoryKeywords: readonly string[];
  atcPrefixes: readonly string[];
}[] = [
  {
    triggers: [
      'antibacterial',
      'antibacterials',
      'antibiotic',
      'antibiotics',
      'anti-bacterial',
      'anti-infective',
      'infection',
      'bacterial',
      'antimicrobial',
    ],
    categoryKeywords: ['antibacterial', 'antibiotic'],
    atcPrefixes: ['J01'],
  },
  {
    triggers: [
      'analgesic',
      'analgesics',
      'antipyretic',
      'antipyretics',
      'pain',
      'painkiller',
      'painkillers',
      'fever',
      'headache',
      'ache',
      'anti-inflammatory',
    ],
    categoryKeywords: ['analgesic', 'antipyretic', 'anti-inflammatory'],
    atcPrefixes: ['N02', 'M01'],
  },
  {
    triggers: [
      'bronchodilator',
      'bronchodilators',
      'asthma',
      'respiratory',
      'breathing',
      'wheezing',
      'inhaler',
      'copd',
    ],
    categoryKeywords: ['bronchodilator', 'respiratory'],
    atcPrefixes: ['R03'],
  },
  {
    triggers: [
      'antidiabetic',
      'antidiabetics',
      'diabetes',
      'diabetic',
      'insulin',
      'basal insulin',
      'blood sugar',
      'glucose',
    ],
    categoryKeywords: ['antidiabetic', 'insulin'],
    atcPrefixes: ['A10'],
  },
  {
    triggers: [
      'lipid',
      'lipid-modifying',
      'cholesterol',
      'statin',
      'statins',
      'cardiovascular',
      'heart',
      'hypertension',
      'blood pressure',
    ],
    categoryKeywords: ['lipid', 'cardiovascular'],
    atcPrefixes: ['C10', 'C07', 'C09'],
  },
];

/**
 * Expands a category or symptom query (e.g. "Antibacterial") into deterministic SQL category
 * substrings and ATC prefixes so related catalog records (e.g. "Antibiotic" / ATC J01) are matched.
 */
export function expandCategoryOrSymptomTerms(rawCategory: string): {
  cleanedCategory: string;
  matchedTerms: string[];
  atcPrefixes: string[];
} {
  const cleanedCategory = rawCategory.trim().replace(/[?!.,;]+$/g, '').trim();
  const lower = cleanedCategory.toLowerCase();

  if (!lower) {
    return { cleanedCategory: '', matchedTerms: [], atcPrefixes: [] };
  }

  const matchedTerms = new Set<string>([lower]);
  const atcPrefixes = new Set<string>();

  for (const group of SYMPTOM_OR_CATEGORY_SYNONYMS) {
    const matchedGroup = group.triggers.some(
      (trigger) => lower === trigger || lower.includes(trigger) || trigger.includes(lower),
    );
    if (matchedGroup) {
      for (const kw of group.categoryKeywords) {
        matchedTerms.add(kw);
      }
      for (const prefix of group.atcPrefixes) {
        atcPrefixes.add(prefix.toUpperCase());
      }
    }
  }

  return {
    cleanedCategory,
    matchedTerms: Array.from(matchedTerms),
    atcPrefixes: Array.from(atcPrefixes),
  };
}

interface RawCategoryMedicationSqlRow {
  id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  category: string | null;
  atc_code: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  location_note: string | null;
  unit_price_cents: number | null;
  currency: string | null;
  total_qty: number;
}

/**
 * Deterministic SQL query for `find_by_symptom_or_category(category)`:
 * Finds medications matching the requested category or symptom strictly from SQLite.
 */
export async function queryMedicationsBySymptomOrCategory(
  db: DatabasePort,
  rawCategory: string,
): Promise<FindBySymptomOrCategoryToolOutput> {
  const { cleanedCategory, matchedTerms, atcPrefixes } = expandCategoryOrSymptomTerms(rawCategory);

  if (!cleanedCategory || matchedTerms.length === 0) {
    return {
      category: rawCategory.trim(),
      matched_terms: [],
      count: 0,
      medications: [],
    };
  }

  const predicates: string[] = [];
  const params: SqlParam[] = [];

  for (const term of matchedTerms) {
    const likePattern = `%${term}%`;
    predicates.push('LOWER(COALESCE(m.category, \'\')) LIKE ?');
    params.push(likePattern);
    predicates.push('LOWER(COALESCE(m.location_note, \'\')) LIKE ?');
    params.push(likePattern);
  }

  for (const prefix of atcPrefixes) {
    predicates.push('UPPER(COALESCE(m.atc_code, \'\')) LIKE ?');
    params.push(`${prefix}%`);
  }

  const sql = `
    SELECT
      m.id,
      m.brand_name,
      m.generic_name,
      m.strength,
      m.dosage_form,
      m.category,
      m.atc_code,
      m.zone,
      m.shelf,
      m.bin,
      m.location_note,
      m.unit_price_cents,
      m.currency,
      COALESCE(SUM(b.quantity), 0) AS total_qty
    FROM medication m
    LEFT JOIN batch b ON b.medication_id = m.id
    WHERE (${predicates.join(' OR ')})
    GROUP BY m.id
    ORDER BY m.brand_name ASC, m.id ASC
    LIMIT 25;
  `;

  const rows = await db.query<RawCategoryMedicationSqlRow>(sql, params);

  const medications: CategoryMedicationHit[] = rows.map((row) => {
    const currency = row.currency ? String(row.currency) : 'USD';
    const unitPriceCents =
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents);

    return {
      id: Number(row.id),
      brand_name: String(row.brand_name),
      generic_name:
        row.generic_name === null || row.generic_name === undefined
          ? null
          : String(row.generic_name),
      strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
      dosage_form:
        row.dosage_form === null || row.dosage_form === undefined ? null : String(row.dosage_form),
      category: row.category === null || row.category === undefined ? null : String(row.category),
      atc_code: row.atc_code === null || row.atc_code === undefined ? null : String(row.atc_code),
      location: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
      location_note:
        row.location_note === null || row.location_note === undefined
          ? null
          : String(row.location_note),
      total_qty: Number(row.total_qty),
      unit_price_cents: unitPriceCents,
      unit_price_display:
        unitPriceCents === null
          ? 'price not entered'
          : formatMoneyDisplay(unitPriceCents, currency, { includeCentsSuffix: true }),
      currency,
    };
  });

  return {
    category: cleanedCategory,
    matched_terms: matchedTerms,
    count: medications.length,
    medications,
  };
}

/**
 * Detects whether a user question is attempting to edit, fix, populate, correct, or infer
 * any catalog field (`brand_name`, `generic_name`, `strength`, `dosage_form`, `atc_code`,
 * `manufacturer`, `barcode`) or mutate stock/prices.
 */
export function detectWriteOrCatalogEditIntent(userMessage: string): {
  isDeclinedIntent: boolean;
  reason: string | null;
} {
  const text = userMessage.trim();

  // Check catalog field edit / populate / infer requests
  const catalogEditVerbPattern =
    /\b(fix|edit|update|change|set|populate|correct|infer|fill\s+in|modify|assign|replace|write|add)\b/i;
  const catalogFieldPattern =
    /\b(atc\s*code|atc_code|atc|brand\s*name|brand_name|generic\s*name|generic_name|dosage\s*form|dosage_form|strength|manufacturer|barcode|catalog)\b/i;

  if (catalogEditVerbPattern.test(text) && catalogFieldPattern.test(text)) {
    return {
      isDeclinedIntent: true,
      reason:
        'I am a read-only pharmacy inventory assistant. Catalog fields (brand_name, generic_name, strength, dosage_form, atc_code, manufacturer, barcode) are not editable here, and I never populate, correct, or infer catalog data.',
    };
  }

  // Check price or stock mutation requests
  const priceOrStockWritePattern =
    /\b(set\s+price|change\s+price|update\s+price|confirm\s+price|dispense\s+\d+|receive\s+\d+|add\s+stock|decrement\s+stock|delete\s+batch|insert\s+movement)\b/i;
  if (priceOrStockWritePattern.test(text)) {
    return {
      isDeclinedIntent: true,
      reason:
        'I am a read-only pharmacy inventory assistant. I cannot modify prices, confirm prices, or record stock movements. Please use the Medication Detail & Price Editor or Stock Movement panel directly.',
    };
  }

  return { isDeclinedIntent: false, reason: null };
}

/**
 * Extracts a clean medication search query from natural language questions
 * such as "where are the amoxicillin capsules" or "how much is Lantus SoloStar?".
 */
export function extractMedicationQueryFromPrompt(
  prompt: string,
  fallbackMedicationName?: string | null,
): string {
  const cleaned = prompt
    .replace(/[?!.,;]+$/g, '')
    .trim();

  if (/\b(this|it|that\s+item|selected\s+item|selected\s+medication)\b/i.test(cleaned) && fallbackMedicationName) {
    return fallbackMedicationName;
  }

  let candidate = cleaned
    .replace(
      /^(?:can\s+you\s+tell\s+me\s+|please\s+tell\s+me\s+|tell\s+me\s+|check\s+)?(?:where\s+(?:are|is)\s+(?:the\s+)?|what\s+is\s+the\s+(?:price|stock|location)\s+(?:of|for)\s+(?:the\s+)?|how\s+much\s+(?:is|are|for)\s+(?:\d+\s+(?:boxes|packs|units|bottles|pens|vials|tablets|capsules)\s+of\s+)?(?:the\s+)?|how\s+many\s+)(.+?)$/i,
      '$1',
    )
    .replace(/\b(?:with\s+\d+(?:[.,]\d+)?\s*%\s*(?:off|discount).*)$/i, '')
    .replace(/\b(?:plus\s+\d+(?:[.,]\d+)?\s*%\s*tax.*)$/i, '')
    .replace(/\b(?:in\s+stock|do\s+we\s+have|left|available|right\s+now|today)\b.*$/i, '')
    .replace(/\b(?:capsules|capsule|tablets|tablet|inhalers|inhaler|pens|pen|drops|cream)\b$/i, '')
    .trim();

  if (!candidate || candidate.length < 2) {
    candidate = fallbackMedicationName || cleaned;
  }

  return candidate;
}

/**
 * Extracts a category or symptom query from natural language questions such as
 * "Find Antibacterial medications", "What do we have in category Antibacterial?",
 * or "What medications do we have for pain or fever?".
 */
export function extractCategoryOrSymptomFromPrompt(prompt: string): string | null {
  const cleaned = prompt.replace(/[?!.,;]+$/g, '').trim();

  // 1. Explicit "category <X>" or "by category: <X>" or "symptom <X>"
  const explicitMatch = cleaned.match(
    /\b(?:by\s+category|in\s+category|category|by\s+symptom|symptom)\s*[:=]?\s*["']?([a-z0-9\s/-]+?)["']?(?:\s+(?:medications?|drugs?|items?|products?))?$/i,
  );
  if (explicitMatch && explicitMatch[1]?.trim()) {
    return explicitMatch[1].trim();
  }

  // 2. Known clinical categories or symptom keywords
  const categoryKeywordMatch = cleaned.match(
    /\b(antibacterials?|antibiotics?|anti-bacterials?|analgesics?|antipyretics?|bronchodilators?|antidiabetics?|lipid-modifying(?:\s+agents?)?|cardiovascular|respiratory|dermatology|gastrointestinal|neurology|musculoskeletal|ophthalmology|anti-inflammatory|painkillers?)\b/i,
  );
  if (categoryKeywordMatch && categoryKeywordMatch[1]) {
    return categoryKeywordMatch[1].trim();
  }

  // 3. Symptom phrasing: "medications for <symptom>", "what do we have for <symptom>", "treat <symptom>"
  const symptomPhraseMatch = cleaned.match(
    /\b(?:medications?\s+for|drugs?\s+for|what\s+(?:do\s+we\s+have|is\s+available|medications?)\s+for|used\s+for|to\s+treat|for\s+treating)\s+["']?([a-z\s-]+?)["']?$/i,
  );
  if (symptomPhraseMatch && symptomPhraseMatch[1]?.trim()) {
    return symptomPhraseMatch[1].trim();
  }

  return null;
}

/**
 * Deterministic tool planner that maps natural language questions to the read-only tools:
 * - `search_medication`
 * - `get_stock`
 * - `list_low_stock`
 * - `list_expiring`
 * - `calc_price`
 * - `get_revenue`
 * - `find_by_symptom_or_category`
 */
export function planReadOnlyToolCalls(
  userMessage: string,
  options: {
    contextMedicationId?: number | null;
    contextMedicationName?: string | null;
  } = {},
): AssistantToolCallRequest[] {
  const lower = userMessage.toLowerCase().trim();

  // 1. Check write/catalog edit refusal first -> 0 tool calls
  const writeCheck = detectWriteOrCatalogEditIntent(userMessage);
  if (writeCheck.isDeclinedIntent) {
    return [];
  }

  // 2. Revenue / daily sales queries ("How much did we sell today?", "What is our revenue for 2026-10-26?")
  if (
    /\b(revenue|total\s+sales|daily\s+sales|sales\s+today|sales\s+yesterday|sales\s+for|sales\s+on|how\s+much\s+did\s+we\s+sell|what\s+did\s+we\s+sell|how\s+much\s+have\s+we\s+sold|how\s+much\s+was\s+sold|sold\s+today|sold\s+yesterday|sell\s+today|sell\s+yesterday|sell\s+on)\b/i.test(
      lower,
    )
  ) {
    const explicitDateMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    let dateArg = 'today';
    if (explicitDateMatch) {
      dateArg = explicitDateMatch[1];
    } else if (/\byesterday\b/i.test(lower)) {
      dateArg = 'yesterday';
    }
    return [{ name: 'get_revenue', args: { date: dateArg } }];
  }

  // 3. Low stock queries ("what's running low", "low stock", "reorder")
  if (
    /\b(running\s+low|low\s+stock|low-stock|need\s+to\s+reorder|below\s+reorder|out\s+of\s+stock|shortage)\b/i.test(
      lower,
    )
  ) {
    return [{ name: 'list_low_stock', args: {} }];
  }

  // 4. Expiring queries ("What is expiring this month?", "what expires this month", "expiring in 60 days")
  if (/\b(expir(?:e|es|ing)|this\s+month|next\s+month|soon\s+to\s+expire)\b/i.test(lower)) {
    let days = 90;
    const daysMatch = lower.match(/\b(\d+)\s*days?\b/);
    if (daysMatch) {
      days = Number(daysMatch[1]);
    } else if (/\bthis\s+month\b/i.test(lower)) {
      days = 31;
    } else if (/\bthis\s+week\b/i.test(lower)) {
      days = 7;
    } else if (/\b60\s*days?\b|\btwo\s+months?\b|\bnext\s+month\b/i.test(lower)) {
      days = 60;
    }
    return [{ name: 'list_expiring', args: { days } }];
  }

  // 5. Symptom or category queries ("Find Antibacterial medications", "Medications by category Antibacterial")
  const categoryQuery = extractCategoryOrSymptomFromPrompt(userMessage);
  if (categoryQuery) {
    return [{ name: 'find_by_symptom_or_category', args: { category: categoryQuery } }];
  }

  // 6. Price calculation / "how much" queries
  if (/\b(how\s+much|price|cost|total|calculate|calc|discount|%\s*off|tax)\b/i.test(lower)) {
    const qtyMatch = lower.match(
      /\b(\d+)\s*(?:boxes|box|packs|pack|units|unit|pens|pen|bottles|vials|x|of)\b/i,
    );
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;

    const discountMatch =
      lower.match(/\b(\d+(?:[.,]\d+)?)\s*%\s*(?:off|discount)\b/i) ||
      lower.match(/\bdiscount\s*(?:of\s*)?(\d+(?:[.,]\d+)?)\s*%/i);
    const discountPct = discountMatch ? Number(discountMatch[1].replace(',', '.')) : 0;

    const taxMatch =
      lower.match(/\b(\d+(?:[.,]\d+)?)\s*%\s*tax\b/i) ||
      lower.match(/\btax\s*(?:of\s*)?(\d+(?:[.,]\d+)?)\s*%/i);
    const taxPct = taxMatch ? Number(taxMatch[1].replace(',', '.')) : 0;

    const usesContextualRef = /\b(this|it|that\s+item|selected)\b/i.test(lower);
    if (usesContextualRef && options.contextMedicationId) {
      return [
        {
          name: 'calc_price',
          args: {
            items: [{ medication_id: options.contextMedicationId, quantity }],
            discount_pct: discountPct,
            tax_pct: taxPct,
          },
        },
      ];
    }

    const medQuery = extractMedicationQueryFromPrompt(userMessage, options.contextMedicationName);
    return [
      {
        name: 'search_medication',
        args: { query: medQuery },
      },
      {
        name: 'calc_price',
        args: {
          items: [{ query: medQuery, quantity }],
          discount_pct: discountPct,
          tax_pct: taxPct,
        },
      },
    ];
  }

  // 7. Location / stock lookup ("where are the amoxicillin capsules", "how many amoxil", etc.)
  const medQuery = extractMedicationQueryFromPrompt(userMessage, options.contextMedicationName);
  return [
    {
      name: 'search_medication',
      args: { query: medQuery },
    },
  ];
}

/**
 * Formats a grounded, deterministic response strictly from the executed read-only tool calls.
 * Never invents a price, stock level, location, revenue figure, or expiry date.
 * Surfaces NULL prices as "price not entered" — never 0.
 */
export function synthesizeGroundedResponseFromTools(
  userMessage: string,
  executedCalls: readonly ExecutedToolCallRecord[],
): string {
  const writeCheck = detectWriteOrCatalogEditIntent(userMessage);
  if (writeCheck.isDeclinedIntent && writeCheck.reason) {
    return writeCheck.reason;
  }

  const rejected = executedCalls.find((c) => !c.allowed || c.status === 'rejected_by_guard');
  if (rejected) {
    return `Request rejected by runtime read-only guard: ${rejected.error ?? 'Write operations are prohibited.'}`;
  }

  if (executedCalls.length === 0) {
    return 'No read-only tool results were returned for this query.';
  }

  const parts: string[] = [];

  for (const call of executedCalls) {
    if (call.status !== 'executed' || !call.result) {
      continue;
    }

    if (call.name === 'get_revenue') {
      const output = call.result as GetRevenueToolOutput;
      if (output.items.length === 0) {
        parts.push(
          `Total sales revenue for **${output.date}** is **${output.total_revenue_display}** (**0 units** dispensed across **0 transactions**).`,
        );
      } else {
        const itemLines = output.items.map((item) => {
          if (item.unit_price_cents === null || item.line_revenue_cents === null) {
            return `- **${item.brand_name}** (${item.strength ?? ''}): **${item.units_sold} units** dispensed — **price not entered** (\`unit_price_cents = NULL\`)`;
          }
          return `- **${item.brand_name}** (${item.strength ?? ''}): **${item.units_sold} units** × ${item.unit_price_display} = **${item.line_revenue_display}**`;
        });
        const unpricedWarning = output.has_unpriced_dispenses
          ? `\nNote: ${output.unpriced_medications.join(', ')} has **price not entered** and is excluded from the priced revenue sum.`
          : '';
        parts.push(
          `Total sales revenue for **${output.date}**: **${output.total_revenue_display}** (**${output.total_units_sold} units** sold across **${output.transaction_count} dispense transaction(s)**):\n${itemLines.join('\n')}${unpricedWarning}`,
        );
      }
    } else if (call.name === 'find_by_symptom_or_category') {
      const output = call.result as FindBySymptomOrCategoryToolOutput;
      if (output.medications.length === 0) {
        parts.push(
          `No medications found in the inventory matching category or symptom "${output.category}".`,
        );
      } else {
        const lines = output.medications.map((med) => {
          const priceLabel =
            med.unit_price_cents === null ? 'price not entered' : med.unit_price_display;
          return `- **${med.brand_name}** (${med.generic_name ?? 'N/A'} · ${med.strength ?? ''} · ${med.dosage_form ?? ''}) — Category: **${med.category ?? 'Uncategorized'}** (ATC \`${med.atc_code ?? 'N/A'}\`) · Location: **${med.location}** · Stock: **${med.total_qty} units** · Price: **${priceLabel}**`;
        });
        parts.push(
          `Found **${output.count}** medication(s) matching category/symptom "**${output.category}**":\n${lines.join('\n')}`,
        );
      }
    } else if (call.name === 'list_low_stock') {
      const output = call.result as ListLowStockToolOutput;
      if (output.rows.length === 0) {
        parts.push('No medications are currently at or below their reorder level.');
      } else {
        const lines = output.rows.map((row) => {
          const reorderNote =
            row.reorder_badge === 'suggested' && row.suggested_qty !== null
              ? `Suggested reorder: ${row.suggested_qty} units`
              : 'Badge: low';
          return `- **${row.brand_name}** (${row.generic_name ?? 'N/A'} ${row.strength ?? ''}): **${row.current_qty} units** in stock (reorder level: ${row.reorder_level}) at **${row.location_label}** (${reorderNote})`;
        });
        parts.push(
          `Found **${output.rows.length}** low-stock medication(s) (where current stock <= reorder level):\n${lines.join('\n')}`,
        );
      }
    } else if (call.name === 'list_expiring') {
      const output = call.result as ListExpiringToolOutput;
      if (output.batches.length === 0) {
        parts.push(
          `No active batches are expiring within ${output.days} days of ${output.reference_date}.`,
        );
      } else {
        const lines = output.batches.map(
          (b) =>
            `- **${b.brand_name}** · Lot \`${b.lot_number}\`: **${b.quantity} units** expiring on **${b.expiry_date}** (${b.days_remaining} days remaining) at **${b.location_label}**`,
        );
        parts.push(
          `Batches expiring within **${output.days} days** (reference date ${output.reference_date}):\n${lines.join('\n')}`,
        );
      }
    } else if (call.name === 'calc_price') {
      const output = call.result as CalcPriceToolOutput;
      const ev = output.evaluation;

      if (output.unresolved_queries.length > 0 && ev.lines.length === 0) {
        parts.push(
          `Could not find a matching medication for: ${output.unresolved_queries.join(', ')}.`,
        );
        continue;
      }

      if (ev.hasNullPriceItems) {
        const missingList = ev.nullPriceItems
          .map((item) => `**${item.brandName}** (price not entered)`)
          .join(', ');
        parts.push(
          `The price for ${missingList} is **price not entered** (\`unit_price_cents = NULL\`). Cannot compute a grand total until a pharmacist enters and confirms the price.`,
        );
      } else if (ev.canComputeGrandTotal) {
        const lineSummaries = ev.lines.map(
          (line) =>
            `- ${line.quantity} × **${line.brandName}** @ ${line.unitPriceFormatted} = **${line.lineFinalTotalFormatted}** (subtotal ${line.lineSubtotalFormatted})`,
        );
        parts.push(
          `Price calculation via \`calc_price\`:\n${lineSummaries.join('\n')}\n- Subtotal: **${ev.subtotalFormatted}**\n- Discount (${ev.discountPercentDisplay}%): **-${ev.discountAmountFormatted}**\n- Tax (${ev.taxPercentDisplay}%): **+${ev.taxAmountFormatted}**\n- **Grand Total: ${ev.grandTotalFormatted}**`,
        );
      }
    } else if (call.name === 'get_stock') {
      const maybeTrends = call.result as { top_dispensed?: TopDispensedMedicationRow[] };
      if (Array.isArray(maybeTrends.top_dispensed)) {
        parts.push(synthesizeDispenseTrendInsight(maybeTrends.top_dispensed));
        continue;
      }
      const output = call.result as GetStockToolOutput & { found?: boolean; error?: string };
      if (output.found === false) {
        parts.push(output.error ?? 'Medication not found.');
        continue;
      }
      const batches = Array.isArray(output.batches) ? output.batches : [];
      const batchLines =
        batches.length > 0
          ? batches
              .map(
                (b) =>
                  `Lot \`${b.lot_number ?? 'N/A'}\`: ${b.quantity} units (expires ${b.expiry_date ?? 'N/A'})`,
              )
              .join('; ')
          : 'No active batches';
      const priceText =
        output.unit_price_cents === null ? 'price not entered' : output.unit_price_display;
      parts.push(
        `**${output.name}** (${output.strength ?? ''} ${output.dosage_form ?? ''}) is located at **${output.location}**${output.location_note ? ` (${output.location_note})` : ''}. Total stock: **${output.total_qty} units** (${batchLines}). Unit price: **${priceText}**.`,
      );
    } else if (call.name === 'search_medication') {
      // Only emit search summary if neither get_stock nor calc_price already rendered the detailed answer
      const hasFollowUpStockOrCalc = executedCalls.some(
        (other) =>
          (other.name === 'get_stock' || other.name === 'calc_price') &&
          other.status === 'executed',
      );
      if (!hasFollowUpStockOrCalc) {
        const output = call.result as SearchMedicationToolOutput;
        if (output.results.length === 0) {
          parts.push(`No medications found matching "${output.query}".`);
        } else {
          const lines = output.results.slice(0, 5).map((hit) => {
            const priceLabel =
              hit.unit_price_cents === null ? 'price not entered' : hit.unit_price_display;
            return `- **${hit.brand_name}** (${hit.generic_name ?? 'N/A'} · ${hit.strength ?? ''} · ${hit.dosage_form ?? ''}) — Location: **${hit.location}**${hit.location_note ? ` (${hit.location_note})` : ''} · Stock: **${hit.total_qty} units** · Price: **${priceLabel}**`;
          });
          parts.push(lines.join('\n'));
        }
      }
    }
  }

  return parts.join('\n\n') || 'Completed read-only tool lookup.';
}

export interface RunAssistantTurnOptions {
  contextMedicationId?: number | null;
  contextMedicationName?: string | null;
  referenceTimestamp?: string;
  referenceDate?: string;
  rateLimiter?: AssistantRateLimiter;
  /**
   * Optional custom planner/model bridge (used by browser UI to call `/api/ai/chat`
   * or by unit tests to inject forced tool calls such as `setPrice`).
   */
  forcedToolCalls?: AssistantToolCallRequest[];
  useRemoteModelEndpoint?: boolean;
  simulateOffline?: boolean;
}

export interface AssistantTurnResult {
  userPrompt: string;
  responseText: string;
  toolCalls: ExecutedToolCallRecord[];
  status: AssistantRequestLogEntry['status'];
  logEntry: AssistantRequestLogEntry;
}

/**
 * Runs a complete assistant turn:
 * 1. Rate-limits the request locally.
 * 2. Checks offline status (throws `AssistantModelUnreachableError` if unreachable so UI hides panel).
 * 3. Plans or receives tool calls (via `/api/ai/chat` or local planner / forced test harness calls).
 * 4. Runs every tool call through `executeGuardedToolCall` (enforcing the read-only allow-list).
 * 5. Automatically chains `get_stock` when a location/stock search finds a primary medication match.
 * 6. Synthesizes a grounded response and logs the request/response pair locally.
 */
export async function runAssistantTurn(
  db: DatabasePort,
  userPrompt: string,
  options: RunAssistantTurnOptions = {},
): Promise<AssistantTurnResult> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();
  const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (options.simulateOffline) {
    const err = new AssistantModelUnreachableError('Simulated offline / unreachable AI model');
    const offlineEntry: AssistantRequestLogEntry = {
      id,
      timestamp,
      userPrompt,
      responseText: err.message,
      toolCalls: [],
      status: 'offline_error',
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
    appendAssistantRequestLog(offlineEntry);
    throw err;
  }

  const limiter = options.rateLimiter ?? defaultAssistantRateLimiter;
  const rateCheck = limiter.checkAndRecord();
  if (!rateCheck.allowed) {
    const msg = `Rate limit exceeded. Please wait ${Math.ceil(rateCheck.retryAfterMs / 1000)}s before sending another query.`;
    const rateEntry: AssistantRequestLogEntry = {
      id,
      timestamp,
      userPrompt,
      responseText: msg,
      toolCalls: [],
      status: 'rate_limited',
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
    appendAssistantRequestLog(rateEntry);
    throw new AssistantRateLimitError(msg, rateCheck.retryAfterMs);
  }

  // If forcedToolCalls are provided (e.g. test harness forcing a call to setPrice),
  // run them directly through the runtime guard!
  if (options.forcedToolCalls && options.forcedToolCalls.length > 0) {
    const executedCalls: ExecutedToolCallRecord[] = [];
    for (const tc of options.forcedToolCalls) {
      const record = await executeGuardedToolCall(db, tc, {
        referenceTimestamp: options.referenceTimestamp,
        referenceDate: options.referenceDate,
      });
      executedCalls.push(record);
    }

    const hasRejected = executedCalls.some(
      (c) => !c.allowed || c.status === 'rejected_by_guard',
    );
    const responseText = synthesizeGroundedResponseFromTools(userPrompt, executedCalls);
    const logEntry: AssistantRequestLogEntry = {
      id,
      timestamp,
      userPrompt,
      responseText,
      toolCalls: executedCalls,
      status: hasRejected ? 'rejected_tool_call' : 'ok',
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
    appendAssistantRequestLog(logEntry);
    return {
      userPrompt,
      responseText,
      toolCalls: executedCalls,
      status: logEntry.status,
      logEntry,
    };
  }

  // Check for catalog/price/stock write intent before planning tools
  const writeIntent = detectWriteOrCatalogEditIntent(userPrompt);
  if (writeIntent.isDeclinedIntent && writeIntent.reason) {
    const logEntry: AssistantRequestLogEntry = {
      id,
      timestamp,
      userPrompt,
      responseText: writeIntent.reason,
      toolCalls: [],
      status: 'declined_write',
      durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
    appendAssistantRequestLog(logEntry);
    return {
      userPrompt,
      responseText: writeIntent.reason,
      toolCalls: [],
      status: 'declined_write',
      logEntry,
    };
  }

  let plannedCalls: AssistantToolCallRequest[] = [];
  let remoteModelAnswer: string | null = null;

  if (options.useRemoteModelEndpoint && typeof fetch === 'function') {
    try {
      const planRes = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'plan',
          userMessage: userPrompt,
          contextMedicationId: options.contextMedicationId ?? null,
          contextMedicationName: options.contextMedicationName ?? null,
        }),
      });

      if (!planRes.ok) {
        throw new AssistantModelUnreachableError(
          `AI endpoint returned HTTP ${planRes.status}`,
        );
      }

      const planData = (await planRes.json()) as {
        declined?: boolean;
        declineMessage?: string;
        toolCalls?: AssistantToolCallRequest[];
      };

      if (planData.declined && planData.declineMessage) {
        const logEntry: AssistantRequestLogEntry = {
          id,
          timestamp,
          userPrompt,
          responseText: planData.declineMessage,
          toolCalls: [],
          status: 'declined_write',
          durationMs: Math.round((performance.now() - startTime) * 100) / 100,
        };
        appendAssistantRequestLog(logEntry);
        return {
          userPrompt,
          responseText: planData.declineMessage,
          toolCalls: [],
          status: 'declined_write',
          logEntry,
        };
      }

      if (Array.isArray(planData.toolCalls) && planData.toolCalls.length > 0) {
        plannedCalls = planData.toolCalls;
      }
    } catch (err) {
      const unreachable =
        err instanceof AssistantModelUnreachableError
          ? err
          : new AssistantModelUnreachableError(
              err instanceof Error ? err.message : 'Model endpoint unreachable',
            );
      const offlineEntry: AssistantRequestLogEntry = {
        id,
        timestamp,
        userPrompt,
        responseText: unreachable.message,
        toolCalls: [],
        status: 'offline_error',
        durationMs: Math.round((performance.now() - startTime) * 100) / 100,
      };
      appendAssistantRequestLog(offlineEntry);
      throw unreachable;
    }
  }

  if (plannedCalls.length === 0) {
    plannedCalls = planReadOnlyToolCalls(userPrompt, {
      contextMedicationId: options.contextMedicationId,
      contextMedicationName: options.contextMedicationName,
    });
  }

  const executedCalls: ExecutedToolCallRecord[] = [];
  for (const call of plannedCalls) {
    const record = await executeGuardedToolCall(db, call, {
      referenceTimestamp: options.referenceTimestamp,
      referenceDate: options.referenceDate,
    });
    executedCalls.push(record);

    // If `search_medication` returned a hit and the user asked about location/stock/batches
    // (and `get_stock` or `calc_price` wasn't already planned), chain `get_stock` on the top hit
    if (
      call.name === 'search_medication' &&
      record.status === 'executed' &&
      !plannedCalls.some((c) => c.name === 'get_stock' || c.name === 'calc_price')
    ) {
      const searchOut = record.result as SearchMedicationToolOutput;
      const topHit = searchOut.results[0];
      if (topHit) {
        const stockRecord = await executeGuardedToolCall(
          db,
          {
            name: 'get_stock',
            args: { medication_id: topHit.id },
          },
          {
            referenceTimestamp: options.referenceTimestamp,
            referenceDate: options.referenceDate,
          },
        );
        executedCalls.push(stockRecord);
      }
    }
  }

  if (options.useRemoteModelEndpoint && typeof fetch === 'function') {
    try {
      const synthRes = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'synthesize',
          userMessage: userPrompt,
          toolCalls: executedCalls,
        }),
      });
      if (synthRes.ok) {
        const synthData = (await synthRes.json()) as { responseText?: string };
        if (synthData.responseText && synthData.responseText.trim() !== '') {
          remoteModelAnswer = synthData.responseText.trim();
        }
      }
    } catch {
      // Fall back to deterministic grounded synthesis from the already-executed local tool results
    }
  }

  const groundedFallback = synthesizeGroundedResponseFromTools(userPrompt, executedCalls);
  const responseText = remoteModelAnswer || groundedFallback;

  const hasRejected = executedCalls.some(
    (c) => !c.allowed || c.status === 'rejected_by_guard',
  );

  const logEntry: AssistantRequestLogEntry = {
    id,
    timestamp,
    userPrompt,
    responseText,
    toolCalls: executedCalls,
    status: hasRejected ? 'rejected_tool_call' : 'ok',
    durationMs: Math.round((performance.now() - startTime) * 100) / 100,
  };
  appendAssistantRequestLog(logEntry);

  return {
    userPrompt,
    responseText,
    toolCalls: executedCalls,
    status: logEntry.status,
    logEntry,
  };
}

export const NO_RECENT_SALES_TREND_MESSAGE = 'No recent sales trend available.';

export interface QuickAccessAiTrendsOptions {
  referenceTimestamp?: string;
  limit?: number;
  useRemoteModelEndpoint?: boolean;
}

export interface QuickAccessAiTrendsResult {
  topDispensed: TopDispensedMedicationRow[];
  insightText: string;
  isGrounded: boolean;
}

/**
 * Verifies that every numeric token appearing in an AI trend insight exists in the
 * SQL query results for `topDispensed`, ensuring the AI cannot invent any number.
 */
export function verifyInsightNumbersGroundedInSql(
  insightText: string,
  rows: readonly TopDispensedMedicationRow[],
): boolean {
  if (rows.length === 0) {
    return insightText.trim() === NO_RECENT_SALES_TREND_MESSAGE;
  }

  const allowedNumbers = new Set<number>([7]);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    allowedNumbers.add(i + 1);
    allowedNumbers.add(r.medication_id);
    allowedNumbers.add(r.dispensed_7d);
    allowedNumbers.add(r.dispense_count_7d);
    allowedNumbers.add(r.dispensed_prev_7d);
    allowedNumbers.add(r.current_qty);
    allowedNumbers.add(r.reorder_level);
    if (r.pct_change_vs_prev_7d !== null) {
      allowedNumbers.add(Math.abs(Math.round(r.pct_change_vs_prev_7d)));
      allowedNumbers.add(Math.round(r.pct_change_vs_prev_7d));
    }
  }

  // Strip medication strength tokens (e.g. "500 mg", "1000 mg") before checking standalone numbers
  let scrubbed = insightText;
  for (const r of rows) {
    if (r.strength) {
      scrubbed = scrubbed.split(r.strength).join('');
    }
    scrubbed = scrubbed.split(r.brand_name).join('');
  }

  const numberMatches = scrubbed.match(/\b\d+(?:\.\d+)?\b/g);
  if (!numberMatches || numberMatches.length === 0) {
    return false;
  }

  for (const rawNum of numberMatches) {
    const parsed = Number(rawNum);
    if (!allowedNumbers.has(parsed)) {
      return false;
    }
  }

  return rows.some((r) => insightText.toLowerCase().includes(r.brand_name.toLowerCase()));
}

/**
 * Deterministically synthesizes a dynamic text insight strictly from the SQL numbers
 * returned by `queryTopDispensedMedications`.
 * If there is not enough data (no dispense movements in the last 7 days), returns
 * `"No recent sales trend available."`.
 */
export function synthesizeDispenseTrendInsight(
  rows: readonly TopDispensedMedicationRow[],
): string {
  const validRows = rows.filter((r) => r.dispensed_7d > 0);
  if (validRows.length === 0) {
    return NO_RECENT_SALES_TREND_MESSAGE;
  }

  // Prefer the top medication that has a week-over-week SQL percentage comparison if available,
  // otherwise use the #1 most dispensed medication in the last 7 days.
  const trendTarget =
    validRows.find((r) => r.pct_change_vs_prev_7d !== null && r.pct_change_vs_prev_7d !== 0) ??
    validRows[0];

  if (trendTarget.pct_change_vs_prev_7d !== null) {
    const pct = Math.round(trendTarget.pct_change_vs_prev_7d);
    if (pct > 0) {
      const reorderNote =
        trendTarget.current_qty <= trendTarget.reorder_level || pct >= 20
          ? ' Consider reordering.'
          : '';
      return `${trendTarget.brand_name} is selling ${pct}% faster this week (${trendTarget.dispensed_7d} units dispensed vs. ${trendTarget.dispensed_prev_7d} last week; ${trendTarget.current_qty} in stock).${reorderNote}`;
    }
    if (pct < 0) {
      const absPct = Math.abs(pct);
      const reorderNote =
        trendTarget.current_qty <= trendTarget.reorder_level ? ' Consider reordering.' : '';
      return `${trendTarget.brand_name} is selling ${absPct}% slower this week (${trendTarget.dispensed_7d} units dispensed vs. ${trendTarget.dispensed_prev_7d} last week; ${trendTarget.current_qty} in stock).${reorderNote}`;
    }
    const reorderNote =
      trendTarget.current_qty <= trendTarget.reorder_level ? ' Consider reordering.' : '';
    return `${trendTarget.brand_name} is selling at a steady pace this week (${trendTarget.dispensed_7d} units dispensed vs. ${trendTarget.dispensed_prev_7d} last week; ${trendTarget.current_qty} in stock).${reorderNote}`;
  }

  const reorderNote =
    trendTarget.current_qty <= trendTarget.reorder_level
      ? ' Consider reordering.'
      : '';
  return `${trendTarget.brand_name} leads weekly dispensing with ${trendTarget.dispensed_7d} units dispensed in the last 7 days (${trendTarget.current_qty} units in stock, reorder level ${trendTarget.reorder_level}).${reorderNote}`;
}

/**
 * Uses the read-only AI Assistant guard and synthesis pipeline to generate the
 * "Quick Access & AI Trends" data and dynamic text insight from `stock_movement`.
 *
 * - Strictly reads numbers from SQL via `createReadOnlyDatabaseGuard(db)`.
 * - Never invents data.
 * - Returns `"No recent sales trend available."` when there is not enough data.
 */
export async function generateQuickAccessAiTrends(
  db: DatabasePort,
  options: QuickAccessAiTrendsOptions = {},
): Promise<QuickAccessAiTrendsResult> {
  const readOnlyDb = createReadOnlyDatabaseGuard(db);
  const topDispensed = await queryTopDispensedMedications(readOnlyDb, {
    referenceTimestamp: options.referenceTimestamp,
    limit: options.limit ?? 5,
  });

  if (topDispensed.length === 0) {
    return {
      topDispensed: [],
      insightText: NO_RECENT_SALES_TREND_MESSAGE,
      isGrounded: true,
    };
  }

  const deterministicInsight = synthesizeDispenseTrendInsight(topDispensed);

  if (options.useRemoteModelEndpoint && typeof fetch === 'function') {
    try {
      const syntheticToolRecord: ExecutedToolCallRecord = {
        id: `tc_trends_${Date.now()}`,
        name: 'get_stock',
        args: { source: 'stock_movement_7d_dispense_trends' },
        allowed: true,
        status: 'executed',
        result: {
          window_days: 7,
          top_dispensed: topDispensed,
        },
        timestamp: new Date().toISOString(),
      };

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'synthesize',
          userMessage:
            'Provide a single concise 1-2 sentence pharmacy sales trend insight using ONLY the exact numbers in top_dispensed (brand_name, dispensed_7d, dispensed_prev_7d, pct_change_vs_prev_7d, current_qty, reorder_level). Do not invent or calculate any numbers.',
          toolCalls: [syntheticToolRecord],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { responseText?: string; usedFallback?: boolean };
        const candidate = data.responseText?.trim() ?? '';
        if (
          candidate &&
          !data.usedFallback &&
          verifyInsightNumbersGroundedInSql(candidate, topDispensed)
        ) {
          return {
            topDispensed,
            insightText: candidate,
            isGrounded: true,
          };
        }
      }
    } catch {
      // Fall back to deterministic SQL-grounded insight
    }
  }

  return {
    topDispensed,
    insightText: deterministicInsight,
    isGrounded: true,
  };
}

