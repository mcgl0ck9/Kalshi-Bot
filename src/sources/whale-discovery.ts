/**
 * Whale Auto-Discovery Source (v4)
 *
 * Automatically discovers profitable Polymarket wallets by:
 * 1. Querying the PnL subgraph for top performers
 * 2. Analyzing position sizes and realized PnL
 * 3. Tracking new whales that emerge
 *
 * EDGE: Most retail traders don't track individual wallet performance.
 * We can identify skilled traders and follow their positions.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { POLYMARKET_SUBGRAPHS } from '../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface DiscoveredWhale {
  wallet: string;
  totalRealizedPnl: number;
  totalPositionValue: number;
  winRate: number;
  positionCount: number;
  avgPositionSize: number;
  specialty: string[];
  firstSeen: number;
  lastActive: number;
  confidence: number;  // How confident we are this is a skilled trader (0-1)
  isKnown: boolean;
  knownName?: string;
}

export interface WhaleDiscoveryData {
  whales: DiscoveredWhale[];
  topPerformers: DiscoveredWhale[];
  newWhalesCount: number;
  totalTracked: number;
  highConfidenceCount: number;
  totalPnlTracked: number;
  avgWinRate: number;
  fetchedAt: string;
}

interface SubgraphPosition {
  id: string;
  user: string;
  amount: string;
  avgPrice: string;
  realizedPnl: string;
  tokenId: string;
}

// =============================================================================
// STORAGE
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const WHALE_CACHE_FILE = join(DATA_DIR, 'discovered-whales.json');

let whaleCache: Map<string, DiscoveredWhale> = new Map();
let cacheLoaded = false;

function loadWhaleCache(): Map<string, DiscoveredWhale> {
  try {
    if (existsSync(WHALE_CACHE_FILE)) {
      const data = JSON.parse(readFileSync(WHALE_CACHE_FILE, 'utf-8'));
      const map = new Map<string, DiscoveredWhale>();
      for (const [wallet, whale] of Object.entries(data)) {
        map.set(wallet, whale as DiscoveredWhale);
      }
      return map;
    }
  } catch (error) {
    logger.warn(`Failed to load whale cache: ${error}`);
  }
  return new Map();
}

function saveWhaleCache(): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, DiscoveredWhale> = {};
    for (const [wallet, whale] of whaleCache) {
      data[wallet] = whale;
    }
    writeFileSync(WHALE_CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.warn(`Failed to save whale cache: ${error}`);
  }
}

function initCache(): void {
  if (!cacheLoaded) {
    whaleCache = loadWhaleCache();
    cacheLoaded = true;
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_PNL_USDC = 50000;  // $50k minimum profit
const DISCOVERY_LIMIT = 100;

// GraphQL query for top traders
const TOP_TRADERS_QUERY = `
  query TopTraders($minPnl: BigInt!, $first: Int!) {
    userPositions(
      first: $first,
      orderBy: realizedPnl,
      orderDirection: desc,
      where: { realizedPnl_gt: $minPnl }
    ) {
      id
      user
      amount
      avgPrice
      realizedPnl
      tokenId
    }
  }
`;

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<WhaleDiscoveryData>({
  name: 'whale-discovery',
  category: 'other',
  cacheTTL: 1800,  // 30 minutes - whale discovery is expensive

  async fetch(): Promise<WhaleDiscoveryData> {
    initCache();
    const now = Date.now();

    // Query top traders from subgraph
    const topPositions = await queryTopTraders();
    let newWhalesCount = 0;

    // Aggregate by wallet
    const walletStats = new Map<string, {
      totalPnl: number;
      totalValue: number;
      positions: SubgraphPosition[];
    }>();

    for (const pos of topPositions) {
      const wallet = pos.user.toLowerCase();
      const existing = walletStats.get(wallet) ?? { totalPnl: 0, totalValue: 0, positions: [] };

      existing.totalPnl += parseFloat(pos.realizedPnl) / 1e6;
      existing.totalValue += parseFloat(pos.amount) / 1e6;
      existing.positions.push(pos);

      walletStats.set(wallet, existing);
    }

    // Process each wallet
    for (const [wallet, stats] of walletStats) {
      const existing = whaleCache.get(wallet);
      const winRate = calculateWinRate(stats.positions);
      const specialty = inferSpecialty(stats.positions);

      const pnlScore = Math.min(1, stats.totalPnl / 500000);
      const posScore = Math.min(1, stats.positions.length / 20);
      const wrScore = winRate;
      const confidence = (pnlScore * 0.4) + (posScore * 0.3) + (wrScore * 0.3);

      const whale: DiscoveredWhale = {
        wallet,
        totalRealizedPnl: stats.totalPnl,
        totalPositionValue: stats.totalValue,
        winRate,
        positionCount: stats.positions.length,
        avgPositionSize: stats.totalValue / stats.positions.length,
        specialty,
        firstSeen: existing?.firstSeen ?? now,
        lastActive: now,
        confidence,
        isKnown: false,
      };

      if (!existing) {
        newWhalesCount++;
      }

      whaleCache.set(wallet, whale);
    }

    // Save updated cache
    saveWhaleCache();

    // Get all whales and calculate stats
    const allWhales = Array.from(whaleCache.values());
    const highConfidence = allWhales.filter(w => w.confidence >= 0.7);
    const totalPnl = allWhales.reduce((sum, w) => sum + w.totalRealizedPnl, 0);
    const avgWinRate = allWhales.length > 0
      ? allWhales.reduce((sum, w) => sum + w.winRate, 0) / allWhales.length
      : 0;

    const topPerformers = allWhales
      .sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl)
      .slice(0, 10);

    logger.info(`Tracking ${allWhales.length} whales (${newWhalesCount} new, ${highConfidence.length} high confidence)`);

    return {
      whales: allWhales,
      topPerformers,
      newWhalesCount,
      totalTracked: allWhales.length,
      highConfidenceCount: highConfidence.length,
      totalPnlTracked: totalPnl,
      avgWinRate,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// SUBGRAPH QUERY
// =============================================================================

async function queryTopTraders(): Promise<SubgraphPosition[]> {
  try {
    const response = await fetch(POLYMARKET_SUBGRAPHS.pnl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: TOP_TRADERS_QUERY,
        variables: {
          minPnl: (MIN_PNL_USDC * 1e6).toString(),
          first: DISCOVERY_LIMIT,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Subgraph error: ${response.status}`);
    }

    const data = await response.json() as {
      errors?: unknown[];
      data?: { userPositions?: SubgraphPosition[] };
    };

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data?.userPositions ?? [];
  } catch (error) {
    logger.warn(`Failed to query top traders: ${error}`);
    return [];
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function calculateWinRate(positions: SubgraphPosition[]): number {
  let wins = 0;
  let total = 0;

  for (const pos of positions) {
    const pnl = parseFloat(pos.realizedPnl);
    if (pnl !== 0) {
      total++;
      if (pnl > 0) wins++;
    }
  }

  return total > 0 ? wins / total : 0.5;
}

function inferSpecialty(positions: SubgraphPosition[]): string[] {
  const specialties: string[] = [];

  if (positions.length > 10) {
    specialties.push('general');
  }

  const avgSize = positions.reduce((sum, p) => sum + parseFloat(p.amount), 0) / positions.length;
  if (avgSize > 50000 * 1e6) {
    specialties.push('high-conviction');
  }

  return specialties.length > 0 ? specialties : ['unknown'];
}

// =============================================================================
// ANALYSIS HELPERS
// =============================================================================

/**
 * Get whale wallets for position tracking.
 */
