# One-Time NBA Live Market Verification

## Scope And Exact Spend

- Approval: one upcoming NBA event, US and US2, all 31 documented catalog contracts, maximum 63 credits. No retries, recurring jobs, production setting changes, push or deployment.
- Game: Houston Rockets at San Antonio Spurs.
- Provider event ID: `49fc89a9696a9a20b658732b34ce61c4`.
- Tipoff: 2026-10-24 01:40 UTC (2026-10-23 9:40 PM US Eastern).
- Quote receipt: 2026-10-24 00:13:20 UTC (2026-10-23 8:13:20 PM US Eastern).
- Requests: event listing HTTP 200, 0 credits; event markets HTTP 200, 1 credit; event odds HTTP 200, 52 credits.
- Exact total: **53 credits**. Usage increased from 13,558 to 13,611; remaining credits decreased from 6,442 to 6,389. Ten approved credits were not spent; the remaining allowance does not authorize another run.
- Result: **26 markets with current valid prices, 0 advertised-only markets, 5 neither advertised nor priced** in this snapshot.
- 5,991 priced outcomes across 19 bookmakers. These are bookmaker/player/line/side observations, not unique wagers, independent predictions, or qualified picks. Book and line ladders can contribute multiple outcomes.
- Quote ages at receipt: approximately 4.4 to 166.4 seconds. Validation checked event and tipoff identity, market timestamp, integer American price, required line/subject fields, and contract-specific side vocabulary. This verifies data-format usability, not account access, legal bet availability, liquidity, or model eligibility.
- Full raw quote/discovery receipts and quota headers are retained locally under ignored `data/nba-v3/live-market-verification/2026-10-24T00-13-19.899Z/`. No API keys or authenticated request URLs are included in these artifacts. No receipt was written into production/shared caches.

## All 31 Requested Markets

| Market | Valid priced outcomes | Books with prices | Result |
| --- | ---: | ---: | --- |
| Moneyline | 38 | 19 | Current prices |
| Spread | 38 | 19 | Current prices |
| Game Total | 38 | 19 | Current prices |
| Team Total | 84 | 10 | Current prices |
| Alternate Spread | 701 | 11 | Current prices |
| Alternate Total | 920 | 12 | Current prices |
| Alternate Team Total | 530 | 7 | Current prices |
| Points | 583 | 15 | Current prices |
| Threes | 341 | 15 | Current prices |
| Field Goals Made | 0 | 0 | Not advertised or priced |
| Free Throws Made | 0 | 0 | Not advertised or priced |
| Free Throws Attempted | 0 | 0 | Not advertised or priced |
| PRA | 388 | 12 | Current prices |
| Points + Rebounds | 352 | 10 | Current prices |
| Points + Assists | 299 | 10 | Current prices |
| Rebounds + Assists | 291 | 10 | Current prices |
| Blocks + Steals | 32 | 4 | Current prices |
| Rebounds | 496 | 15 | Current prices |
| Assists | 368 | 15 | Current prices |
| Steals | 77 | 6 | Current prices |
| Blocks | 44 | 6 | Current prices |
| Turnovers | 0 | 0 | Not advertised or priced |
| Double-Double | 141 | 11 | Current prices |
| Triple-Double | 58 | 11 | Current prices |
| Fantasy Score | 0 | 0 | Not advertised or priced |
| 1Q Moneyline | 28 | 14 | Current prices |
| 1Q Spread | 22 | 11 | Current prices |
| 1Q Total | 22 | 11 | Current prices |
| 1Q Points | 78 | 4 | Current prices |
| 1Q Rebounds | 10 | 1 | Current prices |
| 1Q Assists | 12 | 1 | Current prices |

Absence is specific to this game, time, US/US2 query and returned bookmakers. It does not disprove the provider's documented support or establish that a new subscription is required. None of the ten undocumented catalog markets was requested.

## Representative Real Contracts

- Fanatics: Dylan Harper Blocks + Steals Over 0.5 at -260, updated 00:11:01 UTC. Across all returned books: 22 Over and 10 Under outcomes.
- DraftKings: Victor Wembanyama Double-Double Yes at -197, updated 00:12:53 UTC. Across returned books: 121 Yes and 20 No outcomes.
- DraftKings: Alperen Sengun Triple-Double Yes at +1960, updated 00:12:53 UTC. Across returned books: 51 Yes and 7 No outcomes.
- ESPN BET: Kevin Durant 1Q Points Over 6.5 at -115 and Under 6.5 at -115, updated 00:13:15 UTC.
- Hard Rock Bet: Kevin Durant 1Q Rebounds Over 1.5 at +105 and Under 1.5 at -150, updated 00:12:15 UTC.
- Hard Rock Bet: Fred VanVleet 1Q Assists Over 1.5 at -115 and Under 1.5 at -125, updated 00:12:15 UTC.

These are observed quotes, not recommendations. No roster, availability or prediction claim is inferred from bookmaker naming. Examples can cease to be current immediately after the observation.

1Q Points appeared at ESPN BET, FanDuel, Fliff and Hard Rock Bet. 1Q Rebounds and 1Q Assists appeared only at Hard Rock Bet. Blocks + Steals appeared at Fanatics, Bally Bet, betPARX and Fliff. Availability is not uniform across books or players; do not invent missing opposite sides.

## Exact DeepSide Integration Next Steps

### Existing Research Paths: 17 Verified Markets

1. Seven already activated: Moneyline, Spread, Game Total, Team Total, Points, Rebounds, Assists. Existing quote/history paths still require fresh receipts and model/readiness gates. This audit alone does not produce picks.
2. Seven additional mapped props with verified prices: Threes, Steals, Blocks, PRA, PR, PA, RA. Current historical/model mappings already exist, but the normal seven-market activation does not fetch them.
3. Three research-only contracts with verified prices: Blocks + Steals, Double-Double, Triple-Double. Existing research-only parsers and descriptive history can handle these. Keep probability, EV and tiers null until independently validated; retain Yes/No semantics.

The main shared blocker is quote ingestion, not filter checkboxes: current readers accept US legacy-discovery or seven-market activation keys. This probe's broader US/US2 receipt has a different request identity and remains isolated. Add an explicit provenance-preserving research receipt adapter/store for the actual region set, market set, bookmaker, event, timestamps, line and side. Never relabel a broad request as the existing activation key. Test it against this retained receipt offline before authorizing any further refresh. Preserve whole research pools across filter changes; apply selections before presentation/ranking.

### Nine Verified Contracts Requiring Additional Integration

- Alternate Spread, Alternate Total, Alternate Team Total: add exact alternate-contract normalization, preserve every quoted line and side, and evaluate that precise line separately. Do not substitute standard lines or inherit their tier.
- 1Q Moneyline, 1Q Spread, 1Q Total: preserve quarter identity and regulation-period settlement. Connect genuine first-quarter team history; never reuse full-game projections.
- 1Q Points, 1Q Rebounds, 1Q Assists: retain exact player, period and line; connect completed player-quarter statistics and strict player/event matching. Do not divide full-game statistics into estimated quarters. Licensed historical data rights and a dedicated evaluation path remain necessary.

### Five Not Observed

Field Goals Made, Free Throws Made, Free Throws Attempted, Turnovers and Fantasy Score need another approved event/time/bookmaker check or provider coverage confirmation. Existing stat research is available for the first four when matching quotes exist. Fantasy remains DFS-only and requires the actual platform scoring and payout contract; no scoring formula or sportsbook-style EV should be guessed.

All future paid acquisition needs separate approval. This run did not modify recurring refresh, production settings, UI, model formulas, validation or publication safeguards.