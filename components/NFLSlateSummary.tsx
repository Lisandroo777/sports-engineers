import React from 'react';
import type { NFLSlateLedger } from '../lib/nfl/slateLedger';

const failureReasons: Partial<Record<NonNullable<NFLSlateLedger['games'][number]['failure']>, string>> = {
  CREDIT_BALANCE_UNKNOWN: 'Current provider credit balance could not be verified; no new sportsbook request made',
  DAILY_LIMIT: 'Configured daily refresh limit reached',
  SEARCH_LIMIT: 'Configured search refresh limit reached',
  REFRESH_UNAVAILABLE: 'Refresh verification unavailable',
  REFRESH_NOT_AUTHORIZED: 'Sportsbook refresh not authorized',
  CACHE_ONLY: 'No fresh cached sportsbook data available; authorized refresh required',
  RATE_LIMIT: 'Refresh request rate limit reached',
  EVENT_UNAVAILABLE: 'Sportsbook event not listed',
  STALE_PRICE: 'Quote stale',
  AUTHENTICATION: 'Provider authentication failed',
};

export function NFLSlateSummary({ ledger }: { ledger: NFLSlateLedger }) {
  const missingGames = (ledger.games ?? []).filter((game) => game.eligibility === 'PREGAME' && game.state !== 'RESEARCHED');
  return <div className="space-y-1 text-sm text-slate-300">
    <div className="flex flex-wrap gap-x-4 gap-y-1">
    <span>{ledger.expectedGames} requested games</span>
    <span>{ledger.researchedGames} / {ledger.eligiblePregame} pregame games researched</span>
    {ledger.zeroMarketGames > 0 && <span>{ledger.zeroMarketGames} with no supported markets</span>}
    {ledger.started > 0 && <span>{ledger.started} already started</span>}
    {ledger.final > 0 && <span>{ledger.final} final</span>}
    {ledger.excluded > 0 && <span>{ledger.excluded} excluded</span>}
    {!ledger.researchComplete && <span className="text-amber-300">{ledger.researchedGames > 0 ? 'Partial coverage' : 'Research incomplete'}</span>}
    </div>
    {!ledger.researchComplete && missingGames.length > 0 && <ul className="space-y-1 text-xs text-amber-200">
      {missingGames.map((game) => <li key={game.gameId}>
        {game.matchup}: {game.failure ? failureReasons[game.failure] ?? 'Request failed'
          : game.state === 'ZERO_MARKETS' ? 'No supported markets posted'
          : game.state === 'NOT_FETCHED' ? 'Not fetched' : 'Request failed'}
      </li>)}
    </ul>}
  </div>;
}