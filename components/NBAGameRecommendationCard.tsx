import Image from 'next/image';
import type { GameRecommendation, ModeledGameResearch, GameResearchProjection } from '../lib/nba/prediction/gameLines/recommendations';
import type { GameAvailabilityAssessment } from '../lib/nba/prediction/gameLines/availability';

function percent(value: number | null): string {
  return value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;
}

function american(value: number | null): string {
  return value == null ? 'Unavailable' : `${value > 0 ? '+' : ''}${Math.round(value)}`;
}

function Teams({ home, away }: Pick<ModeledGameResearch, 'home' | 'away'>) {
  return <div className="flex items-center gap-3">
    {away.logoUrl ? <Image src={away.logoUrl} alt={away.name} width={32} height={32} unoptimized />
      : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{away.name.slice(0, 3).toUpperCase()}</span>}
    <h3 className="min-w-0 flex-1 text-sm font-bold text-white break-words">{away.name} @ {home.name}</h3>
    {home.logoUrl ? <Image src={home.logoUrl} alt={home.name} width={32} height={32} unoptimized />
      : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{home.name.slice(0, 3).toUpperCase()}</span>}
  </div>;
}

function Projection({ projection }: { projection: GameResearchProjection | null }) {
  return <div className="space-y-2 text-xs text-slate-300">
    {projection?.means && <p>Modeled score: {projection.means.awayScore.toFixed(1)} away / {projection.means.homeScore.toFixed(1)} home. Total {projection.means.total.toFixed(1)}.</p>}
    {projection?.uncertainty && <p>Model uncertainty: margin {projection.uncertainty.margin.toFixed(1)} / total {projection.uncertainty.total.toFixed(1)} points.</p>}
    <p className="text-slate-400">NBA_GAME_LINES_V1 · UNVALIDATED · Full game · {projection?.phase ?? 'UNKNOWN'}</p>
    {projection && <p className="break-words text-slate-400">Prediction: {projection.predictionAt} · Team samples: {projection.profiles?.away.sampleSize ?? 0} away / {projection.profiles?.home.sampleSize ?? 0} home</p>}
  </div>;
}

export function NBAGameRecommendationCard({ record }: { record: GameRecommendation }) {
  const team = record.selectedTeam === 'HOME' ? record.home.name : record.selectedTeam === 'AWAY' ? record.away.name : '';
  const market = record.marketKey === 'MONEYLINE' ? `${team} moneyline`
    : record.marketKey === 'SPREAD' ? `${team} ${record.line != null && record.line >= 0 ? '+' : ''}${record.line}`
      : `${record.marketKey === 'TEAM_TOTAL' ? `${team} team total` : 'Game total'} ${record.selection.toLowerCase()} ${record.line}`;
  return <article className="min-w-0 space-y-3 rounded-lg border border-sky-400/25 bg-white/3 p-4">
    <Teams home={record.home} away={record.away} />
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-base font-bold text-white break-words">{market}</p>
      <span className="text-xs font-bold text-sky-200">{record.pickTier}</span>
    </div>
    <p className="text-sm text-slate-200">{record.quote.sportsbook} · {american(record.quote.americanOdds)} · Fair {american(record.assessment.fairAmericanOdds)}</p>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
      <div><dt className="text-slate-400">Win</dt><dd>{percent(record.assessment.winProbability)}</dd></div>
      <div><dt className="text-slate-400">Loss</dt><dd>{percent(record.assessment.lossProbability)}</dd></div>
      <div><dt className="text-slate-400">Push</dt><dd>{percent(record.assessment.pushProbability)}</dd></div>
      <div><dt className="text-slate-400">Win, excluding push</dt><dd>{percent(record.assessment.conditionalWinProbability)}</dd></div>
      <div><dt className="text-slate-400">EV</dt><dd>{record.assessment.evPercent == null ? 'Unavailable' : `${record.assessment.evPercent.toFixed(1)}%`}</dd></div>
      <div><dt className="text-slate-400">Research score</dt><dd>{record.researchScore}</dd></div>
    </dl>
    <p className="break-words text-xs text-slate-400">Quote updated: {record.quote.updatedAt}<br />Observed: {record.quote.observedAt}</p>
    <Projection projection={record.projection} />
    {record.availability && <Availability assessment={record.availability} />}
    <p className="text-xs text-slate-300">{record.tierReason}</p>
    <details className="text-xs text-slate-300"><summary className="cursor-pointer py-1">Evidence and risks</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">{[...record.evidence, ...record.risks].map((text, index) => <li key={index}>{text}</li>)}</ul>
    </details>
  </article>;
}

export function NBAModeledGameResearch({ record }: { record: ModeledGameResearch }) {
  return <article className="min-w-0 space-y-3 border-b border-white/10 py-4">
    <Teams home={record.home} away={record.away} />
    <p className="text-xs font-bold text-amber-200">Modeled research · Not bettable</p>
    <p className="text-xs text-slate-300">{record.reason}</p>
    <Projection projection={record.projection} />
    {record.availability && <Availability assessment={record.availability} />}
    {record.projection?.risks.length ? <details className="text-xs text-slate-400"><summary className="cursor-pointer py-1">Research limitations</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">{record.projection.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul>
    </details> : null}
  </article>;
}

function Availability({ assessment }: { assessment: GameAvailabilityAssessment }) {
  return <details className="space-y-2 text-xs text-slate-300">
    <summary className="cursor-pointer py-1">Team availability · {assessment.impactReviewResolved ? 'Verified' : 'Unresolved'}</summary>
    <p className="break-words text-slate-400">Assessed {assessment.assessedAt} · Expires {assessment.expiresAt ?? 'Unavailable'}</p>
    <p>Season {assessment.phase.seasonId ?? 'Unknown'} · {assessment.phase.phase} · {assessment.phase.verified ? 'Verified source' : 'Unverified'}</p>
    {assessment.teams.map(team => <div key={team.teamId} className="space-y-2 border-t border-white/10 pt-2">
      <p className="font-bold">Team {team.teamId} · Report {team.report} · Lineup {team.lineup}</p>
      <ul className="space-y-1">{team.players.map(player => <li key={player.playerId} className="break-words">
        Player {player.playerId}: {player.status} · Starter {player.starter}
        {player.recentMinutes != null ? ` · Observed ${player.recentMinutes.toFixed(1)} min (${player.observedGames} games)` : ' · Workload unavailable'}
        {player.secondaryStatus ? ` · Secondary ${player.secondaryStatus}` : ''}
        {player.restrictions.length ? ` · ${player.restrictions.join(', ')}` : ''}
      </li>)}</ul>
    </div>)}
    {assessment.blockers.length > 0 && <ul className="list-disc space-y-1 pl-4 text-amber-200">{assessment.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
    <p className="text-slate-400">Availability and workload evidence do not change V1 score probabilities. Unmodeled material effects block publication.</p>
  </details>;
}