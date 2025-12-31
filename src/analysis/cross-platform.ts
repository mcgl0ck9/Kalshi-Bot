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
 */

import type { Market, CrossPlatformMatch } from '../types/index.js';
import { logger } from '../utils/index.js';

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

  // People - Politics
  trump: ['trump', 'donald trump', 'donald j trump', 'djt'],
  biden: ['biden', 'joe biden', 'president biden'],
  musk: ['musk', 'elon musk', 'elon'],
  powell: ['powell', 'jerome powell', 'fed chair', 'fed chairman'],
  putin: ['putin', 'vladimir putin', 'russia president'],
  zelensky: ['zelensky', 'zelenskyy', 'ukraine president'],
  netanyahu: ['netanyahu', 'bibi', 'israel pm', 'israel prime minister'],
  maduro: ['maduro', 'venezuela president', 'nicolas maduro'],

  // Organizations
  fed: ['fed', 'federal reserve', 'fomc', 'fed rate'],
  sec: ['sec', 'securities and exchange', 'gensler'],
  nato: ['nato', 'north atlantic'],
  opec: ['opec', 'oil cartel'],

  // Companies - Tech Giants
  apple: ['apple', 'aapl', 'iphone', 'tim cook'],
  microsoft: ['microsoft', 'msft', 'satya nadella'],
  nvidia: ['nvidia', 'nvda', 'jensen huang'],
  amazon: ['amazon', 'amzn', 'aws', 'bezos'],
  google: ['google', 'alphabet', 'googl', 'goog'],
  meta: ['meta', 'facebook', 'zuckerberg', 'fb'],
  tesla: ['tesla', 'tsla'],
  openai: ['openai', 'chatgpt', 'sam altman'],
  aramco: ['aramco', 'saudi aramco', 'saudi oil'],

  // Topics - Economic
  election: ['election', 'presidential', 'vote', 'voting', 'ballot'],
  rate: ['rate', 'interest rate', 'rate cut', 'rate hike', 'basis point', 'bps'],
  recession: ['recession', 'economic downturn', 'depression', 'gdp decline'],
  inflation: ['inflation', 'cpi', 'consumer price', 'pce'],
  jobs: ['jobs', 'employment', 'unemployment', 'nonfarm', 'payroll', 'jobless'],
  gdp: ['gdp', 'gross domestic', 'economic growth'],
  tariff: ['tariff', 'trade war', 'import tax', 'duties'],

  // Topics - Geopolitical
  ukraine: ['ukraine', 'kyiv', 'kiev', 'ukrainian'],
  russia: ['russia', 'russian', 'moscow', 'kremlin'],
  china: ['china', 'chinese', 'beijing', 'xi jinping', 'ccp'],
  israel: ['israel', 'israeli', 'gaza', 'hamas', 'idf'],
  ceasefire: ['ceasefire', 'peace deal', 'armistice', 'truce'],
  war: ['war', 'conflict', 'invasion', 'military'],

  // Topics - Cannabis/Drugs
  cannabis: ['cannabis', 'marijuana', 'weed', 'pot', 'schedule', 'reschedule', 'descheduled'],

  // Entertainment - Movies
  movie: ['movie', 'film', 'box office', 'grossing', 'theatrical'],
  oscar: ['oscar', 'academy award', 'best picture'],
  grammy: ['grammy', 'grammys', 'album of the year'],

  // Sports - General
  superbowl: ['super bowl', 'superbowl', 'nfl championship'],
  worldseries: ['world series', 'mlb championship'],
  nba: ['nba', 'basketball', 'nba finals'],
  nfl: ['nfl', 'football', 'touchdowns'],
  mlb: ['mlb', 'baseball', 'pennant'],
  nhl: ['nhl', 'hockey', 'stanley cup'],

  // NFL Teams (32) - Using team names and full city names only (no short abbreviations)
  // AFC East
  bills: ['bills', 'buffalo bills', 'buffalo'],
  dolphins: ['dolphins', 'miami dolphins'],
  patriots: ['patriots', 'new england patriots', 'pats'],
  jets: ['jets', 'new york jets', 'ny jets'],
  // AFC North
  ravens: ['ravens', 'baltimore ravens', 'baltimore'],
  bengals: ['bengals', 'cincinnati bengals', 'cincinnati', 'cincy'],
  browns: ['browns', 'cleveland browns', 'cleveland'],
  steelers: ['steelers', 'pittsburgh steelers', 'pittsburgh'],
  // AFC South
  texans: ['texans', 'houston texans', 'houston'],
  colts: ['colts', 'indianapolis colts', 'indianapolis', 'indy'],
  jaguars: ['jaguars', 'jacksonville jaguars', 'jacksonville', 'jags'],
  titans: ['titans', 'tennessee titans', 'tennessee'],
  // AFC West
  broncos: ['broncos', 'denver broncos', 'denver'],
  chiefs: ['chiefs', 'kansas city chiefs', 'kansas city'],
  raiders: ['raiders', 'las vegas raiders', 'oakland raiders'],
  chargers: ['chargers', 'los angeles chargers', 'la chargers'],
  // NFC East
  cowboys: ['cowboys', 'dallas cowboys', 'dallas'],
  giants: ['giants', 'new york giants', 'ny giants'],
  eagles: ['eagles', 'philadelphia eagles', 'philadelphia', 'philly'],
  commanders: ['commanders', 'washington commanders', 'redskins'],
  // NFC North
  bears: ['bears', 'chicago bears'],
  lions: ['lions', 'detroit lions', 'detroit'],
  packers: ['packers', 'green bay packers', 'green bay'],
  vikings: ['vikings', 'minnesota vikings', 'minnesota'],
  // NFC South
  falcons: ['falcons', 'atlanta falcons', 'atlanta'],
  panthers: ['panthers', 'carolina panthers', 'carolina'],
  saints: ['saints', 'new orleans saints', 'nola'],
  buccaneers: ['buccaneers', 'tampa bay buccaneers', 'tampa bay', 'bucs'],
  // NFC West
  cardinals: ['cardinals', 'arizona cardinals', 'arizona'],
  rams: ['rams', 'los angeles rams', 'la rams'],
  niners: ['49ers', 'niners', 'san francisco 49ers', 'san francisco'],
  seahawks: ['seahawks', 'seattle seahawks', 'seattle'],

  // NBA Teams (30)
  // Atlantic Division
  celtics: ['celtics', 'boston celtics', 'boston'],
  nets: ['nets', 'brooklyn nets', 'brooklyn'],
  knicks: ['knicks', 'new york knicks', 'ny knicks'],
  sixers: ['76ers', 'sixers', 'philadelphia 76ers', 'philly'],
  raptors: ['raptors', 'toronto raptors', 'toronto'],
  // Central Division
  bulls: ['bulls', 'chicago bulls'],
  cavaliers: ['cavaliers', 'cleveland cavaliers', 'cleveland', 'cavs'],
  pistons: ['pistons', 'detroit pistons', 'detroit'],
  pacers: ['pacers', 'indiana pacers', 'indiana'],
  bucks: ['bucks', 'milwaukee bucks', 'milwaukee'],
  // Southeast Division
  hawks: ['hawks', 'atlanta hawks', 'atlanta'],
  hornets: ['hornets', 'charlotte hornets', 'charlotte'],
  heat: ['heat', 'miami heat'],
  magic: ['magic', 'orlando magic', 'orlando'],
  wizards: ['wizards', 'washington wizards'],
  // Northwest Division
  nuggets: ['nuggets', 'denver nuggets', 'denver'],
  timberwolves: ['timberwolves', 'minnesota timberwolves', 'minnesota', 'wolves'],
  thunder: ['thunder', 'oklahoma city thunder', 'oklahoma city', 'okc'],
  blazers: ['trail blazers', 'blazers', 'portland trail blazers', 'portland'],
  jazz: ['jazz', 'utah jazz', 'utah'],
  // Pacific Division
  warriors: ['warriors', 'golden state warriors', 'golden state', 'gsw'],
  clippers: ['clippers', 'los angeles clippers', 'la clippers'],
  lakers: ['lakers', 'los angeles lakers', 'la lakers'],
  suns: ['suns', 'phoenix suns', 'phoenix'],
  kings: ['kings', 'sacramento kings', 'sacramento'],
  // Southwest Division
  mavericks: ['mavericks', 'dallas mavericks', 'dallas', 'mavs'],
  rockets: ['rockets', 'houston rockets', 'houston'],
  grizzlies: ['grizzlies', 'memphis grizzlies', 'memphis'],
  pelicans: ['pelicans', 'new orleans pelicans', 'new orleans'],
  spurs: ['spurs', 'san antonio spurs', 'san antonio'],

  // MLB Teams (30)
  // AL East
  orioles: ['orioles', 'baltimore orioles', 'baltimore'],
  redsox: ['red sox', 'redsox', 'boston red sox', 'boston'],
  yankees: ['yankees', 'new york yankees', 'ny yankees'],
  rays: ['rays', 'tampa bay rays', 'tampa bay'],
  bluejays: ['blue jays', 'bluejays', 'toronto blue jays', 'toronto'],
  // AL Central
  whitesox: ['white sox', 'whitesox', 'chicago white sox'],
  guardians: ['guardians', 'cleveland guardians', 'cleveland'],
  tigers: ['tigers', 'detroit tigers', 'detroit'],
  royals: ['royals', 'kansas city royals', 'kansas city'],
  twins: ['twins', 'minnesota twins', 'minnesota'],
  // AL West
  astros: ['astros', 'houston astros', 'houston'],
  angels: ['angels', 'los angeles angels', 'la angels', 'anaheim angels'],
  athletics: ['athletics', 'oakland athletics', 'oakland', "a's"],
  mariners: ['mariners', 'seattle mariners', 'seattle'],
  rangers: ['rangers', 'texas rangers', 'texas'],
  // NL East
  braves: ['braves', 'atlanta braves', 'atlanta'],
  marlins: ['marlins', 'miami marlins'],
  mets: ['mets', 'new york mets', 'ny mets'],
  phillies: ['phillies', 'philadelphia phillies', 'philadelphia'],
  nationals: ['nationals', 'washington nationals', 'nats'],
  // NL Central
  cubs: ['cubs', 'chicago cubs'],
  reds: ['reds', 'cincinnati reds', 'cincinnati'],
  brewers: ['brewers', 'milwaukee brewers', 'milwaukee'],
  pirates: ['pirates', 'pittsburgh pirates', 'pittsburgh'],
  cardinals_mlb: ['cardinals', 'st louis cardinals', 'st. louis cardinals'],
  // NL West
  diamondbacks: ['diamondbacks', 'd-backs', 'dbacks', 'arizona diamondbacks', 'arizona'],
  rockies: ['rockies', 'colorado rockies', 'colorado'],
  dodgers: ['dodgers', 'los angeles dodgers', 'la dodgers'],
  padres: ['padres', 'san diego padres', 'san diego'],
  giants_mlb: ['giants', 'san francisco giants', 'san francisco'],

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

