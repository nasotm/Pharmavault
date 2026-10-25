import assert from 'node:assert/strict';
import test from 'node:test';
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
  getAssistantRequestLogs,
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

test('Prompt 7 Deliverable 3: system prompt includes the exact verbatim instructions', () => {
  const expectedVerbatim = `You are a pharmacy inventory assistant. You are read-only.
Never state a price, stock level, location, or expiry date unless it
came from a tool result. If a tool returns null for a price, say the
price is not entered — never substitute 0 or a guess.
Never populate, correct, or infer any catalog field: brand_name,
generic_name, strength, dosage_form, atc_code, manufacturer, barcode.
Never perform arithmetic yourself — always call calc_price.`;

  assert.equal(PHARMACY_ASSISTANT_VERBATIM_PROMPT, expectedVerbatim);
  assert.ok(PHARMACY_ASSISTANT_SYSTEM_PROMPT.includes(expectedVerbatim));
  assert.deepEqual(Array.from(ALLOWED_READ_ONLY_TOOLS), [
    'search_medication',
    'get_stock',
    'list_low_stock',
    'list_expiring',
    'calc_price',
  ]);
});

test('Acceptance 1: "what\'s running low?" returns the exact same rows as the low-stock dashboard (Prompt 5)', async () => {
  const db = await createSeededTestDb();
  try {
    const referenceTimestamp = '2026-11-01T12:00:00.000Z';
    const expectedDashboardRows = await queryLowStockDashboard(db, { referenceTimestamp });
    assert.ok(expectedDashboardRows.length > 0);

    const turn = await runAssistantTurn(db, "what's running low?", {
      referenceTimestamp,
    });

    assert.equal(turn.status, 'ok');
    assert.equal(turn.toolCalls.length, 1);
    assert.equal(turn.toolCalls[0]?.name, 'list_low_stock');
    assert.equal(turn.toolCalls[0]?.status, 'executed');

    const toolOutput = turn.toolCalls[0]?.result as ListLowStockToolOutput;
    assert.deepEqual(toolOutput.rows, expectedDashboardRows);
    assert.ok(turn.responseText.includes('Ventolin HFA'));
    assert.ok(turn.responseText.includes('6 units'));
  } finally {
    await db.close();
  }
});

test('Acceptance 2: "how much is <medication with NULL price>?" states "price not entered" and never invents a number or 0', async () => {
  const db = await createSeededTestDb();
  try {
    // Lantus SoloStar (#3) has unit_price_cents = NULL in seed data
    const lantus = await getMedicationById(db, 3);
    assert.ok(lantus);
    assert.equal(lantus.unit_price_cents, null);

    const turn = await runAssistantTurn(db, 'how much is Lantus SoloStar?');

    assert.equal(turn.status, 'ok');
    assert.ok(turn.toolCalls.some((tc) => tc.name === 'calc_price'));
    assert.ok(
      turn.responseText.toLowerCase().includes('price not entered'),
      `Expected "price not entered" in response: ${turn.responseText}`,
    );
    assert.equal(turn.responseText.includes('$0.00'), false);
    assert.equal(turn.responseText.includes('0 ¢'), false);
  } finally {
    await db.close();
  }
});

test('Acceptance 3: Asking "fix the ATC code for amoxicillin" declines and says catalog fields are not editable here', async () => {
  const db = await createSeededTestDb();
  try {
    const beforeAmox = await getMedicationById(db, 1);
    assert.equal(beforeAmox?.atc_code, 'J01CA04');

    const turn = await runAssistantTurn(db, 'fix the ATC code for amoxicillin');

    assert.equal(turn.status, 'declined_write');
    assert.equal(turn.toolCalls.length, 0);
    assert.ok(
      turn.responseText.toLowerCase().includes('not editable here'),
      `Expected "not editable here" in decline response: ${turn.responseText}`,
    );
    assert.ok(turn.responseText.includes('atc_code'));

    const afterAmox = await getMedicationById(db, 1);
    assert.equal(afterAmox?.atc_code, 'J01CA04');
  } finally {
    await db.close();
  }
});

