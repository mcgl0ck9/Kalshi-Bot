/**
 * Data Sources Index for Kalshi Edge Detector v4.0
 *
 * Auto-registers all data sources.
 * To add a new source, just create a new file in this directory.
 */

import { registerSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// Import all sources
import kalshiSource from './kalshi.js';
import polymarketSource from './polymarket.js';
import cdcMeaslesSource from './cdc-measles.js';
import espnSportsSource from './espn-sports.js';
import newsSource from './news.js';
import fedNowcastsSource from './fed-nowcasts.js';
import cryptoFundingSource from './crypto-funding.js';
import optionsImpliedSource from './options-implied.js';
import pollingSource from './polling.js';
import googleTrendsSource from './google-trends.js';
import weatherSource from './weather.js';
import entertainmentSource from './entertainment.js';
import injuriesSource from './injuries.js';
// Mentions Edge Detection sources
import kalshiMentionsSource from './kalshi-mentions.js';
import earningsTranscriptsSource from './earnings-transcripts.js';
import executiveMediaSource from './executive-media.js';
import corporateEventsSource from './corporate-events.js';
// P3 sources (health surveillance, whale tracking)
import cdcSurveillanceSource from './cdc-surveillance.js';
import whaleDiscoverySource from './whale-discovery.js';

/**
 * Register all data sources.
 * Call this once at startup.
 */
export function registerAllSources(): void {
  logger.info('Registering data sources...');

  // Register each source
  registerSource(kalshiSource);
  registerSource(polymarketSource);
  registerSource(cdcMeaslesSource);
  registerSource(espnSportsSource);
  registerSource(newsSource);
  registerSource(fedNowcastsSource);
  registerSource(cryptoFundingSource);
  registerSource(optionsImpliedSource);
  registerSource(pollingSource);
  registerSource(googleTrendsSource);
  registerSource(weatherSource);
  registerSource(entertainmentSource);
  registerSource(injuriesSource);
  // Mentions Edge Detection sources
  registerSource(kalshiMentionsSource);
  registerSource(earningsTranscriptsSource);
  registerSource(executiveMediaSource);
  registerSource(corporateEventsSource);
  // P3 sources (health surveillance, whale tracking)
  registerSource(cdcSurveillanceSource);
  registerSource(whaleDiscoverySource);

  logger.info('Data sources registered');
}

// Re-export sources for direct access if needed
export {
  kalshiSource,
  polymarketSource,
  cdcMeaslesSource,
  espnSportsSource,
  newsSource,
  fedNowcastsSource,
  cryptoFundingSource,
  optionsImpliedSource,
  pollingSource,
  googleTrendsSource,
  weatherSource,
  entertainmentSource,
  injuriesSource,
  // Mentions Edge Detection sources
  kalshiMentionsSource,
  earningsTranscriptsSource,
  executiveMediaSource,
  corporateEventsSource,
  // P3 sources (health surveillance, whale tracking)
  cdcSurveillanceSource,
  whaleDiscoverySource,
};