// All sports team entity keys for matchup detection
const NFL_TEAMS = new Set([
  'bills', 'dolphins', 'patriots', 'jets', 'ravens', 'bengals', 'browns', 'steelers',
  'texans', 'colts', 'jaguars', 'titans', 'broncos', 'chiefs', 'raiders', 'chargers',
  'cowboys', 'giants', 'eagles', 'commanders', 'bears', 'lions', 'packers', 'vikings',
  'falcons', 'panthers', 'saints', 'buccaneers', 'cardinals', 'rams', 'niners', 'seahawks',
]);

const NBA_TEAMS = new Set([
  'celtics', 'nets', 'knicks', 'sixers', 'raptors', 'bulls', 'cavaliers', 'pistons',
  'pacers', 'bucks', 'hawks', 'hornets', 'heat', 'magic', 'wizards', 'nuggets',
  'timberwolves', 'thunder', 'blazers', 'jazz', 'warriors', 'clippers', 'lakers',
  'suns', 'kings', 'mavericks', 'rockets', 'grizzlies', 'pelicans', 'spurs',
]);

const MLB_TEAMS = new Set([
  'orioles', 'redsox', 'yankees', 'rays', 'bluejays', 'whitesox', 'guardians', 'tigers',
  'royals', 'twins', 'astros', 'angels', 'athletics', 'mariners', 'rangers', 'braves',
  'marlins', 'mets', 'phillies', 'nationals', 'cubs', 'reds', 'brewers', 'pirates',
  'cardinals_mlb', 'diamondbacks', 'rockies', 'dodgers', 'padres', 'giants_mlb',
]);

