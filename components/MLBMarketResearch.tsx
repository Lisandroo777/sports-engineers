import type { ReactNode } from 'react';
import type { researchMLBGameMarkets } from '../lib/mlb/gameMarkets';
import type { MLBResearchContext } from '../lib/mlb/researchContext';

export type MLBGameMarketResearch = Awaited<ReturnType<typeof researchMLBGameMarkets>>;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-[10px] uppercase text-slate-500">{label}</dt><dd className="mt-1 text-xs text-slate-300 [overflow-wrap:anywhere]">{children}</dd></div>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

export function MLBGameCoverage({ coverage }: { coverage: unknown }) {
  const summary = record(coverage);
  const games = Array.isArray(coverage) ? coverage : Array.isArray(summary?.games) ? summary.games : Array.isArray(summary?.events) ? summary.events : [];
  if (coverage == null) return null;
  return <section aria-label="MLB game coverage" className="min-w-0 space-y-2 border-t border-white/10 py-3 [overflow-wrap:anywhere]">
    <h3 className="text-xs font-bold text-slate-300">MLB game coverage</h3>
    {summary && <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
      {Object.entries(summary).filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean').map(([key, value]) => <Fact key={key} label={key.replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ')}>{String(value).replaceAll('_', ' ')}</Fact>)}
    </dl>}
    {games.length === 0 && <p className="text-xs text-slate-400">Per-game fetch status unavailable.</p>}
    {games.map((raw, index) => {
      const game = record(raw) ?? {};
      const event = record(game.event) ?? game;
      const label = text(game.matchup) ?? text(game.label) ?? ([text(event.awayTeam), text(event.homeTeam)].filter(Boolean).join(' at ') || text(game.gameId) || text(event.id) || `Game ${index + 1}`);
      const status = text(game.status) ?? text(game.fetchStatus) ?? text(game.marketStatus) ?? 'not_fetched';
      return <div key={`${text(game.gameId) ?? text(event.id) ?? index}`} className="min-w-0 border-b border-white/5 pb-2 text-xs text-slate-400">
        <p className="font-semibold text-slate-300">{label}</p>
        <p>Status: {status === 'NOT_LISTED' ? 'not listed - sportsbook event unavailable; markets not fetched' : status.replaceAll('_', ' ').toLowerCase()}</p>
        {text(game.reason) && <p>{text(game.reason)}</p>}
        {text(game.message) && <p>{text(game.message)}</p>}
      </div>;
    })}
  </section>;
}

export function MLBContextFacts({ context }: { context: MLBResearchContext }) {
  const injuries = context.playerInjuries.status === 'AVAILABLE'
    ? context.playerInjuries.value.filter(player => player.explicitlyInjured === true || player.description != null || player.code != null)
    : [];
  return <section aria-label="MLB source facts" className="mt-3 min-w-0 space-y-3 border-y border-white/8 py-3 [overflow-wrap:anywhere]">
    <h4 className="text-xs font-bold text-slate-300">MLB source facts</h4>
    <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {(['away', 'home'] as const).map(side => <Fact key={`pitcher-${side}`} label={`${side} probable pitcher`}>{context.probablePitchers[side].status === 'AVAILABLE' ? `${context.probablePitchers[side].value.fullName} (probable, not confirmed)` : 'Unavailable'}</Fact>)}
      {(['away', 'home'] as const).map(side => <Fact key={`lineup-${side}`} label={`${side} lineup`}>{context.confirmedLineups[side].status === 'AVAILABLE'
        ? `Confirmed feed batting order: ${context.confirmedLineups[side].value.map(player => `${player.battingOrder}. ${player.fullName}`).join('; ')}`
        : 'Unavailable - no confirmed batting order supplied'}</Fact>)}
      <Fact label="Explicit player injury/status data">{injuries.length > 0 ? injuries.map(player => `${player.name}: ${[player.code, player.description, player.explicitlyInjured === true ? 'explicit injury flag' : null].filter(Boolean).join(' / ')}`).join('; ') : 'Unavailable - no explicit injury/status details supplied'}</Fact>
      <Fact label="Observed weather (not a forecast)">{context.weather.status === 'AVAILABLE' ? [context.weather.value.condition, context.weather.value.temperatureF == null ? null : `${context.weather.value.temperatureF} F`, context.weather.value.wind].filter(Boolean).join(' / ') || 'Unavailable' : 'Unavailable'}</Fact>
      <Fact label="Park">{context.venue.status === 'AVAILABLE' ? [context.venue.value.name, context.venue.value.roofType == null ? null : `Roof type: ${context.venue.value.roofType} (open/closed state unknown)`].filter(Boolean).join(' / ') || 'Unavailable' : 'Unavailable'}</Fact>
      <Fact label="Bullpen workload">Unavailable - {context.bullpenWorkload.dataQualityNote}</Fact>
    </dl>
    <p className="text-[10px] text-slate-500">{context.dataQualityNote}</p>
    <p className="text-[10px] text-slate-500">Retrieved: {context.retrievedAt} · Source timestamp: {context.sourceTimestamp ?? 'Unavailable'}</p>
    {context.sources.map(source => <p key={source} className="text-[10px] text-slate-500">Source: {source}</p>)}
  </section>;
}

