'use client';

import { useMemo, useState } from 'react';
import PropPerformanceChart from '../../../components/PropPerformanceChart';
import { NewsUnavailablePanel } from '../../../components/NewsUnavailablePanel';
import { AddPickButton } from '../../../components/AddPickButton';
import { AppSidebar } from '../../../components/AppSidebar';
import { TeamLogo } from '../../../components/TeamLogo';
import type { GameLogEntry, PropResearchItem, Side } from '../mockData';

type RangeKey = 'L5' | 'L10' | 'L20' | 'L40' | '2026' | '2025';
type SupportingMetric = 'plateAppearances' | 'hits' | 'extraBaseHits' | 'totalBases' | 'runs' | 'rbi';

const rangeOptions: Array<{ key: RangeKey; label: string; value: number | null }> = [
  { key: 'L5', label: 'L5', value: 5 },
  { key: 'L10', label: 'L10', value: 10 },
  { key: 'L20', label: 'L20', value: 20 },
  { key: 'L40', label: 'L40', value: 40 },
  { key: '2026', label: '2026', value: null },
  { key: '2025', label: '2025', value: 12 },
];

const supportingMetricOptions: Array<{ key: SupportingMetric; label: string }> = [
  { key: 'plateAppearances', label: 'PA' },
  { key: 'hits', label: 'Hits' },
  { key: 'extraBaseHits', label: 'XBH' },
  { key: 'totalBases', label: 'TB' },
  { key: 'runs', label: 'Runs' },
  { key: 'rbi', label: 'RBI' },
];

function getHitRateTone(value: number) {
  if (value >= 80) {
    return 'text-emerald-300';
  }

  if (value >= 70) {
    return 'text-emerald-200';
  }

  if (value >= 55) {
    return 'text-amber-300';
  }

  if (value >= 40) {
    return 'text-orange-300';
  }

  return 'text-rose-300';
}

function formatDate(date: string) {
  return date.slice(5).replace('-', '/');
}

function getOpponentLabel(opponent: string) {
  const normalized = opponent.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
  return normalized || 'MLB';
}

