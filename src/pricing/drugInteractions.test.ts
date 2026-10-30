import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCartDrugInteractions,
  DRUG_INTERACTION_DISCLAIMER,
  evaluateDeterministicDrugInteractions,
  formatInteractionBannerMessage,
  formatPotentialInteractionAlert,
  normalizeAiInteractionResponse,
} from './drugInteractions';

test('Drug Interactions: fewer than 2 medications returns no major interactions', () => {
  const emptyRes = evaluateDeterministicDrugInteractions([]);
  assert.equal(emptyRes.hasMajorInteraction, false);
  assert.equal(emptyRes.interactions.length, 0);

  const singleRes = evaluateDeterministicDrugInteractions([
    { genericName: 'Warfarin Sodium', brandName: 'Coumadin (Warfarin)', atcCode: 'B01AA03' },
  ]);
  assert.equal(singleRes.hasMajorInteraction, false);
  assert.equal(singleRes.interactions.length, 0);
  assert.match(singleRes.disclaimer, /warning/i);
  assert.match(singleRes.disclaimer, /not medical advice/i);
});

test('Drug Interactions: Warfarin + Aspirin triggers severe interaction banner and medical advice disclaimer', () => {
  const result = evaluateDeterministicDrugInteractions([
    { genericName: 'Warfarin Sodium', brandName: 'Coumadin (Warfarin)', atcCode: 'B01AA03' },
    { genericName: 'Acetylsalicylic Acid (Aspirin)', brandName: 'Aspirin Cardio', atcCode: 'B01AC06' },
  ]);

  assert.equal(result.hasMajorInteraction, true);
  assert.ok(result.interactions.length >= 1);

  const primary = result.interactions[0];
  assert.equal(
    primary.bannerMessage,
    'Warning: Potential interaction between Warfarin and Aspirin. Please verify.',
  );
  assert.equal(
    formatInteractionBannerMessage('Warfarin', 'Aspirin'),
    'Warning: Potential interaction between Warfarin and Aspirin. Please verify.',
  );
  assert.match(result.disclaimer, /warning/i);
  assert.match(result.disclaimer, /not medical advice/i);
});

test('Drug Interactions: MAOIs + SSRIs triggers severe serotonin syndrome warning', () => {
  const result = evaluateDeterministicDrugInteractions([
    { genericName: 'Phenelzine (MAOI)', brandName: 'Nardil (Phenelzine)', atcCode: 'N06AF03' },
    { genericName: 'Fluoxetine (SSRI)', brandName: 'Prozac (Fluoxetine)', atcCode: 'N06AB03' },
  ]);

  assert.equal(result.hasMajorInteraction, true);
  assert.equal(result.interactions.length, 1);
  assert.equal(
    result.interactions[0].bannerMessage,
    'Warning: Potential interaction between Phenelzine (MAOI) and Fluoxetine (SSRI). Please verify.',
  );
  assert.match(result.interactions[0].clinicalSummary, /serotonin syndrome/i);
  assert.equal(result.disclaimer, DRUG_INTERACTION_DISCLAIMER);
});

test('Drug Interactions: non-interacting pair returns hasMajorInteraction false', () => {
  const result = evaluateDeterministicDrugInteractions([
    { genericName: 'Amoxicillin', brandName: 'Amoxil', atcCode: 'J01CA04' },
    { genericName: 'Salbutamol', brandName: 'Ventolin', atcCode: 'R03AC02' },
  ]);

  assert.equal(result.hasMajorInteraction, false);
  assert.equal(result.interactions.length, 0);
});

test('Drug Interactions: normalizeAiInteractionResponse enforces exact banner message and non-medical-advice disclaimer', () => {
  const items = [
    { genericName: 'Warfarin Sodium', atcCode: 'B01AA03' },
    { genericName: 'Aspirin', atcCode: 'B01AC06' },
  ];

  const normalized = normalizeAiInteractionResponse(items, {
    hasMajorInteraction: true,
    interactions: [
      {
        drugA: 'Warfarin',
        drugB: 'Aspirin',
        severity: 'severe',
        clinicalSummary: 'Increased risk of major bleeding.',
      },
    ],
    disclaimer: 'Consult a doctor.',
  });

  assert.equal(normalized.hasMajorInteraction, true);
  assert.equal(
    normalized.interactions[0].bannerMessage,
    'Warning: Potential interaction between Warfarin and Aspirin. Please verify.',
  );
  assert.match(normalized.disclaimer, /not medical advice/i);
});

test('Drug Interactions: checkCartDrugInteractions uses background API fetch when 2+ items are present', async () => {
  let calledUrl = '';
  const mockFetch = (async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return new Response(
      JSON.stringify({
        hasMajorInteraction: true,
        interactions: [
          {
            drugA: 'Warfarin',
            drugB: 'Aspirin',
            severity: 'severe',
            clinicalSummary: 'Major bleeding risk.',
          },
        ],
        disclaimer: 'This is a warning and not medical advice.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const res = await checkCartDrugInteractions(
    [
      { genericName: 'Warfarin Sodium', atcCode: 'B01AA03' },
      { genericName: 'Acetylsalicylic Acid (Aspirin)', atcCode: 'B01AC06' },
    ],
    { fetchImpl: mockFetch },
  );

  assert.equal(calledUrl, '/api/ai/drug-interactions');
  assert.equal(res.hasMajorInteraction, true);
  assert.equal(
    res.interactions[0].bannerMessage,
    'Warning: Potential interaction between Warfarin and Aspirin. Please verify.',
  );
  assert.match(res.disclaimer, /not medical advice/i);
});

test('Drug Interactions: formatPotentialInteractionAlert produces exact required banner text', () => {
  const alert1 = formatPotentialInteractionAlert(
    'Warfarin combined with Aspirin significantly elevates bleeding risk.',
  );
  assert.equal(
    alert1,
    '⚠️ Warning: Potential interaction detected. Warfarin combined with Aspirin significantly elevates bleeding risk. Please verify with the doctor.',
  );

  const alert2 = formatPotentialInteractionAlert(
    'Warfarin combined with Aspirin significantly elevates bleeding risk',
  );
  assert.equal(
    alert2,
    '⚠️ Warning: Potential interaction detected. Warfarin combined with Aspirin significantly elevates bleeding risk. Please verify with the doctor.',
  );
});

test('Drug Interactions: AI prompt JSON format { has_interaction, warning_message } normalized cleanly', () => {
  const items = [
    { genericName: 'Warfarin', brandName: 'Coumadin' },
    { genericName: 'Aspirin', brandName: 'Aspirin Cardio' },
  ];

  const res = normalizeAiInteractionResponse(items, {
    has_interaction: true,
    warning_message: 'Concurrent use of Warfarin and Aspirin carries a severe hemorrhage risk.',
  });

  assert.equal(res.has_interaction, true);
  assert.equal(res.hasMajorInteraction, true);
  assert.equal(
    res.warning_message,
    'Concurrent use of Warfarin and Aspirin carries a severe hemorrhage risk.',
  );
  assert.equal(res.disclaimer, 'This is an AI-assisted warning, not medical advice.');
});

test('Drug Interactions: AI prompt JSON format with has_interaction false returns clean result', () => {
  const items = [
    { genericName: 'Amoxicillin', brandName: 'Amoxil' },
    { genericName: 'Salbutamol', brandName: 'Ventolin' },
  ];

  const res = normalizeAiInteractionResponse(items, {
    has_interaction: false,
    warning_message: '',
  });

  assert.equal(res.has_interaction, false);
  assert.equal(res.hasMajorInteraction, false);
  assert.equal(res.warning_message, '');
});