export function MLBMarketResearch({ research, coverage, meta }: { research: MLBGameMarketResearch; coverage?: unknown; meta?: Record<string, unknown> | null }) {
  return <section aria-label="MLB game-market quote research" className="min-w-0 max-w-full space-y-4 border-t border-white/10 py-4 [overflow-wrap:anywhere]">
    <header className="space-y-2">
      <h2 className="text-sm font-bold text-white">MLB game-market quotes</h2>
      <p className="text-sm font-bold text-amber-200">Not a recommendation</p>
      <dl className="grid grid-cols-2 gap-3"><Fact label="Model probability">Unavailable</Fact><Fact label="Edge">Unavailable</Fact></dl>
      {meta?.partialCoverage === true && <p className="text-xs text-amber-200">Partial quote coverage - missing or blocked markets are not researched rejections.</p>}
      {typeof meta?.gamesEligible === 'number' && typeof meta?.eventsMatched === 'number' && meta.gamesEligible > meta.eventsMatched && <p className="text-xs text-slate-400">{meta.gamesEligible - meta.eventsMatched} eligible games without matched sportsbook events - markets not fetched.</p>}
      {typeof meta?.status === 'string' && <p className="text-xs text-slate-400">Quote scope status: {meta.status.replaceAll('_', ' ').toLowerCase()}</p>}
    </header>
    <MLBGameCoverage coverage={coverage} />
    {research.events.map(result => <div key={result.event.id} className="min-w-0 border-b border-white/10 pb-3 text-xs text-slate-400">
      <p className="font-semibold text-slate-300">{result.event.awayTeam} at {result.event.homeTeam}</p>
      <p>Status: {result.status === 'empty' ? 'No markets posted' : result.status}</p>
      {result.issues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.code.replaceAll('_', ' ')}: {issue.message}</p>)}
      {result.missingMarkets.length > 0 && <p>Missing markets: {result.missingMarkets.join(', ')}</p>}
    </div>)}
    {research.quotes.length === 0 && <p className="text-sm text-slate-400">No game-market quotes available. This is not a researched rejection.</p>}
    <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
      {research.quotes.map((quote, index) => <article key={`${quote.eventId}-${quote.marketKey}-${quote.sportsbookKey}-${index}`} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.025] p-3">
        <p className="text-xs text-slate-400">{quote.awayTeam} at {quote.homeTeam}</p>
        <h3 className="mt-1 text-sm font-bold text-white">{quote.selection}{quote.team && quote.team !== quote.selection ? ` · ${quote.team}` : ''}</h3>
        <p className="mt-1 text-xs font-semibold text-amber-200">Not a recommendation</p>
        <dl className="mt-3 grid min-w-0 grid-cols-2 gap-3">
          <Fact label="Market">{quote.marketKey}</Fact><Fact label="Period">{quote.period.replaceAll('_', ' ')}</Fact>
          <Fact label="Outcome">{quote.outcome}</Fact><Fact label="Line">{quote.line ?? 'Not applicable'}</Fact>
          <Fact label="Sportsbook">{quote.sportsbookName} ({quote.sportsbookKey})</Fact><Fact label="American odds">{quote.americanOdds > 0 ? '+' : ''}{quote.americanOdds}</Fact>
          <Fact label="Implied probability">{Number.isFinite(quote.impliedProbability) ? `${Number((quote.impliedProbability * 100).toFixed(6))}%` : 'Unavailable'}</Fact>
          <Fact label="Settlement">{quote.settlement.replaceAll('_', ' ')}</Fact>
          <Fact label="Model probability">Unavailable</Fact><Fact label="Edge">Unavailable</Fact>
          <Fact label="Quote updated">{quote.lastUpdate ?? 'Unavailable'}</Fact><Fact label="Alternate line">{quote.isAlternate ? 'Yes' : 'No'}</Fact>
        </dl>
        <p className="mt-3 text-[10px] text-slate-500">{quote.reason}</p>
      </article>)}
    </div>
  </section>;
}