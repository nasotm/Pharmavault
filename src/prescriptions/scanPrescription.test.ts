import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations, seedDatabase, SqliteWasmAdapter } from '../db';
import {
  matchExtractedPrescriptionWithCatalog,
  parseExtractedPrescriptionJson,
  SAMPLE_HANDWRITTEN_PRESCRIPTION_ITEMS,
  SCAN_PRESCRIPTION_PROMPT,
  togglePrescriptionItemConfirmation,
  validateManualConfirmationBeforeAction,
} from './scanPrescription';

test('Scan Prescription — prompt contract, JSON parsing, automatic searchMedications lookup, and manual confirmation gate', async () => {
  // 1. Prompt must match exact specification
  assert.equal(
    SCAN_PRESCRIPTION_PROMPT,
    'Extract only the medication names and dosages from this image as a JSON array.',
  );

  // 2. JSON array parsing handles standard objects, markdown fences, and string items
  const parsedStandard = parseExtractedPrescriptionJson(
    JSON.stringify([
      { name: 'Amoxil', dosage: '500 mg' },
      { medication: 'Doliprane', strength: '1000 mg' },
    ]),
  );
  assert.deepEqual(parsedStandard, [
    { name: 'Amoxil', dosage: '500 mg' },
    { name: 'Doliprane', dosage: '1000 mg' },
  ]);

  const parsedMarkdownFenced = parseExtractedPrescriptionJson(
    '```json\n[{"name": "Lantus SoloStar", "dosage": "100 units/mL"}]\n```',
  );
  assert.deepEqual(parsedMarkdownFenced, [
    { name: 'Lantus SoloStar', dosage: '100 units/mL' },
  ]);

  const parsedStrings = parseExtractedPrescriptionJson(['1. Amoxil 500 mg', 'Lipitor 20 mg']);
  assert.deepEqual(parsedStrings, [
    { name: 'Amoxil', dosage: '500 mg' },
    { name: 'Lipitor', dosage: '20 mg' },
  ]);

  // 3. Automatic searchMedications lookup for each extracted medication
  const db = await SqliteWasmAdapter.create({ filename: ':memory:' });
  try {
    await runMigrations(db);
    await seedDatabase(db);

    const extracted = [
      ...SAMPLE_HANDWRITTEN_PRESCRIPTION_ITEMS,
      { name: 'NonExistentMiraclePill', dosage: '999 mg' },
    ];

    const matched = await matchExtractedPrescriptionWithCatalog(db, extracted);
    assert.equal(matched.length, 4);

    // Amoxil 500 mg -> in stock (125 units), Zone A · Shelf A1 · Bin 01, unconfirmed by default
    assert.equal(matched[0].extractedName, 'Amoxil');
    assert.equal(matched[0].extractedDosage, '500 mg');
    assert.equal(matched[0].matchedMedication?.brand_name, 'Amoxil');
    assert.equal(matched[0].inStock, true);
    assert.equal(matched[0].totalStock, 125);
    assert.equal(matched[0].locationDisplay, 'Zone A · Shelf A1 · Bin 01');
    assert.equal(matched[0].isManuallyConfirmed, false);

    // Doliprane 1000 mg -> in stock (200 units), Zone A · Shelf A1 · Bin 02
    assert.equal(matched[1].extractedName, 'Doliprane');
    assert.equal(matched[1].matchedMedication?.brand_name, 'Doliprane');
    assert.equal(matched[1].inStock, true);
    assert.equal(matched[1].totalStock, 200);
    assert.equal(matched[1].locationDisplay, 'Zone A · Shelf A1 · Bin 02');
    assert.equal(matched[1].isManuallyConfirmed, false);

    // Ventolin HFA -> in stock (6 units), Zone B · Shelf B2 · Bin 04
    assert.equal(matched[2].extractedName, 'Ventolin HFA');
    assert.equal(matched[2].matchedMedication?.brand_name, 'Ventolin HFA');
    assert.equal(matched[2].inStock, true);
    assert.equal(matched[2].totalStock, 6);
    assert.equal(matched[2].locationDisplay, 'Zone B · Shelf B2 · Bin 04');
    assert.equal(matched[2].isManuallyConfirmed, false);

    // Unmatched medication -> not in stock, Not found in catalog
    assert.equal(matched[3].matchedMedication, null);
    assert.equal(matched[3].inStock, false);
    assert.equal(matched[3].totalStock, 0);
    assert.equal(matched[3].locationDisplay, 'Not found in catalog');
    assert.equal(matched[3].isManuallyConfirmed, false);

    // 4. Manual confirmation gate: blocked before manual confirmation
    const unconfirmedCartCheck = validateManualConfirmationBeforeAction(matched[0], 'cart');
    assert.equal(unconfirmedCartCheck.allowed, false);
    assert.match(unconfirmedCartCheck.error ?? '', /Manual confirmation required/i);

    const unconfirmedDispenseCheck = validateManualConfirmationBeforeAction(
      matched[0],
      'dispense',
    );
    assert.equal(unconfirmedDispenseCheck.allowed, false);

    // After manual confirmation, cart and dispense actions are allowed for matched[0]
    const updatedList = togglePrescriptionItemConfirmation(matched, matched[0].id, true);
    assert.equal(updatedList[0].isManuallyConfirmed, true);
    assert.equal(updatedList[1].isManuallyConfirmed, false);

    const confirmedCartCheck = validateManualConfirmationBeforeAction(updatedList[0], 'cart');
    assert.equal(confirmedCartCheck.allowed, true);
    assert.equal(confirmedCartCheck.error, null);

    const confirmedDispenseCheck = validateManualConfirmationBeforeAction(
      updatedList[0],
      'dispense',
    );
    assert.equal(confirmedDispenseCheck.allowed, true);
    assert.equal(confirmedDispenseCheck.error, null);
  } finally {
    await db.close();
  }
});
