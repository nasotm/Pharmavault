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
 * Business analyst system prompt required by specification.
 */
export const PHARMACY_BUSINESS_ANALYST_PROMPT =
  'You are a pharmacy business analyst. You have access to sales, stock, and pricing data. Always use the provided tools to answer questions. Do not guess numbers. Format currency in DA.';

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

export const PHARMACY_ASSISTANT_SYSTEM_PROMPT = `${PHARMACY_BUSINESS_ANALYST_PROMPT}

${PHARMACY_ASSISTANT_VERBATIM_PROMPT}

Additional operational rules:
- You may only call the read-only tools: search_medication, get_stock, list_low_stock, list_expiring, calc_price, get_revenue, find_by_symptom_or_category, get_sales_summary, get_top_selling, get_expiring_value, get_sales_trend.
- Use get_sales_trend(medication_id, days) to analyze stock_movement for a specific medication over the last N days and return average daily sales and projected days until stockout.
- Use get_sales_summary(start_date, end_date) to calculate total revenue (in DA) and total items sold based on negative stock_movement deltas with reason 'dispense'.
- Use get_top_selling(category, limit) to return the top N most dispensed medications, optionally filtered by therapeutic_class or category.
- Use get_expiring_value() to calculate the total financial value (cost price * quantity) of all batches expiring in the next 30 days.
- Use get_revenue(date) to calculate total sales revenue for a specific day (e.g. "today" or "YYYY-MM-DD").
- Use list_expiring(days) to list medications expiring in N days (e.g. 30 or 31 for "this month").
- Use find_by_symptom_or_category(category) to find medications by category or symptom (e.g. "Antibacterial").
- Never invent data; only use tool results. Format currency in DA.
- Never call or attempt any write function (setPrice, insertMovement, insertMedication, updateMedicationFromImport, updateMedicationLocalInventory, etc.).
- When a user asks to edit, fix, populate, correct, or infer any catalog field (brand_name, generic_name, strength, dosage_form, atc_code, manufacturer, barcode) or modify stock/prices, decline clearly and state that catalog, stock, and price fields are not editable in the read-only assistant.`;

export type AllowedReadOnlyToolName =
  | 'search_medication'
  | 'get_stock'
  | 'list_low_stock'
  | 'list_expiring'
  | 'calc_price'
  | 'get_revenue'
  | 'find_by_symptom_or_category'
  | 'get_sales_summary'
  | 'get_top_selling'
  | 'get_expiring_value'
  | 'get_sales_trend';

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
  'get_sales_summary',
  'get_top_selling',
  'get_expiring_value',
  'get_sales_trend',
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

export interface GetSalesSummaryToolOutput {
  start_date: string;
  end_date: string;
  requested_start_date: string;
  requested_end_date: string;
  total_revenue_cents: number;
  total_revenue_da: number;
  total_revenue_display: string;
  total_items_sold: number;
  transaction_count: number;
  currency: string;
  has_unpriced_dispenses: boolean;
  unpriced_medications: string[];
  items: GetRevenueLineItem[];
}

export interface TopSellingMedicationItem {
  rank: number;
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  category: string | null;
  therapeutic_class: string | null;
  atc_code: string | null;
  units_sold: number;
  transaction_count: number;
  unit_price_cents: number | null;
  unit_price_display: string;
  line_revenue_cents: number | null;
  line_revenue_display: string;
  current_stock: number;
  location: string;
}

export interface GetTopSellingToolOutput {
  category: string | null;
  limit: number;
  count: number;
  total_units_sold: number;
  total_revenue_da: number;
  total_revenue_display: string;
  items: TopSellingMedicationItem[];
}

export interface ExpiringBatchValueItem {
  batch_id: number;
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  lot_number: string | null;
  quantity: number;
  expiry_date: string;
  days_remaining: number;
  cost_price_cents: number | null;
  cost_price_display: string;
  batch_value_cents: number | null;
  batch_value_display: string;
  location: string;
}

export interface GetExpiringValueToolOutput {
  days: number;
  reference_date: string;
  batch_count: number;
  total_units_expiring: number;
  total_value_cents: number;
  total_value_da: number;
  total_value_display: string;
  currency: string;
  has_missing_cost_price: boolean;
  batches: ExpiringBatchValueItem[];
}

export interface GetSalesTrendToolOutput {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  days: number;
  current_stock: number;
  reorder_level: number;
  total_sales_units: number;
  transaction_count: number;
  average_daily_sales: number;
  projected_days_until_stockout: number | null;
  stockout_risk_label: string;
}

export const MORNING_BRIEFING_PROMPT =
  'Based on the current stock and recent sales (use the tools), give the pharmacist a 3-sentence morning briefing. Mention 1. The top-selling item, 2. The most critical stockout risk, and 3. A warning about any expiring batches.';

