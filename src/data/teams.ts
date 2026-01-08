/**
 * Unified Team Database
 *
 * 213+ teams across 6 leagues (NFL, NBA, MLB, NHL, NCAAF, NCAAB)
 * with aliases and abbreviations for market matching.
 *
 * Cross-league disambiguation handled by getTeamByAliasWithLeague()
 * 44 known conflicts: PHI (4 leagues), DET (4 leagues), MIN (4 leagues), etc.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface TeamInfo {
  fullName: string;
  city: string;
  nickname: string;
  aliases: string[];
  abbreviations: string[];
  conference?: string;
  division?: string;
}

export type LeagueTeams = Record<string, TeamInfo>;

// =============================================================================
// NFL TEAMS (32)
// =============================================================================

export const NFL_TEAMS: LeagueTeams = {
  // AFC East
  'buffalo_bills': {
    fullName: 'Buffalo Bills',
    city: 'Buffalo',
    nickname: 'Bills',
    aliases: ['bills', 'buffalo', 'buffalo bills'],
    abbreviations: ['BUF', 'BUF'],
    conference: 'AFC',
    division: 'East',
  },
  'miami_dolphins': {
    fullName: 'Miami Dolphins',
    city: 'Miami',
    nickname: 'Dolphins',
    aliases: ['dolphins', 'miami', 'miami dolphins', 'fins'],
    abbreviations: ['MIA', 'MIA'],
    conference: 'AFC',
    division: 'East',
  },
  'new_england_patriots': {
    fullName: 'New England Patriots',
    city: 'New England',
    nickname: 'Patriots',
    aliases: ['patriots', 'new england', 'new england patriots', 'pats'],
    abbreviations: ['NE', 'NE'],
    conference: 'AFC',
    division: 'East',
  },
  'new_york_jets': {
    fullName: 'New York Jets',
    city: 'New York',
    nickname: 'Jets',
    aliases: ['jets', 'ny jets', 'new york jets'],
    abbreviations: ['NYJ', 'NYJ'],
    conference: 'AFC',
    division: 'East',
  },
  // AFC North
  'baltimore_ravens': {
    fullName: 'Baltimore Ravens',
    city: 'Baltimore',
    nickname: 'Ravens',
    aliases: ['ravens', 'baltimore', 'baltimore ravens'],
    abbreviations: ['BAL', 'BAL'],
    conference: 'AFC',
    division: 'North',
  },
  'cincinnati_bengals': {
    fullName: 'Cincinnati Bengals',
    city: 'Cincinnati',
    nickname: 'Bengals',
    aliases: ['bengals', 'cincinnati', 'cincinnati bengals', 'cincy'],
    abbreviations: ['CIN', 'CIN'],
    conference: 'AFC',
    division: 'North',
  },
  'cleveland_browns': {
    fullName: 'Cleveland Browns',
    city: 'Cleveland',
    nickname: 'Browns',
    aliases: ['browns', 'cleveland', 'cleveland browns'],
    abbreviations: ['CLE', 'CLE'],
    conference: 'AFC',
    division: 'North',
  },
  'pittsburgh_steelers': {
    fullName: 'Pittsburgh Steelers',
    city: 'Pittsburgh',
    nickname: 'Steelers',
    aliases: ['steelers', 'pittsburgh', 'pittsburgh steelers'],
    abbreviations: ['PIT', 'PIT'],
    conference: 'AFC',
    division: 'North',
  },
  // AFC South
  'houston_texans': {
    fullName: 'Houston Texans',
    city: 'Houston',
    nickname: 'Texans',
    aliases: ['texans', 'houston', 'houston texans'],
    abbreviations: ['HOU', 'HOU'],
    conference: 'AFC',
    division: 'South',
  },
  'indianapolis_colts': {
    fullName: 'Indianapolis Colts',
    city: 'Indianapolis',
    nickname: 'Colts',
    aliases: ['colts', 'indianapolis', 'indianapolis colts', 'indy'],
    abbreviations: ['IND', 'IND'],
    conference: 'AFC',
    division: 'South',
  },
  'jacksonville_jaguars': {
    fullName: 'Jacksonville Jaguars',
    city: 'Jacksonville',
    nickname: 'Jaguars',
    aliases: ['jaguars', 'jacksonville', 'jacksonville jaguars', 'jags'],
    abbreviations: ['JAX', 'JAC'],
    conference: 'AFC',
    division: 'South',
  },
  'tennessee_titans': {
    fullName: 'Tennessee Titans',
    city: 'Tennessee',
    nickname: 'Titans',
    aliases: ['titans', 'tennessee', 'tennessee titans'],
    abbreviations: ['TEN', 'TEN'],
    conference: 'AFC',
    division: 'South',
  },
  // AFC West
  'denver_broncos': {
    fullName: 'Denver Broncos',
    city: 'Denver',
    nickname: 'Broncos',
    aliases: ['broncos', 'denver', 'denver broncos'],
    abbreviations: ['DEN', 'DEN'],
    conference: 'AFC',
    division: 'West',
  },
  'kansas_city_chiefs': {
    fullName: 'Kansas City Chiefs',
    city: 'Kansas City',
    nickname: 'Chiefs',
    aliases: ['chiefs', 'kansas city', 'kansas city chiefs', 'kc'],
    abbreviations: ['KC', 'KC'],
    conference: 'AFC',
    division: 'West',
  },
  'las_vegas_raiders': {
    fullName: 'Las Vegas Raiders',
    city: 'Las Vegas',
    nickname: 'Raiders',
    aliases: ['raiders', 'las vegas', 'las vegas raiders', 'lv raiders'],
    abbreviations: ['LV', 'LVR'],
    conference: 'AFC',
    division: 'West',
  },
  'los_angeles_chargers': {
    fullName: 'Los Angeles Chargers',
    city: 'Los Angeles',
    nickname: 'Chargers',
    aliases: ['chargers', 'la chargers', 'los angeles chargers'],
    abbreviations: ['LAC', 'LAC'],
    conference: 'AFC',
    division: 'West',
  },
  // NFC East
  'dallas_cowboys': {
    fullName: 'Dallas Cowboys',
    city: 'Dallas',
    nickname: 'Cowboys',
    aliases: ['cowboys', 'dallas', 'dallas cowboys'],
    abbreviations: ['DAL', 'DAL'],
    conference: 'NFC',
    division: 'East',
  },
  'new_york_giants': {
    fullName: 'New York Giants',
    city: 'New York',
    nickname: 'Giants',
    aliases: ['giants', 'ny giants', 'new york giants'],
    abbreviations: ['NYG', 'NYG'],
    conference: 'NFC',
    division: 'East',
  },
  'philadelphia_eagles': {
    fullName: 'Philadelphia Eagles',
    city: 'Philadelphia',
    nickname: 'Eagles',
    aliases: ['eagles', 'philadelphia', 'philadelphia eagles', 'philly'],
    abbreviations: ['PHI', 'PHI'],
    conference: 'NFC',
    division: 'East',
  },
  'washington_commanders': {
    fullName: 'Washington Commanders',
    city: 'Washington',
    nickname: 'Commanders',
    aliases: ['commanders', 'washington', 'washington commanders', 'wash'],
    abbreviations: ['WAS', 'WSH'],
    conference: 'NFC',
    division: 'East',
  },
  // NFC North
  'chicago_bears': {
    fullName: 'Chicago Bears',
    city: 'Chicago',
    nickname: 'Bears',
    aliases: ['bears', 'chicago', 'chicago bears'],
    abbreviations: ['CHI', 'CHI'],
    conference: 'NFC',
    division: 'North',
  },
  'detroit_lions': {
    fullName: 'Detroit Lions',
    city: 'Detroit',
    nickname: 'Lions',
    aliases: ['lions', 'detroit', 'detroit lions'],
    abbreviations: ['DET', 'DET'],
    conference: 'NFC',
    division: 'North',
  },
  'green_bay_packers': {
    fullName: 'Green Bay Packers',
    city: 'Green Bay',
    nickname: 'Packers',
    aliases: ['packers', 'green bay', 'green bay packers', 'gb'],
    abbreviations: ['GB', 'GB'],
    conference: 'NFC',
    division: 'North',
  },
  'minnesota_vikings': {
    fullName: 'Minnesota Vikings',
    city: 'Minnesota',
    nickname: 'Vikings',
    aliases: ['vikings', 'minnesota', 'minnesota vikings'],
    abbreviations: ['MIN', 'MIN'],
    conference: 'NFC',
    division: 'North',
  },
  // NFC South
  'atlanta_falcons': {
    fullName: 'Atlanta Falcons',
    city: 'Atlanta',
    nickname: 'Falcons',
    aliases: ['falcons', 'atlanta', 'atlanta falcons'],
    abbreviations: ['ATL', 'ATL'],
    conference: 'NFC',
    division: 'South',
  },
  'carolina_panthers': {
    fullName: 'Carolina Panthers',
    city: 'Carolina',
    nickname: 'Panthers',
    aliases: ['panthers', 'carolina', 'carolina panthers'],
    abbreviations: ['CAR', 'CAR'],
    conference: 'NFC',
    division: 'South',
  },
  'new_orleans_saints': {
    fullName: 'New Orleans Saints',
    city: 'New Orleans',
    nickname: 'Saints',
    aliases: ['saints', 'new orleans', 'new orleans saints', 'nola'],
    abbreviations: ['NO', 'NO'],
    conference: 'NFC',
    division: 'South',
  },
  'tampa_bay_buccaneers': {
    fullName: 'Tampa Bay Buccaneers',
    city: 'Tampa Bay',
    nickname: 'Buccaneers',
    aliases: ['buccaneers', 'tampa bay', 'tampa bay buccaneers', 'bucs', 'tampa'],
    abbreviations: ['TB', 'TB'],
    conference: 'NFC',
    division: 'South',
  },
  // NFC West
  'arizona_cardinals': {
    fullName: 'Arizona Cardinals',
    city: 'Arizona',
    nickname: 'Cardinals',
    aliases: ['cardinals', 'arizona', 'arizona cardinals', 'cards'],
    abbreviations: ['ARI', 'AZ'],
    conference: 'NFC',
    division: 'West',
  },
  'los_angeles_rams': {
    fullName: 'Los Angeles Rams',
    city: 'Los Angeles',
    nickname: 'Rams',
    aliases: ['rams', 'la rams', 'los angeles rams'],
    abbreviations: ['LAR', 'LA'],
    conference: 'NFC',
    division: 'West',
  },
  'san_francisco_49ers': {
    fullName: 'San Francisco 49ers',
    city: 'San Francisco',
    nickname: '49ers',
    aliases: ['49ers', 'niners', 'san francisco', 'san francisco 49ers', 'sf'],
    abbreviations: ['SF', 'SF'],
    conference: 'NFC',
    division: 'West',
  },
  'seattle_seahawks': {
    fullName: 'Seattle Seahawks',
    city: 'Seattle',
    nickname: 'Seahawks',
    aliases: ['seahawks', 'seattle', 'seattle seahawks', 'hawks'],
    abbreviations: ['SEA', 'SEA'],
    conference: 'NFC',
    division: 'West',
  },
};

// =============================================================================
// NBA TEAMS (30)
// =============================================================================

export const NBA_TEAMS: LeagueTeams = {
  // Atlantic
  'boston_celtics': {
    fullName: 'Boston Celtics',
    city: 'Boston',
    nickname: 'Celtics',
    aliases: ['celtics', 'boston', 'boston celtics'],
    abbreviations: ['BOS', 'BOS'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'brooklyn_nets': {
    fullName: 'Brooklyn Nets',
    city: 'Brooklyn',
    nickname: 'Nets',
    aliases: ['nets', 'brooklyn', 'brooklyn nets'],
    abbreviations: ['BKN', 'BK'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'new_york_knicks': {
    fullName: 'New York Knicks',
    city: 'New York',
    nickname: 'Knicks',
    aliases: ['knicks', 'ny knicks', 'new york knicks'],
    abbreviations: ['NYK', 'NY'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'philadelphia_76ers': {
    fullName: 'Philadelphia 76ers',
    city: 'Philadelphia',
    nickname: '76ers',
    aliases: ['76ers', 'sixers', 'philadelphia', 'philadelphia 76ers', 'philly'],
    abbreviations: ['PHI', 'PHI'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'toronto_raptors': {
    fullName: 'Toronto Raptors',
    city: 'Toronto',
    nickname: 'Raptors',
    aliases: ['raptors', 'toronto', 'toronto raptors'],
    abbreviations: ['TOR', 'TOR'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  // Central
  'chicago_bulls': {
    fullName: 'Chicago Bulls',
    city: 'Chicago',
    nickname: 'Bulls',
    aliases: ['bulls', 'chicago bulls'],
    abbreviations: ['CHI', 'CHI'],
    conference: 'Eastern',
    division: 'Central',
  },
  'cleveland_cavaliers': {
    fullName: 'Cleveland Cavaliers',
    city: 'Cleveland',
    nickname: 'Cavaliers',
    aliases: ['cavaliers', 'cavs', 'cleveland', 'cleveland cavaliers'],
    abbreviations: ['CLE', 'CLE'],
    conference: 'Eastern',
    division: 'Central',
  },
  'detroit_pistons': {
    fullName: 'Detroit Pistons',
    city: 'Detroit',
    nickname: 'Pistons',
    aliases: ['pistons', 'detroit pistons'],
    abbreviations: ['DET', 'DET'],
    conference: 'Eastern',
    division: 'Central',
  },
  'indiana_pacers': {
    fullName: 'Indiana Pacers',
    city: 'Indiana',
    nickname: 'Pacers',
    aliases: ['pacers', 'indiana', 'indiana pacers'],
    abbreviations: ['IND', 'IND'],
    conference: 'Eastern',
    division: 'Central',
  },
  'milwaukee_bucks': {
    fullName: 'Milwaukee Bucks',
    city: 'Milwaukee',
    nickname: 'Bucks',
    aliases: ['bucks', 'milwaukee', 'milwaukee bucks'],
    abbreviations: ['MIL', 'MIL'],
    conference: 'Eastern',
    division: 'Central',
  },
  // Southeast
  'atlanta_hawks': {
    fullName: 'Atlanta Hawks',
    city: 'Atlanta',
    nickname: 'Hawks',
    aliases: ['hawks', 'atlanta hawks'],
    abbreviations: ['ATL', 'ATL'],
    conference: 'Eastern',
    division: 'Southeast',
  },
  'charlotte_hornets': {
    fullName: 'Charlotte Hornets',
    city: 'Charlotte',
    nickname: 'Hornets',
    aliases: ['hornets', 'charlotte', 'charlotte hornets'],
    abbreviations: ['CHA', 'CHH'],
    conference: 'Eastern',
    division: 'Southeast',
  },
  'miami_heat': {
    fullName: 'Miami Heat',
    city: 'Miami',
    nickname: 'Heat',
    aliases: ['heat', 'miami heat'],
    abbreviations: ['MIA', 'MIA'],
    conference: 'Eastern',
    division: 'Southeast',
  },
  'orlando_magic': {
    fullName: 'Orlando Magic',
    city: 'Orlando',
    nickname: 'Magic',
    aliases: ['magic', 'orlando', 'orlando magic'],
    abbreviations: ['ORL', 'ORL'],
    conference: 'Eastern',
    division: 'Southeast',
  },
  'washington_wizards': {
    fullName: 'Washington Wizards',
    city: 'Washington',
    nickname: 'Wizards',
    aliases: ['wizards', 'washington wizards'],
    abbreviations: ['WAS', 'WSH'],
    conference: 'Eastern',
    division: 'Southeast',
  },
  // Northwest
  'denver_nuggets': {
    fullName: 'Denver Nuggets',
    city: 'Denver',
    nickname: 'Nuggets',
    aliases: ['nuggets', 'denver nuggets'],
    abbreviations: ['DEN', 'DEN'],
    conference: 'Western',
    division: 'Northwest',
  },
  'minnesota_timberwolves': {
    fullName: 'Minnesota Timberwolves',
    city: 'Minnesota',
    nickname: 'Timberwolves',
    aliases: ['timberwolves', 'wolves', 'twolves', 'minnesota timberwolves'],
    abbreviations: ['MIN', 'MIN'],
    conference: 'Western',
    division: 'Northwest',
  },
  'oklahoma_city_thunder': {
    fullName: 'Oklahoma City Thunder',
    city: 'Oklahoma City',
    nickname: 'Thunder',
    aliases: ['thunder', 'okc', 'oklahoma city', 'oklahoma city thunder'],
    abbreviations: ['OKC', 'OKC'],
    conference: 'Western',
    division: 'Northwest',
  },
  'portland_trail_blazers': {
    fullName: 'Portland Trail Blazers',
    city: 'Portland',
    nickname: 'Trail Blazers',
    aliases: ['trail blazers', 'blazers', 'portland', 'portland trail blazers'],
    abbreviations: ['POR', 'POR'],
    conference: 'Western',
    division: 'Northwest',
  },
  'utah_jazz': {
    fullName: 'Utah Jazz',
    city: 'Utah',
    nickname: 'Jazz',
    aliases: ['jazz', 'utah', 'utah jazz'],
    abbreviations: ['UTA', 'UTA'],
    conference: 'Western',
    division: 'Northwest',
  },
  // Pacific
  'golden_state_warriors': {
    fullName: 'Golden State Warriors',
    city: 'Golden State',
    nickname: 'Warriors',
    aliases: ['warriors', 'golden state', 'golden state warriors', 'gsw', 'dubs'],
    abbreviations: ['GSW', 'GS'],
    conference: 'Western',
    division: 'Pacific',
  },
  'los_angeles_clippers': {
    fullName: 'Los Angeles Clippers',
    city: 'Los Angeles',
    nickname: 'Clippers',
    aliases: ['clippers', 'la clippers', 'los angeles clippers'],
    abbreviations: ['LAC', 'LAC'],
    conference: 'Western',
    division: 'Pacific',
  },
  'los_angeles_lakers': {
    fullName: 'Los Angeles Lakers',
    city: 'Los Angeles',
    nickname: 'Lakers',
    aliases: ['lakers', 'la lakers', 'los angeles lakers'],
    abbreviations: ['LAL', 'LAL'],
    conference: 'Western',
    division: 'Pacific',
  },
  'phoenix_suns': {
    fullName: 'Phoenix Suns',
    city: 'Phoenix',
    nickname: 'Suns',
    aliases: ['suns', 'phoenix', 'phoenix suns'],
    abbreviations: ['PHX', 'PHO'],
    conference: 'Western',
    division: 'Pacific',
  },
  'sacramento_kings': {
    fullName: 'Sacramento Kings',
    city: 'Sacramento',
    nickname: 'Kings',
    aliases: ['kings', 'sacramento', 'sacramento kings'],
    abbreviations: ['SAC', 'SAC'],
    conference: 'Western',
    division: 'Pacific',
  },
  // Southwest
  'dallas_mavericks': {
    fullName: 'Dallas Mavericks',
    city: 'Dallas',
    nickname: 'Mavericks',
    aliases: ['mavericks', 'mavs', 'dallas mavericks'],
    abbreviations: ['DAL', 'DAL'],
    conference: 'Western',
    division: 'Southwest',
  },
  'houston_rockets': {
    fullName: 'Houston Rockets',
    city: 'Houston',
    nickname: 'Rockets',
    aliases: ['rockets', 'houston rockets'],
    abbreviations: ['HOU', 'HOU'],
    conference: 'Western',
    division: 'Southwest',
  },
  'memphis_grizzlies': {
    fullName: 'Memphis Grizzlies',
    city: 'Memphis',
    nickname: 'Grizzlies',
    aliases: ['grizzlies', 'grizz', 'memphis', 'memphis grizzlies'],
    abbreviations: ['MEM', 'MEM'],
    conference: 'Western',
    division: 'Southwest',
  },
  'new_orleans_pelicans': {
    fullName: 'New Orleans Pelicans',
    city: 'New Orleans',
    nickname: 'Pelicans',
    aliases: ['pelicans', 'pels', 'new orleans pelicans', 'nola'],
    abbreviations: ['NOP', 'NO'],
    conference: 'Western',
    division: 'Southwest',
  },
  'san_antonio_spurs': {
    fullName: 'San Antonio Spurs',
    city: 'San Antonio',
    nickname: 'Spurs',
    aliases: ['spurs', 'san antonio', 'san antonio spurs'],
    abbreviations: ['SAS', 'SA'],
    conference: 'Western',
    division: 'Southwest',
  },
};

// =============================================================================
// MLB TEAMS (30)
// =============================================================================

export const MLB_TEAMS: LeagueTeams = {
  // AL East
  'baltimore_orioles': {
    fullName: 'Baltimore Orioles',
    city: 'Baltimore',
    nickname: 'Orioles',
    aliases: ['orioles', 'baltimore', 'baltimore orioles', "o's"],
    abbreviations: ['BAL', 'BAL'],
    conference: 'American',
    division: 'East',
  },
  'boston_red_sox': {
    fullName: 'Boston Red Sox',
    city: 'Boston',
    nickname: 'Red Sox',
    aliases: ['red sox', 'boston red sox', 'sox'],
    abbreviations: ['BOS', 'BOS'],
    conference: 'American',
    division: 'East',
  },
  'new_york_yankees': {
    fullName: 'New York Yankees',
    city: 'New York',
    nickname: 'Yankees',
    aliases: ['yankees', 'ny yankees', 'new york yankees', 'yanks', 'bronx bombers'],
    abbreviations: ['NYY', 'NY'],
    conference: 'American',
    division: 'East',
  },
  'tampa_bay_rays': {
    fullName: 'Tampa Bay Rays',
    city: 'Tampa Bay',
    nickname: 'Rays',
    aliases: ['rays', 'tampa bay', 'tampa bay rays', 'tampa'],
    abbreviations: ['TB', 'TB'],
    conference: 'American',
    division: 'East',
  },
  'toronto_blue_jays': {
    fullName: 'Toronto Blue Jays',
    city: 'Toronto',
    nickname: 'Blue Jays',
    aliases: ['blue jays', 'jays', 'toronto', 'toronto blue jays'],
    abbreviations: ['TOR', 'TOR'],
    conference: 'American',
    division: 'East',
  },
  // AL Central
  'chicago_white_sox': {
    fullName: 'Chicago White Sox',
    city: 'Chicago',
    nickname: 'White Sox',
    aliases: ['white sox', 'chi sox', 'chicago white sox'],
    abbreviations: ['CHW', 'CWS'],
    conference: 'American',
    division: 'Central',
  },
  'cleveland_guardians': {
    fullName: 'Cleveland Guardians',
    city: 'Cleveland',
    nickname: 'Guardians',
    aliases: ['guardians', 'cleveland', 'cleveland guardians'],
    abbreviations: ['CLE', 'CLE'],
    conference: 'American',
    division: 'Central',
  },
  'detroit_tigers': {
    fullName: 'Detroit Tigers',
    city: 'Detroit',
    nickname: 'Tigers',
    aliases: ['tigers', 'detroit tigers'],
    abbreviations: ['DET', 'DET'],
    conference: 'American',
    division: 'Central',
  },
  'kansas_city_royals': {
    fullName: 'Kansas City Royals',
    city: 'Kansas City',
    nickname: 'Royals',
    aliases: ['royals', 'kansas city', 'kansas city royals', 'kc'],
    abbreviations: ['KC', 'KC'],
    conference: 'American',
    division: 'Central',
  },
  'minnesota_twins': {
    fullName: 'Minnesota Twins',
    city: 'Minnesota',
    nickname: 'Twins',
    aliases: ['twins', 'minnesota', 'minnesota twins'],
    abbreviations: ['MIN', 'MIN'],
    conference: 'American',
    division: 'Central',
  },
  // AL West
  'houston_astros': {
    fullName: 'Houston Astros',
    city: 'Houston',
    nickname: 'Astros',
    aliases: ['astros', 'houston astros', 'stros'],
    abbreviations: ['HOU', 'HOU'],
    conference: 'American',
    division: 'West',
  },
  'los_angeles_angels': {
    fullName: 'Los Angeles Angels',
    city: 'Los Angeles',
    nickname: 'Angels',
    aliases: ['angels', 'la angels', 'los angeles angels', 'anaheim'],
    abbreviations: ['LAA', 'ANA'],
    conference: 'American',
    division: 'West',
  },
  'oakland_athletics': {
    fullName: 'Oakland Athletics',
    city: 'Oakland',
    nickname: 'Athletics',
    aliases: ['athletics', "a's", 'oakland', 'oakland athletics'],
    abbreviations: ['OAK', 'OAK'],
    conference: 'American',
    division: 'West',
  },
  'seattle_mariners': {
    fullName: 'Seattle Mariners',
    city: 'Seattle',
    nickname: 'Mariners',
    aliases: ['mariners', 'seattle', 'seattle mariners', 'ms'],
    abbreviations: ['SEA', 'SEA'],
    conference: 'American',
    division: 'West',
  },
  'texas_rangers': {
    fullName: 'Texas Rangers',
    city: 'Texas',
    nickname: 'Rangers',
    aliases: ['rangers', 'texas', 'texas rangers'],
    abbreviations: ['TEX', 'TEX'],
    conference: 'American',
    division: 'West',
  },
  // NL East
  'atlanta_braves': {
    fullName: 'Atlanta Braves',
    city: 'Atlanta',
    nickname: 'Braves',
    aliases: ['braves', 'atlanta braves'],
    abbreviations: ['ATL', 'ATL'],
    conference: 'National',
    division: 'East',
  },
  'miami_marlins': {
    fullName: 'Miami Marlins',
    city: 'Miami',
    nickname: 'Marlins',
    aliases: ['marlins', 'miami marlins', 'fish'],
    abbreviations: ['MIA', 'MIA'],
    conference: 'National',
    division: 'East',
  },
  'new_york_mets': {
    fullName: 'New York Mets',
    city: 'New York',
    nickname: 'Mets',
    aliases: ['mets', 'ny mets', 'new york mets'],
    abbreviations: ['NYM', 'NYM'],
    conference: 'National',
    division: 'East',
  },
  'philadelphia_phillies': {
    fullName: 'Philadelphia Phillies',
    city: 'Philadelphia',
    nickname: 'Phillies',
    aliases: ['phillies', 'philadelphia', 'philadelphia phillies', 'phils'],
    abbreviations: ['PHI', 'PHI'],
    conference: 'National',
    division: 'East',
  },
  'washington_nationals': {
    fullName: 'Washington Nationals',
    city: 'Washington',
    nickname: 'Nationals',
    aliases: ['nationals', 'nats', 'washington nationals'],
    abbreviations: ['WAS', 'WSH'],
    conference: 'National',
    division: 'East',
  },
  // NL Central
  'chicago_cubs': {
    fullName: 'Chicago Cubs',
    city: 'Chicago',
    nickname: 'Cubs',
    aliases: ['cubs', 'chicago cubs', 'cubbies'],
    abbreviations: ['CHC', 'CHC'],
    conference: 'National',
    division: 'Central',
  },
  'cincinnati_reds': {
    fullName: 'Cincinnati Reds',
    city: 'Cincinnati',
    nickname: 'Reds',
    aliases: ['reds', 'cincinnati', 'cincinnati reds', 'cincy'],
    abbreviations: ['CIN', 'CIN'],
    conference: 'National',
    division: 'Central',
  },
  'milwaukee_brewers': {
    fullName: 'Milwaukee Brewers',
    city: 'Milwaukee',
    nickname: 'Brewers',
    aliases: ['brewers', 'milwaukee', 'milwaukee brewers', 'brew crew'],
    abbreviations: ['MIL', 'MIL'],
    conference: 'National',
    division: 'Central',
  },
  'pittsburgh_pirates': {
    fullName: 'Pittsburgh Pirates',
    city: 'Pittsburgh',
    nickname: 'Pirates',
    aliases: ['pirates', 'pittsburgh pirates', 'bucs'],
    abbreviations: ['PIT', 'PIT'],
    conference: 'National',
    division: 'Central',
  },
  'st_louis_cardinals': {
    fullName: 'St. Louis Cardinals',
    city: 'St. Louis',
    nickname: 'Cardinals',
    aliases: ['cardinals', 'cards', 'st louis', 'st louis cardinals', 'redbirds'],
    abbreviations: ['STL', 'STL'],
    conference: 'National',
    division: 'Central',
  },
  // NL West
  'arizona_diamondbacks': {
    fullName: 'Arizona Diamondbacks',
    city: 'Arizona',
    nickname: 'Diamondbacks',
    aliases: ['diamondbacks', 'dbacks', 'arizona', 'arizona diamondbacks', 'snakes'],
    abbreviations: ['ARI', 'AZ'],
    conference: 'National',
    division: 'West',
  },
  'colorado_rockies': {
    fullName: 'Colorado Rockies',
    city: 'Colorado',
    nickname: 'Rockies',
    aliases: ['rockies', 'colorado', 'colorado rockies'],
    abbreviations: ['COL', 'COL'],
    conference: 'National',
    division: 'West',
  },
  'los_angeles_dodgers': {
    fullName: 'Los Angeles Dodgers',
    city: 'Los Angeles',
    nickname: 'Dodgers',
    aliases: ['dodgers', 'la dodgers', 'los angeles dodgers'],
    abbreviations: ['LAD', 'LA'],
    conference: 'National',
    division: 'West',
  },
  'san_diego_padres': {
    fullName: 'San Diego Padres',
    city: 'San Diego',
    nickname: 'Padres',
    aliases: ['padres', 'san diego', 'san diego padres', 'friars'],
    abbreviations: ['SD', 'SD'],
    conference: 'National',
    division: 'West',
  },
  'san_francisco_giants': {
    fullName: 'San Francisco Giants',
    city: 'San Francisco',
    nickname: 'Giants',
    aliases: ['giants', 'sf giants', 'san francisco giants'],
    abbreviations: ['SF', 'SF'],
    conference: 'National',
    division: 'West',
  },
};

// =============================================================================
// NHL TEAMS (32)
// =============================================================================

export const NHL_TEAMS: LeagueTeams = {
  // Atlantic
  'boston_bruins': {
    fullName: 'Boston Bruins',
    city: 'Boston',
    nickname: 'Bruins',
    aliases: ['bruins', 'boston bruins'],
    abbreviations: ['BOS', 'BOS'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'buffalo_sabres': {
    fullName: 'Buffalo Sabres',
    city: 'Buffalo',
    nickname: 'Sabres',
    aliases: ['sabres', 'buffalo', 'buffalo sabres'],
    abbreviations: ['BUF', 'BUF'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'detroit_red_wings': {
    fullName: 'Detroit Red Wings',
    city: 'Detroit',
    nickname: 'Red Wings',
    aliases: ['red wings', 'wings', 'detroit red wings'],
    abbreviations: ['DET', 'DET'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'florida_panthers': {
    fullName: 'Florida Panthers',
    city: 'Florida',
    nickname: 'Panthers',
    aliases: ['panthers', 'florida panthers', 'cats'],
    abbreviations: ['FLA', 'FLA'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'montreal_canadiens': {
    fullName: 'Montreal Canadiens',
    city: 'Montreal',
    nickname: 'Canadiens',
    aliases: ['canadiens', 'habs', 'montreal', 'montreal canadiens'],
    abbreviations: ['MTL', 'MON'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'ottawa_senators': {
    fullName: 'Ottawa Senators',
    city: 'Ottawa',
    nickname: 'Senators',
    aliases: ['senators', 'sens', 'ottawa', 'ottawa senators'],
    abbreviations: ['OTT', 'OTT'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'tampa_bay_lightning': {
    fullName: 'Tampa Bay Lightning',
    city: 'Tampa Bay',
    nickname: 'Lightning',
    aliases: ['lightning', 'bolts', 'tampa bay lightning', 'tampa'],
    abbreviations: ['TB', 'TBL'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  'toronto_maple_leafs': {
    fullName: 'Toronto Maple Leafs',
    city: 'Toronto',
    nickname: 'Maple Leafs',
    aliases: ['maple leafs', 'leafs', 'toronto', 'toronto maple leafs'],
    abbreviations: ['TOR', 'TOR'],
    conference: 'Eastern',
    division: 'Atlantic',
  },
  // Metropolitan
  'carolina_hurricanes': {
    fullName: 'Carolina Hurricanes',
    city: 'Carolina',
    nickname: 'Hurricanes',
    aliases: ['hurricanes', 'canes', 'carolina', 'carolina hurricanes'],
    abbreviations: ['CAR', 'CAR'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'columbus_blue_jackets': {
    fullName: 'Columbus Blue Jackets',
    city: 'Columbus',
    nickname: 'Blue Jackets',
    aliases: ['blue jackets', 'jackets', 'columbus', 'columbus blue jackets', 'cbj'],
    abbreviations: ['CBJ', 'CLB'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'new_jersey_devils': {
    fullName: 'New Jersey Devils',
    city: 'New Jersey',
    nickname: 'Devils',
    aliases: ['devils', 'nj devils', 'new jersey devils'],
    abbreviations: ['NJ', 'NJD'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'new_york_islanders': {
    fullName: 'New York Islanders',
    city: 'New York',
    nickname: 'Islanders',
    aliases: ['islanders', 'isles', 'ny islanders', 'new york islanders'],
    abbreviations: ['NYI', 'NYI'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'new_york_rangers': {
    fullName: 'New York Rangers',
    city: 'New York',
    nickname: 'Rangers',
    aliases: ['rangers', 'ny rangers', 'new york rangers', 'blueshirts'],
    abbreviations: ['NYR', 'NYR'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'philadelphia_flyers': {
    fullName: 'Philadelphia Flyers',
    city: 'Philadelphia',
    nickname: 'Flyers',
    aliases: ['flyers', 'philadelphia', 'philadelphia flyers', 'philly'],
    abbreviations: ['PHI', 'PHI'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'pittsburgh_penguins': {
    fullName: 'Pittsburgh Penguins',
    city: 'Pittsburgh',
    nickname: 'Penguins',
    aliases: ['penguins', 'pens', 'pittsburgh', 'pittsburgh penguins'],
    abbreviations: ['PIT', 'PIT'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  'washington_capitals': {
    fullName: 'Washington Capitals',
    city: 'Washington',
    nickname: 'Capitals',
    aliases: ['capitals', 'caps', 'washington capitals'],
    abbreviations: ['WAS', 'WSH'],
    conference: 'Eastern',
    division: 'Metropolitan',
  },
  // Central
  'arizona_coyotes': {
    fullName: 'Arizona Coyotes',
    city: 'Arizona',
    nickname: 'Coyotes',
    aliases: ['coyotes', 'yotes', 'arizona', 'arizona coyotes'],
    abbreviations: ['ARI', 'AZ'],
    conference: 'Western',
    division: 'Central',
  },
  'chicago_blackhawks': {
    fullName: 'Chicago Blackhawks',
    city: 'Chicago',
    nickname: 'Blackhawks',
    aliases: ['blackhawks', 'hawks', 'chicago blackhawks'],
    abbreviations: ['CHI', 'CHI'],
    conference: 'Western',
    division: 'Central',
  },
  'colorado_avalanche': {
    fullName: 'Colorado Avalanche',
    city: 'Colorado',
    nickname: 'Avalanche',
    aliases: ['avalanche', 'avs', 'colorado', 'colorado avalanche'],
    abbreviations: ['COL', 'COL'],
    conference: 'Western',
    division: 'Central',
  },
  'dallas_stars': {
    fullName: 'Dallas Stars',
    city: 'Dallas',
    nickname: 'Stars',
    aliases: ['stars', 'dallas', 'dallas stars'],
    abbreviations: ['DAL', 'DAL'],
    conference: 'Western',
    division: 'Central',
  },
  'minnesota_wild': {
    fullName: 'Minnesota Wild',
    city: 'Minnesota',
    nickname: 'Wild',
    aliases: ['wild', 'minnesota wild'],
    abbreviations: ['MIN', 'MIN'],
    conference: 'Western',
    division: 'Central',
  },
  'nashville_predators': {
    fullName: 'Nashville Predators',
    city: 'Nashville',
    nickname: 'Predators',
    aliases: ['predators', 'preds', 'nashville', 'nashville predators'],
    abbreviations: ['NSH', 'NSH'],
    conference: 'Western',
    division: 'Central',
  },
  'st_louis_blues': {
    fullName: 'St. Louis Blues',
    city: 'St. Louis',
    nickname: 'Blues',
    aliases: ['blues', 'st louis', 'st louis blues'],
    abbreviations: ['STL', 'STL'],
    conference: 'Western',
    division: 'Central',
  },
  'winnipeg_jets': {
    fullName: 'Winnipeg Jets',
    city: 'Winnipeg',
    nickname: 'Jets',
    aliases: ['jets', 'winnipeg', 'winnipeg jets'],
    abbreviations: ['WPG', 'WPG'],
    conference: 'Western',
    division: 'Central',
  },
  // Pacific
  'anaheim_ducks': {
    fullName: 'Anaheim Ducks',
    city: 'Anaheim',
    nickname: 'Ducks',
    aliases: ['ducks', 'anaheim', 'anaheim ducks'],
    abbreviations: ['ANA', 'ANA'],
    conference: 'Western',
    division: 'Pacific',
  },
  'calgary_flames': {
    fullName: 'Calgary Flames',
    city: 'Calgary',
    nickname: 'Flames',
    aliases: ['flames', 'calgary', 'calgary flames'],
    abbreviations: ['CGY', 'CAL'],
    conference: 'Western',
    division: 'Pacific',
  },
  'edmonton_oilers': {
    fullName: 'Edmonton Oilers',
    city: 'Edmonton',
    nickname: 'Oilers',
    aliases: ['oilers', 'edmonton', 'edmonton oilers'],
    abbreviations: ['EDM', 'EDM'],
    conference: 'Western',
    division: 'Pacific',
  },
  'los_angeles_kings': {
    fullName: 'Los Angeles Kings',
    city: 'Los Angeles',
    nickname: 'Kings',
    aliases: ['kings', 'la kings', 'los angeles kings'],
    abbreviations: ['LAK', 'LA'],
    conference: 'Western',
    division: 'Pacific',
  },
  'san_jose_sharks': {
    fullName: 'San Jose Sharks',
    city: 'San Jose',
    nickname: 'Sharks',
    aliases: ['sharks', 'san jose', 'san jose sharks'],
    abbreviations: ['SJ', 'SJS'],
    conference: 'Western',
    division: 'Pacific',
  },
  'seattle_kraken': {
    fullName: 'Seattle Kraken',
    city: 'Seattle',
    nickname: 'Kraken',
    aliases: ['kraken', 'seattle kraken'],
    abbreviations: ['SEA', 'SEA'],
    conference: 'Western',
    division: 'Pacific',
  },
  'vancouver_canucks': {
    fullName: 'Vancouver Canucks',
    city: 'Vancouver',
    nickname: 'Canucks',
    aliases: ['canucks', 'nucks', 'vancouver', 'vancouver canucks'],
    abbreviations: ['VAN', 'VAN'],
    conference: 'Western',
    division: 'Pacific',
  },
  'vegas_golden_knights': {
    fullName: 'Vegas Golden Knights',
    city: 'Las Vegas',
    nickname: 'Golden Knights',
    aliases: ['golden knights', 'knights', 'vegas', 'vegas golden knights', 'vgk'],
    abbreviations: ['VGK', 'VGK'],
    conference: 'Western',
    division: 'Pacific',
  },
};

// =============================================================================
// NCAAF TEAMS (Top 50 FBS)
// =============================================================================

export const NCAAF_TEAMS: LeagueTeams = {
  // SEC
  'alabama_crimson_tide': {
    fullName: 'Alabama Crimson Tide',
    city: 'Tuscaloosa',
    nickname: 'Crimson Tide',
    aliases: ['alabama', 'crimson tide', 'bama', 'tide'],
    abbreviations: ['ALA', 'BAMA'],
    conference: 'SEC',
  },
  'georgia_bulldogs': {
    fullName: 'Georgia Bulldogs',
    city: 'Athens',
    nickname: 'Bulldogs',
    aliases: ['georgia', 'bulldogs', 'dawgs', 'uga'],
    abbreviations: ['UGA', 'GA'],
    conference: 'SEC',
  },
  'lsu_tigers': {
    fullName: 'LSU Tigers',
    city: 'Baton Rouge',
    nickname: 'Tigers',
    aliases: ['lsu', 'tigers', 'bayou bengals'],
    abbreviations: ['LSU', 'LSU'],
    conference: 'SEC',
  },
  'tennessee_volunteers': {
    fullName: 'Tennessee Volunteers',
    city: 'Knoxville',
    nickname: 'Volunteers',
    aliases: ['tennessee', 'volunteers', 'vols'],
    abbreviations: ['TENN', 'TN'],
    conference: 'SEC',
  },
  'texas_am_aggies': {
    fullName: 'Texas A&M Aggies',
    city: 'College Station',
    nickname: 'Aggies',
    aliases: ['texas a&m', 'aggies', 'tamu'],
    abbreviations: ['TAMU', 'ATM'],
    conference: 'SEC',
  },
  'florida_gators': {
    fullName: 'Florida Gators',
    city: 'Gainesville',
    nickname: 'Gators',
    aliases: ['florida', 'gators', 'uf'],
    abbreviations: ['FLA', 'UF'],
    conference: 'SEC',
  },
  'auburn_tigers': {
    fullName: 'Auburn Tigers',
    city: 'Auburn',
    nickname: 'Tigers',
    aliases: ['auburn', 'tigers', 'war eagle'],
    abbreviations: ['AUB', 'AUB'],
    conference: 'SEC',
  },
  'ole_miss_rebels': {
    fullName: 'Ole Miss Rebels',
    city: 'Oxford',
    nickname: 'Rebels',
    aliases: ['ole miss', 'rebels', 'mississippi'],
    abbreviations: ['MISS', 'OM'],
    conference: 'SEC',
  },
  'mississippi_state_bulldogs': {
    fullName: 'Mississippi State Bulldogs',
    city: 'Starkville',
    nickname: 'Bulldogs',
    aliases: ['mississippi state', 'bulldogs', 'miss st', 'hail state'],
    abbreviations: ['MSST', 'MSU'],
    conference: 'SEC',
  },
  'arkansas_razorbacks': {
    fullName: 'Arkansas Razorbacks',
    city: 'Fayetteville',
    nickname: 'Razorbacks',
    aliases: ['arkansas', 'razorbacks', 'hogs'],
    abbreviations: ['ARK', 'ARK'],
    conference: 'SEC',
  },
  'kentucky_wildcats': {
    fullName: 'Kentucky Wildcats',
    city: 'Lexington',
    nickname: 'Wildcats',
    aliases: ['kentucky', 'wildcats', 'uk'],
    abbreviations: ['UK', 'KY'],
    conference: 'SEC',
  },
  'south_carolina_gamecocks': {
    fullName: 'South Carolina Gamecocks',
    city: 'Columbia',
    nickname: 'Gamecocks',
    aliases: ['south carolina', 'gamecocks', 'cocks'],
    abbreviations: ['SCAR', 'SC'],
    conference: 'SEC',
  },
  'missouri_tigers': {
    fullName: 'Missouri Tigers',
    city: 'Columbia',
    nickname: 'Tigers',
    aliases: ['missouri', 'tigers', 'mizzou'],
    abbreviations: ['MIZ', 'MO'],
    conference: 'SEC',
  },
  'vanderbilt_commodores': {
    fullName: 'Vanderbilt Commodores',
    city: 'Nashville',
    nickname: 'Commodores',
    aliases: ['vanderbilt', 'commodores', 'vandy', 'dores'],
    abbreviations: ['VAN', 'VANDY'],
    conference: 'SEC',
  },
  // Big Ten
  'michigan_wolverines': {
    fullName: 'Michigan Wolverines',
    city: 'Ann Arbor',
    nickname: 'Wolverines',
    aliases: ['michigan', 'wolverines', 'maize and blue'],
    abbreviations: ['MICH', 'UM'],
    conference: 'Big Ten',
  },
  'ohio_state_buckeyes': {
    fullName: 'Ohio State Buckeyes',
    city: 'Columbus',
    nickname: 'Buckeyes',
    aliases: ['ohio state', 'buckeyes', 'osu', 'bucks'],
    abbreviations: ['OSU', 'OHST'],
    conference: 'Big Ten',
  },
  'penn_state_nittany_lions': {
    fullName: 'Penn State Nittany Lions',
    city: 'State College',
    nickname: 'Nittany Lions',
    aliases: ['penn state', 'nittany lions', 'psu', 'happy valley'],
    abbreviations: ['PSU', 'PSU'],
    conference: 'Big Ten',
  },
  'wisconsin_badgers': {
    fullName: 'Wisconsin Badgers',
    city: 'Madison',
    nickname: 'Badgers',
    aliases: ['wisconsin', 'badgers', 'wisc'],
    abbreviations: ['WIS', 'WISC'],
    conference: 'Big Ten',
  },
  'iowa_hawkeyes': {
    fullName: 'Iowa Hawkeyes',
    city: 'Iowa City',
    nickname: 'Hawkeyes',
    aliases: ['iowa', 'hawkeyes', 'hawks'],
    abbreviations: ['IOWA', 'IA'],
    conference: 'Big Ten',
  },
  'oregon_ducks': {
    fullName: 'Oregon Ducks',
    city: 'Eugene',
    nickname: 'Ducks',
    aliases: ['oregon', 'ducks', 'uo'],
    abbreviations: ['ORE', 'UO'],
    conference: 'Big Ten',
  },
  'usc_trojans': {
    fullName: 'USC Trojans',
    city: 'Los Angeles',
    nickname: 'Trojans',
    aliases: ['usc', 'trojans', 'southern cal'],
    abbreviations: ['USC', 'USC'],
    conference: 'Big Ten',
  },
  'ucla_bruins': {
    fullName: 'UCLA Bruins',
    city: 'Los Angeles',
    nickname: 'Bruins',
    aliases: ['ucla', 'bruins'],
    abbreviations: ['UCLA', 'UCLA'],
    conference: 'Big Ten',
  },
  'washington_huskies': {
    fullName: 'Washington Huskies',
    city: 'Seattle',
    nickname: 'Huskies',
    aliases: ['washington', 'huskies', 'udub'],
    abbreviations: ['WASH', 'UW'],
    conference: 'Big Ten',
  },
  // Big 12 (2024+ alignment)
  'texas_longhorns': {
    fullName: 'Texas Longhorns',
    city: 'Austin',
    nickname: 'Longhorns',
    aliases: ['texas', 'longhorns', 'horns', 'ut'],
    abbreviations: ['TEX', 'UT'],
    conference: 'SEC',
  },
  'oklahoma_sooners': {
    fullName: 'Oklahoma Sooners',
    city: 'Norman',
    nickname: 'Sooners',
    aliases: ['oklahoma', 'sooners', 'ou', 'boomer'],
    abbreviations: ['OU', 'OKLA'],
    conference: 'SEC',
  },
  'byu_cougars': {
    fullName: 'BYU Cougars',
    city: 'Provo',
    nickname: 'Cougars',
    aliases: ['byu', 'cougars', 'brigham young'],
    abbreviations: ['BYU', 'BYU'],
    conference: 'Big 12',
  },
  'ucf_knights': {
    fullName: 'UCF Knights',
    city: 'Orlando',
    nickname: 'Knights',
    aliases: ['ucf', 'knights', 'central florida'],
    abbreviations: ['UCF', 'UCF'],
    conference: 'Big 12',
  },
  'cincinnati_bearcats': {
    fullName: 'Cincinnati Bearcats',
    city: 'Cincinnati',
    nickname: 'Bearcats',
    aliases: ['cincinnati', 'bearcats', 'cincy', 'uc'],
    abbreviations: ['CIN', 'UC'],
    conference: 'Big 12',
  },
  'houston_cougars': {
    fullName: 'Houston Cougars',
    city: 'Houston',
    nickname: 'Cougars',
    aliases: ['houston', 'cougars', 'coogs', 'uh'],
    abbreviations: ['HOU', 'UH'],
    conference: 'Big 12',
  },
  'colorado_buffaloes': {
    fullName: 'Colorado Buffaloes',
    city: 'Boulder',
    nickname: 'Buffaloes',
    aliases: ['colorado', 'buffaloes', 'buffs', 'cu'],
    abbreviations: ['COL', 'CU'],
    conference: 'Big 12',
  },
  'arizona_wildcats': {
    fullName: 'Arizona Wildcats',
    city: 'Tucson',
    nickname: 'Wildcats',
    aliases: ['arizona', 'wildcats', 'cats', 'zona'],
    abbreviations: ['ARIZ', 'UA'],
    conference: 'Big 12',
  },
  'arizona_state_sun_devils': {
    fullName: 'Arizona State Sun Devils',
    city: 'Tempe',
    nickname: 'Sun Devils',
    aliases: ['arizona state', 'sun devils', 'asu'],
    abbreviations: ['ASU', 'ASU'],
    conference: 'Big 12',
  },
  'utah_utes': {
    fullName: 'Utah Utes',
    city: 'Salt Lake City',
    nickname: 'Utes',
    aliases: ['utah', 'utes'],
    abbreviations: ['UTAH', 'UU'],
    conference: 'Big 12',
  },
  // ACC
  'clemson_tigers': {
    fullName: 'Clemson Tigers',
    city: 'Clemson',
    nickname: 'Tigers',
    aliases: ['clemson', 'tigers'],
    abbreviations: ['CLEM', 'CU'],
    conference: 'ACC',
  },
  'florida_state_seminoles': {
    fullName: 'Florida State Seminoles',
    city: 'Tallahassee',
    nickname: 'Seminoles',
    aliases: ['florida state', 'seminoles', 'fsu', 'noles'],
    abbreviations: ['FSU', 'FSU'],
    conference: 'ACC',
  },
  'miami_hurricanes': {
    fullName: 'Miami Hurricanes',
    city: 'Miami',
    nickname: 'Hurricanes',
    aliases: ['miami', 'hurricanes', 'canes', 'the u'],
    abbreviations: ['MIA', 'UM'],
    conference: 'ACC',
  },
  'north_carolina_tar_heels': {
    fullName: 'North Carolina Tar Heels',
    city: 'Chapel Hill',
    nickname: 'Tar Heels',
    aliases: ['north carolina', 'tar heels', 'unc', 'carolina'],
    abbreviations: ['UNC', 'NC'],
    conference: 'ACC',
  },
  'nc_state_wolfpack': {
    fullName: 'NC State Wolfpack',
    city: 'Raleigh',
    nickname: 'Wolfpack',
    aliases: ['nc state', 'wolfpack', 'ncsu', 'pack'],
    abbreviations: ['NCST', 'NCS'],
    conference: 'ACC',
  },
  'virginia_tech_hokies': {
    fullName: 'Virginia Tech Hokies',
    city: 'Blacksburg',
    nickname: 'Hokies',
    aliases: ['virginia tech', 'hokies', 'vt'],
    abbreviations: ['VT', 'VT'],
    conference: 'ACC',
  },
  'duke_blue_devils': {
    fullName: 'Duke Blue Devils',
    city: 'Durham',
    nickname: 'Blue Devils',
    aliases: ['duke', 'blue devils'],
    abbreviations: ['DUKE', 'DU'],
    conference: 'ACC',
  },
  'louisville_cardinals': {
    fullName: 'Louisville Cardinals',
    city: 'Louisville',
    nickname: 'Cardinals',
    aliases: ['louisville', 'cardinals', 'cards'],
    abbreviations: ['LOU', 'UL'],
    conference: 'ACC',
  },
  'notre_dame_fighting_irish': {
    fullName: 'Notre Dame Fighting Irish',
    city: 'South Bend',
    nickname: 'Fighting Irish',
    aliases: ['notre dame', 'fighting irish', 'irish', 'nd'],
    abbreviations: ['ND', 'ND'],
    conference: 'Independent',
  },
};

// =============================================================================
// NCAAB TEAMS (Top 50)
// =============================================================================

export const NCAAB_TEAMS: LeagueTeams = {
  // Many overlap with NCAAF, but basketball-specific aliases
  'duke_blue_devils_bball': {
    fullName: 'Duke Blue Devils',
    city: 'Durham',
    nickname: 'Blue Devils',
    aliases: ['duke', 'blue devils', 'dukies'],
    abbreviations: ['DUKE', 'DU'],
    conference: 'ACC',
  },
  'north_carolina_tar_heels_bball': {
    fullName: 'North Carolina Tar Heels',
    city: 'Chapel Hill',
    nickname: 'Tar Heels',
    aliases: ['north carolina', 'tar heels', 'unc', 'carolina'],
    abbreviations: ['UNC', 'NC'],
    conference: 'ACC',
  },
  'kansas_jayhawks': {
    fullName: 'Kansas Jayhawks',
    city: 'Lawrence',
    nickname: 'Jayhawks',
    aliases: ['kansas', 'jayhawks', 'ku', 'rock chalk'],
    abbreviations: ['KU', 'KAN'],
    conference: 'Big 12',
  },
  'kentucky_wildcats_bball': {
    fullName: 'Kentucky Wildcats',
    city: 'Lexington',
    nickname: 'Wildcats',
    aliases: ['kentucky', 'wildcats', 'uk', 'big blue nation'],
    abbreviations: ['UK', 'KY'],
    conference: 'SEC',
  },
  'gonzaga_bulldogs': {
    fullName: 'Gonzaga Bulldogs',
    city: 'Spokane',
    nickname: 'Bulldogs',
    aliases: ['gonzaga', 'bulldogs', 'zags'],
    abbreviations: ['GONZ', 'GU'],
    conference: 'WCC',
  },
  'villanova_wildcats': {
    fullName: 'Villanova Wildcats',
    city: 'Philadelphia',
    nickname: 'Wildcats',
    aliases: ['villanova', 'wildcats', 'nova'],
    abbreviations: ['VILL', 'VU'],
    conference: 'Big East',
  },
  'uconn_huskies': {
    fullName: 'UConn Huskies',
    city: 'Storrs',
    nickname: 'Huskies',
    aliases: ['uconn', 'huskies', 'connecticut'],
    abbreviations: ['CONN', 'UC'],
    conference: 'Big East',
  },
  'houston_cougars_bball': {
    fullName: 'Houston Cougars',
    city: 'Houston',
    nickname: 'Cougars',
    aliases: ['houston', 'cougars', 'coogs', 'uh'],
    abbreviations: ['HOU', 'UH'],
    conference: 'Big 12',
  },
  'purdue_boilermakers': {
    fullName: 'Purdue Boilermakers',
    city: 'West Lafayette',
    nickname: 'Boilermakers',
    aliases: ['purdue', 'boilermakers', 'boilers'],
    abbreviations: ['PUR', 'PU'],
    conference: 'Big Ten',
  },
  'alabama_crimson_tide_bball': {
    fullName: 'Alabama Crimson Tide',
    city: 'Tuscaloosa',
    nickname: 'Crimson Tide',
    aliases: ['alabama', 'crimson tide', 'bama', 'tide'],
    abbreviations: ['ALA', 'BAMA'],
    conference: 'SEC',
  },
  'tennessee_volunteers_bball': {
    fullName: 'Tennessee Volunteers',
    city: 'Knoxville',
    nickname: 'Volunteers',
    aliases: ['tennessee', 'volunteers', 'vols'],
    abbreviations: ['TENN', 'TN'],
    conference: 'SEC',
  },
  'arizona_wildcats_bball': {
    fullName: 'Arizona Wildcats',
    city: 'Tucson',
    nickname: 'Wildcats',
    aliases: ['arizona', 'wildcats', 'cats', 'zona'],
    abbreviations: ['ARIZ', 'UA'],
    conference: 'Big 12',
  },
  'creighton_bluejays': {
    fullName: 'Creighton Bluejays',
    city: 'Omaha',
    nickname: 'Bluejays',
    aliases: ['creighton', 'bluejays', 'jays'],
    abbreviations: ['CREI', 'CU'],
    conference: 'Big East',
  },
  'marquette_golden_eagles': {
    fullName: 'Marquette Golden Eagles',
    city: 'Milwaukee',
    nickname: 'Golden Eagles',
    aliases: ['marquette', 'golden eagles'],
    abbreviations: ['MARQ', 'MU'],
    conference: 'Big East',
  },
  'baylor_bears': {
    fullName: 'Baylor Bears',
    city: 'Waco',
    nickname: 'Bears',
    aliases: ['baylor', 'bears', 'bu'],
    abbreviations: ['BAY', 'BU'],
    conference: 'Big 12',
  },
  'texas_tech_red_raiders': {
    fullName: 'Texas Tech Red Raiders',
    city: 'Lubbock',
    nickname: 'Red Raiders',
    aliases: ['texas tech', 'red raiders', 'ttu'],
    abbreviations: ['TTU', 'TT'],
    conference: 'Big 12',
  },
  'iowa_state_cyclones': {
    fullName: 'Iowa State Cyclones',
    city: 'Ames',
    nickname: 'Cyclones',
    aliases: ['iowa state', 'cyclones', 'isu'],
    abbreviations: ['ISU', 'IAST'],
    conference: 'Big 12',
  },
  'michigan_state_spartans': {
    fullName: 'Michigan State Spartans',
    city: 'East Lansing',
    nickname: 'Spartans',
    aliases: ['michigan state', 'spartans', 'msu', 'sparty'],
    abbreviations: ['MSU', 'MIST'],
    conference: 'Big Ten',
  },
  'san_diego_state_aztecs': {
    fullName: 'San Diego State Aztecs',
    city: 'San Diego',
    nickname: 'Aztecs',
    aliases: ['san diego state', 'aztecs', 'sdsu'],
    abbreviations: ['SDSU', 'SD'],
    conference: 'Mountain West',
  },
  'auburn_tigers_bball': {
    fullName: 'Auburn Tigers',
    city: 'Auburn',
    nickname: 'Tigers',
    aliases: ['auburn', 'tigers', 'war eagle'],
    abbreviations: ['AUB', 'AUB'],
    conference: 'SEC',
  },
};

// =============================================================================
// TEAM KEY ARRAYS
// =============================================================================

export const NFL_TEAM_KEYS = Object.keys(NFL_TEAMS) as (keyof typeof NFL_TEAMS)[];
export const NBA_TEAM_KEYS = Object.keys(NBA_TEAMS) as (keyof typeof NBA_TEAMS)[];
export const MLB_TEAM_KEYS = Object.keys(MLB_TEAMS) as (keyof typeof MLB_TEAMS)[];
export const NHL_TEAM_KEYS = Object.keys(NHL_TEAMS) as (keyof typeof NHL_TEAMS)[];
export const NCAAF_TEAM_KEYS = Object.keys(NCAAF_TEAMS) as (keyof typeof NCAAF_TEAMS)[];
export const NCAAB_TEAM_KEYS = Object.keys(NCAAB_TEAMS) as (keyof typeof NCAAB_TEAMS)[];

export const ALL_SPORTS_TEAM_KEYS = [
  ...NFL_TEAM_KEYS,
  ...NBA_TEAM_KEYS,
  ...MLB_TEAM_KEYS,
  ...NHL_TEAM_KEYS,
  ...NCAAF_TEAM_KEYS,
  ...NCAAB_TEAM_KEYS,
];

// =============================================================================
// DISAMBIGUATION FUNCTIONS
// =============================================================================

/**
 * Get all teams matching an alias across all leagues
 * Used to identify cross-league conflicts (e.g., PHI = Eagles, 76ers, Phillies, Flyers)
 */
