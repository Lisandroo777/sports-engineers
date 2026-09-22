"use client";

import Link from "next/link";
import { useState } from "react";
import { InfoTooltip } from "../../components/InfoTooltip";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { TeamLogo } from "../../components/TeamLogo";
import { TrendSparkline } from "../../components/TrendSparkline";
import { getResearchHref } from "../../lib/researchHref";
import type { Batter, MatchupData } from "./mockData";

// ─── shared ───────────────────────────────────────────────────────────────────

interface TabProps {
  matchup: MatchupData;
  isAdvanced: boolean;
}

interface TabPropsWithBatter extends TabProps {
  setSelectedBatter: (b: Batter | null) => void;
}

function confidenceColor(n: number) {
  if (n >= 80) return "text-emerald-400";
  if (n >= 70) return "text-teal-400";
  return "text-amber-400";
}

function scoreBg(n: number) {
  if (n >= 8) return "bg-emerald-500/20 text-emerald-400";
  if (n >= 7) return "bg-teal-500/15 text-teal-400";
  return "bg-amber-500/15 text-amber-400";
}

function trendArrow(trend: string) {
  if (trend === "up") return <span className="text-emerald-400">&uarr;</span>;
  if (trend === "down") return <span className="text-rose-400">&darr;</span>;
  return <span className="text-slate-500">&rarr;</span>;
}

// ─── BatterRow ────────────────────────────────────────────────────────────────

interface BatterRowProps {
  batter: Batter;
  isAdvanced: boolean;
  onSelect: (b: Batter) => void;
  isSelected: boolean;
}

