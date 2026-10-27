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
  generateQuickAccessAiTrends,
  getAssistantRequestLogs,
  getGuardRejectionLogs,
  NO_RECENT_SALES_TREND_MESSAGE,
  PHARMACY_ASSISTANT_SYSTEM_PROMPT,
  PHARMACY_ASSISTANT_VERBATIM_PROMPT,
  runAssistantTurn,
  verifyInsightNumbersGroundedInSql,
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
    'get_revenue',
    'find_by_symptom_or_category',
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

test('Quick Access & AI Trends: returns "No recent sales trend available." when no 7d dispense data exists, and grounds Top 5 + insight strictly in SQL numbers', async () => {
  const db = await createSeededTestDb();
  try {
    const repo = createRepository(db);
    const refNow = '2026-10-25T12:00:00.000Z';

    // 1. Fresh seeded DB has only initial_receipt movements (positive deltas), so 0 dispense rows
    const emptyTrends = await generateQuickAccessAiTrends(db, {
      referenceTimestamp: refNow,
    });
    assert.equal(emptyTrends.topDispensed.length, 0);
    assert.equal(emptyTrends.insightText, NO_RECENT_SALES_TREND_MESSAGE);
    assert.equal(emptyTrends.insightText, 'No recent sales trend available.');

    // 2. Non-dispense negative movements (e.g. correction) or movements older than 7d do not count as current 7d dispenses
    await repo.insertMovement({
      medication_id: 1,
      batch_id: 1,
      delta: -15,
      reason: 'correction:damaged_pack',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-24T10:00:00.000Z',
    });
    const stillEmpty = await generateQuickAccessAiTrends(db, {
      referenceTimestamp: refNow,
    });
    assert.equal(stillEmpty.topDispensed.length, 0);
    assert.equal(stillEmpty.insightText, 'No recent sales trend available.');

    // 3. Insert prior-week dispense (20 units of Amoxil #1 at -10 days) and current-week dispenses:
    // - Amoxil (#1): -20 in prior week, -16 and -10 in current week (total 26 units -> +30% faster this week)
    // - Doliprane (#5): -18 in current week
    // - Lipitor (#4): -12 in current week
    // - Lantus SoloStar (#3): -7 in current week
    // - Ventolin HFA (#2): -4 in current week
    // - Plus a 6th medication with -1 in current week (must be excluded by Top 5 limit)
    const med6 = await repo.insertMedication({
      brand_name: 'Zyrtec',
      generic_name: 'Cetirizine',
      strength: '10 mg',
      dosage_form: 'Tablet',
      zone: 'B',
      shelf: 'B1',
      bin: '02',
      reorder_level: 10,
    });
    const batch6 = await repo.insertBatch({
      medication_id: med6.id,
      lot_number: 'ZYR-01',
      quantity: 50,
      expiry_date: '2028-01-01',
    });

    await repo.insertMovement({
      medication_id: 1,
      batch_id: 1,
      delta: -20,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-15T10:00:00.000Z', // 10 days before refNow (prior 7d window)
    });
    await repo.insertMovement({
      medication_id: 1,
      batch_id: 1,
      delta: -16,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-22T09:00:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 1,
      batch_id: 1,
      delta: -10,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-24T14:00:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 5,
      batch_id: 6,
      delta: -18,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-23T11:00:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 4,
      batch_id: 5,
      delta: -12,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-23T15:00:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 3,
      batch_id: 3,
      delta: -7,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-24T08:00:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 2,
      batch_id: 2,
      delta: -4,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-24T16:00:00.000Z',
    });
    await repo.insertMovement({
      medication_id: med6.id,
      batch_id: batch6.id,
      delta: -1,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-24T17:00:00.000Z',
    });

    const populatedTrends = await generateQuickAccessAiTrends(db, {
      referenceTimestamp: refNow,
    });

    // Top 5 Most Dispensed ordered by sum of negative dispense deltas over last 7 days
    assert.equal(populatedTrends.topDispensed.length, 5);
    assert.deepEqual(
      populatedTrends.topDispensed.map((r) => ({
        brand_name: r.brand_name,
        dispensed_7d: r.dispensed_7d,
      })),
      [
        { brand_name: 'Amoxil', dispensed_7d: 26 },
        { brand_name: 'Doliprane', dispensed_7d: 18 },
        { brand_name: 'Lipitor', dispensed_7d: 12 },
        { brand_name: 'Lantus SoloStar', dispensed_7d: 7 },
        { brand_name: 'Ventolin HFA', dispensed_7d: 4 },
      ],
    );

    // Verify SQL week-over-week calculation: (26 - 20) / 20 = +30%
    assert.equal(populatedTrends.topDispensed[0]?.dispensed_prev_7d, 20);
    assert.equal(populatedTrends.topDispensed[0]?.pct_change_vs_prev_7d, 30);
    assert.ok(
      populatedTrends.insightText.includes('Amoxil is selling 30% faster this week'),
      `Expected insight to mention "Amoxil is selling 30% faster this week", got: ${populatedTrends.insightText}`,
    );
    assert.ok(populatedTrends.insightText.includes('Consider reordering.'));
    assert.equal(
      verifyInsightNumbersGroundedInSql(populatedTrends.insightText, populatedTrends.topDispensed),
      true,
    );

    // Any invented number not in SQL is rejected by verifyInsightNumbersGroundedInSql
    assert.equal(
      verifyInsightNumbersGroundedInSql(
        'Amoxil is selling 999% faster this week.',
        populatedTrends.topDispensed,
      ),
      false,
    );
  } finally {
    await db.close();
  }
});

