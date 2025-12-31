# Edge Matching Research Report
**Date:** December 31, 2025
**Focus:** Sports Team Name Matching Edge Cases & Gap Analysis

---

## Executive Summary

Analysis of the Kalshi Bot's cross-platform matching system revealed **15+ critical edge cases** and **50+ missing abbreviations** that could cause false negatives (missed matches) or false positives (incorrect matches) in sports market identification.

**Confidence Level:** High (based on official API documentation and league sources)

---

## 1. Critical Edge Cases Identified

### 1.1 Teams Sharing Names Across Leagues (DISAMBIGUATION REQUIRED)

| Team Name | League 1 | League 2 | Current Handling | Risk |
|-----------|----------|----------|------------------|------|
| **Cardinals** | Arizona (NFL) | St. Louis (MLB) | Separate entries but city overlap with `cardinals_mlb` | ⚠️ Medium |
| **Giants** | New York (NFL) | San Francisco (MLB) | Separate entries with `giants_mlb` | ⚠️ Medium |
| **Jets** | New York (NFL) | Winnipeg (NHL) | Separate entries with `jets_nhl` | ⚠️ Medium |
| **Kings** | Los Angeles (NHL) | Sacramento (NBA) | Separate entries with `kings_nhl` | ⚠️ Medium |
| **Panthers** | Carolina (NFL) | Florida (NHL) | Separate entries with `panthers_nhl` | ⚠️ Medium |
| **Rangers** | Texas (MLB) | New York (NHL) | Separate entries with `rangers_nhl` | ⚠️ Medium |

**Issue:** When a market says "Kings win" without context, the system might match it to the wrong sport.

**Recommendation:** Implement league-context requirement for cross-sport disambiguation.

---

### 1.2 Multi-Team Cities (LA & NY Edge Cases)

#### Los Angeles (9 Major Teams)
| Sport | Teams | Current Aliases | Missing |
|-------|-------|-----------------|---------|
| NFL | Rams, Chargers | `la rams`, `la chargers` | `LAR`, `LAC` abbreviations |
| NBA | Lakers, Clippers | `la lakers`, `la clippers` | `LAL`, `LAC` abbreviations |
| MLB | Dodgers, Angels | `la dodgers`, `la angels` | `LAD`, `LAA` abbreviations |
| NHL | Kings, Ducks | `la kings`, `anaheim ducks` | `LAK`, `ANA` abbreviations |
| MLS | Galaxy, LAFC | ❌ Not covered | Full coverage needed |

#### New York (10 Major Teams)
| Sport | Teams | Current Aliases | Missing |
|-------|-------|-----------------|---------|
| NFL | Giants, Jets | `ny giants`, `ny jets` | `NYG`, `NYJ` abbreviations |
| NBA | Knicks, Nets | `ny knicks`, `brooklyn nets` | `NYK`, `BKN`/`BRK` |
| MLB | Yankees, Mets | `ny yankees`, `ny mets` | `NYY`, `NYM` |
| NHL | Rangers, Islanders, Devils | Present | `NYR`, `NYI`, `NJD` |

**Critical Issue:** Abbreviations like "NYG" or "LAL" are commonly used in prediction market titles but NOT in current aliases.

---

### 1.3 Missing Standard 3-Letter Abbreviations

#### NFL (Missing Official GSIS Codes)
```
ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND,
JAX, KC, LAC, LAR, LV, MIA, MIN, NE, NO, NYG, NYJ, PHI, PIT, SEA, SF, TB, TEN, WAS
```

#### NBA (Missing Standard Codes)
```
ATL, BOS, BKN, CHA, CHI, CLE, DAL, DEN, DET, GSW, HOU, IND, LAC, LAL,
MEM, MIA, MIL, MIN, NOP, NYK, OKC, ORL, PHI, PHX, POR, SAC, SAS, TOR, UTA, WAS
```

#### MLB (Missing Standard Codes)
```
ARI, ATL, BAL, BOS, CHC, CHW/CWS, CIN, CLE, COL, DET, HOU, KC, LAA, LAD,
MIA, MIL, MIN, NYM, NYY, OAK, PHI, PIT, SD, SEA, SF, STL, TB, TEX, TOR, WAS
```

