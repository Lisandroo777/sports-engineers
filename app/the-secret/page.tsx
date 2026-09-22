'use client';

import { useMemo, useState } from 'react';
import { AddPickButton } from '../../components/AddPickButton';
import { AppSidebar } from '../../components/AppSidebar';
import { NewsAlertsPanel } from '../../components/NewsAlertsPanel';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { propResearchData, type PropResearchItem } from '../research/mockData';

const SECRET_IDS = ['aaron-judge-home-runs', 'shohei-ohtani-total-bases'];

function secretScore(prop: PropResearchItem) {
  return Math.min(99, Math.round(prop.confidence * 0.65 + prop.projectedValue * 3.5));
}

function tier(score: number) {
  if (score >= 95) return 'Exceptional Setup';
  if (score >= 90) return 'Elite Secret';
  if (score >= 85) return 'Strong Secret';
  return 'Qualified';
}

function odds(value: string) {
  return Number(value.replace('+', '')) || -110;
}

function EvidenceCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="theme-panel p-4">
      <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--se-muted)]">{label}</p><span className="text-[10px] font-semibold text-[var(--se-green)]">+</span></div>
      <p className="mt-3 text-sm font-bold text-white">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--se-muted)]">{detail}</p>
    </article>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-t border-[var(--se-border)] pt-5"><h3 className="text-xs font-bold uppercase tracking-[0.22em] text-white">{title}</h3><div className="mt-3">{children}</div></section>;
}

function SecretDetail({ prop, onBack }: { prop: PropResearchItem; onBack: () => void }) {
  const score = secretScore(prop);
  const pitcher = prop.startingPitchers?.away;
  const bullpen = prop.bullpen?.home;
  const edge = prop.projectedValue - Number(prop.line);
  const reasons = prop.researchFactors.filter((factor) => factor.impact === 'positive').slice(0, 6);

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="text-xs font-semibold text-[var(--se-green)] hover:text-white">← Back to all Secrets</button>
      <section className="theme-panel p-5 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4"><PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={72} /><div><p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--se-green)]">The Secret</p><h1 className="mt-2 text-3xl font-black text-white">{prop.player}</h1><p className="mt-1 text-sm text-[var(--se-muted)]">{prop.team} vs {prop.opponent} · {prop.gameTime}</p></div></div>
          <div className="flex items-center gap-4"><div className="text-center"><p className="text-[10px] uppercase tracking-wider text-[var(--se-muted)]">Secret Score</p><p className="mt-1 text-4xl font-black text-[var(--se-green)]">{score}<span className="text-base text-[var(--se-muted)]">/100</span></p><p className="text-[10px] text-[var(--se-muted)]">Research strength, not win probability</p></div><AddPickButton id={prop.id} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} opponentName={prop.opponent} gameTime={prop.gameTime} propType={prop.propType} side={prop.researchSide.toLowerCase() as 'over' | 'under'} line={Number(prop.line)} odds={odds(prop.overOdds)} /></div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3"><EvidenceCard label="The play" value={`${prop.researchSide} ${prop.line} ${prop.propType}`} detail="Curated from the current research board." /><EvidenceCard label="Market line" value={prop.line} detail={`Current ${prop.researchSide.toLowerCase()} market.`} /><EvidenceCard label="DeepSide Projection" value={`${prop.projectedValue.toFixed(1)} ${prop.propType}`} detail="Model projection available in the research record." /></div>
      </section>
      <section className="theme-panel space-y-5 p-5 sm:p-7">
        <DetailSection title="The Verdict"><p className="max-w-3xl text-sm leading-7 text-[var(--se-muted)]">{prop.aiAnalysis.summary} {prop.rationale ?? ''} This is a research-strength assessment, not a guarantee of the outcome.</p></DetailSection>
        <DetailSection title="Why It Made the Secret"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{reasons.length > 0 ? reasons.map((reason) => <EvidenceCard key={reason.label} label={reason.label} value="Supported" detail={reason.detail} />) : <EvidenceCard label="Research standard" value="Qualified" detail="This play cleared the current confidence and projected-value threshold." />}</div></DetailSection>
        <DetailSection title="Recent Performance"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['L5', prop.hitRates.last5], ['L10', prop.hitRates.last10], ['L20', prop.hitRates.last20], ['Season', prop.hitRates.season]].map(([label, value]) => <div key={label} className="theme-panel p-3 text-center"><p className="text-[10px] text-[var(--se-muted)]">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}%</p></div>)}</div><p className="mt-3 text-xs text-[var(--se-muted)]">Recent performance is one input among matchup, opportunity, environment, and market context.</p></DetailSection>
        <DetailSection title="Matchup"><div className="grid gap-3 sm:grid-cols-2"><EvidenceCard label="Opponent profile" value={prop.matchup.opponentDefensiveRanking} detail={prop.matchup.opponentAllowedAverage} /><EvidenceCard label="Game environment" value={prop.matchup.difficulty} detail={prop.matchup.paceEnvironment} /></div></DetailSection>
        {pitcher && <DetailSection title="Starting Pitcher"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><EvidenceCard label="Pitcher" value={pitcher.name} detail={`${pitcher.hand} · BAA ${pitcher.baa}`} /><EvidenceCard label="ERA / WHIP" value={`${pitcher.era} / ${pitcher.whip}`} detail="Available starter indicators." /><EvidenceCard label="K% / BB%" value={`${pitcher.kRate} / ${pitcher.bbRate}`} detail="Strikeout and walk profile." /><EvidenceCard label="HR rate" value={pitcher.hrPer9} detail="Home runs allowed per nine." /></div></DetailSection>}
        {bullpen && <DetailSection title="Bullpen"><EvidenceCard label="Expected exposure" value={bullpen.recentUsage} detail={`ERA ${bullpen.era} · FIP ${bullpen.fip} · WHIP ${bullpen.whip}`} /></DetailSection>}
        {prop.weather && prop.stadium && <DetailSection title="Ballpark & Weather"><div className="grid gap-3 sm:grid-cols-2"><EvidenceCard label="Park" value={prop.stadium.name} detail={`${prop.stadium.city} · Park factor ${prop.stadium.parkFactor}`} /><EvidenceCard label="Weather" value={`${prop.weather.temperature} · ${prop.weather.conditions}`} detail={`Wind ${prop.weather.windSpeed} ${prop.weather.windDirection} · Rain ${prop.weather.rainChance}`} /></div></DetailSection>}
        <DetailSection title="Market Intelligence"><div className="grid gap-3 sm:grid-cols-3"><EvidenceCard label="Current odds" value={prop.overOdds} detail={`${prop.researchSide} market.`} /><EvidenceCard label="Research edge" value={`${edge >= 0 ? '+' : ''}${edge.toFixed(1)}`} detail="Projection minus current market line." /><EvidenceCard label="What the market may be missing" value={prop.rationale ? 'Underlying context' : 'No extra claim'} detail={prop.rationale ?? 'No additional market interpretation is available.'} /></div></DetailSection>
      </section>
    </div>
  );
}

