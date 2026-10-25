import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
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

test('Prompt 6 Acceptance 1: 3 x 12.50, 10% discount, 5% tax returns exactly 35.44 (single-step ROUND_HALF_UP)', () => {
  const parsedPrice = parseMoneyInputToCents('12.50');
  assert.equal(parsedPrice.ok, true);
  assert.equal(parsedPrice.cents, 1250);

  const evalResult = evaluateStandaloneCalculator({
    items: [
      {
        medicationId: 1,
        brandName: 'Amoxil',
        unitPriceCents: parsedPrice.cents,
        currency: 'USD',
        quantity: 3,
      },
    ],
    discountPercent: '10',
    taxPercent: '5',
    currency: 'USD',
  });

  assert.equal(evalResult.canComputeGrandTotal, true);
  assert.equal(evalResult.subtotalCents, 3750);
  assert.equal(evalResult.subtotalMajor, '37.50');
  assert.equal(evalResult.grandTotalCents, 3544);
  assert.equal(evalResult.grandTotalMajor, '35.44');
  assert.equal(evalResult.grandTotalFormatted, '$35.44');
  assert.equal(evalResult.lines[0].lineFinalTotalCents, 3544);
  assert.equal(evalResult.lines[0].lineFinalTotalMajor, '35.44');
});

test('Prompt 6 Acceptance 2: A medication with NULL price cannot be included in a total; calculator names it and supports inline price entry', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);
  const repo = createRepository(db);

  const amoxil = (await repo.getMedicationById(1))!;
  const lantusNull = (await repo.getMedicationById(3))!;
  assert.equal(lantusNull.unit_price_cents, null);

  // Calculator with Amoxil ($12.50) + Lantus SoloStar (NULL)
  const blockedEval = evaluateStandaloneCalculator({
    items: [
      {
        medicationId: amoxil.id,
        brandName: amoxil.brand_name,
        unitPriceCents: amoxil.unit_price_cents,
        quantity: 3,
      },
      {
        medicationId: lantusNull.id,
        brandName: lantusNull.brand_name,
        unitPriceCents: lantusNull.unit_price_cents,
        quantity: 1,
      },
    ],
    discountPercent: '10',
    taxPercent: '5',
  });

  assert.equal(blockedEval.canComputeGrandTotal, false);
  assert.equal(blockedEval.hasNullPriceItems, true);
  assert.equal(blockedEval.grandTotalCents, null);
  assert.equal(blockedEval.grandTotalMajor, 'price not entered');
  assert.equal(
    blockedEval.grandTotalFormatted,
    'price not entered — set price to include in total',
  );
  assert.equal(blockedEval.nullPriceItems.length, 1);
  assert.equal(blockedEval.nullPriceItems[0].brandName, 'Lantus SoloStar');
  assert.ok(blockedEval.blockingMessage?.includes('Lantus SoloStar'));

  // Inline price entry sets price via repository.setPrice with source='manual', confirmed=1
  const inlineSaved = await savePharmacistManualPrice(db, {
    medicationId: lantusNull.id,
    unitPriceInput: '46,50',
    userId: 'pharmacist:claire.dupont',
  });
  assert.equal(inlineSaved.medication.unit_price_cents, 4650);
  assert.equal(inlineSaved.medication.price_source, 'manual');
  assert.equal(inlineSaved.medication.price_confirmed, 1);
  assert.equal(inlineSaved.priceHistory.length, 1);
  assert.equal(inlineSaved.priceHistory[0].source, 'manual');

  // Re-evaluate calculator now that Lantus SoloStar has a confirmed price
  const unlockedEval = evaluateStandaloneCalculator({
    items: [
      {
        medicationId: amoxil.id,
        brandName: amoxil.brand_name,
        unitPriceCents: amoxil.unit_price_cents,
        quantity: 3,
      },
      {
        medicationId: inlineSaved.medication.id,
        brandName: inlineSaved.medication.brand_name,
        unitPriceCents: inlineSaved.medication.unit_price_cents,
        quantity: 1,
      },
    ],
    discountPercent: '10',
    taxPercent: '5',
  });

  assert.equal(unlockedEval.canComputeGrandTotal, true);
  assert.equal(unlockedEval.hasNullPriceItems, false);
  // Line 1: 3 * 1250 = 3750 -> * 0.9 * 1.05 = 3543.75 -> 3544
  // Line 2: 1 * 4650 = 4650 -> * 0.9 * 1.05 = 4394.25 -> 4394
  // Total: 3544 + 4394 = 7938 ($79.38)
  assert.equal(unlockedEval.grandTotalCents, 7938);
  assert.equal(unlockedEval.grandTotalMajor, '79.38');

  await db.close();
});

