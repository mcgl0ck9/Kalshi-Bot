/**
 * Edge Detectors Index for Kalshi Edge Detector v4.0
 *
 * Auto-registers all edge detectors.
 * To add a new detector, just create a new file in this directory.
 */

import { registerDetector } from '../core/index.js';
import { logger } from '../utils/index.js';

// Import all detectors
import crossPlatformDetector from './cross-platform.js';
import healthDetector from './health.js';
import sportsDetector from './sports.js';
import sentimentDetector from './sentiment.js';
import whaleDetector from './whale.js';

/**
 * Register all edge detectors.
 * Call this once at startup, after sources are registered.
 */
export function registerAllDetectors(): void {
  logger.info('Registering edge detectors...');

  // Register each detector
  registerDetector(crossPlatformDetector);
  registerDetector(healthDetector);
  registerDetector(sportsDetector);
  registerDetector(sentimentDetector);
  registerDetector(whaleDetector);

  logger.info('Edge detectors registered');
}

// Example detector structure (for documentation)
/*
import { defineDetector, createEdge, type Edge, type Market, type SourceData } from '../core/index.js';

export default defineDetector({
  name: 'example',
  description: 'Example edge detector',
  sources: ['kalshi', 'some-other-source'],
  minEdge: 0.05,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];
    const kalshi = data.kalshi as Market[];
    const otherData = data['some-other-source'] as SomeType;

    for (const market of kalshi) {
      // Your edge detection logic here
      const edge = calculateEdge(market, otherData);

      if (edge > 0.05) {
        edges.push(createEdge(
          market,
          'YES',
          edge,
          0.75,  // confidence
          'Reason why this edge exists',
          { type: 'example', customData: 123 }
        ));
      }
    }

    return edges;
  },
});
*/
