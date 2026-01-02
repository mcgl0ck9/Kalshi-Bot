/**
 * Cross-Platform Analysis Module
 *
 * Compares prices between Kalshi and Polymarket to find:
 * - Price divergences (potential edges)
 * - Platform sentiment differences
 * - Which platform moves first
 *
 * IMPROVED MATCHING (v2):
 * - Expanded entity aliases (crypto, movies, companies, geopolitics)
 * - Fuzzy number matching ($200K = 200,000 = 200000)
 * - Semantic topic extraction
 * - Category-aware boosting
 *
 * IMPROVED MATCHING (v3):
 * - Unified team database from src/data/teams.ts
 * - Standard abbreviations (NYG, LAL, etc.)
 * - College sports with 2024-25 conference realignment
 */

import type { Market, CrossPlatformMatch } from '../types/index.js';
import { logger } from '../utils/index.js';
import {
  NFL_TEAMS,
  NBA_TEAMS,
  MLB_TEAMS,
  NHL_TEAMS,
  NCAAF_TEAMS,
  NCAAB_TEAMS,
  NFL_TEAM_KEYS,
  NBA_TEAM_KEYS,
  MLB_TEAM_KEYS,
  NHL_TEAM_KEYS,
  NCAAF_TEAM_KEYS,
  NCAAB_TEAM_KEYS,
  ALL_SPORTS_TEAM_KEYS,
  type LeagueTeams,
} from '../data/teams.js';

// =============================================================================
// HELPER: Build entity aliases from teams module
// =============================================================================

function buildTeamEntityAliases(teams: LeagueTeams): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const [teamKey, info] of Object.entries(teams)) {
    // Combine aliases and abbreviations (lowercase)
    aliases[teamKey] = [
      ...info.aliases,
      ...info.abbreviations.map(a => a.toLowerCase()),
    ];
  }
  return aliases;
}

// =============================================================================
// ENTITY EXTRACTION (EXPANDED)
// =============================================================================

