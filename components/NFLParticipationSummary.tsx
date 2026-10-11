import React from 'react';
import type { NFLParticipationVerdict } from '../lib/nfl/participation';

export function NFLParticipationSummary({ verdict }: { verdict: NFLParticipationVerdict }) {
  const stage = { EARLY_WEEK: 'Early week', PRACTICE_WEEK: 'Practice week', FINAL_DESIGNATION: 'Pre-game designation window', GAME_DAY: 'Game-day window' }[verdict.stage];
  return <section className="space-y-3 border-t border-white/10 pt-3">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
      <span>Participation: {verdict.designation.replaceAll('_', ' ')}</span>
      <span>Confidence: {verdict.confidence}</span>
      <span>{stage}</span>
      {verdict.depthOrder != null && <span>Depth-chart order: {verdict.depthOrder}</span>}
    </div>
    <div className="space-y-2 text-xs text-slate-400">
      {verdict.evidence.map((entry, index) => <div key={`${entry.source}-${index}`}>
        <p className="text-slate-300">{entry.source.replaceAll('_', ' ')} · {entry.status}</p>
        <p>{entry.detail}</p>
        <p>Observed: {entry.observedAt ?? 'Unavailable'}</p>
      </div>)}
    </div>
    <p className="text-xs text-slate-500">Checked: {verdict.checkedAt} · Expires: {new Date(verdict.expiresAt).toISOString()}</p>
    <p className="text-xs text-slate-500">Unavailable: {verdict.missingEvidence.join(', ')}</p>
  </section>;
}