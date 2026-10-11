# NBA Research Context v1

This directory owns standalone NBA evidence only. It does not import NBA projections, probability/EV models, Finder ranking, shared AI, NFL/MLB, or sportsbook clients. It does not qualify a pick. No model integration is included in this phase.

## Projection-agent handoff

```ts
import { createNBAContextProvider, buildNBAResearchContext } from './lib/nba/context';
import type { NBAResearchContext } from './lib/nba/context';

const provider = createNBAContextProvider();
const snapshot = await provider.loadSnapshot({ gameId: 'ESPN_NUMERIC_EVENT_ID', teamId: 25 });
const context: NBAResearchContext = buildNBAResearchContext({
  playerId: 3992,
  teamId: 25,
  gameId: snapshot.target.gameId,
  asOf: snapshot.asOf,
}, snapshot);

const view = context.marketViews.points;
const evidence = view.evidenceIds.map(id => context.evidence.find(entry => entry.id === id)!);
```

Use actual numeric ESPN IDs. The example event placeholder must be replaced before calling the provider. Create a provider per analysis run; share it for players in that run. It deduplicates snapshot/data requests, caps concurrent fetches at four, has a hard default 80-request budget (configurable 1-100), uses ten-second abort timeouts, and caps detailed history at 30 games per team (configurable 1-40). A budget or fetch failure produces missing coverage, except an unidentifiable target which cannot produce a valid context and throws. Live snapshot reuse is limited to a two-minute bucket; provider data reuse follows request TTLs. The budget applies to the lifetime of that run's provider.

The pure builder accepts injected, archived snapshots for offline/historical analysis. It validates player/team/event identity, observation time and official season. Output is a detached, recursively frozen JSON-serializable snapshot, not a model input that may be mutated in place. Persist the snapshot for reproducible historical research; there is no archival storage implementation here.

## Contract

`NBAResearchContext` has `schemaVersion: '1'`, identity, `asOf`, `cutoff`, typed `sections`, `evidence`, `marketViews`, and `coverage`. There is no projection, expected-minutes forecast, probability, EV, score, tier, ranking, eligibility failure or pricing field.

Every evidence entry includes:

- `kind`: FACT (observed/report attribution), DERIVED (calculated observations), INFERENCE (uncertain conditional interpretation), UNAVAILABLE.
- `state`: AVAILABLE, PARTIAL, UNKNOWN, UNAVAILABLE or CONFLICTED. Null never means zero.
- `sourceRefs`: ESPN endpoint/record, publication/update time, fetch time and freshness; historical game data may have unknown publication freshness, so cutoff eligibility is checked separately.
- `sample`: measured/eligible counts, exact game IDs/date range, season/phase, conditions and exclusions. Metric cohort counts may differ from game coverage counts. Reliability is qualitative, never a confidence probability.
- `direction` and `directionBasis`: default NEUTRAL/UNKNOWN. A conditional injury scenario's HELPS/HURTS describes historical opportunity direction, not an over/under pick or a projection adjustment.
- `dependencyIds`, `correlationGroup`: observations sharing minutes, attempts or the same underlying factor are correlated. `marketViews[market].groupedEvidence` groups them explicitly. Do not sum entries or treat scenarios for multiple absent teammates as independent additive effects.

Combinations (PRA/PR/PA/RA) union component evidence IDs; minutes, pace, injuries and other shared observations appear once. Market relevance is an evidence selection rule, not ranking or weighting.

## Injury and rotation intelligence

Availability separates explicit OUT/DOUBTFUL/QUESTIONABLE/PROBABLE/AVAILABLE, NOT_REPORTED and UNKNOWN. Missing feed, stale report, future retrieval or conflicting equal-time reports cannot establish participation. Feed freshness is six hours, individual reports/comments 48 hours; these are evidence-retention policies, not model/tier thresholds. No report is not active. Day-to-day remains unknown game-specific status.

The Injury Network compares the candidate's measured minutes, FGA, FTA, 3PA, assists and rebounds with a reported teammate participating versus an explicit DNP. It requires the same covered roster membership, candidate starter flag and matching other-DNP patterns. Missing rows are not DNPs. Cohorts retain their IDs and exclusions. Opponent strength, game script, simultaneous rotation overlap and DNP cause remain confounders. Different roster sets are excluded to avoid silently pooling traded/changed teams. The latest observed start role is descriptive, not tomorrow's confirmed role.