const ENTITY_ALIASES: Record<string, string[]> = {
  // Crypto - expanded with price targets
  bitcoin: ['bitcoin', 'btc', 'bitcoin price', 'btc price'],
  ethereum: ['ethereum', 'eth', 'ether'],
  crypto: ['crypto', 'cryptocurrency', 'digital asset'],
  solana: ['solana', 'sol'],
  xrp: ['xrp', 'ripple'],
  dogecoin: ['dogecoin', 'doge'],
  cardano: ['cardano', 'ada'],

  // People - US Politics (Current)
  trump: ['trump', 'donald trump', 'donald j trump', 'djt', 'trump administration'],
  biden: ['biden', 'joe biden', 'president biden'],
  harris: ['kamala harris', 'harris', 'vice president harris'],
  desantis: ['desantis', 'ron desantis', 'florida governor'],
  newsom: ['newsom', 'gavin newsom', 'california governor'],
  vance: ['jd vance', 'vance', 'vice president vance'],
  rfk: ['rfk', 'robert kennedy', 'kennedy jr', 'rfk jr'],
  pelosi: ['pelosi', 'nancy pelosi'],
  mcconnell: ['mcconnell', 'mitch mcconnell'],
  schumer: ['schumer', 'chuck schumer'],
  johnson_speaker: ['mike johnson', 'speaker johnson'],

  // People - Business/Tech Leaders
  musk: ['musk', 'elon musk', 'elon'],
  bezos: ['bezos', 'jeff bezos'],
  zuckerberg: ['zuckerberg', 'mark zuckerberg'],
  altman: ['sam altman', 'altman', 'openai ceo'],
  cook: ['tim cook', 'apple ceo'],
  nadella: ['satya nadella', 'nadella', 'microsoft ceo'],
  pichai: ['sundar pichai', 'pichai', 'google ceo'],
  dimon: ['jamie dimon', 'dimon', 'jpmorgan'],
  buffett: ['warren buffett', 'buffett', 'berkshire'],

  // People - Central Bankers
  powell: ['powell', 'jerome powell', 'fed chair', 'fed chairman'],
  yellen: ['yellen', 'janet yellen', 'treasury secretary'],
  lagarde: ['lagarde', 'christine lagarde', 'ecb president'],

  // People - World Leaders
  putin: ['putin', 'vladimir putin', 'russia president'],
  zelensky: ['zelensky', 'zelenskyy', 'ukraine president'],
  netanyahu: ['netanyahu', 'bibi', 'israel pm', 'israel prime minister'],
  xi: ['xi jinping', 'xi', 'china president', 'chinese president'],
  modi: ['modi', 'narendra modi', 'india pm'],
  macron: ['macron', 'emmanuel macron', 'france president'],
  starmer: ['starmer', 'keir starmer', 'uk pm', 'uk prime minister'],
  trudeau: ['trudeau', 'justin trudeau', 'canada pm'],
  maduro: ['maduro', 'venezuela president', 'nicolas maduro'],
  kim: ['kim jong un', 'kim jong-un', 'north korea'],
  erdogan: ['erdogan', 'turkey president'],
  milei: ['milei', 'javier milei', 'argentina president'],

  // Organizations - Government
  fed: ['fed', 'federal reserve', 'fomc', 'fed rate'],
  sec: ['sec', 'securities and exchange', 'gensler'],
  doj: ['doj', 'department of justice', 'justice department'],
  fbi: ['fbi', 'federal bureau'],
  cia: ['cia', 'central intelligence'],
  scotus: ['supreme court', 'scotus', 'justices'],
  congress: ['congress', 'senate', 'house of representatives', 'capitol'],

  // Organizations - International
  nato: ['nato', 'north atlantic'],
  opec: ['opec', 'oil cartel', 'opec+'],
  un: ['united nations', 'un security council'],
  imf: ['imf', 'international monetary fund'],
  who: ['who', 'world health organization'],
  ecb: ['ecb', 'european central bank'],
  eu: ['european union', 'eu', 'brussels'],

  // Companies - Tech Giants
  apple: ['apple', 'aapl', 'iphone', 'tim cook', 'apple stock'],
  microsoft: ['microsoft', 'msft', 'satya nadella', 'azure'],
  nvidia: ['nvidia', 'nvda', 'jensen huang', 'nvidia stock'],
  amazon: ['amazon', 'amzn', 'aws', 'amazon stock'],
  google: ['google', 'alphabet', 'googl', 'goog', 'youtube'],
  meta: ['meta', 'facebook', 'instagram', 'whatsapp'],
  tesla: ['tesla', 'tsla', 'tesla stock', 'cybertruck'],
  openai: ['openai', 'chatgpt', 'sam altman', 'gpt-4', 'gpt-5'],
  anthropic: ['anthropic', 'claude', 'dario amodei'],

  // Companies - Other Major
  aramco: ['aramco', 'saudi aramco', 'saudi oil'],
  berkshire: ['berkshire', 'berkshire hathaway', 'brk'],
  jpmorgan: ['jpmorgan', 'jp morgan', 'jpm', 'chase'],
  visa: ['visa', 'visa stock'],
  walmart: ['walmart', 'wmt'],
  disney: ['disney', 'dis', 'disney+', 'bob iger'],
  netflix: ['netflix', 'nflx'],
  boeing: ['boeing', 'ba', 'boeing stock'],
  spacex: ['spacex', 'starship', 'falcon'],
  tiktok: ['tiktok', 'bytedance', 'tiktok ban'],

  // Topics - Economic
  election: ['election', 'presidential', 'vote', 'voting', 'ballot', 'electoral'],
  rate: ['rate', 'interest rate', 'rate cut', 'rate hike', 'basis point', 'bps'],
  recession: ['recession', 'economic downturn', 'depression', 'gdp decline', 'soft landing', 'hard landing'],
  inflation: ['inflation', 'cpi', 'consumer price', 'pce', 'core inflation'],
  jobs: ['jobs', 'employment', 'unemployment', 'nonfarm', 'payroll', 'jobless', 'labor market'],
  gdp: ['gdp', 'gross domestic', 'economic growth'],
  tariff: ['tariff', 'trade war', 'import tax', 'duties'],
  debt_ceiling: ['debt ceiling', 'debt limit', 'government shutdown'],
  default: ['default', 'us default', 'treasury default'],

  // Topics - Geopolitical
  ukraine: ['ukraine', 'kyiv', 'kiev', 'ukrainian'],
  russia: ['russia', 'russian', 'moscow', 'kremlin'],
  china: ['china', 'chinese', 'beijing', 'xi jinping', 'ccp'],
  taiwan: ['taiwan', 'taiwanese', 'taipei', 'china taiwan'],
  israel: ['israel', 'israeli', 'gaza', 'hamas', 'idf'],
  iran: ['iran', 'iranian', 'tehran', 'ayatollah'],
  ceasefire: ['ceasefire', 'peace deal', 'armistice', 'truce'],
  war: ['war', 'conflict', 'invasion', 'military'],
  sanctions: ['sanctions', 'sanctioned', 'embargo'],

  // Topics - Cannabis/Drugs
  cannabis: ['cannabis', 'marijuana', 'weed', 'pot', 'schedule', 'reschedule', 'descheduled'],

  // Entertainment - Awards
  oscar: ['oscar', 'academy award', 'best picture', 'academy awards'],
  grammy: ['grammy', 'grammys', 'album of the year', 'record of the year'],
  emmy: ['emmy', 'emmys', 'emmy awards', 'primetime emmy'],
  golden_globe: ['golden globe', 'golden globes'],
  tony: ['tony award', 'tony awards', 'broadway'],

  // Entertainment - Movies/Box Office
  movie: ['movie', 'film', 'box office', 'grossing', 'theatrical', 'opening weekend'],
  marvel: ['marvel', 'mcu', 'avengers', 'marvel studios'],
  dc: ['dc', 'dceu', 'dc studios', 'james gunn dc'],
  pixar: ['pixar', 'pixar movie'],

  // Entertainment - Streaming
  streaming: ['streaming', 'subscriber', 'subscribers'],

  // Entertainment - Music
  taylor_swift: ['taylor swift', 'eras tour', 'swifties'],
  beyonce: ['beyonce', 'beyoncé'],
  drake: ['drake', 'drizzy'],

  // Sports - General
  superbowl: ['super bowl', 'superbowl', 'nfl championship', 'super bowl lvix', 'super bowl 59'],
  worldseries: ['world series', 'mlb championship', 'fall classic'],
  nba: ['nba', 'basketball', 'nba finals', 'nba playoffs'],
  nfl: ['nfl', 'football', 'nfl playoffs'],
  mlb: ['mlb', 'baseball', 'pennant', 'mlb playoffs'],
  nhl: ['nhl', 'hockey', 'stanley cup', 'nhl playoffs'],
  cfp: ['cfp', 'college football playoff', 'national championship', 'cfb playoff'],
  march_madness: ['march madness', 'ncaa tournament', 'final four', 'sweet sixteen', 'elite eight'],

  // Sports - Events
  masters: ['masters', 'augusta', 'masters tournament'],
  kentucky_derby: ['kentucky derby', 'derby', 'triple crown'],
  wimbledon: ['wimbledon', 'all england'],
  us_open: ['us open', 'us open tennis', 'us open golf'],
  world_cup: ['world cup', 'fifa world cup'],
  olympics: ['olympics', 'olympic games', 'summer olympics', 'winter olympics'],

  // Sports - Players (Stars)
  lebron: ['lebron', 'lebron james', 'king james'],
  mahomes: ['mahomes', 'patrick mahomes'],
  ohtani: ['ohtani', 'shohei ohtani'],
  messi: ['messi', 'lionel messi'],
  ronaldo: ['ronaldo', 'cristiano ronaldo'],

  // Weather
  hurricane: ['hurricane', 'tropical storm', 'cyclone', 'category'],
  tornado: ['tornado', 'twister', 'severe weather'],
  earthquake: ['earthquake', 'seismic', 'quake'],

  // AI/Tech Topics
  ai: ['artificial intelligence', 'ai', 'machine learning', 'agi'],
  chatbot: ['chatbot', 'llm', 'language model'],
  autonomous: ['autonomous', 'self-driving', 'autopilot'],
  quantum: ['quantum', 'quantum computing', 'qubit'],

  // ==========================================================================
  // SPORTS TEAMS - Imported from unified teams.ts module
  // Includes all standard abbreviations (NYG, LAL, etc.)
  // ==========================================================================

  // NFL Teams (32) - with abbreviations
  ...buildTeamEntityAliases(NFL_TEAMS),

  // NBA Teams (30) - with abbreviations
  ...buildTeamEntityAliases(NBA_TEAMS),

  // MLB Teams (30) - with abbreviations
  ...buildTeamEntityAliases(MLB_TEAMS),

  // NHL Teams (32) - with abbreviations
  ...buildTeamEntityAliases(NHL_TEAMS),

  // NCAAF - College Football (Major Programs) - with 2024-25 realignment
  ...buildTeamEntityAliases(NCAAF_TEAMS),

  // NCAAB - College Basketball (Major Programs)
  ...buildTeamEntityAliases(NCAAB_TEAMS),

  // Market Cap / Company Rankings
  marketcap: ['market cap', 'largest company', 'most valuable', 'market capitalization', 'trillion'],
};

