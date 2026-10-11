# NBA News, Coaching & Lineup Intelligence V1

Standalone external verification sidecar. No projection/probability/EV/ranking/tier effects and no changes to `NBAResearchContext`. Node.js 22+ is required (verified locally on Node 24). No background polling, model integration, UI wiring, paid APIs or deployment is included.

## Contract and handoff

```ts
import { buildNBAIntelligence } from './lib/nba/intelligence';
import type { IntelligenceInput, NBAIntelligenceSnapshot } from './lib/nba/intelligence';

const intelligence: NBAIntelligenceSnapshot = buildNBAIntelligence(input as IntelligenceInput);
const handoff = { researchContext, intelligence };
```

Supply the real validated input, not the cast alone: target ESPN game/team IDs, timezone-qualified start, Eastern basketball date and verified matchup aliases, asOf, immutable report revisions, claims, dated identity directory, and optionally existing research contexts. Output is JSON-serializable and recursively frozen, `schemaVersion: '1'`. It contains verified claims, lineups, attributed coaching statements, changes, market evidence/counterarguments, affected-teammate references and source/refresh coverage. No existing contract is extended.

Claims retain exact excerpt offsets, PDF page or video timecode, reported/statement dates, applicable game/validity interval, author/source, original-source links, review identity/time, revisions, supersession and conflict reasons. `FACT` evidence means a documented report/announcement exists; coach intent is not a guaranteed future outcome. Unknown/unavailable evidence is not an eligibility failure.

Market views select evidence IDs and correlation groups. Restrictions/OUT reports oppose participation opportunity, not necessarily an under or a calculated betting edge. Starts are relevant but do not guarantee minutes, shot attempts, creation responsibility or rebound chances. Evidence includes counterarguments for points/rebounds/assists/threes and combinations. Do not count the same participation claim independently across combination components. No generic teammate boosts are applied.

Existing Injury Network inputs are consumed read-only for the same game, team and cutoff. Only measured existing cohort evidence may link an affected teammate. No matching edge means insufficient evidence, not an invented beneficiary. Current restrictions and changed lineup/game context are counterarguments; no context or player model is modified.

## Free-source coverage

- NBA Official injury-report index and linked PDFs: explicit game date, matchup, team, player, status, reason, report time and page; `NOT YET SUBMITTED` is a team submission gap, not an OUT/ACTIVE status. Only discovered report links are candidates for ingestion. The page's season title is not proof of document season/date.
- Positioned table extraction requires verified Game Date/Game Time/Matchup/Team/Player Name/Current Status/Reason columns. Missing/split/ambiguous layouts, missing report time or unresolved identities produce coverage gaps. Unknown layout variants and scanned/image-only reports are not guessed. PDF tests exercise structured-layout fixtures and an actual text PDF parser, not a live end-to-end report guarantee.
- ESPN injury feed is secondary and not game-specific by default. V1 preserves such records as unknown applicability instead of inventing a target-game association. Missing reports do not imply active.
- Celtics team editorial (Taylor Snow), Lakers team-news discovery, Chris Forsberg/NBC Sports Boston and Dave McMenamin/ESPN are seed source entries. Their profiles were checked on 2026-10-07; reporter verification must be renewed within 180 days. This is not complete 30-team coverage. Lakers editorial without a verified author remains unverified.
- Team-hosted editorial is not automatically an official lineup announcement. Reviewed `OFFICIAL_TEAM` sources must be configured for actual announcement ownership/scope; default editorial sources cannot confirm a final starting five. Coach lineup intentions remain reported/projected, not final team announcements.
- Public pages need exact publication metadata and accessible article content. Articles, statements and local/social links can be manually ingested/reviewed with provenance. There is no automated social access, paywall bypass, video transcription, rumor scraping or invented quotes. Video-only material without a reliable transcript remains unavailable.

## Verification and identity

Verification states: OFFICIAL, ATTRIBUTED_REPORT, CORROBORATED, SPECULATION, RUMOR, UNVERIFIED, CONFLICTED. Applicable-state labels: CURRENT, STALE, UNKNOWN, CONFLICTED, SUPERSEDED, AFTER_CUTOFF. No classifier or LLM promotes arbitrary prose into a fact.

Official structured injury claims are parsed from explicit cells. Article/coaching/lineup claims require `createReviewedClaim`, an exact bounded excerpt in that document revision, reviewer identity/time, explicit applicability, resolved dated team/player identities and verified source/author. Review is an accountable input supplied by the caller, not an automatic guarantee that the text is true. Negated lineup decisions and unsupported numeric restrictions are rejected. Full articles are not reproduced in model evidence: claims carry bounded excerpts; storage retains normalized text only where permitted by the caller's access grant.

Coaching claims require a speaker identity, verified profile, team, exact statement time and interview/event date. An old quote republished today remains old; topic freshness is 12 hours for lineup/starting role and 48 hours for other developments, plus explicit validity intervals. Even a current quote of intent may change. No missing numeric minutes restriction is filled in.

