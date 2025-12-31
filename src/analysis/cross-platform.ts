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

  // NHL Teams (32)
  // Atlantic Division
  bruins: ['bruins', 'boston bruins', 'boston'],
  sabres: ['sabres', 'buffalo sabres', 'buffalo'],
  red_wings: ['red wings', 'detroit red wings', 'detroit'],
  panthers_nhl: ['panthers', 'florida panthers', 'florida'],
  canadiens: ['canadiens', 'montreal canadiens', 'montreal', 'habs'],
  senators: ['senators', 'ottawa senators', 'ottawa'],
  lightning: ['lightning', 'tampa bay lightning', 'tampa bay', 'bolts'],
  maple_leafs: ['maple leafs', 'toronto maple leafs', 'toronto', 'leafs'],
  // Metropolitan Division
  hurricanes: ['hurricanes', 'carolina hurricanes', 'carolina', 'canes'],
  blue_jackets: ['blue jackets', 'columbus blue jackets', 'columbus'],
  devils: ['devils', 'new jersey devils', 'new jersey'],
  islanders: ['islanders', 'new york islanders', 'ny islanders'],
  rangers_nhl: ['rangers', 'new york rangers', 'ny rangers'],
  flyers: ['flyers', 'philadelphia flyers', 'philadelphia', 'philly'],
  penguins: ['penguins', 'pittsburgh penguins', 'pittsburgh', 'pens'],
  capitals: ['capitals', 'washington capitals', 'caps'],
  // Central Division
  coyotes: ['coyotes', 'utah hockey club', 'arizona coyotes', 'utah'],
  blackhawks: ['blackhawks', 'chicago blackhawks', 'hawks'],
  avalanche: ['avalanche', 'colorado avalanche', 'colorado', 'avs'],
  stars: ['stars', 'dallas stars', 'dallas'],
  wild: ['wild', 'minnesota wild', 'minnesota'],
  predators: ['predators', 'nashville predators', 'nashville', 'preds'],
  blues: ['blues', 'st louis blues', 'st. louis blues'],
  jets_nhl: ['jets', 'winnipeg jets', 'winnipeg'],
  // Pacific Division
  ducks: ['ducks', 'anaheim ducks', 'anaheim'],
  flames: ['flames', 'calgary flames', 'calgary'],
  oilers: ['oilers', 'edmonton oilers', 'edmonton'],
  kings_nhl: ['kings', 'los angeles kings', 'la kings'],
  sharks: ['sharks', 'san jose sharks', 'san jose'],
  kraken: ['kraken', 'seattle kraken', 'seattle'],
  canucks: ['canucks', 'vancouver canucks', 'vancouver'],
  golden_knights: ['golden knights', 'vegas golden knights', 'vegas', 'vgk'],

  // NCAAF - College Football (Major Programs)
  // SEC
  alabama: ['alabama', 'crimson tide', 'bama', 'roll tide'],
  auburn: ['auburn', 'auburn tigers', 'war eagle'],
  florida_gators: ['florida', 'florida gators', 'gators'],
  georgia: ['georgia', 'georgia bulldogs', 'bulldogs', 'uga', 'dawgs'],
  lsu: ['lsu', 'louisiana state', 'tigers', 'geaux tigers'],
  ole_miss: ['ole miss', 'mississippi', 'rebels'],
  mississippi_state: ['mississippi state', 'bulldogs', 'miss state'],
  tennessee: ['tennessee', 'volunteers', 'vols'],
  texas_am: ['texas a&m', 'aggies', 'tamu'],
  kentucky: ['kentucky', 'wildcats', 'uk'],
  missouri: ['missouri', 'mizzou', 'tigers'],
  south_carolina: ['south carolina', 'gamecocks'],
  arkansas: ['arkansas', 'razorbacks', 'hogs'],
  vanderbilt: ['vanderbilt', 'commodores', 'vandy'],
  texas_longhorns: ['texas', 'longhorns', 'hook em', 'ut'],
  oklahoma: ['oklahoma', 'sooners', 'boomer sooner', 'ou'],
  // Big Ten
  ohio_state: ['ohio state', 'buckeyes', 'osu'],
  michigan: ['michigan', 'wolverines', 'go blue'],
  penn_state: ['penn state', 'nittany lions', 'psu'],
  michigan_state: ['michigan state', 'spartans', 'msu'],
  wisconsin: ['wisconsin', 'badgers'],
  iowa: ['iowa', 'hawkeyes'],
  minnesota_gophers: ['minnesota', 'golden gophers', 'gophers'],
  nebraska: ['nebraska', 'cornhuskers', 'huskers'],
  illinois: ['illinois', 'fighting illini', 'illini'],
  purdue: ['purdue', 'boilermakers'],
  indiana: ['indiana', 'hoosiers'],
  northwestern: ['northwestern', 'wildcats'],
  rutgers: ['rutgers', 'scarlet knights'],
  maryland: ['maryland', 'terrapins', 'terps'],
  usc: ['usc', 'trojans', 'southern cal'],
  ucla: ['ucla', 'bruins'],
  oregon: ['oregon', 'ducks'],
  washington_huskies: ['washington', 'huskies', 'uw'],
  // ACC
  clemson: ['clemson', 'tigers'],
  florida_state: ['florida state', 'seminoles', 'fsu', 'noles'],
  miami_hurricanes: ['miami', 'hurricanes', 'the u'],
  nc_state: ['nc state', 'wolfpack'],
  north_carolina: ['north carolina', 'tar heels', 'unc'],
  duke: ['duke', 'blue devils'],
  wake_forest: ['wake forest', 'demon deacons'],
  virginia: ['virginia', 'cavaliers', 'uva', 'wahoos'],
  virginia_tech: ['virginia tech', 'hokies', 'vt'],
  louisville: ['louisville', 'cardinals'],
  pittsburgh: ['pittsburgh', 'pitt', 'panthers'],
  syracuse: ['syracuse', 'orange', 'cuse'],
  boston_college: ['boston college', 'eagles', 'bc'],
  georgia_tech: ['georgia tech', 'yellow jackets', 'gt'],
  notre_dame: ['notre dame', 'fighting irish', 'irish', 'nd'],
  // Big 12
  baylor: ['baylor', 'bears'],
  tcu: ['tcu', 'horned frogs'],
  texas_tech: ['texas tech', 'red raiders'],
  kansas: ['kansas', 'jayhawks', 'ku'],
  kansas_state: ['kansas state', 'wildcats', 'k-state'],
  iowa_state: ['iowa state', 'cyclones'],
  oklahoma_state: ['oklahoma state', 'cowboys', 'osu'],
  west_virginia: ['west virginia', 'mountaineers', 'wvu'],
  cincinnati: ['cincinnati', 'bearcats', 'cincy'],
  ucf: ['ucf', 'knights', 'central florida'],
  houston_cougars: ['houston', 'cougars', 'uh'],
  byu: ['byu', 'cougars', 'brigham young'],
  colorado_buffs: ['colorado', 'buffaloes', 'buffs'],
  arizona_state: ['arizona state', 'sun devils', 'asu'],
  arizona_wildcats: ['arizona', 'wildcats'],
  utah_utes: ['utah', 'utes'],
  // Pac-12 remnants & others
  stanford: ['stanford', 'cardinal'],
  cal: ['cal', 'california', 'golden bears'],
  oregon_state: ['oregon state', 'beavers'],
  washington_state: ['washington state', 'cougars', 'wsu'],

  // NCAAB - College Basketball (Major Programs)
  // Already have most from football, adding basketball-specific
  gonzaga: ['gonzaga', 'bulldogs', 'zags'],
  villanova: ['villanova', 'wildcats', 'nova'],
  uconn: ['uconn', 'huskies', 'connecticut'],
  creighton: ['creighton', 'bluejays'],
  marquette: ['marquette', 'golden eagles'],
  st_johns: ['st johns', "st. john's", 'red storm', 'johnnies'],
  seton_hall: ['seton hall', 'pirates'],
  xavier: ['xavier', 'musketeers'],
  butler: ['butler', 'bulldogs'],
  providence: ['providence', 'friars'],
  memphis_tigers: ['memphis', 'tigers'],
  san_diego_state: ['san diego state', 'aztecs', 'sdsu'],
  dayton: ['dayton', 'flyers'],
  saint_marys: ["saint mary's", 'gaels', 'st marys'],

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

