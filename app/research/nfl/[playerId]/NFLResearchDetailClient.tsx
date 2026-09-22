'use client';

import { useMemo, useState } from 'react';
import { AppSidebar } from '../../../../components/AppSidebar';
import { NFLPlayerAvatar } from '../../../../components/NFLPlayerAvatar';
import type { NFLPlayer, NFLGame, NFLGameLogEntry } from '@/lib/nfl/types';

type RangeKey = 'L3' | 'L5' | 'L10' | 'Season';
const RANGE_OPTIONS: Array<{ key: RangeKey; games: number | null }> = [
  { key: 'L3', games: 3 },
  { key: 'L5', games: 5 },
  { key: 'L10', games: 10 },
  { key: 'Season', games: null },
];

/** Preferred display order per position; only keys actually present in the real game log are ever shown. */
const POSITION_STAT_PRIORITY: Record<string, string[]> = {
  QB: ['passingYards', 'passingTouchdowns', 'completions', 'passingAttempts', 'interceptions', 'rushingYards', 'rushingAttempts'],
  RB: ['rushingYards', 'rushingAttempts', 'receivingYards', 'receptions', 'receivingTargets', 'rushingTouchdowns', 'receivingTouchdowns'],
  WR: ['receivingTargets', 'receptions', 'receivingYards', 'yardsPerReception', 'receivingTouchdowns', 'longReception'],
  TE: ['receivingTargets', 'receptions', 'receivingYards', 'yardsPerReception', 'receivingTouchdowns', 'longReception'],
  // Defensive positions — ESPN's gamelog exposes real per-game tackle/sack/turnover stats for these.
  DL: ['totalTackles', 'sacks', 'stuffs', 'fumblesForced', 'fumblesRecovered', 'passesDefended'],
  DE: ['totalTackles', 'sacks', 'stuffs', 'fumblesForced', 'fumblesRecovered', 'passesDefended'],
  DT: ['totalTackles', 'sacks', 'stuffs', 'fumblesForced', 'fumblesRecovered', 'passesDefended'],
  LB: ['totalTackles', 'soloTackles', 'assistTackles', 'sacks', 'interceptions', 'passesDefended', 'fumblesForced'],
  CB: ['totalTackles', 'interceptions', 'passesDefended', 'interceptionTouchdowns', 'fumblesForced'],
  S: ['totalTackles', 'interceptions', 'passesDefended', 'interceptionTouchdowns', 'fumblesForced'],
  DB: ['totalTackles', 'interceptions', 'passesDefended', 'interceptionTouchdowns', 'fumblesForced'],
  // Kickers/punters — ESPN's public gamelog endpoint currently returns no per-game data for these
  // positions at all (verified directly against the provider), so this list is honest/forward-looking:
  // it will only ever surface keys ESPN actually starts returning, never a fabricated stat.
  PK: ['fieldGoalsMade', 'fieldGoalAttempts', 'extraPointsMade', 'extraPointAttempts', 'longFieldGoal'],
  K: ['fieldGoalsMade', 'fieldGoalAttempts', 'extraPointsMade', 'extraPointAttempts', 'longFieldGoal'],
  P: ['punts', 'puntYards', 'longPunt', 'puntsInside20'],
};

const STAT_LABELS: Record<string, string> = {
  passingYards: 'Pass Yds', passingTouchdowns: 'Pass TD', completions: 'Completions', passingAttempts: 'Attempts',
  interceptions: 'INT', rushingYards: 'Rush Yds', rushingAttempts: 'Rush Att', rushingTouchdowns: 'Rush TD',
  receivingYards: 'Rec Yds', receptions: 'Receptions', receivingTargets: 'Targets', receivingTouchdowns: 'Rec TD',
  yardsPerReception: 'Yds/Rec', longReception: 'Long Rec', completionPct: 'Comp %',
  totalTackles: 'Total Tackles', soloTackles: 'Solo Tackles', assistTackles: 'Assist Tackles', sacks: 'Sacks',
  stuffs: 'Stuffs', fumblesForced: 'Fumbles Forced', fumblesRecovered: 'Fumbles Recovered', passesDefended: 'Passes Defended',
  interceptionTouchdowns: 'Pick-6s', fieldGoalsMade: 'FG Made', fieldGoalAttempts: 'FG Attempts',
  extraPointsMade: 'XP Made', extraPointAttempts: 'XP Attempts', longFieldGoal: 'Long FG',
  punts: 'Punts', puntYards: 'Punt Yds', longPunt: 'Long Punt', puntsInside20: 'Punts Inside 20',
};