// Movie title mappings for cross-platform matching
const MOVIE_ALIASES: Record<string, string[]> = {
  thunderbolts: ['thunderbolts', 'marvel thunderbolts'],
  superman: ['superman', 'james gunn superman', 'superman legacy'],
  jurassic: ['jurassic', 'jurassic world', 'rebirth'],
  'captain america': ['captain america', 'brave new world'],
  'fantastic four': ['fantastic four', 'first steps'],
  wicked: ['wicked', 'wicked for good', 'wicked 2'],
  'how to train your dragon': ['how to train your dragon', 'httyd'],
  'lilo and stitch': ['lilo', 'stitch', 'lilo & stitch'],
  zootopia: ['zootopia', 'zootopia 2'],
};

/**
 * Normalize numbers to a standard format for matching
 * $200K, 200,000, 200000, 200k all become "200000"
 */
function normalizeNumber(str: string): string {
  // Handle K/M/B suffixes
  const match = str.match(/\$?([\d,]+\.?\d*)\s*(k|m|b|thousand|million|billion)?/i);
  if (!match) return str;

  let num = parseFloat(match[1].replace(/,/g, ''));
  const suffix = (match[2] || '').toLowerCase();

  if (suffix === 'k' || suffix === 'thousand') num *= 1000;
  if (suffix === 'm' || suffix === 'million') num *= 1000000;
  if (suffix === 'b' || suffix === 'billion') num *= 1000000000;

  return Math.round(num).toString();
}

