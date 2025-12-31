/**
 * Configuration for Kalshi Edge Detector
 */

import 'dotenv/config';
import type { MarketCategory, TopicConfig } from './types/index.js';

// =============================================================================
// DISCORD
// =============================================================================
export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? '';
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';

// =============================================================================
// KALSHI (for dr-manhattan)
// =============================================================================
export const KALSHI_API_KEY_ID = process.env.KALSHI_API_KEY_ID ?? '';
export const KALSHI_PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY ?? '';
export const KALSHI_PRIVATE_KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH ?? '';
export const KALSHI_DEMO = process.env.KALSHI_DEMO === 'true';

// =============================================================================
// APIs
// =============================================================================
export const NEWS_API_KEY = process.env.NEWS_API_KEY ?? '';
export const ODDS_API_KEY = process.env.ODDS_API_KEY ?? '';

// =============================================================================
// TRADING SETTINGS
// =============================================================================
export const BANKROLL = parseFloat(process.env.BANKROLL ?? '10000');
export const MAX_POSITION_PCT = parseFloat(process.env.MAX_POSITION_PCT ?? '0.25');

// Tiered edge thresholds
export const EDGE_THRESHOLDS = {
  critical: 0.15,      // 15%+ edge = critical alert, high conviction
  actionable: 0.08,    // 8%+ edge = actionable, worth trading
  watchlist: 0.04,     // 4%+ edge = watchlist, monitor for confirmation
  minimum: 0.02,       // 2%+ edge = minimum to surface at all
};

// Legacy threshold (uses actionable tier)
export const MIN_EDGE_THRESHOLD = parseFloat(process.env.MIN_EDGE_THRESHOLD ?? '0.04');
export const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE ?? '0.50');

// =============================================================================
// POLYMARKET ON-CHAIN DATA (Goldsky Subgraphs - FREE)
// =============================================================================
export const POLYMARKET_SUBGRAPHS = {
  positions: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
  orderbook: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn',
  activity: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn',
  openInterest: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/oi-subgraph/0.0.6/gn',
  pnl: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
};

// Polymarket Data API
export const POLYMARKET_API = {
  base: 'https://data-api.polymarket.com',
  gamma: 'https://gamma-api.polymarket.com',
};

// =============================================================================
// SCHEDULE
// =============================================================================
export const TIMEZONE = process.env.TIMEZONE ?? 'America/New_York';
export const SCHEDULE = [
  { hour: 6, minute: 30 },   // Morning
  { hour: 12, minute: 0 },   // Midday
  { hour: 17, minute: 0 },   // Evening
];

// =============================================================================
// CATEGORY PRIORITIES (lower = higher priority)
// =============================================================================
export const CATEGORY_PRIORITIES: Record<MarketCategory, number> = {
  politics: 1,
  crypto: 2,
  entertainment: 3,
  sports: 4,
  geopolitics: 5,
  macro: 6,
  tech: 7,
  weather: 8,
  other: 99,
};