#### NHL (Missing Standard Codes)
```
ANA, ARI/UTA, BOS, BUF, CAR, CBJ, CGY, CHI, COL, DAL, DET, EDM, FLA, LA,
MIN, MTL, NJD, NSH, NYI, NYR, OTT, PHI, PIT, SEA, SJS, STL, TBL, TOR, VAN, VGK, WPG, WSH
```

---

## 2. Conference Realignment Updates (2024-2025)

### 2.1 Missing/Outdated College Teams

#### Big Ten Additions (2024) - VERIFY IN CODE
- ✅ Oregon (present as `oregon`)
- ✅ USC (present as `usc`)
- ✅ UCLA (present as `ucla`)
- ✅ Washington (present as `washington_huskies`)

#### SEC Additions (2024) - VERIFY IN CODE
- ✅ Texas (present as `texas_longhorns`)
- ✅ Oklahoma (present as `oklahoma`)

#### Big 12 Additions (2024) - CHECK FOR GAPS
- ✅ Arizona, Arizona State, Colorado, Utah (present)

#### ACC Additions (2024) - POTENTIAL GAPS
- ⚠️ **SMU** - NOT IN CODE (SMU Mustangs)
- ✅ Cal (present as `cal`)
- ✅ Stanford (present as `stanford`)

#### Pac-12 Rebuilding (2026) - FUTURE-PROOFING
- ⚠️ Boise State - NOT FULLY COVERED
- ⚠️ Fresno State - NOT FULLY COVERED
- ⚠️ Colorado State - NOT FULLY COVERED
- ⚠️ San Diego State - Present as `san_diego_state`
- ⚠️ Utah State - NOT FULLY COVERED
- ⚠️ Texas State - NOT FULLY COVERED

#### Team Name Changes
- ⚠️ **Texas A&M Commerce → East Texas A&M** (November 2024) - NOT IN CODE
- ✅ Cleveland Indians → Guardians (handled)
- ✅ Washington Redskins → Commanders (handled)
- ✅ Arizona Coyotes → Utah Hockey Club (handled!)

---

## 3. Historical Team Names (Legacy Matching)

These aliases would help match older prediction market titles or historical discussions:

| Current Name | Historical Names to Add |
|--------------|------------------------|
| Las Vegas Raiders | Oakland Raiders ✅, LA Raiders ❌ |
| LA Chargers | San Diego Chargers ❌ |
| LA Rams | St. Louis Rams ❌ |
| Brooklyn Nets | New Jersey Nets ❌ |
| Oklahoma City Thunder | Seattle SuperSonics ❌ |
| Memphis Grizzlies | Vancouver Grizzlies ❌ |
| Utah Jazz | New Orleans Jazz ❌ |

---

## 4. Prediction Market Naming Patterns

Based on research into Kalshi and Polymarket market titles:

### Common Patterns Found
1. **"Will [Team] win [Event]?"** - Uses full team names
2. **"[Team A] vs [Team B]"** - Uses short names or abbreviations
3. **"[City] over/under [X] wins"** - Uses city names only
4. **"Super Bowl LIX winner"** - Event-centric, team in options

### Kalshi Ticker Prefixes (Sports)
- `KXNFL` - NFL markets
- `KXNBA` - NBA markets
- `KXMLB` - MLB markets
- `KXNHL` - NHL markets
- `KXCFB` - College Football markets

**Recommendation:** Add ticker prefix detection as additional matching signal.

---

## 5. False Positive Risks

### City Name Collisions
| City | NFL | NBA | MLB | NHL | College |
|------|-----|-----|-----|-----|---------|
| Houston | Texans | Rockets | Astros | - | Houston Cougars |
| Dallas | Cowboys | Mavericks | Rangers | Stars | - |
| Denver | Broncos | Nuggets | Rockies | Avalanche | - |
| Detroit | Lions | Pistons | Tigers | Red Wings | - |
| Cleveland | Browns | Cavaliers | Guardians | - | - |
| Pittsburgh | Steelers | - | Pirates | Penguins | Pitt Panthers |