export default function TheSecretPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const secrets = useMemo(() => propResearchData.filter((prop) => prop.sport === 'MLB' && SECRET_IDS.includes(prop.id)), []);
  const selected = secrets.find((prop) => prop.id === selectedId);

  return (
    <div className="flex min-h-screen bg-[var(--se-bg)] text-[var(--se-text)]"><AppSidebar currentPath="/the-secret" /><main className="flex-1 overflow-y-auto px-5 py-6 lg:px-8 lg:py-8"><div className="mx-auto grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0">{selected ? <SecretDetail prop={selected} onBack={() => setSelectedId(null)} /> : <><header className="mb-6"><p className="text-4xl font-black tracking-tight text-white sm:text-5xl">THE <span className="text-[var(--se-green)]">SECRET</span> ✦</p><p className="mt-2 text-sm text-[var(--se-muted)]">Where our strongest research makes the cut.</p></header><section className="theme-panel mb-6 p-5"><h2 className="text-sm font-bold text-white">Not every day has a Secret.</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--se-muted)]">We don&apos;t force picks just to fill the board. A play only appears when our research finds an unusually strong combination of matchup, performance, market and game-context signals.</p><p className="mt-3 text-xs font-semibold text-[var(--se-green)]">Nothing is guaranteed. When no play meets our standards, we publish nothing.</p></section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Today&apos;s Secrets</h2><span className="text-xs text-[var(--se-muted)]">{secrets.length} {secrets.length === 1 ? 'play' : 'plays'} made the cut</span></div>{secrets.length === 0 ? <section className="theme-panel p-10 text-center"><h3 className="text-lg font-bold text-white">No plays made the cut today.</h3><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--se-muted)]">Our models and research didn&apos;t find a setup strong enough to publish. We&apos;d rather show nothing than force a play.</p><p className="mt-4 text-xs text-[var(--se-muted)]">Check back as lineups, injuries, weather and markets develop.</p></section> : <div className="space-y-3">{secrets.map((prop, index) => { const score = secretScore(prop); return <button type="button" key={prop.id} onClick={() => setSelectedId(prop.id)} className="theme-panel block w-full p-4 text-left transition hover:-translate-y-px hover:border-[var(--se-border-strong)]"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3 sm:w-64"><span className="text-lg font-black text-[var(--se-green)]">#{index + 1}</span><PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={52} /><div><p className="font-bold text-white">{prop.player}</p><p className="text-xs text-[var(--se-muted)]">{prop.team} · {prop.opponent}</p></div></div><div className="flex-1"><p className="text-sm font-bold uppercase text-[var(--se-green)]">{prop.researchSide} {prop.line} {prop.propType}</p><p className="mt-1 text-xs text-[var(--se-muted)]">{prop.gameTime} · {prop.rationale ?? 'Multiple research factors aligned.'}</p></div><div className="text-left sm:text-right"><p className="text-[9px] uppercase tracking-wider text-[var(--se-muted)]">Secret Score</p><p className="text-2xl font-black text-white">{score}<span className="text-sm text-[var(--se-muted)]">/100</span></p><p className="text-[10px] text-[var(--se-green)]">{tier(score)}</p></div><span className="shrink-0 rounded-xl border border-[var(--se-border-strong)] bg-[var(--se-green-soft)] px-3 py-2 text-xs font-semibold text-[var(--se-green)]">View The Reasoning →</span></div></button>; })}</div>}</>}</div><div className="space-y-5"><NewsAlertsPanel context={['Judge', 'Ohtani', 'Yankees', 'Dodgers']} /></div></div></main></div>
  );
}
