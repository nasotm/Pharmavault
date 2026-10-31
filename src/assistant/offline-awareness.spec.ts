import { describe, expect, it } from 'vitest';
import { generateDailyBriefing, runAssistantTurn } from './assistant';
import { runMigrations } from '../db/migrate';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import { dispenseStock } from '../movements';

async function createSeededTestDb() {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);
  return db;
}

describe('Offline Awareness & Fallback Layer', () => {
  it('Requirement 3: handles offline chat fallback for low-stock and location queries', async () => {
    const db = await createSeededTestDb();
    try {
      // 1. Low stock query while offline
      const lowStockTurn = await runAssistantTurn(db, "what is running low", {
        isOffline: true,
        referenceTimestamp: '2026-11-01T10:00:00.000Z',
      });
      expect(lowStockTurn.status).toBe('ok');
      expect(lowStockTurn.responseText.toLowerCase()).toContain('low-stock');

      // 2. Location query while offline
      const locationTurn = await runAssistantTurn(db, "where is Amoxil", {
        isOffline: true,
        referenceTimestamp: '2026-11-01T10:00:00.000Z',
      });
      expect(locationTurn.status).toBe('ok');
      expect(locationTurn.responseText).toContain('Zone A');

      // 3. General question while offline
      const generalTurn = await runAssistantTurn(db, "What is the capital of Algeria?", {
        isOffline: true,
        referenceTimestamp: '2026-11-01T10:00:00.000Z',
      });
      expect(generalTurn.status).toBe('ok');
      expect(generalTurn.responseText).toBe(
        'You are offline. I can only answer basic stock and location questions right now.',
      );
    } finally {
      await db.close();
    }
  });

  it('Requirement 4: generateDailyBriefing generates strict SQL summary when offline', async () => {
    const db = await createSeededTestDb();
    try {
      await dispenseStock(db, {
        medicationId: 1,
        batchId: 1,
        quantity: 2,
        reason: 'dispense:sale',
        userId: 'Pharmacist Test',
      });

      const briefing = await generateDailyBriefing(db, {
        isOffline: true,
        referenceDate: '2026-11-01',
      });

      expect(briefing.hasData).toBe(true);
      expect(briefing.isAiGenerated).toBe(false);
      expect(briefing.briefing).toMatch(/\d+ items low stock\. \d+ batch(?:es)? expiring\. Top item: .+/);
    } finally {
      await db.close();
    }
  });
});
