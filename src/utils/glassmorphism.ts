/**
 * Glassmorphism design tokens and helpers for the primary Search experience.
 * Ensures a calm, clinical palette of soft blues, whites, and slate greys
 * across both light and dark modes.
 */

export const SEARCH_BACKGROUND_IMAGE_URL =
  'https://images.unsplash.com/photo-1587854692152-cbe660dbde88';

export const SEARCH_BACKGROUND_OVERLAY_CLASSES =
  'flex-1 w-full bg-white/80 dark:bg-slate-950/85 bg-gradient-to-br from-sky-50/80 via-white/85 to-slate-100/85 dark:from-slate-950/90 dark:via-slate-900/85 dark:to-sky-950/80 backdrop-blur-md backdrop-saturate-50 flex flex-col transition-colors duration-200';

export const SEARCH_HERO_CARD_CLASSES =
  'max-w-3xl mx-auto p-6 sm:p-8 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/80 rounded-3xl shadow-xl shadow-sky-950/5 dark:shadow-slate-950/40 text-center space-y-6 transition-all';

export const SEARCH_SECONDARY_GLASS_CARD_CLASSES =
  'max-w-3xl mx-auto p-8 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-3xl text-center space-y-2 shadow-lg shadow-sky-950/5 dark:shadow-slate-950/30 transition-all';

export const SEARCH_RESULT_GLASS_CARD_CLASSES =
  'w-full text-left p-6 bg-white/85 dark:bg-slate-800/85 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-md shadow-sky-950/5 dark:shadow-slate-950/30 hover:bg-white/95 dark:hover:bg-slate-800/95 hover:border-sky-400 dark:hover:border-sky-500/70 transition-all group';

/**
 * Resolves the background image URL through the local COEP-compliant image proxy
 * while preserving the raw Unsplash URL in the query string so cross-origin
 * isolation (required by SQLite Wasm / OPFS) never blocks the background image.
 */
export function resolveSearchBackgroundImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  return `/api/proxy-image?url=${trimmed}`;
}
