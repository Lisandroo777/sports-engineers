'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameLogEntry, Side } from '../app/research/mockData';

type RangeKey = 'L5' | 'L10' | 'L20' | 'L40' | '2026' | '2025';

interface PropPerformanceChartProps {
  games: GameLogEntry[];
  line: number;
  selectedSide: Side;
  timeRange: RangeKey;
  hoveredIndex: number | null;
  onHoverIndexChange: (index: number | null) => void;
}

function formatDate(date: string) { return date.slice(5).replace('-', '/'); }
function getOpponentLabel(opponent: string) { return opponent.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'MLB'; }
function getPlayerStat(entry: GameLogEntry) {
  if (typeof entry.actualStatResult === 'string') {
    const parsed = Number.parseFloat(entry.actualStatResult.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return typeof entry.playerStat === 'number' ? entry.playerStat : 0;
}

export default function PropPerformanceChart({ games, line, selectedSide, timeRange, hoveredIndex, onHoverIndexChange }: PropPerformanceChartProps) {
  const [animatedHeights, setAnimatedHeights] = useState<number[]>([]);
  const [animatedOpacity, setAnimatedOpacity] = useState<number[]>([]);
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; game: GameLogEntry | null }>({ visible: false, x: 0, y: 0, game: null });
  const chartRef = useRef<HTMLDivElement>(null);
  const chartMaxValue = useMemo(() => Math.max(1, ...games.map(getPlayerStat), line > 0 ? line : 0), [games, line]);
  const yAxisMax = Math.max(2, Math.ceil(chartMaxValue) + 1);
  const yAxisValues = useMemo(() => Array.from({ length: yAxisMax + 1 }, (_, index) => yAxisMax - index), [yAxisMax]);
  const chartTopPadding = 24;
  const chartBottomPadding = 70;
  const chartHeight = 300;
  const plotHeight = chartHeight - chartTopPadding - chartBottomPadding;
  const barAreaHeight = chartHeight - 90;
  const getYPosition = (value: number) => value <= 0 ? chartTopPadding + plotHeight : chartTopPadding + (1 - value / yAxisMax) * plotHeight;
  const propLinePosition = line > 0 ? getYPosition(line) : getYPosition(0);

  useEffect(() => {
    const nextHeights = games.map((game) => { const value = getPlayerStat(game); return value <= 0 ? 0 : Math.max(10, Math.round((value / yAxisMax) * plotHeight)); });
    setAnimatedHeights(Array(games.length).fill(0));
    setAnimatedOpacity(Array(games.length).fill(0.18));
    const timeoutId = window.setTimeout(() => { setAnimatedHeights(nextHeights); setAnimatedOpacity(Array(games.length).fill(1)); }, 30);
    return () => window.clearTimeout(timeoutId);
  }, [games, line, selectedSide, timeRange, plotHeight, yAxisMax]);

  function getBarWidth() {
    if (timeRange === 'L5') return '74%';
    if (timeRange === 'L10') return '64%';
    if (timeRange === 'L20') return '54%';
    if (timeRange === 'L40') return '44%';
    return '40%';
  }

  function getLabelConfig(game: GameLogEntry, index: number) {
    const shortDate = formatDate(game.date).slice(0, 5);
    if (timeRange === 'L5' || timeRange === 'L10') return { primary: game.opponent, secondary: formatDate(game.date), showPrimary: true, showSecondary: true };
    if (timeRange === 'L20') return { primary: getOpponentLabel(game.opponent), secondary: shortDate, showPrimary: true, showSecondary: true };
    if (timeRange === 'L40') { const showSecondary = index % 2 === 0; return { primary: getOpponentLabel(game.opponent), secondary: showSecondary ? shortDate : '', showPrimary: true, showSecondary }; }
    const showLabel = index % 3 === 0;
    return { primary: showLabel ? getOpponentLabel(game.opponent) : '', secondary: showLabel ? shortDate : '', showPrimary: showLabel, showSecondary: showLabel };
  }

  return <div className="mt-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-3"><div className="relative w-full"><div className="absolute left-0 top-0 bottom-0 w-[36px]">{yAxisValues.map((value) => <div key={value} className="absolute right-0 -translate-y-1/2 text-[10px] text-slate-500" style={{ top: `${getYPosition(value)}px` }}>{value}</div>)}{line > 0 && <div className="absolute right-0 z-30 -translate-y-1/2 rounded border border-emerald-400/30 bg-slate-950 px-1 py-0.5 text-[9px] font-semibold text-emerald-200 shadow-sm" style={{ top: `${propLinePosition}px` }}>{line.toFixed(1)}</div>}</div><div ref={chartRef} className="ml-[36px] relative h-[300px] overflow-hidden rounded-xl border border-slate-800/70 bg-[#07100d]"><div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(to top, rgba(255,255,255,0.055) 1px, transparent 1px)', backgroundSize: '100% 44px' }} /><div className="absolute inset-x-0 top-0 z-10 h-[220px]"><div className="absolute inset-x-0 border-t border-dashed border-emerald-400/70 transition-all duration-400" style={{ top: `${propLinePosition}px` }} /></div><div className="absolute inset-x-0 bottom-0 top-0 z-20 px-3 pb-3 pt-3"><div className="grid h-full w-full" style={{ gridTemplateColumns: `repeat(${games.length}, minmax(0, 1fr))` }}>{games.map((game, index) => { const playerStat = getPlayerStat(game); const hasPositiveValue = playerStat > 0; const isHit = selectedSide === 'Over' ? playerStat > line : playerStat < line; const isHovered = hoveredIndex === index; const barHeight = animatedHeights[index] ?? 0; const labelConfig = getLabelConfig(game, index); const resultTextColor = playerStat === 0 ? (selectedSide === 'Over' ? '#ef6666' : '#22c978') : '#f8fafc'; const barColor = isHit ? 'linear-gradient(180deg, #22c978 0%, #12884f 100%)' : 'linear-gradient(180deg, #ef6666 0%, #bf3b3b 100%)'; return <div key={`${game.date}-${index}`} className="flex min-w-0 flex-col items-center px-1" onMouseEnter={() => { onHoverIndexChange(index); setTooltip({ visible: true, x: 0, y: 0, game }); }} onMouseLeave={() => { onHoverIndexChange(null); setTooltip({ visible: false, x: 0, y: 0, game: null }); }} onMouseMove={(event) => { const rect = chartRef.current?.getBoundingClientRect(); if (!rect) return; const x = event.clientX - rect.left; const y = event.clientY - rect.top; const tooltipWidth = 190; const tooltipHeight = 120; const left = x > rect.width - tooltipWidth - 30 ? x - tooltipWidth - 14 : x + 14; const top = y > rect.height - tooltipHeight - 30 ? y - tooltipHeight - 14 : y + 14; setTooltip({ visible: true, x: Math.min(Math.max(left, 10), Math.max(10, rect.width - tooltipWidth - 8)), y: Math.min(Math.max(top, 10), Math.max(10, rect.height - tooltipHeight - 8)), game }); }} role="button" tabIndex={0} style={{ cursor: 'crosshair', opacity: hoveredIndex === index ? 1 : 0.86 }}><div className="relative flex w-full items-end justify-center" style={{ height: `${barAreaHeight}px` }}><div className="absolute inset-x-0 bottom-0 h-px bg-slate-700/50" /><div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center" style={{ opacity: animatedOpacity[index] ?? 0.18 }}><span className="mb-2 text-[12px] font-semibold text-white transition-all duration-300" style={{ color: resultTextColor }}>{playerStat}</span>{hasPositiveValue && <div className="rounded-t-[2px] border border-slate-700/50 transition-all duration-350" style={{ height: `${barHeight}px`, width: getBarWidth(), background: barColor, transform: isHovered ? 'translateY(-2px) scale(1.01)' : 'translateY(0) scale(1)' }} />}</div></div><div className="mt-2 flex min-h-[54px] w-full flex-col items-center justify-start text-center">{labelConfig.showPrimary && <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-medium text-slate-300">{labelConfig.primary}</p>}{labelConfig.showSecondary && labelConfig.secondary && <p className="mt-0.5 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[9px] leading-4 text-slate-500">{labelConfig.secondary}</p>}</div></div>; })}</div></div>{tooltip.visible && tooltip.game && <div className="pointer-events-none absolute z-40 rounded-xl border border-slate-700 bg-slate-950/95 p-2 text-[11px] text-slate-200 shadow-2xl transition-all duration-120" style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, opacity: 1, transform: 'scale(1)' }}><p className="font-semibold text-white">{tooltip.game.opponent}</p><p className="mt-1 text-slate-400">{formatDate(tooltip.game.date)} • {tooltip.game.homeAway}</p><p className="mt-1 text-slate-400">Final {tooltip.game.teamScore ?? '--'}-{tooltip.game.opponentScore ?? '--'}</p><div className="mt-2 border-t border-slate-800 pt-2"><p className="text-white">{tooltip.game.actualStatResult ?? `${getPlayerStat(tooltip.game)}`}</p><p className="text-slate-400">PA: {tooltip.game.plateAppearances ?? '--'}</p>{(() => { const tooltipStat = getPlayerStat(tooltip.game); const tooltipHit = selectedSide === 'Over' ? tooltipStat > line : tooltipStat < line; return <p className={tooltipHit ? 'text-emerald-300' : 'text-rose-300'}>{tooltipHit ? 'HIT' : 'MISS'}</p>; })()}<p className="mt-1 text-slate-400">Line {line.toFixed(1)}</p></div></div>}</div></div></div>;
}
