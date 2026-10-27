'use client';

import { useRef, useState } from 'react';
import { PlayerHeadshot } from './PlayerHeadshot';
import type { PickPresentation, PresentedPick, PresentationTier } from '../lib/nba/presentation';

export type NBAClientPresentation = PickPresentation & { recommendedCandidateIds?: string[] };

const tierStyles: Record<PresentationTier, string> = {
  NUKE: 'border-amber-300/55 text-amber-200',
  ELITE: 'border-emerald-400/30 text-emerald-300',
  SHARP: 'border-cyan-400/25 text-cyan-200',
  EDGE: 'border-sky-400/20 text-sky-200',
  LEAN: 'border-white/15 text-slate-300',
  PASS: 'border-rose-400/20 text-rose-200',
};

function isPriced(pick: PresentedPick): boolean {
  return pick.pricing.state === 'PRICED' && pick.pricing.sportsbook != null && pick.pricing.americanOdds != null
    && Number.isFinite(pick.pricing.americanOdds) && ['CURRENT', 'FRESH', 'LIVE'].includes(pick.pricing.quoteStatus ?? '');
}

function isSupportedPhase(pick: PresentedPick): boolean {
  return pick.season.certainty === 'VERIFIED' && ['REGULAR', 'PLAY_IN', 'POSTSEASON'].includes(pick.season.phase ?? '');
}

function marketLabel(pick: PresentedPick): string {
  const { subject } = pick;
  const line = subject.market.line;
  if (subject.kind === 'PLAYER_PROP') return `${subject.market.label} ${subject.market.side}${line == null ? '' : ` ${line}`}`;
  const team = subject.market.team === 'HOME' ? subject.home.name : subject.market.team === 'AWAY' ? subject.away.name : '';
  if (subject.market.type === 'MONEYLINE') return `${subject.market.label} · ${team || (subject.market.selection === 'HOME' ? subject.home.name : subject.away.name)}`;
  if (subject.market.type === 'SPREAD') return `${subject.market.label} · ${team || (subject.market.selection === 'HOME' ? subject.home.name : subject.away.name)}${line == null ? '' : ` ${line >= 0 ? '+' : ''}${line}`}`;
  if (line == null) return subject.market.label;
  return `${subject.market.label}${subject.market.type === 'TEAM_TOTAL' ? ` · ${team}` : ''} ${subject.market.selection.toLowerCase()} ${line}`;
}

