/**
 * Processors Index for Kalshi Edge Detector v4.0
 *
 * Processors transform and enrich data between sources and detectors.
 * Use cases: NLP, sentiment analysis, feature extraction, data normalization.
 */

import { registerProcessor } from '../core/index.js';
import { logger } from '../utils/index.js';

// Import all processors
import sentimentProcessor from './sentiment.js';

/**
 * Register all processors.
 * Call this once at startup, after sources are registered.
 */
export function registerAllProcessors(): void {
  logger.info('Registering processors...');

  registerProcessor(sentimentProcessor);

  logger.info('Processors registered');
}

// Re-export processors
export { sentimentProcessor };