/**
 * Extract price targets from titles (e.g., "$200,000", "200K")
 */
function extractPriceTarget(title: string): string | null {
  const patterns = [
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?/i,
    /reach\s+\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|b)?/i,
    /([\d,]+(?:\.\d+)?)\s*(k|m|b)\b/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return normalizeNumber(match[0]);
    }
  }
  return null;
}

/**
 * Extract year from title
 */
function extractYear(title: string): string | null {
  const match = title.match(/\b(202[4-9]|203\d)\b/);
  return match ? match[1] : null;
}

/**
 * Extract key entities from a title (IMPROVED)
 */
function extractKeyEntities(title: string): Set<string> {
  const entities = new Set<string>();
  const titleLower = title.toLowerCase();

  // Check entity aliases
  for (const [mainEntity, aliases] of Object.entries(ENTITY_ALIASES)) {
    if (aliases.some(alias => titleLower.includes(alias))) {
      entities.add(mainEntity);
    }
  }

  // Check movie aliases
  for (const [movie, aliases] of Object.entries(MOVIE_ALIASES)) {
    if (aliases.some(alias => titleLower.includes(alias))) {
      entities.add(`movie:${movie}`);
    }
  }

  // Extract and normalize price targets
  const priceTarget = extractPriceTarget(title);
  if (priceTarget) {
    entities.add(`price:${priceTarget}`);
  }

  // Extract year
  const year = extractYear(title);
  if (year) {
    entities.add(`year:${year}`);
  }

  return entities;
}

// =============================================================================
// SPORTS TEAM SETS - Now imported from unified teams.ts module
// =============================================================================