function Card({ pick, recommended }: { pick: PresentedPick; recommended: boolean }) {
  const tier = pick.tierDecision?.pickTier;
  const priced = isPriced(pick);
  const unsupported = pick.disposition === 'RESEARCH_ONLY' || !priced || !isSupportedPhase(pick);
  const name = pick.subject.kind === 'PLAYER_PROP' ? pick.subject.player.name : `${pick.subject.away.name} @ ${pick.subject.home.name}`;
  const status = pick.pricing.quoteStatus === 'STALE' ? 'STALE PRICE · RESEARCH ONLY'
    : !priced ? 'UNPRICED · RESEARCH ONLY' : recommended ? 'RECOMMENDED' : pick.disposition === 'PASS' ? 'PASS · NOT A WAGER' : 'RESEARCH ONLY';
  return <article data-candidate-id={pick.candidateId} data-market-key={pick.subject.market.key} data-tier={tier ?? 'RESEARCH_ONLY'} className={`min-w-0 space-y-3 rounded-lg border bg-white/3 p-4 ${tier ? tierStyles[tier] : 'border-white/10 text-slate-300'}`}>
    <div className="flex items-center gap-3">
      {pick.subject.kind === 'PLAYER_PROP' ? <PlayerHeadshot sport="NBA" playerId={pick.subject.player.id} playerName={name} size={40} />
        : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">NBA</span>}
      <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-bold text-white">{name}</h3>
        {pick.subject.kind === 'PLAYER_PROP' && <p className="text-xs text-slate-400">{pick.subject.player.team ?? 'Team unverified'}</p>}
      </div>
      {tier && <span className="shrink-0 text-xs font-black">{tier}</span>}
    </div>
    <p className="break-words text-base font-bold text-white">{marketLabel(pick)}</p>
    <p className={`text-xs font-bold ${recommended ? 'text-emerald-300' : 'text-amber-200'}`}>{status}</p>
    <p className="break-words text-sm text-slate-200">{priced ? `${pick.pricing.sportsbook} · ${pick.pricing.americanOdds! > 0 ? '+' : ''}${pick.pricing.americanOdds}` : 'Verified sportsbook price unavailable'}</p>
    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
      <div><dt className="text-slate-400">Probability</dt><dd>{!unsupported && pick.metrics.trueProbability != null ? `${pick.metrics.trueProbability.toFixed(1)}%` : 'Unavailable'}</dd></div>
      <div><dt className="text-slate-400">EV</dt><dd>{!unsupported && pick.metrics.evPercent != null ? `${pick.metrics.evPercent.toFixed(1)}%` : 'Unavailable'}</dd></div>
      <div><dt className="text-slate-400">Research score</dt><dd>{!unsupported && pick.metrics.researchScore != null ? `${pick.metrics.researchScore}/100` : 'Unavailable'}</dd></div>
    </dl>
    <p className="text-xs text-slate-400">{pick.season.phase ?? 'UNKNOWN'} · {pick.season.certainty} · UNVALIDATED</p>
    {pick.season.reason && <p className="text-xs text-slate-400">{pick.season.reason}</p>}
    {pick.tierDecision && <p className="break-words text-xs text-slate-300">{pick.tierDecision.tierReason}</p>}
    <details className="text-xs text-slate-300"><summary className="cursor-pointer py-1">Evidence and risks</summary>
      <ul className="mt-2 list-disc space-y-2 pl-4">{pick.researchEvidence.map(entry => <li key={entry.id} className="break-words">
        <span className={entry.stance === 'COUNTER' ? 'text-amber-200' : ''}>{entry.detail}</span>
        {entry.observedAt && <p className="mt-1 text-slate-400">Observed: {entry.observedAt}</p>}
        {entry.source && <p className="break-all text-slate-500">{entry.source}</p>}
      </li>)}{[...new Set([...pick.missing, ...(pick.tierDecision?.tierRequirementsFailed ?? [])])].map((reason, index) => <li key={`missing.${index}`} className="break-words text-amber-200">{reason}</li>)}</ul>
    </details>
  </article>;
}

export const NBA_CARD_PAGE_SIZE = 20;

function PaginatedCards({ picks, recommended }: { picks: PresentedPick[]; recommended: boolean }) {
  const [page, setPage] = useState(0);
  const section = useRef<HTMLDivElement>(null);
  const lastPage = Math.max(0, Math.ceil(picks.length / NBA_CARD_PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const start = current * NBA_CARD_PAGE_SIZE;
  const label = recommended ? 'Recommendation pages' : 'Research pages';
  function go(next: number) {
    setPage(next);
    section.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  const navigation = picks.length > NBA_CARD_PAGE_SIZE && <nav aria-label={label} className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-y border-white/10 py-2 text-xs text-slate-300">
    <span role="status" aria-live="polite">{start + 1}-{Math.min(start + NBA_CARD_PAGE_SIZE, picks.length)} of {picks.length.toLocaleString()} outcomes</span>
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous page" title="Previous page" disabled={current === 0} onClick={() => go(current - 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 text-lg hover:bg-white/10 disabled:opacity-30">&larr;</button>
      <label className="flex items-center gap-2">Page
        <input key={current} type="number" min={1} max={lastPage + 1} step={1} defaultValue={current + 1}
          aria-label={recommended ? 'Recommendation page' : 'Research page'}
          onBlur={event => { const next = event.currentTarget.valueAsNumber; if (Number.isInteger(next) && next >= 1 && next <= lastPage + 1) go(next - 1); }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
          className="h-9 w-16 rounded-md border border-white/15 bg-[#050b18] px-2 text-white" />
        <span>of {lastPage + 1}</span>
      </label>
      <button type="button" aria-label="Next page" title="Next page" disabled={current === lastPage} onClick={() => go(current + 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 text-lg hover:bg-white/10 disabled:opacity-30">&rarr;</button>
    </div>
  </nav>;
  return <div ref={section} className="min-w-0 scroll-mt-4 space-y-3">
    {navigation}
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{picks.slice(start, start + NBA_CARD_PAGE_SIZE).map(pick => <Card key={pick.candidateId} pick={pick} recommended={recommended} />)}</div>
    {navigation}
  </div>;
}

export function NBAPresentationCards({ presentation }: { presentation: NBAClientPresentation }) {
  const selected = new Set(presentation.recommendedCandidateIds ?? presentation.picks.filter(pick => pick.disposition === 'RECOMMENDED').map(pick => pick.candidateId));
  const recommended = presentation.picks.filter(pick => selected.has(pick.candidateId) && pick.tierDecision != null
    && pick.tierDecision.pickTier !== 'PASS' && pick.disposition !== 'RESEARCH_ONLY' && isPriced(pick) && isSupportedPhase(pick));
  const ids = new Set(recommended.map(pick => pick.candidateId));
  const research = presentation.picks.filter(pick => !ids.has(pick.candidateId));
  return <div className="space-y-6" data-nba-presentation={presentation.schemaVersion}>
    {recommended.length > 0 && <section className="space-y-3"><h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Recommendations</h2>
      <PaginatedCards key={`recommended.${presentation.requestedSort}.${recommended[0]?.candidateId}.${recommended.length}`} picks={recommended} recommended /></section>}
    {research.length > 0 && <section className="space-y-3 border-t border-white/10 pt-4"><h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Research candidates · Not recommended wagers</h2>
      <PaginatedCards key={`research.${presentation.requestedSort}.${research[0]?.candidateId}.${research.length}`} picks={research} recommended={false} /></section>}
    {presentation.picks.length === 0 && <p role="status" className="text-sm text-slate-300">No qualified NBA picks or researched candidates are available for this slate.</p>}
  </div>;
}