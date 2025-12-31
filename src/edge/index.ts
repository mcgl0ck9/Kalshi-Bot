/**
 * Edge Detection Module
 *
 * Aggregates all edge detection strategies:
 * - Macro edge (Fed, CPI, Jobs, GDP)
 * - Fed regime bias adjustment (validated signal)
 * - Fed speech keyword analyzer (NEW - historical transcript analysis)
 * - Injury overreaction detection (validated signal)
 * - Weather forecast overreaction (validated signal)
 * - Recency bias / base rate neglect (validated signal)
 * - Cross-platform whale conviction (uses Polymarket on-chain data)
 * - Entertainment edge (Rotten Tomatoes, box office)
 * - Polling edge (538, RCP, Silver Bulletin)
 * - Enhanced sports edge (injuries + weather + sharp/square)
 * - New market scanner
 * - Calibration tracking
 *
 * VALIDATED SIGNALS (passed adversarial testing):
 * 1. Fed Regime Bias - Adjusts FedWatch for rising/falling rate environment biases
 * 2. Injury Overreaction - Detects when public overreacts to injury news
 * 3. Weather Overreaction - Applies climatological base rates + forecast skill limits
 * 4. Recency Bias - Fades markets that moved more than optimal Bayesian update
 * 5. Cross-Platform Conviction - Polymarket whale positions vs Kalshi prices
 * 6. Entertainment Edge - RT scores vs market thresholds (strong edge!)
 * 7. Polling Edge - Aggregator consensus vs market prices
 * 8. Enhanced Sports Edge - Composite signal (sharp books + injuries + weather)
 * 9. Fed Speech Keywords - Historical transcript word frequency vs market prices (NEW)
 *
 * SKIPPED SIGNALS (failed adversarial testing):
 * - Simple FedWatch arbitrage (too noisy, other traders see it too)
 * - Sports arbitrage (arb bots faster, fees eat profits)
 * - Steam move chasing (need millisecond execution)
 */

export * from './macro-edge.js';
export * from './new-market-scanner.js';
export * from './calibration-tracker.js';
export * from './fed-regime-bias.js';
export * from './fed-speech-edge.js';
export * from './injury-overreaction.js';
export * from './weather-overreaction.js';
export * from './recency-bias.js';
export * from './cross-platform-conviction.js';
export * from './entertainment-edge.js';
export * from './polling-edge.js';
export * from './enhanced-sports-edge.js';