// Combined set for quick lookup (uses imported sets from teams.ts)
const ALL_SPORTS_TEAMS = ALL_SPORTS_TEAM_KEYS;

/**
 * Detect sports matchups between two sets of entities
 * Returns high boost if both have the same two teams (matchup)
 */
function getSportsTeamsFromEntities(
  entities1: Set<string>,
  entities2: Set<string>
): { match: boolean; boost: number; teams?: string[] } {
  // Get sports teams from each entity set
  const teams1 = [...entities1].filter(e => ALL_SPORTS_TEAMS.has(e));
  const teams2 = [...entities2].filter(e => ALL_SPORTS_TEAMS.has(e));

  // Need at least one team in each
  if (teams1.length === 0 || teams2.length === 0) {
    return { match: false, boost: 0 };
  }

  // Find common teams
  const commonTeams = teams1.filter(t => teams2.includes(t));

  // Two teams match = definite matchup (e.g., "Chiefs vs Eagles" on both platforms)
  if (commonTeams.length >= 2) {
    return { match: true, boost: 0.5, teams: commonTeams };
  }

  // One team match + same league context = likely same market
  if (commonTeams.length === 1) {
    // Check if both have NFL/NBA/MLB general tag
    const hasLeagueContext1 = entities1.has('nfl') || entities1.has('nba') || entities1.has('mlb') || entities1.has('superbowl') || entities1.has('worldseries');
    const hasLeagueContext2 = entities2.has('nfl') || entities2.has('nba') || entities2.has('mlb') || entities2.has('superbowl') || entities2.has('worldseries');

    if (hasLeagueContext1 && hasLeagueContext2) {
      return { match: true, boost: 0.35, teams: commonTeams };
    }

    // Single team match without extra context - still a moderate boost
    return { match: true, boost: 0.25, teams: commonTeams };
  }

  return { match: false, boost: 0 };
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
  if (!title) return '';

  // Lowercase and remove punctuation
  let normalized = title.toLowerCase().replace(/[^\w\s]/g, ' ');

  // Remove common stop words
  const stopWords = new Set([
    'will', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'by',
    'before', 'after', 'be', 'is', 'are', 'was', 'were', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'and', 'or', 'but', 'if',
    'than', 'that', 'this', 'what', 'which', 'who', 'when', 'where', 'how',
    'its', 'it', 'their', 'they', 'them', 'there',
  ]);
  const words = normalized.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

  return words.join(' ');
}

/**
 * Calculate similarity between two titles using multiple signals (IMPROVED)
 */