**Current Code Issue:** City aliases like `houston`, `dallas`, `denver` appear in multiple team entries, which could cause incorrect matches when only city name is mentioned.

---

## 6. Recommended Code Changes

### Priority 1: Add Standard Abbreviations (HIGH IMPACT)

```typescript
// NFL - Add to existing entries
bills: ['bills', 'buffalo bills', 'buffalo', 'BUF'],
dolphins: ['dolphins', 'miami dolphins', 'MIA'],
// ... etc for all 32 teams

// Add 2-letter codes that are unambiguous
chiefs: ['chiefs', 'kansas city chiefs', 'kansas city', 'KC'],
packers: ['packers', 'green bay packers', 'green bay', 'GB'],
```

### Priority 2: Add Missing College Teams (MEDIUM IMPACT)

```typescript
smu: ['smu', 'mustangs', 'southern methodist'],
boise_state: ['boise state', 'broncos', 'boise'],
fresno_state: ['fresno state', 'bulldogs', 'fresno'],
colorado_state: ['colorado state', 'rams', 'csu'],
utah_state: ['utah state', 'aggies', 'usu'],
```

### Priority 3: Historical Names (LOW IMPACT)

```typescript
chargers: ['chargers', 'los angeles chargers', 'la chargers', 'san diego chargers', 'LAC', 'SD'],
rams: ['rams', 'los angeles rams', 'la rams', 'st louis rams', 'LAR', 'STL'],
```

### Priority 4: League Context Requirement

Modify `getSportsTeamsFromEntities()` to require league context when matching single-sport homonym teams (Cardinals, Giants, Jets, Kings, Panthers, Rangers).

---

## 7. Sources

### Official League Documentation
- [NFL GSIS Club Codes](http://www.nflgsis.com/gsis/documentation/Partners/ClubCodes.html)
- [Wikipedia NFL Team Abbreviations](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_National_Football_League/National_Football_League_team_abbreviations)
- [Wikipedia NBA Team Abbreviations](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_National_Basketball_Association/National_Basketball_Association_team_abbreviations)
- [Wikipedia MLB Team Abbreviations](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_Baseball/Team_abbreviations)

### Conference Realignment
- [NCAA Conference Realignment Breakdown 2024-25](https://www.ncaa.com/news/ncaa/article/2024-08-22/college-football-conference-realignment-breakdown-2024-25-teams-new-conferences)
- [ESPN Conference Realignment Tracker](https://www.espn.com/college-football/story/_/id/40293423/cfb-conference-realignment-tracker-2024)
- [SI College Football Realignment Guide](https://www.si.com/fannation/college/cfb-hq/ncaa-football/college-football-expansion-what-realignment-moves-will-happen-in-2024)

### Sports API Best Practices
- [Sportradar ID Types Documentation](https://developer.sportradar.com/getting-started/docs/id-types)
- [Fanatics Tech - Live Sports Data Lessons](https://medium.com/fanatics-tech-blog/live-sports-data-things-weve-learned-consuming-real-time-apis-36f70e48b0b9)

### Prediction Markets
- [Kalshi API Documentation](https://docs.kalshi.com/welcome)
- [FinFeedAPI - Prediction Markets API](https://www.finfeedapi.com/products/prediction-markets-api)
- [Kalshi vs Polymarket Comparison](https://sportshandle.com/best-prediction-market-apps/kalshi-vs-polymarket/)

### Multi-Team Cities
- [US Cities with Four Major Sports Teams](https://en.wikipedia.org/wiki/United_States_cities_with_teams_from_four_major_league_sports)
- [Sports in Los Angeles](https://en.wikipedia.org/wiki/Sports_in_Los_Angeles)

### Teams Sharing Names
- [Daily Hive - Pro Sports Teams Sharing Names](https://dailyhive.com/vancouver/sports-teams-share-same-name-another-nhl-nba-nfl-cfl-mlb)

---

## Next Steps

1. Review this report with user
2. Run `/sc:brainstorm` session to identify additional missing links
3. Prioritize and implement code changes
4. Test with real Kalshi/Polymarket market titles
