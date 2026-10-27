# NBA Research Filter Coverage

The prior 30-entry catalog omitted eleven explicit requests. All 41 entries now remain in the existing filter; no existing market was removed. Connection status is capability, not proof of current quotes or validated betting performance.

## Complete Inventory

| Category | Market | Connection | Genuine research capability |
| --- | --- | --- | --- |
| Team | Moneyline | Partial | Cached/current provider quotes and existing team research, subject to readiness gates |
| Team | Spread | Partial | Same |
| Team | Game Total | Partial | Same |
| Team | Team Total | Partial | Same |
| Team | Alternate Spread | Unsupported | No connected alternate contract evaluation |
| Team | Alternate Total | Unsupported | No connected alternate contract evaluation |
| Team | Alternate Team Total | Unsupported | No connected alternate contract evaluation |
| Scoring & Shooting | Points | Connected | Existing quote, history and model research |
| Scoring & Shooting | Threes | Partial | Existing history/model research when matching quotes are cached |
| Scoring & Shooting | Field Goals Made | Partial | Research-only cached quotes and exact ESPN made counts |
| Scoring & Shooting | Field Goals Attempted | Unsupported | Exact historical evaluator exists; no documented connected quote contract |
| Scoring & Shooting | 3-Pointers Attempted | Unsupported | Exact historical evaluator exists; no documented connected quote contract |
| Scoring & Shooting | 2-Pointers Made | Unsupported | FGM minus 3PM evaluator exists; no documented connected quote contract |
| Scoring & Shooting | Dunks | Unsupported | No connected quote contract or exact dunk history |
| Scoring & Shooting | Free Throws Made | Partial | Research-only cached quotes and exact ESPN made counts |
| Scoring & Shooting | Free Throws Attempted | Partial | Research-only cached quotes and preserved ESPN attempt counts |
| Combined Stats | PRA | Partial | Existing history/model research when matching quotes are cached |
| Combined Stats | Points + Rebounds | Partial | Same |
| Combined Stats | Points + Assists | Partial | Same |
| Combined Stats | Rebounds + Assists | Partial | Same |
| Combined Stats | Blocks + Steals | Partial | Research-only cached quotes and sum of both observed statistics |
| Other Player Stats | Rebounds | Connected | Existing quote, history and model research |
| Other Player Stats | Assists | Connected | Existing quote, history and model research |
| Other Player Stats | Steals | Partial | Existing history/model research when matching quotes are cached |
| Other Player Stats | Blocks | Partial | Same |
| Other Player Stats | Turnovers | Partial | Same |
| Other Player Stats | Double-Double | Partial | Research-only Yes/No quotes and five-category completed-game history |
| Other Player Stats | Triple-Double | Partial | Same, requiring three categories at ten or more |
| Other Player Stats | Fantasy Score | Partial | DFS-only cached quotes; scoring contract missing, no score history/model assumed |
| Other Player Stats | Defensive Rebounds | Unsupported | Exact historical evaluator exists; no documented connected quote contract |
| Other Player Stats | Offensive Rebounds | Unsupported | Same |
| Other Player Stats | Personal Fouls | Unsupported | Exact historical evaluator exists; no documented connected quote contract |
| Quarter Props | 1Q Moneyline | Unsupported | Period evaluation not connected |
| Quarter Props | 1Q Spread | Unsupported | Same |
| Quarter Props | 1Q Total | Unsupported | Same |
| Quarter Props | 1Q Points | Unsupported | Provider documents quote market; player quarter history/model not connected |
| Quarter Props | 2Q Points | Unsupported | No documented connected quote contract or exact player quarter history |
| Quarter Props | 3Q Points | Unsupported | Same |
| Quarter Props | 4Q Points | Unsupported | Same |
| Quarter Props | 1Q Rebounds | Unsupported | Provider documents quote market; player quarter history/model not connected |
| Quarter Props | 1Q Assists | Unsupported | Same |

## Interpretation And Limits