Lineups distinguish PROJECTED, REPORTED, OFFICIALLY_CONFIRMED and UNKNOWN; state independently marks conflicts/staleness. Five unique dated player identities are required for a complete lineup. Individual starter reports remain partial. Official final confirmation requires explicit team-announcement authority, not a coach quote. Applicable OUT conflicts or conflicting complete lists prevent asserting a confirmed five. Questionable/doubtful starters are listed as unresolved. Historical starters cannot fill current-lineup gaps.

Reports from the same publisher or copied/syndicated source chains are not independent corroboration. `independence: 'DIRECT'` is an explicit reviewed assertion; lack of an original-source link alone is insufficient. Independent publishers and matching claims are required. Contradictions remain visible. Same-source explicit corrections/revisions and newer official game-specific injury report editions supersede prior claims; a newer unrelated article cannot silently win.

## Historical safety and revisions

Cutoff is `min(asOf, target.startsAt)`. Publication, edits, first observation, fetch, report/statement and review times must be known by cutoff. Historical queries require archived pre-cutoff revisions/reviews; today's older-dated page is not reconstructed historical knowledge. Edited content gets a new immutable content-hashed revision even if its original publication date is unchanged. Unchanged/304 content retains original firstSeen time and never renews an old statement.

Change detection compares previously collected snapshots, including injury value, lineup membership/verification, restriction/role and conflicts/corrections/staleness. First collection is a baseline with no late-change claim. Repeated statements without semantic change do not create alerts. Priority is operational intelligence priority, never a player ranking. Absence of a previously reported item is not a retraction or recovery.

## Bounded manual refresh

`createIntelligenceRefresher({ store })` exposes an explicit `refresh(...)`. It never starts timers for monitoring or a background task. Requests must specify a configured source/adapter and a current `AccessGrant` confirming permitted use, robots access, expiration and review notes. Public accessibility alone is not permission to scrape, archive or redistribute. Respect the publisher's terms, retention rights and rate limits; leave sources disabled without authorization. No access grants are enabled by default.

Allowlisted public HTTPS origin/path scopes, no credentials/ports/redirect following, content-type checks, 10-second aborts, sequential concurrency (one), a 12-request default budget (1-30), 2 MB HTML/JSON and 5 MB PDF bounds, max 30 PDF pages/50,000 text items and a killable 128 MB PDF worker limit bound resource use. No script rendering or embedded-PDF code evaluation is enabled. `Retry-After` and backoff persist through the store; no immediate retries. Per-URL minimum intervals are two minutes for injury sources and five minutes for news seeds. Source policies may be made stricter; no all-team completeness assumption.

Conditional ETag/Last-Modified requests reuse immutable revisions on 304. Concurrent identical refreshes are deduplicated. Injury-index refresh only discovers links; the caller explicitly selects a bounded set of linked PDFs for a subsequent refresh. There is no unbounded crawl or guessed report URL polling. Report errors remain coverage gaps; lastSuccess means successful retrieval, not complete/verified coverage.

```bash
node lib/nba/intelligence/manual-refresh.mjs /absolute/path/to/refresh-config.json
```

This one-shot development/operator CLI uses the repository's existing Vite TypeScript loader; it closes immediately and opens no listening server. Config requires `storeDirectory`, explicit `requests`, permission `grants`, `target`, dated `identities`, and verified `teams` aliases. No default permission/config/cron is installed. The production API has no Vite dependency: use the exported functions in a Node server build.

## Durable storage

`IntelligenceStore` separates persistence from the engine: append-only documents, reviewed claims, intelligence snapshots, plus durable refresh reservations/backoff. `MemoryIntelligenceStore` is ephemeral testing/dev only. `createFileIntelligenceStore(root)` uses an explicitly configured writable durable volume, private file modes, atomic no-overwrite record publication and refresh reservation locks. Immutable-ID collisions are errors. Serverless ephemeral disks are NOT durable; deployers must provide a durable-volume or database/object-store implementation of the interface. No deployment infrastructure is provisioned here.

Storage needs permitted retention of normalized report text. Set operator retention/archival policy according to source rights; the file adapter fails above a 10,000-file partition scan rather than silently discarding history. Stale lock recovery is conservative. Storage is a trusted internal boundary, not an untrusted public upload service. No API route is exposed.

## Dependency decision and validation

Existing packages provided no PDF/HTML parser. `unpdf@1.8.1` (MIT, approximately 2.1 MB unpacked, no package dependencies, Node 22+) provides a text-only serverless PDF.js bundle; it avoids the approximately 35 MB `pdfjs-dist` package and optional native canvas/rendering. `htmlparser2@12.0.0` (MIT, approximately 235 KB package plus its DOM tree, Node 20.19+) parses structured article metadata/discovery without regex HTML. Installed with lifecycle scripts disabled. Node 24 fixture extraction, TypeScript and Next.js verification build validate this runtime; Node 20/Edge deployment is not claimed.

Run `npm test -- lib/nba/intelligence`, `npx tsc --noEmit`, `npx eslint lib/nba/intelligence`, and `npm run build:verify`. Tests use injected fetchers and document/layout fixtures; no paid requests or automatic public scraping. All intelligence files are new; only the package manifest/lockfile receive dependency additions. Existing context/model/shared AI/NFL/MLB/pricing logic is not modified.