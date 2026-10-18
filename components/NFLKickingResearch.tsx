import type { ReactNode } from 'react';
import type { NFLKickingResearch as NFLKickingResearchData, NFLKickingRate, NFLKickingWindow } from '../lib/nfl/kickingResearch';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-[10px] uppercase text-slate-500">{label}</dt><dd className="mt-1 text-xs text-slate-300 [overflow-wrap:anywhere]">{children}</dd></div>;
}

function number(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : String(Number(value.toFixed(2)));
}

function accuracy(value: NFLKickingRate | null): string {
  return value?.rate == null ? 'Unavailable' : `${number(value.rate * 100)}% (${value.numerator}/${value.denominator} paired made/attempted; ${value.observedGames ?? 'Unavailable'} observed games)`;
}

function label(value: string): string {
  return value.replaceAll('.', ' / ').replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function WindowFacts({ title, sample }: { title: string; sample: NFLKickingWindow }) {
  return <div className="min-w-0 space-y-2">
    <h5 className="text-xs font-semibold text-slate-300">{title}</h5>
    <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact label="Sample coverage">{sample.games} supplied games; {sample.seasonCount} observed seasons: {sample.seasons.join(', ') || 'Unavailable'}; {sample.gamesWithoutSeason} games without season metadata</Fact>
      <Fact label="Field goals made / attempted">{number(sample.made.total)} made ({sample.made.observedGames} observed games) / {number(sample.attempted.total)} attempted ({sample.attempted.observedGames} observed games)</Fact>
      <Fact label="Field goal accuracy">{accuracy(sample.accuracy)}</Fact>
      <Fact label="Field goal attempts/game">{number(sample.attempted.perGame)} ({sample.attempted.observedGames} observed games)</Fact>
      {([['under40', 'Under 40 yards'], ['from40To49', '40-49 yards'], ['from50Plus', '50+ yards']] as const).map(([key, distance]) => <Fact key={key} label={`${distance} field goals`}>
        {number(sample.distance[key].made.total)} made / {number(sample.distance[key].attempted.total)} attempted; accuracy: {accuracy(sample.distance[key].accuracy)}
      </Fact>)}
      <Fact label="Kicking points (not field goals made)">{number(sample.kickingPoints.total)} ({sample.kickingPoints.observedGames} observed games)</Fact>
      <Fact label="Longest observed field goal">{number(sample.longestFieldGoal)} yards ({sample.longestFieldGoalObservedGames} observed games)</Fact>
    </dl>
  </div>;
}

export function NFLKickingResearch({ research }: { research: NFLKickingResearchData }) {
  const weather = research.weatherContext;
  const injuries = research.injuryContext;
  const sources = [...new Set(research.evidence.filter(entry => entry.source != null).map(entry => `${entry.source}; retrieved: ${entry.retrievedAt ?? 'Unavailable'}`))];
  return <section aria-label="NFL kicking source facts" className="mt-3 min-w-0 space-y-3 border-y border-white/8 py-3 [overflow-wrap:anywhere]">
    <h4 className="text-xs font-bold text-slate-300">NFL kicking source facts</h4>
    <WindowFacts title="Recent L3 supplied games" sample={research.recentL3} />
    <WindowFacts title="Recent L5 supplied games" sample={research.recentL5} />
    <WindowFacts title={research.currentSeason.label} sample={research.currentSeason} />
    {research.career ? <WindowFacts title="Supplied history only (not verified full career)" sample={research.career} /> : <p className="text-xs text-slate-400">Career coverage: Unavailable - no supplied history.</p>}
    <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {Object.entries(research.opportunity.facts).map(([key, fact]) => <Fact key={key} label={label(key)}>{fact ? `${number(fact.value)}; source: ${fact.source}; retrieved: ${fact.retrievedAt}; sample: ${fact.sampleId}` : 'Unavailable'}</Fact>)}
      {(['teamRedZoneTouchdownRate', 'opponentRedZoneTouchdownRate', 'teamRedZoneTripsPerDrive', 'fourthDownAttemptRate'] as const).map(key => {
        const rate = research.opportunity[key];
        return <Fact key={key} label={label(key)}>{rate ? `${rate.rate == null ? 'Unavailable' : `${number(rate.rate * 100)}%`} (${rate.numerator}/${rate.denominator}); source: ${rate.source}; retrieved: ${rate.retrievedAt}; sample: ${rate.sampleId}` : 'Unavailable'}</Fact>;
      })}
      <Fact label="Venue / environment">{weather?.venue?.name ?? 'Unavailable'} / {weather?.environment ?? 'Unavailable'}; indoor: {weather?.venue?.indoor == null ? 'Unavailable' : String(weather.venue.indoor)}</Fact>
      <Fact label="Roof open/closed">Unavailable - indoor designation does not establish roof state</Fact>
      <Fact label="Wind">{weather?.wind ? `${number(weather.wind.speed)} ${weather.wind.unit}` : 'Unavailable'}</Fact>
      <Fact label="Gusts">{weather?.gusts ? `${number(weather.gusts.speed)} ${weather.gusts.unit}` : 'Unavailable'}</Fact>
      <Fact label="Temperature">{weather?.temperature ? `${number(weather.temperature.value)} ${weather.temperature.unit}` : 'Unavailable'}</Fact>
      <Fact label="Precipitation">{weather?.precipitation ? `${number(weather.precipitation.amount)} ${weather.precipitation.unit}` : 'Unavailable'}</Fact>
      <Fact label="Conditions">{weather?.conditions ?? 'Unavailable'}; severe conditions: {weather?.severeConditions.join('; ') || 'Not supplied'}</Fact>
      <Fact label="Weather source status">{weather?.sourceStatus ?? 'Unavailable'}; kickoff: {weather?.kickoff ?? 'Unavailable'}; forecast timestamp: {weather?.forecastTimestamp ?? 'Unavailable'}</Fact>
      <Fact label="Weather sources">Venue: {weather?.sources.venue ?? 'Unavailable'}; forecast: {weather?.sources.forecast ?? 'Unavailable'}; geocode: {weather?.sources.geocode ?? 'Unavailable'}</Fact>
      <Fact label="Player injury/status">{injuries ? `${injuries.player.player}: ${injuries.player.status ?? 'Unavailable'}; designation: ${injuries.player.availabilityDesignation}; injury: ${injuries.player.injury ?? 'Unavailable'}; evidence: ${injuries.player.evidence ?? 'Unavailable'}; source status: ${injuries.player.sourceStatus}; updated: ${injuries.player.updatedAt ?? 'Unavailable'}` : 'Unavailable - no current availability assumed'}</Fact>
      <Fact label="Injury source status">{injuries ? `${injuries.sourceStatus.provider}: ${injuries.sourceStatus.status}; updated: ${injuries.lastUpdated ?? 'Unavailable'}` : 'Unavailable'}</Fact>
      {injuries && [...injuries.teammateAbsences, ...injuries.opponentAbsences].map((entry, index) => <Fact key={`${entry.playerId}-${index}`} label={`${entry.affectedRole} injury/status`}>{entry.player}: {entry.status ?? 'Unavailable'}; {entry.injury ?? 'Unavailable'}; designation: {entry.availabilityDesignation}; source status: {entry.sourceStatus}; updated: {entry.updatedAt ?? 'Unavailable'}</Fact>)}
    </dl>
    <div className="space-y-1 text-xs text-slate-400">
      <h5 className="font-semibold text-slate-300">Unavailable evidence</h5>
      <ul className="space-y-1">
        {research.unavailableEvidence.map(entry => <li key={entry.id}>{label(entry.id)}: {entry.reason ?? 'Unavailable'}; source: {entry.source ?? 'Unavailable'}; retrieved: {entry.retrievedAt ?? 'Unavailable'}</li>)}
        {weather?.missingFields.map(field => <li key={`weather-${field}`}>Weather: {field}</li>)}
        {injuries?.missingFields.map(field => <li key={`injury-${field}`}>Injury: {field}</li>)}
        {injuries?.player.missingFields.map(field => <li key={`player-${field}`}>Player injury: {field}</li>)}
      </ul>
    </div>
    <div className="space-y-1 text-[10px] text-slate-500"><h5>Sources</h5>{sources.map(source => <p key={source}>{source}</p>)}</div>
  </section>;
}