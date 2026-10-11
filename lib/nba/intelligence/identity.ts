import type { IdentityEntry } from './types';

const nameKey = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'\u2019]/g, '').replace(/\s+/g, ' ').trim();
export function resolveIdentity(name: string, teamId: number, at: string, directory: IdentityEntry[]): { playerId: number | null; reason: string | null } {
  const key = nameKey(name);
  const matches = directory.filter(entry => entry.teamId === teamId && Date.parse(entry.validFrom) <= Date.parse(at)
    && (entry.validTo == null || Date.parse(at) < Date.parse(entry.validTo))
    && [entry.name, ...entry.aliases].some(alias => nameKey(alias) === key));
  const ids = [...new Set(matches.map(entry => entry.espnId))];
  return ids.length === 1 ? { playerId: ids[0], reason: null } : { playerId: null, reason: ids.length ? 'Ambiguous name within dated team roster.' : 'No exact verified name/alias in dated team roster.' };
}
export function validPlayer(playerId: number, teamId: number, at: string, directory: IdentityEntry[]): boolean {
  return directory.some(entry => entry.espnId === playerId && entry.teamId === teamId && Date.parse(entry.validFrom) <= Date.parse(at) && (entry.validTo == null || Date.parse(at) < Date.parse(entry.validTo)));
}