function BatterRow({ batter, isAdvanced, onSelect, isSelected }: BatterRowProps) {
  return (
    <button
      onClick={() => onSelect(batter)}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${isSelected ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : "hover:bg-white/6"}`}
    >
      <span className="w-5 shrink-0 font-bold text-slate-500">{batter.order}</span>
      <PlayerAvatar playerName={batter.name} size={26} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">{batter.name}</p>
        <p className="text-[9px] text-slate-500">{batter.position} &bull; {batter.hand}</p>
      </div>
      {batter.paPro && <span className="shrink-0 font-semibold text-amber-300">{batter.paPro} PA</span>}
      <span className="shrink-0 text-slate-300">{batter.avg}</span>
      {isAdvanced && <span className="shrink-0 text-slate-400">{batter.wOps ?? batter.ops}</span>}
      {batter.strong && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
    </button>
  );
}

// ─── BatterDrawer ─────────────────────────────────────────────────────────────

function BatterDrawer({ batter, onClose }: { batter: Batter; onClose: () => void }) {
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#0c1628] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PlayerAvatar playerName={batter.name} size={40} />
          <div>
            <p className="font-bold text-white">{batter.name}</p>
            <p className="text-xs text-slate-400">{batter.position} &bull; Bats {batter.hand} &bull; #{batter.order}</p>
            {batter.paPro && <p className="text-xs font-semibold text-amber-300">{batter.paPro} Proj PA</p>}
          </div>
        </div>
        <button onClick={onClose} className="text-lg text-slate-500 hover:text-white">&times;</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-xs">
        {[["AVG", batter.avg], ["OBP", batter.obp], ["SLG", batter.slg], ["OPS", batter.ops], ["HR", batter.hr], ["RBI", batter.rbi]].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-white/5 p-2 text-center">
            <p className="text-[8px] text-slate-600">{l}</p>
            <p className="font-semibold text-white">{v}</p>
          </div>
        ))}
      </div>
      {batter.vsHandedWoba && (
        <div className="mt-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs">
          <span className="text-slate-400">vs Opposing Hand wOBA: </span>
          <span className="font-bold text-emerald-400">{batter.vsHandedWoba}</span>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Link href="/research" className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-center text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20">Research Player &rarr;</Link>
        <Link href="/research" className="flex-1 rounded-xl border border-white/8 bg-white/5 py-2 text-center text-[11px] text-slate-300 hover:text-white">View Props &rarr;</Link>
      </div>
    </div>
  );
}

// ─── LineupTab ────────────────────────────────────────────────────────────────

export function LineupTab({ matchup, isAdvanced, setSelectedBatter }: TabPropsWithBatter) {
  const { game, awayLineup, homeLineup, awaySplit, homeSplit } = matchup;
  const [openBatter, setOpenBatter] = useState<Batter | null>(null);

  function handleSelect(b: Batter) {
    setOpenBatter(b.id === openBatter?.id ? null : b);
    setSelectedBatter(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        {[
          { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, lineup: awayLineup, split: awaySplit, status: "CONFIRMED" },
          { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, lineup: homeLineup, split: homeSplit, status: "PROJECTED" },
        ].map(({ team, teamId, logo, lineup, split, status }) => (
          <div key={team} className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
              <TeamLogo teamId={teamId} abbreviation={logo} size={22} />
              <h3 className="font-semibold text-white">{team} Batting Order</h3>
              <span className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${lineup.length === 0 ? "border-white/10 bg-white/5 text-slate-400" : status === "CONFIRMED" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/8 text-amber-400"}`}>
                {lineup.length === 0 ? "UNAVAILABLE" : status === "CONFIRMED" ? "✓ CONFIRMED" : "PROJECTED"}
              </span>
            </div>

            {lineup.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-500">Lineup unavailable</p>
            ) : (
            <div className="px-2 py-2">
              <div className="mb-1 grid grid-cols-[20px_26px_1fr_48px_40px] gap-1 px-3 text-[8px] font-semibold uppercase tracking-wider text-slate-600">
                <span>#</span><span></span><span>Player</span>
                <span className="text-center text-amber-500">PA*</span>
                <span className="text-center">AVG</span>
              </div>
              {lineup.map((b) => (
                <div key={b.id}>
                  <BatterRow batter={b} isAdvanced={isAdvanced} onSelect={handleSelect} isSelected={openBatter?.id === b.id} />
                  {openBatter?.id === b.id && <BatterDrawer batter={b} onClose={() => setOpenBatter(null)} />}
                </div>
              ))}
            </div>
            )}

            <div className="border-t border-white/5 px-4 py-2 text-[9px] text-slate-500">
              Team wOBA vs {split.vs}: {split.woba} &bull; wRC+: {split.wrcPlus}
              {isAdvanced && <> &bull; K%: {split.kPercent} &bull; BB%: {split.bbPercent}</>}
            </div>
          </div>
        ))}
      </div>

      {/* Splits comparison */}
      <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3 p-4">
        <h3 className="mb-3 font-semibold text-white">Team Offensive Splits (2025)</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, split: awaySplit },
            { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, split: homeSplit },
          ].map(({ team, teamId, logo, split }) => (
            <div key={team}>
              <div className="mb-2 flex items-center gap-1.5">
                <TeamLogo teamId={teamId} abbreviation={logo} size={16} />
                <span className="text-sm font-semibold text-white">{team} vs {split.vs}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {[["wOBA", split.woba], ["OPS", split.ops], ["wRC+", split.wrcPlus], ["ISO", split.iso], ["K%", split.kPercent], ["BB%", split.bbPercent]].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between rounded-lg bg-white/4 px-2.5 py-1.5">
                    <span className="text-slate-500">{l}</span>
                    <span className="font-semibold text-white">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PropsTab ─────────────────────────────────────────────────────────────────

export function PropsTab({ matchup, isAdvanced }: TabProps) {
  const { game, matchupProps, propAngles, realProps } = matchup;
  const [teamFilter, setTeamFilter] = useState("All");
  const [sideFilter, setSideFilter] = useState("All");
  const [confFilter, setConfFilter] = useState(0);
  const [viewFilter, setViewFilter] = useState<"All" | "Hitters" | "Pitchers">("All");

  const pitcherProps = ["Strikeouts", "Walks", "Innings Pitched", "Hits Allowed"];

  const filteredProps = (matchupProps ?? []).filter((p) => {
    if (teamFilter !== "All" && p.team !== teamFilter) return false;
    if (sideFilter !== "All" && p.side !== sideFilter) return false;
    if (p.confidence < confFilter) return false;
    if (viewFilter === "Pitchers" && !pitcherProps.some(pp => p.prop.includes(pp.split(" ")[0]))) return false;
    if (viewFilter === "Hitters" && pitcherProps.some(pp => p.prop.includes(pp.split(" ")[0]))) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header with link to full props page */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-white">{game.awayTeam} vs {game.homeTeam} &mdash; Prop Research</h2>
        <Link href="/research" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20">
          View Full Props Page &rarr;
        </Link>
      </div>

      {/* Real sportsbook props */}
      <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
        <div className="border-b border-white/5 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Sportsbook Player Props</h3>
        </div>
        {!realProps || realProps.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Props not posted yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-white/5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-2.5 text-left">Player</th>
                  <th className="px-2 py-2.5 text-left">Market</th>
                  <th className="px-2 py-2.5">Line</th>
                  <th className="px-2 py-2.5">Over</th>
                  <th className="px-2 py-2.5">Under</th>
                  <th className="px-2 py-2.5 text-left">Sportsbook</th>
                  <th className="px-4 py-2.5 text-left">Updated</th>
                  <th className="px-4 py-2.5">Research</th>
                </tr>
              </thead>
              <tbody>
                {realProps.map((prop) => (
                  <tr key={`${prop.eventId}-${prop.player}-${prop.sourceMarketKey}-${prop.line}-${prop.sportsbookKey}`} className="border-b border-white/4 last:border-0 hover:bg-white/4">
                    <td className="px-4 py-2.5 text-xs font-semibold text-white">{prop.player}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-300">{prop.marketLabel}</td>
                    <td className="px-2 py-2.5 text-center text-xs font-semibold text-white">{prop.line}</td>
                    <td className={`px-2 py-2.5 text-center text-xs font-semibold ${prop.overOdds != null && prop.overOdds > 0 ? "text-emerald-400" : "text-slate-300"}`}>{prop.overOdds != null ? (prop.overOdds > 0 ? `+${prop.overOdds}` : prop.overOdds) : "\u2014"}</td>
                    <td className={`px-2 py-2.5 text-center text-xs font-semibold ${prop.underOdds != null && prop.underOdds > 0 ? "text-emerald-400" : "text-slate-300"}`}>{prop.underOdds != null ? (prop.underOdds > 0 ? `+${prop.underOdds}` : prop.underOdds) : "\u2014"}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-400">{prop.sportsbookName}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{prop.lastUpdate ? new Date(prop.lastUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : "\u2014"}</td>
                    <td className="px-4 py-2.5">{prop.playerId ? <Link href={getResearchHref({ playerId: prop.playerId })} className="text-xs text-emerald-400 hover:text-emerald-300">Research</Link> : <span className="text-xs text-slate-500">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Prop matchup scores */}
      {propAngles && propAngles.length > 0 && (
        <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-semibold text-white">Prop Matchup Scores</h3>
            <InfoTooltip text="Scores are mock estimates based on available matchup factors." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {propAngles.map((a) => (
              <div key={`${a.player}-${a.prop}-${a.score}`} className="rounded-xl border border-white/6 bg-white/4 p-3">
                <div className="flex items-start gap-2">
                  <PlayerAvatar playerId={matchup.matchupProps?.find(p => p.player === a.player)?.playerId} playerName={a.player} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white">{a.player}</p>
                    <p className="text-[10px] text-slate-400">{a.prop}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`text-lg font-extrabold ${a.score >= 8 ? "text-emerald-400" : a.score >= 7 ? "text-teal-400" : "text-amber-400"}`}>{a.score}</span>
                      <span className="text-[9px] text-slate-500">/10</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${scoreBg(a.score)}`}>{a.score >= 8 ? "Strong" : a.score >= 7 ? "Good" : "Avg"}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5">
                  {a.positives.slice(0, 2).map((p) => <p key={p} className="text-[9px] text-emerald-400">&bull; {p}</p>)}
                  {a.risks.slice(0, 1).map((r) => <p key={r} className="text-[9px] text-rose-400/80">&bull; {r}</p>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OddsTab ──────────────────────────────────────────────────────────────────

export function OddsTab({ matchup }: TabProps) {
  const { game, gameOdds, projection } = matchup;
  const odds = gameOdds;
  if (!odds) return <p className="p-4 text-sm text-slate-500">Odds unavailable.</p>;

  function americanToImplied(o: string) {
    const n = parseFloat(o);
    if (n < 0) return ((-n / (-n + 100)) * 100).toFixed(1) + "%";
    return ((100 / (n + 100)) * 100).toFixed(1) + "%";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">{game.awayTeam} vs {game.homeTeam} &mdash; Odds</h2>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-400">MOCK ODDS</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Moneyline */}
        <div className="rounded-2xl border border-white/6 bg-white/3 p-5">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Moneyline</p>
          <div className="space-y-3">
            {[
              { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, odds: odds.awayMoneyline, label: "AWAY" },
              { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, odds: odds.homeMoneyline, label: "HOME" },
            ].map(({ team, teamId, logo, odds: o, label }) => (
              <div key={team} className="rounded-xl bg-white/4 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TeamLogo teamId={teamId} abbreviation={logo} size={18} />
                  <span className="text-xs font-semibold text-white">{team}</span>
                  <span className="ml-auto text-[9px] text-slate-500">{label}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className={`text-2xl font-extrabold ${o.startsWith("+") ? "text-emerald-400" : "text-slate-300"}`}>{o}</span>
                  <span className="text-[10px] text-slate-500">{americanToImplied(o)} implied</span>
                </div>
                {projection && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                    <span className="text-slate-600">SE Model:</span>
                    <span className={`font-semibold ${label === "AWAY" ? "text-red-400" : "text-blue-400"}`}>
                      {label === "AWAY" ? projection.awayWinProbability : 100 - projection.awayWinProbability}%
                    </span>
                    {(() => {
                      const model = label === "AWAY" ? projection.awayWinProbability : 100 - projection.awayWinProbability;
                      const market = parseFloat(americanToImplied(o));
                      const diff = (model - market).toFixed(1);
                      const isPositive = model > market;
                      return <span className={`${isPositive ? "text-emerald-400" : "text-rose-400"}`}>({isPositive ? "+" : ""}{diff}% vs market)</span>;
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Run Line */}
        <div className="rounded-2xl border border-white/6 bg-white/3 p-5">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Run Line</p>
          <div className="space-y-3">
            {[
              { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, line: odds.awayRunLine, lineOdds: odds.awayRunLineOdds },
              { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, line: odds.homeRunLine, lineOdds: odds.homeRunLineOdds },
            ].map(({ team, teamId, logo, line, lineOdds }) => (
              <div key={team} className="rounded-xl bg-white/4 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TeamLogo teamId={teamId} abbreviation={logo} size={18} />
                  <span className="text-xs font-semibold text-white">{team}</span>
                  <span className={`ml-auto text-sm font-bold ${line.startsWith("+") ? "text-emerald-400" : "text-slate-400"}`}>{line}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className={`text-2xl font-extrabold ${lineOdds.startsWith("+") ? "text-emerald-400" : "text-slate-300"}`}>{lineOdds}</span>
                  <span className="text-[10px] text-slate-500">{americanToImplied(lineOdds)} implied</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Game Total */}
        <div className="rounded-2xl border border-white/6 bg-white/3 p-5">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Game Total</p>
          <div className="mb-2 text-center">
            <span className="text-3xl font-extrabold text-white">{odds.total}</span>
            <p className="text-[10px] text-slate-500">Run total</p>
          </div>
          <div className="space-y-3">
            {[
              { label: "Over", o: odds.overOdds },
              { label: "Under", o: odds.underOdds },
            ].map(({ label, o }) => (
              <div key={label} className="rounded-xl bg-white/4 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-slate-300">{label} {odds.total}</span>
                  <span className={`text-xl font-extrabold ${o.startsWith("+") ? "text-emerald-400" : "text-slate-300"}`}>{o}</span>
                </div>
                <p className="mt-0.5 text-right text-[10px] text-slate-500">{americanToImplied(o)} implied</p>
              </div>
            ))}
          </div>
          {projection && (
            <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs">
              <p className="text-slate-500">SE Projected Total</p>
              <p className="text-lg font-bold text-white">{projection.projectedTotal} runs</p>
              <p className="text-[10px] text-slate-500">({parseFloat(projection.projectedTotal) > parseFloat(odds.total) ? "Lean Over" : "Lean Under"})</p>
            </div>
          )}
        </div>
      </div>

      {/* Multi-book placeholder */}
      <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-semibold text-white">Best Prices</h3>
          <span className="rounded-full border border-slate-600 bg-slate-800/50 px-2 py-0.5 text-[9px] text-slate-400">Multi-book coming soon</span>
        </div>
        <div className="grid gap-2 text-xs">
          {[["Moneyline Away", odds.awayMoneyline], ["Moneyline Home", odds.homeMoneyline], ["Over " + odds.total, odds.overOdds], ["Under " + odds.total, odds.underOdds]].map(([market, price]) => (
            <div key={market} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/3 px-3 py-2">
              <span className="text-slate-400">{market}</span>
              <span className={`font-semibold ${typeof price === "string" && price.startsWith("+") ? "text-emerald-400" : "text-slate-300"}`}>{price}</span>
              <span className="text-[9px] text-slate-600">Mock</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TrendsTab ────────────────────────────────────────────────────────────────

export function TrendsTab({ matchup, isAdvanced }: TabProps) {
  const { game, awayForm, homeForm, playerTrends } = matchup;
  const [window, setWindow] = useState<"L5" | "L10" | "L20">("L10");

  return (
    <div className="space-y-5">
      {/* Time window selector */}
      <div className="flex items-center gap-3">
        <h2 className="font-semibold text-white">{game.awayTeam} vs {game.homeTeam} &mdash; Trends</h2>
        <div className="flex rounded-xl border border-white/8 p-0.5">
          {(["L5", "L10", "L20"] as const).map((w) => (
            <button key={w} onClick={() => setWindow(w)} className={`rounded-lg px-3 py-1 text-xs font-medium transition ${window === w ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>{w}</button>
          ))}
        </div>
      </div>

      {/* Team trends */}
      <div className="grid gap-4 xl:grid-cols-2">
        {[
          { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, form: awayForm, games: matchup.awayRecentGames },
          { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, form: homeForm, games: matchup.homeRecentGames },
        ].map(({ team, teamId, logo, form, games }) => (
          <div key={team} className="rounded-2xl border border-white/6 bg-white/3 p-4">
            <div className="mb-3 flex items-center gap-2">
              <TeamLogo teamId={teamId} abbreviation={logo} size={20} />
              <h3 className="font-semibold text-white">{team} Team Trends</h3>
              <span className="ml-auto text-sm font-bold text-white">{window === "L5" ? form.last5 : form.last10}</span>
            </div>
            {games && (
              <div className="mb-3 flex flex-wrap gap-1">
                {(window === "L5" ? games.slice(-5) : games).map((r, i) => (
                  <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${r === "W" ? "bg-emerald-500 text-slate-950" : "bg-rose-500/80 text-white"}`}>{r}</span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {[
                ["Streak", form.streak],
                ["R/G", form.runsPerGame],
                ["RA/G", form.runsAllowed],
                ["Home", form.homeRecord],
                ["Away", form.awayRecord],
              ].map(([l, v]) => (
                <div key={l} className="flex items-center justify-between rounded-lg bg-white/4 px-2.5 py-1.5">
                  <span className="text-slate-500">{l}</span>
                  <span className="font-semibold text-white">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Player trends */}
      {playerTrends && playerTrends.length > 0 && (
        <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
          <h3 className="mb-3 font-semibold text-white">Trending Players ({window})</h3>
          <div className="space-y-2">
            {playerTrends.map((p) => (
              <div key={`${p.playerId}-${p.player}-${p.teamId}`} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/3 px-3 py-2.5">
                <div className="relative shrink-0">
                  <PlayerAvatar playerId={p.playerId} playerName={p.player} size={32} />
                  <TeamLogo teamId={p.teamId} abbreviation={p.team.slice(0, 3)} size={12} className="absolute -bottom-0.5 -right-0.5 ring-1 ring-[#060d18]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-white">{p.player}</p>
                    {trendArrow(p.trend)}
                  </div>
                  <p className="text-[9px] text-slate-500">{p.team} &bull; {p.position}</p>
                </div>
                <div className="flex gap-4 text-xs">
                  {window === "L5" ? (
                    <>
                      <div className="text-center">
                        <p className="font-semibold text-white">{p.l5Avg}</p>
                        <p className="text-[9px] text-slate-500">AVG</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-emerald-400">{p.l5Hr}</p>
                        <p className="text-[9px] text-slate-500">HR</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-white">{p.l5Ops}</p>
                        <p className="text-[9px] text-slate-500">OPS</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-center">
                        <p className="font-semibold text-white">{p.l10Avg}</p>
                        <p className="text-[9px] text-slate-500">AVG</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-emerald-400">{p.l10Hr}</p>
                        <p className="text-[9px] text-slate-500">HR</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-white">{p.l10Ops}</p>
                        <p className="text-[9px] text-slate-500">OPS</p>
                      </div>
                    </>
                  )}
                </div>
                <TrendSparkline values={[parseFloat(p.l10Ops) * 80, parseFloat(p.l5Ops) * 80]} positive={p.trend === "up"} width={36} height={16} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pitcher trends */}
      <div className="grid gap-4 xl:grid-cols-2">
        {[
          { pitcher: matchup.awayPitcher, teamId: game.awayTeamId, logo: game.awayLogo },
          { pitcher: matchup.homePitcher, teamId: game.homeTeamId, logo: game.homeLogo },
        ].map(({ pitcher, teamId, logo }) => (
          <div key={pitcher.name} className="rounded-2xl border border-white/6 bg-white/3 p-4">
            <div className="mb-3 flex items-center gap-2">
              <TeamLogo teamId={teamId} abbreviation={logo} size={18} />
              <h3 className="text-sm font-semibold text-white">{pitcher.name}</h3>
              {pitcher.recentFormRecord && <span className="ml-auto text-xs text-slate-400">{pitcher.recentFormRecord} recent</span>}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {[
                ["ERA", pitcher.era],
                ["WHIP", pitcher.whip],
                ["K%", pitcher.kPercent],
                ...(isAdvanced ? [["FIP", pitcher.fip], ["xFIP", pitcher.xfip ?? "—"], ["BB%", pitcher.bbPercent]] : []),
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-white/4 p-2 text-center">
                  <p className="text-[8px] text-slate-600">{l}</p>
                  <p className="font-semibold text-white">{v}</p>
                </div>
              ))}
            </div>
            {pitcher.recentFormGames && (
              <div className="mt-3">
                <p className="mb-1 text-[9px] text-slate-500">Last {pitcher.recentFormGames.length} decisions</p>
                <div className="flex flex-wrap gap-1">
                  {pitcher.recentFormGames.map((r, i) => (
                    <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${r === "W" ? "bg-emerald-500 text-slate-950" : "bg-rose-500/80 text-white"}`}>{r}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── InsightsTab ──────────────────────────────────────────────────────────────

export function InsightsTab({ matchup, isAdvanced }: TabProps) {
  const { game, projection, matchupInsights, propAngles } = matchup;

  const iconMap: Record<string, string> = {
    pitcher: "⚾", power: "💪", bullpen: "🛡️", weather: "🌤️",
    form: "📈", discipline: "🎯", home: "🏟️",
  };

  const advantageColor = (adv: string) => {
    if (adv === game.awayTeam || adv === "Red Sox" || adv === "BOS") return "text-red-400";
    if (adv === game.homeTeam || adv === "Yankees" || adv === "NYY") return "text-blue-400";
    return "text-slate-400";
  };

  return (
    <div className="space-y-5">
      {/* Game Summary */}
      <div className="rounded-2xl border border-white/6 bg-white/3 p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-amber-400">💡</span>
          <h3 className="font-semibold text-white">Game Summary</h3>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-slate-400">Model Overview</span>
        </div>
        {projection ? (
          <p className="text-sm leading-relaxed text-slate-300">
            <span className="font-semibold text-white">{game.awayTeam}</span> holds a slight matchup advantage tonight based on stronger starting pitching and better offensive production against left-handed pitching.
            <span className="font-semibold text-white"> {game.homeTeam}</span> counters with the home-field advantage and stronger recent form.
            The model projects a {projection.awayWinProbability}% win probability for {game.awayTeam} with a projected score of {projection.projectedAwayScore}&ndash;{projection.projectedHomeScore}.
          </p>
        ) : (
          <p className="text-sm text-slate-400">Model not connected.</p>
        )}
      </div>

      {/* Key Insights */}
      {matchupInsights && matchupInsights.length > 0 && (
        <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
          <h3 className="mb-3 font-semibold text-white">Key Insights</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {matchupInsights.map((insight) => (
              <div key={insight.category} className="rounded-xl border border-white/6 bg-white/4 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-white">{insight.category}</p>
                    <p className={`text-xs font-semibold ${advantageColor(insight.teamAdvantage)}`}>{insight.teamAdvantage === "Neutral" ? "Neutral" : insight.teamAdvantage + " Advantage"}</p>
                  </div>
                  <span className="text-lg">{iconMap[insight.icon] ?? "📊"}</span>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">{insight.explanation}</p>
                {!isAdvanced && insight.beginner && (
                  <p className="mt-1 text-[9px] italic text-slate-500">{insight.beginner}</p>
                )}
                {isAdvanced && (
                  <p className="mt-1.5 text-[9px] font-medium text-slate-500">{insight.detail}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Research Angles */}
      {propAngles && propAngles.length > 0 && (
        <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-white">Top Research Angles</h3>
            <Link href="/research" className="text-xs text-emerald-400 hover:text-emerald-300">View Full Queue &rarr;</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {propAngles.map((a) => (
              <div key={`${a.player}-${a.prop}-${a.score}`} className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/3 p-3">
                <PlayerAvatar playerId={matchup.matchupProps?.find(p => p.player === a.player)?.playerId} playerName={a.player} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white">{a.player}</p>
                  <p className="text-[10px] text-slate-400">{a.prop}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`text-base font-extrabold ${a.score >= 8 ? "text-emerald-400" : "text-teal-400"}`}>{a.score}</span>
                    <span className="text-[9px] text-slate-500">/10</span>
                  </div>
                  {a.positives.slice(0, 2).map((pos) => <p key={pos} className="text-[9px] text-emerald-400">&bull; {pos}</p>)}
                </div>
                <Link href="/research" className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20">Research</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advanced terms glossary */}
      {!isAdvanced && (
        <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Understanding Key Terms</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["wOBA", "Weighted On-Base Average. Measures total offensive value per plate appearance."],
              ["wRC+", "Weighted Runs Created+. 100 is league average; higher means more runs created."],
              ["FIP", "Fielding Independent Pitching. ERA based only on outcomes pitchers control."],
              ["ERA", "Earned Run Average. Runs allowed per 9 innings. Lower is better."],
              ["K%", "Strikeout rate. Higher K% for a pitcher means more strikeout opportunities."],
              ["BB%", "Walk rate. High BB% for batters = good eye; high for pitchers = weakness."],
            ].map(([term, def]) => (
              <div key={term} className="rounded-xl bg-white/4 p-3">
                <p className="text-xs font-bold text-emerald-400">{term}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{def}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AlertsTab ────────────────────────────────────────────────────────────────

// ─── AlertsTab ────────────────────────────────────────────────────────────────

type AlertItem = NonNullable<NonNullable<ReturnType<() => import("./mockData").MatchupData>>["gameAlerts"]>[number];

const CATEGORY_ACCENT: Record<string, string> = {
  LINEUP: "emerald", PITCHER: "cyan", WEATHER: "amber", ODDS: "violet", INJURY: "rose", PLAYER: "teal",
};

const CATEGORY_ICON: Record<string, string> = {
  LINEUP: "\u{1F465}", PITCHER: "\u26BE", WEATHER: "\u{1F324}\uFE0F", ODDS: "\u{1F4CA}", INJURY: "\u{1FA79}", PLAYER: "\u{1F464}",
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  IMPORTANT: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  INFO: "border-emerald-500/30 bg-emerald-500/8 text-emerald-400",
};

const IMPACT_STYLES: Record<string, string> = {
  CRITICAL: "text-rose-400 bg-rose-500/10",
  HIGH: "text-rose-400 bg-rose-500/10",
  MODERATE: "text-amber-400 bg-amber-500/10",
  LOW: "text-slate-400 bg-white/5",
};

const DATA_STATUS_STYLES: Record<string, string> = {
  REAL_MLB: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  PROJECTED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  MOCK: "border-slate-600 bg-slate-800/50 text-slate-400",
};

export function AlertsTab({ matchup, isAdvanced }: TabProps) {
  const { game, gameAlerts, projection } = matchup;
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);
  const [readAlerts, setReadAlerts] = useState<Set<string>>(new Set());
  const [pinnedAlerts, setPinnedAlerts] = useState<Set<string>>(new Set());
  const [followedAlerts, setFollowedAlerts] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [localAlerts, setLocalAlerts] = useState(gameAlerts ?? []);
  const [newAlertType, setNewAlertType] = useState("Lineup confirmed");
  const [newAlertTeam, setNewAlertTeam] = useState(game.awayTeam);

  const categories = ["ALL", "LINEUP", "PITCHER", "WEATHER", "ODDS", "INJURY", "PLAYER"];

  function handleSelect(alert: AlertItem) {
    setSelectedAlert((prev) => (prev?.id === alert.id ? null : alert));
    setReadAlerts((prev) => new Set([...prev, alert.id]));
  }

  function togglePin(id: string) {
    setPinnedAlerts((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function toggleFollow(id: string) {
    setFollowedAlerts((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function createAlert() {
    const a: AlertItem = {
      id: "custom-" + Date.now(), category: "LINEUP", severity: "INFO",
      title: newAlertType + " — " + newAlertTeam, detail: "Custom alert created.",
      time: "just now", impactLevel: "LOW", dataStatus: "MOCK",
    };
    setLocalAlerts((prev) => [a, ...prev]);
    setShowCreate(false);
  }

  const filtered = [...localAlerts]
    .filter((a) => categoryFilter === "ALL" || a.category === categoryFilter)
    .sort((a, b) => {
      const ap = pinnedAlerts.has(a.id) ? 0 : 1;
      const bp = pinnedAlerts.has(b.id) ? 0 : 1;
      return ap - bp;
    });

  const unreadCount = localAlerts.filter((a) => !readAlerts.has(a.id)).length;
  const importantCount = localAlerts.filter((a) => a.severity !== "INFO").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-white">{game.awayTeam} vs {game.homeTeam} &mdash; Alerts</h2>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white">{localAlerts.length}</span>
          {importantCount > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">{importantCount} Important</span>}
          {unreadCount > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">{unreadCount} Unread</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setReadAlerts(new Set(localAlerts.map((a) => a.id)))} className="text-xs text-slate-500 hover:text-white">Mark All Read</button>
        </div>
      </div>

      {/* Create alert form */}
      {false && showCreate && (
        <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#0c1628] p-4 transition-all">
          <h3 className="mb-3 text-sm font-semibold text-white">Create Custom Alert</h3>
          <div className="flex flex-wrap gap-3">
            <select className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-slate-300 outline-none" value={newAlertType} onChange={(e) => setNewAlertType(e.target.value)}>
              {["Lineup confirmed", "Player scratched", "Pitcher change", "Weather threshold", "Odds move 10+ cents", "Prop line move"].map((t) => <option key={t} className="bg-slate-900" value={t}>{t}</option>)}
            </select>
            <select className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-slate-300 outline-none" value={newAlertTeam} onChange={(e) => setNewAlertTeam(e.target.value)}>
              <option className="bg-slate-900" value={game.awayTeam}>{game.awayTeam}</option>
              <option className="bg-slate-900" value={game.homeTeam}>{game.homeTeam}</option>
            </select>
            <button onClick={createAlert} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400">Add Alert</button>
            <button onClick={() => setShowCreate(false)} className="rounded-xl border border-white/8 px-4 py-2 text-sm text-slate-300 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Category filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map((c) => (
          <button key={c} onClick={() => setCategoryFilter(c)}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${categoryFilter === c ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/8 text-slate-500 hover:text-white"}`}>
            {c === "ALL" ? "All" : c}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-slate-500">{filtered.length} alerts</span>
      </div>

      {/* Two-column layout: list + detail */}
      <div className={`grid gap-4 ${selectedAlert ? "xl:grid-cols-[1fr_420px]" : ""}`}>
        {/* Alert list */}
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="rounded-2xl border border-white/6 bg-white/3 p-6 text-center text-sm text-slate-500">{localAlerts.length === 0 ? "Alerts unavailable" : "No alerts for this filter."}</div>
          )}
          {filtered.map((alert) => {
            const isUnread = !readAlerts.has(alert.id);
            const isPinned = pinnedAlerts.has(alert.id);
            const isSelected = selectedAlert?.id === alert.id;
            return (
              <div key={alert.id}
                onClick={() => handleSelect(alert)}
                className={`group flex cursor-pointer items-start gap-3 rounded-2xl border-l-2 p-4 transition-all duration-150
                  ${isSelected ? "border-l-emerald-500 bg-emerald-500/8 ring-1 ring-emerald-500/20" :
                    alert.severity === "CRITICAL" ? "border-l-rose-500 bg-rose-500/5 hover:bg-rose-500/8" :
                    alert.severity === "IMPORTANT" ? "border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/8" :
                    "border-l-emerald-500/50 bg-emerald-500/3 hover:bg-white/5"}`}>
                {/* Category icon */}
                <span className="mt-0.5 shrink-0 text-xl leading-none">{CATEGORY_ICON[alert.category] ?? "•"}</span>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
                    <p className={`text-sm font-semibold ${isUnread ? "text-white" : "text-slate-300"}`}>{alert.title}</p>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${SEVERITY_STYLES[alert.severity]}`}>{alert.severity}</span>
                    {alert.impactLevel && alert.impactLevel !== "LOW" && (
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${IMPACT_STYLES[alert.impactLevel]}`}>{alert.impactLevel}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{alert.detail}</p>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-600">
                    <span>{alert.time}</span>
                    <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">{alert.category}</span>
                    {alert.dataStatus && <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${DATA_STATUS_STYLES[alert.dataStatus]}`}>{alert.dataStatus.replace("_", " ")}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button onClick={(e) => { e.stopPropagation(); togglePin(alert.id); }}
                    className={`rounded-lg p-1 text-[11px] transition ${isPinned ? "text-amber-400" : "text-slate-600 hover:text-slate-400"}`} title={isPinned ? "Unpin" : "Pin"}>
                    📌
                  </button>
                  <svg className={`h-4 w-4 transition-transform duration-200 ${isSelected ? "rotate-180" : "rotate-0"} text-slate-500 group-hover:text-slate-300`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            );
          })}

          {/* Full alerts page link */}
          <div className="rounded-2xl border border-white/6 bg-white/3 p-4 text-center">
            <p className="text-xs text-slate-400">Platform-wide alerts and notification center</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-white/8 px-4 py-2 text-sm text-slate-300">
              News &amp; Alerts are available in the shared panel.
            </span>
          </div>
        </div>

        {/* Alert Detail Panel */}
        {selectedAlert && (
          <AlertDetailPanel
            alert={selectedAlert}
            matchup={matchup}
            isAdvanced={isAdvanced}
            isFollowed={followedAlerts.has(selectedAlert.id)}
            onToggleFollow={() => toggleFollow(selectedAlert.id)}
            onClose={() => setSelectedAlert(null)}
            projection={projection}
          />
        )}
      </div>
    </div>
  );
}

// ─── AlertDetailPanel ─────────────────────────────────────────────────────────

interface AlertDetailPanelProps {
  alert: AlertItem;
  matchup: import("./mockData").MatchupData;
  isAdvanced: boolean;
  isFollowed: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
  projection?: import("./mockData").MatchupData["projection"];
}

function AlertDetailPanel({ alert, matchup, isAdvanced, isFollowed, onToggleFollow, onClose, projection }: AlertDetailPanelProps) {
  const { game } = matchup;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0b1726] transition-all duration-200">
      {/* Panel header */}
      <div className={`flex items-center justify-between border-b border-white/5 px-4 py-3 ${
        alert.severity === "CRITICAL" ? "bg-rose-500/8" :
        alert.severity === "IMPORTANT" ? "bg-amber-500/6" :
        "bg-emerald-500/5"}`}>
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{CATEGORY_ICON[alert.category] ?? "📋"}</span>
          <div>
            <p className="text-sm font-bold text-white">{alert.title}</p>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-slate-500">{alert.time}</span>
              <span className={`rounded-full border px-1.5 py-0.5 font-bold uppercase ${SEVERITY_STYLES[alert.severity]}`}>{alert.severity}</span>
              {alert.dataStatus && <span className={`rounded-full border px-1.5 py-0.5 font-semibold ${DATA_STATUS_STYLES[alert.dataStatus]}`}>{alert.dataStatus.replace("_", " ")}</span>}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:text-white">&times;</button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <div className="space-y-4 p-4">

          {/* Impact level + areas */}
          {(alert.impactLevel || alert.impactAreas) && (
            <div className="rounded-xl bg-white/4 p-3">
              {alert.impactLevel && (
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">Impact Level</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${IMPACT_STYLES[alert.impactLevel]}`}>{alert.impactLevel}</span>
                </div>
              )}
              {alert.impactAreas && alert.impactAreas.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] text-slate-500">Affected Research</p>
                  <div className="flex flex-wrap gap-1.5">
                    {alert.impactAreas.map((area) => (
                      <span key={area} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">{area}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Before vs After */}
          {(alert.beforeValue || alert.afterValue) && (
            <div className="rounded-xl bg-white/4 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {alert.category === "ODDS" ? "Odds Movement" :
                 alert.category === "WEATHER" ? "Conditions Change" :
                 alert.category === "INJURY" ? "Status Change" : "Status Change"}
              </p>
              <div className="flex items-center gap-3">
                {alert.beforeValue && (
                  <div className="flex-1 rounded-lg border border-white/6 bg-white/3 p-2.5 text-center">
                    <p className="text-[9px] text-slate-500">Before</p>
                    <p className="text-sm font-semibold text-slate-400">{alert.beforeValue}</p>
                  </div>
                )}
                <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                {alert.afterValue && (
                  <div className="flex-1 rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-2.5 text-center">
                    <p className="text-[9px] text-slate-500">Now</p>
                    <p className="text-sm font-bold text-white">{alert.afterValue}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Odds comparison vs model */}
          {alert.category === "ODDS" && projection && (
            <div className="rounded-xl bg-white/4 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Model vs Market</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/5 p-2 text-center">
                  <p className="text-[9px] text-slate-500">SE Model {game.awayTeam}</p>
                  <p className="text-lg font-bold text-emerald-400">{projection.awayWinProbability}%</p>
                </div>
                <div className="rounded-lg bg-white/5 p-2 text-center">
                  <p className="text-[9px] text-slate-500">SE Model {game.homeTeam}</p>
                  <p className="text-lg font-bold text-blue-400">{100 - projection.awayWinProbability}%</p>
                </div>
              </div>
              <p className="mt-2 text-[10px] italic text-slate-500">Market movement does not override DeepSide Projection. Use model difference as context only.</p>
            </div>
          )}

          {/* Why It Matters */}
          {alert.whyItMatters && (
            <div className="rounded-xl border border-white/6 bg-white/3 p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Why This Matters</p>
              <p className="text-xs leading-relaxed text-slate-300">{alert.whyItMatters}</p>
            </div>
          )}

          {/* Affected Player (injury/player alerts) */}
          {alert.affectedPlayer && alert.affectedPlayerId && (
            <div className="rounded-xl bg-white/4 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Affected Player</p>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <PlayerAvatar playerId={alert.affectedPlayerId} playerName={alert.affectedPlayer} size={48} className="ring-2 ring-rose-500/20" />
                  {alert.affectedTeamId && <TeamLogo teamId={alert.affectedTeamId} abbreviation={alert.affectedTeam?.slice(0, 3) ?? ""} size={16} className="absolute -bottom-1 -right-1 ring-1 ring-[#0b1726]" />}
                </div>
                <div>
                  <p className="font-bold text-white">{alert.affectedPlayer}</p>
                  {alert.affectedTeam && <p className="text-xs text-slate-400">{alert.affectedTeam}</p>}
                  {alert.afterValue && <span className={`inline-block mt-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${alert.afterValue === "Questionable" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-rose-500/40 bg-rose-500/10 text-rose-400"}`}>{alert.afterValue}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Affected Team (lineup/pitcher) */}
          {!alert.affectedPlayer && alert.affectedTeam && alert.affectedTeamId && (
            <div className="flex items-center gap-3 rounded-xl bg-white/4 p-3">
              <TeamLogo teamId={alert.affectedTeamId} abbreviation={alert.affectedTeam.slice(0, 3)} size={40} />
              <div>
                <p className="font-bold text-white">{alert.affectedTeam}</p>
                {alert.afterValue && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">{alert.afterValue}</span>}
              </div>
            </div>
          )}

          {/* Pitcher detail */}
          {alert.category === "PITCHER" && alert.affectedPlayerId && (
            <div className="rounded-xl bg-white/4 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pitcher Info</p>
              <div className="flex items-center gap-3">
                <PlayerAvatar playerId={alert.affectedPlayerId} playerName={alert.affectedPlayer ?? ""} size={48} className="ring-2 ring-cyan-500/20" />
                <div>
                  <p className="font-bold text-white">{alert.affectedPlayer ?? matchup.awayPitcher.name}</p>
                  {(() => {
                    const pitcher = [matchup.awayPitcher, matchup.homePitcher].find(p => p.name === (alert.affectedPlayer ?? matchup.awayPitcher.name));
                    if (!pitcher) return null;
                    return (
                      <div className="mt-1 flex gap-3 text-[10px] text-slate-400">
                        <span>{pitcher.era} ERA</span>
                        <span>{pitcher.whip} WHIP</span>
                        <span>{pitcher.kPercent} K%</span>
                      </div>
                    );
                  })()}
                  {alert.afterValue && <span className="mt-1 inline-block rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400">{alert.afterValue}</span>}
                </div>
              </div>
              {isAdvanced && (
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {(() => {
                    const p = [matchup.awayPitcher, matchup.homePitcher].find(p => p.name === (alert.affectedPlayer ?? matchup.awayPitcher.name));
                    if (!p) return null;
                    return [["Proj IP", p.projectedIP ?? "—"], ["Proj K", p.projectedK ?? "—"], ["Pitches", p.projectedPitches ?? "—"]].map(([l, v]) => (
                      <div key={l} className="rounded-lg bg-white/5 p-1.5 text-center">
                        <p className="text-[8px] text-amber-400/70">PROJ</p>
                        <p className="text-[9px] text-slate-500">{l}</p>
                        <p className="text-sm font-bold text-emerald-400">{v}</p>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Affected Players list */}
          {alert.affectedPlayers && alert.affectedPlayers.length > 0 && (
            <div className="rounded-xl bg-white/4 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {alert.category === "PITCHER" ? "Affected Hitters" : "Affected Players"}
              </p>
              <div className="space-y-2">
                {alert.affectedPlayers.map((p) => (
                  <div key={`${p.name}-${p.teamId ?? 'team'}-${p.position ?? 'position'}`} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2">
                    <PlayerAvatar playerId={p.playerId} playerName={p.name} size={26} />
                    <div>
                      <p className="text-xs font-semibold text-white">{p.name}</p>
                      <div className="flex items-center gap-1">
                        <TeamLogo teamId={p.teamId} abbreviation={p.team} size={11} />
                        <p className="text-[9px] text-slate-500">{p.team}{p.position ? ` • ${p.position}` : ""}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {alert.timeline && alert.timeline.length > 0 && (
            <div className="rounded-xl bg-white/4 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Update Timeline</p>
              <div className="space-y-2">
                {alert.timeline.map((t, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="flex flex-col items-center">
                      <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      {i < alert.timeline!.length - 1 && <div className="mt-1 h-full w-px bg-white/10" style={{ minHeight: 16 }} />}
                    </div>
                    <div className="min-w-0 pb-1.5">
                      <p className="text-[10px] font-semibold text-white">{t.time}</p>
                      <p className="text-[10px] text-slate-400">{t.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related Props */}
          {alert.relatedProps && alert.relatedProps.length > 0 && (
            <div className="rounded-xl bg-white/4 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Related Props</p>
                <Link href="/research" className="text-[10px] text-emerald-400 hover:text-emerald-300">Research All &rarr;</Link>
              </div>
              <div className="space-y-2">
                {alert.relatedProps.map((prop) => (
                  <div key={`${prop.player}-${prop.prop}-${prop.line}-${prop.confidence}`} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/3 px-2.5 py-2">
                    <PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={24} />
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-semibold text-white">{prop.player}</p>
                      <p className="text-slate-500">{prop.prop} {prop.side} {prop.line}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className={`font-bold ${prop.confidence >= 80 ? "text-emerald-400" : prop.confidence >= 70 ? "text-teal-400" : "text-amber-400"}`}>{prop.confidence}%</p>
                      <p className="text-slate-600">{prop.matchupScore}/10</p>
                    </div>
                    <Link href="/research" className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-semibold text-emerald-400 hover:bg-emerald-500/20">
                      Research
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Research Actions */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Actions</p>
            <button onClick={onToggleFollow}
              className={`w-full rounded-xl border py-2 text-sm font-semibold transition ${isFollowed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/8 bg-white/4 text-slate-300 hover:border-white/15 hover:text-white"}`}>
              {isFollowed ? "Following ✓" : "Follow Alert"}
            </button>
            <Link href="/research"
              className="block w-full rounded-xl border border-white/8 bg-white/4 py-2 text-center text-sm text-slate-300 hover:text-white">
              {alert.category === "PITCHER" ? "Research Pitcher" : alert.category === "INJURY" ? "Research Player" : "View Related Props"}
            </Link>
            <button onClick={() => { /* opens create alert prefilled */ }}
              className="w-full rounded-xl border border-white/8 bg-white/3 py-2 text-sm text-slate-500 hover:text-slate-300">
              Create Related Alert
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
