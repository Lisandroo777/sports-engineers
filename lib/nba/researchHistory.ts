import type { NBAGameLogEntry, NBAGameStatMap } from './types';
import { getNBAHistoricalValue, type NBAAnalyzableMarket } from './market';
import { NBA_SOURCE_MARKET_TO_CANONICAL } from './oddsTypes';

export function nbaResearchStatValue(marketId: string, stats: NBAGameStatMap): number | null {
  const finite = (key: string) => Number.isFinite(stats[key]) && stats[key] >= 0 ? stats[key] : null;
  const canonical = NBA_SOURCE_MARKET_TO_CANONICAL[marketId]
    ?? Object.values(NBA_SOURCE_MARKET_TO_CANONICAL).find(key => key === marketId);
  if (canonical) {
    const value = getNBAHistoricalValue(canonical as NBAAnalyzableMarket, stats);
    return value != null && Number.isFinite(value) && value >= 0 ? value : null;
  }
  switch (marketId) {
    case 'player_field_goals': return finite('fieldGoalsMade') ?? finite('fieldGoalsMade-fieldGoalsAttempted');
    case 'player_frees_made': return finite('freeThrowsMade') ?? finite('freeThrowsMade-freeThrowsAttempted');
    case 'player_frees_attempts': return finite('freeThrowsAttempted');
    case 'field_goals_attempted': return finite('fieldGoalsAttempted');
    case 'three_pointers_attempted': return finite('threePointFieldGoalsAttempted');
    case 'two_pointers_made': {
      const made = finite('fieldGoalsMade') ?? finite('fieldGoalsMade-fieldGoalsAttempted');
      const threes = finite('threePointFieldGoalsMade') ?? finite('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
      return made != null && threes != null && made >= threes ? made - threes : null;
    }
    case 'defensive_rebounds': return finite('defensiveRebounds');
    case 'offensive_rebounds': return finite('offensiveRebounds');
    case 'personal_fouls': return finite('fouls');
    case 'player_blocks_steals': {
      const blocks = finite('blocks');
      const steals = finite('steals');
      return blocks != null && steals != null ? blocks + steals : null;
    }
    case 'player_double_double':
    case 'player_triple_double': {
      const values = ['points', 'totalRebounds', 'assists', 'blocks', 'steals'].map(finite);
      if (values.some(value => value == null)) return null;
      return values.filter(value => value! >= 10).length >= (marketId === 'player_double_double' ? 2 : 3) ? 1 : 0;
    }
    default: return null;
  }
}

export function nbaHistoricalResearch(marketId: string, logs: NBAGameLogEntry[], line: number, side: 'over' | 'under', tipoff: string, opponent?: string): string {
  const cutoff = Math.min(Date.parse(tipoff), Date.now());
  const completed = logs.filter(log => /^[WL]\b/.test(log.result ?? '') && Date.parse(log.date) + 6 * 3600000 < cutoff
    && log.season != null && ['REGULAR', 'PLAY_IN', 'POSTSEASON'].includes(log.phase ?? ''));
  const latest = [...completed].sort((first, second) => Date.parse(second.date) - Date.parse(first.date))[0];
  const sample = completed.filter(log => latest && log.season === latest.season && log.phase === latest.phase
    && (!opponent || log.opponent.trim().toLowerCase() === opponent.trim().toLowerCase()))
    .sort((first, second) => Date.parse(second.date) - Date.parse(first.date)).slice(0, 20);
  const values = sample.map(log => nbaResearchStatValue(marketId, log.stats)).filter((value): value is number => value != null);
  if (!values.length) return `Historical evaluation unavailable${opponent ? ` against ${opponent}` : ''}: no completed, phase-consistent pre-tipoff sample with the required statistics. No substitute statistic used.`;
  const wins = values.filter(value => side === 'over' ? value > line : value < line).length;
  const pushes = values.filter(value => value === line).length;
  return `Descriptive history only${opponent ? ` against ${opponent}` : ''}: ${values.length} completed ${latest.phase} games, season ${latest.season ?? 'unknown'}; mean ${(values.reduce((total, value) => total + value, 0) / values.length).toFixed(2)}; ${wins} wins, ${values.length - wins - pushes} losses, ${pushes} pushes against ${side} ${line}. ${sample.length - values.length} games missing required stats excluded. This is not a predicted probability or qualified pick.`;
}