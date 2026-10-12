# Agent #2 NBA Intelligence Integration

Release base: 9b84896ce94a93936d5867ca6c7a8bb418a74187.
Source inspected: /Users/lisandrorodrigues/DeepSide-Agent-2, whose base commit is
608016412c1ca2c7c059385307be771381989f42 with uncommitted NBA/MLB/research-page work.
Only relevant NBA changes were applied. No branch merge or shared-file copy was used.
Agent #2's files and Agent #3's UI were not edited. No paid request or deployment occurred.

## Included

- Descriptive home/away history: exact-line hit rate, hits, sample count, mean and
  median. Existing L5/L10/L20/season windows remain unchanged. Empty splits retain
  zero count and null values. Finder supplies its existing cutoff-safe same-cohort
  logs; these new splits are not model adjustments.
- NBAResearchEvidence sidecar from Agent #2's owned module, adapted to the current
  release's identity, cutoff and statement-age safeguards.
- Candidate team ID when resolved to one of the game's two teams; no guessed
  team assignment or player identity.
- Sourced ESPN context: availability, observed rotation role, DNP/participation
  counts, historical minutes, rest/home-away, opponent metrics, season and missing
  coverage. Historical role does not imply a confirmed future starting lineup.
- Optional reviewed intelligence reports with source identity/URL, bounded excerpt,
  report/statement/publication/update/fetch timestamps, verification/state/qualifier,
  lineup level, conflict/staleness reasons and affected-teammate evidence.
- Finder -> generic NBA mapping -> ResearchCandidateRecord/session -> presentation
  evidence -> actual AI POST. Existing card evidence sections display the supplied
  descriptive text and citations; no frontend code or visual redesign was needed.
- `nbaHistory` retains full windows/splits, including sample counts. `average`,
  `median`, `homeHitRate` and `awayHitRate` are descriptive transport fields.

## Safeguards

Context attachment requires schema v1/NBA, exact candidate game/player/team,
finite observation/cutoff, and no observation after the candidate cutoff/tipoff.
After-cutoff source evidence is marked unavailable, its descriptive value removed,
and positive availability/rotation summaries withheld. Stale sources remain partial.
Missing injury evidence remains UNKNOWN/UNAVAILABLE, not healthy.

Optional intelligence requires exact game, distinct teams and tipoff, finite
snapshot times not after the candidate observation. Publication and update are
checked independently. Future-observed/reviewed reports are excluded; superseded
claims do not reappear. Stale/conflicted claims retain their labels and limitations.
Lineup summaries are rebuilt from checked claims, not copied from a saved
OFFICIALLY_CONFIRMED label. Projected lineups remain projected.

Report limits are the existing release policies: six hours for availability/role/
restriction statements and three hours for lineup/starting-role statements. Fetch
or receipt time does not renew an old statement. At most four source references
per descriptive context entry are retained; omitted-reference counts are explicit.

## Conflict Resolutions

1. Agent #2's NBA Finder uses a legacy projection path and different role/availability
   wiring. Those shared-file changes were not copied. The current NBA_MODEL_V1
   and its already-integrated context/availability inputs remain authoritative.
2. Agent #2 maps history count into generic sampleSize. Our model sampleSize remains
   `nbaPrediction.sampleSize`; history count is transported separately. No stale
   history fallback can improve qualification or confidence.
3. Agent #2's saved-snapshot reader uses NBA_INTELLIGENCE_STORE_DIR and latest
   snapshot before tipoff. This release retains NBA_GAME_INTELLIGENCE_ARCHIVE and
   rebuilds verification from immutable documents/claims and dated identities.
   A saved CURRENT label or future snapshot is not trusted as live evidence.
4. Agent #2's research.ts role-gate change was not applied because it would alter
   numerical classification inputs. The new sidecar explicitly describes observed
   versus unknown role without changing current gates. Missing sources stay honest.
5. Existing context production modules match Agent #2. Intelligence differences
   are documentation and this release's already-reviewed manual archive activation;
   those were preserved. No additional package or external service is required.
6. Unrelated MLB/postseason, season-intelligence and research-page changes remain
   in Agent #2's worktree and were not included.

## Numerical Invariance

No changes were made to the NBA prop model, distribution, minutes model, pricing,
ranking, game model/market assessment, six-tier classifier, shared probability
model, Elite filter, query-scope implementation or UI. Fourteen key files were
compared byte-for-byte with the release base and had zero drift.

Deterministic integration tests compare model projections, uncertainty, probabilities,
fair odds, EV, directional edge, reliability, model sample size, session scores,
trap risk, tiers and ordering with/without descriptive sidecars. They are identical.
Historical means/splits are never fed back into probability, EV, score or tier math.

The protected verifier permits only exact SHA-256-pinned descriptive history and
evidence changes, while all original archive digests and model checks remain active.
The frozen archives themselves are not replaced or regenerated.

## Verification

- Agent #2 owned adapter/test initially transferred byte-identically; its four
  focused tests pass. Adapter was then locally strengthened for release safeguards.
- New history split tests pass; original aggregate-window expectations are unchanged.
- Evidence integration tests exercise real Finder, predictor, generic mapping,
  session builder, presentation bridge and actual POST using offline data boundaries.
- Source safeguards cover wrong schema/sport/game/player/team, future snapshots,
  future publication despite older update time, stale reports, projected lineups,
  missing injury feeds and after-cutoff positive summaries.
- Final full suite: 1383 passed, 10 opt-in/cache-dependent checks skipped, zero failures.
- TypeScript and production build passed. Final evidence safeguard/integration
  checks: 25 passed. The exact paid-control suite: 10 passed with mocked providers.
- Protected hardened verifier passed with archived identity
  746b2389e75594f8ceaed94dc3afe936d864d41e7167097f0603081196b0cf16.
- No new lint errors or package dependencies. The local commit SHA is reported
  after commit creation; this document cannot contain its own commit hash.
- Known build warnings: four existing broad cache-file tracing warnings.
- Known lint warning: one existing unused FinderResult import in tools.ts; no new errors.

## Remaining NBA Limitations

- No real official report/confirmed-lineup archive is fabricated by this integration.
  Configure NBA_GAME_INTELLIGENCE_ARCHIVE with immutable reviewed documents/claims,
  identities.json and reviewed source authority as already documented. A saved
  snapshot-only directory is insufficient for the release's stricter verifier.
- File archive requires persistent readable storage on the actual host. No new
  storage expense, credentials, permission grants or recurring refresh was introduced.
- ESPN context retrieval remains bounded and may be partial or unavailable. Missing
  rotations, minutes, opponent, rest or report fields stay explicitly missing.
- Preseason and insufficient same-cohort history remain unsupported/unqualified.
- Meaningful absences/restrictions/unmodeled rotation impacts retain existing
  publication blockers; descriptive evidence is not a validated numeric adjustment.
- The previously purchased odds are historical and expired. No new quote purchase
  or replay of its consumed approval occurred. Fresh prices require separate approval.
- General cross-sport aggregation and unsupported NFL/MLB game markets are unchanged.

This integration is additive research transparency, not evidence that a live slate
now has qualified recommendations. The commit remains local pending coordination
and separate push/deployment approval.