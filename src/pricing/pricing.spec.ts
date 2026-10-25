import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate';
import { createRepository } from '../db/repository';
import { seedDatabase } from '../db/seed';
import { SqliteWasmAdapter } from '../db/sqlite-wasm-adapter';
import {
  computeDerivedPriceDisplays,
  confirmExistingMedicationPrice,
  evaluateStandaloneCalculator,
  formatCentsToMajor,
  getMedicationPriceVisualState,
  parseMoneyInputToCents,
  savePharmacistManualPrice,
} from './pricing';

function collectProductionSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectProductionSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Prompt 6 Acceptance Criteria & Constraints: Pharmacist Pricing & Calculator', () => {
  it('computes 3 x 12.50, 10% discount, 5% tax as exactly 35.44 using single-step ROUND_HALF_UP', () => {
    expect(parseMoneyInputToCents('12.50').cents).toBe(1250);
    expect(parseMoneyInputToCents('12,50').cents).toBe(1250);
    expect(parseMoneyInputToCents('12').cents).toBe(1200);

    const calc = evaluateStandaloneCalculator({
      items: [
        {
          medicationId: 1,
          brandName: 'Amoxil',
          unitPriceCents: 1250,
          quantity: 3,
        },
      ],
      discountPercent: '10',
      taxPercent: '5',
    });

    expect(calc.canComputeGrandTotal).toBe(true);
    expect(calc.grandTotalCents).toBe(3544);
    expect(calc.grandTotalMajor).toBe('35.44');
    expect(calc.grandTotalFormatted).toBe('$35.44');
  });

  it('refuses to compute a grand total when any selected medication has NULL price and unblocks after inline price entry', async () => {
    const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);
    const repo = createRepository(db);

    const lantus = (await repo.getMedicationById(3))!;
    expect(lantus.unit_price_cents).toBeNull();

    const blocked = evaluateStandaloneCalculator({
      items: [
        {
          medicationId: 1,
          brandName: 'Amoxil',
          unitPriceCents: 1250,
          quantity: 3,
        },
        {
          medicationId: lantus.id,
          brandName: lantus.brand_name,
          unitPriceCents: lantus.unit_price_cents,
          quantity: 1,
        },
      ],
      discountPercent: '10',
      taxPercent: '5',
    });

    expect(blocked.canComputeGrandTotal).toBe(false);
    expect(blocked.grandTotalCents).toBeNull();
    expect(blocked.grandTotalFormatted).toBe('price not entered — set price to include in total');
    expect(blocked.nullPriceItems.map((i) => i.brandName)).toEqual(['Lantus SoloStar']);

    const saved = await savePharmacistManualPrice(db, {
      medicationId: lantus.id,
      unitPriceInput: '46.50',
      userId: 'pharmacist:claire.dupont',
    });
    expect(saved.medication.unit_price_cents).toBe(4650);
    expect(saved.medication.price_source).toBe('manual');
    expect(saved.medication.price_confirmed).toBe(1);
    expect(saved.priceHistory).toHaveLength(1);
    expect(saved.priceHistory[0].source).toBe('manual');

    await db.close();
  });

  it('confirms an imported or official_tariff price by flipping price_confirmed to 1 and preserving source in price_history', async () => {
    const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
    await runMigrations(db);
    await seedDatabase(db);
    const repo = createRepository(db);

    // #4 Lipitor is seeded with price_source='imported', price_confirmed=0
    const before = (await repo.getMedicationById(4))!;
    expect(before.price_confirmed).toBe(0);
    expect(before.price_source).toBe('imported');
    expect(getMedicationPriceVisualState(before).status).toBe('unconfirmed');

    const confirmed = await confirmExistingMedicationPrice(db, 4, 'pharmacist:claire.dupont');
    expect(confirmed.medication.price_confirmed).toBe(1);
    expect(confirmed.medication.price_source).toBe('imported');
    expect(confirmed.priceHistory).toHaveLength(2);
    expect(confirmed.priceHistory[1].source).toBe('imported');

    // Setting a new manual price appends a price_history row with source='manual'
    const manual = await savePharmacistManualPrice(db, {
      medicationId: 4,
      unitPriceInput: '19,95',
      costPriceInput: '11.20',
      unitsPerPack: 30,
      userId: 'pharmacist:claire.dupont',
    });
    expect(manual.medication.unit_price_cents).toBe(1995);
    expect(manual.medication.price_source).toBe('manual');
    expect(manual.medication.price_confirmed).toBe(1);
    expect(manual.priceHistory).toHaveLength(3);
    expect(manual.priceHistory[2].source).toBe('manual');

    const derived = computeDerivedPriceDisplays({
      unitPriceCents: manual.medication.unit_price_cents,
      costPriceCents: manual.medication.cost_price_cents,
      unitsPerPack: manual.medication.units_per_pack,
      currency: manual.medication.currency,
    });
    // 1995 / 30 = 66.5 -> ROUND_HALF_UP = 67 cents ($0.67)
    expect(derived.pricePerDoseCents).toBe(67);
    expect(derived.pricePerDoseMajor).toBe('0.67');
    expect(formatCentsToMajor(null)).toBe('price not entered');

    await db.close();
  });

  it('enforces zero floating-point money math: fails if any production source file calls parseFloat', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
    const prodFiles = collectProductionSourceFiles(srcDir);
    expect(prodFiles.length).toBeGreaterThan(0);

    for (const filePath of prodFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(
        /\bparseFloat\s*\(/.test(content),
        `Forbidden parseFloat() found in ${path.relative(process.cwd(), filePath)}`,
      ).toBe(false);
    }
  });
});