// =============================================================================
// TRACKED TOPICS - Keywords for sentiment analysis
// =============================================================================
export const TRACKED_TOPICS: Record<string, TopicConfig> = {
  // Politics
  trump: {
    keywords: ['trump', 'donald trump', 'maga', 'trump administration'],
    category: 'politics',
  },
  biden: {
    keywords: ['biden', 'joe biden', 'biden administration'],
    category: 'politics',
  },
  election: {
    keywords: ['election', '2024 election', '2026 election', 'midterm', 'primary'],
    category: 'politics',
  },
  impeachment: {
    keywords: ['impeach', 'impeachment', 'articles of impeachment'],
    category: 'politics',
  },

  // Crypto
  bitcoin: {
    keywords: ['bitcoin', 'btc', 'bitcoin price', 'bitcoin etf'],
    category: 'crypto',
  },
  ethereum: {
    keywords: ['ethereum', 'eth', 'ether'],
    category: 'crypto',
  },
  crypto_regulation: {
    keywords: ['sec crypto', 'crypto regulation', 'gensler', 'crypto ban'],
    category: 'crypto',
  },

  // Entertainment - Awards
  oscars: {
    keywords: ['oscar', 'academy award', 'best picture', 'best actor', 'best actress', 'best director'],
    category: 'entertainment',
  },
  grammys: {
    keywords: ['grammy', 'grammys', 'album of the year', 'song of the year', 'record of the year'],
    category: 'entertainment',
  },
  emmys: {
    keywords: ['emmy', 'emmys', 'primetime emmy', 'outstanding drama', 'outstanding comedy'],
    category: 'entertainment',
  },
  golden_globes: {
    keywords: ['golden globe', 'golden globes', 'hfpa'],
    category: 'entertainment',
  },

  // Entertainment - Box Office & Movies
  box_office: {
    keywords: ['box office', 'opening weekend', 'weekend box office', 'domestic gross', 'worldwide gross', 'ticket sales'],
    category: 'entertainment',
  },
  rotten_tomatoes: {
    keywords: ['rotten tomatoes', 'tomatometer', 'critics score', 'audience score', 'certified fresh', 'rotten'],
    category: 'entertainment',
  },
  movie_releases: {
    keywords: ['movie premiere', 'film release', 'theatrical release', 'wide release', 'limited release'],
    category: 'entertainment',
  },

  // Entertainment - Streaming
  streaming: {
    keywords: ['netflix', 'disney+', 'hbo max', 'amazon prime', 'streaming numbers', 'viewership'],
    category: 'entertainment',
  },

  // Entertainment - Music
  billboard: {
    keywords: ['billboard', 'hot 100', 'billboard 200', 'number one', 'chart topping'],
    category: 'entertainment',
  },
  album_sales: {
    keywords: ['album sales', 'record sales', 'platinum', 'gold certified', 'first week sales'],
    category: 'entertainment',
  },

  // Entertainment - TV
  tv_ratings: {
    keywords: ['tv ratings', 'nielsen', 'viewership', 'series finale', 'season premiere'],
    category: 'entertainment',
  },

  // Sports - Major Leagues
  nfl: {
    keywords: ['nfl', 'super bowl', 'touchdown', 'quarterback', 'football', 'chiefs', 'eagles', 'cowboys', 'patriots'],
    category: 'sports',
  },
  nba: {
    keywords: ['nba', 'basketball', 'nba finals', 'playoffs', 'lebron', 'curry', 'lakers', 'celtics', 'warriors'],
    category: 'sports',
  },
  mlb: {
    keywords: ['mlb', 'baseball', 'world series', 'home run', 'pitcher', 'yankees', 'dodgers', 'mets', 'cubs'],
    category: 'sports',
  },
  nhl: {
    keywords: ['nhl', 'hockey', 'stanley cup', 'goal', 'puck', 'bruins', 'rangers', 'maple leafs', 'oilers'],
    category: 'sports',
  },
  soccer: {
    keywords: ['soccer', 'football', 'premier league', 'champions league', 'la liga', 'bundesliga', 'serie a', 'mls', 'world cup', 'messi', 'ronaldo'],
    category: 'sports',
  },
  golf: {
    keywords: ['golf', 'pga', 'masters', 'us open', 'british open', 'pga championship', 'tiger woods', 'rory', 'scottie scheffler'],
    category: 'sports',
  },
  tennis: {
    keywords: ['tennis', 'wimbledon', 'us open tennis', 'french open', 'australian open', 'grand slam', 'djokovic', 'alcaraz', 'sinner'],
    category: 'sports',
  },
  mma: {
    keywords: ['mma', 'ufc', 'knockout', 'submission', 'fight', 'dana white', 'heavyweight', 'lightweight'],
    category: 'sports',
  },
  college_football: {
    keywords: ['college football', 'cfp', 'cfb', 'ncaa football', 'heisman', 'college playoff', 'sec football', 'big ten football'],
    category: 'sports',
  },
  college_basketball: {
    keywords: ['college basketball', 'march madness', 'ncaa tournament', 'final four', 'ncaa basketball', 'cbb'],
    category: 'sports',
  },
  // Sports - Injuries (for overreaction detection)
  sports_injury: {
    keywords: ['injury', 'injured', 'out for season', 'ruled out', 'questionable', 'doubtful', 'day-to-day', 'concussion', 'torn acl', 'hamstring', 'ankle injury'],
    category: 'sports',
  },

  // Geopolitics
  ukraine: {
    keywords: ['ukraine', 'zelensky', 'kyiv', 'russia ukraine'],
    category: 'geopolitics',
  },
  israel: {
    keywords: ['israel', 'gaza', 'hamas', 'netanyahu'],
    category: 'geopolitics',
  },
  china: {
    keywords: ['china', 'taiwan', 'xi jinping', 'beijing'],
    category: 'geopolitics',
  },
  tariffs: {
    keywords: ['tariff', 'trade war', 'import tax'],
    category: 'geopolitics',
  },

  // Macro - Fed & Monetary Policy
  fed_rate: {
    keywords: ['fed rate', 'federal reserve', 'fomc', 'powell', 'rate cut', 'rate hike', 'fed decision', 'interest rate decision'],
    category: 'macro',
  },
  fed_speech: {
    keywords: ['fed speech', 'powell speech', 'fomc minutes', 'fed testimony', 'federal reserve chair', 'fed governor', 'fed president', 'jackson hole', 'fed remarks', 'monetary policy statement'],
    category: 'macro',
  },
  fomc_minutes: {
    keywords: ['fomc minutes', 'meeting minutes', 'fed minutes', 'policy statement', 'dot plot', 'fed projections', 'economic projections'],
    category: 'macro',
  },
  inflation: {
    keywords: ['inflation', 'cpi', 'consumer price', 'pce', 'core inflation', 'price index', 'inflation rate', 'disinflation'],
    category: 'macro',
  },
  recession: {
    keywords: ['recession', 'economic downturn', 'gdp decline', 'economic contraction', 'hard landing', 'soft landing'],
    category: 'macro',
  },
  jobs: {
    keywords: ['jobs report', 'unemployment', 'nonfarm payroll', 'nfp', 'employment report', 'jobless claims', 'labor market', 'payrolls'],
    category: 'macro',
  },
  gdp: {
    keywords: ['gdp', 'gross domestic product', 'economic growth', 'gdp growth', 'gdpnow', 'economic output'],
    category: 'macro',
  },

  // Tech
  ai: {
    keywords: ['artificial intelligence', 'chatgpt', 'openai', 'ai regulation'],
    category: 'tech',
  },

  // Weather
  hurricane: {
    keywords: ['hurricane', 'tropical storm', 'cyclone'],
    category: 'weather',
  },
};

