import React from 'react';
import type { NFLSlateLedger } from '../lib/nfl/slateLedger';

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
        {game.matchup}: {game.failure === 'EVENT_UNAVAILABLE' ? 'Sportsbook event not listed'
          : game.failure === 'STALE_PRICE' ? 'Quote stale'
          : game.failure === 'AUTHENTICATION' ? 'Provider authentication failed'
          : game.failure ? 'Request failed'
          : game.state === 'ZERO_MARKETS' ? 'No supported markets posted'
          : game.state === 'NOT_FETCHED' ? 'Not fetched' : 'Request failed'}
      </li>)}
    </ul>}
  </div>;
}