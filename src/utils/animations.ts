/**
 * Shared Framer Motion animation presets for PharmaVault UI.
 * All interactive transitions are kept between 0.2s and 0.3s so daily dispensary
 * workflows remain fast and responsive.
 */

export const TAB_CONTENT_VARIANTS = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
} as const;

export const TAB_CONTENT_TRANSITION = {
  duration: 0.22,
  ease: 'easeOut' as const,
};

export const SLIDE_OVER_BACKDROP_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

export const SLIDE_OVER_BACKDROP_TRANSITION = {
  duration: 0.2,
  ease: 'easeOut' as const,
};

export const SLIDE_OVER_PANEL_VARIANTS = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
} as const;

export const SLIDE_OVER_PANEL_TRANSITION = {
  duration: 0.25,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export const INVENTORY_ROW_HOVER = {
  scale: 1.005,
  boxShadow: '0 4px 12px -2px rgba(15, 23, 42, 0.08)',
};

export const INVENTORY_ROW_TRANSITION = {
  duration: 0.2,
  ease: 'easeOut' as const,
};

export const LOW_STOCK_BADGE_PULSE_ANIMATE = {
  scale: [1, 1.05, 1],
  opacity: [1, 0.85, 1],
};

export const LOW_STOCK_BADGE_PULSE_TRANSITION = {
  duration: 1.6,
  repeat: Infinity,
  ease: 'easeInOut' as const,
};
