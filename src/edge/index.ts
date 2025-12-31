/**
 * Edge Detection Module
 *
 * Aggregates all edge detection strategies:
 * - Macro edge (Fed, CPI, Jobs, GDP)
 * - Fed regime bias adjustment (validated signal)
 * - Injury overreaction detection (validated signal)
 * - Weather forecast overreaction (validated signal)
 * - Recency bias / base rate neglect (validated signal)
 * - New market scanner
 * - Calibration tracking
 *
 * VALIDATED SIGNALS (passed adversarial testing):
 * 1. Fed Regime Bias - Adjusts FedWatch for rising/falling rate environment biases
 * 2. Injury Overreaction - Detects when public overreacts to injury news
 * 3. Weather Overreaction - Applies climatological base rates + forecast skill limits
 * 4. Recency Bias - Fades markets that moved more than optimal Bayesian update
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
export * from './injury-overreaction.js';
export * from './weather-overreaction.js';
export * from './recency-bias.js';
