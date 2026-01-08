/**
 * Whale Historical Performance Tracking
 *
 * Tracks historical win rates for known Polymarket whales
 * by market category. This allows us to weight whale signals
 * based on their category-specific expertise.
 *
 * Key insight: Some whales specialize in certain categories
 * (e.g., politics, crypto, sports) and have higher win rates there.
 */

import { logger } from '../utils/index.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// TYPES
// =============================================================================

export interface WhalePrediction {
  id: string;
  wallet: string;
  market: string;
  category: string;
  side: 'yes' | 'no';
  entryPrice: number;
  timestamp: string;
  resolved?: boolean;
  won?: boolean;
  exitPrice?: number;
  pnl?: number;
}

export interface WhalePerformance {
  wallet: string;
  totalPredictions: number;
  resolvedPredictions: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnL: number;
  categoryStats: Map<string, CategoryStat>;
  lastUpdated: string;
}

export interface CategoryStat {
  category: string;
  predictions: number;
  resolved: number;
  wins: number;
  winRate: number;
  avgPnL: number;
}

export interface WhaleEdgeBoost {
  wallet: string;
  category: string;
  boost: number;  // Multiplier for confidence (e.g., 1.2 = 20% boost)
  reasoning: string;
}

// =============================================================================
// DATA STORAGE
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const PREDICTIONS_FILE = join(DATA_DIR, 'whale_predictions.json');
const PERFORMANCE_FILE = join(DATA_DIR, 'whale_performance.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPredictions(): WhalePrediction[] {
  try {
    if (existsSync(PREDICTIONS_FILE)) {
      const data = readFileSync(PREDICTIONS_FILE, 'utf-8');
      return JSON.parse(data) as WhalePrediction[];
    }
  } catch (error) {
    logger.error(`Failed to load whale predictions: ${error}`);
  }
  return [];
}

function savePredictions(predictions: WhalePrediction[]) {
  ensureDataDir();
  writeFileSync(PREDICTIONS_FILE, JSON.stringify(predictions, null, 2));
}

function loadPerformance(): Map<string, WhalePerformance> {
  try {
    if (existsSync(PERFORMANCE_FILE)) {
      const data = readFileSync(PERFORMANCE_FILE, 'utf-8');
      const parsed = JSON.parse(data) as Array<{
        wallet: string;
        totalPredictions: number;
        resolvedPredictions: number;
        wins: number;
        losses: number;
        winRate: number;
        avgPnL: number;
        categoryStats: Array<[string, CategoryStat]>;
        lastUpdated: string;
      }>;
      const map = new Map<string, WhalePerformance>();
      for (const item of parsed) {
        const perf: WhalePerformance = {
          ...item,
          categoryStats: new Map(item.categoryStats),
        };
        map.set(perf.wallet, perf);
      }
      return map;
    }
  } catch (error) {
    logger.error(`Failed to load whale performance: ${error}`);
  }
  return new Map();
}

function savePerformance(performance: Map<string, WhalePerformance>) {
  ensureDataDir();
  const serializable = Array.from(performance.values()).map(p => ({
    ...p,
    categoryStats: Array.from(p.categoryStats.entries()),
  }));
  writeFileSync(PERFORMANCE_FILE, JSON.stringify(serializable, null, 2));
}

// =============================================================================
// PREDICTION TRACKING
// =============================================================================

/**
 * Record a new whale prediction
 */