Future interpretation is INFERENCE only, conditional on actual teammate nonparticipation, and requires at least five measured observations in each cohort. Smaller comparisons stay descriptive and low-reliability. No minutes, usage or production boosts are applied, and questionable teammates are never assumed out. Recorded assists are not proof of primary ball-handling responsibility.

Rotation provides covered played/DNP/missing counts, historical starts/bench flags, L3/L5/L10/L20 minutes distributions, nonoverlapping prior/recent change and participation after a DNP. A DNP reason attached to a played row is ignored. Returning participation does not prove medical clearance or future limits.

Stints require exactly five starters, known participant rows, exact substitution names corroborated by participant IDs, monotonic sequence/clock, each regulation/OT period-end, final completion proof, and boxscore minute reconciliation within one minute for rounded rows. Ambiguity makes stints unavailable. Observed exit score margins are not proof of blowout-caused minutes; no blowout probability is produced.

## Opponent, schedule and season

Opponent allowance comes from the other team's actual totals against that opponent, never the opponent's own offensive average. Covered points, assists, rebounds, OREB/DREB, FGA/FTA, 3PA/3PM and paint-point allowance are descriptive, not strength-of-schedule adjusted or positional defense. Opponent offensive FG misses are a rebounding environment proxy, not individual rebound chances.

When both teams' FGA, FTA, OREB, total turnovers and verified period coverage exist, an explicitly labeled possession proxy is calculated: mean of both teams' `(FGA + 0.44*FTA - OREB + total turnovers)`, normalized to 48 minutes including overtime. This is not official pace or expected game environment.

Schedule uses Eastern basketball dates for back-to-backs and calendar gaps; covered 4/7/10/14-day counts include the target. Missing schedule coverage is disclosed. Pending previous games are scheduled rest evidence, not completed workload. Venue sequence is not itinerary, distance or fatigue. Neutral sites are not ordinary home-court context.

Official ESPN phase/round metadata distinguishes regular season, preseason and postseason. Unknown metadata does not trigger date-based guessing. Phase samples are separate. Early/mid/late is only a schedule-thirds description when an at-least-82-game schedule and all earlier completed history are verified; the detail cap often leaves progress unknown. NBA playoff stakes use best-of-seven rules only for a verified non-play-in round and explicit series member events. Final cumulative series wins are never used. Missing prior members leave stakes unknown.

## Pregame safety

Cutoff is the earlier of `asOf` and target start. Target results and future games are excluded. Completed historical games require a final-period-end timestamp matching final scores, same season and a source fetched by cutoff. Player/opponent histories additionally require target-phase matching. Conflicting duplicate snapshots are excluded.

Current injuries, news and schedule evidence collected after cutoff are not usable as historical facts, even if a report's apparent publication date is older. Historical queries require archived pre-cutoff snapshots, rather than pretending today's endpoint recreates what was known then. Published reports edited after cutoff are excluded. News is retained as an attributable report, not automatic injury, lineup, scheme, coaching or restriction truth.

## Coverage and remaining unavailable evidence

The provider only allows free ESPN `summary`, date/phase-specific team `schedule`, and `injuries` endpoints. Existing legacy NBA modules and model-facing parsing stay unchanged. No new paid sources are introduced.

Potential assists, touches, rebound chances, rim-attempt frequency, individual defensive assignments, switch/drop/zone schemes, confirmed upcoming lineup/size, verified future restrictions, coaching policies, guaranteed usage redistribution, spread/total/game-script probabilities and comprehensive local/player/coach news remain unavailable. Summary-linked articles and injury comments are secondary reports. Historical starts or paint totals must not fill these gaps.

Validation: `npm test -- lib/nba/context`, `npx tsc --noEmit`, `npx eslint lib/nba/context`. Tests use injected fetchers and captured-field fixtures, not paid calls. Integration into projections/shared AI/UI is explicitly deferred to a separate approved phase.