test('Acceptance 4: A forced tool-call to setPrice (test harness) is rejected by the runtime guard and nothing is written to price_history', async () => {
  const db = await createSeededTestDb();
  try {
    clearAssistantRequestLogs();
    const repo = createRepository(db);
    const beforeHistory = await repo.listAllPriceHistory();
    const beforeMed1 = await getMedicationById(db, 1);
    const beforeMed3 = await getMedicationById(db, 3);

    // 1. Direct guard check on setPrice
    const directGuardResult = await executeGuardedToolCall(db, {
      name: 'setPrice',
      args: {
        medicationId: 3,
        cents: 5500,
        source: 'manual',
        confirmed: 1,
        userId: 'ai-rogue',
      },
    });

    assert.equal(directGuardResult.allowed, false);
    assert.equal(directGuardResult.status, 'rejected_by_guard');
    assert.ok(directGuardResult.error?.includes('setPrice'));

    // 2. Full turn test harness with forcedToolCalls to setPrice and insertMovement
    const forcedTurn = await runAssistantTurn(db, 'Force setPrice test harness', {
      forcedToolCalls: [
        {
          name: 'setPrice',
          args: {
            medicationId: 1,
            cents: 9999,
            source: 'manual',
            confirmed: 1,
            userId: 'ai-rogue',
          },
        },
        {
          name: 'insertMovement',
          args: {
            medicationId: 1,
            batchId: 1,
            delta: -10,
            reason: 'ai-dispense',
            userId: 'ai-rogue',
          },
        },
      ],
    });

    assert.equal(forcedTurn.status, 'rejected_tool_call');
    assert.equal(forcedTurn.toolCalls.length, 2);
    assert.equal(forcedTurn.toolCalls[0]?.allowed, false);
    assert.equal(forcedTurn.toolCalls[0]?.status, 'rejected_by_guard');
    assert.equal(forcedTurn.toolCalls[1]?.allowed, false);
    assert.equal(forcedTurn.toolCalls[1]?.status, 'rejected_by_guard');

    // Confirm NOTHING was written to price_history or medication
    const afterHistory = await repo.listAllPriceHistory();
    assert.equal(afterHistory.length, beforeHistory.length);

    const med3History = await listPriceHistoryForMedication(db, 3);
    assert.equal(med3History.length, 0);

    const afterMed1 = await getMedicationById(db, 1);
    const afterMed3 = await getMedicationById(db, 3);
    assert.equal(afterMed1?.unit_price_cents, beforeMed1?.unit_price_cents);
    assert.equal(afterMed3?.unit_price_cents, null);
    assert.equal(afterMed3?.unit_price_cents, beforeMed3?.unit_price_cents);

    // Confirm rejection was logged locally
    const rejections = getGuardRejectionLogs();
    assert.ok(rejections.length >= 3);
    assert.ok(rejections.some((r) => r.name === 'setPrice'));
  } finally {
    await db.close();
  }
});

test('Deliverable 1 & 2: Location, stock, expiring, and calc_price questions map to read-only tools', async () => {
  const db = await createSeededTestDb();
  try {
    // 1. "where are the amoxicillin capsules" -> search_medication + get_stock
    const whereTurn = await runAssistantTurn(db, 'where are the amoxicillin capsules');
    assert.equal(whereTurn.status, 'ok');
    assert.ok(whereTurn.toolCalls.some((c) => c.name === 'search_medication'));
    assert.ok(whereTurn.toolCalls.some((c) => c.name === 'get_stock'));
    assert.ok(whereTurn.responseText.includes('Zone A · Shelf A1 · Bin 01'));
    assert.ok(whereTurn.responseText.includes('125 units'));

    // 2. "what expires this month" -> list_expiring
    const expTurn = await runAssistantTurn(db, 'what expires this month', {
      referenceDate: '2026-11-01',
    });
    assert.equal(expTurn.status, 'ok');
    assert.equal(expTurn.toolCalls[0]?.name, 'list_expiring');
    assert.ok(expTurn.responseText.includes('VEN-2026-02'));

    // 3. "how much for 3 boxes of this with 10% off" (context: Amoxil #1 @ $12.50 = 1250 cents)
    // 3 * 1250 = 3750 cents; 10% off = 3375 cents ($33.75)
    const calcTurn = await runAssistantTurn(
      db,
      'how much for 3 boxes of this with 10% off',
      {
        contextMedicationId: 1,
        contextMedicationName: 'Amoxil',
      },
    );
    assert.equal(calcTurn.status, 'ok');
    assert.equal(calcTurn.toolCalls[0]?.name, 'calc_price');
    assert.ok(calcTurn.responseText.includes('$33.75'));

    // 4. Rate limiter + local request logs
    const logs = getAssistantRequestLogs();
    assert.ok(logs.length >= 3);

    const tightLimiter = new AssistantRateLimiter(1, 60_000);
    await runAssistantTurn(db, "what's running low?", { rateLimiter: tightLimiter });
    await assert.rejects(
      () => runAssistantTurn(db, "what's running low?", { rateLimiter: tightLimiter }),
      AssistantRateLimitError,
    );

    // 5. Offline simulation throws AssistantModelUnreachableError
    await assert.rejects(
      () => runAssistantTurn(db, "what's running low?", { simulateOffline: true }),
      AssistantModelUnreachableError,
    );
  } finally {
    await db.close();
  }
});