export function recordWhalePrediction(
  wallet: string,
  market: string,
  category: string,
  side: 'yes' | 'no',
  entryPrice: number
): void {
  const predictions = loadPredictions();

  // Check for duplicate
  const exists = predictions.some(p =>
    p.wallet === wallet &&
    p.market === market &&
    !p.resolved
  );

  if (exists) return;

  const prediction: WhalePrediction = {
    id: `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    wallet,
    market,
    category: normalizeCategory(category),
    side,
    entryPrice,
    timestamp: new Date().toISOString(),
    resolved: false,
  };

  predictions.push(prediction);
  savePredictions(predictions);

  logger.debug(`Recorded whale prediction: ${wallet.slice(0, 8)}... on ${market}`);
}

/**
 * Resolve a prediction when market settles
 */
export function resolvePrediction(
  market: string,
  winningOutcome: 'yes' | 'no',
  settlementPrice: number = 1
): number {
  const predictions = loadPredictions();
  let resolved = 0;

  for (const pred of predictions) {
    if (pred.market === market && !pred.resolved) {
      pred.resolved = true;
      pred.won = pred.side === winningOutcome;
      pred.exitPrice = pred.won ? settlementPrice : 0;
      pred.pnl = pred.won
        ? (settlementPrice - pred.entryPrice)
        : -pred.entryPrice;
      resolved++;
    }
  }

  if (resolved > 0) {
    savePredictions(predictions);
    updatePerformanceStats();
    logger.info(`Resolved ${resolved} whale predictions for ${market}`);
  }

  return resolved;
}

// =============================================================================
// PERFORMANCE CALCULATION
// =============================================================================

/**
 * Update performance stats for all whales
 */
export function updatePerformanceStats(): void {
  const predictions = loadPredictions();
  const performance = new Map<string, WhalePerformance>();

  for (const pred of predictions) {
    let perf = performance.get(pred.wallet);

    if (!perf) {
      perf = {
        wallet: pred.wallet,
        totalPredictions: 0,
        resolvedPredictions: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnL: 0,
        categoryStats: new Map(),
        lastUpdated: new Date().toISOString(),
      };
      performance.set(pred.wallet, perf);
    }

    perf.totalPredictions++;

    if (pred.resolved) {
      perf.resolvedPredictions++;
      if (pred.won) {
        perf.wins++;
      } else {
        perf.losses++;
      }
    }

    // Update category stats
    let catStat = perf.categoryStats.get(pred.category);
    if (!catStat) {
      catStat = {
        category: pred.category,
        predictions: 0,
        resolved: 0,
        wins: 0,
        winRate: 0,
        avgPnL: 0,
      };
      perf.categoryStats.set(pred.category, catStat);
    }

    catStat.predictions++;
    if (pred.resolved) {
      catStat.resolved++;
      if (pred.won) catStat.wins++;
    }
  }

  // Calculate rates
  for (const perf of performance.values()) {
    if (perf.resolvedPredictions > 0) {
      perf.winRate = perf.wins / perf.resolvedPredictions;
    }

    // Calculate PnL
    const resolvedPreds = predictions.filter(p =>
      p.wallet === perf.wallet && p.resolved
    );
    if (resolvedPreds.length > 0) {
      perf.avgPnL = resolvedPreds.reduce((sum, p) => sum + (p.pnl ?? 0), 0) / resolvedPreds.length;
    }

    // Update category stats
    for (const catStat of perf.categoryStats.values()) {
      if (catStat.resolved > 0) {
        catStat.winRate = catStat.wins / catStat.resolved;

        const catPreds = predictions.filter(p =>
          p.wallet === perf.wallet &&
          p.category === catStat.category &&
          p.resolved
        );
        if (catPreds.length > 0) {
          catStat.avgPnL = catPreds.reduce((sum, p) => sum + (p.pnl ?? 0), 0) / catPreds.length;
        }
      }
    }
  }

  savePerformance(performance);
}

// =============================================================================
// EDGE BOOSTING
// =============================================================================

/**
 * Calculate confidence boost for a whale based on their category performance
 */
export function getWhaleEdgeBoost(
  wallet: string,
  category: string
): WhaleEdgeBoost {
  const performance = loadPerformance();
  const normalizedCategory = normalizeCategory(category);

  const perf = performance.get(wallet);

  // Default: no boost
  const defaultBoost: WhaleEdgeBoost = {
    wallet,
    category: normalizedCategory,
    boost: 1.0,
    reasoning: 'Insufficient historical data',
  };

  if (!perf) return defaultBoost;

  // Need at least 10 resolved predictions for statistical significance
  const catStat = perf.categoryStats.get(normalizedCategory);
  if (!catStat || catStat.resolved < 5) {
    // Fall back to overall stats
    if (perf.resolvedPredictions >= 10) {
      const boost = calculateBoost(perf.winRate, perf.resolvedPredictions);
      return {
        wallet,
        category: normalizedCategory,
        boost,
        reasoning: `Overall win rate: ${(perf.winRate * 100).toFixed(1)}% (${perf.resolvedPredictions} predictions)`,
      };
    }
    return defaultBoost;
  }

  // Calculate category-specific boost
  const boost = calculateBoost(catStat.winRate, catStat.resolved);
  const reasoning = catStat.winRate > 0.6
    ? `Strong ${normalizedCategory} track record: ${(catStat.winRate * 100).toFixed(1)}% win rate (${catStat.resolved} predictions)`
    : catStat.winRate < 0.4
    ? `Weak ${normalizedCategory} track record: ${(catStat.winRate * 100).toFixed(1)}% - consider fading`
    : `Average ${normalizedCategory} performance: ${(catStat.winRate * 100).toFixed(1)}%`;

  return { wallet, category: normalizedCategory, boost, reasoning };
}

/**
 * Calculate boost multiplier from win rate and sample size
 */
function calculateBoost(winRate: number, sampleSize: number): number {
  // Base boost from win rate
  // 50% = 1.0, 60% = 1.15, 70% = 1.3, etc.
  // 40% = 0.85, 30% = 0.7 (fade signal)
  const baseBoost = 1 + (winRate - 0.5) * 1.5;

  // Confidence adjustment based on sample size
  // More samples = trust the boost more (closer to calculated)
  // Fewer samples = regress toward 1.0
  const sampleConfidence = Math.min(sampleSize / 20, 1);  // Full confidence at 20+ samples

  // Regress boost toward 1.0 based on sample size
  const adjustedBoost = 1 + (baseBoost - 1) * sampleConfidence;

  // Clamp to reasonable range
  return Math.max(0.6, Math.min(1.5, adjustedBoost));
}

/**
 * Get leaderboard of top whales by category
 */
export function getWhaleLeaderboard(
  category?: string,
  minPredictions: number = 5
): Array<{ wallet: string; winRate: number; predictions: number; category: string }> {
  const performance = loadPerformance();
  const leaderboard: Array<{ wallet: string; winRate: number; predictions: number; category: string }> = [];

  for (const perf of performance.values()) {
    if (category) {
      const normalizedCategory = normalizeCategory(category);
      const catStat = perf.categoryStats.get(normalizedCategory);
      if (catStat && catStat.resolved >= minPredictions) {
        leaderboard.push({
          wallet: perf.wallet,
          winRate: catStat.winRate,
          predictions: catStat.resolved,
          category: normalizedCategory,
        });
      }
    } else if (perf.resolvedPredictions >= minPredictions) {
      leaderboard.push({
        wallet: perf.wallet,
        winRate: perf.winRate,
        predictions: perf.resolvedPredictions,
        category: 'overall',
      });
    }
  }

  // Sort by win rate descending
  leaderboard.sort((a, b) => b.winRate - a.winRate);

  return leaderboard;
}

// =============================================================================
// HELPERS
// =============================================================================

function normalizeCategory(category: string): string {
  const cat = category.toLowerCase();

  if (cat.includes('politic') || cat.includes('election') || cat.includes('trump') || cat.includes('biden')) {
    return 'politics';
  }
  if (cat.includes('crypto') || cat.includes('bitcoin') || cat.includes('ethereum')) {
    return 'crypto';
  }
  if (cat.includes('sport') || cat.includes('nfl') || cat.includes('nba') || cat.includes('mlb')) {
    return 'sports';
  }
  if (cat.includes('econ') || cat.includes('fed') || cat.includes('gdp') || cat.includes('inflation')) {
    return 'economics';
  }
  if (cat.includes('entertain') || cat.includes('movie') || cat.includes('oscar')) {
    return 'entertainment';
  }
  if (cat.includes('health') || cat.includes('covid') || cat.includes('flu')) {
    return 'health';
  }
  if (cat.includes('weather') || cat.includes('climate') || cat.includes('temperature')) {
    return 'weather';
  }
  if (cat.includes('tech') || cat.includes('ai') || cat.includes('openai')) {
    return 'tech';
  }

  return 'other';
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  loadPredictions,
  loadPerformance,
};
