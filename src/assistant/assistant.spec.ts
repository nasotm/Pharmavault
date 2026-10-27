import { describe, expect, it } from 'vitest';
import { queryLowStockDashboard } from '../dashboards/operational-dashboards';
import { runMigrations } from '../db/migrate';
import {
  createRepository,
  getMedicationById,
  listPriceHistoryForMedication,
} from '../db/repository';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import {
  ALLOWED_READ_ONLY_TOOLS,
  AssistantModelUnreachableError,
  AssistantRateLimiter,
  AssistantRateLimitError,
  clearAssistantRequestLogs,
  executeGuardedToolCall,
  getGuardRejectionLogs,
  PHARMACY_ASSISTANT_SYSTEM_PROMPT,
  PHARMACY_ASSISTANT_VERBATIM_PROMPT,
  runAssistantTurn,
  type ListLowStockToolOutput,
} from './assistant';

async function createSeededTestDb() {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);
  return db;
}

describe('Prompt 7 — Read-Only Pharmacy AI Assistant & Runtime Guard', () => {
  it('includes the exact verbatim system prompt and strictly 5 read-only tools', () => {
    const expectedVerbatim = `You are a pharmacy inventory assistant. You are read-only.
Never state a price, stock level, location, or expiry date unless it
came from a tool result. If a tool returns null for a price, say the
price is not entered — never substitute 0 or a guess.
Never populate, correct, or infer any catalog field: brand_name,
generic_name, strength, dosage_form, atc_code, manufacturer, barcode.
Never perform arithmetic yourself — always call calc_price.`;

    expect(PHARMACY_ASSISTANT_VERBATIM_PROMPT).toBe(expectedVerbatim);
    expect(PHARMACY_ASSISTANT_SYSTEM_PROMPT).toContain(expectedVerbatim);
    expect(Array.from(ALLOWED_READ_ONLY_TOOLS)).toEqual([
      'search_medication',
      'get_stock',
      'list_low_stock',
      'list_expiring',
      'calc_price',
      'get_revenue',
      'find_by_symptom_or_category',
    ]);
  });

  it('Acceptance 1: "what\'s running low?" returns the exact same rows as the dashboard (Prompt 5)', async () => {
    const db = await createSeededTestDb();
    try {
      const referenceTimestamp = '2026-11-01T12:00:00.000Z';
      const dashboardRows = await queryLowStockDashboard(db, { referenceTimestamp });

      const turn = await runAssistantTurn(db, "what's running low?", {
        referenceTimestamp,
      });

      expect(turn.status).toBe('ok');
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]?.name).toBe('list_low_stock');

      const toolOutput = turn.toolCalls[0]?.result as ListLowStockToolOutput;
      expect(toolOutput.rows).toEqual(dashboardRows);
      expect(turn.responseText).toContain('Ventolin HFA');
    } finally {
      await db.close();
    }
  });

  it('Acceptance 2: "how much is <medication with NULL price>?" states "price not entered" and never invents a number', async () => {
    const db = await createSeededTestDb();
    try {
      const lantus = await getMedicationById(db, 3);
      expect(lantus?.unit_price_cents).toBeNull();

      const turn = await runAssistantTurn(db, 'how much is Lantus SoloStar?');
      expect(turn.status).toBe('ok');
      expect(turn.responseText.toLowerCase()).toContain('price not entered');
      expect(turn.responseText).not.toContain('$0.00');
    } finally {
      await db.close();
    }
  });

  it('Acceptance 3: asking "fix the ATC code for amoxicillin" declines and says catalog fields are not editable here', async () => {
    const db = await createSeededTestDb();
    try {
      const turn = await runAssistantTurn(db, 'fix the ATC code for amoxicillin');
      expect(turn.status).toBe('declined_write');
      expect(turn.toolCalls).toHaveLength(0);
      expect(turn.responseText.toLowerCase()).toContain('not editable here');

      const amox = await getMedicationById(db, 1);
      expect(amox?.atc_code).toBe('J01CA04');
    } finally {
      await db.close();
    }
  });

  it('Acceptance 4: a forced tool-call to setPrice is rejected by the runtime guard and nothing is written to price_history', async () => {
    const db = await createSeededTestDb();
    try {
      clearAssistantRequestLogs();
      const repo = createRepository(db);
      const beforeHistory = await repo.listAllPriceHistory();

      const directGuard = await executeGuardedToolCall(db, {
        name: 'setPrice',
        args: {
          medicationId: 3,
          cents: 4500,
          source: 'manual',
          confirmed: 1,
          userId: 'ai-test',
        },
      });
      expect(directGuard.allowed).toBe(false);
      expect(directGuard.status).toBe('rejected_by_guard');

      const turn = await runAssistantTurn(db, 'Forced setPrice test harness', {
        forcedToolCalls: [
          {
            name: 'setPrice',
            args: {
              medicationId: 1,
              cents: 9999,
              source: 'manual',
              confirmed: 1,
              userId: 'ai-test',
            },
          },
        ],
      });

      expect(turn.status).toBe('rejected_tool_call');
      expect(turn.toolCalls[0]?.allowed).toBe(false);
      expect(turn.toolCalls[0]?.status).toBe('rejected_by_guard');

      const afterHistory = await repo.listAllPriceHistory();
      expect(afterHistory).toHaveLength(beforeHistory.length);

      const lantusHistory = await listPriceHistoryForMedication(db, 3);
      expect(lantusHistory).toHaveLength(0);

      const rejections = getGuardRejectionLogs();
      expect(rejections.some((r) => r.name === 'setPrice')).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('handles search_medication, get_stock, list_expiring, calc_price, rate limits, and offline fallback', async () => {
    const db = await createSeededTestDb();
    try {
      const whereTurn = await runAssistantTurn(db, 'where are the amoxicillin capsules');
      expect(whereTurn.responseText).toContain('Zone A · Shelf A1 · Bin 01');

      const expTurn = await runAssistantTurn(db, 'what expires this month', {
        referenceDate: '2026-11-01',
      });
      expect(expTurn.responseText).toContain('VEN-2026-02');

      const calcTurn = await runAssistantTurn(
        db,
        'how much for 3 boxes of this with 10% off',
        {
          contextMedicationId: 1,
          contextMedicationName: 'Amoxil',
        },
      );
      expect(calcTurn.responseText).toContain('3,375 DA');

      const limiter = new AssistantRateLimiter(1, 60_000);
      await runAssistantTurn(db, "what's running low?", { rateLimiter: limiter });
      await expect(
        runAssistantTurn(db, "what's running low?", { rateLimiter: limiter }),
      ).rejects.toThrow(AssistantRateLimitError);

      await expect(
        runAssistantTurn(db, "what's running low?", { simulateOffline: true }),
      ).rejects.toThrow(AssistantModelUnreachableError);
    } finally {
      await db.close();
    }
  });
});