// =============================================================================
// KNOWN WHALES (with wallet addresses for on-chain tracking)
// =============================================================================
export const KNOWN_WHALES: Record<string, {
  twitter?: string;
  wallet?: string;  // Polymarket wallet address for on-chain tracking
  platform: 'polymarket' | 'kalshi';
  profit: number;
  specialty: string[];
  description: string;
  trackOnChain: boolean;
}> = {
  // Top Polymarket traders from leaderboard
  Theo: {
    wallet: '0x1234567890abcdef', // Placeholder - need real address
    platform: 'polymarket',
    profit: 5_000_000,
    specialty: ['politics', 'elections'],
    description: 'Top Polymarket whale, $5M+ profit',
    trackOnChain: true,
  },
  Domahhhh: {
    twitter: 'Domahhhh',
    platform: 'polymarket',
    profit: 1_200_000,
    specialty: ['politics', 'general'],
    description: 'Top Polymarket trader, $1.2M profit',
    trackOnChain: false,
  },
  cobybets1: {
    twitter: 'cobybets1',
    platform: 'polymarket',
    profit: 640_000,
    specialty: ['sports', 'politics'],
    description: 'Sports and politics specialist',
    trackOnChain: false,
  },
  GaetenD: {
    twitter: 'GaetenD',
    platform: 'polymarket',
    profit: 500_000,
    specialty: ['entertainment', 'culture'],
    description: 'Entertainment markets expert',
    trackOnChain: false,
  },
  Fredi9999: {
    twitter: 'Fredi9999',
    platform: 'polymarket',
    profit: 400_000,
    specialty: ['politics', 'crypto'],
    description: 'Politics and crypto trader',
    trackOnChain: false,
  },
  PredictItSharps: {
    twitter: 'StarSpangledGmbr',
    platform: 'kalshi',
    profit: 300_000,
    specialty: ['politics'],
    description: 'Politics specialist, former PredictIt whale',
    trackOnChain: false,
  },
};

// Minimum position size to be considered a "whale" position (in USDC)
export const WHALE_POSITION_THRESHOLD = 10_000;

// Minimum conviction % to trigger a signal (e.g., 70% = whale has 70%+ of their capital in one outcome)
export const WHALE_CONVICTION_THRESHOLD = 0.70;

