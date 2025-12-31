/**
 * Utility functions for Kalshi Edge Detector
 */

export { logger } from './logger.js';

/**
 * Normalize text for comparison
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Format number as currency
 */
export function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  } else if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * Get emoji for urgency level
 */
export function getUrgencyEmoji(urgency: 'critical' | 'standard' | 'fyi'): string {
  const emojis = {
    critical: '🔴',
    standard: '🟡',
    fyi: '🟢',
  };
  return emojis[urgency] ?? '⚪';
}

/**
 * Delay execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deduplicate array by key
 */
export function dedupeByKey<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
