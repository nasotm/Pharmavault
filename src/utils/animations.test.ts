import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVENTORY_ROW_HOVER,
  INVENTORY_ROW_TRANSITION,
  LOW_STOCK_BADGE_PULSE_ANIMATE,
  LOW_STOCK_BADGE_PULSE_TRANSITION,
  SLIDE_OVER_BACKDROP_TRANSITION,
  SLIDE_OVER_PANEL_TRANSITION,
  SLIDE_OVER_PANEL_VARIANTS,
  TAB_CONTENT_TRANSITION,
  TAB_CONTENT_VARIANTS,
} from './animations';

test('tab content variants provide fade-in and slide-up transition', () => {
  assert.equal(TAB_CONTENT_VARIANTS.initial.opacity, 0);
  assert.ok(TAB_CONTENT_VARIANTS.initial.y > 0);
  assert.equal(TAB_CONTENT_VARIANTS.animate.opacity, 1);
  assert.equal(TAB_CONTENT_VARIANTS.animate.y, 0);
});

test('slide-over panel variants animate from the right side of the screen', () => {
  assert.equal(SLIDE_OVER_PANEL_VARIANTS.initial.x, '100%');
  assert.equal(SLIDE_OVER_PANEL_VARIANTS.animate.x, 0);
  assert.equal(SLIDE_OVER_PANEL_VARIANTS.exit.x, '100%');
});

test('inventory row hover effect applies slight scale up and subtle shadow', () => {
  assert.ok(INVENTORY_ROW_HOVER.scale > 1 && INVENTORY_ROW_HOVER.scale <= 1.02);
  assert.ok(INVENTORY_ROW_HOVER.boxShadow.length > 0);
});

test('interactive UI transitions stay snappy between 0.2s and 0.3s', () => {
  for (const duration of [
    TAB_CONTENT_TRANSITION.duration,
    SLIDE_OVER_BACKDROP_TRANSITION.duration,
    SLIDE_OVER_PANEL_TRANSITION.duration,
    INVENTORY_ROW_TRANSITION.duration,
  ]) {
    assert.ok(
      duration >= 0.2 && duration <= 0.3,
      `Expected duration ${duration}s to be between 0.2s and 0.3s`,
    );
  }
});

test('low-stock badge pulse animation repeats continuously with subtle scale and opacity keyframes', () => {
  assert.deepEqual(LOW_STOCK_BADGE_PULSE_ANIMATE.scale, [1, 1.05, 1]);
  assert.deepEqual(LOW_STOCK_BADGE_PULSE_ANIMATE.opacity, [1, 0.85, 1]);
  assert.equal(LOW_STOCK_BADGE_PULSE_TRANSITION.repeat, Infinity);
});