function statLabel(key: string) {
  return STAT_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function formatGameTime(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface NFLResearchDetailClientProps {
  player: NFLPlayer;
  gameLog: NFLGameLogEntry[];
  currentGame: NFLGame | null;
}

export default function NFLResearchDetailClient({ player, gameLog, currentGame }: NFLResearchDetailClientProps) {
  const [range, setRange] = useState<RangeKey>('L5');

  const availableStatKeys = useMemo(() => {
    const keys = new Set<string>();
    gameLog.forEach((game) => Object.keys(game.stats).forEach((key) => keys.add(key)));
    const priority = POSITION_STAT_PRIORITY[player.position] ?? [];
    const ordered = priority.filter((key) => keys.has(key));
    const remaining = [...keys].filter((key) => !ordered.includes(key));
    return [...ordered, ...remaining];
  }, [gameLog, player.position]);

  const [selectedStat, setSelectedStat] = useState<string | null>(null);
  const activeStat = selectedStat && availableStatKeys.includes(selectedStat) ? selectedStat : availableStatKeys[0] ?? null;

  const rangeOption = RANGE_OPTIONS.find((option) => option.key === range) ?? RANGE_OPTIONS[1];
  const visibleGames = rangeOption.games ? gameLog.slice(-rangeOption.games) : gameLog;

  const values = activeStat ? visibleGames.map((game) => game.stats[activeStat] ?? 0) : [];
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  const max = values.length ? Math.max(...values) : 0;

  const opponentTeam = currentGame ? (currentGame.homeTeam.id === player.team?.id ? currentGame.awayTeam : currentGame.homeTeam) : null;
  const isHome = currentGame ? currentGame.homeTeam.id === player.team?.id : null;

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
                    <NFLPlayerAvatar headshotUrl={player.headshotUrl} playerName={player.name} size={56} className="rounded-2xl border border-slate-700" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-semibold text-white">{player.name}</h1>
                        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-400">{player.positionName ?? player.position}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                        {player.team && (
                          <div className="flex items-center gap-2">
                            {player.team.logoUrl && <img src={player.team.logoUrl} alt={player.team.displayName} className="h-5 w-5 object-contain" />}
                            <span>{player.team.displayName}</span>
                          </div>
                        )}
                        <span>#{player.jersey ?? '\u2014'}</span>
                        <span>{player.height ?? 'Data unavailable'} {'\u2022'} {player.weight ?? 'Data unavailable'}</span>
                      </div>
                    </div>
                  </div>
                  <span title="Sportsbook lines for NFL aren't connected yet" className="cursor-not-allowed self-start rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-600">
                    Add Pick unavailable
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{activeStat ? statLabel(activeStat) : 'Game log'}</p>
                    <p className="text-xs text-slate-400">{gameLog.length === 0 ? 'No game log data available.' : `${visibleGames.length} games in this window \u2022 Sportsbook line not connected`}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-slate-900/70 p-1 text-xs">
                    {RANGE_OPTIONS.map((option) => (
                      <button key={option.key} onClick={() => setRange(option.key)} className={`rounded-md px-2 py-1 transition ${range === option.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
                        {option.key}
                      </button>
                    ))}
                  </div>
                </div>
                {availableStatKeys.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {availableStatKeys.map((key) => (
                      <button key={key} onClick={() => setSelectedStat(key)} className={`rounded-full px-2.5 py-1 text-xs transition ${activeStat === key ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
                        {statLabel(key)}
                      </button>
                    ))}
                  </div>
                )}
                {gameLog.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">Data unavailable.</p>
                ) : (
                  <div className="mt-4 flex items-end gap-2 overflow-x-auto pb-1">
                    {visibleGames.map((game, index) => (
                      <div key={game.gameId} className="flex min-w-[36px] flex-col items-center gap-1.5" title={`${game.opponentAbbreviation} \u2022 ${formatGameTime(game.date)}`}>
                        <span className="text-[10px] text-slate-400">{values[index]}</span>
                        <div className="w-full rounded-t-md bg-emerald-600/70" style={{ height: `${max > 0 ? Math.max(6, (values[index] / max) * 90) : 6}px` }} />
                        <span className="text-[9px] text-slate-600">{game.opponentAbbreviation || '\u2014'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {activeStat ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-sm font-semibold text-white">Supporting Stats</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Total</p><p className="mt-1 text-sm font-semibold text-white">{total}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Avg/Game</p><p className="mt-1 text-sm font-semibold text-white">{average.toFixed(1)}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Max</p><p className="mt-1 text-sm font-semibold text-white">{max}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Games</p><p className="mt-1 text-sm font-semibold text-white">{visibleGames.length}</p></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {availableStatKeys.slice(0, 6).map((key) => {
                      const keyValues = visibleGames.map((game) => game.stats[key] ?? 0);
                      const keyTotal = keyValues.reduce((sum, value) => sum + value, 0);
                      return (
                        <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                          <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">{statLabel(key)}</p>
                          <p className="mt-1 text-sm font-semibold text-white">{keyValues.length ? (key.toLowerCase().includes('pct') || key.toLowerCase().startsWith('yardsper') ? (keyTotal / keyValues.length).toFixed(1) : keyTotal) : '\u2014'}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-sm font-semibold text-white">Supporting Stats</p>
                  <p className="mt-2 text-sm text-slate-500">Data unavailable — the provider does not currently report per-game stats for this position.</p>
                </div>
              )}
            </section>

            <aside className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
                <p className="text-sm font-semibold text-white">Current Matchup</p>
                {currentGame && opponentTeam ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <div className="flex items-center gap-2">
                      {opponentTeam.logoUrl && <img src={opponentTeam.logoUrl} alt={opponentTeam.displayName} className="h-6 w-6 object-contain" />}
                      <span>{isHome ? 'vs' : '@'} {opponentTeam.displayName}</span>
                    </div>
                    <p className="text-xs text-slate-400">{formatGameTime(currentGame.gameTime)}</p>
                    <p className="text-xs text-slate-500">{currentGame.completed ? `Final: ${currentGame.awayScore}-${currentGame.homeScore}` : 'Scheduled'}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">Data unavailable.</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 shadow-lg shadow-slate-950/30">
                <p className="text-sm font-semibold text-white">Matchup Analysis</p>
                <p className="mt-2 text-sm text-slate-500">Opponent defensive rankings, coverage matchups, and weather are not yet connected. Data unavailable.</p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