export function calculateTitleSimilarity(title1: string, title2: string): number {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  if (!norm1 || !norm2) return 0;

  // 1. Word-level Jaccard similarity
  const words1 = new Set(norm1.split(/\s+/));
  const words2 = new Set(norm2.split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;

  // 2. Entity overlap (most important)
  const entities1 = extractKeyEntities(title1);
  const entities2 = extractKeyEntities(title2);

  let entityScore = 0;
  if (entities1.size > 0 && entities2.size > 0) {
    const entityIntersection = [...entities1].filter(e => entities2.has(e));

    // Count critical matches (year + subject + price target)
    const criticalMatches = entityIntersection.filter(e =>
      e.startsWith('year:') || e.startsWith('price:') || e.startsWith('movie:')
    );

    // Base overlap score
    entityScore = entityIntersection.length / Math.max(entities1.size, entities2.size);

    // Boost for critical matches
    if (criticalMatches.length >= 2) {
      entityScore = Math.min(1, entityScore + 0.3);
    }
  }

  // 3. Check for specific high-confidence patterns
  let patternBoost = 0;

  // Bitcoin price target matching
  if (entities1.has('bitcoin') && entities2.has('bitcoin')) {
    const price1 = extractPriceTarget(title1);
    const price2 = extractPriceTarget(title2);
    if (price1 && price2 && price1 === price2) {
      patternBoost = 0.4; // Strong match for same BTC price target
    }
  }

  // Movie box office matching
  const movie1 = [...entities1].find(e => e.startsWith('movie:'));
  const movie2 = [...entities2].find(e => e.startsWith('movie:'));
  if (movie1 && movie2 && movie1 === movie2) {
    patternBoost = Math.max(patternBoost, 0.3);
  }

  // Sports matchup matching (Team A vs Team B)
  // Two teams matching is a very strong signal - likely the same game/matchup
  const sportsTeams = getSportsTeamsFromEntities(entities1, entities2);
  if (sportsTeams.match && sportsTeams.teams && sportsTeams.teams.length >= 2) {
    // Two or more teams match = definite same matchup, return high score directly
    return 0.85;
  }
  if (sportsTeams.match) {
    patternBoost = Math.max(patternBoost, sportsTeams.boost);
  }

  // Same year + same subject
  const year1 = [...entities1].find(e => e.startsWith('year:'));
  const year2 = [...entities2].find(e => e.startsWith('year:'));
  if (year1 && year2 && year1 === year2) {
    // Check for common subject
    const subjects1 = [...entities1].filter(e => !e.includes(':'));
    const subjects2 = [...entities2].filter(e => !e.includes(':'));
    const commonSubjects = subjects1.filter(s => subjects2.includes(s));
    if (commonSubjects.length >= 1) {
      patternBoost = Math.max(patternBoost, 0.2);
    }
  }

  // Market cap / largest company matching
  if (entities1.has('marketcap') && entities2.has('marketcap')) {
    // Check if same company
    const companies = ['apple', 'microsoft', 'nvidia', 'amazon', 'google', 'meta', 'tesla', 'aramco'];
    const company1 = companies.find(c => entities1.has(c));
    const company2 = companies.find(c => entities2.has(c));
    if (company1 && company2 && company1 === company2) {
      patternBoost = Math.max(patternBoost, 0.4); // Strong match for same company market cap
    }
  }

  // Require at least one meaningful common entity for a strong match
  // Jaccard similarity alone is not enough (too many false positives)
  const entityIntersection = [...entities1].filter(e => entities2.has(e));
  const hasCommonEntity = entityIntersection.length > 0;

  // If no common entities, cap the score (Jaccard alone is unreliable)
  if (!hasCommonEntity) {
    // Only allow matches if Jaccard is very high AND word overlap is substantial
    const minJaccardForNoEntity = 0.4;
    if (jaccardSimilarity < minJaccardForNoEntity) {
      return 0; // No entities and low word overlap = no match
    }
    return jaccardSimilarity * 0.3; // Cap at 30% max for Jaccard-only matches
  }

  // High-confidence match: 3+ common entities is a strong signal
  const subjectEntities = entityIntersection.filter(e => !e.includes(':'));
  const yearMatch = entityIntersection.some(e => e.startsWith('year:'));
  if (subjectEntities.length >= 2 && yearMatch) {
    // Multiple subjects + same year = very likely same market
    return Math.min(1, Math.max(0.75, entityScore + patternBoost));
  }
  if (entityIntersection.length >= 3) {
    // 3+ common entities = strong match
    return Math.min(1, Math.max(0.70, entityScore + patternBoost));
  }

  // Weighted combination (entity overlap is most important)
  // patternBoost is for high-confidence patterns like "Chiefs vs Eagles"
  const rawScore = jaccardSimilarity * 0.2 + entityScore * 0.5 + patternBoost * 0.3;

  return Math.min(1, rawScore);
}

// =============================================================================
// CROSS-PLATFORM MATCHING
// =============================================================================

/**
 * Check if a market title looks like a parlay/combo (multiple outcomes)
 */
function isParlayMarket(title: string): boolean {
  if (!title) return true;

  // Parlay patterns: "yes Team1,yes Team2,yes Team3" or multiple outcomes
  const yesNoCount = (title.match(/\b(yes|no)\s/gi) || []).length;
  if (yesNoCount > 1) return true;

  // Multiple comma-separated items that look like outcomes
  const commaItems = title.split(',').length;
  if (commaItems > 2) return true;

  // Contains player stats patterns like "Player: 10+"
  const playerStatMatches = (title.match(/\w+:\s*\d+\+/g) || []).length;
  if (playerStatMatches > 1) return true;

  return false;
}

/**
 * Extract a simplified question from market title
 * Removes "Will", "?", year prefixes, etc.
 */
function simplifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^will\s+/i, '')
    .replace(/\?+$/, '')
    .replace(/\s+in\s+202\d/, '')
    .replace(/\s+by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|december|january|february)\s*\d*/gi, '')
    .replace(/\s+before\s+202\d/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match markets between Kalshi and Polymarket
 */
export function matchMarketsCrossPlatform(
  kalshiMarkets: Market[],
  polymarketMarkets: Market[],
  minSimilarity: number = 0.25  // Lowered further for more matches
): CrossPlatformMatch[] {
  const matches: CrossPlatformMatch[] = [];
  const usedPolymarketIds = new Set<string>();

  // Filter out parlay markets from Kalshi
  const singleKalshi = kalshiMarkets.filter(m => {
    if (!m.title || !m.price) return false;
    if (m.price <= 0 || m.price >= 1) return false;
    return !isParlayMarket(m.title);
  });

  const validPoly = polymarketMarkets.filter(m => m.title && m.price && m.price > 0 && m.price < 1);

  logger.info(`Cross-platform: ${singleKalshi.length} single Kalshi markets, ${validPoly.length} Polymarket`);

  if (singleKalshi.length === 0) {
    logger.debug('No single Kalshi markets found (all are parlays/combos)');
    return [];
  }

  // Build keyword index for Polymarket for faster matching
  const polyByKeyword = new Map<string, Market[]>();
  const keywords = ['trump', 'biden', 'bitcoin', 'btc', 'ethereum', 'fed', 'rate', 'ukraine', 'russia',
    'china', 'taiwan', 'israel', 'gaza', 'election', 'nfl', 'nba', 'super bowl', 'oscar', 'grammy',
    'inflation', 'recession', 'ai', 'openai', 'tesla', 'musk', 'apple', 'google', 'amazon', 'meta',
    'avatar', 'movie', 'box office', 'hottest', 'temperature', 'climate'];

  for (const poly of validPoly) {
    const titleLower = poly.title?.toLowerCase() ?? '';
    for (const kw of keywords) {
      if (titleLower.includes(kw)) {
        if (!polyByKeyword.has(kw)) polyByKeyword.set(kw, []);
        polyByKeyword.get(kw)!.push(poly);
      }
    }
  }

  // Track near-misses for debugging
  const nearMisses: Array<{ kalshi: string; poly: string; score: number }> = [];
  let parlaysSkipped = 0;

  for (const kalshi of singleKalshi) {
    const kalshiTitle = kalshi.title ?? '';
    const kalshiLower = kalshiTitle.toLowerCase();

    // Find candidate Polymarket markets by keyword overlap
    const candidatePoly = new Set<Market>();

    for (const kw of keywords) {
      if (kalshiLower.includes(kw)) {
        const polyMatches = polyByKeyword.get(kw) || [];
        for (const p of polyMatches) {
          if (!usedPolymarketIds.has(p.id)) {
            candidatePoly.add(p);
          }
        }
      }
    }

    // If no keyword matches, check all Polymarket markets
    const toCheck = candidatePoly.size > 0 ? [...candidatePoly] : validPoly.filter(p => !usedPolymarketIds.has(p.id));

    let bestMatch: Market | null = null;
    let bestSimilarity = minSimilarity;

    for (const poly of toCheck) {
      if (usedPolymarketIds.has(poly.id)) continue;
      if (!poly.title || !poly.price) continue;

      const similarity = calculateTitleSimilarity(kalshiTitle, poly.title);

      // Track near-misses
      if (similarity >= 0.15 && similarity < minSimilarity && nearMisses.length < 10) {
        nearMisses.push({
          kalshi: kalshiTitle.slice(0, 50),
          poly: poly.title.slice(0, 50),
          score: similarity,
        });
      }

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = poly;
      }
    }

    if (bestMatch) {
      usedPolymarketIds.add(bestMatch.id);

      const priceDiff = bestMatch.price - kalshi.price;

      matches.push({
        kalshi,
        polymarket: bestMatch,
        similarity: bestSimilarity,
        kalshiPrice: kalshi.price,
        polymarketPrice: bestMatch.price,
        priceDifference: priceDiff,
        absDifference: Math.abs(priceDiff),
        polymarketMoreBullish: priceDiff > 0,
        category: kalshi.category ?? bestMatch.category ?? 'other',
      });
    }
  }

  // Log near-misses if few matches found
  if (matches.length < 3 && nearMisses.length > 0) {
    logger.info(`Cross-platform near-misses (top 5):`);
    nearMisses.sort((a, b) => b.score - a.score);
    for (const nm of nearMisses.slice(0, 5)) {
      logger.info(`  ${(nm.score * 100).toFixed(0)}%: "${nm.kalshi}" <-> "${nm.poly}"`);
    }
  }

  // Sort by absolute price difference
  matches.sort((a, b) => b.absDifference - a.absDifference);

  logger.info(`Found ${matches.length} cross-platform market matches`);
  return matches;
}