function parseLineValue(line: string) {
  const parsed = Number.parseFloat(line);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPlayerStat(entry: GameLogEntry) {
  if (typeof entry.actualStatResult === 'string') {
    const parsed = Number.parseFloat(entry.actualStatResult.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (typeof entry.playerStat === 'number') {
    return entry.playerStat;
  }

  return 0;
}

function getStatValue(entry: GameLogEntry, metric: SupportingMetric) {
  switch (metric) {
    case 'hits': return entry.hits ?? 0;
    case 'extraBaseHits': return entry.extraBaseHits ?? 0;
    case 'totalBases': return entry.totalBases ?? Math.max(0, getPlayerStat(entry));
    case 'runs': return entry.runs ?? 0;
    case 'rbi': return entry.rbi ?? 0;
    case 'plateAppearances':
    default: return entry.plateAppearances ?? 0;
  }
}

function buildInsight(prop: PropResearchItem, visibleGames: GameLogEntry[], side: Side) {
  if (prop.isLive && !prop.hasSportsbookLine) {
    return `${prop.player} has ${visibleGames.length} verified MLB game logs in this window. Betting line unavailable.`;
  }
  const lineValue = parseLineValue(prop.line);
  const hitCount = visibleGames.filter((game) => {
    const statValue = getPlayerStat(game);
    return side === 'Over' ? statValue > lineValue : statValue < lineValue;
  }).length;

  const sampleSize = visibleGames.length;
  const predicate = side === 'Over' ? 'exceeded' : 'stayed below';
  return `${prop.player} has ${predicate} ${prop.line} in ${hitCount} of ${sampleSize} games in this window.`;
}

function getAverage(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getMedian(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

interface ResearchDetailClientProps {
  prop: PropResearchItem;
}

export default function ResearchDetailClient({ prop }: ResearchDetailClientProps) {
  const [selectedRange, setSelectedRange] = useState<RangeKey>('L10');
  const [selectedSide, setSelectedSide] = useState<Side>(prop.researchSide);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<SupportingMetric>('plateAppearances');

  const visibleGames = useMemo(() => {
    const selectedOption = rangeOptions.find((option) => option.key === selectedRange);
    const allGames = prop.gameLog;

    if (!selectedOption) {
      return allGames;
    }

    if (selectedOption.value === null || (prop.isLive && !prop.hasSportsbookLine && selectedRange === '2026')) {
      return allGames;
    }

    return allGames.slice(-selectedOption.value);
  }, [prop.gameLog, selectedRange]);

  const lineValue = parseLineValue(prop.line);

  const hitCount = visibleGames.filter((game) => {
    const statValue = getPlayerStat(game);
    return selectedSide === 'Over' ? statValue > lineValue : statValue < lineValue;
  }).length;

  const hitRate = (prop.isLive && !prop.hasSportsbookLine) ? 0 : visibleGames.length > 0 ? Math.round((hitCount / visibleGames.length) * 100) : 0;
  const hitRecord = (prop.isLive && !prop.hasSportsbookLine) ? '—' : `${hitCount}/${visibleGames.length}`;
  const supportingValues = visibleGames.map((game) => getStatValue(game, selectedMetric));
  const supportingAverage = getAverage(supportingValues);
  const supportingMedian = getMedian(supportingValues);
  // Only real arithmetic on the actually-selected metric's real values — no invented AVG/OBP/SLG/OPS formulas.
  const supportingStats = [
    { label: 'Total', value: supportingValues.reduce((sum, value) => sum + value, 0).toFixed(0) },
    { label: 'Avg/Game', value: supportingAverage.toFixed(2) },
    { label: 'Median', value: supportingMedian.toFixed(2) },
    { label: 'Max', value: (supportingValues.length ? Math.max(...supportingValues) : 0).toFixed(0) },
    { label: 'Games', value: String(supportingValues.length) },
  ];

  const confidenceTone = prop.confidence >= 80 ? 'text-emerald-300' : prop.confidence >= 65 ? 'text-amber-300' : 'text-slate-300';
  const rateTone = getHitRateTone(hitRate);

  const playerImageUrl = prop.playerImageUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect fill="%230f172a" width="120" height="120" rx="24"/><circle cx="60" cy="48" r="24" fill="%2322c55e"/><path d="M32 96c8-16 20-24 28-24s20 8 28 24" fill="%2322c55e"/></svg>';

  const startingPitchers = prop.startingPitchers ?? (prop.isLive ? {
    away: { name: 'Data unavailable', hand: '—', era: '—', whip: '—', kRate: '—', bbRate: '—', hrPer9: '—', baa: '—' },
    home: { name: 'Data unavailable', hand: '—', era: '—', whip: '—', kRate: '—', bbRate: '—', hrPer9: '—', baa: '—' },
  } : {
    away: { name: 'Tanner Houck', hand: 'RHP', era: '3.92', whip: '1.18', kRate: '27.4%', bbRate: '7.1%', hrPer9: '1.02', baa: '.241' },
    home: { name: 'Carlos Rodón', hand: 'LHP', era: '3.74', whip: '1.14', kRate: '29.1%', bbRate: '8.2%', hrPer9: '1.11', baa: '.238' },
  });

  const bullpen = prop.bullpen ?? (prop.isLive ? {
    away: { era: '—', whip: '—', kRate: '—', bbRate: '—', hrPer9: '—', fip: '—', recentUsage: 'Bullpen data unavailable' },
    home: { era: '—', whip: '—', kRate: '—', bbRate: '—', hrPer9: '—', fip: '—', recentUsage: 'Bullpen data unavailable' },
  } : {
    away: { era: '3.68', whip: '1.24', kRate: '24.0%', bbRate: '9.0%', hrPer9: '1.15', fip: '3.94', recentUsage: '7.1 IP / 3 days' },
    home: { era: '3.41', whip: '1.16', kRate: '26.3%', bbRate: '8.7%', hrPer9: '0.96', fip: '3.56', recentUsage: '6.8 IP / 3 days' },
  });

  const lineup = prop.lineup ?? (prop.isLive ? {
    away: [{ player: 'Lineup data unavailable', order: 0, avg: '—', obp: '—', slg: '—', ops: '—', hr: 0, rbi: 0, hand: '—' }],
    home: [{ player: 'Lineup data unavailable', order: 0, avg: '—', obp: '—', slg: '—', ops: '—', hr: 0, rbi: 0, hand: '—' }],
  } : {
    away: [
      { player: 'Jarren Duran', order: 1, avg: '.289', obp: '.344', slg: '.451', ops: '.795', hr: 8, rbi: 31, hand: 'L' },
      { player: 'Rafael Devers', order: 2, avg: '.274', obp: '.347', slg: '.501', ops: '.848', hr: 18, rbi: 44, hand: 'L' },
    ],
    home: [
      { player: prop.player, order: prop.projectedBattingOrder ?? 2, avg: '.285', obp: '.346', slg: '.467', ops: '.813', hr: 14, rbi: 38, hand: 'R' },
    ],
  });

  const weather = prop.weather ?? (prop.isLive
    ? { temperature: '—', conditions: 'Weather data unavailable', windSpeed: '—', windDirection: '', humidity: '—', rainChance: '—' }
    : { temperature: '72°F', conditions: 'Clear', windSpeed: '8 mph', windDirection: 'out to RF', humidity: '61%', rainChance: '10%' });
  const stadium = prop.stadium ?? { name: 'Data unavailable', city: 'Data unavailable', parkFactor: 'Data unavailable' };
  const records = prop.teamRecord ?? (prop.isLive
    ? { away: { name: 'Data unavailable', overall: '—', home: '—', away: '—', last10: '—' }, home: { name: 'Data unavailable', overall: '—', home: '—', away: '—', last10: '—' } }
    : { away: { name: 'Red Sox', overall: '28-30', home: '16-14', away: '12-16', last10: '4-6' }, home: { name: 'Yankees', overall: '37-22', home: '22-9', away: '15-13', last10: '7-3' } });
  const matchupStats = prop.matchupStats ?? (prop.isLive
    ? { awayVsRHP: { avg: '—', obp: '—', slg: '—', ops: '—', kRate: '—', bbRate: '—', hrRate: '—' }, homeVsLHP: { avg: '—', obp: '—', slg: '—', ops: '—', kRate: '—', bbRate: '—', hrRate: '—' } }
    : { awayVsRHP: { avg: '.268', obp: '.337', slg: '.456', ops: '.793', kRate: '22.1%', bbRate: '7.9%', hrRate: '3.4%' }, homeVsLHP: { avg: '.251', obp: '.322', slg: '.431', ops: '.753', kRate: '24.7%', bbRate: '6.8%', hrRate: '2.6%' } });

  return (
    <div className="flex min-h-screen bg-[#060d18] text-slate-50">
      <AppSidebar currentPath="/research" />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1280px] px-3 py-3 lg:px-4 lg:py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_270px]">
          <section className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-slate-950/30">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <img src={playerImageUrl} alt={prop.player} className="h-14 w-14 rounded-2xl border border-slate-700 object-cover" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl font-semibold text-white">{prop.player}</h1>
                      <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-400">{prop.propType}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                      <div className="flex items-center gap-2">
                        <TeamLogo teamId={prop.teamId} teamName={prop.team} size={20} className="rounded-full border border-slate-700" />
                        <span>{prop.team}</span>
                      </div>
                      <span>vs {prop.opponent}</span>
                      <span>{prop.gameTime}</span>
                      <span>{stadium.name}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Line</p>
                    <p className="mt-1 text-sm font-semibold text-white">{prop.line}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Odds</p>
                    <p className="mt-1 text-sm font-semibold text-white">O {prop.overOdds} / U {prop.underOdds}</p>
                    {prop.sportsbookName ? <p className="mt-0.5 text-[10px] text-slate-500">{prop.sportsbookName}{prop.oddsLastUpdate ? ` • ${new Date(prop.oddsLastUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</p> : null}
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Side</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-300">{selectedSide}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Confidence</p>
                    <p className={`mt-1 text-sm font-semibold ${confidenceTone}`}>{prop.isLive ? '—' : `${prop.confidence}%`}</p>
                  </div>
                  {prop.hasSportsbookLine !== false && (prop.overOdds !== 'Unavailable' || prop.underOdds !== 'Unavailable') ? (
                    <AddPickButton id={prop.id} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} opponentName={prop.opponent} gameTime={prop.gameTime} propType={prop.propType} side={selectedSide.toLowerCase() as 'over' | 'under'} line={Number(prop.line)} odds={Number(selectedSide === 'Over' ? prop.overOdds : prop.underOdds)} />
                  ) : (
                    <span title="No sportsbook line is currently posted for this player" className="cursor-not-allowed rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-600">Add Pick unavailable</span>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">Projected PA</p>
                  <p className="mt-1 text-lg font-semibold text-white">{prop.isLive ? 'Data unavailable' : `${prop.projectedPlateAppearances ?? 4.7} PA`}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Projected batting</p>
                  <p className="mt-1 text-sm font-semibold text-white">{prop.isLive ? 'Data unavailable' : `${prop.projectedBattingOrder ?? 2}nd`}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Position</p>
                  <p className="mt-1 text-sm font-semibold text-white">{prop.isLive ? 'Data unavailable' : 'LF / 3B'}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Venue</p>
                  <p className="mt-1 text-sm font-semibold text-white">{stadium.name}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-white">Prop performance</p><p className="text-xs text-slate-400">{(prop.isLive && !prop.hasSportsbookLine) ? `${visibleGames.length} verified game logs • Betting line unavailable` : `${hitRate}% hit rate • ${hitRecord} record`}</p></div><div className="flex items-center gap-1 rounded-lg bg-slate-900/70 p-1 text-xs">{rangeOptions.slice(0, 5).map((option) => <button key={option.key} onClick={() => setSelectedRange(option.key)} className={`rounded-md px-2 py-1 transition ${selectedRange === option.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>{option.label === '2026' ? 'Season' : option.label}</button>)}</div><div className="flex items-center gap-1 rounded-lg bg-slate-900/70 p-1 text-xs"><button onClick={() => setSelectedSide('Over')} className={`rounded-md px-2 py-1 ${selectedSide === 'Over' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'}`}>Over</button><button onClick={() => setSelectedSide('Under')} className={`rounded-md px-2 py-1 ${selectedSide === 'Under' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'}`}>Under</button></div></div>
              <PropPerformanceChart games={visibleGames} line={lineValue} selectedSide={selectedSide} timeRange={selectedRange} hoveredIndex={hoveredIndex} onHoverIndexChange={setHoveredIndex} />
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-white">Supporting Stats</p><p className="text-sm text-slate-400">Compact game-to-game production context.</p></div><div className="flex flex-wrap gap-2">{supportingMetricOptions.map((option) => <button key={option.key} onClick={() => setSelectedMetric(option.key)} className={`rounded-full px-2.5 py-1 text-xs transition ${selectedMetric === option.key ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>{option.label}</button>)}</div></div>
              <div className="mt-3 flex flex-wrap gap-2">{supportingStats.map((stat) => <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{stat.label}</p><p className="mt-1 text-sm font-semibold text-white">{stat.value}</p></div>)}</div>
              <div className="mt-3 flex items-end gap-2 overflow-x-auto pb-1">{supportingValues.map((value, index) => <div key={`${selectedMetric}-${index}`} className="flex min-w-[28px] flex-col items-center gap-2"><div className="w-full rounded-t-full bg-slate-600/70" style={{ height: `${Math.max(12, value * 14)}px` }} /><span className="text-[10px] text-slate-500">{value}</span></div>)}</div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-300"><span className="text-slate-500">Insight</span><span className="text-white">{buildInsight(prop, visibleGames, selectedSide)}</span></div>
        </section>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
            <p className="text-sm font-semibold text-white">Starting Pitchers</p>
            <div className="mt-2 space-y-2">
              {(['away', 'home'] as const).map((side) => (
                <div key={side} className="border-t border-slate-800 pt-2.5 first:border-t-0 first:pt-1">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-950/70 text-[10px] uppercase text-emerald-300">{side === 'away' ? 'A' : 'H'}</div>
                    <div>
                      <p className="text-xs font-semibold text-white">{startingPitchers[side].name}</p>
                      <p className="text-[10px] text-slate-400">{startingPitchers[side].hand} • {side === 'away' ? 'Away' : 'Home'}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-400">
                    <div><p className="text-[9px] uppercase tracking-[0.12em] text-slate-500">ERA</p><p className="mt-0.5 text-xs font-semibold text-white">{startingPitchers[side].era}</p></div>
                    <div><p className="text-[9px] uppercase tracking-[0.12em] text-slate-500">WHIP</p><p className="mt-0.5 text-xs font-semibold text-white">{startingPitchers[side].whip}</p></div>
                    <div><p className="text-[9px] uppercase tracking-[0.12em] text-slate-500">K%</p><p className="mt-0.5 text-xs font-semibold text-white">{startingPitchers[side].kRate}</p></div>
                    <div><p className="text-[9px] uppercase tracking-[0.12em] text-slate-500">BB%</p><p className="mt-0.5 text-xs font-semibold text-white">{startingPitchers[side].bbRate}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Bullpen</p>
              <div className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-400">Last 7</div>
            </div>
            <div className="mt-3 grid gap-2">
              {(['away', 'home'] as const).map((side) => (
                <div key={side} className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{side === 'away' ? 'Away' : 'Home'}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">ERA</p><p className="mt-1 text-sm font-semibold text-white">{bullpen[side].era}</p></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">WHIP</p><p className="mt-1 text-sm font-semibold text-white">{bullpen[side].whip}</p></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">K%</p><p className="mt-1 text-sm font-semibold text-white">{bullpen[side].kRate}</p></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">FIP</p><p className="mt-1 text-sm font-semibold text-white">{bullpen[side].fip}</p></div>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Usage: {bullpen[side].recentUsage}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Lineup</p>
              <div className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-400">Away / Home</div>
            </div>
            <div className="mt-3 space-y-2">
              {(['away', 'home'] as const).map((side) => (
                <div key={side} className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{side === 'away' ? 'Away' : 'Home'}</p>
                  <div className="mt-2 space-y-1.5">
                    {lineup[side].slice(0, 3).map((batter) => (
                      <div key={`${side}-${batter.player}`} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${batter.player === prop.player ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-950/70 text-slate-300'}`}>
                        <div>
                          <p className="font-semibold">{batter.player}</p>
                          <p className="text-[10px] text-slate-500">#{batter.order} • {batter.hand}</p>
                        </div>
                        <div className="text-right">
                          <p>{batter.avg}</p>
                          <p className="text-[10px] text-slate-500">{batter.ops}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
            <p className="text-sm font-semibold text-white">Game Environment</p>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Stadium</p>
                <p className="mt-1 font-semibold text-white">{stadium.name}</p>
                <p className="text-slate-400">{stadium.city}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Weather</p>
                <p className="mt-1 text-white">{weather.temperature} • {weather.conditions}</p>
                <p className="text-slate-400">Wind {weather.windSpeed} {weather.windDirection}</p>
                <p className="text-slate-400">Humidity {weather.humidity} • Rain {weather.rainChance}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Park factor</p>
                <p className="mt-1 text-white">HR Park Factor: {stadium.parkFactor}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
            <p className="text-sm font-semibold text-white">Team Records</p>
            <div className="mt-3 space-y-2">
              {(['home', 'away'] as const).map((side) => (
                <div key={side} className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{records[side].name}</p>
                    <div className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-400">{side === 'home' ? 'Home' : 'Away'}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Overall</p><p className="mt-1 text-sm font-semibold text-white">{records[side].overall}</p></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Home</p><p className="mt-1 text-sm font-semibold text-white">{records[side].home}</p></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Away</p><p className="mt-1 text-sm font-semibold text-white">{records[side].away}</p></div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Last 10</p><p className="mt-1 text-sm font-semibold text-white">{records[side].last10}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
            <p className="text-sm font-semibold text-white">Matchup Splits</p>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{prop.team} vs RHP</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">AVG</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.awayVsRHP.avg}</p></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">OPS</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.awayVsRHP.ops}</p></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">K%</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.awayVsRHP.kRate}</p></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">HR</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.awayVsRHP.hrRate}</p></div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">{prop.opponent} vs LHP</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">AVG</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.homeVsLHP.avg}</p></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">OPS</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.homeVsLHP.ops}</p></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">K%</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.homeVsLHP.kRate}</p></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">HR</p><p className="mt-1 text-sm font-semibold text-white">{matchupStats.homeVsLHP.hrRate}</p></div>
                </div>
              </div>
            </div>
          </div>
          <NewsUnavailablePanel />
        </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
