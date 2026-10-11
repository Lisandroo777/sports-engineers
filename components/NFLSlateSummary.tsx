import React from 'react';
import type { NFLSlateLedger } from '../lib/nfl/slateLedger';

export function NFLSlateSummary({ ledger }: { ledger: NFLSlateLedger }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
    <span>{ledger.expectedGames} requested games</span>
    <span>{ledger.researchedGames} / {ledger.eligiblePregame} pregame games researched</span>
    {ledger.zeroMarketGames > 0 && <span>{ledger.zeroMarketGames} with no supported markets</span>}
    {ledger.started > 0 && <span>{ledger.started} already started</span>}
    {ledger.final > 0 && <span>{ledger.final} final</span>}
    {ledger.excluded > 0 && <span>{ledger.excluded} excluded</span>}
    {!ledger.researchComplete && <span className="text-amber-300">Research incomplete</span>}
  </div>;
}