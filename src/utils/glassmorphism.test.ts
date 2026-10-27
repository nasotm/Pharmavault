import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_BACKGROUND_IMAGE_URL,
  SEARCH_BACKGROUND_OVERLAY_CLASSES,
  SEARCH_HERO_CARD_CLASSES,
  SEARCH_RESULT_GLASS_CARD_CLASSES,
  SEARCH_SECONDARY_GLASS_CARD_CLASSES,
  resolveSearchBackgroundImageUrl,
} from './glassmorphism';

test('SEARCH_BACKGROUND_IMAGE_URL uses the high-quality Unsplash pharmacy placeholder URL', () => {
  assert.equal(
    SEARCH_BACKGROUND_IMAGE_URL,
    'https://images.unsplash.com/photo-1587854692152-cbe660dbde88',
  );
});

test('resolveSearchBackgroundImageUrl proxies external URLs while keeping original URL visible', () => {
  const resolved = resolveSearchBackgroundImageUrl(SEARCH_BACKGROUND_IMAGE_URL);
  assert.ok(resolved.startsWith('/api/proxy-image?url='));
  assert.ok(resolved.includes('https://images.unsplash.com/photo-1587854692152-cbe660dbde88'));
  assert.equal(resolveSearchBackgroundImageUrl('/local/bg.jpg'), '/local/bg.jpg');
  assert.equal(resolveSearchBackgroundImageUrl(''), '');
});

test('SEARCH_BACKGROUND_OVERLAY_CLASSES applies heavy white/dark overlay and backdrop-blur', () => {
  assert.ok(SEARCH_BACKGROUND_OVERLAY_CLASSES.includes('bg-white/80'));
  assert.ok(SEARCH_BACKGROUND_OVERLAY_CLASSES.includes('dark:bg-slate-950/85'));
  assert.ok(SEARCH_BACKGROUND_OVERLAY_CLASSES.includes('backdrop-blur-md'));
});

test('SEARCH_HERO_CARD_CLASSES styles main Search Card with bg-white/80, dark:bg-slate-800/80, backdrop-blur, and subtle border', () => {
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('bg-white/80'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('dark:bg-slate-800/80'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('backdrop-blur'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('border-slate-200/80'));
  assert.ok(SEARCH_HERO_CARD_CLASSES.includes('dark:border-slate-700/80'));
});

test('Supporting glass cards maintain calm blue, white, and slate grey palette', () => {
  assert.ok(SEARCH_SECONDARY_GLASS_CARD_CLASSES.includes('bg-white/80'));
  assert.ok(SEARCH_SECONDARY_GLASS_CARD_CLASSES.includes('dark:bg-slate-800/80'));
  assert.ok(SEARCH_RESULT_GLASS_CARD_CLASSES.includes('bg-white/85'));
  assert.ok(SEARCH_RESULT_GLASS_CARD_CLASSES.includes('dark:bg-slate-800/85'));
});
