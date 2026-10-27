export type ExpiryStatus = 'expired' | 'expiring_soon' | 'check_expiry' | 'good' | 'no_expiry';

export interface ExpiryVisualBadge {
  status: ExpiryStatus;
  label: string;
  daysRemaining: number | null;
  className: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

/**
 * Calculates days remaining from referenceDate (default: today) to expiryDate.
 * Negative days means expired.
 */
export function calculateDaysRemaining(
  expiryDateStr: string | null | undefined,
  referenceDate: Date = new Date(),
): number | null {
  if (!expiryDateStr || !expiryDateStr.trim()) return null;
  const trimmed = expiryDateStr.trim();
  const parts = trimmed.split('-');
  let expDate: Date;
  if (parts.length >= 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    expDate = new Date(year, month, day);
  } else {
    expDate = new Date(trimmed);
  }
  if (isNaN(expDate.getTime())) return null;

  const refMid = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const expMid = new Date(
    expDate.getFullYear(),
    expDate.getMonth(),
    expDate.getDate(),
  );
  return Math.round((expMid.getTime() - refMid.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns the visual badge for a given expiry date string or pre-calculated days remaining.
 * - Expired (negative days): Red badge "Expired"
 * - < 30 days: Orange badge "Expiring soon"
 * - < 90 days: Yellow badge "Check expiry"
 * - >= 90 days: Green badge "Good"
 */
export function getExpiryVisualBadge(
  expiryDateStrOrDays: string | number | null | undefined,
  referenceDate: Date = new Date(),
): ExpiryVisualBadge {
  let days: number | null;
  if (typeof expiryDateStrOrDays === 'number') {
    days = expiryDateStrOrDays;
  } else {
    days = calculateDaysRemaining(expiryDateStrOrDays, referenceDate);
  }

  if (days === null) {
    return {
      status: 'no_expiry',
      label: 'No expiry',
      daysRemaining: null,
      className:
        'px-2 py-0.5 text-[10px] font-sans font-semibold rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
      badgeBg: 'bg-slate-100 dark:bg-slate-800',
      badgeText: 'text-slate-600 dark:text-slate-300',
      badgeBorder: 'border-slate-200 dark:border-slate-700',
    };
  }

  if (days < 0) {
    return {
      status: 'expired',
      label: 'Expired',
      daysRemaining: days,
      className:
        'px-2 py-0.5 text-[10px] font-sans font-semibold rounded-md bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60',
      badgeBg: 'bg-red-100 dark:bg-red-950/80',
      badgeText: 'text-red-800 dark:text-red-300',
      badgeBorder: 'border-red-200 dark:border-red-800/60',
    };
  }

  if (days < 30) {
    return {
      status: 'expiring_soon',
      label: 'Expiring soon',
      daysRemaining: days,
      className:
        'px-2 py-0.5 text-[10px] font-sans font-semibold rounded-md bg-orange-100 dark:bg-orange-950/80 text-orange-800 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60',
      badgeBg: 'bg-orange-100 dark:bg-orange-950/80',
      badgeText: 'text-orange-800 dark:text-orange-300',
      badgeBorder: 'border-orange-200 dark:border-orange-800/60',
    };
  }

  if (days < 90) {
    return {
      status: 'check_expiry',
      label: 'Check expiry',
      daysRemaining: days,
      className:
        'px-2 py-0.5 text-[10px] font-sans font-semibold rounded-md bg-yellow-100 dark:bg-yellow-950/80 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800/60',
      badgeBg: 'bg-yellow-100 dark:bg-yellow-950/80',
      badgeText: 'text-yellow-800 dark:text-yellow-300',
      badgeBorder: 'border-yellow-200 dark:border-yellow-800/60',
    };
  }

  return {
    status: 'good',
    label: 'Good',
    daysRemaining: days,
    className:
      'px-2 py-0.5 text-[10px] font-sans font-semibold rounded-md bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60',
    badgeBg: 'bg-emerald-100 dark:bg-emerald-950/80',
    badgeText: 'text-emerald-800 dark:text-emerald-300',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800/60',
  };
}

/**
 * Checks whether any active batch of a medication has an expiry date that is < 30 days away or expired.
 */
export function hasExpiringOrExpiredBatch(
  batches: Array<{ quantity: number; expiry_date: string | null | undefined }>,
  referenceDate: Date = new Date(),
): boolean {
  for (const b of batches) {
    if (b.quantity <= 0 || !b.expiry_date) continue;
    const days = calculateDaysRemaining(b.expiry_date, referenceDate);
    if (days !== null && days < 30) {
      return true;
    }
  }
  return false;
}
