# Changelog

All notable changes to Kalshi Edge Detector are documented in this file.

## [2.4.0] - 2024-12-31

### Added - Sports & Sentiment Expansion

#### NHL Team Coverage
- Added all 32 NHL teams to entity aliases
  - Atlantic: Bruins, Sabres, Red Wings, Panthers, Canadiens, Senators, Lightning, Maple Leafs
  - Metropolitan: Hurricanes, Blue Jackets, Devils, Islanders, Rangers, Flyers, Penguins, Capitals
  - Central: Coyotes, Blackhawks, Avalanche, Stars, Wild, Predators, Blues, Jets
  - Pacific: Ducks, Flames, Oilers, Kings, Sharks, Kraken, Canucks, Golden Knights
- Added NHL tracked topic with all team keywords in config.ts

#### College Sports Coverage
- Added ~70 NCAAF teams (SEC, Big Ten, ACC, Big 12, notable independents)
  - Full conference coverage with mascots and abbreviations
  - Notre Dame, Boise State, and other independents
- Added ~50 NCAAB teams (basketball powerhouses)
  - Duke, Kentucky, Kansas, Gonzaga, Villanova, UConn
  - Big East programs: Creighton, Marquette, Xavier, Providence
  - Traditional powers: Indiana, Louisville, Memphis
- Added college_football and college_basketball tracked topics with comprehensive keywords

#### Entity Alias Expansion
- **Politicians**: Trump, Biden, Harris, Pence, DeSantis, Newsom, Obama, Clinton, Sanders
- **Business Leaders**: Elon Musk, Jeff Bezos, Tim Cook, Satya Nadella, Mark Zuckerberg, Sam Altman, Jensen Huang
- **World Leaders**: Putin, Xi Jinping, Zelensky, Netanyahu, Macron, Scholz, Sunak, Modi, Kim Jong Un
- **Organizations**: Federal Reserve, SEC, DOJ, FDA, NATO, UN, WHO, IMF, World Bank
- **Companies**: OpenAI, Anthropic, Google, Microsoft, Apple, Meta, Tesla, NVIDIA, Amazon
- **Entertainment**: Taylor Swift, Beyonce, Drake, Travis Kelce, major sports franchises

#### Sentiment Analysis Tuning
- Added 60+ sports-specific sentiment words
  - Positive: dominant, clinch, sweep, undefeated, unstoppable, comeback, clutch, heroic
  - Negative: upset, stunned, collapse, choke, eliminated, demolished, slump, struggling
- Added comprehensive injury detection lexicon
  - Words: injured, sidelined, questionable, doubtful, torn, concussion, surgery
  - Severity mapping: ruled_out (-4), out_for_season (-4), torn (-4)
- Added 25+ sports phrase replacements
  - "ruled out" → devastating injured sidelined
  - "winning streak" → dominant winning unstoppable
  - "blown lead" → collapse choke devastating
  - "torn acl" → devastating season-ending destroyed
- Lowered sentiment threshold from ±0.1 to ±0.05 for better signal detection
- Lowered sports edge threshold from 5% to 3% for more sensitive detection

#### Discord Alert Formatting
- Complete rewrite of `formatEdgeAlert()` with:
  - Prominent action section: `🟢 ACTION: BUY YES @ 65¢` in code block
  - Fair value vs current price breakdown
  - "Why this edge exists" section with signal explanations
  - Position sizing with Kelly fraction display
  - Clear "TRADE NOW" link
- Enhanced `formatSummaryReport()` with:
  - Timestamp with ET timezone
  - Scan summary stats
  - Actionable opportunities with 🟢/🔴 indicators
  - Cross-platform divergences showing which platform to buy
  - Whale activity with sentiment indicators

### Changed
- Sports matchup detection now includes NHL, NCAAF, NCAAB in `ALL_SPORTS_TEAMS` set
- Signal types now include `weatherBias` and `recencyBias` properties

---

## [2.3.0] - 2024-12-31

### Added - Cross-Platform Matching Improvements

#### Entity Aliases
- Added all 32 NFL teams with full names, cities, and nicknames
- Added all 30 NBA teams with abbreviations and aliases
- Added all 30 MLB teams with city and nickname variations

#### Matching Algorithm
- Sports matchup detection: 2+ teams from same league = 85% confidence boost
- Multi-entity boost: 3+ common entities = 70%+ confidence
- Year/number matching for market date alignment