// =============================================================================
// RSS FEEDS (100+ sources)
// =============================================================================
export const RSS_FEEDS: Record<string, string> = {
  // ==========================================================================
  // WIRE SERVICES & MAJOR NEWS (High Priority)
  // ==========================================================================
  reuters_top: 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best',
  reuters_world: 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best',
  ap_top: 'https://rsshub.app/apnews/topics/apf-topnews',
  ap_politics: 'https://rsshub.app/apnews/topics/apf-politics',
  ap_business: 'https://rsshub.app/apnews/topics/apf-business',
  ap_entertainment: 'https://rsshub.app/apnews/topics/apf-entertainment',
  bbc_top: 'https://feeds.bbci.co.uk/news/rss.xml',
  bbc_world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  bbc_business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  bbc_entertainment: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
  npr: 'https://feeds.npr.org/1001/rss.xml',
  pbs: 'https://www.pbs.org/newshour/feeds/rss/headlines',

  // ==========================================================================
  // FINANCIAL NEWS (High Priority for Markets)
  // ==========================================================================
  cnbc_top: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  cnbc_markets: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  cnbc_economy: 'https://www.cnbc.com/id/20910252/device/rss/rss.html',
  marketwatch_top: 'https://feeds.marketwatch.com/marketwatch/topstories',
  marketwatch_markets: 'https://feeds.marketwatch.com/marketwatch/marketpulse',
  bloomberg_markets: 'https://feeds.bloomberg.com/markets/news.rss',
  bloomberg_politics: 'https://feeds.bloomberg.com/politics/news.rss',
  ft_home: 'https://www.ft.com/rss/home',
  ft_world: 'https://www.ft.com/world?format=rss',
  yahoo_finance: 'https://finance.yahoo.com/news/rssindex',
  investopedia: 'https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline',
  seeking_alpha: 'https://seekingalpha.com/market_currents.xml',
  zerohedge: 'https://feeds.feedburner.com/zerohedge/feed',
  barrons: 'https://www.barrons.com/xml/rss/3_7510.xml',

  // ==========================================================================
  // POLITICS & GOVERNMENT
  // ==========================================================================
  politico_top: 'https://www.politico.com/rss/politicopicks.xml',
  politico_congress: 'https://www.politico.com/rss/congress.xml',
  politico_whitehouse: 'https://www.politico.com/rss/whitehouse.xml',
  hill_top: 'https://thehill.com/feed/',
  hill_news: 'https://thehill.com/news/feed/',
  axios: 'https://api.axios.com/feed/',
  realclearpolitics: 'https://www.realclearpolitics.com/index.xml',
  fivethirtyeight: 'https://fivethirtyeight.com/features/feed/',
  rollcall: 'https://www.rollcall.com/feed/',
  washingtonexaminer: 'https://www.washingtonexaminer.com/section/news/feed',
  nationalreview: 'https://www.nationalreview.com/feed/',
  reason: 'https://reason.com/feed/',

  // ==========================================================================
  // GOVERNMENT OFFICIAL SOURCES (Most Authoritative)
  // ==========================================================================
  fed_press: 'https://www.federalreserve.gov/feeds/press_all.xml',
  fed_speeches: 'https://www.federalreserve.gov/feeds/speeches.xml',
  whitehouse: 'https://www.whitehouse.gov/feed/',
  sec_press: 'https://www.sec.gov/rss/news/press.xml',
  doj_press: 'https://www.justice.gov/feeds/opa/justice-news.xml',
  state_dept: 'https://www.state.gov/rss-feed/press-releases/feed/',
  congress_bills: 'https://www.congress.gov/rss/most-viewed-bills.xml',

  // ==========================================================================
  // ECONOMICS & DATA
  // ==========================================================================
  bls_news: 'https://www.bls.gov/feed/bls_latest.rss',
  fred_releases: 'https://fred.stlouisfed.org/releases/calendar.rss',
  imf_news: 'https://www.imf.org/en/News/rss',
  worldbank: 'https://www.worldbank.org/en/news/all?format=rss',
  economist: 'https://www.economist.com/latest/rss.xml',

  // ==========================================================================
  // CRYPTO & BLOCKCHAIN
  // ==========================================================================
  coindesk: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  cointelegraph: 'https://cointelegraph.com/rss',
  decrypt: 'https://decrypt.co/feed',
  theblock: 'https://www.theblock.co/rss.xml',
  bitcoinmagazine: 'https://bitcoinmagazine.com/.rss/full/',
  cryptoslate: 'https://cryptoslate.com/feed/',
  bitcoinist: 'https://bitcoinist.com/feed/',
  newsbtc: 'https://www.newsbtc.com/feed/',

  // ==========================================================================
  // SPORTS
  // ==========================================================================
  espn_top: 'https://www.espn.com/espn/rss/news',
  espn_nfl: 'https://www.espn.com/espn/rss/nfl/news',
  espn_nba: 'https://www.espn.com/espn/rss/nba/news',
  espn_mlb: 'https://www.espn.com/espn/rss/mlb/news',
  espn_nhl: 'https://www.espn.com/espn/rss/nhl/news',
  espn_soccer: 'https://www.espn.com/espn/rss/soccer/news',
  cbssports: 'https://www.cbssports.com/rss/headlines/',
  bleacherreport: 'https://bleacherreport.com/articles/feed',
  yahoosports: 'https://sports.yahoo.com/rss/',
  sportingnews: 'https://www.sportingnews.com/us/rss',
  si: 'https://www.si.com/rss/si_topstories.rss',

  // ==========================================================================
  // TECHNOLOGY & AI
  // ==========================================================================
  techcrunch: 'https://techcrunch.com/feed/',
  theverge: 'https://www.theverge.com/rss/index.xml',
  wired: 'https://www.wired.com/feed/rss',
  arstechnica: 'https://feeds.arstechnica.com/arstechnica/index',
  engadget: 'https://www.engadget.com/rss.xml',
  venturebeat: 'https://venturebeat.com/feed/',
  zdnet: 'https://www.zdnet.com/news/rss.xml',
  hackernews: 'https://news.ycombinator.com/rss',
  mit_tech_review: 'https://www.technologyreview.com/feed/',

  // ==========================================================================
  // ENTERTAINMENT & CULTURE (Expanded - High Priority for Box Office/RT)
  // ==========================================================================
  variety: 'https://variety.com/feed/',
  variety_film: 'https://variety.com/v/film/feed/',
  variety_tv: 'https://variety.com/v/tv/feed/',
  variety_music: 'https://variety.com/v/music/feed/',
  deadline: 'https://deadline.com/feed/',
  deadline_film: 'https://deadline.com/category/film/feed/',
  deadline_tv: 'https://deadline.com/category/tv/feed/',
  hollywoodreporter: 'https://www.hollywoodreporter.com/feed/',
  hollywoodreporter_movies: 'https://www.hollywoodreporter.com/c/movies/feed/',
  hollywoodreporter_tv: 'https://www.hollywoodreporter.com/c/tv/feed/',
  ew: 'https://ew.com/feed/',
  ew_movies: 'https://ew.com/movies/feed/',
  ew_tv: 'https://ew.com/tv/feed/',
  billboard: 'https://www.billboard.com/feed/',
  billboard_charts: 'https://www.billboard.com/charts/feed/',
  rollingstone: 'https://www.rollingstone.com/feed/',
  rollingstone_movies: 'https://www.rollingstone.com/movies/feed/',
  tmz: 'https://www.tmz.com/rss.xml',
  eonline: 'https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml',
  people: 'https://people.com/feed/',
  usmagazine: 'https://www.usmagazine.com/feed/',
  indiewire: 'https://www.indiewire.com/feed/',
  screenrant: 'https://screenrant.com/feed/',
  collider: 'https://collider.com/feed/',
  slashfilm: 'https://www.slashfilm.com/feed/',
  ign_movies: 'https://www.ign.com/articles/movies/feed',
  avclub: 'https://www.avclub.com/rss',
  cinemablend: 'https://www.cinemablend.com/rss/topic/movies',

  // ==========================================================================
  // BOX OFFICE SPECIFIC
  // ==========================================================================
  boxofficemojo_news: 'https://www.boxofficemojo.com/news/feed/',
  the_numbers: 'https://www.the-numbers.com/news/feed',

  // ==========================================================================
  // GEOPOLITICS & INTERNATIONAL
  // ==========================================================================
  aljazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  foreignpolicy: 'https://foreignpolicy.com/feed/',
  foreignaffairs: 'https://www.foreignaffairs.com/rss.xml',
  guardian_world: 'https://www.theguardian.com/world/rss',
  dw: 'https://rss.dw.com/rdf/rss-en-all',
  france24: 'https://www.france24.com/en/rss',
  scmp: 'https://www.scmp.com/rss/91/feed',

  // ==========================================================================
  // WEATHER & CLIMATE
  // ==========================================================================
  nhc_atlantic: 'https://www.nhc.noaa.gov/index-at.xml',

  // ==========================================================================
  // BUSINESS
  // ==========================================================================
  businessinsider: 'https://www.businessinsider.com/rss',
  forbes: 'https://www.forbes.com/real-time/feed2/',
  fortune: 'https://fortune.com/feed/',
  fastcompany: 'https://www.fastcompany.com/latest/rss?truncated=true',
  hbr: 'https://hbr.org/feed',
};

// =============================================================================
// VALIDATION
// =============================================================================
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!DISCORD_WEBHOOK_URL && !DISCORD_BOT_TOKEN) {
    errors.push('Either DISCORD_WEBHOOK_URL or DISCORD_BOT_TOKEN must be set');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
