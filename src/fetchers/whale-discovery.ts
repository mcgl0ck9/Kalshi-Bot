/**
 * Whale Auto-Discovery System
 *
 * Automatically discovers profitable Polymarket wallets by:
 * 1. Querying the PnL subgraph for top performers
 * 2. Analyzing position sizes and realized PnL
 * 3. Tracking new whales that emerge
 *
 * EDGE: Most retail traders don't track individual wallet performance.
 * We can identify skilled traders and follow their positions.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/index.js';
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
  specialty: string[];           // Inferred from positions (politics, crypto, etc.)
  firstSeen: number;             // Timestamp
  lastActive: number;            // Timestamp
  confidence: number;            // How confident we are this is a skilled trader (0-1)
  isKnown: boolean;              // If this matches a known whale
  knownName?: string;            // Name if known
}

export interface WhaleDiscoveryResult {
  newWhales: DiscoveredWhale[];
  updatedWhales: DiscoveredWhale[];
  totalTracked: number;
  topPerformers: DiscoveredWhale[];
}

interface SubgraphPosition {
  id: string;
  user: string;
  amount: string;
  avgPrice: string;
  realizedPnl: string;
  tokenId: string;
  market?: {
    id: string;
    question: string;
    category?: string;
  };
}

// =============================================================================
// STORAGE
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const WHALE_CACHE_FILE = join(DATA_DIR, 'discovered-whales.json');

let whaleCache: Map<string, DiscoveredWhale> = new Map();
let lastDiscoveryTime = 0;
const DISCOVERY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Load whale cache from disk
 */
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

/**
 * Save whale cache to disk
 */
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

/**
 * Initialize whale cache
 */
export function initWhaleCache(): void {
  if (whaleCache.size === 0) {
    whaleCache = loadWhaleCache();
    logger.info(`Loaded ${whaleCache.size} discovered whales from cache`);
  }
}

// =============================================================================
// GRAPHQL QUERIES
// =============================================================================

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

