import { implied } from './metrics.mjs';

const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function settle(row) {
  const outcome = row.outcome;
  if (!outcome) return 'UNRESOLVED';
  if (outcome.adjudication === 'VOID' && outcome.bookRuleSource && outcome.settlementSource) return 'VOID';
  if (outcome.participated === false) return outcome.adjudication === 'DNP' && outcome.bookRuleSource && outcome.settlementSource ? 'DNP' : 'UNRESOLVED';
  if (outcome.participated !== true || !Number.isFinite(outcome.actual) || !outcome.bookRuleSource || !outcome.settlementSource) return 'UNRESOLVED';
  if (outcome.adjudication !== 'NORMAL' || outcome.earlyInjury === 'EARLY_INJURY' && outcome.injurySettlementConfirmed !== true) return 'UNRESOLVED';
  if (outcome.actual === row.line) return 'PUSH';
  return (outcome.actual > row.line) === (row.direction === 'over') ? 'WIN' : 'LOSS';
}
export function auditRow(row, manifest, asOf) {
  const errors = [];
  const warnings = [];
  const prediction = timestamp(row.predictionAt);
  const kickoff = timestamp(row.kickoff);
  const quote = timestamp(row.quoteAt);
  const cutoff = timestamp(asOf);
  if (row.sport !== 'nfl') errors.push('NOT_NFL');
  if (row.modelVersion !== manifest.modelVersion || row.snapshotHash !== manifest.snapshotHash) errors.push('MODEL_VERSION_OR_HASH_MISMATCH');
  if (!row.id || !row.gameId || !row.playerId || !row.market || !row.slateId) errors.push('MISSING_IDENTITY');
  if (prediction == null || kickoff == null || prediction >= kickoff || cutoff == null || prediction > cutoff) errors.push('INVALID_PREGAME_TIMESTAMP');
  if (!Number.isFinite(row.projection) || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1
    || !Number.isFinite(row.line) || !['over', 'under'].includes(row.direction)) errors.push('INVALID_PREDICTION');
  if (!['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'].includes(row.tier) || !['STANDARD', 'DEEP'].includes(row.researchMode)) errors.push('INVALID_TIER_OR_MODE');
  if (!row.book || implied(row.odds) == null) errors.push('MISSING_OR_INVALID_PRICE');
  if (row.quoteKind !== 'ENTRY' || quote == null || prediction == null || quote > prediction || quote >= kickoff) errors.push('NON_ENTRY_OR_FUTURE_QUOTE');
  if (quote != null && prediction != null && prediction - quote > 3600000) warnings.push('STALE_QUOTE');
  if (!Array.isArray(row.inputEvidence) || !row.inputEvidence.length || row.provenanceComplete !== true) errors.push('INCOMPLETE_INPUT_PROVENANCE');
  for (const evidence of row.inputEvidence ?? []) {
    const available = timestamp(evidence.availableAt);
    const occurred = evidence.occurredAt == null ? null : timestamp(evidence.occurredAt);
    if (!evidence.source || !evidence.kind || available == null || available > prediction) errors.push('FUTURE_OR_UNTIMESTAMPED_INPUT');
    if (evidence.eventId === row.gameId) errors.push('TARGET_GAME_USED_AS_INPUT');
    if (['PLAYER_GAME', 'OPPONENT_GAME', 'ROLE_GAME', 'TEAM_TENDENCY_GAME'].includes(evidence.kind)
      && (occurred == null || occurred >= prediction || available < occurred)) errors.push('FUTURE_OR_UNFINALIZED_GAME_INPUT');
    if (['OBSERVED_GAME_WEATHER', 'SEASON_END_AGGREGATE', 'CLOSING_LINE'].includes(evidence.kind)) errors.push('UNSUPPORTED_HISTORICAL_CONTEXT');
    if (evidence.kind === 'FINAL_INACTIVE_STATUS' && !evidence.asOfReceipt) errors.push('UNSUPPORTED_HISTORICAL_CONTEXT');
  }
  if (row.contextCoverageComplete !== true) errors.push('MISSING_HISTORICAL_CONTEXT');
  if (row.outcome) {
    const final = timestamp(row.outcome.finalizedAt);
    if (final == null || final <= kickoff || final > cutoff || !row.outcome.source || row.outcome.gameId !== row.gameId) errors.push('INVALID_OR_FUTURE_OUTCOME');
  } else errors.push('MISSING_OUTCOME');
  if (Array.isArray(row.consensus) && row.consensus.length) {
    const peers = row.consensus.filter((peer) => peer.book !== row.book && peer.market === row.market && peer.line === row.line && peer.direction === row.direction
      && timestamp(peer.quoteAt) != null && timestamp(peer.quoteAt) <= prediction && prediction - timestamp(peer.quoteAt) <= 3600000 && implied(peer.odds) != null);
    if (new Set(peers.map((peer) => peer.book)).size >= 2 && Math.abs(implied(row.odds) - peers.reduce((sum, peer) => sum + implied(peer.odds), 0) / peers.length) > 0.1) warnings.push('CROSS_BOOK_PROBABILITY_OUTLIER');
  }
  let noVigProbability = null;
  const opposite = row.oppositeQuote;
  if (opposite && opposite.book === row.book && opposite.market === row.market && opposite.line === row.line
    && opposite.direction !== row.direction && ['over', 'under'].includes(opposite.direction) && implied(opposite.odds) != null
    && timestamp(opposite.quoteAt) === quote && row.quoteKind === 'ENTRY') {
    noVigProbability = implied(row.odds) / (implied(row.odds) + implied(opposite.odds));
  }
  const settlement = settle(row);
  if (settlement === 'UNRESOLVED') errors.push('UNRESOLVED_SETTLEMENT');
  return { row: { ...row, rawImpliedProbability: implied(row.odds), noVigProbability, settlement },
    errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
export function auditDataset(rows, manifest, asOf) {
  const seen = new Set();
  const ledger = rows.map((row) => {
    const result = auditRow(row, manifest, asOf);
    const key = [row.gameId, row.playerId, row.market, row.line, row.direction, row.book, row.predictionAt, row.researchMode].join('|');
    const identifiable = row.gameId && row.playerId && row.market && Number.isFinite(row.line) && row.book && row.predictionAt;
    if (identifiable && seen.has(key)) result.errors.push('DUPLICATE_OBSERVATION');
    if (identifiable) seen.add(key);
    return result;
  });
  return { ledger, inclusive: ledger.filter((result) => !result.errors.length).map((result) => result.row),
    clean: ledger.filter((result) => !result.errors.length && !result.warnings.length).map((result) => result.row),
    quality: { raw: rows.length, integrityEligible: ledger.filter((result) => !result.errors.length).length,
      finalClean: ledger.filter((result) => !result.errors.length && !result.warnings.length).length,
      exclusions: Object.fromEntries([...new Set(ledger.flatMap((result) => result.errors))].sort().map((error) => [error, ledger.filter((result) => result.errors.includes(error)).length])),
      warnings: Object.fromEntries([...new Set(ledger.flatMap((result) => result.warnings))].sort().map((warning) => [warning, ledger.filter((result) => result.warnings.includes(warning)).length])),
      countsOverlap: true } };
}
export function planChronologicalSplit(rows) {
  const gameSlates = new Map();
  for (const row of rows) {
    if (gameSlates.has(row.gameId) && gameSlates.get(row.gameId) !== row.slateId) return { status: 'BLOCKED_GAME_SPANS_SLATES', train: null, validation: null, test: null };
    gameSlates.set(row.gameId, row.slateId);
  }
  const slates = [...new Map(rows.map((row) => [row.slateId, row.predictionAt])).entries()].sort((first, second) => Date.parse(first[1]) - Date.parse(second[1]));
  if (rows.length < 1000 || slates.length < 100) return { status: 'BLOCKED_INSUFFICIENT_DATA', train: null, validation: null, test: null,
    actualRows: rows.length, actualSlates: slates.length, requirement: 'At least 1000 eligible settled observations and 100 chronological slates; then inspect period coverage without outcomes. Floors are governance prerequisites, not proof.' };
  const trainEnd = Math.floor(slates.length * 0.6);
  const validationEnd = Math.floor(slates.length * 0.8);
  const partition = (entries) => ({ slateIds: entries.map(([id]) => id), first: entries[0][1], last: entries.at(-1)[1] });
  return { status: 'PROPOSED_REQUIRES_LOCK', train: partition(slates.slice(0, trainEnd)), validation: partition(slates.slice(trainEnd, validationEnd)), test: partition(slates.slice(validationEnd)),
    policy: '60/20/20 chronological complete-slate split. All books, directions and modes from the same slate remain together; boundaries must be locked before calibration.' };
}