import { notFound } from "next/navigation";
import { getPropById } from "../mockData";
import ResearchDetailClient from "./ResearchDetailClient";
import { getMLBPlayer } from "@/lib/mlb/players";
import { getPlayerGameLogs, calculateHits, calculateTotalBases, calculateHomeRuns, calculateRuns, calculateRBI, calculateHitsRunsRBI, calculateStrikeouts, calculateOutsRecorded } from "@/lib/mlb/stats";
import { getMLBSchedule } from "@/lib/mlb/schedule";
import { getPlayerProps } from "@/lib/odds/playerProps";
import { getMarketMetadata, type OddsMarketKey } from "@/lib/odds/types";
import { isValidSlateDate, todaySlateDate } from "@/lib/dateModel";
import type { PropResearchItem } from "../mockData";
import type { MLBGameLog } from "@/lib/mlb/types";

interface ResearchDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ alternate?: string; market?: string; date?: string }>;
}

const MARKET_PREFERENCE_ORDER: OddsMarketKey[] = [
  'batter_home_runs', 'batter_hits', 'batter_total_bases', 'batter_rbis', 'batter_runs_scored', 'batter_hits_runs_rbis', 'batter_strikeouts',
  'pitcher_strikeouts', 'pitcher_hits_allowed', 'pitcher_earned_runs', 'pitcher_outs',
];

function getStatForMarket(game: MLBGameLog, market: OddsMarketKey) {
  switch (market) {
    case 'batter_hits': return calculateHits(game);
    case 'batter_total_bases': return calculateTotalBases(game);
    case 'batter_home_runs': return calculateHomeRuns(game);
    case 'batter_runs_scored': return calculateRuns(game);
    case 'batter_rbis': return calculateRBI(game);
    case 'batter_hits_runs_rbis': return calculateHitsRunsRBI(game);
    case 'batter_doubles': return game.doubles ?? null;
    case 'batter_triples': return game.triples ?? null;
    case 'batter_walks': return game.walks ?? null;
    case 'batter_strikeouts':
    case 'pitcher_strikeouts':
      return calculateStrikeouts(game);
    case 'pitcher_hits_allowed': return game.hitsAllowed ?? null;
    case 'pitcher_earned_runs': return game.earnedRuns ?? null;
    case 'pitcher_outs': return calculateOutsRecorded(game.inningsPitched);
    default: return calculateHits(game);
  }
}

function formatAmericanOdds(value: number | null) {
  if (value == null) return 'Unavailable';
  return value > 0 ? `+${value}` : `${value}`;
}