export function getAllTeamsByAlias(alias: string): { teamKey: string; league: string }[] {
  const matches: { teamKey: string; league: string }[] = [];
  const lowerAlias = alias.toLowerCase();

  const leagues: [LeagueTeams, string][] = [
    [NFL_TEAMS, 'NFL'],
    [NBA_TEAMS, 'NBA'],
    [MLB_TEAMS, 'MLB'],
    [NHL_TEAMS, 'NHL'],
    [NCAAF_TEAMS, 'NCAAF'],
    [NCAAB_TEAMS, 'NCAAB'],
  ];

  for (const [teams, league] of leagues) {
    for (const [teamKey, info] of Object.entries(teams)) {
      const allAliases = [
        ...info.aliases,
        ...info.abbreviations.map((a: string) => a.toLowerCase()),
        info.fullName.toLowerCase(),
        info.nickname.toLowerCase(),
      ];
      if (allAliases.includes(lowerAlias)) {
        matches.push({ teamKey, league });
      }
    }
  }

  return matches;
}

/**
 * Simple alias lookup - returns first matching team info
 * For backward compatibility. Use getTeamByAliasWithLeague for disambiguation.
 */
export function getTeamByAlias(alias: string): TeamInfo | null {
  const lowerAlias = alias.toLowerCase();

  const allTeams: LeagueTeams[] = [
    NFL_TEAMS,
    NBA_TEAMS,
    MLB_TEAMS,
    NHL_TEAMS,
    NCAAF_TEAMS,
    NCAAB_TEAMS,
  ];

  for (const teams of allTeams) {
    for (const info of Object.values(teams)) {
      const allAliases = [
        ...info.aliases,
        ...info.abbreviations.map((a: string) => a.toLowerCase()),
        info.fullName.toLowerCase(),
        info.nickname.toLowerCase(),
      ];
      if (allAliases.includes(lowerAlias)) {
        return info;
      }
    }
  }

  return null;
}

