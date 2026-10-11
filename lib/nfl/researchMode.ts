import { buildNFLEvidenceConflict, type NFLResearchProfile } from './researchModel';
import type { ResearchCandidateRecord } from '../ai/agent/session';
import type { NFLResearchMode } from './researchIntent';
import { NFL_ELITE_MARKETS } from './oddsTypes';
import { buildNFLMatchupEfficiency } from './matchupEfficiency';
import type { NFLOpponentContext } from './opponentContext';
import type { NFLInjuryContext } from './injuries';
import type { NFLWeatherContext } from './weather';
import { buildNFLGameEnvironment } from './gameEnvironment';

export function evaluateNFLSavedResearchMode(candidate: ResearchCandidateRecord, researchMode: NFLResearchMode): ResearchCandidateRecord {
  const saved = candidate.nflResearchProfile;
  const gameEnvironmentModel = saved ? buildNFLGameEnvironment({ market: candidate.marketKey,
    direction: candidate.direction, position: saved.role?.value?.position ?? candidate.position, teamId: candidate.teamId,
    researchMode, gameScript: saved.gameScript, projectionModel: saved.projectionModel,
    phase3Projection: saved.gameEnvironmentModel?.phase3Projection ?? candidate.projection,
    phase3Uncertainty: saved.gameEnvironmentModel?.phase3Uncertainty ?? candidate.projectionUncertainty,
    injuryContext: candidate.injuryContext as NFLInjuryContext, weatherContext: candidate.weatherContext as NFLWeatherContext,
    snapshotOnly: true,
  }) : undefined;
  const existingMatchup = saved?.matchupModel ?? saved?.projectionModel?.matchupModel;
  const snapshotAge = existingMatchup?.evaluatedAt ? Date.now() - Date.parse(existingMatchup.evaluatedAt) : null;
  const staleSnapshot = snapshotAge != null && (!Number.isFinite(snapshotAge) || snapshotAge < 0 || snapshotAge > 3600000);
  const matchupModel = saved ? existingMatchup ? { ...existingMatchup, researchMode, snapshotOnly: true,
    ...(staleSnapshot ? { confidence: 'UNAVAILABLE' as const, overall: 'UNASSESSED' as const,
      missingInputs: [...new Set([...existingMatchup.missingInputs, 'fresh matchup snapshot; cached evidence is older than one hour'])],
      adjustmentReason: 'Archived matchup analysis only; current inputs have not been refreshed. Recorded projection is not a newly verified recommendation.',
    } : {}),
  } : buildNFLMatchupEfficiency({
    market: candidate.marketKey as Parameters<typeof buildNFLMatchupEfficiency>[0]['market'],
    position: saved.role?.value?.position ?? candidate.position,
    researchMode, projectionModel: saved.projectionModel,
    opponentContext: candidate.opponentContext as unknown as NFLOpponentContext,
    injuryContext: candidate.injuryContext as unknown as NFLInjuryContext,
    snapshotOnly: true,
  }) : undefined;
  const original = saved ? { ...saved, matchupModel, gameEnvironmentModel,
    gameScript: saved.gameScript ? { ...saved.gameScript, value: saved.gameScript.value
      ? { ...saved.gameScript.value, environmentModel: gameEnvironmentModel, candidateEvidence: null } : saved.gameScript.value } : saved.gameScript,
    projectionModel: saved.projectionModel ? { ...saved.projectionModel, matchupModel, gameEnvironmentModel } : saved.projectionModel,
    schemeMatchup: saved.schemeMatchup ? { ...saved.schemeMatchup, value: saved.schemeMatchup.value
      ? { ...saved.schemeMatchup.value, matchupAnalysis: matchupModel } : null } : saved.schemeMatchup,
  } : undefined;
  if (!original) return candidate;
  if (researchMode === 'DEEP') return { ...candidate, nflResearchProfile: { ...original, researchMode } };
  if (Object.values(original.hardGates).every((gate) => gate.passed)) return {
    ...candidate, nflResearchProfile: { ...original, researchMode },
  };
  const basicPresent = NFL_ELITE_MARKETS.some((market) => market === candidate.marketKey)
    && (candidate.sampleSize ?? candidate.nflHistory?.gamesUsed ?? 0) >= 5
    && candidate.projection != null && Number.isFinite(candidate.projection)
    && candidate.opponentContext != null && candidate.opponentContext.status !== 'UNAVAILABLE'
    && candidate.modelProbability != null && Number.isFinite(candidate.modelProbability);
  const thesisPresent = candidate.projection != null && (original.role.value?.roleEvidence?.length ?? 0) > 0;
  const gates = {
    ...original.hardGates,
    requiredDataPresent: { passed: basicPresent, reason: basicPresent ? null : 'Required Standard market, history, projection, probability, or opponent data is missing.' },
    footballThesisExplained: { passed: thesisPresent, reason: thesisPresent ? null : 'A supported role and projection thesis is missing.' },
    evidenceQuality: { passed: candidate.dataQuality >= 70, reason: candidate.dataQuality >= 70 ? null : 'Research quality is below the existing recommendation minimum.' },
  };
  const evidence = buildNFLEvidenceConflict(original.evidence.for, original.evidence.against, gates, {
    status: original.evidence.conflictStatus, conflicts: original.evidence.conflicts ?? [],
    resolutionReason: original.evidence.resolutionReason ?? null, highestAuthorityEvidence: original.evidence.highestAuthorityEvidence ?? null,
  });
  const profile: NFLResearchProfile = { ...original, researchMode, hardGates: gates, evidence,
    verdict: evidence.verdict, productionEliteQualified: original.productionEliteQualified && evidence.verdict === 'PLAY' };
  return { ...candidate, nflResearchProfile: profile };
}