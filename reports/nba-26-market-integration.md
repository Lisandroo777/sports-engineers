# Verified NBA Research Integration

## Implemented Boundary

The normal NBA research path now uses a selected-contract US/US2 receipt reader and guarded acquisition function rather than the seven-market activation request. All 41 filter choices and Best/Most Likely/Best Value ranking modes remain. The nine verified alternate/Q1 choices are now Partial rather than disconnected: quote ingestion and historical evaluation are connected, but independent validated prediction models are not.

Stored research receipts preserve event and tipoff identity, requested market set and query regions. Every outcome retains its sportsbook key/name, original market key, exact line, selection, price, updated timestamp and receipt observation timestamp. Query regions are not misrepresented as a bookmaker's individual jurisdiction. A dedicated receipt key and Eastern-date event index avoid masquerading the broad request as the legacy US-only activation cache.

No live quote was fetched during this integration. The saved October 23 verification receipt is replayed only at its original observation time in tests. Its now-stale odds are never presented as current runtime research.

## Markets With Connected Sportsbook Research Paths

| Group | Markets | Historical evaluation | Prediction handling |
| --- | --- | --- | --- |
| Standard team, 4 | Moneyline, Spread, Game Total, Team Total | Completed scores at the exact quote line; existing team-model research remains separately gated | Broad receipt cards are research-only; no tier/probability/EV inherited |
| Standard player, 10 | Points, Rebounds, Assists, Threes, Steals, Blocks, PRA, Points + Rebounds, Points + Assists, Rebounds + Assists | Exact player-name and event-team matching, observed historical stats and unchanged pre-tipoff/season/phase rules | Existing validated-publication requirements remain; provider cards alone are not picks |
| Milestones/combined, 3 | Blocks + Steals, Double-Double, Triple-Double | Both observed components or five-category milestone evaluation; Yes/No retained as Over/Under 0.5 with an explicit label | Research-only; no probability, EV or tier |
| Alternate team, 3 | Alternate Spread, Alternate Total, Alternate Team Total | Settles each actual quoted line separately against completed scores, including pushes; no standard-line substitution | Research-only |
| Q1 team, 3 | 1Q Moneyline, 1Q Spread, 1Q Total | Explicit completed-game first-period scores; no full-game shares | Research-only |
| Q1 player, 3 | 1Q Points, 1Q Rebounds, 1Q Assists | Explicit Q1 PBP attribution; requires end-of-period marker, reconciliation of scoring to quarter scores and known roster/participation. Ambiguous attribution, absent rebound/assist event coverage or missing PBP remains unavailable | Research-only |

These **26 markets can return real sportsbook-backed research when a fresh, matching receipt is cached or an authorized guarded refresh succeeds**. This means the quote/data path is implemented, not that every historical feed supplies a complete sample or that any market now has a newly validated betting model. Q1 rebound/assist data is not inferred when absent. The Q1 parser is tested with explicit event payloads offline; new live period-data completeness was not verified.

## Remaining Fifteen Filter Choices

- **Five documented but not observed in the verified live game:** Field Goals Made, Free Throws Made, Free Throws Attempted, Turnovers, Fantasy Score. Existing legacy cached research remains available if actual matching quotes exist, but these are not included in the new verified-only acquisition list. The first four have stat-history evaluators; Fantasy Score still needs a provider/platform scoring and payout contract. They remain Partial, not guaranteed posted markets.
- **Ten unsupported quote/data contracts:** Field Goals Attempted, 3-Pointers Attempted, 2-Pointers Made, Defensive Rebounds, Offensive Rebounds, Personal Fouls, Dunks, individual 2Q/3Q/4Q Points. No substitutes are researched. The six non-quarter box-score fields have conditional historical evaluators, but no connected verified quote contract; dunk and later-quarter player data still need exact licensed source coverage.

Total filter state: 3 Connected, 28 Partial, 10 Not connected. Connection is capability, not live-data availability, model validation or publication eligibility.

## Scope And Unavailable States

- Selected supported market IDs control the US/US2 request and research normalization. Side selection controls retained research outcomes; no absent opposite side is manufactured.
- Explicit market filters scope standard candidate analysis and team-model work before ranking. Broad receipt cards preserve original market IDs, so quarter and alternate selections cannot match standard/full-game cards.
- Fresh requests do not reuse research under a different explicit market filter. Empty/unsupported-only selections perform no quote acquisition.
- Selected markets without matching current quotes remain in missing-market metadata and the existing unavailable/partial-coverage notice. A posted quote with no exact historical sample shows the quote and an explicit unavailable-history reason, not fabricated research or an evaluated rejection.
- Historical team/Q1 samples use completed observations before the earlier of request time and tipoff, with a six-hour buffer and a single observed season/phase. This is descriptive research, not an outcome probability.

## Safeguards And Approval Boundary

The acquisition function uses the existing one-run request allowlist, exact event checks, reserve protection, durable daily ledger and per-search budget. No environment variables, production settings, numerical budget limits, model formulas or publication rules were changed. No paid request was executed. No push or deployment was made.

An uncached all-26 request across two regions has a **52-credit worst case**, exceeding the existing 50-credit per-search budget. The existing guard may block it; this implementation does not relax that limit, split the request to bypass it, or enable spending. Selected subsets within the existing limits can be acquired only when the existing authorization gates permit. Wider live refresh needs separate approval and a reviewed configuration decision. Cached full receipts remain usable without spending when genuinely fresh.

## Offline Evidence

- The real saved US/US2 receipt normalizes to exactly 5,991 outcomes and 26 source identities.
- The actual research-card loader emits all 5,991 with null prediction, EV, score and tier; selected Q1 assists retains only its exact quarter/side, and alternate spreads retains all 701 actual alternate outcomes.
- Wrong event/team/tipoff, future observations and stale receipts fail closed. Eastern slate indexing preserves the verified game despite its next-day UTC tipoff.
- Exact alternate settlement is tested at winning, losing and push lines. Q1 tests reject incomplete scoring, missing period data and absent players and distinguish true first-period stats from full-game totals.
- Mocked acquisition verifies selected-only requests, US/US2 provenance, one-request budget reservation, and rejection without authorization. It does not make paid calls.