- Counts: 3 connected, 19 partial, 19 unsupported. Twenty-two can return real quotes/research when matching data exists; twenty-one have statistical/team research paths, while Fantasy Score is quote-only.
- The new six historical markets never enter the prediction model: default model parsing remains unchanged. Their presentation has null probability, EV, research score and tier decision.
- Yes/No Double-/Triple-Double quotes retain their meaning as Yes = Over 0.5 and No = Under 0.5; the label states this explicitly.
- History requires a unique exact player-name and event-team match, completed results, known season/phase, a six-hour pre-tipoff cutoff and a single season/phase sample of at most twenty games. Missing components are unavailable, never zero. This is descriptive evidence, not a validated forecast.
- Additional shooting fields preserve made and attempted values without changing existing legacy values. No fantasy scoring weights, dunk counts or quarter shares are invented.
- Existing provider activation still purchases only Points, Rebounds, Assists, Moneyline, Spread, Total and Team Total. Extra markets are read from genuine matching retained/discovered cache receipts. No additional paid market requests were made or silently enabled. Broader purchases need explicit approval and an exact request/credit estimate.
- Unsupported choices remain selectable, but never become another market. Filter persistence, multi-selection and ranking controls remain in place. Connection reasons are exposed on each filter row and in response market metadata.
- Validation/publication gates, model formulas, budget limits and Vercel Authentication are unchanged.

Provider contract reference checked without a paid API call: https://the-odds-api.com/sports-odds-data/betting-markets.html . Its NBA list documents the six newly researchable stat contracts plus DFS fantasy points, but not the additional quote contracts marked unavailable above. A second licensed provider or confirmed provider contract is required before those can become live betting research.

## Next-Phase Provider Audit

Documentation audit: 2026-10-23. No authenticated provider discovery or quote purchase was performed. Live/bookmaker availability for ALL 41 markets is therefore **not verified**, rather than available or unavailable. Offline fixture results establish software behavior, not live coverage. The new `auditNBAProviderCoverage` consumes supplied event receipts without network access and distinguishes documented contracts, recently advertised keys, and current valid priced outcomes. Stale, future-observed, wrong-event and wrong-tipoff receipts are excluded. Its results apply only to supplied receipts, not provider-wide availability.

### Current Provider: Exact Contract Matrix

The Odds API documents 31 of our 41 contracts. These do not require a new odds vendor merely to request their documented quotes under an appropriately entitled existing plan. Actual event/bookmaker posting, account entitlement, region and usage credits still require verification.

| Group | Exact filter markets | Count | Remaining work, not a new odds subscription by itself |
| --- | --- | --- | --- |
| Existing core activation | Points, Rebounds, Assists, Moneyline, Spread, Game Total, Team Total | 7 | Verify fresh live receipts; preserve existing evidence/model readiness requirements |
| Priority partial player props | Threes, Steals, Blocks, Turnovers, PRA, Points + Rebounds, Points + Assists, Rebounds + Assists | 8 | Approve fetching their documented quotes; existing historical/model paths remain gated |
| Priority research-only stats | Field Goals Made, Free Throws Made, Free Throws Attempted, Blocks + Steals, Double-Double, Triple-Double | 6 | Approve quote retrieval; descriptive historical and opponent evidence wired; no added model eligibility |
| Fantasy | Fantasy Score | 1 | DFS quote retrieval plus explicit bookmaker/platform scoring and payout contracts; no assumed weights or sportsbook EV |
| Alternate team contracts | Alternate Spread, Alternate Total, Alternate Team Total | 3 | Dedicated quote normalization and exact line evaluation; do not reuse a standard line |
| First-quarter team contracts | 1Q Moneyline, 1Q Spread, 1Q Total | 3 | Exact period normalization and period history, distinct from full-game modelling |
| First-quarter player contracts | 1Q Points, 1Q Rebounds, 1Q Assists | 3 | Exact player-period history and identity; no full-game shares or invented splits |

The ten remaining quote contracts are **not documented by the current provider**: Field Goals Attempted, 3-Pointers Attempted, 2-Pointers Made, Defensive Rebounds, Offensive Rebounds, Personal Fouls, Dunks, individual 2Q Points, 3Q Points and 4Q Points. Obtain a written contract/coverage confirmation from the existing vendor or a licensed alternative quote feed for these ten. Public documentation is insufficient to assert any alternative sells every one. A stats feed alone cannot supply sportsbook lines.

### Research Improvements In This Phase

- Selected mapped player props now receive the same descriptive history enrichment as the extra six: core stats, threes, steals, blocks, turnovers, PRA/PR/PA/RA use the existing exact stat mappings. No model formulas were changed.
- Opponent history is displayed separately from the overall sample. Both share the latest eligible season/phase; a missing opponent sample never falls back to all opponents, another phase or another season. This is observed player-versus-opponent history, not a fabricated defensive ranking or causal matchup adjustment.
- Completed-game history is cut off before the earlier of request time and tipoff, retaining the six-hour exclusion buffer. No future log becomes available merely because the target game is scheduled later.
- One player search and one log fetch are reused per player during enrichment. No extra paid quote calls occur. Team partial markets retain their existing team/availability research; fantasy remains quote-only.
- Tier, predicted probability, EV and research-score outputs on provider-only cards remain null. Historical wins/losses are descriptive counts, not probabilities.

