import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoSuggestInventoryMapping,
  buildDryRunPreview,
  parseIntegerDaPrice,
  parseIntegerQuantity,
  parsePharmacyInventoryCsv,
} from './pharmacyInventoryImportService';

test('parseIntegerDaPrice parses integer DA prices and rejects negative or non-numeric strings', () => {
  assert.deepEqual(parseIntegerDaPrice('1250', 'unit_price'), { value: 1250, error: null });
  assert.deepEqual(parseIntegerDaPrice('850 DA', 'unit_price'), { value: 850, error: null });
  assert.deepEqual(parseIntegerDaPrice('', 'unit_price'), { value: null, error: null });
  assert.equal(parseIntegerDaPrice('-10', 'unit_price').value, null);
  assert.ok(parseIntegerDaPrice('-10', 'unit_price').error);
});

test('parseIntegerQuantity parses whole numbers and rejects negative/float values', () => {
  assert.deepEqual(parseIntegerQuantity('40'), { value: 40, error: null });
  assert.deepEqual(parseIntegerQuantity(''), { value: 0, error: null });
  assert.ok(parseIntegerQuantity('-5').error);
  assert.ok(parseIntegerQuantity('3.5').error);
});

test('parsePharmacyInventoryCsv, autoSuggestInventoryMapping, and buildDryRunPreview limit to 5 rows', () => {
  const csv = `brand_name,barcode,unit_price,cost_price,quantity,expiry_date,lot_number,zone,shelf,bin
Item 1,1001,100,80,10,2027-01-01,L1,A,A1,01
Item 2,1002,200,150,20,2027-02-01,L2,A,A1,02
Item 3,1003,300,220,30,2027-03-01,L3,A,A1,03
Item 4,1004,400,310,40,2027-04-01,L4,B,B1,01
Item 5,1005,500,390,50,2027-05-01,L5,B,B1,02
Item 6,1006,600,470,60,2027-06-01,L6,C,C1,01`;

  const parsed = parsePharmacyInventoryCsv(csv);
  assert.equal(parsed.headers.length, 10);
  assert.equal(parsed.rows.length, 6);

  const mapping = autoSuggestInventoryMapping(parsed.headers);
  assert.equal(mapping.brand_name, 'brand_name');
  assert.equal(mapping.unit_price, 'unit_price');

  const preview = buildDryRunPreview(parsed.rows, mapping, 5);
  assert.equal(preview.length, 5);
  assert.equal(preview[0].brand_name, 'Item 1');
  assert.equal(preview[4].brand_name, 'Item 5');
});
