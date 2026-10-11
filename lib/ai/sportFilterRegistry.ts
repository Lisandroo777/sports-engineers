import { normalizeSport, type SupportedSport } from './sportResearchAdapters';

export type SportFilterId = 'NFL_FILTER' | 'NBA_FILTER' | 'MLB_FILTER' | 'TENNIS_FILTER' | 'MLS_FILTER';
export type SportResearchImplementation = 'NFL_RESEARCH_MODEL' | 'EXISTING_NBA_ENGINE' | 'EXISTING_MLB_ENGINE' | 'NOT_IMPLEMENTED';

export interface SportFilterRegistration {
  sport: SupportedSport;
  sportFilter: string;
  filterId: SportFilterId;
  version: string | null;
  implementation: SportResearchImplementation;
}

export const SPORT_FILTER_REGISTRY: Record<SupportedSport, SportFilterRegistration> = {
  nfl: { sport: 'nfl', sportFilter: 'NFL', filterId: 'NFL_FILTER', version: '1.0.0', implementation: 'NFL_RESEARCH_MODEL' },
  nba: { sport: 'nba', sportFilter: 'NBA', filterId: 'NBA_FILTER', version: 'legacy', implementation: 'EXISTING_NBA_ENGINE' },
  mlb: { sport: 'mlb', sportFilter: 'MLB', filterId: 'MLB_FILTER', version: 'legacy', implementation: 'EXISTING_MLB_ENGINE' },
  soccer: { sport: 'soccer', sportFilter: 'MLS', filterId: 'MLS_FILTER', version: null, implementation: 'NOT_IMPLEMENTED' },
  tennis: { sport: 'tennis', sportFilter: 'TENNIS', filterId: 'TENNIS_FILTER', version: null, implementation: 'NOT_IMPLEMENTED' },
};

export function getSportFilterRegistration(sport: string): SportFilterRegistration | null {
  const normalized = normalizeSport(sport);
  return normalized ? SPORT_FILTER_REGISTRY[normalized] : null;
}

export function isSportResearchImplemented(sport: string): boolean {
  const registration = getSportFilterRegistration(sport);
  return registration != null && registration.implementation !== 'NOT_IMPLEMENTED';
}