test('Prompt 6 Acceptance 3 & 4: Confirming imported/tariff price flips price_confirmed to 1 preserving source; setting a new price writes source="manual"', async () => {
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  await runMigrations(db);
  await seedDatabase(db);
  const repo = createRepository(db);

  // Seeded #4 Lipitor has unit_price_cents = 1840, price_source = 'imported', price_confirmed = 0
  const lipitorBefore = (await repo.getMedicationById(4))!;
  assert.equal(lipitorBefore.unit_price_cents, 1840);
  assert.equal(lipitorBefore.price_source, 'imported');
  assert.equal(lipitorBefore.price_confirmed, 0);

  const lipitorVisualBefore = getMedicationPriceVisualState(lipitorBefore);
  assert.equal(lipitorVisualBefore.status, 'unconfirmed');
  assert.equal(lipitorVisualBefore.isGreyedOut, true);
  assert.equal(lipitorVisualBefore.showConfirmButton, true);

  const historyBefore = await repo.listPriceHistoryForMedication(4);
  assert.equal(historyBefore.length, 1);

  // Confirm imported price -> flips price_confirmed to 1, preserves source = 'imported', adds 1 price_history row
  const confirmedImported = await confirmExistingMedicationPrice(
    db,
    4,
    'pharmacist:claire.dupont',
  );
  assert.equal(confirmedImported.medication.price_confirmed, 1);
  assert.equal(confirmedImported.medication.price_source, 'imported');
  assert.equal(confirmedImported.medication.unit_price_cents, 1840);
  assert.equal(confirmedImported.priceHistory.length, 2);
  assert.equal(confirmedImported.priceHistory[1].source, 'imported');
  assert.equal(confirmedImported.priceHistory[1].unit_price_cents, 1840);

  // Also test confirming an 'official_tariff' unconfirmed price
  await repo.setPrice(4, 1900, 'official_tariff', 0, 'tariff-importer');
  const confirmedTariff = await confirmExistingMedicationPrice(
    db,
    4,
    'pharmacist:claire.dupont',
  );
  assert.equal(confirmedTariff.medication.price_confirmed, 1);
  assert.equal(confirmedTariff.medication.price_source, 'official_tariff');
  assert.equal(confirmedTariff.priceHistory.length, 4);
  assert.equal(confirmedTariff.priceHistory[3].source, 'official_tariff');

  // Setting a new price from the editor ("12", "12.50", "12,50") writes source='manual', confirmed=1
  const manualSaved = await savePharmacistManualPrice(db, {
    medicationId: 4,
    unitPriceInput: '21,50',
    costPriceInput: '14.00',
    currency: 'EUR',
    unitsPerPack: 30,
    userId: 'pharmacist:claire.dupont',
  });
  assert.equal(manualSaved.medication.unit_price_cents, 2150);
  assert.equal(manualSaved.medication.cost_price_cents, 1400);
  assert.equal(manualSaved.medication.currency, 'EUR');
  assert.equal(manualSaved.medication.units_per_pack, 30);
  assert.equal(manualSaved.medication.price_source, 'manual');
  assert.equal(manualSaved.medication.price_confirmed, 1);
  assert.equal(manualSaved.priceHistory.length, 5);
  assert.equal(manualSaved.priceHistory[4].source, 'manual');
  assert.equal(manualSaved.priceHistory[4].unit_price_cents, 2150);

  await db.close();
});

test('Deliverables 1, 3 & Constraints: Money input parsing ("12.50", "12,50", "12"), derived displays (price per dose & margin %), NULL semantics, and zero parseFloat grep check', () => {
  assert.equal(parseMoneyInputToCents('12.50').cents, 1250);
  assert.equal(parseMoneyInputToCents('12,50').cents, 1250);
  assert.equal(parseMoneyInputToCents('12').cents, 1200);
  assert.equal(formatCentsToMajor(null), 'price not entered');

  // Derived displays: Amoxil ($12.50, cost $8.20, 21 units/pack)
  // price per dose = 1250 / 21 = 59.5238... -> ROUND_HALF_UP = 60 cents ($0.60)
  // margin % = (1250 - 820) / 1250 = 430 / 1250 = 34.40%
  const derived = computeDerivedPriceDisplays({
    unitPriceCents: 1250,
    costPriceCents: 820,
    unitsPerPack: 21,
    currency: 'USD',
  });
  assert.equal(derived.pricePerDoseCents, 60);
  assert.equal(derived.pricePerDoseMajor, '0.60');
  assert.equal(derived.marginBasisPoints, 3440);
  assert.equal(derived.marginFormatted, '34.40%');

  // NULL price derived displays show "price not entered", never "0.00"
  const derivedNull = computeDerivedPriceDisplays({
    unitPriceCents: null,
    costPriceCents: 4100,
    unitsPerPack: 5,
    currency: 'USD',
  });
  assert.equal(derivedNull.pricePerDoseCents, null);
  assert.equal(derivedNull.pricePerDoseFormatted, 'price not entered');
  assert.equal(derivedNull.marginFormatted, 'price not entered');

  // Grep test: fail if any production file in src/ uses parseFloat
  const srcDir = path.resolve(process.cwd(), 'src');
  const prodFiles = collectProductionSourceFiles(srcDir);
  assert.ok(prodFiles.length > 0);
  for (const filePath of prodFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      /\bparseFloat\s*\(/.test(content),
      false,
      `Forbidden parseFloat() call found in ${path.relative(process.cwd(), filePath)}`,
    );
  }
});