/**
 * Get team by alias with preferred league for disambiguation
 * Returns null if no match, or the best match considering league preference
 */
export function getTeamByAliasWithLeague(
  alias: string,
  preferredLeague?: string
): { teamKey: string; league: string; info: TeamInfo } | null {
  const matches = getAllTeamsByAlias(alias);
  if (matches.length === 0) return null;

  // If only one match, return it
  if (matches.length === 1) {
    const match = matches[0];
    const info = getTeamInfo(match.teamKey, match.league);
    if (info) return { ...match, info };
    return null;
  }

  // Prefer specified league
  if (preferredLeague) {
    const preferred = matches.find((m) => m.league === preferredLeague);
    if (preferred) {
      const info = getTeamInfo(preferred.teamKey, preferred.league);
      if (info) return { ...preferred, info };
    }
  }

  // Default to first match (usually NFL for common abbreviations)
  const first = matches[0];
  const info = getTeamInfo(first.teamKey, first.league);
  if (info) return { ...first, info };
  return null;
}

/**
 * Detect league from market title context
 */
export function detectLeagueFromContext(title: string): string | undefined {
  const lower = title.toLowerCase();

  // Explicit league mentions
  if (lower.includes('nfl') || lower.includes('football') || lower.includes('super bowl'))
    return 'NFL';
  if (lower.includes('nba') || lower.includes('basketball') || lower.includes('nba finals'))
    return 'NBA';
  if (lower.includes('mlb') || lower.includes('baseball') || lower.includes('world series'))
    return 'MLB';
  if (lower.includes('nhl') || lower.includes('hockey') || lower.includes('stanley cup'))
    return 'NHL';
  if (lower.includes('college football') || lower.includes('ncaaf') || lower.includes('cfp'))
    return 'NCAAF';
  if (
    lower.includes('college basketball') ||
    lower.includes('ncaab') ||
    lower.includes('march madness')
  )
    return 'NCAAB';

  return undefined;
}