export const NO_DATA_BRIEFING_MESSAGE =
  'Not enough data for a briefing yet. Start dispensing to see insights.';

export interface DailyBriefingResult {
  briefing: string;
  hasData: boolean;
  isAiGenerated: boolean;
  toolCalls: ExecutedToolCallRecord[];
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

      case 'get_sales_summary': {
        const requestedStart =
          args.start_date !== undefined &&
          args.start_date !== null &&
          String(args.start_date).trim() !== ''
            ? String(args.start_date).trim()
            : 'today';
        const requestedEnd =
          args.end_date !== undefined &&
          args.end_date !== null &&
          String(args.end_date).trim() !== ''
            ? String(args.end_date).trim()
            : requestedStart;

        const refAnchor = options.referenceDate ?? options.referenceTimestamp;
        let resolvedStart = resolveRevenueTargetDate(requestedStart, refAnchor);
        let resolvedEnd = resolveRevenueTargetDate(requestedEnd, refAnchor);
        if (resolvedStart > resolvedEnd) {
          const tmp = resolvedStart;
          resolvedStart = resolvedEnd;
          resolvedEnd = tmp;
        }

        const output = await querySalesSummary(
          readOnlyDb,
          resolvedStart,
          resolvedEnd,
          requestedStart,
          requestedEnd,
        );
        return {
          id,
          name: rawName,
          args: {
            ...args,
            start_date: resolvedStart,
            end_date: resolvedEnd,
          },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'get_top_selling': {
        const rawCategory =
          args.category !== undefined && args.category !== null
            ? String(args.category).trim()
            : '';
        const rawLimit =
          args.limit !== undefined && args.limit !== null ? Number(args.limit) : 3;
        const limit =
          Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 3;
        const output = await queryTopSellingMedications(readOnlyDb, {
          category: rawCategory || null,
          limit,
        });
        return {
          id,
          name: rawName,
          args: {
            ...args,
            category: rawCategory || null,
            limit,
          },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'get_expiring_value': {
        const rawDays =
          args.days !== undefined && args.days !== null ? Number(args.days) : 30;
        const days = Number.isInteger(rawDays) && rawDays > 0 ? rawDays : 30;
        const output = await queryExpiringStockValue(readOnlyDb, {
          withinDays: days,
          referenceDate: options.referenceDate ?? options.referenceTimestamp?.slice(0, 10),
        });
        return {
          id,
          name: rawName,
          args: { ...args },
          allowed: true,
          status: 'executed',
          result: output,
          timestamp,
        };
      }

      case 'get_sales_trend': {
        const rawMedId = Number(args.medication_id);
        const medId = Number.isInteger(rawMedId) && rawMedId > 0 ? rawMedId : 1;
        const rawDays = args.days !== undefined && args.days !== null ? Number(args.days) : 30;
        const days = Number.isInteger(rawDays) && rawDays > 0 ? rawDays : 30;
        const output = await querySalesTrend(
          readOnlyDb,
          medId,
          days,
          options.referenceTimestamp,
        );
        return {
          id,
          name: rawName,
          args: { medication_id: medId, days },
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

  const daysAgoMatch = raw.match(/^(?:last_?)?(\d+)_?days?$/);
  if (daysAgoMatch) {
    const days = Number(daysAgoMatch[1]);
    const baseDate = new Date(`${refIso}T12:00:00.000Z`);
    if (!Number.isNaN(baseDate.getTime()) && days > 0) {
      baseDate.setUTCDate(baseDate.getUTCDate() - (days - 1));
      return baseDate.toISOString().slice(0, 10);
    }
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

const SALES_SUMMARY_RANGE_SQL = `
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
  AND date(sm.created_at) >= date(?)
  AND date(sm.created_at) <= date(?)
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
  let currency = 'DZD';
  const unpricedMedications: string[] = [];

  const items: GetRevenueLineItem[] = rows.map((row) => {
    const unitsSold = Number(row.units_sold);
    const txCount = Number(row.transaction_count);
    const rowCurrency = row.currency ? String(row.currency) : 'DZD';
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
          : formatMoneyDisplay(unitPriceCents, 'DZD', { includeCentsSuffix: false }),
      line_revenue_cents: lineRevenueCents,
      line_revenue_display:
        lineRevenueCents === null
          ? 'price not entered'
          : formatMoneyDisplay(lineRevenueCents, 'DZD', { includeCentsSuffix: false }),
      currency: rowCurrency,
    };
  });

  return {
    date: resolvedDate,
    requested_date: requestedDate,
    total_revenue_cents: totalRevenueCents,
    total_revenue_display: formatMoneyDisplay(totalRevenueCents, 'DZD', {
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

/**
 * Deterministic SQL query for `get_sales_summary(start_date, end_date)`:
 * Returns total revenue (in DA) and total items sold based on negative `stock_movement`
 * deltas with reason 'dispense' across the inclusive date range [start_date, end_date].
 */
export async function querySalesSummary(
  db: DatabasePort,
  startDate: string,
  endDate: string,
  requestedStartDate = startDate,
  requestedEndDate = endDate,
): Promise<GetSalesSummaryToolOutput> {
  const rows = await db.query<RawDailyRevenueSqlRow>(SALES_SUMMARY_RANGE_SQL, [
    startDate,
    endDate,
  ]);

  let totalRevenueCents = 0;
  let totalItemsSold = 0;
  let transactionCount = 0;
  const unpricedMedications: string[] = [];

  const items: GetRevenueLineItem[] = rows.map((row) => {
    const unitsSold = Number(row.units_sold);
    const txCount = Number(row.transaction_count);
    const unitPriceCents =
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents);
    const lineRevenueCents =
      row.line_revenue_cents === null || row.line_revenue_cents === undefined
        ? null
        : Number(row.line_revenue_cents);

    totalItemsSold += unitsSold;
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
          : formatMoneyDisplay(unitPriceCents, 'DZD', { includeCentsSuffix: false }),
      line_revenue_cents: lineRevenueCents,
      line_revenue_display:
        lineRevenueCents === null
          ? 'price not entered'
          : formatMoneyDisplay(lineRevenueCents, 'DZD', { includeCentsSuffix: false }),
      currency: 'DA',
    };
  });

  return {
    start_date: startDate,
    end_date: endDate,
    requested_start_date: requestedStartDate,
    requested_end_date: requestedEndDate,
    total_revenue_cents: totalRevenueCents,
    total_revenue_da: totalRevenueCents,
    total_revenue_display: formatMoneyDisplay(totalRevenueCents, 'DZD', {
      includeCentsSuffix: false,
    }),
    total_items_sold: totalItemsSold,
    transaction_count: transactionCount,
    currency: 'DA',
    has_unpriced_dispenses: unpricedMedications.length > 0,
    unpriced_medications: unpricedMedications,
    items,
  };
}

interface RawTopSellingSqlRow {
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  category: string | null;
  therapeutic_class: string | null;
  atc_code: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  unit_price_cents: number | null;
  units_sold: number;
  transaction_count: number;
  line_revenue_cents: number | null;
  current_stock: number;
}

/**
 * Deterministic SQL query for `get_top_selling(category, limit)`:
 * Returns the top N most dispensed medications based on negative `stock_movement` deltas
 * with reason 'dispense', optionally filtered by `therapeutic_class` or `category`.
 */
export async function queryTopSellingMedications(
  db: DatabasePort,
  options: { category?: string | null; limit?: number } = {},
): Promise<GetTopSellingToolOutput> {
  const rawLimit = options.limit ?? 3;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 3;
  const rawCategory = (options.category ?? '').trim();
  const isAllCategory =
    !rawCategory ||
    rawCategory.toLowerCase() === 'all' ||
    rawCategory.toLowerCase() === 'any' ||
    rawCategory === '*';

  const predicates: string[] = [];
  const params: SqlParam[] = [];

  if (!isAllCategory) {
    const { matchedTerms, atcPrefixes } = expandCategoryOrSymptomTerms(rawCategory);
    for (const term of matchedTerms) {
      const likePattern = `%${term}%`;
      predicates.push("LOWER(COALESCE(m.category, '')) LIKE ?");
      params.push(likePattern);
      predicates.push("LOWER(COALESCE(m.therapeutic_class, '')) LIKE ?");
      params.push(likePattern);
      predicates.push("LOWER(COALESCE(m.location_note, '')) LIKE ?");
      params.push(likePattern);
    }
    for (const prefix of atcPrefixes) {
      predicates.push("UPPER(COALESCE(m.atc_code, '')) LIKE ?");
      params.push(`${prefix}%`);
    }
  }

  const whereClause = predicates.length > 0 ? `WHERE (${predicates.join(' OR ')})` : '';
  params.push(limit);

  const sql = `
    WITH dispense_totals AS (
      SELECT
        sm.medication_id,
        COALESCE(SUM(-sm.delta), 0) AS units_sold,
        COUNT(sm.id) AS transaction_count
      FROM stock_movement sm
      WHERE sm.delta < 0
        AND (
          LOWER(TRIM(COALESCE(sm.reason, ''))) = 'dispense'
          OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE 'dispense:%'
          OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE '%dispense%'
        )
      GROUP BY sm.medication_id
    ),
    batch_totals AS (
      SELECT
        b.medication_id,
        COALESCE(SUM(b.quantity), 0) AS current_stock
      FROM batch b
      GROUP BY b.medication_id
    )
    SELECT
      m.id AS medication_id,
      m.brand_name,
      m.generic_name,
      m.strength,
      m.dosage_form,
      m.category,
      m.therapeutic_class,
      m.atc_code,
      m.zone,
      m.shelf,
      m.bin,
      m.unit_price_cents,
      COALESCE(dt.units_sold, 0) AS units_sold,
      COALESCE(dt.transaction_count, 0) AS transaction_count,
      CASE
        WHEN m.unit_price_cents IS NOT NULL
          THEN COALESCE(dt.units_sold, 0) * m.unit_price_cents
        ELSE NULL
      END AS line_revenue_cents,
      COALESCE(bt.current_stock, 0) AS current_stock
    FROM medication m
    LEFT JOIN dispense_totals dt ON dt.medication_id = m.id
    LEFT JOIN batch_totals bt ON bt.medication_id = m.id
    ${whereClause}
    ORDER BY
      COALESCE(dt.units_sold, 0) DESC,
      COALESCE(line_revenue_cents, 0) DESC,
      m.brand_name ASC,
      m.id ASC
    LIMIT ?;
  `;

  const rows = await db.query<RawTopSellingSqlRow>(sql, params);

  let totalUnitsSold = 0;
  let totalRevenueDa = 0;

  const items: TopSellingMedicationItem[] = rows.map((row, idx) => {
    const unitsSold = Number(row.units_sold);
    const txCount = Number(row.transaction_count);
    const unitPriceCents =
      row.unit_price_cents === null || row.unit_price_cents === undefined
        ? null
        : Number(row.unit_price_cents);
    const lineRevenueCents =
      row.line_revenue_cents === null || row.line_revenue_cents === undefined
        ? null
        : Number(row.line_revenue_cents);

    totalUnitsSold += unitsSold;
    if (lineRevenueCents !== null) {
      totalRevenueDa += lineRevenueCents;
    }

    return {
      rank: idx + 1,
      medication_id: Number(row.medication_id),
      brand_name: String(row.brand_name),
      generic_name:
        row.generic_name === null || row.generic_name === undefined
          ? null
          : String(row.generic_name),
      strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
      dosage_form:
        row.dosage_form === null || row.dosage_form === undefined
          ? null
          : String(row.dosage_form),
      category:
        row.category === null || row.category === undefined ? null : String(row.category),
      therapeutic_class:
        row.therapeutic_class === null || row.therapeutic_class === undefined
          ? null
          : String(row.therapeutic_class),
      atc_code:
        row.atc_code === null || row.atc_code === undefined ? null : String(row.atc_code),
      units_sold: unitsSold,
      transaction_count: txCount,
      unit_price_cents: unitPriceCents,
      unit_price_display:
        unitPriceCents === null
          ? 'price not entered'
          : formatMoneyDisplay(unitPriceCents, 'DZD', { includeCentsSuffix: false }),
      line_revenue_cents: lineRevenueCents,
      line_revenue_display:
        lineRevenueCents === null
          ? 'price not entered'
          : formatMoneyDisplay(lineRevenueCents, 'DZD', { includeCentsSuffix: false }),
      current_stock: Number(row.current_stock),
      location: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
    };
  });

  return {
    category: isAllCategory ? null : rawCategory,
    limit,
    count: items.length,
    total_units_sold: totalUnitsSold,
    total_revenue_da: totalRevenueDa,
    total_revenue_display: formatMoneyDisplay(totalRevenueDa, 'DZD', {
      includeCentsSuffix: false,
    }),
    items,
  };
}

interface RawExpiringBatchValueSqlRow {
  batch_id: number;
  medication_id: number;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  zone: string | null;
  shelf: string | null;
  bin: string | null;
  lot_number: string | null;
  quantity: number;
  expiry_date: string;
  days_remaining: number;
  cost_price_cents: number | null;
  batch_value_cents: number | null;
}

const EXPIRING_VALUE_SQL = `
SELECT
  b.id AS batch_id,
  b.medication_id,
  m.brand_name,
  m.generic_name,
  m.strength,
  m.dosage_form,
  m.zone,
  m.shelf,
  m.bin,
  b.lot_number,
  b.quantity,
  b.expiry_date,
  CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) AS days_remaining,
  m.cost_price_cents,
  CASE
    WHEN m.cost_price_cents IS NOT NULL
      THEN b.quantity * m.cost_price_cents
    ELSE NULL
  END AS batch_value_cents
FROM batch b
INNER JOIN medication m ON m.id = b.medication_id
WHERE b.quantity > 0
  AND date(b.expiry_date) IS NOT NULL
  AND CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) >= 0
  AND CAST(julianday(date(b.expiry_date)) - julianday(date(?)) AS INTEGER) <= ?
ORDER BY
  date(b.expiry_date) ASC,
  b.id ASC;
`;

/**
 * Deterministic SQL query for `get_expiring_value()`:
 * Returns the total financial value (`cost_price_cents * quantity`) of all batches
 * expiring in the next 30 days.
 */
export async function queryExpiringStockValue(
  db: DatabasePort,
  options: { withinDays?: number; referenceDate?: string } = {},
): Promise<GetExpiringValueToolOutput> {
  const days = options.withinDays ?? 30;
  const referenceDate = (options.referenceDate ?? new Date().toISOString()).slice(0, 10);

  const rows = await db.query<RawExpiringBatchValueSqlRow>(EXPIRING_VALUE_SQL, [
    referenceDate,
    referenceDate,
    referenceDate,
    days,
  ]);

  let totalUnitsExpiring = 0;
  let totalValueCents = 0;
  let hasMissingCostPrice = false;

  const batches: ExpiringBatchValueItem[] = rows.map((row) => {
    const qty = Number(row.quantity);
    const costCents =
      row.cost_price_cents === null || row.cost_price_cents === undefined
        ? null
        : Number(row.cost_price_cents);
    const batchValueCents =
      row.batch_value_cents === null || row.batch_value_cents === undefined
        ? null
        : Number(row.batch_value_cents);

    totalUnitsExpiring += qty;
    if (batchValueCents !== null) {
      totalValueCents += batchValueCents;
    } else {
      hasMissingCostPrice = true;
    }

    return {
      batch_id: Number(row.batch_id),
      medication_id: Number(row.medication_id),
      brand_name: String(row.brand_name),
      generic_name:
        row.generic_name === null || row.generic_name === undefined
          ? null
          : String(row.generic_name),
      strength: row.strength === null || row.strength === undefined ? null : String(row.strength),
      dosage_form:
        row.dosage_form === null || row.dosage_form === undefined
          ? null
          : String(row.dosage_form),
      lot_number:
        row.lot_number === null || row.lot_number === undefined ? null : String(row.lot_number),
      quantity: qty,
      expiry_date: String(row.expiry_date),
      days_remaining: Number(row.days_remaining),
      cost_price_cents: costCents,
      cost_price_display:
        costCents === null
          ? 'cost price not entered'
          : formatMoneyDisplay(costCents, 'DZD', { includeCentsSuffix: false }),
      batch_value_cents: batchValueCents,
      batch_value_display:
        batchValueCents === null
          ? 'cost price not entered'
          : formatMoneyDisplay(batchValueCents, 'DZD', { includeCentsSuffix: false }),
      location: formatLocationString({ zone: row.zone, shelf: row.shelf, bin: row.bin }),
    };
  });

  return {
    days,
    reference_date: referenceDate,
    batch_count: batches.length,
    total_units_expiring: totalUnitsExpiring,
    total_value_cents: totalValueCents,
    total_value_da: totalValueCents,
    total_value_display: formatMoneyDisplay(totalValueCents, 'DZD', {
      includeCentsSuffix: false,
    }),
    currency: 'DA',
    has_missing_cost_price: hasMissingCostPrice,
    batches,
  };
}

/**
 * Deterministic SQL query for `get_sales_trend(medication_id, days)`:
 * Analyzes `stock_movement` for a specific medication over the last N days (default 30)
 * and returns total sales units, average daily sales, current stock, reorder level,
 * and projected days until stockout.
 */
export async function querySalesTrend(
  db: DatabasePort,
  medicationId: number,
  days = 30,
  referenceTimestamp?: string,
): Promise<GetSalesTrendToolOutput> {
  const readOnlyDb = createReadOnlyDatabaseGuard(db);
  const med = await getMedicationById(readOnlyDb, medicationId);
  if (!med) {
    throw new Error(`Medication #${medicationId} not found`);
  }

  const currentStock = await getTotalStock(readOnlyDb, medicationId);
  const refIso = (referenceTimestamp ?? new Date().toISOString()).slice(0, 10);

  const sql = `
    SELECT
      COALESCE(SUM(-sm.delta), 0) AS total_sales_units,
      COUNT(sm.id) AS transaction_count
    FROM stock_movement sm
    WHERE sm.medication_id = ?
      AND sm.delta < 0
      AND (
        LOWER(TRIM(COALESCE(sm.reason, ''))) = 'dispense'
        OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE 'dispense:%'
        OR LOWER(TRIM(COALESCE(sm.reason, ''))) LIKE '%dispense%'
      )
      AND date(sm.created_at) >= date(?, '-' || ? || ' days')
      AND date(sm.created_at) <= date(?);
  `;

  const rows = await readOnlyDb.query<{ total_sales_units: number; transaction_count: number }>(
    sql,
    [medicationId, refIso, Math.max(1, days), refIso],
  );

  const totalSalesUnits = Number(rows[0]?.total_sales_units ?? 0);
  const transactionCount = Number(rows[0]?.transaction_count ?? 0);
  const averageDailySales =
    Math.round((totalSalesUnits / Math.max(1, days)) * 100) / 100;

  let projectedDaysUntilStockout: number | null = null;
  if (averageDailySales > 0) {
    projectedDaysUntilStockout = Math.round((currentStock / averageDailySales) * 10) / 10;
  }

  let stockoutRiskLabel = 'Low';
  if (currentStock === 0) {
    stockoutRiskLabel = 'Out of Stock';
  } else if (projectedDaysUntilStockout !== null) {
    if (projectedDaysUntilStockout <= 3) {
      stockoutRiskLabel = 'Critical';
    } else if (projectedDaysUntilStockout <= 7) {
      stockoutRiskLabel = 'High';
    } else if (projectedDaysUntilStockout <= 14) {
      stockoutRiskLabel = 'Moderate';
    }
  }

  return {
    medication_id: med.id,
    brand_name: med.brand_name,
    generic_name: med.generic_name,
    strength: med.strength,
    dosage_form: med.dosage_form,
    days,
    current_stock: currentStock,
    reorder_level: med.reorder_level,
    total_sales_units: totalSalesUnits,
    transaction_count: transactionCount,
    average_daily_sales: averageDailySales,
    projected_days_until_stockout: projectedDaysUntilStockout,
    stockout_risk_label: stockoutRiskLabel,
  };
}

/**
 * Automatically generates a proactive 3-sentence morning briefing for the pharmacy dashboard
 * using real database queries via `createReadOnlyDatabaseGuard(db)`.
 *
 * Prompt requirement:
 * "Based on the current stock and recent sales (use the tools), give the pharmacist a 3-sentence morning briefing. Mention 1. The top-selling item, 2. The most critical stockout risk, and 3. A warning about any expiring batches."
 * If no sales/dispense data exists (e.g. new pharmacy), returns `"Not enough data for a briefing yet. Start dispensing to see insights."`
 */
export async function generateDailyBriefing(
  db: DatabasePort,
  options: {
    referenceTimestamp?: string;
    referenceDate?: string;
    useRemoteModelEndpoint?: boolean;
  } = {},
): Promise<DailyBriefingResult> {
  const readOnlyDb = createReadOnlyDatabaseGuard(db);

  const topSellingResult = await queryTopSellingMedications(readOnlyDb, { limit: 1 });
  const lowStockRows = await queryLowStockDashboard(readOnlyDb, {
    referenceTimestamp: options.referenceTimestamp,
  });
  const expiringResult = await queryExpiringSoonDashboard(readOnlyDb, {
    withinDays: 30,
    referenceDate: options.referenceDate,
  });

  const topSellingItem = topSellingResult.items[0];
  const hasDispenseData = Boolean(topSellingItem && topSellingItem.units_sold > 0);

  const toolCalls: ExecutedToolCallRecord[] = [
    {
      id: `tc_brief_top_${Date.now()}`,
      name: 'get_top_selling',
      args: { limit: 1 },
      allowed: true,
      status: 'executed',
      result: topSellingResult,
      timestamp: new Date().toISOString(),
    },
    {
      id: `tc_brief_low_${Date.now()}`,
      name: 'list_low_stock',
      args: {},
      allowed: true,
      status: 'executed',
      result: { count: lowStockRows.length, rows: lowStockRows },
      timestamp: new Date().toISOString(),
    },
    {
      id: `tc_brief_exp_${Date.now()}`,
      name: 'list_expiring',
      args: { days: 30 },
      allowed: true,
      status: 'executed',
      result: {
        days: 30,
        reference_date: expiringResult.referenceDate,
        count: expiringResult.batches.length,
        batches: expiringResult.batches,
      },
      timestamp: new Date().toISOString(),
    },
  ];

  if (!hasDispenseData) {
    return {
      briefing: NO_DATA_BRIEFING_MESSAGE,
      hasData: false,
      isAiGenerated: false,
      toolCalls,
    };
  }

  const s1 = `Your top-selling item is **${topSellingItem.brand_name}** with **${topSellingItem.units_sold} units** dispensed.`;

  let s2 = 'Stock levels are currently stable with no immediate critical stockout risks.';
  if (lowStockRows.length > 0) {
    const mostCritical = lowStockRows[0];
    s2 = `The most critical stockout risk is **${mostCritical.brand_name}** with **${mostCritical.current_qty} units** remaining against a reorder level of ${mostCritical.reorder_level}.`;
  }

  let s3 = 'No active batches are expiring within the next 30 days.';
  if (expiringResult.batches.length > 0) {
    const earliestBatch = expiringResult.batches[0];
    s3 = `Warning: **${expiringResult.batches.length} batch(es)** are expiring within 30 days, including **${earliestBatch.brand_name}** (Lot \`${earliestBatch.lot_number}\`, **${earliestBatch.quantity} units** expiring on ${earliestBatch.expiry_date}).`;
  }

  const deterministicBriefing = `${s1} ${s2} ${s3}`;

  if (options.useRemoteModelEndpoint && typeof fetch === 'function') {
    try {
      const res = await fetch('/api/ai/daily-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topSelling: topSellingItem,
          mostCriticalLowStock: lowStockRows[0] ?? null,
          expiringCount: expiringResult.batches.length,
          earliestExpiringBatch: expiringResult.batches[0] ?? null,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { briefing?: string };
        if (data.briefing && data.briefing.trim()) {
          return {
            briefing: data.briefing.trim(),
            hasData: true,
            isAiGenerated: true,
            toolCalls,
          };
        }
      }
    } catch {
      // Fall back to deterministic briefing
    }
  }

  return {
    briefing: deterministicBriefing,
    hasData: true,
    isAiGenerated: false,
    toolCalls,
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
 * - `get_sales_summary`
 * - `get_top_selling`
 * - `get_expiring_value`
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

  // 2. Expiring stock financial value / risk queries ("How much money is at risk from expiring stock?")
  if (
    /\b(money\s+(?:is\s+)?at\s+risk|at\s+risk\s+from\s+expir|expiring\s+(?:stock\s+)?value|value\s+of\s+expiring|financial\s+value.*expir|cost\s+of\s+expiring|how\s+much\s+money.*expir|risk\s+from\s+expir)\b/i.test(
      lower,
    )
  ) {
    return [{ name: 'get_expiring_value', args: {} }];
  }

  // 3. Top-selling medication queries ("What are my top 3 selling antibiotics?", "top selling medications")
  if (
    /\b(top\s+\d*\s*selling|best\s+selling|most\s+dispensed|most\s+sold|top\s+\d+\s+(?:medications|drugs|antibiotics|analgesics|items))\b/i.test(
      lower,
    )
  ) {
    const limitMatch =
      lower.match(/\btop\s+(\d+)\b/i) || lower.match(/\b(\d+)\s+(?:most|top|best)\b/i);
    const limit = limitMatch ? Math.max(1, Number(limitMatch[1])) : 5;
    const extractedCategory = extractCategoryOrSymptomFromPrompt(userMessage);
    const args: Record<string, unknown> = { limit };
    if (extractedCategory) {
      args.category = extractedCategory;
    }
    return [{ name: 'get_top_selling', args }];
  }

  // 4. Sales summary / date-range revenue queries ("What is today's revenue?", "sales summary from 2026-10-01 to 2026-10-31")
  if (
    /\b(today's\s+revenue|todays\s+revenue|sales\s+summary|revenue\s+summary|what\s+is\s+(?:our\s+|the\s+)?revenue|revenue\s+between|sales\s+between|revenue\s+from|sales\s+from)\b/i.test(
      lower,
    )
  ) {
    const dateMatches = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/g);
    let startDate = 'today';
    let endDate = 'today';
    if (dateMatches && dateMatches.length >= 2) {
      startDate = dateMatches[0]!;
      endDate = dateMatches[1]!;
    } else if (dateMatches && dateMatches.length === 1) {
      startDate = dateMatches[0]!;
      endDate = dateMatches[0]!;
    } else if (/\byesterday\b/i.test(lower)) {
      startDate = 'yesterday';
      endDate = 'yesterday';
    }
    return [
      {
        name: 'get_sales_summary',
        args: { start_date: startDate, end_date: endDate },
      },
    ];
  }

  // 5. Single-day revenue / daily sales queries ("How much did we sell today?", "What is our revenue for 2026-10-26?")
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

  // 6. Low stock queries ("what's running low", "low stock", "reorder")
  if (
    /\b(running\s+low|low\s+stock|low-stock|need\s+to\s+reorder|below\s+reorder|out\s+of\s+stock|shortage)\b/i.test(
      lower,
    )
  ) {
    return [{ name: 'list_low_stock', args: {} }];
  }

  // 7. Expiring queries ("What is expiring this month?", "what expires this month", "expiring in 60 days")
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

  // 8. Symptom or category queries ("Find Antibacterial medications", "Medications by category Antibacterial")
  const categoryQuery = extractCategoryOrSymptomFromPrompt(userMessage);
  if (categoryQuery) {
    return [{ name: 'find_by_symptom_or_category', args: { category: categoryQuery } }];
  }

  // 9. Price calculation / "how much" queries
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

  // 10. Location / stock lookup ("where are the amoxicillin capsules", "how many amoxil", etc.)
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

    if (call.name === 'get_sales_summary') {
      const output = call.result as GetSalesSummaryToolOutput;
      const dateRangeLabel =
        output.start_date === output.end_date
          ? `**${output.start_date}**`
          : `**${output.start_date}** to **${output.end_date}**`;

      if (output.items.length === 0) {
        parts.push(
          `**Sales Summary (${dateRangeLabel}):**\n- **Total Revenue:** **${output.total_revenue_display}**\n- **Total Items Sold:** **0 items** (0 dispense transactions recorded)`,
        );
      } else {
        const itemLines = output.items.map((item) => {
          if (item.unit_price_cents === null || item.line_revenue_cents === null) {
            return `- **${item.brand_name}** (${item.strength ?? ''}): **${item.units_sold} items** sold — **price not entered**`;
          }
          return `- **${item.brand_name}** (${item.strength ?? ''}): **${item.units_sold} items** × ${item.unit_price_display} = **${item.line_revenue_display}**`;
        });
        const unpricedNote = output.has_unpriced_dispenses
          ? `\n- **Unpriced Dispenses:** ${output.unpriced_medications.join(', ')} (**price not entered**)`
          : '';
        parts.push(
          `**Sales Summary (${dateRangeLabel}):**\n- **Total Revenue:** **${output.total_revenue_display}**\n- **Total Items Sold:** **${output.total_items_sold} items** (${output.transaction_count} dispense transaction(s))\n${itemLines.join('\n')}${unpricedNote}`,
        );
      }
    } else if (call.name === 'get_top_selling') {
      const output = call.result as GetTopSellingToolOutput;
      const categoryHeading = output.category ? ` (${output.category})` : '';
      if (output.items.length === 0) {
        parts.push(
          `**Top ${output.limit} Selling Medications${categoryHeading}:**\n- No matching medications or dispense records found for this filter.`,
        );
      } else {
        const itemLines = output.items.map((item, idx) => {
          const revLabel =
            item.unit_price_cents === null
              ? 'price not entered'
              : `**${item.line_revenue_display}** (${item.unit_price_display}/unit)`;
          const classLabel = item.therapeutic_class || item.category || 'Uncategorized';
          return `- **#${idx + 1} ${item.brand_name}** (${item.generic_name ?? 'N/A'} · ${item.strength ?? ''}) — **${item.units_sold} units sold** · Revenue: ${revLabel} · Class: ${classLabel}`;
        });
        parts.push(
          `**Top ${output.items.length} Selling Medications${categoryHeading}:**\n- **Combined Units Sold:** **${output.total_units_sold} units**\n- **Combined Revenue:** **${output.total_revenue_display}**\n${itemLines.join('\n')}`,
        );
      }
    } else if (call.name === 'get_expiring_value') {
      const output = call.result as GetExpiringValueToolOutput;
      if (output.batches.length === 0) {
        parts.push(
          `**Expiring Stock Financial Risk (Next ${output.days} Days):**\n- **Total Value at Risk:** **0 DA**\n- **Expiring Batches:** **0 batches** expiring within ${output.days} days of **${output.reference_date}**`,
        );
      } else {
        const batchLines = output.batches.map((b) => {
          if (b.cost_price_cents === null || b.batch_value_cents === null) {
            return `- **${b.brand_name}** (${b.strength ?? ''} · Lot \`${b.lot_number}\`) — **${b.quantity} units** expiring **${b.expiry_date}** (${b.days_remaining} days left) · Cost: **cost price not entered**`;
          }
          return `- **${b.brand_name}** (${b.strength ?? ''} · Lot \`${b.lot_number}\`) — **${b.quantity} units** × ${b.cost_price_display} cost = **${b.batch_value_display}** (expires **${b.expiry_date}**, ${b.days_remaining} days left at ${b.location})`;
        });
        parts.push(
          `**Expiring Stock Financial Risk (Next ${output.days} Days):**\n- **Total Financial Value at Risk:** **${output.total_value_display}**\n- **Affected Inventory:** **${output.total_units_expiring} units** across **${output.batch_count} batch(es)** (reference date **${output.reference_date}**)\n${batchLines.join('\n')}`,
        );
      }
    } else if (call.name === 'get_sales_trend') {
      const output = call.result as GetSalesTrendToolOutput;
      const projText =
        output.projected_days_until_stockout !== null
          ? `**${output.projected_days_until_stockout} days**`
          : 'N/A (no sales history)';
      parts.push(
        `**Sales Trend for ${output.brand_name}** (${output.days}-day analysis):\n- **Total Sales:** **${output.total_sales_units} units** across ${output.transaction_count} transaction(s)\n- **Avg Daily Sales:** **${output.average_daily_sales} units/day**\n- **Current Stock:** **${output.current_stock} units** (Reorder level: ${output.reorder_level})\n- **Projected Days Until Stockout:** ${projText} (Risk: **${output.stockout_risk_label}**)`,
      );
    } else if (call.name === 'get_revenue') {
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

