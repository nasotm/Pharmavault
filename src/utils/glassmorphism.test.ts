import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_BACKGROUND_OVERLAY_CLASSES,
  SEARCH_HERO_CARD_CLASSES,
  SEARCH_RESULT_GLASS_CARD_CLASSES,
  SEARCH_SECONDARY_GLASS_CARD_CLASSES,
} from './glassmorphism';

test('SEARCH_BACKGROUND_OVERLAY_CLASSES applies clean CSS gradient background and transition', () => {
  assert.ok(SEARCH_BACKGROUND_OVERLAY_CLASSES.includes('bg-gradient-to-br'));
  assert.ok(SEARCH_BACKGROUND_OVERLAY_CLASSES.includes('from-sky-50'));
  assert.ok(SEARCH_BACKGROUND_OVERLAY_CLASSES.includes('to-slate-100'));
});

test('SEARCH_HERO_CARD_CLASSES styles main Search Card with translucent background and backdrop-blur', () => {
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('bg-white/90'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('dark:bg-slate-900/90'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('backdrop-blur-xl'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('border-slate-200/80'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('dark:border-slate-700/80'));
});

test('Supporting glass cards maintain calm blue, white, and slate grey palette', () => {
  assert.ok(SEARCH_SECONDARY_GLASS_CARD_CLASSES.includes('bg-white/80'));
  assert.ok(SEARCH_SECONDARY_GLASS_CARD_CLASSES.includes('dark:bg-slate-800/80'));
  assert.ok(SEARCH_RESULT_GLASS_CARD_CLASSES.includes('bg-white/85'));
  assert.ok(SEARCH_RESULT_GLASS_CARD_CLASSES.includes('dark:bg-slate-800/85'));
});