/**
 * Filter to only markets with significant price divergence
 * Also filters out suspicious matches where one price is near 0 or 1
 */
export function getDivergentMarkets(
  matches: CrossPlatformMatch[],
  minDivergence: number = 0.05
): CrossPlatformMatch[] {
  const divergent = matches.filter(m => {
    // Skip if divergence too small
    if (m.absDifference < minDivergence) return false;

    // Skip suspicious matches where one price is extremely low or high
    // This often indicates a bad match or non-existent market
    const minPrice = Math.min(m.kalshiPrice, m.polymarketPrice);
    const maxPrice = Math.max(m.kalshiPrice, m.polymarketPrice);

    // If one price is < 3% and the other is > 20%, likely a bad match
    if (minPrice < 0.03 && maxPrice > 0.20) {
      logger.debug(`Skipping suspicious match: ${m.kalshi.title?.slice(0, 40)} (${(m.kalshiPrice * 100).toFixed(0)}¢ vs ${(m.polymarketPrice * 100).toFixed(0)}¢)`);
      return false;
    }

    return true;
  });

  logger.info(`Found ${divergent.length} markets with >${minDivergence * 100}% divergence`);
  return divergent;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format a single cross-platform comparison for display
 */
export function formatCrossPlatformComparison(match: CrossPlatformMatch): string {
  const { kalshi, polymarket, kalshiPrice, polymarketPrice, priceDifference } = match;

  const title = (kalshi.title ?? '').slice(0, 60);

  let sentiment: string;
  let arrow: string;

  if (priceDifference > 0) {
    sentiment = 'Polymarket more bullish';
    arrow = '📈';
  } else if (priceDifference < 0) {
    sentiment = 'Kalshi more bullish';
    arrow = '📉';
  } else {
    sentiment = 'Same price';
    arrow = '➡️';
  }

  return [
    `${arrow} **${title}**`,
    `   Kalshi: ${(kalshiPrice * 100).toFixed(0)}¢ | Polymarket: ${(polymarketPrice * 100).toFixed(0)}¢ | Δ ${(priceDifference * 100).toFixed(0)}%`,
    `   ${sentiment}`,
    `   [K](${kalshi.url}) | [P](${polymarket.url})`,
  ].join('\n');
}

/**
 * Format a report of the most divergent markets
 */
export function formatDivergenceReport(
  divergentMarkets: CrossPlatformMatch[],
  topN: number = 10
): string {
  if (divergentMarkets.length === 0) {
    return 'No significant cross-platform divergences found.';
  }

  const lines: string[] = ['**📊 Cross-Platform Price Divergences**\n'];

  for (let i = 0; i < Math.min(topN, divergentMarkets.length); i++) {
    const match = divergentMarkets[i];
    const title = (match.kalshi.title ?? '').slice(0, 50);
    const { kalshiPrice, polymarketPrice, absDifference, polymarketMoreBullish } = match;

    const direction = polymarketMoreBullish ? 'P↑' : 'K↑';

    lines.push(
      `${i + 1}. **${title}** — ${direction} ${(absDifference * 100).toFixed(0)}% — ` +
      `K:${(kalshiPrice * 100).toFixed(0)}¢ vs P:${(polymarketPrice * 100).toFixed(0)}¢`
    );
  }

  return lines.join('\n');
}