export function getWhaleWallets(
  data: WhaleDiscoveryData,
  minPnlUsdc: number = 50000,
  limit: number = 20
): string[] {
  return data.whales
    .filter(w => w.totalRealizedPnl >= minPnlUsdc)
    .sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl)
    .slice(0, limit)
    .map(w => w.wallet);
}

/**
 * Check if a wallet is a known whale.
 */
export function isKnownWhale(
  data: WhaleDiscoveryData,
  wallet: string
): boolean {
  const whale = data.whales.find(w => w.wallet.toLowerCase() === wallet.toLowerCase());
  return whale !== undefined && whale.confidence >= 0.7;
}

/**
 * Get high confidence whales.
 */
export function getHighConfidenceWhales(data: WhaleDiscoveryData): DiscoveredWhale[] {
  return data.whales.filter(w => w.confidence >= 0.7);
}

/**
 * Format whale discovery report for Discord.
 */
export function formatWhaleReport(data: WhaleDiscoveryData): string {
  const lines: string[] = [
    '**Whale Discovery Report**',
    '',
    `Tracking: ${data.totalTracked} wallets`,
    `High Confidence: ${data.highConfidenceCount}`,
    `Avg Win Rate: ${(data.avgWinRate * 100).toFixed(0)}%`,
    '',
  ];

  if (data.topPerformers.length > 0) {
    lines.push('**Top Performers:**');
    for (const whale of data.topPerformers.slice(0, 5)) {
      const pnlStr = whale.totalRealizedPnl >= 1000000
        ? `$${(whale.totalRealizedPnl / 1000000).toFixed(1)}M`
        : `$${(whale.totalRealizedPnl / 1000).toFixed(0)}k`;
      lines.push(`• ${whale.wallet.slice(0, 8)}... | ${pnlStr} | ${(whale.winRate * 100).toFixed(0)}% win`);
    }
  }

  return lines.join('\n');
}