const NHL_TEAMS = new Set([
  'bruins', 'sabres', 'red_wings', 'panthers_nhl', 'canadiens', 'senators', 'lightning', 'maple_leafs',
  'hurricanes', 'blue_jackets', 'devils', 'islanders', 'rangers_nhl', 'flyers', 'penguins', 'capitals',
  'coyotes', 'blackhawks', 'avalanche', 'stars', 'wild', 'predators', 'blues', 'jets_nhl',
  'ducks', 'flames', 'oilers', 'kings_nhl', 'sharks', 'kraken', 'canucks', 'golden_knights',
]);

const NCAAF_TEAMS = new Set([
  // SEC
  'alabama', 'auburn', 'florida_gators', 'georgia', 'lsu', 'ole_miss', 'mississippi_state',
  'tennessee', 'texas_am', 'kentucky', 'missouri', 'south_carolina', 'arkansas', 'vanderbilt',
  'texas_longhorns', 'oklahoma',
  // Big Ten
  'ohio_state', 'michigan', 'penn_state', 'michigan_state', 'wisconsin', 'iowa', 'minnesota_gophers',
  'nebraska', 'illinois', 'purdue', 'indiana', 'northwestern', 'rutgers', 'maryland', 'usc', 'ucla',
  'oregon', 'washington_huskies',
  // ACC
  'clemson', 'florida_state', 'miami_hurricanes', 'nc_state', 'north_carolina', 'duke', 'wake_forest',
  'virginia', 'virginia_tech', 'louisville', 'pittsburgh', 'syracuse', 'boston_college', 'georgia_tech',
  'notre_dame',
  // Big 12
  'baylor', 'tcu', 'texas_tech', 'kansas', 'kansas_state', 'iowa_state', 'oklahoma_state',
  'west_virginia', 'cincinnati', 'ucf', 'houston_cougars', 'byu', 'colorado_buffs', 'arizona_state',
  'arizona_wildcats', 'utah_utes',
  // Others
  'stanford', 'cal', 'oregon_state', 'washington_state',
]);

const NCAAB_TEAMS = new Set([
  // Use NCAAF teams plus basketball-specific
  ...NCAAF_TEAMS,
  'gonzaga', 'villanova', 'uconn', 'creighton', 'marquette', 'st_johns', 'seton_hall',
  'xavier', 'butler', 'providence', 'memphis_tigers', 'san_diego_state', 'dayton', 'saint_marys',
]);

// Combined set for quick lookup
const ALL_SPORTS_TEAMS = new Set([
  ...NFL_TEAMS, ...NBA_TEAMS, ...MLB_TEAMS, ...NHL_TEAMS, ...NCAAF_TEAMS, ...NCAAB_TEAMS,
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
