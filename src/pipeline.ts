/**
 * Pipeline v2 - Legacy Compatibility Stub
 *
 * This file provides backward compatibility for the legacy v2 entry point.
 * The actual implementation has been moved to v4.0 in src/core/pipeline.ts
 *
 * For new code, use the v4.0 imports:
 *   import { runPipeline } from './core/index.js';
 */

import { logger } from './utils/index.js';
import { runPipeline as runV4Pipeline, type PipelineResult } from './core/index.js';
import { registerAllSources } from './sources/index.js';
import { registerAllDetectors } from './detectors/index.js';
import { registerAllProcessors } from './processors/index.js';

let initialized = false;

function ensureInitialized(): void {
  if (!initialized) {
    registerAllSources();
    registerAllProcessors();
    registerAllDetectors();
    initialized = true;
  }
}

/**
 * Run the edge detection pipeline
 * @deprecated Use v4.0: import { runPipeline } from './core/index.js'
 */
export async function runPipeline(): Promise<PipelineResult> {
  ensureInitialized();
  return runV4Pipeline();
}

/**
 * Get divergences report
 * @deprecated Use v4.0 pipeline results directly
 */
export function getDivergencesReport(): string {
  return 'Use v4.0 pipeline for edge detection. See npm run v4:scan';
}

/**
 * Get status report
 * @deprecated Use v4.0 pipeline results directly
 */
export function getStatusReport(): string {
  ensureInitialized();
  return 'Kalshi Edge Detector v4.0 ready. Use npm run v4:scan';
}