/**
 * Detect sports matchups between two sets of entities
 * Returns high boost if both have the same two teams (matchup)
 */
function getSportsTeamsFromEntities(
  entities1: Set<string>,
  entities2: Set<string>
): { match: boolean; boost: number; teams?: string[] } {
  // Get sports teams from each entity set
  const teams1 = [...entities1].filter(
    e => NFL_TEAMS.has(e) || NBA_TEAMS.has(e) || MLB_TEAMS.has(e)
  );
  const teams2 = [...entities2].filter(
    e => NFL_TEAMS.has(e) || NBA_TEAMS.has(e) || MLB_TEAMS.has(e)
  );

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
 * Match markets between Kalshi and Polymarket
 */
export function matchMarketsCrossPlatform(
  kalshiMarkets: Market[],
  polymarketMarkets: Market[],
  minSimilarity: number = 0.5
): CrossPlatformMatch[] {
  const matches: CrossPlatformMatch[] = [];
  const usedPolymarketIds = new Set<string>();

  for (const kalshi of kalshiMarkets) {
    if (!kalshi.title || !kalshi.price) continue;

    let bestMatch: Market | null = null;
    let bestSimilarity = minSimilarity;

    for (const poly of polymarketMarkets) {
      if (usedPolymarketIds.has(poly.id)) continue;
      if (!poly.title || !poly.price) continue;

      const similarity = calculateTitleSimilarity(kalshi.title, poly.title);

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

  // Sort by absolute price difference
  matches.sort((a, b) => b.absDifference - a.absDifference);

  logger.info(`Found ${matches.length} cross-platform market matches`);
  return matches;
}

/**
 * Filter to only markets with significant price divergence
 */
export function getDivergentMarkets(
  matches: CrossPlatformMatch[],
  minDivergence: number = 0.05
): CrossPlatformMatch[] {
  const divergent = matches.filter(m => m.absDifference >= minDivergence);
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
