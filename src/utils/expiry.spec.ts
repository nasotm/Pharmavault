import { describe, expect, it } from 'vitest';
import {
  calculateDaysRemaining,
  getExpiryVisualBadge,
  hasExpiringOrExpiredBatch,
} from './expiry';

describe('Expiry Warning Utilities', () => {
  const refDate = new Date(2026, 9, 25); // 2026-10-25

  it('calculates days remaining accurately', () => {
    // Same day
    expect(calculateDaysRemaining('2026-10-25', refDate)).toBe(0);
    // Tomorrow
    expect(calculateDaysRemaining('2026-10-26', refDate)).toBe(1);
    // Yesterday (expired)
    expect(calculateDaysRemaining('2026-10-24', refDate)).toBe(-1);
    // 30 days ahead: Oct 25 + 30 days = Nov 24
    expect(calculateDaysRemaining('2026-11-24', refDate)).toBe(30);
    // Null or invalid
    expect(calculateDaysRemaining(null, refDate)).toBeNull();
    expect(calculateDaysRemaining('', refDate)).toBeNull();
  });

  it('assigns correct badges per user requirements', () => {
    // Expired (negative days): Red badge "Expired"
    const expiredBadge = getExpiryVisualBadge('2026-10-20', refDate);
    expect(expiredBadge.status).toBe('expired');
    expect(expiredBadge.label).toBe('Expired');
    expect(expiredBadge.className).toContain('bg-red-100');

    // < 30 days: Orange badge "Expiring soon"
    const soonBadge = getExpiryVisualBadge('2026-11-10', refDate); // 16 days
    expect(soonBadge.status).toBe('expiring_soon');
    expect(soonBadge.label).toBe('Expiring soon');
    expect(soonBadge.className).toContain('bg-orange-100');

    // < 90 days: Yellow badge "Check expiry"
    const checkBadge = getExpiryVisualBadge('2026-12-19', refDate); // 55 days
    expect(checkBadge.status).toBe('check_expiry');
    expect(checkBadge.label).toBe('Check expiry');
    expect(checkBadge.className).toContain('bg-yellow-100');

    // > 90 days: Green badge "Good"
    const goodBadge = getExpiryVisualBadge('2027-06-30', refDate);
    expect(goodBadge.status).toBe('good');
    expect(goodBadge.label).toBe('Good');
    expect(goodBadge.className).toContain('bg-emerald-100');
  });

  it('hasExpiringOrExpiredBatch accurately detects batches under 30 days or expired', () => {
    // Has a batch expiring in 15 days
    expect(
      hasExpiringOrExpiredBatch(
        [
          { quantity: 10, expiry_date: '2026-11-09' },
          { quantity: 50, expiry_date: '2027-08-30' },
        ],
        refDate,
      ),
    ).toBe(true);

    // Has only distant batches (> 90 days)
    expect(
      hasExpiringOrExpiredBatch(
        [{ quantity: 10, expiry_date: '2027-08-30' }],
        refDate,
      ),
    ).toBe(false);

    // Empty batch quantity is ignored
    expect(
      hasExpiringOrExpiredBatch(
        [{ quantity: 0, expiry_date: '2026-10-20' }],
        refDate,
      ),
    ).toBe(false);
  });
});