### Legitimate Alternative Providers

| Provider | Verified public data capability | Quote capability and unresolved gaps | Access and rights gate |
| --- | --- | --- | --- |
| Sportradar | NBA Game Summary documents FGA, 3PA, 2PM, offensive/defensive rebounds and personal fouls, including Player Stats by Period. Play-by-Play identifies made shots, player, period and `shot_type=dunk`, enabling explicit made-dunk derivation. Historical guide covers 2013 onward, with official NBA data from 2017 and field completeness caveats. | Separate Odds Comparison Player Props includes NBA. Its published market table does not establish the ten rare contracts above or all quarter player quotes. Require a book/market/period matrix and sample receipts. | Paid NBA history/period/PBP entitlement plus a separate odds entitlement as needed. Trial is internal evaluation only. Terms require express written approval for gambling/betting-related use. No trial credentials or subscriptions obtained. |
| SportsDataIO | NBA BoxScoreFinal, season PlayerGameStats and PlayByPlayFinal documented; Vault offers historical boxscores/PBP. Exact rare fields, dunk encoding, historical depth and native player-quarter completeness require schema samples; they were not established by extracted dictionary content. | BettingPlayerPropsByGameID and BettingMarket history are documented. Exact book, rare-stat and quarter coverage requires support confirmation. Unlisted outcomes are not a complete historical odds series. | Subscription required for endpoints. Obtain commercial storage/display/modelling/betting-use rights in writing; a trial or general service licence is not proof of all rights. |
| SportsGameOdds | Public basketball stat IDs include FGA, 3PA, 2PM, offensive/defensive rebounds and fouls. Identifier existence does not establish historical sample completeness. Dunk coverage not established. | Supported Markets explicitly lists first-quarter NBA player points O/U for selected books; broader rare/quarter contracts need confirmation. Use per-book odds/lines, not `fairOdds` or consensus fields as offered bookmaker prices. | Paid plan/history depth and account entitlement need confirmation. Review modelling, derivative-use, retention and redistribution terms and required betting permissions before integration. |

Recommended order: first use the current provider for the 19 partial markets; evaluate Sportradar for licensed precise historical/period/PBP data; evaluate alternative odds feeds only against a written missing-contract checklist. Do not buy a second feed on the assumption that more stat IDs guarantee more quotes. Existing public ESPN access also does not, by itself, establish commercial or betting-use permission; production rights must be reviewed separately.

Official references consulted:

- Current quote contracts: https://the-odds-api.com/sports-odds-data/betting-markets.html
- Discovery/quote pricing and schemas: https://the-odds-api.com/liveapi/guides/v4/
- Sportradar stats: https://developer.sportradar.com/basketball/reference/nba-game-summary
- Sportradar PBP: https://developer.sportradar.com/basketball/reference/nba-play-by-play
- Sportradar history: https://developer.sportradar.com/basketball/docs/nba-ig-historical-data
- Sportradar odds: https://developer.sportradar.com/odds/reference/oc-player-props-overview
- Sportradar terms: https://developer.sportradar.com/terms-and-conditions
- SportsDataIO endpoints: https://sportsdata.io/developers/api-documentation/nba
- SportsDataIO dictionary: https://sportsdata.io/developers/data-dictionary/nba
- SportsDataIO history: https://sportsdata.io/vault
- SportsDataIO terms: https://sportsdata.io/terms-of-service
- SportsGameOdds stats: https://sportsgameodds.com/docs/data-types/stats
- SportsGameOdds markets: https://sportsgameodds.com/docs/data-types/markets
- SportsGameOdds per-book schema: https://sportsgameodds.com/docs/data-types/odds
- SportsGameOdds terms: https://sportsgameodds.com/terms

### Approval Needed For Live Verification

The events endpoint is documented as quota-free; event-market discovery costs one credit per call; event odds cost unique returned markets multiplied by regions. No endpoint was called during this phase.

Proposed initial live probe, pending approval: one upcoming NBA event, one market-discovery request across `us,us2`, and one event-odds request for all 31 documented catalog keys across those two regions. At most **63 credits** (1 discovery + 31 markets x 2 regions), plus a quota-free event listing. This is a verification proposal, not a new automatic-refresh cap. Discovery reflects recently seen markets, not a comprehensive negative coverage guarantee. Retain event/book/market/line/side/price/timestamps and quota headers for the offline auditor; never expose credentials. Broaden to the full slate after reporting the first real contract and coverage results and obtaining the corresponding spending approval.

No subscription or licence purchase, paid probe, push or deployment was made.