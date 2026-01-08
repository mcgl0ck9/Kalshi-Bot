/**
 * Models Module - Exports for Time-Decay and Limit Order Models
 *
 * Provides options-like pricing models for prediction markets:
 * - Time decay (theta) calculations
 * - Limit order suggestions with fill probability
 * - Edge adjustment for time remaining
 */

// Time Decay Model
export {
  calculateTheta,
  calculateThetaPerDay,
  calculateTimeDecay,
  adjustEdgeForTheta,
  parseExpiryTime,
  getUrgencyLevel,
  getRecommendedOrderType,
  getLimitOrderAdjustmentFactor,
  formatThetaDisplay,
  enhanceWithTimeDecay,
  formatTimeDecayInfo,
  type TimeDecayModel,
  type ThetaAdjustedEdge,
  type ExpiryInfo,
} from './time-decay.js';

// Limit Order Model
export {
  estimateFillProbability,
  estimateFillTime,
  calculateOptimalLimitPrice,
  generateLadderPrices,
  suggestLimitOrder,
  formatLimitOrderDisplay,
  type OrderSuggestion,
  type LadderSuggestion,
  type LimitOrderSuggestion,
} from './limit-order.js';