/**
 * Smart team resolution using title context
 */
export function resolveTeamWithContext(
  alias: string,
  marketTitle: string
): { teamKey: string; league: string; info: TeamInfo } | null {
  const league = detectLeagueFromContext(marketTitle);
  return getTeamByAliasWithLeague(alias, league);
}

/**
 * Get team info by key and league
 */
function getTeamInfo(teamKey: string, league: string): TeamInfo | null {
  switch (league) {
    case 'NFL':
      return NFL_TEAMS[teamKey] || null;
    case 'NBA':
      return NBA_TEAMS[teamKey] || null;
    case 'MLB':
      return MLB_TEAMS[teamKey] || null;
    case 'NHL':
      return NHL_TEAMS[teamKey] || null;
    case 'NCAAF':
      return NCAAF_TEAMS[teamKey] || null;
    case 'NCAAB':
      return NCAAB_TEAMS[teamKey] || null;
    default:
      return null;
  }
}

/**
 * Build alias map for a specific league
 */
export function buildAliasMap(teams: LeagueTeams): Map<string, string> {
  const map = new Map<string, string>();
  for (const [teamKey, info] of Object.entries(teams)) {
    for (const alias of info.aliases) {
      map.set(alias.toLowerCase(), teamKey);
    }
    for (const abbr of info.abbreviations) {
      map.set(abbr.toLowerCase(), teamKey);
    }
    map.set(info.fullName.toLowerCase(), teamKey);
    map.set(info.nickname.toLowerCase(), teamKey);
  }
  return map;
}

/**
 * Build combined alias map across all leagues
 * Note: First league wins for conflicts (NFL > NBA > MLB > NHL > NCAAF > NCAAB)
 */
export function buildAllAliasMap(): Map<string, { teamKey: string; league: string }> {
  const map = new Map<string, { teamKey: string; league: string }>();

  const leagues: [LeagueTeams, string][] = [
    [NFL_TEAMS, 'NFL'],
    [NBA_TEAMS, 'NBA'],
    [MLB_TEAMS, 'MLB'],
    [NHL_TEAMS, 'NHL'],
    [NCAAF_TEAMS, 'NCAAF'],
    [NCAAB_TEAMS, 'NCAAB'],
  ];

  for (const [teams, league] of leagues) {
    for (const [teamKey, info] of Object.entries(teams)) {
      const allAliases = [
        ...info.aliases,
        ...info.abbreviations.map((a) => a.toLowerCase()),
        info.fullName.toLowerCase(),
        info.nickname.toLowerCase(),
      ];
      for (const alias of allAliases) {
        if (!map.has(alias)) {
          map.set(alias, { teamKey, league });
        }
      }
    }
  }

  return map;
}