test('Expanded Ask Assistant Toolset: get_revenue(date), list_expiring(days), and find_by_symptom_or_category(category)', async () => {
  const db = await createSeededTestDb();
  try {
    const repo = createRepository(db);
    const targetDate = '2026-10-26';

    // 1. Before any dispenses on 2026-10-26, "How much did we sell today?" calls get_revenue and returns $0.00
    const zeroRevTurn = await runAssistantTurn(db, 'How much did we sell today?', {
      referenceDate: targetDate,
    });
    assert.equal(zeroRevTurn.status, 'ok');
    assert.equal(zeroRevTurn.toolCalls.length, 1);
    assert.equal(zeroRevTurn.toolCalls[0]?.name, 'get_revenue');
    assert.equal(zeroRevTurn.toolCalls[0]?.args.date, targetDate);
    assert.ok(zeroRevTurn.responseText.includes('$0.00'));
    assert.ok(zeroRevTurn.responseText.includes('0 units'));

    // 2. Record dispenses on 2026-10-26:
    // - 2 packs of Amoxil (#1 @ $12.50 = 1250 cents) -> 2500 cents ($25.00)
    // - 3 packs of Doliprane (#5 @ $3.50 = 350 cents) -> 1050 cents ($10.50)
    // - 1 pack of Lantus SoloStar (#3 @ NULL price) -> price not entered (never coerced to 0)
    // Total priced revenue = 3550 cents ($35.50), total units sold = 6 across 3 transactions
    await repo.insertMovement({
      medication_id: 1,
      batch_id: 1,
      delta: -2,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-26T09:15:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 5,
      batch_id: 6,
      delta: -3,
      reason: 'dispense:prescription',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-26T11:30:00.000Z',
    });
    await repo.insertMovement({
      medication_id: 3,
      batch_id: 3,
      delta: -1,
      reason: 'dispense',
      user_id: 'pharmacist:claire.dupont',
      created_at: '2026-10-26T14:45:00.000Z',
    });

    const revTurn = await runAssistantTurn(db, 'How much did we sell today?', {
      referenceDate: targetDate,
    });
    assert.equal(revTurn.status, 'ok');
    assert.equal(revTurn.toolCalls[0]?.name, 'get_revenue');
    assert.ok(revTurn.responseText.includes('$35.50'));
    assert.ok(revTurn.responseText.includes('Amoxil'));
    assert.ok(revTurn.responseText.includes('$25.00'));
    assert.ok(revTurn.responseText.includes('Doliprane'));
    assert.ok(revTurn.responseText.includes('$10.50'));
    assert.ok(revTurn.responseText.includes('Lantus SoloStar'));
    assert.ok(revTurn.responseText.toLowerCase().includes('price not entered'));

    // 3. "What is expiring this month?" calls list_expiring(days)
    const expiringTurn = await runAssistantTurn(db, 'What is expiring this month?', {
      referenceDate: targetDate,
    });
    assert.equal(expiringTurn.status, 'ok');
    assert.equal(expiringTurn.toolCalls[0]?.name, 'list_expiring');
    assert.ok(expiringTurn.responseText.includes('Ventolin HFA'));
    assert.ok(expiringTurn.responseText.includes('VEN-2026-02'));
    assert.ok(expiringTurn.responseText.includes('2026-11-24'));

    // 4. "Find Antibacterial medications" calls find_by_symptom_or_category("Antibacterial")
    const categoryTurn = await runAssistantTurn(db, 'Find Antibacterial medications', {
      referenceDate: targetDate,
    });
    assert.equal(categoryTurn.status, 'ok');
    assert.equal(categoryTurn.toolCalls[0]?.name, 'find_by_symptom_or_category');
    assert.equal(categoryTurn.toolCalls[0]?.args.category, 'Antibacterial');
    assert.ok(categoryTurn.responseText.includes('Amoxil'));
    assert.ok(categoryTurn.responseText.includes('Amoxicillin'));
    assert.ok(categoryTurn.responseText.includes('Zone A · Shelf A1 · Bin 01'));

    // 5. Unknown category returns 0 results and never invents a medication
    const emptyCategoryTurn = await runAssistantTurn(
      db,
      'Find medications in category Antifungal',
      { referenceDate: targetDate },
    );
    assert.equal(emptyCategoryTurn.status, 'ok');
    assert.equal(emptyCategoryTurn.toolCalls[0]?.name, 'find_by_symptom_or_category');
    assert.ok(
      emptyCategoryTurn.responseText.includes(
        'No medications found in the inventory matching category or symptom',
      ),
    );
  } finally {
    await db.close();
  }
});