export default async function ResearchDetailPage({ params, searchParams }: ResearchDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const useAlternates = query.alternate === 'true';
  const requestedMarket = query.market as OddsMarketKey | undefined;
  const slateDate = isValidSlateDate(query.date) ? query.date : todaySlateDate();
  if (id.startsWith('live-')) {
    const playerId = Number(id.slice(5));
    if (!playerId) notFound();
    try {
      const [player, logs, games] = await Promise.all([getMLBPlayer(playerId), getPlayerGameLogs(playerId, new Date().getUTCFullYear()), getMLBSchedule(slateDate)]);
      const team = player.currentTeam;
      const matchup = team ? games.find((game) => game.awayTeam.id === team.id || game.homeTeam.id === team.id) : undefined;
      const isAway = matchup?.awayTeam.id === team?.id;
      const isPitcher = player.position?.toUpperCase().includes('P') ?? false;

      let chosenProp = null as Awaited<ReturnType<typeof getPlayerProps>>['props'][number] | null;
      if (team && matchup) {
        try {
          const oddsResult = await getPlayerProps(player.name, team.name, isPitcher, useAlternates, slateDate);
          const requested = requestedMarket ? oddsResult.props.filter((prop) => prop.marketKey === requestedMarket) : oddsResult.props;
          chosenProp = requested.length
            ? [...requested].sort((a, b) => MARKET_PREFERENCE_ORDER.indexOf(a.marketKey) - MARKET_PREFERENCE_ORDER.indexOf(b.marketKey))[0]
            : null;
        } catch { chosenProp = null; }
      }

      // Only historical games strictly before the selected slate date ever count toward L5/L10/etc. —
      // this keeps "Tomorrow" research from ever leaking the (not-yet-played) selected game into its own history.
      const historicalLogs = logs.filter((game) => game.date < slateDate);

      // Real probable starters when MLB has announced them — season pitching stats (ERA/WHIP/K%/etc.)
      // aren't fetched on this page yet, so those fields stay honestly "Data unavailable" rather than guessed.
      const startingPitchers = matchup ? {
        away: { name: matchup.awayProbableStarter?.name ?? 'Starter not announced', hand: matchup.awayProbableStarter?.throwingHand ?? '—', era: 'Data unavailable', whip: 'Data unavailable', kRate: 'Data unavailable', bbRate: 'Data unavailable', hrPer9: 'Data unavailable', baa: 'Data unavailable' },
        home: { name: matchup.homeProbableStarter?.name ?? 'Starter not announced', hand: matchup.homeProbableStarter?.throwingHand ?? '—', era: 'Data unavailable', whip: 'Data unavailable', kRate: 'Data unavailable', bbRate: 'Data unavailable', hrPer9: 'Data unavailable', baa: 'Data unavailable' },
      } : undefined;

      const statMarket: OddsMarketKey = chosenProp?.marketKey ?? 'batter_hits';
      const prop: PropResearchItem = {
        id, isLive: true, hasSportsbookLine: Boolean(chosenProp), sport: 'MLB', player: player.name, playerId: player.id, playerImageUrl: player.playerImageUrl ?? undefined,
        team: team?.name ?? 'Data unavailable', teamId: team?.id, opponent: matchup ? (isAway ? matchup.homeTeam.name : matchup.awayTeam.name) : 'Data unavailable', homeAway: isAway ? 'Away' : 'Home',
        propType: chosenProp?.marketLabel ?? (matchup ? 'Hits' : 'Data unavailable'),
        line: chosenProp ? String(chosenProp.line) : (matchup ? 'Props not posted yet' : 'Data unavailable'),
        overOdds: formatAmericanOdds(chosenProp?.overOdds ?? null),
        underOdds: formatAmericanOdds(chosenProp?.underOdds ?? null),
        sportsbookName: chosenProp?.sportsbookName,
        oddsLastUpdate: chosenProp?.lastUpdate,
        projectedValue: 0, confidence: 0, confidenceLabel: 'Moderate', gameTime: matchup?.gameTime ? new Date(matchup.gameTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Data unavailable', researchSide: 'Over',
        hitRates: { last5: 0, last10: 0, last20: 0, last40: 0, season: 0 }, last5: '—', last10: '—', last20: '—', last40: '—', season: '—',
        startingPitchers,
        gameLog: historicalLogs.map((game) => {
          const statValue = getStatForMarket(game, statMarket);
          const marketLabel = getMarketMetadata(statMarket)?.label ?? statMarket;
          const display = statValue == null ? 'Unavailable' : `${statValue} ${marketLabel}`;
          return { date: game.date, opponent: game.opponent, statResult: display, actualStatResult: display, playerStat: statValue ?? 0, hit: false, homeAway: game.homeAway === 'away' ? 'Away' : 'Home', plateAppearances: game.plateAppearances ?? undefined, hits: game.hits ?? undefined, extraBaseHits: (game.doubles ?? 0) + (game.triples ?? 0) + (game.homeRuns ?? 0), runs: game.runs ?? undefined, rbi: game.rbi ?? undefined, totalBases: calculateTotalBases(game) ?? undefined };
        }),
        splits: { home: 'Data unavailable', away: 'Data unavailable', similarOpponents: 'Data unavailable', recent5: 'Data unavailable', recent10: 'Data unavailable' }, matchup: { opponentDefensiveRanking: 'Data unavailable', opponentAllowedAverage: 'Data unavailable', paceEnvironment: 'Data unavailable', difficulty: 'Data unavailable', recentHistory: 'Data unavailable' }, researchFactors: [], aiAnalysis: { summary: 'Data unavailable', risks: 'Data unavailable', lean: 'Data unavailable' },
        stadium: matchup?.venue ? { name: matchup.venue.stadiumName, city: `${matchup.venue.city}, ${matchup.venue.state}`, parkFactor: 'Data unavailable' } : undefined,
      };
      return <ResearchDetailClient prop={prop} />;
    } catch { notFound(); }
  }
  const prop = getPropById(id);

  if (!prop) {
    notFound();
  }

  return <ResearchDetailClient prop={prop} />;
}