### Fixed - False Positive Prevention
- Removed problematic 2-letter aliases (ne, no, tb) that matched common words
- Removed 3-letter city abbreviations (ind, min, den, sea, etc.)
- Capped Jaccard-only matches at 30% to prevent false positives
- "Supervolcano" vs "Nevada governor" no longer matches (was 93%, now 0%)

### Changed
- Replaced Saints alias `no` with `nola`
- Pattern boost no longer double-added to raw score

---

## [2.2.0] - 2024-12-31

### Added - Polymarket Whale Conviction Tracking

#### On-Chain Analysis (`fetchers/polymarket-onchain.ts`)
- Integration with Goldsky subgraphs for position data
- Gamma API integration for liquid market discovery
- Whale wallet position tracking
- Conviction strength calculation based on position concentration

#### Cross-Platform Conviction Edges (`edge/cross-platform-conviction.ts`)
- Detect when whale implied price diverges from Kalshi by >5%
- Generate edge opportunities with direction guidance
- Include conviction strength and whale count in signals
- Route to dedicated whale conviction Discord channel

### Changed
- Pipeline now includes whale conviction analysis in step 6.5
- EdgeOpportunity type extended with `whaleConviction` signal

---

## [2.1.0] - 2024-12-30

### Fixed
- Dead code and unused imports removed
- Discord channel routing fixed
- Kalshi URL generation corrected

---

## [2.0.0] - 2024-12-30

### Added - Adversarially Validated Signals

Signals that pass the "who's on the other side?" test:

#### Fed Regime Bias (`edge/fed-regime-bias.ts`)
- Cleveland Fed research implementation
- Regime detection (rising vs falling rate environment)
- Historical bias adjustment for FedWatch probabilities

#### Injury Overreaction (`edge/injury-overreaction.ts`)
- Star player injury impact modeling
- Expected vs actual line movement comparison
- Overreaction detection and fade signals

#### Sports Odds Consensus (`fetchers/sports-odds.ts`)
- The Odds API integration
- Sportsbook consensus calculation
- Kalshi vs consensus comparison
- Support for NFL, NBA, MLB, NHL, NCAAF, NCAAB

#### Weather Overreaction (`edge/weather-overreaction.ts`)
- Climatological base rate application
- Forecast skill limit modeling
- Wet bias detection in precipitation forecasts
- Hurricane cone misinterpretation signals

#### Recency Bias (`edge/recency-bias.ts`)
- Optimal Bayesian update calculation
- Base rate neglect detection
- Fade signals for overreactions

---

## [1.2.0] - 2024-12-29

### Added - Meta Edge Modules

#### Options-Implied (`fetchers/options-implied.ts`)
- Fed Funds Futures probability extraction
- SPX options tail risk calculation
- Treasury yield curve recession signal

#### New Market Scanner (`edge/new-market-scanner.ts`)
- Fresh market detection
- Market age tracking
- Liquidity trend analysis
- Cross-platform reference detection

#### Calibration Tracker (`edge/calibration-tracker.ts`)
- Prediction recording
- Outcome resolution
- Brier score calculation
- Category-specific accuracy tracking
- Bias adjustment recommendations

#### Multi-Channel Discord (`output/channels.ts`)
- Signal type routing
- Dedicated webhooks per category
- Priority-based alert delivery

---

## [1.1.0] - 2024-12-28

### Added
- Entertainment data fetchers (box office, Rotten Tomatoes)
- Economic data fetchers (Fed, CPI, Jobs, GDP)
- 100+ RSS feed sources
- Tracked topics configuration
- Known whales configuration

---

## [1.0.0] - 2024-12-27

### Added - Initial Implementation

#### Core Features
- Kalshi + Polymarket market fetching via dr-manhattan
- Cross-platform price divergence detection
- News sentiment analysis
- Whale activity tracking
- Kelly Criterion position sizing
- Discord webhook alerts
- Discord bot with slash commands

#### Architecture
- TypeScript with strict typing
- Modular pipeline design
- Configurable thresholds
- Environment-based configuration

---

## Roadmap

### Near-term
- [ ] Add more sports events (Olympics, World Cup, major tournaments)
- [ ] Integrate Twitter/X sentiment for real-time signals
- [ ] Add backtesting framework for strategy validation
- [ ] Implement paper trading mode

### Medium-term
- [ ] Machine learning model for edge prediction
- [ ] Automated trade execution via Kalshi API
- [ ] Portfolio tracking and P&L reporting
- [ ] Mobile push notifications

### Long-term
- [ ] Multi-exchange arbitrage detection
- [ ] Custom market creation recommendations
- [ ] Community sentiment aggregation
- [ ] API for external integrations