const WALLET_POSITIONS_QUERY = `
  query WalletPositions($wallet: String!, $first: Int!) {
    userPositions(
      first: $first,
      where: { user: $wallet }
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
// DISCOVERY FUNCTIONS
// =============================================================================

/**
 * Query PnL subgraph for top traders
 */
async function queryTopTraders(
  minPnlUsdc: number = 10000,
  limit: number = 100
): Promise<SubgraphPosition[]> {
  try {
    const response = await fetch(POLYMARKET_SUBGRAPHS.pnl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: TOP_TRADERS_QUERY,
        variables: {
          minPnl: (minPnlUsdc * 1e6).toString(), // Convert to USDC decimals
          first: limit,
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

/**
 * Query all positions for a specific wallet
 */
async function queryWalletPositions(
  wallet: string,
  limit: number = 50
): Promise<SubgraphPosition[]> {
  try {
    const response = await fetch(POLYMARKET_SUBGRAPHS.pnl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: WALLET_POSITIONS_QUERY,
        variables: {
          wallet: wallet.toLowerCase(),
          first: limit,
        },
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as {
      data?: { userPositions?: SubgraphPosition[] };
    };
    return data.data?.userPositions ?? [];
  } catch {
    return [];
  }
}

/**
 * Analyze positions to determine trader specialty
 */
function inferSpecialty(positions: SubgraphPosition[]): string[] {
  // This is a placeholder - in production, we'd map tokenIds to market categories
  // For now, return generic specialties
  const specialties: string[] = [];

  if (positions.length > 10) {
    specialties.push('general');
  }

  // Could analyze position sizes to infer preferences
  const avgSize = positions.reduce((sum, p) => sum + parseFloat(p.amount), 0) / positions.length;
  if (avgSize > 50000 * 1e6) { // $50k+ avg position
    specialties.push('high-conviction');
  }

  return specialties.length > 0 ? specialties : ['unknown'];
}

/**
 * Calculate win rate from positions
 */
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

/**
 * Discover new profitable wallets
 */
export async function discoverProfitableWallets(
  minPnlUsdc: number = 50000, // $50k minimum profit
  limit: number = 50
): Promise<WhaleDiscoveryResult> {
  initWhaleCache();

  // Check cooldown
  const now = Date.now();
  if (now - lastDiscoveryTime < DISCOVERY_COOLDOWN_MS) {
    // Return cached data
    const allWhales = Array.from(whaleCache.values());
    return {
      newWhales: [],
      updatedWhales: [],
      totalTracked: allWhales.length,
      topPerformers: allWhales
        .sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl)
        .slice(0, 10),
    };
  }

  lastDiscoveryTime = now;
  logger.info(`Discovering profitable wallets (min $${minPnlUsdc.toLocaleString()} PnL)...`);

  const newWhales: DiscoveredWhale[] = [];
  const updatedWhales: DiscoveredWhale[] = [];

  // Query top traders from subgraph
  const topPositions = await queryTopTraders(minPnlUsdc, limit);

  // Aggregate by wallet
  const walletStats = new Map<string, {
    totalPnl: number;
    totalValue: number;
    positions: SubgraphPosition[];
  }>();

  for (const pos of topPositions) {
    const wallet = pos.user.toLowerCase();
    const existing = walletStats.get(wallet) ?? { totalPnl: 0, totalValue: 0, positions: [] };

    existing.totalPnl += parseFloat(pos.realizedPnl) / 1e6; // Convert from USDC decimals
    existing.totalValue += parseFloat(pos.amount) / 1e6;
    existing.positions.push(pos);

    walletStats.set(wallet, existing);
  }

  // Process each wallet
  for (const [wallet, stats] of walletStats) {
    const existing = whaleCache.get(wallet);
    const winRate = calculateWinRate(stats.positions);
    const specialty = inferSpecialty(stats.positions);

    // Calculate confidence based on:
    // - PnL amount (higher = more confident)
    // - Number of positions (more = more confident)
    // - Win rate (higher = more confident)
    const pnlScore = Math.min(1, stats.totalPnl / 500000); // Max at $500k
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
      isKnown: false, // Will be updated if matches known whale
    };

    if (existing) {
      updatedWhales.push(whale);
    } else {
      newWhales.push(whale);
    }

    whaleCache.set(wallet, whale);
  }

  // Save updated cache
  saveWhaleCache();

  // Get top performers
  const allWhales = Array.from(whaleCache.values());
  const topPerformers = allWhales
    .sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl)
    .slice(0, 10);

  logger.success(`Discovered ${newWhales.length} new whales, updated ${updatedWhales.length}`);

  if (newWhales.length > 0) {
    logger.info(`Top new whale: ${newWhales[0].wallet.slice(0, 10)}... ($${(newWhales[0].totalRealizedPnl / 1000).toFixed(0)}k PnL)`);
  }

  return {
    newWhales,
    updatedWhales,
    totalTracked: whaleCache.size,
    topPerformers,
  };
}

/**
 * Get tracked whales above a profit threshold
 */
export function getTrackedWhales(minPnlUsdc: number = 10000): DiscoveredWhale[] {
  initWhaleCache();

  return Array.from(whaleCache.values())
    .filter(w => w.totalRealizedPnl >= minPnlUsdc)
    .sort((a, b) => b.totalRealizedPnl - a.totalRealizedPnl);
}

/**
 * Get wallet addresses for on-chain tracking
 */
export function getWhaleWallets(minPnlUsdc: number = 50000, limit: number = 20): string[] {
  return getTrackedWhales(minPnlUsdc)
    .slice(0, limit)
    .map(w => w.wallet);
}

/**
 * Check if a wallet is a known whale
 */
export function isKnownWhale(wallet: string): boolean {
  initWhaleCache();
  const whale = whaleCache.get(wallet.toLowerCase());
  return whale !== undefined && whale.confidence >= 0.7;
}

/**
 * Get whale statistics
 */
export function getWhaleDiscoveryStats(): {
  totalTracked: number;
  highConfidenceCount: number;
  totalPnlTracked: number;
  avgWinRate: number;
} {
  initWhaleCache();

  const whales = Array.from(whaleCache.values());
  const highConfidence = whales.filter(w => w.confidence >= 0.7);
  const totalPnl = whales.reduce((sum, w) => sum + w.totalRealizedPnl, 0);
  const avgWinRate = whales.length > 0
    ? whales.reduce((sum, w) => sum + w.winRate, 0) / whales.length
    : 0;

  return {
    totalTracked: whales.length,
    highConfidenceCount: highConfidence.length,
    totalPnlTracked: totalPnl,
    avgWinRate,
  };
}

/**
 * Format whale discovery report for Discord
 */
export function formatWhaleDiscoveryReport(result: WhaleDiscoveryResult): string {
  const lines: string[] = [
    '**Whale Discovery Report**',
    '',
    `Tracking: ${result.totalTracked} wallets`,
    `New: ${result.newWhales.length} | Updated: ${result.updatedWhales.length}`,
    '',
  ];

  if (result.topPerformers.length > 0) {
    lines.push('**Top Performers:**');
    for (const whale of result.topPerformers.slice(0, 5)) {
      const pnlStr = whale.totalRealizedPnl >= 1000000
        ? `$${(whale.totalRealizedPnl / 1000000).toFixed(1)}M`
        : `$${(whale.totalRealizedPnl / 1000).toFixed(0)}k`;
      lines.push(`• ${whale.wallet.slice(0, 8)}... | ${pnlStr} PnL | ${(whale.winRate * 100).toFixed(0)}% win`);
    }
  }

  return lines.join('\n');
}
